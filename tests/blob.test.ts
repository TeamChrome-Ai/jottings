import { describe, it, expect } from 'vitest'
import { BLOB_FADE_MS, BLOB_MS, blobAt, planBlob } from '../client/src/lib/blob'

const VIEW = { x: 0, y: 0, w: 412, h: 915 }
const SWATCH = { x: 30, y: 640, w: 80, h: 58 }

describe('theme blob', () => {
  const p = planBlob(SWATCH, VIEW)
  it('starts as the swatch itself, then rounds up as it lifts', () => {
    const f = blobAt(p, 0)
    expect(f.along * p.size).toBeCloseTo(SWATCH.w)
    expect(f.across * p.size).toBeCloseTo(SWATCH.h)
    const lifted = blobAt(p, BLOB_MS.lift - 0.001)
    expect(lifted.along).toBeCloseTo(lifted.across, 2)
  })
  it('lifts off where the swatch is and lands in the middle of the screen', () => {
    expect(blobAt(p, 0)).toMatchObject({ x: 70, y: 669, blob: 1, spread: 0 })
    const landed = blobAt(p, BLOB_MS.fly)
    expect(landed.x).toBeCloseTo(206)
    expect(landed.y).toBeCloseTo(457.5)
  })
  it('flies one arc, bowed out to the side away from the swatch', () => {
    const mid = blobAt(p, (BLOB_MS.lift + BLOB_MS.fly) / 2)
    // a swatch on the left swings out past the straight line towards the right before coming in
    const straightX = 70 + (206 - 70) * ((669 - mid.y) / (669 - 457.5))
    expect(mid.x).toBeGreaterThan(straightX)
    expect(mid.x).toBeLessThan(VIEW.w)
  })
  it('stretches along its path in flight and squashes on landing, then settles round', () => {
    const mid = blobAt(p, (BLOB_MS.lift + BLOB_MS.fly) / 2)
    expect(mid.along).toBeGreaterThan(mid.across)
    expect(mid.along * mid.across).toBeCloseTo(1.12 * 1.12, 5)
    const squash = blobAt(p, (BLOB_MS.fly + BLOB_MS.land) / 2)
    expect(squash.along).toBeGreaterThan(1.2)
    expect(squash.across).toBeLessThan(1)
  })
  it('spreads until it covers the farthest corner, and is quick about all of it', () => {
    const end = blobAt(p, BLOB_MS.spread)
    expect(end.blob).toBe(0)
    expect(end.spread).toBeGreaterThanOrEqual(Math.hypot(206, 457.5))
    expect(blobAt(p, BLOB_MS.land + 1).spread).toBeLessThan(p.size)
    expect(BLOB_MS.spread + BLOB_FADE_MS).toBeLessThan(1000)
  })
  it('never lands off screen, from any swatch', () => {
    for (const s of [{ x: 330, y: 820, w: 60, h: 60 }, { x: 180, y: 20, w: 48, h: 48 }, { x: 0, y: 457, w: 40, h: 40 }]) {
      const q = planBlob(s, VIEW)
      for (let t = 0; t <= BLOB_MS.fly; t += 10) {
        const f = blobAt(q, t)
        expect(f.x).toBeGreaterThan(-q.size); expect(f.x).toBeLessThan(VIEW.w + q.size)
        expect(f.y).toBeGreaterThan(-q.size); expect(f.y).toBeLessThan(VIEW.h + q.size)
      }
    }
  })
})
