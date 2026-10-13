import { describe, it, expect } from 'vitest'
import { FEATHER_MAX, REVEAL_FLOOR, REVEAL_MS, REVEAL_R0, REVEAL_SAME, planReveal, revealAt, revealShown, veilAtDistance } from '../client/src/lib/themeReveal'
import { VEIL_MAX, veilStart } from '../client/src/lib/themeFade'

const PAPER = '#faf7f2', SEPIA = '#f3e9d4', BLACK = '#000000', SLATE = '#1c1917'
const W = 412, H = 915

describe('theme reveal', () => {
  const p = planReveal({ x: 60, y: 700 }, W, H, PAPER, BLACK)
  it('runs 350-500 ms and ends past the farthest corner', () => {
    expect(REVEAL_MS).toBeGreaterThanOrEqual(350)
    expect(REVEAL_MS).toBeLessThanOrEqual(500)
    expect(p.r1).toBeGreaterThanOrEqual(Math.hypot(W - 60, 700) + FEATHER_MAX)
    const end = revealAt(p, REVEAL_MS)
    expect(end.done).toBe(true)
    for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]]) expect(veilAtDistance(p, REVEAL_MS, Math.hypot(cx - 60, cy - 700))).toBe(0)
  })
  it('answers the tap in the first frame: the swatch under the finger is already clear', () => {
    expect(REVEAL_R0).toBeGreaterThanOrEqual(30)
    expect(veilAtDistance(p, 0, 20)).toBe(0)
  })
  it('never covers the words: the veil starts where the plain crossfade does and only thins', () => {
    expect(p.a0).toBe(veilStart(PAPER, BLACK))
    expect(p.a0).toBeLessThanOrEqual(VEIL_MAX)
    let last = Infinity
    for (let ms = 0; ms <= REVEAL_MS; ms += 10) { const a = revealAt(p, ms).a; expect(a).toBeLessThanOrEqual(last); last = a }
  })
  it('spreads from the tap: near points settle before far ones, and none un-settles', () => {
    const settleAt = (d: number) => { for (let ms = 0; ms <= REVEAL_MS; ms++) if (veilAtDistance(p, ms, d) < 0.01) return ms; return REVEAL_MS }
    const near = settleAt(80), mid = settleAt(400), far = settleAt(900)
    expect(near).toBeLessThan(mid)
    expect(mid).toBeLessThan(far)
    expect(far - near).toBeGreaterThan(120)
    for (const d of [80, 400, 900]) {
      let last = Infinity
      for (let ms = 0; ms <= REVEAL_MS; ms += 5) { const a = veilAtDistance(p, ms, d); expect(a).toBeLessThanOrEqual(last + 1e-9); last = a }
    }
  })
  it('reads as spreading even between near pages, and breathes lightly when only the ink changes', () => {
    expect(planReveal({ x: 0, y: 0 }, W, H, PAPER, SEPIA).a0).toBe(REVEAL_FLOOR)
    expect(planReveal({ x: 0, y: 0 }, W, H, BLACK, BLACK).a0).toBe(REVEAL_SAME)
    expect(planReveal({ x: 0, y: 0 }, W, H, SLATE, PAPER).a0).toBe(VEIL_MAX)
  })
  it('keeps the origin on the screen and scales with animation speed', () => {
    const q = planReveal({ x: -50, y: 5000 }, W, H, PAPER, BLACK)
    expect([q.x, q.y]).toEqual([0, H])
    // a second reveal mid-run starts from what the screen mostly shows, between the two pages
    const s = revealShown(planReveal({ x: 0, y: 0 }, W, H, PAPER, BLACK, 0, 1), 100, W, H)
    expect(s).not.toBe(PAPER)
    expect(s).not.toBe(BLACK)
    expect(revealShown(planReveal({ x: 0, y: 0 }, W, H, PAPER, BLACK, 0, 1), REVEAL_MS, W, H)).toBe(BLACK)
    expect(revealShown(planReveal({ x: 0, y: 0 }, W, H, PAPER, BLACK, 0, 2), REVEAL_MS / 2, W, H)).toBe(BLACK)
  })
})
