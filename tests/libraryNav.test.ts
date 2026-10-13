import { describe, it, expect } from 'vitest'
import type { CompanionIndex } from '../shared/companion'
import type { CollectionSummary, Library, MinistrySectionMeta } from '../shared/ministry'
import {
  POSITIONS_KEPT, TOUCH_MS, bookOfTitle, cellLabel, collectionDetail, contentsFromIndex, contentsHeading, countOf, formatFrom, fromLabel, fromRef, headingLine, landing, latestPosition,
  letterLine, libraryFromCompanion, neighbourOf, opensToContents, pageIndex, paragraphAt, parseFrom, parsePositions, pickerLayout, readerLink, rememberPosition,
  newSectionHits, searchWorks, sectionHitDetail, shelfItems, shelfOf, shortTitle, toolbarTitle, worksAreBooks, worksNoun, yearOf, type Positions,
} from '../client/src/lib/libraryNav'
import type { SectionHit } from '../shared/ministry'

const s = (title: string, extra: Partial<MinistrySectionMeta> = {}): MinistrySectionMeta => ({ title, passages: [], ...extra })

// shaped like data/synopsis/index.json and data/coates/index.json
const darby: CompanionIndex = { author: 'darby', works: [
  { id: 'introduction', title: 'Preface and introduction', kind: 'introduction', sections: [s('Preface', { part: 'Volume 1' }), s('Introduction', { part: 'Volume 1' })] },
  { id: 'genesis', title: 'Genesis', kind: 'outline', sections: [s('Introduction'), s('Genesis 1', { passages: [[1, 1, 1, 1, 0]] }), s('Genesis 2', { passages: [[1, 2, 1, 2, 0]] }), s('Genesis 6–8', { passages: [[1, 6, 1, 8, 0]] })] },
  { id: 'exodus', title: 'Exodus', kind: 'outline', sections: [s('Introduction'), s('Exodus 1–2', { passages: [[2, 1, 1, 2, 0]] })] },
  { id: 'matthew', title: 'Matthew', kind: 'outline', sections: [s('Introduction'), s('Matthew 1', { passages: [[40, 1, 1, 1, 0]] })] },
] }
const coates: CompanionIndex = { author: 'coates', works: [
  { id: 'genesis', title: 'An Outline of Genesis', kind: 'outline', sections: [s('Prefatory note'), s('Chapter 1', { passages: [[1, 1, 1, 1, 0]] }), s('Chapter 2'), s('Chapters 5, 6')] },
  { id: 'romans', title: 'An Outline of the Epistle to the Romans', kind: 'outline', sections: [s('Chapter 1')] },
  { id: 'believer-established', title: 'The Believer Established', kind: 'addresses', sections: [s('The believer established', { passages: [[45, 15, 13, 15, 13]] }), s('Three scenes of judgment'), s('Devotedness')] },
] }
const letters = (n: number, year = (i: number) => 1840 + Math.floor(i / 3)): MinistrySectionMeta[] =>
  Array.from({ length: n }, (_, i) => s(`Letter ${i + 1}`, { date: `${i + 1} March ${year(i)}`, to: i % 2 ? 'G. V. Wigram' : 'To Mr. B.', subtitle: 'The church; the Lord’s coming' }))

describe('the library the app falls back on', () => {
  const lib = libraryFromCompanion([darby, coates])
  it('the Synopsis is one collection, Coates has his Outlines and each other work', () => {
    expect(lib.authors.map(a => a.id)).toEqual(['darby', 'coates'])
    expect(lib.authors[0].collections.map(c => [c.id, c.works.length])).toEqual([['synopsis', 4]])
    expect(lib.authors[1].collections.map(c => [c.id, c.title, c.works.map(w => w.id)])).toEqual([
      ['outlines', 'Outlines', ['genesis', 'romans']],
      ['believer-established', 'The Believer Established', ['believer-established']],
    ])
    expect(lib.authors[1].collections[1].works[0]).toEqual({ id: 'believer-established', title: 'The Believer Established', kind: 'addresses', count: 3 })
  })
  it('the source is the companion’s own credit', () => {
    expect(lib.authors[0].source).toMatch(/Synopsis/)
    expect(lib.authors[0]).toMatchObject({ name: 'J. N. Darby', short: 'Darby', born: 1800, died: 1882 })
  })
  it('a companion work’s contents come from its index', () => {
    const c = contentsFromIndex(coates, 'believer-established', 'believer-established')!
    expect(c.work).toEqual({ id: 'believer-established', title: 'The Believer Established', kind: 'addresses', collection: 'believer-established' })
    expect(c.sections.map(x => x.title)).toEqual(['The believer established', 'Three scenes of judgment', 'Devotedness'])
    expect(contentsFromIndex(coates, 'nope')).toBeNull()
  })
  it('collection lines', () => {
    expect(collectionDetail(lib.authors[0].collections[0])).toBe('3 books, Genesis to Matthew')
    expect(collectionDetail(lib.authors[1].collections[0], 'coates')).toBe('2 books, Genesis to Romans')
    expect(collectionDetail(lib.authors[1].collections[1], 'coates')).toBe('3 addresses')
    const cw: CollectionSummary = { id: 'cw', title: 'Collected Writings', works: [1, 2].map(i => ({ id: `cw${i}`, title: `Volume ${i}: Ecclesiastical`, kind: 'papers' as const, count: 40 })) }
    expect(collectionDetail(cw)).toBe('2 volumes')
    expect(collectionDetail({ id: 'l', title: 'Letters', works: [{ id: 'l1', title: 'Letters, volume 1', kind: 'letters', count: 1 }] })).toBe('1 letter')
  })
})

describe('where a work sits and what a turn brings in', () => {
  const lib = libraryFromCompanion([darby, coates])
  const shelf = shelfOf(lib, 'darby', 'genesis')!
  it('finds the work’s collection and place', () => {
    expect(shelf.collection.id).toBe('synopsis')
    expect(shelf.at).toBe(1)
    expect(shelfOf(lib, 'coates', 'believer-established')!.collection.id).toBe('believer-established')
    expect(shelfOf(lib, 'kelly', 'x')).toBeNull()
    expect(shelfOf(null, 'darby', 'genesis')).toBeNull()
  })
  it('turns within a work', () => {
    expect(neighbourOf(shelf, 'genesis', 2, 4, 1)).toEqual({ work: 'genesis', n: 3 })
    expect(neighbourOf(shelf, 'genesis', 2, 4, -1)).toEqual({ work: 'genesis', n: 1 })
  })
  it('turns across works as Genesis 50 turns to Exodus 1, and back to the end of the one before', () => {
    expect(neighbourOf(shelf, 'genesis', 4, 4, 1)).toEqual({ work: 'exodus', n: 1 })
    expect(neighbourOf(shelfOf(lib, 'darby', 'exodus'), 'exodus', 1, 2, -1)).toEqual({ work: 'genesis', n: 4 })
    // the prefaces come before Genesis
    expect(neighbourOf(shelf, 'genesis', 1, 4, -1)).toEqual({ work: 'introduction', n: 2 })
  })
  it('stops at the ends of the collection, and within the work when it is not known', () => {
    expect(neighbourOf(shelfOf(lib, 'darby', 'matthew'), 'matthew', 2, 2, 1)).toBeNull()
    expect(neighbourOf(shelfOf(lib, 'darby', 'introduction'), 'introduction', 1, 2, -1)).toBeNull()
    expect(neighbourOf(null, 'genesis', 4, 4, 1)).toBeNull()
  })
  it('pages of a collection are in one order', () => {
    expect(pageIndex(1, 4) + 1).toBeLessThan(pageIndex(2, 1) + 1)
    expect(pageIndex(2, 1) - pageIndex(1, 4)).toBeGreaterThan(0)
  })
})

describe('titles', () => {
  it('short titles', () => {
    expect(shortTitle('An Outline of the Epistle to the Romans')).toBe('Romans')
    expect(shortTitle('An Outline of Genesis')).toBe('Genesis')
    expect(shortTitle('“Daily”')).toBe('Daily')
  })
  it('the book a work walks through, and its chip', () => {
    expect(bookOfTitle('Genesis')).toMatchObject({ label: 'Gen', book: { n: 1 } })
    expect(bookOfTitle('1 and 2 Kings')).toMatchObject({ label: '1–2 Kgs', book: { n: 11 } })
    expect(bookOfTitle('The Lamentations of Jeremiah')).toMatchObject({ label: 'Lam' })
    expect(bookOfTitle('The Acts of the Apostles')).toMatchObject({ label: 'Acts' })
    expect(bookOfTitle('The Song of Songs')).toMatchObject({ label: 'Song' })
    expect(bookOfTitle('An Outline of the Epistle to the Romans')).toMatchObject({ label: 'Rom' })
    expect(bookOfTitle('Preface and introduction')).toBeNull()
    expect(bookOfTitle('Volume 1: Ecclesiastical')).toBeNull()
    expect(bookOfTitle('Letters, volume 1')).toBeNull()
  })
  it('a collection is books when its walks are', () => {
    const lib = libraryFromCompanion([darby, coates])
    expect(worksAreBooks(lib.authors[0].collections[0].works)).toBe(true)
    expect(worksNoun(lib.authors[0].collections[0].works)).toBe('books')
    expect(worksNoun([{ title: 'Volume 1', kind: 'papers' }, { title: 'Volume 2', kind: 'papers' }])).toBe('volumes')
  })
  it('the heading’s small line leaves out a collection the work already names', () => {
    expect(headingLine('Synopsis', 'Genesis')).toBe('Synopsis · Genesis')
    expect(headingLine('Synopsis of the Books of the Bible', 'Genesis')).toBe('Synopsis · Genesis')
    expect(headingLine('Outlines', 'An Outline of Genesis')).toBe('An Outline of Genesis')
    expect(headingLine('Letters', 'Letters, volume 1')).toBe('Letters, volume 1')
    expect(headingLine('Collected Writings', 'Volume 1: Ecclesiastical', 'The Church of God')).toBe('Collected Writings · Volume 1: Ecclesiastical · The Church of God')
    expect(headingLine('The Believer Established', 'The Believer Established')).toBe('The Believer Established')
    expect(headingLine(undefined, 'Genesis')).toBe('Genesis')
  })
  it('the toolbar’s title', () => {
    const cg = { title: 'An Outline of Genesis', kind: 'outline' as const }
    expect(toolbarTitle(cg, s('Chapter 3'), 4)).toBe('Genesis 3')
    expect(toolbarTitle(cg, s('Chapters 5, 6'), 6)).toBe('Genesis 5, 6')
    expect(toolbarTitle(cg, s('Prefatory note'), 1)).toBe('Genesis · Prefatory note')
    expect(toolbarTitle({ title: 'Genesis', kind: 'outline' }, s('Genesis 6–8'), 4)).toBe('Genesis 6–8')
    expect(toolbarTitle({ title: 'The Revelation', kind: 'outline' }, s('Introduction'), 1)).toBe('Revelation · Introduction')
    expect(toolbarTitle({ title: 'The Believer Established', kind: 'addresses' }, s('Devotedness'), 4)).toBe('Devotedness')
    expect(toolbarTitle({ title: 'Letters, volume 1', kind: 'letters' }, s('x'), 12)).toBe('Letter 12')
    expect(toolbarTitle({ title: 'Preface and introduction', kind: 'introduction' }, s('Preface'), 1)).toBe('Preface')
    expect(toolbarTitle({ title: 'Genesis', kind: 'outline' }, undefined, 1)).toBe('Genesis')
  })
  it('a letter is named by its recipient and date', () => {
    expect(letterLine(s('Letter 3', { to: 'G. V. Wigram', date: '12 March 1845' }))).toBe('To G. V. Wigram · 12 March 1845')
    expect(letterLine(s('Letter 3', { to: 'To Mr. B.' }))).toBe('To Mr. B.')
    expect(letterLine(s('Letter 3'))).toBe('Letter 3')
    expect(yearOf('Pau, 1st March, 1863')).toBe('1863')
    expect(yearOf('undated')).toBe('')
  })
})

describe('the contents picker', () => {
  it('cells for numbered sections, chips for titled pieces', () => {
    expect(cellLabel('Chapter 3', 'outline', 4)).toBe('3')
    expect(cellLabel('Chapters 5, 6', 'outline', 6)).toBe('5, 6')
    expect(cellLabel('Genesis 6–8', 'outline', 5)).toBe('6–8')
    expect(cellLabel('1 Samuel 3', 'outline', 5)).toBe('3')
    expect(cellLabel('Psalms 9-10', 'outline', 5)).toBe('9–10')
    expect(cellLabel('Colossians 1:24–2:10', 'outline', 5)).toBe('1:24–2:10')
    expect(cellLabel('Book 1', 'outline', 5)).toBeNull()
    expect(cellLabel('Introduction', 'outline', 1)).toBeNull()
    expect(cellLabel('Devotedness', 'addresses', 4)).toBeNull()
    expect(cellLabel('The 144000', 'papers', 4)).toBeNull()
    expect(cellLabel('anything', 'letters', 12)).toBe('12')
  })
  it('a walk through a book is a grid, its introduction a chip in its place', () => {
    const l = pickerLayout('outline', coates.works[0].sections)
    expect(l.mode).toBe('grid')
    expect(l.groups).toHaveLength(1)
    expect(l.groups[0].items.map(i => [i.cell, i.numbered])).toEqual([['Prefatory note', false], ['1', true], ['2', true], ['5, 6', true]])
    expect(l.groups[0].items[1].n).toBe(2)
  })
  it('titled pieces are a list, grouped under their part where a part has several sections', () => {
    const cw = [s('Preface'), s('Chapter 1', { part: 'The Church of God' }), s('Chapter 2', { part: 'The Church of God' }), s('On worship', { part: 'On worship' }), s('The rapture', { part: 'Prophetic papers', passages: [[52, 4, 13, 4, 18]] }), s('The beast', { part: 'Prophetic papers', subtitle: 'Revelation 13' })]
    const l = pickerLayout('papers', cw)
    expect(l.mode).toBe('list')
    expect(l.groups.map(g => [g.label, g.items.map(i => i.n)])).toEqual([['', [1]], ['The Church of God', [2, 3]], ['', [4]], ['Prophetic papers', [5, 6]]])
    expect(l.groups[3].items[0].detail).toBe('1 Thessalonians 4:13–18')
    expect(l.groups[3].items[1].detail).toBe('Revelation 13')
  })
  it('numbered chapters of several papers are a grid grouped by paper', () => {
    const cw = [s('Chapter 1', { part: 'The Church of God' }), s('Chapter 2', { part: 'The Church of God' }), s('On worship', { part: 'On worship' }), s('Chapter 1', { part: 'Prophetic papers' }), s('Chapter 2', { part: 'Prophetic papers' })]
    const l = pickerLayout('papers', cw)
    expect(l.mode).toBe('grid')
    expect(l.groups.map(g => [g.label, g.items.map(i => i.cell)])).toEqual([['The Church of God', ['1', '2']], ['', ['On worship']], ['Prophetic papers', ['1', '2']]])
    expect(toolbarTitle({ title: 'Volume 1: Ecclesiastical No. 1', kind: 'papers' }, cw[1], 2)).toBe('The Church of God · Chapter 2')
    expect(toolbarTitle({ title: 'Volume 1', kind: 'papers' }, s('Chapter 4'), 4)).toBe('Chapter 4')
  })
  it('a row loses the group label it repeats; a bare number left is the work’s unit', () => {
    const nj = [
      s('Ryde meeting'),
      s('Detached memoranda from a reading meeting: The world seeth me no more', { part: 'Detached memoranda from a reading meeting' }),
      s('Detached memoranda from a reading meeting: the flesh', { part: 'Detached memoranda from a reading meeting' }),
      s('Lecture — Luke 12:35–53', { part: 'Lecture', passages: [[42, 12, 35, 12, 53]] }),
      s('Lecture — Luke 12:35–48', { part: 'Lecture', passages: [[42, 12, 35, 12, 48]] }),
      s('Readings on Numbers: 1', { part: 'Readings on Numbers', passages: [[4, 1, 1, 36, 0]] }),
      s('Readings on Numbers: 2', { part: 'Readings on Numbers', passages: [[4, 1, 1, 36, 0]] }),
      s('Reading on Ephesians 3', { passages: [[49, 3, 1, 3, 0]] }),
    ]
    const l = pickerLayout('notes', nj, 'darby')
    expect(l.mode).toBe('list')
    expect(l.groups.map(g => [g.label, g.items.map(i => [i.title, i.detail])])).toEqual([
      ['', [['Ryde meeting', '']]],
      ['Detached memoranda from a reading meeting', [['The world seeth me no more', ''], ['The flesh', '']]],
      ['Lecture', [['Luke 12:35–53', ''], ['Luke 12:35–48', '']]],
      // the whole of Numbers under "Readings on Numbers" adds nothing
      ['Readings on Numbers', [['Reading 1', ''], ['Reading 2', '']]],
      ['', [['Reading on Ephesians 3', '']]],
    ])
    // the section's own title is untouched: the reader and its toolbar keep it
    expect(nj[1].title).toBe('Detached memoranda from a reading meeting: The world seeth me no more')
    // a paper's unit; a list of chapters; the passage is read against the row as shown, so "John 1" stays under "Section 1"
    const cw = [s('On the Gospel of John: Introduction', { part: 'On the Gospel of John', passages: [[43, 1, 1, 21, 0]] }), s('On the Gospel of John 1', { part: 'On the Gospel of John', passages: [[43, 1, 1, 1, 0]] }), s('On the Epistle to the Romans 1 and 2', { part: 'On the Epistle to the Romans', passages: [[45, 1, 1, 2, 0]] }), s('On the Epistle to the Romans 3', { part: 'On the Epistle to the Romans', passages: [[45, 3, 1, 3, 0]] })]
    expect(pickerLayout('papers', cw, 'darby').groups.map(g => g.items.map(i => [i.title, i.detail]))).toEqual([[['Introduction', ''], ['Section 1', 'John 1']], [['Sections 1 and 2', 'Romans 1–2'], ['Section 3', 'Romans 3']]])
    // the label as a word's prefix is no repeat ("1 Chronicle" / "1 Chronicles chapter 2"); a title that is the label alone stays as printed
    const nc = [s('1 Chronicles chapter 2', { part: '1 Chronicle' }), s('1 Chronicles chapter 3', { part: '1 Chronicle' }), s('Heads of Psalms', { part: 'Heads of Psalms' }), s('The basket of firstfruits', { part: 'Heads of Psalms' })]
    expect(pickerLayout('notes', nc, 'darby').groups.map(g => [g.label, g.items.map(i => i.title)])).toEqual([['1 Chronicle', ['1 Chronicles chapter 2', '1 Chronicles chapter 3']], ['Heads of Psalms', ['Heads of Psalms', 'The basket of firstfruits']]])
    // a lone row under a label it repeats needs no label, and joins the rows around it
    const lone = [s('Evolution'), s('Nehemiah', { part: 'Nehemiah' }), s('Angels'), s('Nehemiah. Chapter 2', { part: 'Nehemiah' })]
    expect(pickerLayout('notes', lone, 'darby').groups.map(g => [g.label, g.items.map(i => i.title)])).toEqual([['', ['Evolution', 'Nehemiah', 'Angels', 'Chapter 2']]])
    // the grid's chips are left alone
    const grid = [s('Genesis', { part: 'Genesis' }), s('Genesis 2', { part: 'Genesis' }), s('Genesis 3', { part: 'Genesis' })]
    expect(pickerLayout('notes', grid, 'darby').groups[0].items.map(i => i.cell)).toEqual(['Genesis', '2', '3'])
  })
  it('the passage line is left out where the title names it', () => {
    const p = (title: string, passages: MinistrySectionMeta['passages'], part?: string) => pickerLayout('notes', [s(title, { passages, part })], 'darby').groups[0].items[0].detail
    expect(p('Notes of a reading at 3, Lonsdale square: Luke 15', [[42, 15, 1, 15, 0]])).toBe('')
    expect(p('Reading at 3, Lonsdale square; John 11:28-57', [[43, 11, 28, 11, 57]])).toBe('')
    expect(p('Reading at notting hill 1 corinthians 1', [[46, 1, 1, 1, 0]])).toBe('')
    expect(p('Reading on 1 Timothy 1 and 2', [[54, 1, 1, 2, 0]])).toBe('')
    expect(p('Jeremiah. Chapter 51', [[24, 51, 1, 51, 0]])).toBe('')
    expect(p('Notes on Revelation', [[66, 1, 1, 22, 0]])).toBe('')
    expect(p('Obadiah', [[31, 1, 1, 1, 0]])).toBe('')
    expect(p('Notes at Guelph, 1869–1 John 3:4', [[62, 3, 4, 3, 4]])).toBe('')
    // it stays where it adds something: verses, another chapter, a second passage
    expect(p('1 Kings chapter 10 (from C.A.C.’s notes)', [[11, 10, 10, 10, 29]])).toBe('1 Kings 10:10–29')
    expect(p('Notes on Luke 1', [[42, 10, 1, 10, 0]])).toBe('Luke 10')
    expect(p('Further notes on the Revelation', [[66, 1, 1, 22, 0]])).toBe('')
    expect(p('The basket of firstfruits', [[19, 1, 1, 150, 0]])).toBe('Psalms 1–150')
    expect(p('A comparison: Luke 21 with Matthew 24', [[42, 21, 1, 21, 0], [40, 24, 1, 25, 0]])).toBe('Luke 21; Matthew 24–25')
    expect(p('The rapture', [[52, 4, 13, 4, 18]])).toBe('1 Thessalonians 4:13–18')
  })
  it('repeated rows are told apart in the detail', () => {
    const nj = [
      s('As to repentance'), s('The morning Star'), s('As to repentance'),
      s('Reading at 3, Lonsdale square. Hebrews 5', { passages: [[58, 5, 1, 5, 0]] }), s('Reading at 3, Lonsdale square. Hebrews 5', { passages: [[58, 5, 1, 5, 0]] }), s('Reading at 3, Lonsdale square Hebrews 5', { passages: [[58, 5, 1, 5, 0]] }),
      s('Reading meeting held at 3, Lonsdale square. Hebrews 7', { passages: [[58, 7, 1, 7, 0]] }), s('Reading meeting held at 3, Lonsdale square. Hebrews 7', { passages: [[58, 7, 1, 7, 0]] }),
      s('Notes of a reading — 2 Chronicles 6', { passages: [[14, 6, 4, 6, 21]] }), s('Notes of a reading — 2 Chronicles 6', { passages: [[14, 6, 22, 6, 33]] }),
      s('Readings on 1 Peter: 1', { part: 'Readings on 1 Peter' }), s('Readings on 1 Peter: 2', { part: 'Readings on 1 Peter' }), s('Readings on Joshua: 1', { part: 'Readings on Joshua' }), s('Readings on Joshua: 2', { part: 'Readings on Joshua' }),
    ]
    const rows = pickerLayout('notes', nj, 'darby').groups.flatMap(g => g.items.map(i => [i.title, i.detail]))
    expect(rows.slice(0, 3)).toEqual([['As to repentance', ''], ['The morning Star', ''], ['As to repentance', '· 2']])
    // titles as printed, the full stop's absence no difference; a pair side by side is continued
    expect(rows.slice(3, 8).map(r => r[1])).toEqual(['', '· 2', '· 3', '', '(continued)'])
    expect(rows[5][0]).toBe('Reading at 3, Lonsdale square Hebrews 5')
    // rows the detail already tells apart, and the same number under two parts, need no mark
    expect(rows.slice(8)).toEqual([['Notes of a reading — 2 Chronicles 6', '2 Chronicles 6:4–21'], ['Notes of a reading — 2 Chronicles 6', '2 Chronicles 6:22–33'], ['Reading 1', ''], ['Reading 2', ''], ['Reading 1', ''], ['Reading 2', '']])
    // a subtitle keeps its place before the mark
    const sub = [s('Fragment', { subtitle: 'Faith' }), s('Fragment', { subtitle: 'Faith' }), s('Fragment', { subtitle: 'Faith' })]
    expect(pickerLayout('papers', sub).groups[0].items.map(i => i.detail)).toEqual(['Faith', 'Faith · 2', 'Faith · 3'])
    // letters are numbered already
    expect(pickerLayout('letters', letters(4, () => 1850)).groups[0].items.map(i => i.detail)).toEqual(['The church; the Lord’s coming', 'The church; the Lord’s coming', 'The church; the Lord’s coming', 'The church; the Lord’s coming'])
  })
  it('addresses are a list', () => {
    expect(pickerLayout('addresses', coates.works[2].sections).mode).toBe('list')
  })
  it('letters are a list by number and year, each named by recipient and date with its topics', () => {
    const l = pickerLayout('letters', letters(7))
    expect(l.mode).toBe('list')
    expect(l.groups.map(g => [g.label, g.items.map(i => i.n)])).toEqual([['1840', [1, 2, 3]], ['1841', [4, 5, 6]], ['1842', [7]]])
    expect(l.groups[0].items[1]).toMatchObject({ lead: '2', title: 'To G. V. Wigram · 2 March 1840', detail: 'The church; the Lord’s coming' })
    // a volume of one year is not grouped
    expect(pickerLayout('letters', letters(4, () => 1850)).groups.map(g => g.label)).toEqual([''])
    // an undated letter stays with the year before it: 1840 is not split in two
    const undated = letters(7).map((x, i) => i === 1 ? { ...x, date: undefined } : x)
    expect(pickerLayout('letters', undated).groups.map(g => [g.label, g.items.map(i => i.n)])).toEqual([['1840', [1, 2, 3]], ['1841', [4, 5, 6]], ['1842', [7]]])
  })
  it('the other writings are papers, Coates’s addresses books', () => {
    expect(collectionDetail({ id: 'other', title: 'Other writings', works: [{ id: 'a', title: 'A', kind: 'papers', count: 1 }, { id: 'b', title: 'B', kind: 'papers', count: 3 }] })).toBe('2 papers')
    expect(collectionDetail({ id: 'addresses', title: 'Addresses', works: [{ id: 'be', title: 'The Believer Established', kind: 'addresses', count: 8 }, { id: 'pl', title: 'The Paths of Life', kind: 'addresses', count: 12 }] })).toBe('2 books')
    expect(collectionDetail({ id: 'cw', title: 'Collected Writings', works: [{ id: 'a', title: 'CW 1', kind: 'papers', count: 40 }, { id: 'b', title: 'CW 2', kind: 'papers', count: 30 }] })).toBe('2 volumes')
  })
  it('the works of a collection: book chips by testament, or a list of volumes', () => {
    const lib = libraryFromCompanion([darby, coates])
    const b = shelfItems(lib.authors[0].collections[0].works, 'darby')
    expect(b.books).toBe(true)
    expect(b.groups.map(g => [g.label, g.items.map(i => i.label)])).toEqual([['', ['Preface and introduction']], ['Old Testament', ['Gen', 'Ex']], ['New Testament', ['Matt']]])
    const v = shelfItems([{ id: 'l1', title: 'Letters, volume 1', kind: 'letters', count: 300 }, { id: 'l2', title: 'Letters, volume 2', kind: 'letters', count: 280 }])
    expect(v.books).toBe(false)
    expect(v.groups[0].items.map(i => [i.title, i.detail])).toEqual([['Letters, volume 1', '300 letters'], ['Letters, volume 2', '280 letters']])
  })
})

describe('the contents page', () => {
  const lib = libraryFromCompanion([darby, coates])
  const cw: CollectionSummary = { id: 'cw', title: 'Collected Writings', works: [1, 2].map(i => ({ id: `cw${i}`, title: `Collected Writings ${i}: Ecclesiastical ${i}`, kind: 'papers' as const, count: 40 })) }
  const other: CollectionSummary = { id: 'other', title: 'Other writings', works: [{ id: 'a', title: 'Bochim', kind: 'papers', count: 1 }, { id: 'b', title: 'Everlasting punishment', kind: 'papers', count: 3 }] }
  const jottings: CollectionSummary = { id: 'nj', title: 'Notes and Jottings', works: [{ id: 'notes-jottings', title: 'Notes and Jottings', kind: 'notes', count: 73 }] }
  it('a book of the Bible reads at once; a volume, a book of addresses or a paper of several sections lists its contents first', () => {
    const synopsis = lib.authors[0].collections[0], outlines = lib.authors[1].collections[0], believer = lib.authors[1].collections[1]
    expect(opensToContents(synopsis.works, synopsis.works[1])).toBe(false)
    expect(opensToContents(outlines.works, outlines.works[0])).toBe(false)
    expect(opensToContents(believer.works, believer.works[0])).toBe(true)
    expect(opensToContents(cw.works, cw.works[0])).toBe(true)
    expect(opensToContents(jottings.works, jottings.works[0])).toBe(true)
    expect(opensToContents([{ id: 'l1', title: 'Letters 1', kind: 'letters', count: 300 }], { count: 300 })).toBe(true)
  })
  it('a work of one section has nothing to list', () => {
    expect(opensToContents(other.works, other.works[0])).toBe(false)
    expect(opensToContents(other.works, other.works[1])).toBe(true)
  })
  it('the heading: the volume short beside its fellows, under its collection; a lone work under its author', () => {
    const darbyLib: Library = { authors: [{ ...lib.authors[0], collections: [cw, jottings] }] }
    expect(contentsHeading(shelfOf(darbyLib, 'darby', 'cw2'), cw.works[1])).toEqual({ title: 'Collected Writings 2: Ecclesiastical 2', line: 'Collected Writings · 40 sections' })
    expect(contentsHeading(shelfOf(darbyLib, 'darby', 'notes-jottings'), jottings.works[0])).toEqual({ title: 'Notes and Jottings', line: 'J. N. Darby · 73 readings' })
    expect(contentsHeading(shelfOf(lib, 'coates', 'believer-established'), lib.authors[1].collections[1].works[0], 'coates')).toEqual({ title: 'The Believer Established', line: 'C. A. Coates · 3 addresses' })
    // before the library is in, the work stands alone
    expect(contentsHeading(null, { title: 'Letters 2', kind: 'letters', count: 280 })).toEqual({ title: 'Letters 2', line: '280 letters' })
    expect(countOf('notes', 1)).toBe('1 reading')
  })
})

describe('the reading position', () => {
  it('parses what was stored and drops what is malformed', () => {
    expect(parsePositions(null)).toEqual({})
    expect(parsePositions('not json')).toEqual({})
    expect(parsePositions('[1]')).toEqual({})
    const ps = parsePositions(JSON.stringify({ 'coates/believer-established': { n: 3, p: 4, dy: 12.4, t: 5, title: 'The Believer Established' }, 'bad': { n: 1 }, 'darby/x': { n: 0 }, 'darby/y': { n: 2, p: -1 } }))
    expect(ps).toEqual({ 'coates/believer-established': { n: 3, p: 4, dy: 12.4, t: 5, title: 'The Believer Established' } })
  })
  it('keeps the latest, leaves an unchanged place alone, and touches it once it is old', () => {
    let ps: Positions = {}
    ps = rememberPosition(ps, 'a/x', { n: 2, p: 3, dy: 10, t: 1000 })
    const same = rememberPosition(ps, 'a/x', { n: 2, p: 3, dy: 10.2, t: 2000 })
    expect(same).toBe(ps)
    const touched = rememberPosition(ps, 'a/x', { n: 2, p: 3, dy: 10, t: 1000 + TOUCH_MS })
    expect(touched).not.toBe(ps)
    expect(touched['a/x'].t).toBe(1000 + TOUCH_MS)
    ps = rememberPosition(ps, 'b/y', { n: 1, p: 0, dy: 0, t: 3000 })
    expect(latestPosition(ps)).toEqual({ author: 'b', work: 'y', pos: { n: 1, p: 0, dy: 0, t: 3000 } })
    expect(latestPosition({})).toBeNull()
  })
  it('forgets the oldest past the cap', () => {
    let ps: Positions = {}
    for (let i = 0; i < POSITIONS_KEPT + 3; i++) ps = rememberPosition(ps, `a/w${i}`, { n: 1, p: 0, dy: 0, t: i })
    expect(Object.keys(ps)).toHaveLength(POSITIONS_KEPT)
    expect(ps['a/w0']).toBeUndefined()
    expect(ps[`a/w${POSITIONS_KEPT + 2}`]).toBeDefined()
  })
  it('the paragraph at the top of the view', () => {
    const tops = [100, 300, undefined, 700, 1000]
    expect(paragraphAt(tops, 0)).toEqual({ p: 0, dy: 0 })
    expect(paragraphAt(tops, 90)).toEqual({ p: 0, dy: 0 })
    expect(paragraphAt(tops, 280)).toEqual({ p: 1, dy: 0 })
    expect(paragraphAt(tops, 350)).toEqual({ p: 1, dy: 50 })
    expect(paragraphAt(tops, 690)).toEqual({ p: 3, dy: 0 })
    expect(paragraphAt(tops, 2000)).toEqual({ p: 4, dy: 1000 })
    expect(paragraphAt([], 500)).toEqual({ p: 0, dy: 0 })
  })
  it('the row at the top when a figure’s rows stand out of slot order (the harmony in parallel)', () => {
    // slots 2–4 are one pericope (same top), slot 5 stands above them
    const tops = [0, 100, 400, 400, 400, 250, 600]
    expect(paragraphAt(tops, 260)).toEqual({ p: 5, dy: 10 })
    expect(paragraphAt(tops, 420)).toEqual({ p: 2, dy: 20 })
    expect(paragraphAt(tops, 700)).toEqual({ p: 6, dy: 100 })
  })
})

describe('the deep link', () => {
  it('parses `from`', () => {
    expect(parseFrom('1.1.26')).toEqual({ book: 1, chapter: 1, v1: 26 })
    expect(parseFrom('45.15.13-14')).toEqual({ book: 45, chapter: 15, v1: 13, v2: 14 })
    expect(parseFrom('45.15.13-13')).toEqual({ book: 45, chapter: 15, v1: 13 })
    for (const bad of ['', '1.1', '1.51.1', '67.1.1', '0.1.1', '1.1.0', '1.1.5-3', 'gen.1.1', undefined, null]) expect(parseFrom(bad)).toBeNull()
  })
  it('formats it back, names it, and makes the reader’s reference', () => {
    expect(formatFrom({ book: 45, chapter: 15, v1: 13, v2: 14 })).toBe('45.15.13-14')
    expect(formatFrom({ book: 1, chapter: 1, v1: 26 })).toBe('1.1.26')
    expect(fromLabel({ book: 1, chapter: 1, v1: 26 })).toBe('Genesis 1:26')
    expect(fromLabel({ book: 45, chapter: 15, v1: 13, v2: 14 })).toMatch(/^Romans 15:13.14$/)
    expect(fromLabel({ book: 1, chapter: 1, v1: 26 }, 'abbr')).toBe('Gen 1:26')
    expect(fromRef({ book: 45, chapter: 15, v1: 13, v2: 14 })).toEqual({ book: 45, chapter: 15, v1: 13, v2: 14 })
  })
  it('reads the params', () => {
    expect(readerLink({ n: '3', p: '7', from: '1.1.26' })).toEqual({ n: 3, p: 7, from: { book: 1, chapter: 1, v1: 26 } })
    expect(readerLink({ n: '0', p: '', from: 'x' })).toEqual({ n: undefined, p: undefined, from: null })
    expect(readerLink({ p: '0' })).toEqual({ n: undefined, p: 0, from: null })
  })
  it('lands on the linked paragraph with a wash, else the kept place, else the top', () => {
    const kept = { n: 4, p: 9, dy: 30, t: 1 }
    expect(landing({ n: 2, p: 5, from: null }, kept)).toEqual({ n: 2, p: 5, dy: 0, wash: true })
    expect(landing({ n: 2, p: 0, from: null }, kept)).toEqual({ n: 2, p: 0, dy: 0, wash: true })
    expect(landing({ n: 4, from: null }, kept)).toEqual({ n: 4, p: 9, dy: 30, wash: false })
    expect(landing({ n: 3, from: null }, kept)).toEqual({ n: 3, p: 0, dy: 0, wash: false })
    expect(landing({ from: null }, kept)).toEqual({ n: 4, p: 9, dy: 30, wash: false })
    expect(landing({ from: null }, null)).toEqual({ n: 1, p: 0, dy: 0, wash: false })
    expect(landing({ n: 40, from: null }, null, 12)).toEqual({ n: 12, p: 0, dy: 0, wash: false })
  })
})

describe('searching the works', () => {
  const lib: Library = { authors: [
    { id: 'darby', name: 'J. N. Darby', short: 'Darby', born: 1800, died: 1882, source: '', collections: [
      { id: 'cw', title: 'Collected Writings', works: [{ id: 'cw1', title: 'Volume 1: Ecclesiastical No. 1', kind: 'papers', count: 20 }, { id: 'cw12', title: 'Volume 12: Evangelic No. 1', kind: 'papers', count: 20 }] },
      { id: 'letters', title: 'Letters', works: [1, 2, 3].map(i => ({ id: `letters-${i}`, title: `Letters, volume ${i}`, kind: 'letters' as const, count: 300 })) },
    ] },
  ] }
  it('finds works by title and collection, whole numbers only', () => {
    expect(searchWorks(lib, 'letters 2').map(h => h.work.id)).toEqual(['letters-2'])
    expect(searchWorks(lib, 'collected evangelic').map(h => h.work.id)).toEqual(['cw12'])
    expect(searchWorks(lib, 'ecclesiastical').map(h => h.work.id)).toEqual(['cw1'])
    expect(searchWorks(lib, 'volume 12').map(h => h.work.id)).toEqual(['cw12'])
    expect(searchWorks(lib, 'letters 1').map(h => h.work.id)).toEqual(['letters-1'])
  })
  it('needs a word', () => {
    expect(searchWorks(lib, '12')).toEqual([])
    expect(searchWorks(lib, '  ')).toEqual([])
    expect(searchWorks(null, 'letters')).toEqual([])
  })
})

describe('the server’s title hits beside the companion’s places', () => {
  const lib: Library = { authors: [
    { id: 'darby', name: 'J. N. Darby', short: 'Darby', born: 1800, died: 1882, source: '', collections: [
      { id: 'synopsis', title: 'Synopsis of the Books of the Bible', works: [{ id: 'romans', title: 'Romans', kind: 'outline', count: 12 }] },
      { id: 'cw', title: 'Collected Writings', works: [{ id: 'cw-miscellaneous-3', title: 'Collected Writings 34: Miscellaneous 3', kind: 'papers', count: 60 }] },
      { id: 'letters', title: 'Letters', works: [{ id: 'letters-1', title: 'Letters, volume 1', kind: 'letters', count: 300 }] },
    ] },
    { id: 'coates', name: 'C. A. Coates', short: 'Coates', born: 1862, died: 1945, source: '', collections: [
      { id: 'outlines', title: 'Outlines', works: [{ id: 'romans', title: 'An Outline of the Epistle to the Romans', kind: 'outline', count: 17 }] },
    ] },
  ] }
  const hit = (author: string, work: string, n: number, extra: Partial<SectionHit> = {}): SectionHit => {
    const w = lib.authors.find(a => a.id === author)!.collections.flatMap(c => c.works.map(x => ({ ...x, collection: c.id }))).find(x => x.id === work)!
    return { author, work: { id: w.id, title: w.title, kind: w.kind, collection: w.collection }, n, title: `Section ${n}`, passages: [], ...extra }
  }
  it('a hit the companion already lists (same author, work, section) is dropped; the rest keep the server’s order', () => {
    const places = [{ author: 'darby' as const, work: { id: 'romans', title: 'Romans', kind: 'outline' as const }, n: 6, section: { title: 'Romans 5:1–11', passages: [] } }]
    const hits = [hit('darby', 'cw-miscellaneous-3', 39), hit('darby', 'romans', 6), hit('coates', 'romans', 6)]
    expect(newSectionHits(hits, places).map(h => `${h.author}/${h.work.id}/${h.n}`)).toEqual(['darby/cw-miscellaneous-3/39', 'coates/romans/6'])
    expect(newSectionHits([], places)).toEqual([])
  })
  it('the detail line reads like a companion place’s', () => {
    expect(sectionHitDetail(hit('darby', 'cw-miscellaneous-3', 39, { title: 'Christ for my sins and Christ for my cares' }), lib)).toBe('Darby · Collected Writings 34: Miscellaneous 3')
    expect(sectionHitDetail(hit('darby', 'romans', 6, { title: 'Romans 5:1–11', passages: [[45, 5, 1, 5, 11]] }), lib)).toBe('Darby · Synopsis · Romans')
    expect(sectionHitDetail(hit('coates', 'romans', 6, { title: 'Chapter 5', passages: [[45, 5, 1, 5, 0]] }), lib)).toBe('Coates · An Outline of the Epistle to the Romans')
    // a passage the title does not name is shown; a part is
    expect(sectionHitDetail(hit('darby', 'cw-miscellaneous-3', 2, { title: 'Grace', passages: [[45, 5, 1, 5, 11]] }), lib)).toBe('Darby · Collected Writings 34: Miscellaneous 3 · Romans 5:1–11')
    expect(sectionHitDetail(hit('darby', 'cw-miscellaneous-3', 2, { title: 'Grace', part: 'Volume 34' }), lib)).toBe('Darby · Collected Writings 34: Miscellaneous 3 · Volume 34')
    // a letter headed by its recipient and date in the title keeps them there; one titled otherwise gets its line
    expect(sectionHitDetail(hit('darby', 'letters-1', 5, { title: 'To G. V. Wigram · [1833]', to: 'G. V. Wigram', date: '[1833]' }), lib)).toBe('Darby · Letters, volume 1')
    expect(sectionHitDetail(hit('darby', 'letters-1', 7, { title: 'Letter 7', to: 'Mr. B.', date: '12 March 1845' }), lib)).toBe('Darby · Letters, volume 1 · To Mr. B. · 12 March 1845')
    // without the library, the registry names the author and the work stands alone
    expect(sectionHitDetail(hit('darby', 'romans', 6, { title: 'Romans 5:1–11', passages: [[45, 5, 1, 5, 11]] }), null)).toBe('Darby · Romans')
  })
})
