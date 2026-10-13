/**
 * The tour's theme change as numbers: a swatch lifts off as a blob of the new page colour, flies one arc to the middle
 * of the screen with a little stretch along its path, squashes as it lands and spreads until it covers the page; the
 * theme is applied under it and it fades. Pure, and 'worklet' so the native build runs it on the UI thread
 * (tests/blob.test.ts).
 */
export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

/** Phase ends, ms from the tap: lift, flight, landing, spread. The page is covered at `spread`. */
export const BLOB_MS = { lift: 90, fly: 420, land: 470, spread: 720 } as const
/** The fade that uncovers the new theme, once it has been applied underneath. */
export const BLOB_FADE_MS = 180

/** `fw`/`fh`: the swatch's own size, which the blob starts as before it rounds up to `size`. */
export interface BlobPlan { from: Pt; to: Pt; ctrl: Pt; size: number; fw: number; fh: number; cover: number }

/** The flight for a swatch at `from` in a `view`-sized window. */
export function planBlob(from: Rect, view: Rect): BlobPlan {
  const a = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
  const b = { x: view.x + view.w / 2, y: view.y + view.h / 2 }
  const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 1
  // the arc bows away from the side the swatch sits on, so the blob swings out and comes in to land
  const px = -dy / dist, py = dx / dist
  const side = (a.x < b.x ? 1 : -1) * (px >= 0 ? 1 : -1)
  const bow = Math.min(0.45 * dist, view.w * 0.3)
  const ctrl = { x: (a.x + b.x) / 2 + px * bow * side, y: (a.y + b.y) / 2 + py * bow * side }
  const size = Math.max(28, Math.min(64, Math.min(from.w, from.h)))
  // the spread is centred on the landing point and must reach the farthest corner
  const cover = Math.hypot(Math.max(b.x - view.x, view.x + view.w - b.x), Math.max(b.y - view.y, view.y + view.h - b.y)) + 2
  return { from: a, to: b, ctrl, size, fw: from.w, fh: from.h, cover }
}

const inOut = (t: number) => { 'worklet'; return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2 }
const out = (t: number) => { 'worklet'; return 1 - (1 - t) ** 3 }
const clamp01 = (t: number) => { 'worklet'; return Math.max(0, Math.min(1, t)) }
function bez(p: BlobPlan, s: number): Pt {
  'worklet'
  const u = 1 - s
  return { x: u * u * p.from.x + 2 * u * s * p.ctrl.x + s * s * p.to.x, y: u * u * p.from.y + 2 * u * s * p.ctrl.y + s * s * p.to.y }
}

export interface BlobFrame {
  /** Centre of the flying blob, its heading (radians) and its scale along and across that heading. */
  x: number; y: number; angle: number; along: number; across: number
  /** The flying blob shows until the spread takes over; its accent core fades as it lands. */
  blob: number; core: number
  /** Radius of the spreading disc (0 before it starts). */
  spread: number
}

/** Where everything is `t` ms after the tap. */
export function blobAt(p: BlobPlan, t: number): BlobFrame {
  'worklet'
  const { lift, fly, land, spread } = BLOB_MS
  const r0 = p.size / 2
  if (t < lift) {
    // it starts as the swatch itself and draws in to a round drop as it comes away
    const k = out(clamp01(t / lift)), sx = p.fw / p.size, sy = p.fh / p.size
    return { x: p.from.x, y: p.from.y - 6 * k, angle: 0, along: sx + (1.12 - sx) * k, across: sy + (1.12 - sy) * k, blob: 1, core: k, spread: 0 }
  }
  if (t < fly) {
    const u = (t - lift) / (fly - lift), s = inOut(u), pt = bez(p, s)
    // heading from the path just ahead; stretch with speed (the in-out curve's own slope), most at mid-flight
    const ahead = bez(p, inOut(Math.min(1, u + 0.02)))
    const angle = Math.atan2(ahead.y - pt.y, ahead.x - pt.x)
    const speed = u < 0.5 ? 12 * u * u : 12 * (1 - u) * (1 - u)   // derivative of the cubic, 0..3
    const k = 1 + 0.16 * (speed / 3)
    // stretched along its heading and thinned across it, by the same factor (the drop keeps its area)
    return { x: pt.x, y: pt.y - 6 * (1 - s), angle, along: 1.12 * k, across: 1.12 / k, blob: 1, core: 1, spread: 0 }
  }
  if (t < land) {
    // a short squash on touching down, settling back to round
    const k = (t - fly) / (land - fly), q = Math.sin(Math.PI * k)
    return { x: p.to.x, y: p.to.y, angle: 0, along: 1.1 + 0.16 * q, across: 1.1 - 0.16 * q, blob: 1, core: 1 - k, spread: 0 }
  }
  const k = clamp01((t - land) / (spread - land))
  return { x: p.to.x, y: p.to.y, angle: 0, along: 1, across: 1, blob: 0, core: 0, spread: r0 * 1.1 + (p.cover - r0 * 1.1) * inOut(k) }
}
