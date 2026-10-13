/**
 * Animation speed (Settings → Reading), as numbers (tests/motionSpeed.test.ts). One factor scales every duration and
 * every spring: components/motion/speed.ts applies it to each Animated timing, spring, delay and stagger as it starts,
 * and the few motions outside core Animated (the native chapter pagers on Reanimated, the theme veils' Web Animations,
 * the radial reveal) call these helpers themselves. The welcome's choreography and the tour's theme blob keep their
 * own timing. A speed of 1.5 plays in two thirds of the time; 0.5 takes twice as long.
 */
import { fromOrigami } from './springs'

export const SPEED_MIN = 0.5, SPEED_MAX = 1.5, SPEED_STEP = 0.1, SPEED_DEFAULT = 1

/**
 * The house tempo: what "1×" plays at, relative to the numbers written in the motion modules. Everything runs at 0.7
 * (durations, delays and staggers ÷ 0.7; springs keep their overshoot and take 1 / 0.7 as long), except the motions
 * given their own tempo: the chapter turns' release (TURN_TEMPO), the theme strip's ring and the tab crossfade
 * (SLOW_TEMPO), and the tour (1, as written). The Animation speed slider multiplies whichever applies.
 */
export const HOUSE_TEMPO = 0.7
export const TURN_TEMPO = 0.5
export const SLOW_TEMPO = 0.5
export const AUTHORED_TEMPO = 1

export function clampSpeed(s: unknown): number {
  const n = typeof s === 'number' && Number.isFinite(s) ? s : SPEED_DEFAULT
  return Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, n)) * 100) / 100
}

let user = SPEED_DEFAULT
let current = SPEED_DEFAULT * HOUSE_TEMPO
/** The speed in force for most motion: the house tempo times the reader's Animation speed. */
export const motionSpeed = () => current
/** The reader's Animation speed on its own (0.5 to 1.5). */
export const userSpeed = () => user
/** The speed for a motion with its own `tempo`. */
export const tempoSpeed = (tempo: number) => tempo * user
/** Set by the root layout from the preference. */
export function setMotionSpeed(s: number) { user = clampSpeed(s); current = user * HOUSE_TEMPO }

/** A duration or delay at speed `s`. */
export function scaleMs(ms: number, s = current): number {
  'worklet'
  return ms / s
}

export interface SpringParams { stiffness: number; damping: number; mass: number }
/**
 * A spring at speed `s`: the same shape (damping ratio, overshoot) played `s` times as fast, which is stiffness
 * times s² and damping times s at the same mass.
 */
export function scaleSpringParams(p: SpringParams, s = current): SpringParams {
  'worklet'
  return { stiffness: p.stiffness * s * s, damping: p.damping * s, mass: p.mass }
}

type AnyConfig = Record<string, unknown>
/**
 * An Animated.spring config at speed `s`, whichever way it names its spring (stiffness / damping / mass, or friction /
 * tension, or neither: Animated's default friction 7 / tension 40). Delay and velocity scale with it.
 */
export function scaleSpringConfig<T extends AnyConfig>(cfg: T, s = current): T {
  if (s === 1) return cfg
  const { friction, tension, bounciness, speed, ...rest } = cfg as AnyConfig
  // bounciness / speed is Animated's third spelling; nothing here uses it, so it passes through untouched
  if (bounciness !== undefined || speed !== undefined) return cfg
  const base: SpringParams = typeof rest.stiffness === 'number'
    ? { stiffness: rest.stiffness as number, damping: typeof rest.damping === 'number' ? rest.damping : 10, mass: typeof rest.mass === 'number' ? rest.mass : 1 }
    : fromOrigami(typeof friction === 'number' ? friction : 7, typeof tension === 'number' ? tension : 40)
  const out: AnyConfig = { ...rest, ...scaleSpringParams(base, s) }
  if (typeof rest.delay === 'number') out.delay = scaleMs(rest.delay, s)
  if (typeof rest.velocity === 'number') out.velocity = (rest.velocity as number) * s
  return out as T
}

/** An Animated.timing config at speed `s` (Animated's default duration is 500 ms). */
export function scaleTimingConfig<T extends AnyConfig>(cfg: T, s = current): T {
  if (s === 1) return cfg
  const out: AnyConfig = { ...cfg, duration: scaleMs(typeof cfg.duration === 'number' ? cfg.duration : 500, s) }
  if (typeof cfg.delay === 'number') out.delay = scaleMs(cfg.delay, s)
  return out as T
}
