// Stats with the reader's marks (client/src/lib/statsMarks.ts): a chapter's cell in Progress by book's sheet, and the
// account's counts while marks tapped there are on their way to the server (a mark is credited once, its undo takes
// that credit back).
import { describe, it, expect } from 'vitest'
import { chaptersRead, type ReadCounts } from '../shared/paths'
import { NO_READS, shownCounts, tickOf, withCounts, withTap, type MarkTap, type StatsReads } from '../client/src/lib/statsMarks'

const ROM = 45
/** Romans as `/stats/reads` lays it out: 16 counts, chapter 1 first. */
const romans = (times: Record<number, number>): number[] => Array.from({ length: 16 }, (_, i) => times[i + 1] ?? 0)
const marked = (...chapters: number[]) => new Map(chapters.map(c => [`${ROM}.${c}`, '2026-10-31T09:00:00.000Z']))
const tap = (n: number, chapter: number, by: 1 | -1 = 1): MarkTap => ({ n, book: ROM, chapter, by })
const shown = (s: StatsReads, m: ReadonlyMap<string, string> = new Map()) => shownCounts(s, m)?.[String(ROM)]
/** Genesis 1 and 2 read in the app, nothing of Romans. */
const START = withCounts(NO_READS, { 1: [1, 1, ...new Array<number>(48).fill(0)] }, 0)

describe('a chapter in the sheet', () => {
  it('is ticked when marked (credited or not), read when credited, and unread otherwise', () => {
    expect([tickOf(0, false), tickOf(2, false), tickOf(0, true), tickOf(1, true)]).toEqual(['unread', 'read', 'ticked', 'ticked'])
  })
})

describe('the account’s counts while marks tapped on Stats are on their way', () => {
  it('Romans 5 to 8 move the bar and the Bible percent at once, and the counts that come back change nothing', () => {
    let s = START
    for (const c of [5, 6, 7, 8]) s = withTap(s, tap(c - 4, c))
    expect(shown(s, marked(5, 6, 7, 8))).toEqual(romans({ 5: 1, 6: 1, 7: 1, 8: 1 }))
    expect(chaptersRead(shownCounts(s, marked(5, 6, 7, 8)))).toBe(6)
    const back = withCounts(s, { ...START.counts, [ROM]: romans({ 5: 1, 6: 1, 7: 1, 8: 1 }) }, 4)
    expect([back.taps, shown(back, marked(5, 6, 7, 8))]).toEqual([[], romans({ 5: 1, 6: 1, 7: 1, 8: 1 })])
  })
  it('an undo takes the mark’s credit back at once', () => {
    const had = withCounts(NO_READS, { [ROM]: romans({ 8: 1 }) }, 0)
    expect(shown(withTap(had, tap(1, 8, -1)))).toEqual(romans({}))
  })
  it('an undo on a chapter also read in the app on another day leaves it read once', () => {
    const had = withCounts(NO_READS, { [ROM]: romans({ 8: 2 }) }, 0)
    expect(shown(withTap(had, tap(1, 8, -1)))?.[7]).toBe(1)
  })
  it('a mark and its undo tapped before the server answered either leave the chapter as it was', () => {
    expect(shown(withTap(withTap(START, tap(1, 3)), tap(2, 3, -1)))).toEqual(romans({}))
  })
  it('a tap made while the counts were being asked for stays until counts that have it arrive', () => {
    const s = withCounts(withTap(withTap(START, tap(1, 5)), tap(2, 6)), { [ROM]: romans({ 5: 1 }) }, 1)
    expect([s.taps.map(t => t.n), shown(s, marked(5, 6))]).toEqual([[2], romans({ 5: 1, 6: 1 })])
  })
  it('the answer to a question asked before the latest taps reached the server changes nothing', () => {
    const s = withCounts(withTap(withTap(START, tap(1, 5)), tap(2, 6)), { [ROM]: romans({ 5: 1, 6: 1 }) }, 2)
    expect(withCounts(s, { [ROM]: romans({ 5: 1 }) }, 1)).toBe(s)
  })
  it('a mark still waiting on the device (offline, or the server over its rate) shows the chapter read', () => {
    expect(shown(withCounts(NO_READS, {}, 0), marked(9))).toEqual(romans({ 9: 1 }))
  })
  it('never below nothing, and the counts the server gave are left as they were', () => {
    const counts: ReadCounts = { [ROM]: romans({ 5: 1 }) }
    const s = withTap(withTap(withCounts(NO_READS, counts, 0), tap(1, 5, -1)), tap(2, 5, -1))
    expect([shown(s)?.[4], counts[ROM][4]]).toEqual([0, 1])
  })
  it('nothing tapped and nothing marked: the counts as they came', () => {
    expect(shownCounts(START, new Map())).toBe(START.counts)
    expect(shownCounts(NO_READS, marked(1))).toBeNull()
  })
})
