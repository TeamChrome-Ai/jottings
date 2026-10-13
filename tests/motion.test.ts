import { describe, it, expect } from 'vitest'
import { CONTROL_SPRING, EXIT_MS, PRESS_IN_MS, RELEASE_SPRING, RISE_SPRING, SCRIM_IN_MS, POP_SPRING, springShape } from '../client/src/lib/motion'
import { RING_SPRING, RING_STROKE, ringAt } from '../client/src/lib/themeFade'
import { RING_LEAD_SPRING, RING_TRAIL_SPRING, WOBBLE_SPRING, springAt, springSettleMs } from '../client/src/lib/springs'
import { HOUSE_TEMPO, SLOW_TEMPO, TURN_TEMPO, scaleMs, scaleSpringParams } from '../client/src/lib/motionSpeed'
import { SETTLE_SPRING } from '../client/src/lib/springs'
import { THEME_FADE_MS } from '../client/src/lib/themeFade'
import { REVEAL_MS } from '../client/src/lib/themeReveal'
import { readFileSync } from 'node:fs'

describe('house springs', () => {
  it('release: crisp, a trace over, still by ~160 ms', () => {
    const s = springShape(RELEASE_SPRING)
    expect(s.overshoot).toBeGreaterThan(0)
    expect(s.overshoot).toBeLessThan(0.01)
    expect(s.settledMs).toBeLessThan(180)
    expect(s.reach90Ms).toBeLessThan(120)
  })
  it('pop (marks, Grow): a small overshoot, never a wobble', () => {
    const s = springShape(POP_SPRING)
    expect(s.overshoot).toBeGreaterThan(0.02)
    expect(s.overshoot).toBeLessThan(0.08)
    expect(s.settledMs).toBeLessThan(320)
  })
  it('control (thumbs, pills): tight, settled by ~260 ms', () => {
    const s = springShape(CONTROL_SPRING)
    expect(s.overshoot).toBeLessThan(0.02)
    expect(s.settledMs).toBeLessThan(260)
  })
  it('rise (sheets, toasts): unhurried, and arrives without lifting past its rest', () => {
    const s = springShape(RISE_SPRING)
    expect(s.overshoot).toBeLessThan(0.005)
    expect(s.reach90Ms).toBeLessThan(240)
    expect(s.settledMs).toBeLessThan(400)
  })
  it('the theme ring is springier than the controls but as quick', () => {
    const r = springShape(RING_SPRING), c = springShape(CONTROL_SPRING)
    expect(r.overshoot).toBeGreaterThan(c.overshoot)
    expect(r.reach90Ms).toBeLessThanOrEqual(c.reach90Ms + 10)
  })
  it('a press answers at once; scrims and exits stay short', () => {
    expect(PRESS_IN_MS).toBeLessThanOrEqual(100)
    for (const ms of [SCRIM_IN_MS, EXIT_MS]) expect(ms).toBeLessThanOrEqual(300)
  })
})

describe('the wobble (button releases)', () => {
  it('springs past rest by 15-25% and is still (1%) under 250 ms', () => {
    const s = springShape(WOBBLE_SPRING)
    expect(s.overshoot).toBeGreaterThan(0.15)
    expect(s.overshoot).toBeLessThan(0.25)
    expect(s.settledMs).toBeLessThan(250)
  })
  it('is quicker off the mark than the crisp release it replaces on buttons', () => {
    expect(springShape(WOBBLE_SPRING).reach90Ms).toBeLessThan(springShape(RELEASE_SPRING).reach90Ms)
  })
})

describe('the theme strip ring: outer edge leads, the hole trails', () => {
  const at = (cfg: typeof RING_LEAD_SPRING, ms: number) => springAt(cfg, ms)
  it('the hole trails visibly when opening, and both are still by ~250 ms', () => {
    const half = (cfg: typeof RING_LEAD_SPRING) => { let t = 0; while (at(cfg, t) < 0.5) t++; return t }
    expect(half(RING_TRAIL_SPRING) - half(RING_LEAD_SPRING)).toBeGreaterThan(12)
    for (const cfg of [RING_LEAD_SPRING, RING_TRAIL_SPRING]) expect(springSettleMs(cfg, 0.01)).toBeLessThanOrEqual(250)
  })
  it('the hole is never wider than the accent around it, opening or closing', () => {
    for (let ms = 0; ms <= 400; ms++) {
      // opening: outer on the lead, hole on the trail
      const o = ringAt(at(RING_LEAD_SPRING, ms)).outer, i = ringAt(Math.max(0, at(RING_TRAIL_SPRING, ms))).inner
      expect(o - i).toBeGreaterThan(RING_STROKE - 0.5)
      // closing: the hole leads down, the outer edge trails
      const oc = ringAt(1 - at(RING_TRAIL_SPRING, ms)).outer, ic = ringAt(Math.max(0, 1 - at(RING_LEAD_SPRING, ms))).inner
      expect(oc - ic).toBeGreaterThan(RING_STROKE - 0.5)
    }
  })
})

describe('what 1x plays (the house tempo applied)', () => {
  const at = (cfg: { stiffness: number; damping: number; mass: number }, tempo: number) => springShape(scaleSpringParams(cfg, tempo))
  it('everything else runs at 0.7: timings 1/0.7 as long, springs 1/0.7 as long with the same overshoot', () => {
    expect(scaleMs(PRESS_IN_MS, HOUSE_TEMPO)).toBeCloseTo(129, 0)
    for (const cfg of [WOBBLE_SPRING, RELEASE_SPRING, POP_SPRING, CONTROL_SPRING, RISE_SPRING]) {
      const a = springShape(cfg), b = at(cfg, HOUSE_TEMPO)
      expect(b.overshoot).toBeCloseTo(a.overshoot, 6)
      expect(b.settledMs / a.settledMs).toBeCloseTo(1 / 0.7, 1)
    }
    // the wobble: still about a fifth past rest, and still in ~300 ms
    const w = at(WOBBLE_SPRING, HOUSE_TEMPO)
    expect(w.overshoot).toBeGreaterThan(0.15)
    expect(w.overshoot).toBeLessThan(0.25)
    expect(w.settledMs).toBeLessThan(320)
  })
  it('the theme ring opens and closes at half the speed it had: twice the settle time', () => {
    for (const cfg of [RING_LEAD_SPRING, RING_TRAIL_SPRING]) {
      expect(springSettleMs(scaleSpringParams(cfg, SLOW_TEMPO), 0.01)).toBeCloseTo(2 * springSettleMs(cfg, 0.01), -1)
      expect(springSettleMs(scaleSpringParams(cfg, SLOW_TEMPO), 0.01)).toBeLessThanOrEqual(500)
    }
  })
})

describe('the turns, the tab fade and the theme changes at 1x', () => {
  it('chapter turns release at half speed: a full turn 600 ms, a flick at least 280 ms, the snap back half as quick', () => {
    // motion/reader.tsx imports react-native; its numbers are read from the source
    const src = readFileSync(new URL('../client/src/components/motion/reader.tsx', import.meta.url), 'utf8')
    const TURN = Number(/export const TURN_MS = (\d+)/.exec(src)![1]), MIN = Number(/export const TURN_MIN_MS = (\d+)/.exec(src)![1])
    expect(scaleMs(TURN, TURN_TEMPO)).toBe(600)
    expect(scaleMs(MIN, TURN_TEMPO)).toBe(280)
    expect(springSettleMs(scaleSpringParams(SETTLE_SPRING, TURN_TEMPO), 0.01)).toBeCloseTo(2 * springSettleMs(SETTLE_SPRING, 0.01), -1)
  })
  it('tabs crossfade in 400 ms; the quick theme crossfade and the bloom run at the house tempo', () => {
    const tabs = readFileSync(new URL('../client/app/(tabs)/_layout.tsx', import.meta.url), 'utf8')
    expect(scaleMs(Number(/const TAB_FADE_MS = (\d+)/.exec(tabs)![1]), SLOW_TEMPO)).toBe(400)
    expect(scaleMs(THEME_FADE_MS, HOUSE_TEMPO)).toBeCloseTo(314, 0)
    expect(scaleMs(REVEAL_MS, HOUSE_TEMPO)).toBeCloseTo(657, 0)
  })
})
