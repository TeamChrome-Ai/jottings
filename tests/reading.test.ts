import { describe, it, expect } from 'vitest'
import { READ_MAX_SECONDS, READ_MIN_SECONDS, atEnd, chapterWords, requiredSeconds, wordCount } from '../shared/reading'
import { freshThrough, type Shape } from '../shared/readThrough'
import { MAX_BEAT_MS, adopt, earned, estimate, newVisit, noteHeard, noteScreen, takeEvidence } from '../client/src/lib/readCredit'

describe('word count', () => {
  it('counts runs of letters, digits and apostrophes, as the scripture build does', () => {
    expect(wordCount('In the beginning God created the heavens and the earth.')).toBe(10)
    expect(wordCount('Jehovah’s word, and man\'s: 2 or 3 — “yea”.')).toBe(8)
    expect(wordCount('Κύριος ἐστιν')).toBe(2)
    expect(wordCount('  — ; ')).toBe(0)
    expect(chapterWords([{ t: 'Jesus wept.' }, { t: 'Praise ye Jah!' }])).toBe(5)
  })
})

describe('time a chapter needs from an older app (the end-and-time rule the server still applies to its beats)', () => {
  it('is its length at 250 words a minute, held to 45 s and 10 min', () => {
    expect(requiredSeconds(0)).toBe(READ_MIN_SECONDS)
    expect(requiredSeconds(100)).toBe(45)
    expect(requiredSeconds(600)).toBe(144)
    expect(requiredSeconds(2000)).toBe(480)
    expect(requiredSeconds(5000)).toBe(READ_MAX_SECONDS)
  })
})

describe('the end of the chapter', () => {
  it('is the bottom of the scroll, or a chapter that fits', () => {
    expect(atEnd(0, 800, 3000)).toBe(false)
    expect(atEnd(2200, 800, 3000)).toBe(true)
    expect(atEnd(2197, 800, 3000)).toBe(true) // sub-pixel rounding at the bottom
    expect(atEnd(2100, 800, 3000)).toBe(false)
    expect(atEnd(0, 800, 640)).toBe(true)
  })
})

describe('a visit', () => {
  // six verses of 100 words: 600 words, 144 s at 250 words a minute
  const shape: Shape = { verses: [1, 2, 3, 4, 5, 6], words: [100, 100, 100, 100, 100, 100] }
  it('earns the time since the last beat, capped at 20 s, only while counting', () => {
    expect(earned(null, 10_000, true)).toBe(0)
    // a second short, in whole seconds: the server sees 15 s beats arrive 14.99 s apart
    expect(earned(0, 15_000, true)).toBe(14_000)
    expect(earned(0, 12_900, true)).toBe(11_000)
    expect(earned(0, 500, true)).toBe(0)
    expect(earned(0, 60_000, true)).toBe(MAX_BEAT_MS)
    expect(earned(0, 12_000, false)).toBe(0)
  })
  it('names the parts away from the screen that are still to read, never the ones on it', () => {
    const v = newVisit(57, 1)
    v.through = { ...freshThrough(shape), seen: [100, 100, 0, 0, 0, 0], activeMs: 60_000 }
    noteScreen(v, shape, [6, 6], 0, false)
    // verses 3 to 5 went by unseen; 6 is on screen now and is being read
    expect(estimate(v, shape, 0)).toEqual({ ms: null, gaps: [[3, 5]] })
    v.screen = [4, 6]
    expect(estimate(v, shape, 0).gaps).toEqual([[3, 3]])
  })
  it('with only the screen left to take in, counts down the longer of that and the time owing', () => {
    const v = newVisit(57, 1)
    v.through = { ...freshThrough(shape), seen: [100, 100, 100, 100, 100, 0], activeMs: 140_000 }
    v.screen = [6, 6]
    // 100 words at a glance's 80 ms each: 8 s, longer than the 4 s still owing
    expect(estimate(v, shape, 0)).toEqual({ ms: 8_000, gaps: [] })
    // 5 s later the glance has taken 62 of them in
    expect(estimate(v, shape, 5_000)).toEqual({ ms: 38 * 80, gaps: [] })
    v.through = { ...v.through, seen: [100, 100, 100, 100, 100, 100], activeMs: 120_000 }
    expect(estimate(v, shape, 0)).toEqual({ ms: 24_000, gaps: [] })
    expect(estimate(v, shape, 24_000)).toEqual({ ms: 0, gaps: [] })
  })
  describe('the glance, a look each second', () => {
    const small: Shape = { verses: [1, 2, 3, 4], words: [10, 10, 10, 40] }
    /** Looks each second for `secs` seconds at screen `r`, from the clock `t`; the clock after. */
    const dwell = (v: ReturnType<typeof newVisit>, r: [number, number], secs: number, t: number, counting = true) => { for (let i = 1; i <= secs; i++) noteScreen(v, small, r, t + i * 1000, counting); return t + secs * 1000 }
    it('sees a verse once it has been on screen long enough for its words, in reading order', () => {
      const v = newVisit(19, 1)
      noteScreen(v, small, [1, 4], 0, true)
      let t = dwell(v, [1, 4], 2, 0)
      // 2 s at 80 ms a word: 25 words, verses 1 and 2 whole and half of 3
      expect(v.seen).toEqual([[1, 2]])
      expect(v.glance.taken.get(3)).toBe(5)
      t = dwell(v, [1, 4], 4, t)
      expect(v.seen).toEqual([[1, 4]])
    })
    it('does not see what a fling carried past, nor anything while the time is not counting', () => {
      const v = newVisit(19, 1)
      noteScreen(v, small, [1, 1], 0, true)
      noteScreen(v, small, [1, 4], 300, true)
      noteScreen(v, small, [4, 4], 400, true)
      expect(v.seen).toEqual([])
      dwell(v, [1, 4], 10, 400, false)
      expect(v.seen).toEqual([])
    })
    it('sends again a verse seen here that the chapter still has short', () => {
      const v = newVisit(19, 1)
      noteScreen(v, small, [1, 2], 0, true)
      dwell(v, [1, 2], 2, 0)
      takeEvidence(v, small)
      // the beat that carried verses 1-2 held only 15 of their 20 words
      adopt(v, { ...freshThrough(small), seen: [10, 5, 0, 0], activeMs: 2_000 }, small)
      expect(takeEvidence(v, small).seen).toEqual([[2, 2]])
    })
  })
  it('hands a beat what went past since the last, and takes it back if the beat is lost', () => {
    const v = newVisit(57, 1)
    v.seen = [[1, 3]]; noteHeard(v, 4)
    const ev = takeEvidence(v)
    expect([ev.seen, ev.heard, v.seen, v.heard]).toEqual([[[1, 3]], [[4, 4]], [], []])
    v.seen = [[5, 5]]
    ev.restore()
    expect([v.seen, v.heard]).toEqual([[[1, 3], [5, 5]], [[4, 4]]])
  })
})
