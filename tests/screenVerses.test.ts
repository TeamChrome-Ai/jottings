import { describe, it, expect } from 'vitest'
import { chapterShape, versesBetween } from '../client/src/lib/screenVerses'
import { endLine, verseList, END_WORDS } from '../client/src/lib/chapterEnd'

describe('the verses on screen', () => {
  // a title of 200, then three paragraphs: verses 1-3 (measured starts), 4-5 (none measured), 6 alone
  const paras = [
    { index: 0, y: 200, height: 300, firstVerse: 1, lastVerse: 3 },
    { index: 1, y: 500, height: 200, firstVerse: 4, lastVerse: 5 },
    { index: 2, y: 700, height: 100, firstVerse: 6, lastVerse: 6 },
  ]
  const marks = new Map([[2, { index: 0, y: 100 }], [3, { index: 0, y: 250 }]])
  it('are those any part of which lies between the two offsets', () => {
    expect(versesBetween(paras, marks, 0, 250)).toEqual([1, 1])
    expect(versesBetween(paras, marks, 0, 301)).toEqual([1, 2])
    expect(versesBetween(paras, marks, 460, 640)).toEqual([3, 5])
    expect(versesBetween(paras, marks, 650, 2000)).toEqual([5, 6])
    expect(versesBetween(paras, marks, 900, 2000)).toBeNull()
  })
  it('place a verse not yet measured by its share of the paragraph', () => {
    // verse 5 starts halfway down its paragraph, at 600
    expect(versesBetween(paras, new Map(), 0, 600)).toEqual([1, 4])
    expect(versesBetween(paras, new Map(), 601, 602)).toEqual([5, 5])
  })
})

describe('a chapter shape', () => {
  it('weighs each verse by its words, and by the recording playing where it times one', () => {
    const verses = [{ v: 1, t: 'Jesus wept.' }, { v: 2, t: 'Praise ye Jah!' }]
    expect(chapterShape(verses, null)).toEqual({ verses: [1, 2], words: [2, 3], audioMs: undefined })
    const marks = { voice: 'alec', book: 43, chapter: 11, duration: 4000, heading: null, verses: [{ v: 1, start: 800, end: 1900, words: [] }, { v: 2, start: 2000, end: 2000, words: [] }] }
    expect(chapterShape(verses, marks).audioMs).toEqual([1100, null])
  })
})

describe('the end line names what is still to read', () => {
  const path = { onPath: false, byCredit: false, byMark: false }
  it('as verse numbers, first of all', () => {
    expect(verseList([[9, 9]])).toBe('Verse 9')
    expect(verseList([[9, 14]])).toBe('Verses 9–14')
    expect(verseList([[3, 3], [9, 14], [20, 20]])).toBe('Verses 3, 9–14 and 20')
    expect(verseList([[1, 1], [3, 3], [5, 5], [7, 8]])).toBe('Verses 1, 3, 5 and others')
    const l = endLine({ credited: false, marked: false, path, gaps: [[9, 14]] })
    expect(l).toEqual({ kind: 'open', toRead: 'Verses 9–14', firstGap: 9 })
    expect(END_WORDS.toRead('Verses 9–14')).toBe('Verses 9–14 still to read')
  })
  it('and nothing but the mark once nothing is, credited or not', () => {
    expect(endLine({ credited: false, marked: false, path, gaps: [] })).toEqual({ kind: 'open', toRead: null, firstGap: null })
    expect(endLine({ credited: true, marked: false, path, gaps: [[1, 2]] })).toEqual({ kind: 'read' })
  })
})
