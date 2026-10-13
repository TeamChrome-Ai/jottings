import { describe, it, expect } from 'vitest'
import { BOOKS } from '../shared/books'
import { chapterKey, pathBooks, pathChapters, progress, standing, paceFor } from '../shared/paths'
import { TOTAL_CHAPTERS, chapterX, layoutStrip, spreadDots, stripLabels } from '../client/src/lib/pathStrip'
import { addMonths, countWords, daysInMonth, endOfYear, fmtTargetDay, monthGrid, paceLine, paceWords, portionTitle, standingWords, thenLine } from '../client/src/lib/pathWords'

const gospels = pathChapters('gospels')
const read = (chs: [number, number][]) => new Set(chs.map(([b, c]) => chapterKey(b, c)))

describe('the strip’s geometry', () => {
  it('is 66 books wide, in canonical order, ending on the right edge', () => {
    const l = layoutStrip({ width: 372 })
    expect(l.segments.length).toBe(66)
    expect(l.segments.map(s => s.book)).toEqual(BOOKS.map(b => b.n))
    const last = l.segments[65]
    expect(last.x + last.width).toBeCloseTo(372, 6)
    for (let i = 1; i < 66; i++) expect(l.segments[i].x).toBeGreaterThan(l.segments[i - 1].x + l.segments[i - 1].width)
  })
  it('gives each book its share of the 1,189 chapters, Psalms the widest, tiny books lifted to the floor', () => {
    expect(TOTAL_CHAPTERS).toBe(1189)
    const l = layoutStrip({ width: 372, minWidth: 3 })
    const w = (n: number) => l.segments[n - 1].width
    expect(w(19)).toBeGreaterThan(w(1))
    expect(Math.max(...l.segments.map(s => s.width))).toBe(w(19))
    // Obadiah, Philemon, 2 John, 3 John, Jude: one chapter each, all at the floor
    for (const n of [31, 57, 63, 64, 65]) expect(w(n)).toBe(3)
    // Genesis keeps its proportion against Exodus (50 : 40) among the books not at the floor
    expect(w(1) / w(2)).toBeCloseTo(50 / 40, 5)
    expect(l.segments.every(s => s.width >= 3)).toBe(true)
  })
  it('opens a wider gap between Malachi and Matthew', () => {
    const l = layoutStrip({ width: 372, gap: 1, testamentGap: 8 })
    const mal = l.segments[38], mat = l.segments[39], zec = l.segments[37]
    expect(mat.x - (mal.x + mal.width)).toBeCloseTo(9, 6)
    expect(mal.x - (zec.x + zec.width)).toBeCloseTo(1, 6)
  })
  it('keeps every book visible even when the width is small, and survives zero', () => {
    const tight = layoutStrip({ width: 200, minWidth: 1.5, gap: 0.5, testamentGap: 4 })
    expect(tight.segments.every(s => s.width >= 1.5 - 1e-9)).toBe(true)
    expect(tight.segments[65].x + tight.segments[65].width).toBeCloseTo(200, 6)
    // narrower than the floors allow: the shares stand, nothing breaks
    const impossible = layoutStrip({ width: 60, minWidth: 3 })
    expect(impossible.segments.every(s => s.width >= 0)).toBe(true)
    expect(layoutStrip({ width: 0 }).segments.every(s => s.width === 0)).toBe(true)
  })
})

describe('what the strip shows', () => {
  it('tints only the route’s books', () => {
    const l = layoutStrip({ width: 372, route: pathBooks('gospels') })
    expect(l.segments.filter(s => s.onRoute).map(s => s.book)).toEqual([40, 41, 42, 43])
    expect(layoutStrip({ width: 372 }).segments.every(s => s.onRoute)).toBe(true)
  })
  it('fills a route book by its own chapters on the path', () => {
    const l = layoutStrip({ width: 372, route: pathBooks('gospels'), routeChapters: gospels, readSet: read([[40, 1], [40, 2], [40, 3], [40, 4], [40, 5], [40, 6], [40, 7], [41, 1], [1, 1]]) })
    const mt = l.segments[39], mk = l.segments[40], gen = l.segments[0]
    expect(mt).toMatchObject({ chapters: 28, read: 7 })
    expect(mt.fill).toBeCloseTo(0.25, 6)
    expect(mk.fill).toBeCloseTo(1 / 16, 6)
    // Genesis is not on the route: no count for it
    expect(gen).toMatchObject({ fill: 0, read: 0 })
  })
  it('fills the whole Bible by what has ever been read', () => {
    const l = layoutStrip({ width: 372, readSet: read([[31, 1], [8, 1], [8, 2]]) })
    expect(l.segments[30].fill).toBe(1)
    expect(l.segments[7].fill).toBeCloseTo(0.5, 6)
  })
  it('takes a place as a count of portions done (a group member)', () => {
    // 30 portions of the Gospels done: all of Matthew (28) and Mark 1–2
    const l = layoutStrip({ width: 372, route: pathBooks('gospels'), routeChapters: gospels, doneUpTo: 30 })
    expect(l.segments[39].fill).toBe(1)
    expect(l.segments[40].read).toBe(2)
    expect(l.segments[41].fill).toBe(0)
  })
  it('places a chapter inside its book, the first at the left and the last at the right', () => {
    const l = layoutStrip({ width: 372 })
    const ps = l.segments[18]
    const x1 = chapterX(l, 19, 1)!, x150 = chapterX(l, 19, 150)!, x75 = chapterX(l, 19, 75)!
    expect(x1).toBeGreaterThan(ps.x)
    expect(x1).toBeLessThan(ps.x + ps.width / 150)
    expect(x150).toBeLessThan(ps.x + ps.width)
    expect(x75).toBeGreaterThan(x1)
    expect(x75).toBeLessThan(x150)
    expect(chapterX(l, 19, 999)).toBe(x150)
    expect(chapterX(l, 67, 1)).toBeNull()
  })
})

describe('labels and dots', () => {
  it('names the route’s books where the name fits, thinning names that would touch', () => {
    const l = layoutStrip({ width: 372, route: pathBooks('gospels') })
    // on a phone the four Gospels span ~22 px: one name stands for them; at 1240 px (~85 px) two fit without touching
    expect(stripLabels(l).map(x => x.text)).toEqual(['Matt'])
    expect(stripLabels(layoutStrip({ width: 1240, route: pathBooks('gospels') })).map(x => x.text)).toEqual(['Matt', 'Luke'])
    expect(stripLabels(layoutStrip({ width: 2400, route: pathBooks('gospels') })).map(x => x.text)).toEqual(['Matt', 'Mark', 'Luke', 'John'])
    const whole = stripLabels(layoutStrip({ width: 372 }))
    // the whole Bible at phone width: a name every ~30 px, so most books go unnamed, and neighbours never touch
    expect(whole.length).toBeGreaterThan(8)
    expect(whole.length).toBeLessThan(20)
    expect(whole[0].book).toBe(1)
    // the wide screen names many more
    expect(stripLabels(layoutStrip({ width: 1240 })).length).toBeGreaterThanOrEqual(30)
    for (let i = 1; i < whole.length; i++) expect(whole[i].x - whole[i].text.length * 6.2 / 2).toBeGreaterThanOrEqual(whole[i - 1].x + whole[i - 1].text.length * 6.2 / 2 + 4 - 1e-9)
    expect(stripLabels(layoutStrip({ width: 40 })).length).toBeLessThanOrEqual(1)
  })
  it('spreads dots that share a chapter and leaves the rest where they are', () => {
    expect(spreadDots([10, 100])).toEqual([10, 100])
    const s = spreadDots([50, 50, 50], 6)
    expect(s).toEqual([44, 50, 56])
    const t = spreadDots([20, 21, 80], 6, 4)
    expect(t[0]).toBeCloseTo(17.5)
    expect(t[1]).toBeCloseTo(23.5)
    expect(t[2]).toBe(80)
  })
})

describe('the words', () => {
  it('names a portion, its ministry courtesy, and the count', () => {
    expect(portionTitle({ book: 41, chapter: 4 })).toBe('Mark 4')
    expect(thenLine({ book: 41, chapter: 4 })).toBeNull()
    expect(thenLine({ book: 41, chapter: 4, then: [{ author: 'darby', work: 'synopsis', n: 3 }] })).toBe('then Darby on Mark 4')
    expect(thenLine({ book: 1, chapter: 1, then: [{ author: 'coates', work: 'x', n: 1 }] })).toBe('then Coates on Genesis 1')
    expect(countWords(progress('gospels', read([[40, 1], [40, 2]])))).toBe('3 of 89')
    expect(countWords(progress('gospels', read(gospels)))).toBe('89 of 89')
  })
  it('says exactly where the reader stands, never vaguely', () => {
    expect(standingWords({ expected: 5, done: 5, delta: 0 })).toBe('on track')
    expect(standingWords({ expected: 5, done: 7, delta: 2 })).toBe('2 ahead')
    expect(standingWords({ expected: 10, done: 5, delta: -5 })).toBe('5 behind')
    expect(standingWords({ expected: null, done: 5, delta: null })).toBeNull()
    expect(standingWords(null)).toBeNull()
  })
  it('writes the pace line from the core’s numbers: "3 a day to finish by 31 Dec · 2 ahead"', () => {
    const pr = progress('gospels', read(gospels.slice(0, 12)))
    const today = '2026-09-28', target = '2026-12-31', started = '2026-09-20T10:00:00.000Z'
    const line = paceLine(paceFor(pr, target, today), standing(pr, started, target, today), target, today)
    expect(line).toBe(`1 a day to finish by 31 Dec · ${standingWords(standing(pr, started, target, today))}`)
    expect(paceLine(null, null, null)).toBeNull()
    expect(paceLine(3, { expected: 10, done: 10, delta: 0 }, '2027-01-31', today)).toBe('3 a day to finish by 31 Jan 2027 · on track')
    expect(paceWords(3)).toBe('3 a week')
    expect(paceWords(null)).toBeNull()
  })
  it('formats a target day short, with the year only when it is another year', () => {
    expect(fmtTargetDay('2026-12-31', '2026-09-28')).toBe('31 Dec')
    expect(fmtTargetDay('2027-03-01', '2026-09-28')).toBe('1 Mar 2027')
    expect(fmtTargetDay('nonsense', '2026-09-28')).toBe('nonsense')
  })
})

describe('the calendar', () => {
  it('knows the months, adds them clamping to the last day, and finds the end of the year', () => {
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-09-28', 1)).toBe('2026-10-28')
    expect(endOfYear('2026-09-28')).toBe('2026-12-31')
    expect(endOfYear('2026-12-31')).toBe('2027-12-31')
  })
  it('lays a month out in whole weeks, the Lord’s day first, the past faded', () => {
    const rows = monthGrid(2026, 9, '2026-09-28')
    expect(rows.every(r => r.length === 7)).toBe(true)
    // 1 September 2026 is a Tuesday: two blanks before it
    expect(rows[0].slice(0, 2).every(c => c.day === null)).toBe(true)
    expect(rows[0][2]).toMatchObject({ day: '2026-09-01', n: 1, past: true })
    const all = rows.flat().filter(c => c.day)
    expect(all.length).toBe(30)
    expect(all.find(c => c.day === '2026-09-28')).toMatchObject({ today: true, past: false })
    expect(all.find(c => c.day === '2026-09-27')).toMatchObject({ past: true })
    expect(all.find(c => c.day === '2026-09-30')).toMatchObject({ past: false, today: false })
  })
})
