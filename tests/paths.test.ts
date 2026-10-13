import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BOOKS } from '../shared/books'
import type { CompanionIndex } from '../shared/companion'
import type { ParallelsFigure } from '../shared/figures'
import type { MinistrySection } from '../shared/ministry'
import { COATES_BOOKS, PATH_IDS, chapterKey, defaultWithMinistry, nextPortion, paceFor, standing, withMinistry, onPath, pathBlurb, pathBooks, pathChapters, pathLength, pathTitle, portionAt, progress, readProgress, readSetOf, readSetSince, readTotals, type PathState } from '../shared/paths'
import { inOrder, lifeOfChrist } from '../tools/path_orders'
import { HAS_TEXTS } from './_texts'

const ROOT = path.resolve(__dirname, '..')
const first = (id: Parameters<typeof portionAt>[0]) => portionAt(id, 0)
const last = (id: Parameters<typeof portionAt>[0]) => portionAt(id, pathLength(id) - 1)
const eachOnce = (chs: [number, number][]) => new Set(chs.map(([b, c]) => chapterKey(b, c))).size === chs.length

describe('the built-in paths', () => {
  it('have the lengths the design table gives, first and last portions in place, no chapter twice', () => {
    expect(pathLength('gospels')).toBe(89)
    expect([first('gospels'), last('gospels')]).toEqual([{ book: 40, chapter: 1 }, { book: 43, chapter: 21 }])
    expect(pathLength('psalms-proverbs')).toBe(181)
    expect([first('psalms-proverbs'), last('psalms-proverbs')]).toEqual([{ book: 19, chapter: 1 }, { book: 20, chapter: 31 }])
    expect(pathLength('new-testament')).toBe(260)
    expect([first('new-testament'), last('new-testament')]).toEqual([{ book: 40, chapter: 1 }, { book: 66, chapter: 22 }])
    expect(pathLength('bible')).toBe(1189)
    expect([first('bible'), last('bible')]).toEqual([{ book: 1, chapter: 1 }, { book: 66, chapter: 22 }])
    expect(pathLength('in-order')).toBe(1189)
    expect([first('in-order'), last('in-order')]).toEqual([{ book: 1, chapter: 1 }, { book: 66, chapter: 22 }])
    expect(pathLength('synopsis')).toBe(1189)
    expect(pathLength('coates')).toBe(COATES_BOOKS.reduce((n, b) => n + BOOKS[b - 1].chapters, 0))
    expect([first('coates'), last('coates')]).toEqual([{ book: 1, chapter: 1 }, { book: 66, chapter: 22 }])
    for (const id of PATH_IDS) { expect(eachOnce(pathChapters(id)), id).toBe(true); expect(pathTitle(id)).toBeTruthy(); expect(pathBlurb(id)).toMatch(/\.$/) }
    expect(portionAt('gospels', 89)).toBeUndefined()
  })

  it('in-order holds every chapter of the Bible once, Job after Genesis 11, the Psalms after 2 Samuel, James inside Acts', () => {
    const chs = pathChapters('in-order')
    expect(eachOnce(chs)).toBe(true)
    expect(new Set(chs.map(([b]) => b)).size).toBe(66)
    const at = (b: number, c: number) => chs.findIndex(([x, y]) => x === b && y === c)
    expect(at(1, 11)).toBeLessThan(at(18, 1))
    expect(at(18, 42)).toBeLessThan(at(1, 12))
    expect(at(10, 24)).toBeLessThan(at(19, 1))
    expect(at(19, 150)).toBeLessThan(at(11, 1))
    expect(at(44, 12)).toBeLessThan(at(59, 1))
    expect(at(59, 5)).toBeLessThan(at(44, 13))
    expect(pathBooks('in-order').slice(0, 3)).toEqual([1, 18, 2])
    // the generator and the checked-in JSON agree
    expect(inOrder()).toEqual(chs)
  })

  it.skipIf(!HAS_TEXTS)('life-of-christ covers all 89 Gospel chapters exactly once, in the harmony’s order, and matches the harmony data', () => {
    const chs = pathChapters('life-of-christ')
    expect(chs.length).toBe(89)
    expect(eachOnce(chs)).toBe(true)
    expect(chs.every(([b]) => b >= 40 && b <= 43)).toBe(true)
    const at = (b: number, c: number) => chs.findIndex(([x, y]) => x === b && y === c)
    expect(chs[0]).toEqual([40, 1])
    expect(at(40, 8)).toBeLessThan(at(40, 5))             // Darby sets the leper and the centurion before the sermon on the mount
    expect(at(40, 4)).toBeLessThan(at(43, 1))             // John's prologue after the baptism and temptation
    expect(at(43, 4)).toBeLessThan(at(42, 5))
    expect(at(40, 14)).toBeLessThan(at(43, 6))             // the bread of life after the five thousand
    expect(at(43, 6)).toBeLessThan(at(41, 7))
    expect(at(43, 20)).toBeGreaterThan(at(40, 28))
    expect(chs[88]).toEqual([43, 21])
    const sections = (JSON.parse(readFileSync(path.join(ROOT, 'data/ministry/darby/cw-expository-4.json'), 'utf8')) as { sections: MinistrySection[] }).sections
    const fig = sections.find(s => s.title === 'Relative order of three synoptical Gospels')!.figures![0] as ParallelsFigure
    expect(lifeOfChrist(fig)).toEqual(chs)
  })

  it.skipIf(!HAS_TEXTS)('coates follows the books the Coates index outlines', () => {
    const index = JSON.parse(readFileSync(path.join(ROOT, 'data/coates/index.json'), 'utf8')) as CompanionIndex
    const books = new Set<number>()
    for (const w of index.works) if (w.kind === 'outline') for (const s of w.sections) for (const p of s.passages) books.add(p[0])
    expect([...books].sort((a, b) => a - b)).toEqual([...COATES_BOOKS])
    expect(pathBooks('coates')).toEqual([...COATES_BOOKS])
  })
})

describe('companion pairing', () => {
  const index: CompanionIndex = { author: 'darby', works: [
    { id: 'introduction', title: 'Preface', kind: 'introduction', sections: [{ title: 'Preface', passages: [] }] },
    { id: 'genesis', title: 'Genesis', kind: 'outline', sections: [
      { title: 'Introduction', passages: [] }, { title: 'Chapters 1-2', passages: [[1, 1, 1, 2, 0]] }, { title: 'Chapter 3', passages: [[1, 3, 1, 3, 0]] }, { title: 'Chapter 3 again', passages: [[1, 3, 1, 3, 15]] },
    ] },
    { id: 'talks', title: 'Addresses', kind: 'addresses', sections: [{ title: 'On the fall', passages: [[1, 3, 1, 3, 0]] }] },
  ] }
  it('synopsis pairs a chapter with every outline section on it, in reading order, and leaves addresses out', () => {
    expect(portionAt('synopsis', 0, { darby: index })).toEqual({ book: 1, chapter: 1, then: [{ author: 'darby', work: 'genesis', n: 2 }] })
    expect(portionAt('synopsis', 1, { darby: index })).toEqual({ book: 1, chapter: 2, then: [{ author: 'darby', work: 'genesis', n: 2 }] })
    expect(portionAt('synopsis', 2, { darby: index })?.then).toEqual([{ author: 'darby', work: 'genesis', n: 3 }, { author: 'darby', work: 'genesis', n: 4 }])
    // a chapter without a section stands alone; so does every chapter until the index is loaded; other paths never pair
    expect(portionAt('synopsis', 3, { darby: index })).toEqual({ book: 1, chapter: 4 })
    expect(portionAt('synopsis', 0)).toEqual({ book: 1, chapter: 1 })
    expect(portionAt('synopsis', 0, { darby: null })).toEqual({ book: 1, chapter: 1 })
    expect(portionAt('bible', 0, { darby: index })).toEqual({ book: 1, chapter: 1 })
    // coates reads its own author
    expect(portionAt('coates', 0, { darby: index })).toEqual({ book: 1, chapter: 1 })
    expect(portionAt('coates', 0, { coates: { ...index, author: 'coates' } })?.then).toEqual([{ author: 'coates', work: 'genesis', n: 2 }])
  })
})

describe('progress, the next portion and the finish estimate', () => {
  const state: PathState = { id: 'gospels', started_at: '2026-09-01T00:00:00.000Z', target_date: null, pace_per_week: 7, with_ministry: false }
  it('counts read chapters, points at the first unread one, and is done when none is left', () => {
    const none = new Set<string>()
    expect(progress(state, none)).toEqual({ done: 0, total: 89, position: 1 })
    expect(nextPortion(state, none)).toEqual({ index: 0, portion: { book: 40, chapter: 1 } })
    const some = readSetOf([[40, 1], [40, 2], [40, 4], [19, 23]])   // a psalm is not on this path
    expect(progress(state, some)).toEqual({ done: 3, total: 89, position: 3 })
    expect(nextPortion(state, some)?.portion).toEqual({ book: 40, chapter: 3 })
    const all = readSetOf(pathChapters('gospels'))
    expect(progress(state, all)).toEqual({ done: 89, total: 89, position: 89 })
    expect(nextPortion(state, all)).toBeNull()
    expect(onPath(state, 40, 3)).toBe(true)
    expect(onPath(state, 19, 23)).toBe(false)
  })
  it('reads before the start do not count', () => {
    const set = readSetSince([[40, 1, '2026-08-31T23:59:59.000Z'], [40, 2, '2026-09-01T00:00:00.000Z'], [40, 3, '2026-09-02T10:00:00.000Z']], state.started_at)
    expect([...set]).toEqual(['40.2', '40.3'])
    expect(progress(state, set)).toEqual({ done: 2, total: 89, position: 1 })
  })
  it('asks for the exact chapters a day a target needs, rounded up, and nothing without a target', () => {
    const pr = { done: 12, total: 89, position: 13 }
    expect(paceFor(pr, '2026-10-27', '2026-09-28')).toBe(3)        // 77 left over 30 days
    expect(paceFor(pr, '2026-12-31', '2026-09-28')).toBe(1)        // 95 days
    expect(paceFor(pr, '2026-09-28', '2026-09-28')).toBe(77)       // today: all of it
    expect(paceFor(pr, '2026-09-01', '2026-09-28')).toBe(77)       // past: the same
    expect(paceFor(pr, null, '2026-09-28')).toBeNull()
    expect(paceFor(pr, undefined, '2026-09-28')).toBeNull()
    expect(paceFor({ done: 89, total: 89, position: 89 }, '2026-12-31', '2026-09-28')).toBeNull()
  })
  it('says where the reader stands against the target: on track, ahead, behind; nulls without a target', () => {
    const start = '2026-09-01T09:30:00.000Z', target = '2026-09-30'   // 30 days, 89 chapters: 2.97 a day
    expect(standing({ done: 3, total: 89, position: 4 }, start, target, '2026-09-01')).toEqual({ expected: 3, done: 3, delta: 0 })
    expect(standing({ done: 20, total: 89, position: 21 }, start, target, '2026-09-06')).toEqual({ expected: 18, done: 20, delta: 2 })
    expect(standing({ done: 25, total: 89, position: 26 }, start, target, '2026-09-10')).toEqual({ expected: 30, done: 25, delta: -5 })
    expect(standing({ done: 89, total: 89, position: 89 }, start, target, '2026-09-30')).toEqual({ expected: 89, done: 89, delta: 0 })
    // past the target everything was due; before the start nothing was
    expect(standing({ done: 40, total: 89, position: 41 }, start, target, '2026-10-15')).toEqual({ expected: 89, done: 40, delta: -49 })
    expect(standing({ done: 0, total: 89, position: 1 }, start, target, '2026-08-20')).toEqual({ expected: 0, done: 0, delta: 0 })
    // a target on the start day wants it all that day
    expect(standing({ done: 0, total: 89, position: 1 }, start, '2026-09-01', '2026-09-01')).toEqual({ expected: 89, done: 0, delta: -89 })
    expect(standing({ done: 7, total: 89, position: 8 }, start, null, '2026-09-10')).toEqual({ expected: null, done: 7, delta: null })
    expect(standing({ done: 7, total: 89, position: 8 }, start, undefined)).toEqual({ expected: null, done: 7, delta: null })
  })
})

describe('the ministry pairing switch', () => {
  it('is on by default only for the paired paths, and off it leaves the Scripture order alone', () => {
    expect(PATH_IDS.filter(defaultWithMinistry)).toEqual(['synopsis', 'coates'])
    expect(defaultWithMinistry('custom')).toBe(false)
    const index: CompanionIndex = { author: 'darby', works: [{ id: 'genesis', title: 'Genesis', kind: 'outline', sections: [{ title: 'Chapter 1', passages: [[1, 1, 1, 1, 0]] }] }] }
    const on: PathState = { id: 'synopsis', started_at: '2026-09-01T00:00:00.000Z', target_date: null, pace_per_week: null, with_ministry: true }
    expect(withMinistry(on)).toBe(true)
    expect(portionAt(on, 0, { darby: index })).toEqual({ book: 1, chapter: 1, then: [{ author: 'darby', work: 'genesis', n: 1 }] })
    const off = { ...on, with_ministry: false }
    expect(withMinistry(off)).toBe(false)
    expect(portionAt(off, 0, { darby: index })).toEqual({ book: 1, chapter: 1 })
    expect(pathLength(off)).toBe(pathLength(on))
    expect(withMinistry({ id: 'synopsis' })).toBe(true)
    expect(withMinistry({ id: 'bible', with_ministry: true })).toBe(true)  // the flag is kept but there is nothing to pair
    expect(portionAt({ id: 'bible', with_ministry: true }, 0, { darby: index })).toEqual({ book: 1, chapter: 1 })
  })
})

describe('custom paths', () => {
  it('walk the chosen books whole, in the chosen order', () => {
    const p: PathState = { id: 'custom', started_at: '2026-09-01T00:00:00.000Z', target_date: null, pace_per_week: null, with_ministry: false, custom: { title: 'Paul’s prison letters', books: [49, 50, 51, 57] } }
    expect(pathLength(p)).toBe(6 + 4 + 4 + 1)
    expect(portionAt(p, 0)).toEqual({ book: 49, chapter: 1 })
    expect(portionAt(p, 6)).toEqual({ book: 50, chapter: 1 })
    expect(portionAt(p, 14)).toEqual({ book: 57, chapter: 1 })
    expect(pathTitle(p)).toBe('Paul’s prison letters')
    expect(pathBlurb(p)).toBe('Ephesians, Philippians and 2 more books')
    const reversed: PathState = { ...p, custom: { title: '', books: [57, 49] } }
    expect(pathChapters(reversed).slice(0, 2)).toEqual([[57, 1], [49, 1]])
    expect(pathTitle(reversed)).toBe('Your path')
    expect(pathBlurb(reversed)).toBe('Philemon, Ephesians')
    expect(pathLength({ id: 'custom', custom: { title: 'x', books: [99, 0] } })).toBe(0)
    expect(nextPortion({ id: 'custom', custom: { title: 'x', books: [] } }, new Set())).toBeNull()
  })
})

describe('what a read set amounts to (signed-out Stats)', () => {
  const chaptersOf = (book: number, upTo = BOOKS[book - 1].chapters) => Array.from({ length: upTo }, (_, i) => chapterKey(book, i + 1))
  it('nothing read: no chapters, no books', () => {
    expect(readTotals(new Set())).toEqual({ chapters: 0, books: 0 })
    expect(readProgress(new Set())).toEqual({})
  })
  it('a book counts as finished only when its every chapter is read', () => {
    const john = new Set([...chaptersOf(43), chapterKey(19, 23)])
    expect(readTotals(john)).toEqual({ chapters: 22, books: 1 })
    expect(readProgress(john)).toEqual({ '19': [23], '43': Array.from({ length: 21 }, (_, i) => i + 1) })
    expect(readTotals(new Set(chaptersOf(43, 20)))).toEqual({ chapters: 20, books: 0 })
    // one-chapter books finish on their one chapter
    expect(readTotals(new Set([chapterKey(31, 1), chapterKey(65, 1)]))).toEqual({ chapters: 2, books: 2 })
  })
  it('the whole Bible is 1,189 chapters and 66 books', () => {
    expect(readTotals(new Set(BOOKS.flatMap(b => chaptersOf(b.n))))).toEqual({ chapters: 1189, books: 66 })
  })
  it('keys that name no chapter are not counted', () => {
    expect(readTotals(new Set(['43.22', '67.1', '0.1', 'x', chapterKey(57, 1)]))).toEqual({ chapters: 1, books: 1 })
  })
})

describe('standing counts from the reader’s own start day', () => {
  it('an evening start is day one today, whatever the UTC date says', () => {
    const started = new Date(2026, 8, 30, 22, 8).toISOString()   // 22:08 local on 30 Sept: already 1 Oct in UTC west of Greenwich
    const st = standing({ done: 1, total: 89, position: 1 }, started, '2026-12-31', '2026-09-30')
    expect(st.expected).toBe(1)
    expect(st.delta).toBe(0)
  })
})
