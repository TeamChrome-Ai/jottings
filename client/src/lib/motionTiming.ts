/**
 * The screens' motion as numbers (tests/motionTiming.test.ts). Ceilings: anything a tap causes settles within ~300 ms,
 * a staggered list has landed by ~420 ms, a number counts up in under 400 ms. Pure: no react-native here.
 */
import { RING_SPRING } from './themeFade'
import { dampingRatio, fromOrigami, springPeak, springSettleMs, type SpringCfg } from './springs'

/** List entrances on every screen (Stagger, MotionItem, badge cells, outline items, leaderboard bars), and the reader's `rowDelay`. */
export const STAGGER_STEP = 34
export const STAGGER_CAP = 8
/** One row's fade and rise. */
export const ROW_MS = 240
export const ROW_RISE = 10
/** Small cells (badges, names, chapter numbers): fade and scale up from this. */
export const CELL_MS = 180
export const CELL_FROM = 0.86

/** Delay for row `i` of a first-load stagger, or null at or past `cap` (the row renders still). */
export function staggerDelay(i: number, cap = STAGGER_CAP, step = STAGGER_STEP, base = 0): number | null {
  return i < cap ? base + i * step : null
}
/** Delay of row `i` in the house stagger: `step` apart for the first `cap` rows, every row after them with the last. */
export function rowDelay(i: number, base = 0, cap = STAGGER_CAP, step = STAGGER_STEP): number {
  return base + Math.min(i, cap - 1) * step
}
/** When the last animated row of an `n`-row list has landed. */
export function staggerEnd(n: number, cap = STAGGER_CAP, step = STAGGER_STEP, ms = ROW_MS): number {
  return n <= 0 ? 0 : (Math.min(n, cap) - 1) * step + ms
}

/**
 * The part of a planned entrance delay still ahead once `elapsed` ms of the screen's entrance have passed. Content that
 * arrives late (a network read) joins the sequence where it stands instead of waiting out a delay meant for mount.
 */
export function lateDelay(planned: number, elapsed: number): number {
  return Math.max(0, Math.round(planned - Math.max(0, elapsed)))
}

/** A number easing to its value. Worth it only because it lands under 400 ms. */
export const COUNT_MS = 360
/** Goal and leaderboard bars filling. */
export const FILL_MS = 300
/** Content replaced in place (a status line, a page of headwords): the new content is up at once and fades in. */
export const SWAP_MS = 180
/** A page turn leads in from this far to the side (px), from the right for Next, the left for Previous. */
export const TURN_DX = 12
/** A text field's accent ring. */
export const FOCUS_MS = 120

/** One accent ring swelling out once (a goal met, a badge just earned) with a small bump of what it rings. */
export const PULSE = { ringMs: 300, bumpMs: 90, bump: 1.08 } as const
/** A row's one accent wash (the reader's own leaderboard row): up, then away. */
export const WASH = { inMs: 100, outMs: 220 } as const

/** Presses, swaps and settles: no bounce the eye can find (about 4% over), settled by ~220 ms. */
export const SNAP_SPRING = RING_SPRING
/** One visible overshoot for a mark that lands with weight (a flame leaping, a badge dropping in), settled by ~320 ms. */
export const LIVELY_SPRING = { stiffness: 600, damping: 25, mass: 1 } as const

export type SpringConfig = SpringCfg
export { fromOrigami }

/** What a spring from 0 to 1 looks like: its damping ratio, how far past 1 it swings (0.04 = 4%), and when it is last more than 2% away from 1 (ms). */
export function springFeel(cfg: SpringCfg): { zeta: number; overshoot: number; settleMs: number } {
  return { zeta: dampingRatio(cfg), overshoot: springPeak(cfg), settleMs: springSettleMs(cfg, 0.02) }
}
