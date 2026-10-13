import { describe, it, expect } from 'vitest'
import { parseRef, formatRef, formatVerseRuns, scanRefs, looksLikeRef, bareBook } from '../shared/ref'
import { findBookFuzzy, editDistance } from '../shared/books'
import { findBook } from '../shared/books'

describe('findBook', () => {
  it('resolves names, abbreviations and aliases', () => {
    expect(findBook('Genesis')?.n).toBe(1)
    expect(findBook('gen')?.n).toBe(1)
    expect(findBook('jn')?.n).toBe(43)
    expect(findBook('1 cor')?.n).toBe(46)
    expect(findBook('1cor')?.n).toBe(46)
    expect(findBook('I John')?.n).toBe(62)
    expect(findBook('song of solomon')?.n).toBe(22)
    expect(findBook('Phil')?.n).toBe(50)
    expect(findBook('Phlm')?.n).toBe(57)
    expect(findBook('rev')?.n).toBe(66)
    expect(findBook('xyz')).toBeUndefined()
  })
})

describe('parseRef', () => {
  it('parses chapter, verse and ranges', () => {
    expect(parseRef('jn 3:16')).toEqual({ book: 43, chapter: 3, v1: 16 })
    expect(parseRef('John 3.16')).toEqual({ book: 43, chapter: 3, v1: 16 })
    expect(parseRef('1 cor 13:4-7')).toEqual({ book: 46, chapter: 13, v1: 4, v2: 7 })
    expect(parseRef('ps 23')).toEqual({ book: 19, chapter: 23 })
    expect(parseRef('Psalm 119:105')).toEqual({ book: 19, chapter: 119, v1: 105 })
    expect(parseRef('jude 3')).toEqual({ book: 65, chapter: 1, v1: 3 })
    expect(parseRef('rev')).toEqual({ book: 66, chapter: 1 })
  })
  it('rejects nonsense', () => {
    expect(parseRef('gen 51')).toBeNull()
    expect(parseRef('love')).toBeNull()
    expect(parseRef('jn 3:20-16')).toBeNull()
  })
  it('bareBook is a book name with no chapter or verse (bare_book in rs/src/refparse.rs)', () => {
    for (const [q, n] of [['song', 22], ['Mark', 41], ['1 kings', 11], ['song of solomon', 22], ['sos', 22], ['first john', 62], [' gen. ', 1]] as const) expect(bareBook(q)?.n, q).toBe(n)
    for (const q of ['song 2', 'song 2:1', 'song of solomon 2', 'jn 3:16', '1 kings 8', 'jude 3', 'love', 'kings']) expect(bareBook(q), q).toBeUndefined()
  })
  it('looksLikeRef gates free text', () => {
    expect(looksLikeRef('jn 3:16')).toBe(true)
    expect(looksLikeRef('faith hope love')).toBe(false)
    expect(looksLikeRef('loving-kindness')).toBe(false)
  })
})

describe('formatRef / scanRefs', () => {
  it('formats single-chapter books without a chapter', () => {
    expect(formatRef({ book: 57, chapter: 1, v1: 3 })).toBe('Philemon 3')
    expect(formatRef({ book: 43, chapter: 3, v1: 16, v2: 18 }, 'abbr')).toBe('John 3:16-18')
  })
  it('finds references inside prose', () => {
    const refs = scanRefs('Compare John 3:16 with 1 John 4:9-10 and Psalm 23; Gen 1 too.')
    expect(refs.map(r => [r.ref.book, r.ref.chapter, r.ref.v1, r.ref.v2])).toEqual([[43, 3, 16, undefined], [62, 4, 9, 10], [19, 23, undefined, undefined], [1, 1, undefined, undefined]])
  })
  const flat = (s: string, ctx?: { book: number; chapter: number }) => scanRefs(s, ctx).map(r => `${s.slice(r.start, r.end)}=${r.ref.book}.${r.ref.chapter}${r.ref.v1 !== undefined ? ':' + r.ref.v1 : ''}${r.ref.v2 !== undefined ? '-' + r.ref.v2 : ''}`)
  it('carries the book into bare chapter.verse continuations (Darby note style)', () => {
    expect(flat("see Gen 9:26 and 24.7. Other names: see Ex 3:14,15; Isa 40:28.")).toEqual(['Gen 9:26=1.9:26', '24.7=1.24:7', 'Ex 3:14=2.3:14', '15=2.3:15', 'Isa 40:28=23.40:28'])
    expect(flat("Lit. 'bondmen:' so chs. 6:12; 7.8; 8.14; and elsewhere.", { book: 2, chapter: 21 })).toEqual(['chs. 6:12=2.6:12', '7.8=2.7:8', '8.14=2.8:14'])
  })
  it('resolves ch. and ver. against the chapter the note sits in', () => {
    expect(flat("'Lest perhaps:' see ch. 5:25 and Mark 4:12.", { book: 40, chapter: 13 })).toEqual(['ch. 5:25=40.5:25', 'Mark 4:12=41.4:12'])
    expect(flat('i.e. Judah: see ver. 15.', { book: 1, chapter: 49 })).toEqual(['ver. 15=1.49:15'])
    expect(flat("Or 'plaited-work:' so vers. 13,14,25, and ch. 39:6,13,16,18; Ps 45:13.", { book: 2, chapter: 28 })).toEqual(['vers. 13=2.28:13', '14=2.28:14', '25=2.28:25', 'ch. 39:6=2.39:6', '13=2.39:13', '16=2.39:16', '18=2.39:18', 'Ps 45:13=19.45:13'])
    expect(flat('as ch. 11:11.', { book: 66, chapter: 13 })).toEqual(['ch. 11:11=66.11:11'])
    expect(flat('see ver. 15', undefined)).toEqual([])
  })
  it('does not link loose numbers', () => {
    expect(flat('There were 12 baskets, 5 loaves and 2 fish; 3.14 is pi.')).toEqual([])
    expect(flat('Adamah, soil: as Deut 26:2; in ver. 12 it is erets.', { book: 1, chapter: 2 })).toEqual(['Deut 26:2=5.26:2', 'ver. 12=1.2:12'])
  })
})


describe('misspelt book names', () => {
  it('measures swaps as one edit', () => {
    expect(editDistance('jhon', 'john')).toBe(1)
    expect(editDistance('pslams', 'psalms')).toBe(1)
    expect(editDistance('galations', 'galatians')).toBe(1)
  })
  it('finds the intended book for common typos', () => {
    expect(findBookFuzzy('Jhon')?.name).toBe('John')
    expect(findBookFuzzy('Pslams')?.name).toBe('Psalms')
    expect(findBookFuzzy('Galations')?.name).toBe('Galatians')
    expect(findBookFuzzy('Revalation')?.name).toBe('Revelation')
    expect(findBookFuzzy('Mathew')?.name).toBe('Matthew')
    expect(findBookFuzzy('Ecclesiates')?.name).toBe('Ecclesiastes')
    expect(findBookFuzzy('1 Corinthans')?.name).toBe('1 Corinthians')
  })
  it('does not guess from short or unrelated words', () => {
    expect(findBookFuzzy('god')).toBeUndefined()
    expect(findBookFuzzy('lord')).toBeUndefined()
    expect(findBookFuzzy('shepherd')).toBeUndefined()
  })
  it('parses a misspelt reference only when asked', () => {
    expect(parseRef('Jhon 3:16')).toBeNull()
    expect(parseRef('Jhon 3:16', { fuzzy: true })).toEqual({ book: 43, chapter: 3, v1: 16 })
    expect(parseRef('pslam 23', { fuzzy: true })).toEqual({ book: 19, chapter: 23 })
  })
})

it('v separates chapter and verse like a colon', () => {
  expect(parseRef('jn 3v16')).toEqual({ book: 43, chapter: 3, v1: 16 })
  expect(parseRef('Lev 3 v 4-6')).toEqual({ book: 3, chapter: 3, v1: 4, v2: 6 })
  expect(parseRef('rev')).toEqual({ book: 66, chapter: 1 })
})

describe('formatVerseRuns', () => {
  it('compresses every run, not just the first', () => {
    expect(formatVerseRuns(1, 1, [1, 2, 4, 5])).toBe('Genesis 1:1-2, 4-5')
    expect(formatVerseRuns(1, 1, [1, 2, 4, 5], 'abbr')).toBe('Gen 1:1-2, 4-5')
    expect(formatVerseRuns(1, 1, [1, 2, 3, 7, 9, 10, 11])).toBe('Genesis 1:1-3, 7, 9-11')
  })
  it('handles single verses, one run and unsorted or repeated input', () => {
    expect(formatVerseRuns(43, 3, [16])).toBe('John 3:16')
    expect(formatVerseRuns(43, 3, [16, 17, 18])).toBe('John 3:16-18')
    expect(formatVerseRuns(43, 3, [18, 16, 17, 16, 20])).toBe('John 3:16-18, 20')
    expect(formatVerseRuns(43, 3, [1, 3, 5])).toBe('John 3:1, 3, 5')
  })
  it('names the chapter when nothing is selected and drops the chapter for one-chapter books', () => {
    expect(formatVerseRuns(19, 23, [])).toBe('Psalms 23')
    expect(formatVerseRuns(65, 1, [3, 4, 6])).toBe('Jude 3-4, 6')
  })
})
