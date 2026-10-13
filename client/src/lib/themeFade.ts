/**
 * A theme change as numbers (tests/themeFade.test.ts).
 *
 * Nothing can snapshot the old screen cheaply (native has no API; the web's View Transitions leave the page deaf to taps
 * while they run, and a DOM copy costs a full text layout), so a veil in the old page colour lies over the already
 * re-drawn screen and dissolves, on every platform. A veil that starts opaque shows a frame of bare page with every
 * word gone, which is the flash; this one starts where a true crossfade stands one frame in, and lower still when the
 * two pages are close (Paper to Sepia), where the page colour hardly moves and the words should not dim.
 */

/** The longest change, tap to settled: light to dark and back. */
export const THEME_FADE_MS = 220
/** The shortest: two pages of one family (Paper to Sepia, Slate to Midnight), where there is little to carry across. */
export const THEME_FADE_NEAR_MS = 140
export const easeOut = (t: number) => { 'worklet'; return 1 - (1 - Math.max(0, Math.min(1, t))) ** 3 }

/** The veil's first opacity never passes this: where a true 220 ms ease-out crossfade stands after one 60 Hz frame. */
export const VEIL_MAX = 0.8
/** Within one family the veil stays between these: enough to soften the page's shift, too little to dim the words. */
const NEAR_VEIL = [0.1, 0.2] as const
/**
 * Page distances (CIE76). Under SAME the change is invisible and gets no veil (the Black themes share `#000000`);
 * every pair within a family is under NEAR (the widest, Nord to Black, is 23); light to dark is past FAR (45 and up).
 */
const SAME = 3, NEAR = 25, FAR = 45

const rgb = (hex: string) => { const n = parseInt(hex.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
const hex = (c: number[]) => '#' + c.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')

/** sRGB `#rrggbb` → CIE L*a*b* (D65). */
export function lab(h: string): [number, number, number] {
  const [r, g, b] = rgb(h).map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}
export function deltaE(a: string, b: string): number {
  const A = lab(a), B = lab(b)
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2])
}

/** Where the veil starts, 0 (no veil) to VEIL_MAX, from how far apart the two page colours are. */
export function veilStart(from: string, to: string): number {
  const d = deltaE(from, to)
  if (d < SAME) return 0
  if (d <= NEAR) return NEAR_VEIL[0] + (NEAR_VEIL[1] - NEAR_VEIL[0]) * (d - SAME) / (NEAR - SAME)
  return Math.min(VEIL_MAX, NEAR_VEIL[1] + (VEIL_MAX - NEAR_VEIL[1]) * (d - NEAR) / (FAR - NEAR))
}

/** How long a veil that starts at `a0` takes to clear: short within a family, THEME_FADE_MS from light to dark. */
export function veilMs(a0: number): number {
  const k = Math.max(0, Math.min(1, (a0 - NEAR_VEIL[1]) / (VEIL_MAX - NEAR_VEIL[1])))
  return Math.round(THEME_FADE_NEAR_MS + (THEME_FADE_MS - THEME_FADE_NEAR_MS) * k)
}

/** The veil's opacity `ms` after it went up at `a0`: eases out to nothing by `veilMs(a0)`. */
export function veilAt(a0: number, ms: number): number {
  return a0 * (1 - easeOut(ms / veilMs(a0)))
}

/** Plain sRGB blend, what a veil of `over` at opacity `a` makes of `under`. */
export function blend(under: string, over: string, a: number): string {
  const U = rgb(under), O = rgb(over)
  return hex(U.map((u, i) => u + (O[i] - u) * a))
}

/** A veil in flight: its colour, the page under it, where it started, when, and at what animation speed. */
export interface Veil { from: string; to: string; a0: number; at: number; speed: number }

/**
 * The veil for a change to a page of colour `to`, with `prev` the veil still fading (if any) at time `now`: a burst of
 * taps starts each veil from the colour the screen shows at that moment, so nothing jumps back.
 */
export function planVeil(prevBg: string, to: string, now: number, prev: Veil | null, speed = 1): Veil | null {
  const shown = prev ? blend(prev.to, prev.from, veilAt(prev.a0, (now - prev.at) * prev.speed)) : prevBg
  const a0 = veilStart(shown, to)
  return a0 > 0 ? { from: shown, to, a0, at: now, speed } : null
}

/**
 * The theme strip's selection: a filled accent dot that opens into a ring. `s` = 0 is the dot, 1 the ring; the accent
 * disc grows from the dot to the ring's outer edge while a hole in the chip's own page colour opens from the centre to
 * the ring's inner edge, so the fill travels outward. Both are scales of full-size discs (native driver; a compositor
 * transform on the web); the hole is clamped so a spring's undershoot never opens a pinprick in the dot.
 */
export const DOT = 18
export const RING = 56
export const RING_STROKE = 6
export function ringAt(s: number): { outer: number; inner: number } {
  const outer = DOT / 2 + (RING / 2 - DOT / 2) * s
  const inner = (RING / 2 - RING_STROKE) * Math.max(0, s)
  return { outer, inner }
}
/** Scales of the two discs (accent: RING wide; hole: RING - 2 * RING_STROKE wide) against `s`, both linear in it. */
export const RING_OUTER = { inputRange: [0, 1], outputRange: [DOT / RING, 1] }
export const RING_HOLE = { inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: 'clamp' as const }
/** Tight spring for the gallery's ring and check: first peak at ~170 ms, about 4% over, settled by ~220 ms. The strip's
 * ring leads and trails on lib/springs.ts RING_LEAD_SPRING / RING_TRAIL_SPRING. */
export const RING_SPRING = { stiffness: 700, damping: 38, mass: 1 } as const
