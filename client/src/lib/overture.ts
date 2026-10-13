/**
 * The welcome's timeline as plain numbers: keyframes, word pacing, the jots' paths and the wordmark's letter
 * positions. No React Native here, so the maths is tested on its own (tests/overture.test.ts).
 *
 * The native driver interpolates linearly between keyframes and cannot run an easing function, so every eased
 * segment is sampled into a few linear steps here and handed to `interpolate` as plain arrays.
 */
import { BRAND, type BrandWordmark } from '@shared/brand'

export type Ease = (t: number) => number
export const linear: Ease = t => t
export const outCubic: Ease = t => 1 - (1 - t) ** 3
export const inCubic: Ease = t => t * t * t
export const inOutCubic: Ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** An `interpolate` config: times (ms on one clock) and the values at those times. */
export interface Keys { input: number[]; output: number[] }
export interface Pt { x: number; y: number }

/** `from` → `to` between `t0` and `t1`, eased, as `steps` linear pieces. Holds its ends outside that span (clamp). */
export function tween(t0: number, t1: number, from: number, to: number, ease: Ease = outCubic, steps = 6): Keys {
  const input: number[] = [], output: number[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    input.push(t0 + (t1 - t0) * t)
    output.push(from + (to - from) * ease(t))
  }
  return { input, output }
}

/** Hand-placed keyframes, `[time, value]`, linear between them (an overshoot and settle, a pulse). */
export function keys(points: [number, number][]): Keys {
  return { input: points.map(p => p[0]), output: points.map(p => p[1]) }
}

/**
 * Several segments on one clock, in time order. Between two segments the value holds (or glides linearly if the
 * second starts from a different value). A point that repeats the previous time is dropped, since `interpolate`
 * needs strictly increasing input to stay continuous.
 */
export function join(...parts: Keys[]): Keys {
  const input: number[] = [], output: number[] = []
  for (const p of parts) {
    for (let i = 0; i < p.input.length; i++) {
      const t = p.input[i], last = input[input.length - 1]
      if (last !== undefined && t < last) throw new Error(`overture keys out of order: ${t} after ${last}`)
      if (last !== undefined && t === last) { output[output.length - 1] = p.output[i]; continue }
      input.push(t); output.push(p.output[i])
    }
  }
  return { input, output }
}

/** The value `k` gives at time `t` (what `interpolate` with clamp would give): for tests and for layout maths. */
export function sample(k: Keys, t: number): number {
  const { input, output } = k
  if (t <= input[0]) return output[0]
  const n = input.length - 1
  if (t >= input[n]) return output[n]
  let i = 1
  while (input[i] < t) i++
  const a = input[i - 1], b = input[i]
  return output[i - 1] + (output[i] - output[i - 1]) * ((t - a) / (b - a))
}

/** The same keyframes shifted to another scale, e.g. a progress 0..1 mapped onto pixels. */
export const mapKeys = (k: Keys, f: (v: number) => number): Keys => ({ input: k.input, output: k.output.map(f) })

/**
 * When each word of a verse starts to settle, paced like a slow voice reading: a gap after each word that grows with
 * its length, a longer rest after punctuation, and any extra `pauseBefore` (by word index) for weight.
 */
export function wordOnsets(words: string[], start: number, o: { base: number; perChar: number; punct: number; pauseBefore?: Record<number, number> }): number[] {
  const out: number[] = []
  let t = start
  words.forEach((w, i) => {
    if (i > 0) {
      const prev = words[i - 1]
      t += o.base + o.perChar * prev.replace(/[^\p{L}]/gu, '').length + (/[,;:.]$/.test(prev) ? o.punct : 0)
      t += o.pauseBefore?.[i] ?? 0
    }
    out.push(Math.round(t))
  })
  return out
}

/**
 * A jot's flight from `from` to `to` along a quadratic curve bowed `lift` px above the higher end, as translations
 * relative to `from` (the jot sits at `from` and is moved). Both axes share one set of times, so the path is a curve,
 * not an L, and the easing runs along the curve.
 */
export function arc(from: Pt, to: Pt, lift: number, t0: number, t1: number, ease: Ease = inOutCubic, steps = 12): { x: Keys; y: Keys } {
  const c = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - lift }
  const input: number[] = [], xs: number[] = [], ys: number[] = []
  for (let i = 0; i <= steps; i++) {
    const s = ease(i / steps), u = 1 - s
    input.push(t0 + (t1 - t0) * (i / steps))
    xs.push(u * u * from.x + 2 * u * s * c.x + s * s * to.x - from.x)
    ys.push(u * u * from.y + 2 * u * s * c.y + s * s * to.y - from.y)
  }
  return { x: { input, output: xs }, y: { input: [...input], output: ys } }
}

/**
 * Which source each target takes: the assignment with the least total squared travel, so the jots do not cross
 * paths needlessly. `sources.length >= targets.length`; spare sources go unused. Exact (bitmask DP), for up to
 * ~16 sources.
 */
export function assign(sources: Pt[], targets: Pt[]): number[] {
  const n = sources.length, m = targets.length
  if (m > n) throw new Error('more targets than sources')
  const d2 = (a: Pt, b: Pt) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2
  const size = 1 << n
  const cost = new Float64Array(size).fill(Infinity)
  const from = new Int32Array(size).fill(-1)
  cost[0] = 0
  for (let mask = 0; mask < size; mask++) {
    if (cost[mask] === Infinity) continue
    const j = popcount(mask)
    if (j >= m) continue
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) continue
      const next = mask | (1 << i), c = cost[mask] + d2(sources[i], targets[j])
      if (c < cost[next]) { cost[next] = c; from[next] = i }
    }
  }
  let best = -1
  for (let mask = 0; mask < size; mask++) if (popcount(mask) === m && (best < 0 || cost[mask] < cost[best])) best = mask
  const out = new Array<number>(m)
  for (let mask = best, j = m - 1; j >= 0; j--) { const i = from[mask]; out[j] = i; mask &= ~(1 << i) }
  return out
}
function popcount(x: number) { let c = 0; while (x) { x &= x - 1; c++ } return c }

/**
 * The bold serif face's own measures (Literata Bold, hhea), em: its ascent and descent, which put the baseline inside
 * a line box, and the x-height of the ı stem's top above the baseline.
 */
export const MARK_FACE = { ascent: 1.177, descent: 0.308, stemTop: 0.518 } as const

/**
 * The name in Literata Bold, one view per letter, so each can be carried in by its jot: the brand's `wordmark`
 * (shared/brand.json). The positions are the font's own advances plus its kerning pairs (read from Literata-Bold.ttf,
 * units per em 1000), so the letters sit exactly where the browser or Android would have set the word: `x` is each
 * letter's left edge, em. A letter may be set without its dot (the dotless ı): `dot` is that letter's index, the dot's
 * centre from the letter's left edge and above the baseline, and its size; it is set last and in the accent. Null
 * when the brand has no wordmark: the name is then plain text and nothing flies into it.
 */
export const WORDMARK: (BrandWordmark & typeof MARK_FACE) | null = BRAND.wordmark ? { ...BRAND.wordmark, ...MARK_FACE } : null

/** Baseline position from the top of a text line box of `lineHeight` px, the line's content centred in it. */
export const baselineIn = (fontSize: number, lineHeight: number) =>
  (lineHeight - (MARK_FACE.ascent + MARK_FACE.descent) * fontSize) / 2 + MARK_FACE.ascent * fontSize

/**
 * The welcome's schedule, ms. Four clocks run one after another so each frame only touches what is moving then:
 * `page` (the verse settles, its note opens), `condense` (the words fold into jots), `gather` (the jots fly into the
 * name) and `handoff` (the name lifts and the first-steps form arrives).
 */
export function schedule(words: string[], godIndex: number) {
  const onsets = wordOnsets(words, 1400, { base: 120, perChar: 34, punct: 120, pauseBefore: { [godIndex]: 140 } })
  const WORD_IN = 520
  const lastWord = onsets[onsets.length - 1] + WORD_IN
  const caller = lastWord + 180
  const page = {
    book: [250, 950] as const,
    numeral: [450, 1250] as const,
    verseNo: [1250, 1600] as const,
    onsets, wordIn: WORD_IN,
    tint: caller - 50,
    caller,
    ring: caller + 100,
    note: caller + 320,
    noteText: caller + 460,
    end: caller + 2350,
  }
  const condense = { step: 45, fold: 320, end: 900 }
  const gather = { step: 70, fly: 950, bloom: 290, tittle: 1050, tittleFly: 650, subtitle: 1760, end: 2300 }
  // the form waits until the name has passed up through where it will sit
  const handoff = { lift: [250, 950] as const, form: 820, formStep: 70, formIn: 340, end: 1300 }
  return { page, condense, gather, handoff, total: page.end + condense.end + gather.end + handoff.end }
}
export type Schedule = ReturnType<typeof schedule>

/**
 * One element's motion as data: keyframes (ms on its stage's clock) for opacity and a translate-then-scale transform.
 * The native build binds it to Animated interpolations; the web build samples it itself (components/motion/track.ts).
 */
export interface Track { opacity?: Keys; x?: Keys; y?: Keys; scale?: Keys }
const parts = (t: Track) => [t.opacity, t.x, t.y, t.scale].filter((k): k is Keys => !!k)

/** First and last keyframe time: outside this span the element holds still. */
export function trackSpan(t: Track): [number, number] {
  const ks = parts(t)
  return [Math.min(...ks.map(k => k.input[0])), Math.max(...ks.map(k => k.input[k.input.length - 1]))]
}

/** The track's values at `t`; absent channels are left out. */
export function trackAt(tr: Track, t: number): { opacity?: number; x?: number; y?: number; scale?: number } {
  const out: { opacity?: number; x?: number; y?: number; scale?: number } = {}
  if (tr.opacity) out.opacity = sample(tr.opacity, t)
  if (tr.x) out.x = sample(tr.x, t)
  if (tr.y) out.y = sample(tr.y, t)
  if (tr.scale) out.scale = sample(tr.scale, t)
  return out
}

/** CSS transform for those values, in React Native's order (translateX, translateY, scale); '' when there is none. */
export function cssTransform(v: { x?: number; y?: number; scale?: number }): string {
  const out: string[] = []
  if (v.x !== undefined) out.push(`translateX(${+v.x.toFixed(2)}px)`)
  if (v.y !== undefined) out.push(`translateY(${+v.y.toFixed(2)}px)`)
  if (v.scale !== undefined) out.push(`scale(${+v.scale.toFixed(4)})`)
  return out.join(' ')
}
