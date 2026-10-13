import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { DOCK_SPRING, FILL_SPRING, SETTLE_SPRING, dampingRatio, fromOrigami, slideMs, springAt, springPeak, springSettleMs, waveStep, type SpringCfg } from '../client/src/lib/springs'

/** Semi-implicit Euler at 0.1 ms from rest at 0 toward 1, sampled at `ms`. */
function simulate(cfg: SpringCfg, ms: number): number {
  const m = cfg.mass ?? 1
  let x = 0, v = 0
  for (let i = 0; i < ms * 10; i++) { v += ((-cfg.stiffness * (x - 1) - cfg.damping * v) / m) * 1e-4; x += v * 1e-4 }
  return x
}
const reach = (cfg: SpringCfg, f: number) => { for (let ms = 0; ms < 3000; ms++) if (springAt(cfg, ms) >= f) return ms; return Infinity }

describe('spring maths', () => {
  it('converts friction and tension as core Animated does', () => {
    // SpringConfig.js: stiffness (t - 30) * 3.62 + 194, damping (f - 8) * 3 + 25; its default 7 / 40 is 230.2 / 22
    expect(fromOrigami(7, 40).stiffness).toBeCloseTo(230.2)
    expect(fromOrigami(7, 40).damping).toBe(22)
  })
  it('matches a simulation in all three regimes', () => {
    for (const cfg of [{ stiffness: 200, damping: 20 }, { stiffness: 400, damping: 40 }, { stiffness: 300, damping: 60 }]) {
      for (const ms of [16, 50, 120, 300]) expect(springAt(cfg, ms)).toBeCloseTo(simulate(cfg, ms), 2)
    }
  })
  it('peaks where the closed form says', () => {
    const cfg = { stiffness: 200, damping: 20 }
    let top = 0
    for (let ms = 0; ms < 1500; ms++) top = Math.max(top, springAt(cfg, ms))
    expect(top - 1).toBeCloseTo(springPeak(cfg), 3)
  })
})

describe('reader springs', () => {
  it('docks without rising past the edge, unhurried but never late', () => {
    const old = fromOrigami(9, 85)
    expect(springPeak(old)).toBeGreaterThan(0.04)   // the strip of page the old dock opened under the bar
    expect(dampingRatio(DOCK_SPRING)).toBeGreaterThanOrEqual(1)
    expect(springPeak(DOCK_SPRING)).toBe(0)
    expect(reach(DOCK_SPRING, 0.9)).toBeLessThanOrEqual(reach(old, 0.9) + 30)
    expect(reach(DOCK_SPRING, 0.95)).toBeLessThanOrEqual(200)
    expect(springSettleMs(DOCK_SPRING)).toBeLessThanOrEqual(290)
    expect(springSettleMs(DOCK_SPRING)).toBeLessThan(springSettleMs(old))
  })
  it('settles a page without swinging past its rest, and sooner', () => {
    const old = { stiffness: 200, damping: 20 }
    expect(springPeak(old)).toBeGreaterThan(0.04)
    expect(springPeak(SETTLE_SPRING)).toBe(0)
    expect(reach(SETTLE_SPRING, 0.95)).toBeLessThanOrEqual(reach(old, 0.95) + 20)
    expect(springSettleMs(SETTLE_SPRING)).toBeLessThan(springSettleMs(old) - 100)
  })
  it('fills a picked cell with little bounce', () => {
    expect(springPeak(fromOrigami(6, 180))).toBeGreaterThan(0.3)
    expect(springPeak(FILL_SPRING)).toBeLessThan(0.05)
    expect(springSettleMs(FILL_SPRING)).toBeLessThanOrEqual(260)
  })
  it('is what both pagers and paged mode read', () => {
    const reader = readFileSync(new URL('../client/src/components/motion/reader.tsx', import.meta.url), 'utf8')
    expect(reader).toContain("export { SETTLE_SPRING } from '../../lib/springs'")
    expect(reader).toContain('...DOCK_SPRING')
    const flip = readFileSync(new URL('../client/app/flip/[book]/[chapter].tsx', import.meta.url), 'utf8')
    expect(flip).toContain('withSpring(rest, scaleSpringParams(SETTLE_SPRING')
  })
})

describe('slides', () => {
  it('takes the whole time for a whole page and a share for a share, never under the floor', () => {
    expect(slideMs(1, 240, 140)).toBe(240)
    expect(slideMs(0.75, 240, 140)).toBe(180)
    expect(slideMs(0.1, 240, 140)).toBe(140)
    expect(slideMs(0, 240, 140)).toBe(140)
    expect(slideMs(1.6, 240, 140)).toBe(240)
    expect(slideMs(-0.5, 240, 140)).toBe(140)
  })
})

describe('picker wave', () => {
  it('starts its last cell within the span whatever the count', () => {
    for (let n = 1; n <= 150; n++) expect(waveStep(n) * (n - 1)).toBeLessThanOrEqual(240)
  })
  it('steps the full 18 ms on short grids and never stands still on long ones', () => {
    expect(waveStep(1)).toBe(0)
    expect(waveStep(4)).toBe(18)
    expect(waveStep(66)).toBe(3)
    expect(waveStep(150)).toBe(1)
  })
})
