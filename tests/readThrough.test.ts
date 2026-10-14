import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  addRange, applyBeat, earnedMs, fitThrough, freshThrough, heardCostMs, judge, MIN_MS, MS_PER_WORD,
  type BeatEvidence, type ReadThrough, type Shape,
} from '../shared/readThrough'

const CASES = join(__dirname, '../shared/readThrough.cases.json')
type Earned = { elapsedMs: number; active: boolean; visible: boolean; listening: boolean; heardCostMs: number; expect?: number }
interface Cases {
  shapes: Record<string, Shape>
  cases: { name: string; shape: string; beats: BeatEvidence[]; expect?: { state: ReadThrough; judgement: ReturnType<typeof judge> } }[]
  earned: Earned[]
}
const file = JSON.parse(readFileSync(CASES, 'utf8')) as Cases
const run = (shape: Shape, beats: BeatEvidence[]) => beats.reduce((t, b) => applyBeat(t, shape, b), freshThrough(shape))
const caseNamed = (name: string) => { const c = file.cases.find(x => x.name === name)!; const shape = file.shapes[c.shape]; const t = run(shape, c.beats); return { t, j: judge(t, shape) } }

describe('the worked cases both copies of the rule are held to', () => {
  if (process.env.UPDATE_CASES) {
    for (const c of file.cases) { const shape = file.shapes[c.shape]; const t = run(shape, c.beats); c.expect = { state: t, judgement: judge(t, shape) } }
    for (const e of file.earned) e.expect = earnedMs(e.elapsedMs, e)
    writeFileSync(CASES, JSON.stringify(file, null, 2) + '\n')
  }
  for (const c of file.cases) {
    it(c.name, () => {
      const shape = file.shapes[c.shape]
      const t = run(shape, c.beats)
      expect(c.expect, 'no expectation: run with UPDATE_CASES=1').toBeDefined()
      expect(t).toEqual(c.expect!.state)
      expect(judge(t, shape)).toEqual(c.expect!.judgement)
    })
  }
  it('the time a beat brings', () => {
    for (const e of file.earned) expect(earnedMs(e.elapsedMs, e), JSON.stringify(e)).toBe(e.expect)
  })
})

describe('what the cases mean', () => {
  it('a steady read takes in every verse; its length still asks a few seconds more', () => {
    const { j } = caseNamed('a steady read, a screen at a time')
    expect(j.covered).toBe(true)
    expect(j.requiredMs).toBe(200 * MS_PER_WORD)
    expect(j.owingMs).toBe(3000)
    expect(j.read).toBe(false)
  })
  it('flicking to the end leaves the middle unread however long the wait', () => {
    const { t, j } = caseNamed('flicked to the end, then waiting there')
    expect(t.activeMs).toBeGreaterThan(j.requiredMs - 2000)
    expect(j.covered).toBe(false)
    expect(j.gaps).toEqual([[1, 3]])
  })
  it('a long pause pays for one quick screen, not for the chapter', () => {
    const { t, j } = caseNamed('a long pause on the first screen banks a screenful, no more')
    expect(t.seen).toEqual([100, 100, 100, 62, 0])
    expect(j.gaps).toEqual([[5, 6]])
  })
  it('the verses a text lacks are not asked for', () => {
    const { j } = caseNamed('a verse missing from the text is not a gap')
    expect(j.read).toBe(true)
  })
  it('listening at the fastest speed counts, timed by the recording', () => {
    const { j } = caseNamed('heard at 1.5x')
    expect(j.read).toBe(true)
    expect(j.requiredMs).toBe(5700 + 7600 + 50 * MS_PER_WORD + 11400 + 3800)
  })
  it('a beat cannot claim more heard than its time could hold', () => {
    const { t } = caseNamed('more heard than the time allows: only what fits, in order')
    expect(t.heard).toEqual([1, 0, 0, 0, 0])
  })
  it('reading and listening mix', () => {
    expect(caseNamed('read half, heard the rest').j.read).toBe(true)
  })
  it('a short psalm counts in its own time, 10 s at least', () => {
    const { j } = caseNamed('a short psalm needs its own time, held to 10 s')
    expect(j.requiredMs).toBe(MIN_MS)
    expect(j.read).toBe(true)
  })
  it('listening time carries from one beat to the next, and nothing is heard in no time', () => {
    expect(caseNamed('a verse begun in one beat and ended in the next is paid for by both').t.heard).toEqual([1, 0, 0, 0, 0])
    const { t } = caseNamed('beats that bring no time hear nothing, however many')
    expect([t.heard, t.activeMs]).toEqual([[0, 0, 0, 0, 0], 0])
  })
  it('a reader’s own pace asks its own time: 200 words at 400 a minute are 30 s', () => {
    const { j } = caseNamed("a reader's own quicker pace asks less time")
    expect([j.requiredMs, j.read]).toEqual([30_000, true])
  })
  it('nonsense ranges add nothing', () => {
    const { t } = caseNamed('ranges out of the chapter, and repeated ones, add nothing')
    expect(t.seen).toEqual([30, 0, 0, 0, 0])
  })
})

describe('the parts', () => {
  const shape = file.shapes.five
  it('a stored state that no longer fits the text starts again', () => {
    expect(fitThrough({ seen: [1, 2], heard: [0, 0], bank: 0, activeMs: 5, listenBank: 0 }, shape)).toEqual(freshThrough(shape))
    expect(fitThrough({ seen: [99, -3, 2.7, 0, 0], heard: [2, 0, 0, 0, 1], bank: 900, activeMs: 10, listenBank: 90_000 }, shape))
      .toEqual({ seen: [30, 0, 2, 0, 0], heard: [1, 0, 0, 0, 1], bank: 250, activeMs: 10, listenBank: 20_000 })
  })
  it('the listening cost is what the verses take at 1.5x, heard before or not', () => {
    expect(heardCostMs(shape, [[1, 2]])).toBe(6000 + 8000)
    expect(heardCostMs(shape, [[3, 3]])).toBe(50 * 240)
  })
  it('ranges join when they touch', () => {
    let rs: [number, number][] = []
    rs = addRange(rs, 5, 7); rs = addRange(rs, 1, 2); rs = addRange(rs, 3, 4); rs = addRange(rs, 9, 9); rs = addRange(rs, 0, 3)
    expect(rs).toEqual([[1, 7], [9, 9]])
  })
})
