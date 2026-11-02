import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { MENTIONS, MINISTRY_AUTHORS, authorNames, enabledAuthors, ministryAuthor } from '../shared/ministry'
import { bibleWords, LIST_REFS, MARKER_RUN, mentionOfRank, onPassage, paragraphHits, plainOf, rankOf, RANGE_CAP, ROW_RANK, SECTION_CHAPTERS, sectionHits, snippetOf, verseId, verseOf } from '../shared/ministryIndex'
import { paragraphsOf } from '../shared/companion'

// a small Bible: John 3 (36 verses, 16 and 17 with their words) and 4 (54), Romans 8 (39), Genesis 1 (31, verse 26 and 28)
const filler = (n: number, skip: Record<number, string>) => Array.from({ length: n }, (_, i) => ({ v: i + 1, t: skip[i + 1] ?? `verse ${i + 1} of this chapter` }))
const bible = bibleWords([
  { n: 43, chapters: [{ c: 3, verses: filler(36, {
    16: 'For God so loved the world, that he gave his only-begotten Son, that whosoever believes on him may not perish, but have life eternal.',
    17: 'For God has not sent his Son into the world that he may judge the world, but that the world may be saved through him.',
  }) }, { c: 4, verses: filler(54, {}) }] },
  { n: 45, chapters: [{ c: 8, verses: filler(39, { 28: 'But we know that all things work together for good to them that love God, to them who are called according to purpose.' }) }] },
  { n: 1, chapters: [{ c: 1, verses: filler(31, {
    26: 'And God said, Let us make man in our image, after our likeness; and let them have dominion over the fish of the sea, and over the fowl of the heavens.',
    28: 'And God blessed them; and God said to them, Be fruitful and multiply, and fill the earth, and have dominion over the fish of the sea, and over the fowl of the heavens.',
  }) }] },
])
const J316 = verseId(43, 3, 16), J317 = verseId(43, 3, 17), R828 = verseId(45, 8, 28)
const hitsOf = (text: string, home?: { book: number; chapter?: number }) => Object.fromEntries(paragraphHits(text, bible, home).hits.map(h => [h.verse, h.mention]))

describe('registry', () => {
  it('lists Darby, Raven, then the rest by when they published, the rest as placeholders', () => {
    expect(enabledAuthors().map(a => a.id)).toEqual(['darby', 'raven', 'bellett', 'wigram', 'stoney', 'coates'])
    expect(authorNames()).toBe('Darby, Raven, Bellett, Wigram, Stoney and Coates')
    expect(authorNames(['coates', 'stoney', 'raven'])).toBe('Darby, Bellett and Wigram')
    expect(MINISTRY_AUTHORS.filter(a => !a.enabled).map(a => a.id)).toEqual(['kelly', 'mackintosh', 'taylor'])
    expect(ministryAuthor('kelly')).toBeUndefined()
    expect(new Set(MINISTRY_AUTHORS.map(a => a.id)).size).toBe(MINISTRY_AUTHORS.length)
    for (const a of enabledAuthors()) expect(a.source && a.licence && a.corpus).toBeTruthy()
  })
  it('credits Bible Truth Publishers for Bellett and Wigram, and the author alone for Stoney and Raven', () => {
    for (const id of ['bellett', 'wigram']) expect(ministryAuthor(id)!.source).toMatch(/Bible Truth Publishers/)
    for (const id of ['stoney', 'raven']) expect(ministryAuthor(id)!.source).toMatch(/^[A-Z]\. [A-Z]\. \w+ \(\d{4}–\d{4}\); public domain\.$/)
    for (const id of ['bellett', 'wigram', 'stoney', 'raven']) expect(existsSync(`data/ministry/${id}/index.json`)).toBe(true)
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
    expect(first.hits.map(h => [h.verse, h.mention])).toEqual([[verseId(1, 1, 26), 'quote'], [verseId(1, 1, 0), 'chapter']])
    // a phrase verses 26 and 28 share is no one verse's
    expect(second.hits).toEqual([])
    // outside a reading on the passage, five words are not enough
    expect(hitsOf('“Let us make man in our image.”')).toEqual({})
  })
  it('reads a chapter named alone as the row of the whole chapter (verse 0)', () => {
    expect(paragraphHits('Read Romans 8.', bible).hits).toEqual([{ verse: verseId(45, 8, 0), mention: 'chapter', start: 5, end: 13 }])
    expect(hitsOf('In chapter 3 the new birth.', { book: 43 })).toEqual({ [verseId(43, 3, 0)]: 'chapter' })
    // a chapter the Bible does not have (here, this small one), and one the book does not have, name nothing
    expect(hitsOf('Read Romans 9 and Romans 17.')).toEqual({})
    // a short run of chapters is on each of them; a long one is on none, not on its first
    expect(hitsOf('In John 3–4 the new birth and the well.')).toEqual({ [verseId(43, 3, 0)]: 'chapter', [verseId(43, 4, 0)]: 'chapter' })
    expect(hitsOf('Read Genesis 1–47 through.')).toEqual({})
  })
  it('reads a bare “chapter 3” against the section’s book, or the one a book’s introduction is lent, and no other', () => {
    const text = 'In chapter 3 the new birth.'
    const row = [{ verse: verseId(43, 3, 0), mention: 'chapter', start: 3, end: 12 }]
    expect(sectionHits(text, bible, { book: 43 }, [[43, 1, 1, 21, 0]])[0].hits).toEqual(row)
    expect(sectionHits(text, bible, { book: 43 }, [])[0].hits).toEqual(row)
    // a volume on several books lends none (homeOf)
    expect(sectionHits(text, bible, undefined, [])[0].hits).toEqual([])
    // a chapter named with its book stands anywhere
    expect(sectionHits('In John 3 the new birth.', bible, { book: 1 }, [])[0].hits.map(h => h.verse)).toEqual([verseId(43, 3, 0)])
  })
  it(`gives a section on at most ${SECTION_CHAPTERS} chapters a row on each, from its first paragraph`, () => {
    const text = 'The new birth, and the woman at the well.\n\nNicodemus comes by night.'
    const [first, second] = sectionHits(text, bible, { book: 43 }, [[43, 3, 1, 4, 42]])
    expect(first.hits).toEqual([verseId(43, 3, 0), verseId(43, 4, 0)].map(verse => ({ verse, mention: 'chapter', start: 0, end: 0 })))
    expect(second.hits).toEqual([])
    // a chapter it names itself keeps the reference
    const [named] = sectionHits('See John 4, the well.', bible, { book: 43 }, [[43, 3, 1, 4, 42]])
    expect(named.hits).toEqual([{ verse: verseId(43, 4, 0), mention: 'chapter', start: 4, end: 10 }, { verse: verseId(43, 3, 0), mention: 'chapter', start: 0, end: 0 }])
    // a section on a whole book is on no chapter in particular
    expect(sectionHits(text, bible, { book: 1 }, [[1, 1, 1, 50, 0]])[0].hits).toEqual([])
    expect(sectionHits(text, bible, { book: 1 }, [[1, 1, 1, SECTION_CHAPTERS + 1, 0]])[0].hits).toEqual([])
  })
  it('reads the verse markers of Darby’s Notes and Comments, and the paragraphs after one as on its verses', () => {
    const text = [
      'Up to this chapter all was nature.',
      '—16. The gift of the Son.',
      'More on the gift.',
      'And more; see verse 17.',
      'A third paragraph after it: the writer has moved on.',
      '—16, 17. The world saved.',
      '14–15. Lifted up.',
      '1. Nicodemus comes by night.',
      '40. A verse the chapter does not have.',
      'Nothing here.',
      `—1–${RANGE_CAP + 1}. Too many.`,
    ].join('\n\n')
    const paras = sectionHits(text, bible, { book: 43, chapter: 3 }, [[43, 3, 1, 3, 0]], 'notes')
    const of = (i: number) => paras[i].hits.filter(h => h.verse % 1000).map(h => [h.verse % 1000, h.mention, h.start, h.end])
    // before the first marker, nothing
    expect(of(0)).toEqual([])
    expect(of(1)).toEqual([[16, 'verse', 1, 3]])
    // the MARKER_RUN paragraphs after a marker are on its verse, beside what they name themselves
    expect(MARKER_RUN).toBe(2)
    expect(of(2)).toEqual([[16, 'range', 0, 0]])
    expect(of(3)).toEqual([[17, 'verse', 14, 22], [16, 'range', 0, 0]])
    expect(of(4)).toEqual([])
    expect(of(5)).toEqual([[16, 'range', 1, 7], [17, 'range', 1, 7]])
    expect(of(6)).toEqual([[14, 'range', 0, 5], [15, 'range', 0, 5]])
    expect(of(7)).toEqual([[1, 'verse', 0, 1]])
    // a verse John 3 does not have: no marker's verses, and the run of verse 1 ends
    expect(of(8)).toEqual([])
    expect(of(9)).toEqual([])
    expect(of(10)).toEqual([])
  })
  it('reads no verse markers outside the Notes and Comments, nor in a section on several chapters', () => {
    const text = '1. The work of faith.\n\n2. The labour of love.'
    const verses = (kind: 'notes' | 'outline' | 'addresses', home: { book: number; chapter?: number }) =>
      sectionHits(text, bible, home, [[43, 3, 1, 3, 0]], kind).map(p => p.hits.filter(h => h.verse % 1000).map(h => h.verse))
    expect(verses('notes', { book: 43, chapter: 3 })).toEqual([[verseId(43, 3, 1)], [verseId(43, 3, 2)]])
    expect(verses('outline', { book: 43, chapter: 3 })).toEqual([[], []])
    expect(verses('addresses', { book: 43, chapter: 3 })).toEqual([[], []])
    expect(verses('notes', { book: 43 })).toEqual([[], []])
  })
  it('caps ranges: a long range names no verse', () => {
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
    expect(hitsOf('Verses 16–17 are the gift and its end.', { book: 43, chapter: 3 })).toEqual({ [J316]: 'range', [J317]: 'range' })
    expect(hitsOf('Verse 17 is its end.', { book: 43, chapter: 3 })).toEqual({ [J317]: 'verse' })
    // with no home, as "verse 17" does, against the reference just before
    expect(hitsOf('See John 3:16. Verse 17 is its end.')).toEqual({ [J316]: 'verse', [J317]: 'verse' })
    const text = 'Chapter 3 opens the new birth.\n\nThen verse 16, the gift.'
    const [, second] = sectionHits(text, bible, { book: 43 }, [[43, 3, 1, 4, 0]])
    expect(second.hits.map(h => h.verse)).toEqual([J316])
  })
  it('in a section on several chapters, a bare “(v. 16)” is in its first chapter until another of its chapters is named', () => {
    // as Darby's Hints on the book of Genesis walks Genesis 1–50: "The word “created” (v. 1)" is Genesis 1:1
    const text = [
      'The word “gave” (v. 16) is the gift.',
      'Chapter 4 is the well.',
      'Then (v. 16) the water.',
      // a chapter outside the section's passage is a glance away
      'Compare John 5:1, a feast.',
      'Then (v. 17) again.',
    ].join('\n\n')
    const verses = sectionHits(text, bible, { book: 43 }, [[43, 3, 1, 4, 54]]).map(p => p.hits.filter(h => h.verse % 1000).map(h => h.verse))
    expect(verses).toEqual([[J316], [], [verseId(43, 4, 16)], [], [verseId(43, 4, 17)]])
    // a quotation the writer gives only the number of is of the verse with that number holding its words (Coates on
    // Ezra: “The silver is mine, and the gold is mine, saith the Lord of hosts” (verse 8) is Haggai 2:8)
    const quoting = (s: string) => sectionHits(s, bible, { book: 43 }, [[43, 4, 1, 4, 54]])[0].hits.filter(h => h.verse % 1000).map(h => [h.verse, h.mention])
    expect(quoting('“God so loved the world, that he gave his only-begotten Son” (v. 16).')).toEqual([[J316, 'quote']])
    expect(quoting('“All things work together for good,” verse 28.')).toEqual([[R828, 'quote']])
    // a verse with another number, or words the verse in hand has as much as any, leave it there
    expect(quoting('“God so loved the world” (v. 17).')).toEqual([[verseId(43, 4, 17), 'verse']])
    expect(quoting('“verse 16 of this chapter” (v. 16).')).toEqual([[verseId(43, 4, 16), 'quote']])
    // a book's introduction, with no passage of its own, has no chapter in hand until it names one
    expect(sectionHits('Then (v. 16) the water.', bible, { book: 43 }, [])[0].hits).toEqual([])
    expect(sectionHits('In chapter 3 (v. 16) the gift.', bible, { book: 43 }, [])[0].hits.map(h => h.verse)).toEqual([verseId(43, 3, 0), J316])
  })
  it('ranks by mention, then the passage in hand, then fewer references', () => {
    expect(rankOf('quote', false, 50)).toBeLessThan(rankOf('verse', true, 1))
    expect(rankOf('verse', false, 50)).toBeLessThan(rankOf('range', true, 1))
    expect(rankOf('range', false, 999)).toBeLessThan(rankOf('list', true, 20))
    // a figure's row of references stays in the list class, before every chapter row
    expect(mentionOfRank(ROW_RANK + 999_000)).toBe('list')
    expect(ROW_RANK + 999_000).toBeLessThan(rankOf('chapter', true, 1))
    expect(rankOf('verse', true, 9)).toBeLessThan(rankOf('verse', false, 1))
    expect(rankOf('verse', false, 2)).toBeLessThan(rankOf('verse', false, 3))
    expect(MENTIONS).toEqual(['quote', 'verse', 'range', 'list', 'chapter'])
    for (const m of MENTIONS) for (const on of [true, false]) expect(mentionOfRank(rankOf(m, on, 5000))).toBe(m)
    expect(rankOf('chapter', false, 5000)).toBeLessThan(2 ** 31)
    expect(onPassage([[43, 3, 1, 3, 0]], J316)).toBe(true)
    expect(onPassage([[43, 3, 1, 3, 15]], J316)).toBe(false)
    expect(onPassage([[43, 2, 1, 3, 16]], J316)).toBe(true)
    // the whole chapter: any passage in it
    expect(onPassage([[43, 3, 16, 3, 20]], verseId(43, 3, 0))).toBe(true)
    expect(onPassage([[43, 2, 1, 2, 0]], verseId(43, 3, 0))).toBe(false)
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
