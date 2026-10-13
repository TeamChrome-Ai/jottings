import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildIndex, defaultOrder, fold, ftsSnippet, parseQuery, restoreIndex, searchIndex, serializeIndex, termsOf, windowSnippet, type SearchIndex, type VerseRow } from '../shared/search'
import { HAS_TEXTS } from './_texts'

describe('tokens', () => {
  it('splits on apostrophes, hyphens, dashes and brackets like unicode61', () => {
    expect(termsOf('the Lord’s loving-kindness—[is] great')).toEqual(['the', 'lord', 's', 'loving', 'kindness', 'is', 'great'])
    expect(termsOf("Jehovah's")).toEqual(['jehovah', 's'])
  })
  it('folds case and diacritics, keeps ligatures', () => {
    expect(fold('Ïtaly')).toBe('italy')
    expect(fold('Æneas')).toBe('æneas')
    expect(termsOf('Naïve Zoë')).toEqual(['naive', 'zoe'])
  })
})

describe('parseQuery (fts_query in rs/src/search.rs)', () => {
  it('bare words of 3+ characters are prefixes', () => {
    expect(parseQuery('faith hope love', true)).toEqual([
      { terms: ['faith'], prefix: true }, { terms: ['hope'], prefix: true }, { terms: ['love'], prefix: true },
    ])
    expect(parseQuery('is', true)).toEqual([{ terms: ['is'], prefix: false }])
    expect(parseQuery('faith', false)).toEqual([{ terms: ['faith'], prefix: false }])
  })
  it('hyphenated words become phrases, prefix on the last part', () => {
    expect(parseQuery('loving-kindness', true)).toEqual([{ terms: ['loving', 'kindness'], prefix: true }])
    expect(parseQuery('Beer–sheba', false)).toEqual([{ terms: ['beer', 'sheba'], prefix: false }])
  })
  it('quoted phrases stay exact phrases; an unclosed quote runs to the end', () => {
    expect(parseQuery('"life eternal" god', false)).toEqual([{ terms: ['life', 'eternal'], prefix: false }, { terms: ['god'], prefix: false }])
    expect(parseQuery('"only begotten', true)).toEqual([{ terms: ['only', 'begotten'], prefix: false }])
  })
  it('apostrophes stay inside a word and split into terms', () => {
    expect(parseQuery("lord's", true)).toEqual([{ terms: ['lord', 's'], prefix: true }])
  })
  it('punctuation only is no query', () => {
    expect(parseQuery('---', true)).toBeNull()
    expect(parseQuery('  ', true)).toBeNull()
  })
})

const row = (book: number, chapter: number, verse: number, text: string): VerseRow => ({ book, chapter, verse, text })
const MINI = [
  row(1, 1, 1, 'In the beginning God created the heavens and the earth.'),
  row(19, 23, 1, 'Jehovah is my shepherd: I shall not want.'),
  row(19, 136, 1, 'Give ye thanks unto Jehovah; for he is good; for his loving-kindness [endureth] for ever.'),
  row(43, 3, 16, 'For God so loved the world, that he gave his only-begotten Son, that whosoever believes on him may not perish, but have life eternal.'),
  row(62, 4, 8, 'He that loves not has not known God; for God is love.'),
]

describe('defaultOrder (default_order in rs/src/search.rs)', () => {
  it('one word or one quoted phrase is a concordance lookup: Bible order', () => {
    for (const q of ['beginning', ' Beginning ', 'loving-kindness', '"in the beginning"', '"life eternal', 'is', '---', '']) expect(defaultOrder(q), q).toBe('bible')
  })
  it('several terms are a hunt for one verse: best match', () => {
    for (const q of ['faith hope love', 'in the beginning', '"life eternal" god', 'god "life eternal"', '"a b" "c d"']) expect(defaultOrder(q), q).toBe('match')
  })
})

describe('one bare word in Bible order: the word itself leads', () => {
  const rows = [
    { book: 19, chapter: 119, verse: 147, text: 'I anticipated the morning-dawn and I cried.' },
    { book: 20, chapter: 6, verse: 6, text: 'Go to the ant, thou sluggard; consider her ways and be wise.' },
    { book: 20, chapter: 30, verse: 25, text: 'The ants, a people not strong, yet they provide their food in the summer.' },
    { book: 44, chapter: 11, verse: 26, text: 'And the disciples were first called Christians in Antioch.' },
  ]
  const ix = buildIndex(rows)
  const at = (r: ReturnType<typeof searchIndex>) => r.hits.map(h => `${h.book}.${h.chapter}.${h.verse}`)
  it('lists ant and ants before anticipate and Antioch, each group in Bible order', () => {
    const r = searchIndex(ix, 'ant')
    expect([r.order, r.total, r.exact]).toEqual(['bible', 4, 2])
    expect(at(r)).toEqual(['20.6.6', '20.30.25', '19.119.147', '44.11.26'])
    expect(at(searchIndex(ix, 'ant', { limit: 2, offset: 1 }))).toEqual(['20.30.25', '19.119.147'])
  })
  it('names no group when all or none of the hits are the word itself, or the list is ranked', () => {
    expect(searchIndex(ix, 'ant', { scope: '20' }).exact).toBeUndefined()
    expect(searchIndex(ix, 'ant', { scope: 'NT' }).exact).toBeUndefined()
    expect(searchIndex(ix, 'anti').exact).toBeUndefined()
    expect(at(searchIndex(ix, 'anti'))).toEqual(['19.119.147', '44.11.26'])
    expect(searchIndex(ix, 'ant', { order: 'match' }).exact).toBeUndefined()
    expect(searchIndex(ix, 'ant go', { order: 'bible' }).exact).toBeUndefined()
  })
})

describe('searchIndex on a few verses', () => {
  const ix = buildIndex(MINI)
  it('ANDs words with prefix matching and ranks by bm25', () => {
    const r = searchIndex(ix, 'god love')
    expect(r.kind).toBe('text')
    expect(r.hits.map(h => `${h.book}.${h.chapter}.${h.verse}`)).toEqual(['62.4.8', '43.3.16'])
    expect(r.hits[0].rank).toBeLessThan(r.hits[1].rank)
    expect(r.hits[0].snippet).toBe('He that <mark>loves</mark> not has not known <mark>God</mark>; for <mark>God</mark> is <mark>love</mark>.')
  })
  it('matches phrases only when the words are adjacent', () => {
    expect(searchIndex(ix, '"god created"').total).toBe(1)
    expect(searchIndex(ix, '"created god"').total).toBe(0)
    const r = searchIndex(ix, 'only-begotten')
    expect(r.hits[0].snippet).toContain('<mark>only-begotten</mark>')
  })
  it('filters by testament and book', () => {
    expect(searchIndex(ix, 'god', { scope: 'OT' }).hits.map(h => h.book)).toEqual([1])
    expect(searchIndex(ix, 'god', { scope: 'NT' }).total).toBe(2)
    expect(searchIndex(ix, 'jehovah', { scope: '19' }).total).toBe(2)
  })
  it('falls back to a substring when no word matches', () => {
    const r = searchIndex(ix, 'eginnin')
    expect(r.total).toBe(1)
    expect(r.hits[0].snippet).toBe('In the b<mark>eginnin</mark>g God created the heavens and the earth.')
    expect(searchIndex(ix, 'zz').total).toBe(0)
  })
  it('answers references like the server', () => {
    const r = searchIndex(ix, 'ps 23:1')
    expect(r.kind).toBe('ref')
    expect(r.ref).toMatchObject({ book: 19, chapter: 23, v1: 1 })
    expect(r.hits[0].text).toMatch(/^Jehovah is my shepherd/)
  })
  it('limits and offsets like the server', () => {
    expect(searchIndex(ix, 'the', { limit: 1 }).hits).toHaveLength(1)
    expect(searchIndex(ix, 'the', { limit: 1 }).total).toBe(searchIndex(ix, 'the').total)
    expect(searchIndex(ix, 'the', { limit: 1, offset: 1 }).hits[0].verse).toBe(searchIndex(ix, 'the').hits[1].verse)
  })
})

describe('snippets', () => {
  it('windows long verses to 24 tokens with ellipses', () => {
    const long = row(1, 1, 1, Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ') + '.')
    const ix = buildIndex([long])
    const s = ftsSnippet(ix, 0, [[[ix.terms.indexOf('w40'), ix.terms.indexOf('w40') + 1]]])
    expect(s.startsWith('…') && s.endsWith('…')).toBe(true)
    expect(s).toContain('<mark>w40</mark>')
    expect(s.split(' ')).toHaveLength(24)
  })
  it('window_snippet escapes and marks the first occurrence', () => {
    expect(windowSnippet('a < b and a', 'A')).toBe('<mark>a</mark> &lt; b and a')
  })
})

describe.skipIf(!HAS_TEXTS)('the whole text', () => {
  let rows: VerseRow[]
  let ix: SearchIndex
  beforeAll(() => {
    const all = JSON.parse(readFileSync(path.resolve(__dirname, '../client/public/bible/all.json'), 'utf8')) as { chapters: { book: number; c: number; verses: { v: number; t: string }[] }[] }
    rows = all.chapters.flatMap(ch => ch.verses.map(v => row(ch.book, ch.c, v.v, v.t)))
    ix = buildIndex(rows)
  })
  it('indexes every verse within 16-bit ids', () => {
    expect(ix.rows).toHaveLength(31103)
    expect(ix.terms.length).toBeLessThan(0xffff)
  })
  it('matches the server test suite (rs/src/search.rs)', () => {
    expect(searchIndex(ix, 'loving-kindness', { limit: 5 }).total).toBeGreaterThan(150)
    expect(searchIndex(ix, '"only-begotten Son"', { scope: 'NT' }).hits.some(h => h.book === 43 && h.chapter === 3 && h.verse === 16)).toBe(true)
    expect(searchIndex(ix, 'begat', { limit: 50, scope: 'NT' }).hits.every(h => h.book >= 40)).toBe(true)
    expect(searchIndex(ix, 'shepherd', { limit: 50, scope: '19' }).hits.every(h => h.book === 19)).toBe(true)
    const r = searchIndex(ix, 'oving-kindnes', { limit: 5 })
    expect(r.total).toBeGreaterThan(0)
    expect(r.hits[0].snippet).toContain('<mark>')
  })
  it('lists one word in Bible order and several by best match, as the server does', () => {
    const at = (h: { book: number; chapter: number; verse: number }) => h.book * 1e6 + h.chapter * 1e3 + h.verse
    const inBibleOrder = (hits: { book: number; chapter: number; verse: number }[]) => hits.every((h, i) => !i || at(hits[i - 1]) < at(h))
    const byRank = (hits: { rank: number }[]) => hits.every((h, i) => !i || hits[i - 1].rank <= h.rank)
    const r = searchIndex(ix, 'beginning', { limit: 50 })
    expect(r.order).toBe('bible')
    expect(r.hits[0]).toMatchObject({ book: 1, chapter: 1, verse: 1 })
    expect(inBibleOrder(r.hits)).toBe(true)
    const m = searchIndex(ix, 'beginning', { limit: 50, order: 'match' })
    expect(m.order).toBe('match')
    expect(m.total).toBe(r.total)
    expect(byRank(m.hits)).toBe(true)
    expect(m.hits[0]).not.toMatchObject({ book: 1, chapter: 1, verse: 1 })
    // a later page carries on where the first stopped
    expect(searchIndex(ix, 'beginning', { limit: 10, offset: 10 }).hits).toEqual(r.hits.slice(10, 20))
    const several = searchIndex(ix, 'faith hope love', { limit: 50 })
    expect(several.order).toBe('match')
    expect(byRank(several.hits)).toBe(true)
    expect(inBibleOrder(searchIndex(ix, 'faith hope love', { limit: 50, order: 'bible' }).hits)).toBe(true)
    // the substring fallback follows the same rule; a reference names no order
    const sub = searchIndex(ix, 'oving-kindnes', { limit: 50 })
    expect(sub.order).toBe('bible')
    expect(inBibleOrder(sub.hits)).toBe(true)
    expect(searchIndex(ix, 'jn 3:16').order).toBeUndefined()
  })
  it('reads a book name alone as a word first, as the server does', () => {
    const at = (h: { book: number; chapter: number; verse: number }) => h.book * 1e6 + h.chapter * 1e3 + h.verse
    const r = searchIndex(ix, 'song', { limit: 50 })
    expect(r).toMatchObject({ kind: 'text', order: 'bible', book: { book: 22, chapter: 1 }, query: 'song' })
    expect(r.ref).toBeUndefined()
    expect(r.total).toBeGreaterThan(0)
    expect(r.hits.every(h => /song/i.test(h.text))).toBe(true)
    expect(r.hits.every((h, i) => !i || at(r.hits[i - 1]) < at(h))).toBe(true)
    expect(r.hits[0].book).toBeLessThan(22)
    // order, scope and paging as any word search
    const m = searchIndex(ix, 'song', { limit: 50, order: 'match' })
    expect(m).toMatchObject({ order: 'match', total: r.total, book: { book: 22, chapter: 1 } })
    expect(searchIndex(ix, 'song', { limit: 50, scope: 'NT' }).hits.every(h => h.book >= 40)).toBe(true)
    expect(searchIndex(ix, 'song', { limit: 1, offset: 1 }).hits[0]).toEqual(r.hits[1])
    expect(searchIndex(ix, 'mark')).toMatchObject({ kind: 'text', book: { book: 41, chapter: 1 } })
    expect(searchIndex(ix, 'mark').total).toBeGreaterThan(0)
    for (const q of ['job', 'acts', 'john', 'numbers', 'judges', 'ruth', 'james', 'titus', 'amos', 'joel', 'habakkuk']) {
      const w = searchIndex(ix, q, { limit: 5 })
      expect(w.kind === 'text' && w.total > 0 && !!w.book, q).toBe(true)
    }
    // with a chapter or a verse it is a citation, as before
    for (const q of ['song 2:1', 'song 2', 'song of solomon 2']) {
      const c = searchIndex(ix, q)
      expect(c, q).toMatchObject({ kind: 'ref', ref: { book: 22, chapter: 2 } })
      expect(c.book, q).toBeUndefined()
    }
    expect(searchIndex(ix, '1 kings 8')).toMatchObject({ kind: 'ref', ref: { book: 11, chapter: 8 } })
    // a name of several words is a phrase: the text has "song of songs" once, "song of solomon" never
    const p = searchIndex(ix, 'song of songs')
    expect(p).toMatchObject({ kind: 'text', order: 'bible', query: 'song of songs', book: { book: 22, chapter: 1 } })
    expect(p.hits.every(h => /song of songs/i.test(h.text))).toBe(true)
    // a name the text never uses opens the book at chapter 1
    for (const [q, b] of [['song of solomon', 22], ['jn', 43], ['1 cor', 46], ['jdg', 7]] as const) {
      const c = searchIndex(ix, q)
      expect(c, q).toMatchObject({ kind: 'ref', ref: { book: b, chapter: 1 } })
      expect(c.total, q).toBeGreaterThan(0)
      expect(c.order ?? c.book, q).toBeUndefined()
    }
  })
  it('survives a round trip through bytes', () => {
    const back = restoreIndex(rows, serializeIndex(ix))!
    expect(back.terms).toEqual(ix.terms)
    expect(searchIndex(back, 'faith hope', { limit: 100 })).toMatchObject({ total: searchIndex(ix, 'faith hope').total, hits: searchIndex(ix, 'faith hope', { limit: 100 }).hits })
    expect(restoreIndex(rows.slice(1), serializeIndex(ix))).toBeNull()
  })
})
