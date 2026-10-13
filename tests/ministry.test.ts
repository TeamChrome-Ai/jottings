import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { MINISTRY_AUTHORS, enabledAuthors, ministryAuthor } from '../shared/ministry'
import { bibleWords, LIST_REFS, mentionOfRank, onPassage, paragraphHits, plainOf, rankOf, RANGE_CAP, sectionHits, snippetOf, verseId, verseOf } from '../shared/ministryIndex'
import { paragraphsOf } from '../shared/companion'

// a small Bible: John 3 (36 verses, 16 and 17 with their words), Romans 8 (39), Genesis 1 (31, verse 26 and 28)
const filler = (n: number, skip: Record<number, string>) => Array.from({ length: n }, (_, i) => ({ v: i + 1, t: skip[i + 1] ?? `verse ${i + 1} of this chapter` }))
const bible = bibleWords([
  { n: 43, chapters: [{ c: 3, verses: filler(36, {
    16: 'For God so loved the world, that he gave his only-begotten Son, that whosoever believes on him may not perish, but have life eternal.',
    17: 'For God has not sent his Son into the world that he may judge the world, but that the world may be saved through him.',
  }) }] },
  { n: 45, chapters: [{ c: 8, verses: filler(39, { 28: 'But we know that all things work together for good to them that love God, to them who are called according to purpose.' }) }] },
  { n: 1, chapters: [{ c: 1, verses: filler(31, {
    26: 'And God said, Let us make man in our image, after our likeness; and let them have dominion over the fish of the sea, and over the fowl of the heavens.',
    28: 'And God blessed them; and God said to them, Be fruitful and multiply, and fill the earth, and have dominion over the fish of the sea, and over the fowl of the heavens.',
  }) }] },
])
const J316 = verseId(43, 3, 16), J317 = verseId(43, 3, 17), R828 = verseId(45, 8, 28)
const hitsOf = (text: string, home?: { book: number; chapter?: number }) => Object.fromEntries(paragraphHits(text, bible, home).hits.map(h => [h.verse, h.mention]))

describe('registry', () => {
  it('lists Darby and Coates enabled, the rest as placeholders', () => {
    expect(enabledAuthors().map(a => a.id)).toEqual(['darby', 'coates'])
    expect(MINISTRY_AUTHORS.filter(a => !a.enabled).map(a => a.id)).toEqual(['kelly', 'bellett', 'mackintosh', 'raven', 'taylor'])
    expect(ministryAuthor('kelly')).toBeUndefined()
    expect(new Set(MINISTRY_AUTHORS.map(a => a.id)).size).toBe(MINISTRY_AUTHORS.length)
    for (const a of enabledAuthors()) expect(a.source && a.licence && a.corpus).toBeTruthy()
  })
  it('has no data for a disabled author', () => {
    for (const a of MINISTRY_AUTHORS.filter(x => !x.enabled)) expect(existsSync(`data/ministry/${a.id}`)).toBe(false)
  })
})

describe('the verse index', () => {
  it('reads a verse, a range and a quotation, each verse once at its best', () => {
    expect(hitsOf('See John 3:16.')).toEqual({ [J316]: 'verse' })
    expect(hitsOf('Compare John 3:16-17 with what follows.')).toEqual({ [J316]: 'range', [J317]: 'range' })
    // five running words of the verse beside a reference to it: a quotation
    expect(hitsOf('“God so loved the world, that he gave his only-begotten Son” (John 3:16).')).toEqual({ [J316]: 'quote' })
    // a range with a quotation of one of its verses: that verse is quoted, the other is in the range
    expect(hitsOf('John 3:16–17: “that the world may be saved through him”.')).toEqual({ [J316]: 'range', [J317]: 'quote' })
    // the better of two mentions wins
    expect(hitsOf('John 3:16-17, and above all John 3:16.')[J316]).toBe('verse')
  })
  it('finds a quotation with no reference by eight running words of one verse only', () => {
    expect(hitsOf('We know that all things work together for good to them that love God.')).toEqual({ [R828]: 'quote' })
    // seven words are not enough, and small words alone never are
    expect(hitsOf('all things work together for good to')).toEqual({})
    // a phrase in two verses (Genesis 1:26 and 28 share "have dominion over the fish of the sea, and over") is neither's
    expect(hitsOf('to have dominion over the fish of the sea, and over the fowl')).toEqual({})
  })
  it('in a reading on a passage, five words of a verse of the chapter in hand are a quotation', () => {
    const text = 'God takes counsel. “Let us make man in our image.”\n\nThe fish of the sea and the fowl of the heavens are given to him.'
    const [first, second] = sectionHits(text, bible, { book: 1, chapter: 1 }, [[1, 1, 1, 1, 0]])
    expect(first.hits.map(h => [h.verse, h.mention])).toEqual([[verseId(1, 1, 26), 'quote']])
    // a phrase verses 26 and 28 share is no one verse's
    expect(second.hits).toEqual([])
    // outside a reading on the passage, five words are not enough
    expect(hitsOf('“Let us make man in our image.”')).toEqual({})
  })
  it('caps ranges: a whole chapter or a long range names no verse', () => {
    expect(hitsOf('Read Romans 8.')).toEqual({})
    expect(hitsOf(`Romans 8:1-${RANGE_CAP}.`)[verseId(45, 8, RANGE_CAP)]).toBe('range')
    expect(hitsOf(`Romans 8:1-${RANGE_CAP + 1}.`)).toEqual({})
    // a verse the chapter does not have is dropped; a range running past the end stops there
    expect(hitsOf('John 3:40.')).toEqual({})
    expect(Object.keys(hitsOf('John 3:35-38.')).length).toBe(2)
  })
  it(`reads a paragraph of ${LIST_REFS} references or more as a list`, () => {
    const refs = Array.from({ length: LIST_REFS }, (_, i) => `3:${i + 1}`).join('; ')
    const hits = hitsOf(`See John ${refs}; and “God so loved the world, that he gave his only-begotten Son”.`)
    expect(Object.keys(hits).length).toBe(LIST_REFS)
    expect(new Set(Object.values(hits))).toEqual(new Set(['list']))
    expect(hits[J316]).toBe('list')
  })
  it('reads the writer’s shorthand against the passage in hand, and a bare verse after the chapter last named', () => {
    expect(hitsOf('Then in verse 16 the gift.', { book: 43, chapter: 3 })).toEqual({ [J316]: 'verse' })
    const text = 'Chapter 3 opens the new birth.\n\nThen verse 16, the gift.'
    const [, second] = sectionHits(text, bible, { book: 43 }, [[43, 3, 1, 4, 0]])
    expect(second.hits.map(h => h.verse)).toEqual([J316])
  })
  it('ranks by mention, then the passage in hand, then fewer references', () => {
    expect(rankOf('quote', false, 50)).toBeLessThan(rankOf('verse', true, 1))
    expect(rankOf('verse', false, 50)).toBeLessThan(rankOf('range', true, 1))
    expect(rankOf('range', false, 999)).toBeLessThan(rankOf('list', true, 20))
    expect(rankOf('verse', true, 9)).toBeLessThan(rankOf('verse', false, 1))
    expect(rankOf('verse', false, 2)).toBeLessThan(rankOf('verse', false, 3))
    for (const m of ['quote', 'verse', 'range', 'list'] as const) expect(mentionOfRank(rankOf(m, false, 5000))).toBe(m)
    expect(rankOf('list', false, 5000)).toBeLessThan(2 ** 31)
    expect(onPassage([[43, 3, 1, 3, 0]], J316)).toBe(true)
    expect(onPassage([[43, 3, 1, 3, 15]], J316)).toBe(false)
    expect(onPassage([[43, 2, 1, 3, 16]], J316)).toBe(true)
    expect(verseOf(J316)).toEqual({ book: 43, chapter: 3, verse: 16 })
  })
})

describe('text and snippets', () => {
  it('reads a paragraph as the server quotes it', () => {
    const [q] = paragraphsOf('> A line\n> and <i>two</i> &amp; three')
    expect(plainOf(q)).toBe('A line and two & three')
  })
  it('cuts about 200 characters between words, the reference kept whole', () => {
    const t = 'a '.repeat(150) + 'Romans 8:28' + ' b'.repeat(150)
    const s = snippetOf(t, 300, 311)
    // rs/src/ministry.rs pins the same numbers
    expect([s.snippet.length, s.hl]).toEqual([201, [75, 86]])
    expect(s.snippet.slice(s.hl[0], s.hl[1])).toBe('Romans 8:28')
    expect(s.snippet.startsWith('…a ') && s.snippet.endsWith(' b…')).toBe(true)
    expect(snippetOf('See John 3:16.', 4, 13)).toEqual({ snippet: 'See John 3:16.', hl: [4, 13] })
    // near the end: the window slides back, no ellipsis after
    const end = snippetOf('x '.repeat(200) + 'John 3:16', 400, 409)
    expect(end.snippet.endsWith('John 3:16')).toBe(true)
    expect(end.snippet.slice(end.hl[0], end.hl[1])).toBe('John 3:16')
  })
})
