/**
 * The Themes screen's theme change, as numbers (tests/themeReveal.test.ts): the new theme blooms out from the tapped
 * swatch. As with the plain change (lib/themeFade.ts) nothing can snapshot the old screen, so the new theme is drawn
 * at once and a veil in the old page colour lies over it; here the veil has a soft-edged hole that opens from the tap
 * to the farthest corner (ease-out), while the veil outside it thins as the change goes. Inside the hole the new page
 * is already clear; outside, the words show through the veil the whole time (it starts where the plain crossfade
 * does, never opaque), and each point of the screen settles when the edge passes it. Every pixel is a blend of the two
 * pages, so no frame holds a colour from neither theme.
 */
import { blend, deltaE, veilStart } from './themeFade'

/** Tap to the farthest corner settled. */
export const REVEAL_MS = 460
/** The hole starts this wide around the tap, so the swatch answers in the first frame. */
export const REVEAL_R0 = 36
/** Soft edge: from this wide at the start to FEATHER_MAX once the hole is large. */
export const FEATHER_MIN = 28, FEATHER_MAX = 120
/** Outside the hole the veil never starts below this (the change must read as spreading, even between near pages)… */
export const REVEAL_FLOOR = 0.3
/** …or, when the two pages are the same colour (the Black themes, only the ink changes), this light a breath. */
export const REVEAL_SAME = 0.2

export interface Pt { x: number; y: number }
export interface RevealPlan { x: number; y: number; r0: number; r1: number; a0: number; from: string; to: string; at: number; speed: number }

/** A reveal from `origin` across a `w` × `h` box, from page colour `from` to `to`, begun at `at`. */
export function planReveal(origin: Pt, w: number, h: number, from: string, to: string, at = 0, speed = 1): RevealPlan {
  const x = Math.min(w, Math.max(0, origin.x)), y = Math.min(h, Math.max(0, origin.y))
  const far = Math.max(Math.hypot(x, y), Math.hypot(w - x, y), Math.hypot(x, h - y), Math.hypot(w - x, h - y))
  const a0 = deltaE(from, to) < 3 ? REVEAL_SAME : Math.max(REVEAL_FLOOR, veilStart(from, to))
  // the hole's clear edge ends past the farthest corner by a whole feather, so the last of the veil leaves the screen
  return { x, y, r0: REVEAL_R0, r1: far + FEATHER_MAX, a0, from, to, at, speed }
}

/** The reveal `ms` into its run (already scaled for animation speed): the clear radius, the feather, the veil outside. */
export function revealAt(p: RevealPlan, ms: number): { r: number; feather: number; a: number; done: boolean } {
  'worklet'
  const t = Math.max(0, Math.min(1, ms / REVEAL_MS))
  // ease-out, but quadratic: the front stays in view long enough to be seen travelling
  const r = p.r0 + (p.r1 - p.r0) * (1 - (1 - t) * (1 - t))
  const feather = FEATHER_MIN + (FEATHER_MAX - FEATHER_MIN) * Math.min(1, r / (p.r1 * 0.6))
  return { r, feather, a: p.a0 * (1 - t), done: t >= 1 }
}

/** The veil's opacity at distance `d` from the origin: none in the clear hole, rising across the feather. */
export function veilAtDistance(p: RevealPlan, ms: number, d: number): number {
  'worklet'
  const { r, feather, a } = revealAt(p, ms)
  if (d <= r) return 0
  const k = Math.min(1, (d - r) / feather)
  return a * k * k * (3 - 2 * k)
}

/**
 * The colour a new reveal should start from when one is still running: what the screen shows on average at that
 * moment (the old page, thinned by the veil where the hole has not reached), sampled on a coarse grid.
 */
export function revealShown(p: RevealPlan, now: number, w: number, h: number): string {
  const ms = (now - p.at) * p.speed
  let sum = 0, n = 0
  for (let i = 0; i < 12; i++) for (let j = 0; j < 24; j++) {
    sum += veilAtDistance(p, ms, Math.hypot((i + 0.5) * w / 12 - p.x, (j + 0.5) * h / 24 - p.y)); n++
  }
  return blend(p.to, p.from, sum / n)
}

/** Native draws the soft edge as this many rings of rising opacity (the web uses a CSS gradient mask). */
export const REVEAL_BANDS = 6
const circle = (x: number, y: number, r: number) => {
  'worklet'
  return `M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(2 * r).toFixed(1)} 0a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(-2 * r).toFixed(1)} 0Z`
}
/**
 * Band `j` of the veil at `ms` (fill rule even-odd): 0..REVEAL_BANDS-1 are the feather's rings, inside out, each at the
 * smoothstep opacity of its middle; REVEAL_BANDS is the rest of the box outside the feather, at the full outside veil.
 */
export function revealBand(p: RevealPlan, ms: number, w: number, h: number, j: number): { d: string; o: number } {
  'worklet'
  const { r, feather, a } = revealAt(p, ms)
  if (j >= REVEAL_BANDS) return { d: `M0 0H${w}V${h}H0Z${circle(p.x, p.y, r + feather)}`, o: a }
  const k = (j + 0.5) / REVEAL_BANDS
  return { d: circle(p.x, p.y, r + feather * (j + 1) / REVEAL_BANDS) + circle(p.x, p.y, r + feather * j / REVEAL_BANDS), o: a * k * k * (3 - 2 * k) }
}
/** The web's soft edge (ThemeReveal.web.tsx): [offset across the feather, veil alpha] for a canvas radial gradient from
 *  the hole's edge outwards, the same smoothstep the native rings step through; transparent in the hole. */
export const revealStops: ReadonlyArray<readonly [number, number]> = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map(k => [k, Number((k * k * (3 - 2 * k)).toFixed(4))] as const)
