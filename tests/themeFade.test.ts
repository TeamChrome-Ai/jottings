import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { RING, RING_SPRING, RING_STROKE, DOT, THEME_FADE_MS, THEME_FADE_NEAR_MS, VEIL_MAX, blend, deltaE, easeOut, planVeil, ringAt, veilAt, veilMs, veilStart } from '../client/src/lib/themeFade'

// theme.ts pulls in react-native; the page colours are copied here and checked against its source below
const BG: Record<string, string> = {
  paper: '#faf7f2', sepia: '#f3e9d4', linen: '#f3f0ea', sand: '#faf3e3', mint: '#ecf5ef', sky: '#edf3fb', rose: '#fbf0f2',
  lavender: '#f3f0fb', olive: '#f2f3ea', slate: '#1c1917', midnight: '#0e1628', forest: '#0e1d16', wine: '#1d0e13',
  nord: '#2e3440', plum: '#272433', graphite: '#1f1f1f', ocean: '#0a1b23', black: '#000000',
}
const LIGHT = ['paper', 'sepia', 'linen', 'sand', 'mint', 'sky', 'rose', 'lavender', 'olive']
const DARK = ['slate', 'midnight', 'forest', 'wine', 'nord', 'plum', 'graphite', 'ocean', 'black']

describe('theme veil', () => {
  it('uses the page colours theme.ts has', () => {
    const src = readFileSync(new URL('../client/src/theme.ts', import.meta.url), 'utf8')
    for (const [, id, bg] of src.matchAll(/id: '([a-z-]+)', name: '[^']+', group: '[a-z]+', bg: '(#[0-9a-f]{6})'/g)) expect(BG[id]).toBe(bg)
    expect(src).toContain("bg: '#000000'")
  })
  it('never starts as a bare page: at most where a true crossfade stands one frame in', () => {
    expect(VEIL_MAX).toBeCloseTo(1 - easeOut(1000 / 60 / THEME_FADE_MS), 1)
    for (const a of Object.values(BG)) for (const b of Object.values(BG)) expect(veilStart(a, b)).toBeLessThanOrEqual(VEIL_MAX)
  })
  it('goes up fully between light and dark pages, and not at all between the black ones', () => {
    for (const l of LIGHT) for (const d of DARK) {
      expect(veilStart(BG[l], BG[d])).toBe(VEIL_MAX)
      expect(veilStart(BG[d], BG[l])).toBe(VEIL_MAX)
    }
    expect(veilStart('#000000', '#000000')).toBe(0)
  })
  it('stays at a fifth or less within a family, so the words barely dim, and short', () => {
    for (const fam of [LIGHT, DARK]) for (const a of fam) for (const b of fam) {
      expect(veilStart(BG[a], BG[b])).toBeLessThanOrEqual(0.2)
      expect(veilMs(veilStart(BG[a], BG[b]))).toBe(THEME_FADE_NEAR_MS)
    }
    expect(veilStart(BG.paper, BG.linen)).toBe(0)
    expect(veilStart(BG.paper, BG.sepia)).toBeGreaterThan(0)
    expect(deltaE(BG.paper, BG.paper)).toBe(0)
  })
  it('eases out from its start to nothing in THEME_FADE_MS, and no longer than 250 ms', () => {
    expect(THEME_FADE_MS).toBeLessThanOrEqual(250)
    expect(veilMs(VEIL_MAX)).toBe(THEME_FADE_MS)
    expect(veilAt(0.8, 0)).toBeCloseTo(0.8)
    expect(veilAt(0.8, THEME_FADE_MS)).toBe(0)
    expect(veilAt(0.8, THEME_FADE_MS * 2)).toBe(0)
    let last = 1
    for (let ms = 0; ms <= THEME_FADE_MS; ms += 10) { const v = veilAt(0.8, ms); expect(v).toBeLessThanOrEqual(last); last = v }
    // ease-out: half gone in well under half the time
    expect(veilAt(1, THEME_FADE_MS * 0.25)).toBeLessThan(0.5)
  })
  it('a second change mid-fade starts from what the screen shows, not from the old page', () => {
    const first = planVeil(BG.paper, BG.slate, 0, null)!
    expect(first.from).toBe(BG.paper)
    const second = planVeil(BG.slate, BG.midnight, 60, first)
    const shown = blend(BG.slate, BG.paper, veilAt(first.a0, 60))
    expect(second?.from).toBe(shown)
    // and a change straight back needs less veil than the first, since the screen still mostly shows that page
    const back = planVeil(BG.slate, BG.paper, 1, first)
    expect(back === null || back.a0 < first.a0).toBe(true)
  })
  it('blends in plain sRGB', () => {
    expect(blend('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(blend('#123456', '#abcdef', 0)).toBe('#123456')
    expect(blend('#123456', '#abcdef', 1)).toBe('#abcdef')
  })
})

describe('theme strip ring', () => {
  it('rests as the dot and as the ring', () => {
    expect(ringAt(0)).toEqual({ outer: DOT / 2, inner: 0 })
    expect(ringAt(1)).toEqual({ outer: RING / 2, inner: RING / 2 - RING_STROKE })
  })
  it('keeps a band of accent all the way, thinning from the dot to the stroke', () => {
    let last = Infinity
    for (let s = -0.1; s <= 1.1; s += 0.01) {
      const { outer, inner } = ringAt(s)
      expect(outer - inner).toBeGreaterThanOrEqual(RING_STROKE - 0.5)
      expect(inner).toBeGreaterThanOrEqual(0)
      // an undershoot below the dot only shrinks the dot; from the dot on, the band thins steadily to the stroke
      if (s < 0) continue
      expect(outer - inner).toBeLessThanOrEqual(last + 1e-9)
      last = outer - inner
    }
  })
  it('never opens the hole past the chip, even at the spring peak', () => {
    const peak = springPeak()
    expect(ringAt(1 + peak).inner).toBeLessThan(48 / 2 - 1)
    // and the overhang stays inside the strip's 6 px padding
    expect(ringAt(1 + peak).outer - 48 / 2).toBeLessThan(6)
  })
  it('springs tight: most of the way in ~120 ms, a few percent over, settled by ~260 ms', () => {
    const run = simulate()
    const at = (ms: number) => run[Math.round(ms)]
    expect(at(120)).toBeGreaterThan(0.85)
    expect(springPeak()).toBeGreaterThan(0.01)
    expect(springPeak()).toBeLessThan(0.06)
    for (let ms = 260; ms < run.length; ms++) expect(Math.abs(run[ms] - 1)).toBeLessThan(0.01)
  })
})

/** RING_SPRING from 0 to 1, sampled every millisecond (semi-implicit Euler at 0.1 ms). */
function simulate(): number[] {
  const { stiffness: k, damping: c, mass: m } = RING_SPRING
  let x = 0, v = 0
  const out: number[] = []
  for (let i = 0; i < 6000; i++) {
    if (i % 10 === 0) out.push(x)
    const a = (-k * (x - 1) - c * v) / m
    v += a * 1e-4
    x += v * 1e-4
  }
  return out
}
function springPeak(): number { return Math.max(...simulate()) - 1 }
