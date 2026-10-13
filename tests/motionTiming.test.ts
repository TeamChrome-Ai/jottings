import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CELL_MS, COUNT_MS, FILL_MS, FOCUS_MS, LIVELY_SPRING, PULSE, ROW_MS, SNAP_SPRING, STAGGER_CAP, STAGGER_STEP, SWAP_MS, WASH,
  fromOrigami, lateDelay, rowDelay, springFeel, staggerDelay, staggerEnd,
} from '../client/src/lib/motionTiming'

const src = (p: string) => readFileSync(new URL(`../client/${p}`, import.meta.url), 'utf8')

describe('screen motion timing', () => {
  it('staggers the head of a list and lands it by ~420 ms', () => {
    expect(staggerDelay(0)).toBe(0)
    expect(staggerDelay(3)).toBe(3 * STAGGER_STEP)
    expect(staggerDelay(STAGGER_CAP - 1, undefined, undefined, 140)).toBe(140 + (STAGGER_CAP - 1) * STAGGER_STEP)
    expect(staggerDelay(STAGGER_CAP)).toBeNull()
    expect(staggerEnd(0)).toBe(0)
    expect(staggerEnd(1)).toBe(ROW_MS)
    expect(staggerEnd(100)).toBe(staggerEnd(STAGGER_CAP))
    expect(staggerEnd(100)).toBeLessThanOrEqual(500)
  })

  it('staggers the first eight rows and brings the rest in with the eighth', () => {
    expect([0, 1, 7].map(i => rowDelay(i))).toEqual([0, STAGGER_STEP, 7 * STAGGER_STEP])
    expect(rowDelay(8)).toBe(rowDelay(STAGGER_CAP - 1))
    expect(rowDelay(40, 100)).toBe(100 + (STAGGER_CAP - 1) * STAGGER_STEP)
    // every list entrance goes through it: rows, the arrivals of a first load, the reader's sheet rows
    expect(src('src/components/motion/nav.tsx')).toContain('rowDelay(index, base, cap, step)')
    expect(src('src/components/motion/community.tsx')).toContain('rowDelay(i, 0, cap, step)')
    expect(src('src/components/motion/reader.tsx')).toContain('export { rowDelay }')
  })

  it('never makes late content wait out a delay meant for mount', () => {
    expect(lateDelay(220, 0)).toBe(220)
    expect(lateDelay(220, 100)).toBe(120)
    expect(lateDelay(220, 220)).toBe(0)
    expect(lateDelay(220, 5000)).toBe(0)
    expect(lateDelay(220, -50)).toBe(220)
  })

  it('keeps every tap-driven motion within ~300 ms and a count-up under 400', () => {
    expect(COUNT_MS).toBeLessThan(400)
    for (const ms of [ROW_MS, CELL_MS, FILL_MS, SWAP_MS, FOCUS_MS, PULSE.ringMs]) expect(ms).toBeLessThanOrEqual(300)
    expect(PULSE.bumpMs + springFeel(SNAP_SPRING).settleMs).toBeLessThanOrEqual(320)
    expect(WASH.inMs + WASH.outMs).toBeLessThanOrEqual(320)
  })

  it('snaps with no bounce the eye can find and lets the lively spring swing once', () => {
    const snap = springFeel(SNAP_SPRING)
    expect(snap.overshoot).toBeLessThan(0.05)
    expect(snap.settleMs).toBeLessThanOrEqual(230)
    const lively = springFeel(LIVELY_SPRING)
    expect(lively.overshoot).toBeGreaterThan(0.1)
    expect(lively.overshoot).toBeLessThan(0.2)
    expect(lively.settleMs).toBeLessThanOrEqual(340)
  })

  it('reads friction and tension the way Animated does', () => {
    const tap = fromOrigami(6, 220)
    expect(tap.stiffness).toBeCloseTo(881.8, 6)
    expect(tap.damping).toBe(19)
    expect(fromOrigami(8, 30)).toEqual({ stiffness: 194, damping: 25, mass: 1 })
    // the old press, pop and swap springs swung 15 to 35% past their mark; the snap spring replaces them here
    for (const [f, t] of [[6, 220], [6, 110], [7, 140]]) expect(springFeel(fromOrigami(f, t)).overshoot).toBeGreaterThan(0.15)
  })

  it('has no friction/tension springs or timings past 300 ms left in the screen motion helpers', () => {
    for (const f of ['src/components/motion/nav.tsx', 'src/components/motion/home.tsx', 'src/components/motion/badges.tsx', 'src/components/motion/community.tsx', 'src/components/StreakCard.tsx']) {
      const s = src(f)
      expect(s, f).not.toMatch(/friction:/)
      for (const [, ms] of s.matchAll(/(?:duration: |timing\()(\d+)/g)) expect(Number(ms), `${f}: ${ms} ms`).toBeLessThanOrEqual(300)
    }
  })
})
