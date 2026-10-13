/**
 * Springs and slides for the reading screens, as numbers (tests/springs.test.ts). No react-native import: SwipePager's
 * worklets, the web pager, the paged reader and the tests share these values.
 */

export interface SpringCfg { stiffness: number; damping: number; mass?: number }

/** Core Animated's friction / tension pair as the stiffness and damping it actually runs (Animated/SpringConfig). */
export const fromOrigami = (friction: number, tension: number) => ({ stiffness: (tension - 30) * 3.62 + 194, damping: (friction - 8) * 3 + 25, mass: 1 })

/** 1 is critical damping: the quickest settle with no overshoot. Under ~0.8 the overshoot shows. */
export const dampingRatio = ({ stiffness, damping, mass = 1 }: SpringCfg) => damping / (2 * Math.sqrt(stiffness * mass))

/** Where a spring let go at rest at 0, pulling toward 1, stands `ms` later (closed form). */
export function springAt(cfg: SpringCfg, ms: number): number {
  const w = Math.sqrt(cfg.stiffness / (cfg.mass ?? 1)), z = dampingRatio(cfg), t = ms / 1000
  if (Math.abs(z - 1) < 1e-9) return 1 - (1 + w * t) * Math.exp(-w * t)
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z)
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t))
  }
  const s = Math.sqrt(z * z - 1), r1 = -w * (z - s), r2 = -w * (z + s)
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1)
}

/** The furthest it swings past the target, as a share of the travel; 0 at critical damping and over. */
export function springPeak(cfg: SpringCfg): number {
  const z = dampingRatio(cfg)
  return z >= 1 ? 0 : Math.exp(-Math.PI * z / Math.sqrt(1 - z * z))
}

/** From when on the spring stays within `tol` (a share of the travel) of its target. */
export function springSettleMs(cfg: SpringCfg, tol = 0.01): number {
  let last = 0
  for (let ms = 0; ms <= 3000; ms++) if (Math.abs(springAt(cfg, ms) - 1) > tol) last = ms + 1
  return last
}

/**
 * Docking (the selection bar, the player bar, paged mode's HUD, a bar lifted over another): critically damped. An
 * underdamped dock rises past its edge and opens a strip of page under the bar for a few frames. Most of the way
 * (95%) in ~170 ms, settled by ~240.
 */
export const DOCK_SPRING = { stiffness: 620, damping: 50, mass: 1 } as const

/**
 * A page let go short of a turn springs back (both chapter pagers, paged mode): critically damped, so it never swings
 * past its rest and shows a sliver of the page on the far side (the old damping 20 / stiffness 200 went 4% past). As
 * quick to arrive (95% by ~220 ms), settled by ~310 instead of ~470.
 */
export const SETTLE_SPRING = { stiffness: 480, damping: 44, mass: 1 } as const

/** A tapped cell's selected fill: tight, about 4% over, settled by ~250 ms (the theme strip ring's spring). */
export const FILL_SPRING = { stiffness: 700, damping: 38, mass: 1 } as const

/**
 * The release of every button and chip (Tap): an accelerated wobble, about 21% past rest and back, still (1%) by
 * ~210 ms. Pressing in stays a short ease-out timing, so only the letting go is lively. Controls whose own travel a
 * wobble would muddy keep lib/motion.ts's RELEASE_SPRING (crisp): the segmented choices under their sliding thumb,
 * the slider's thumb, the theme strip's chips (their ring is the motion) and the sheet's grab bar.
 */
export const WOBBLE_SPRING = { stiffness: 1800, damping: 38, mass: 1 } as const

/**
 * The theme strip's ring opens from its outer edge first: the accent's outer diameter leads on RING_LEAD_SPRING and
 * the clearing centre follows on RING_TRAIL_SPRING, so the colour reads as flowing outward with the hole behind it.
 * Closing runs the other way round (the centre fills first, then the dot gathers), so the hole never outruns the
 * accent. Both are still by ~210 ms.
 */
export const RING_LEAD_SPRING = { stiffness: 1000, damping: 48, mass: 1 } as const
export const RING_TRAIL_SPRING = { stiffness: 500, damping: 38, mass: 1 } as const

/** A slide's duration for the `remaining` share (0..1) of a `full` ms slide: in proportion, never under `min`. */
export function slideMs(remaining: number, full: number, min: number): number {
  return Math.round(Math.max(min, Math.min(1, Math.max(0, remaining)) * full))
}

/**
 * Step between the cells of a grid that pops in as one wave (chapter picker): the last cell starts by `span` ms
 * whatever the count, and short grids step `max`.
 */
export function waveStep(count: number, span = 240, max = 18): number {
  return count <= 1 ? 0 : Math.max(1, Math.min(max, Math.floor(span / (count - 1))))
}
