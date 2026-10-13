/**
 * The house motion numbers, one family (tests/motion.test.ts); the reading screens' docking and page springs are in
 * lib/springs.ts. Springs are stiffness / damping / mass, which is what Animated.spring takes on both platforms; each
 * one's overshoot and settling time is pinned by the tests (measured with lib/springs.ts's closed form).
 */
import { springAt, springPeak, springSettleMs, type SpringCfg } from './springs'

/** Press in: a short ease-out to the pressed scale (a timing, so a quick tap never bounces below it). */
export const PRESS_IN_MS = 90
/** Crisp release (under 1% over, still by ~160 ms), for controls a wobble would muddy; buttons release on
 * lib/springs.ts WOBBLE_SPRING. */
export const RELEASE_SPRING = { stiffness: 800, damping: 48, mass: 1 } as const
/** Pops and marks settling into place (Grow, the toast's text swap): a small overshoot, never a wobble. The page's
 * spring-back after a short drag is lib/springs.ts SETTLE_SPRING (critically damped). */
export const POP_SPRING = { stiffness: 420, damping: 27, mass: 1 } as const
/** Controls that travel (the segmented thumb, the switch thumb, the tab pill): tight, settled by ~260 ms. */
export const CONTROL_SPRING = { stiffness: 600, damping: 40, mass: 1 } as const
/** A sheet or toast rising from the bottom: nearly critical, so it arrives without lifting past its rest, and unhurried. */
export const RISE_SPRING = { stiffness: 300, damping: 33, mass: 1 } as const
/** Scrim and exits. */
export const SCRIM_IN_MS = 260
export const EXIT_MS = 200

/** Overshoot past the target (share of the travel), when it stays within 1%, and when it first reaches 90% (ms). */
export function springShape(s: SpringCfg): { overshoot: number; settledMs: number; reach90Ms: number } {
  let reach = 0
  while (reach < 3000 && springAt(s, reach) < 0.9) reach++
  return { overshoot: springPeak(s), settledMs: springSettleMs(s, 0.01), reach90Ms: reach }
}
