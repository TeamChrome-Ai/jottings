// How a chapter comes to count as read (docs/READING.md). The server holds the same rule in rs/src/readthrough.rs and
// decides; the device runs this copy to say how far off the credit is, and signed out to judge a chapter itself.
// shared/readThrough.cases.json holds worked cases that both copies are tested against, so the two cannot drift.
//
// Two things make a chapter read:
//  - all of it went past the reader: each verse was on screen long enough to be taken in, or the voice read it out;
//  - the time spent on it is what its length asks: its words at an unhurried reading pace, and for a verse heard, the
//    recording's length at the fastest speed the app plays.
// Neither depends on where the reader is when the last of it arrives, and both add up across sittings.
// Everything is whole numbers, so the two copies agree to the millisecond.

/** An unhurried reader's pace (400 credited chapters, build 31): every word read and not heard needs this long. */
export const READ_WPM = 250
export const MS_PER_WORD = 60_000 / READ_WPM
/** A reader's own pace, learned on the server from chapters they read themselves with steady touches and scrolls
 *  (rs/src/readthrough.rs `PACE_*`), never slower than `READ_WPM` and never quicker than this. */
export const PACE_MAX_WPM = 400
/** The least time any chapter needs, however short: Psalm 117 is 27 words, under 7 s at the pace above. */
export const MIN_MS = 10_000
/** The most any chapter needs, however long. */
export const MAX_MS = 600_000
/** The quickest a reader's eye takes words in (750 a minute): words that go by faster were on screen but not read. */
export const GLANCE_MS_PER_WORD = 80
/** Glance time a screen does not use carries to the next, up to about a screenful: a pause on one screen pays for a
 *  quicker next one, never for a run of the chapter scrolled past. */
export const GLANCE_BANK_WORDS = 250
/** A verse heard needs its recording's length at the app's fastest speed (1.5×), less 5% for the beats' rounding:
 *  `audio × 0.95 / 1.5`, as a whole fraction. */
export const HEARD_NUM = 19
export const HEARD_DEN = 30
/** A verse the voice reads with no recording to time it (the device's own voice) needs no less than reading it. */
export const HEARD_FALLBACK_MS_PER_WORD = MS_PER_WORD
/** At most this share of the chapter's words may slip by unread (a verse or two flicked past), the last verse never. */
export const SLACK_DIV = 20
/** A chapter part-read is kept this long after it was last read, so two sittings, or one either side of a night, add up. */
export const KEEP_MS = 48 * 3_600_000
/** The time one beat can bring: the gap since the last one, up to this while the reader is active on a showing screen. */
export const BEAT_CAP_MS = 20_000
/** While the voice reads on (the screen may be off, and beats come late) a beat brings up to twice what the verses it
 *  finished take at the fastest speed, past what the slowest speed (0.8×) takes, and 5 s more; never more than this. */
export const LISTEN_CAP_MS = 300_000
/** A beat names at most this many verse ranges of each kind; any more are ignored. */
export const MAX_RANGES = 32
/** Listening time a beat does not use on verses heard carries to the next, up to this: a verse that began in one beat
 *  and ended in the next is paid for by both. */
export const LISTEN_BANK_MS = 20_000

/** A chapter's verses as the rule weighs them, in reading order. */
export interface Shape {
  verses: readonly number[]
  words: readonly number[]
  /** The reader's own pace, ms a word read (`MS_PER_WORD` unless the server has learned a quicker one: PACE_*). */
  msPerWord?: number
  /** The fastest recording of each verse, ms; null where none times it. */
  audioMs?: readonly (number | null)[]
}
/** Inclusive verse-number ranges. */
export type Ranges = readonly (readonly [number, number])[]
/** A chapter part-read: words of each verse taken in so far, verses heard (0/1), glance words banked, time spent, and
 *  listening time banked. */
export interface ReadThrough { seen: number[]; heard: number[]; bank: number; activeMs: number; listenBank: number }
/** What one beat says about the chapter: the time it brings (`earnedMs`), the verses on screen since the last, the
 *  verses the voice finished since the last. */
export interface BeatEvidence { ms: number; seen?: Ranges; heard?: Ranges }

export const freshThrough = (shape: Shape): ReadThrough => ({ seen: shape.words.map(() => 0), heard: shape.words.map(() => 0), bank: 0, activeMs: 0, listenBank: 0 })

/** A stored state for this shape, or a fresh one when it no longer fits (the text changed edition since). */
export function fitThrough(t: ReadThrough | null | undefined, shape: Shape): ReadThrough {
  const n = shape.words.length
  if (!t || t.seen.length !== n || t.heard.length !== n) return freshThrough(shape)
  return {
    seen: t.seen.map((s, i) => Math.max(0, Math.min(shape.words[i], Math.floor(s) || 0))),
    heard: t.heard.map(h => (h ? 1 : 0)),
    bank: Math.max(0, Math.min(GLANCE_BANK_WORDS, Math.floor(t.bank) || 0)),
    activeMs: Math.max(0, Math.floor(t.activeMs) || 0),
    listenBank: Math.max(0, Math.min(LISTEN_BANK_MS, Math.floor(t.listenBank) || 0)),
  }
}

/** Indices of the shape's verses that fall in `ranges`, ascending, once each. */
export function indicesIn(shape: Shape, ranges: Ranges | undefined): number[] {
  if (!ranges || !ranges.length) return []
  const rs = ranges.slice(0, MAX_RANGES)
  const out: number[] = []
  shape.verses.forEach((v, i) => { if (rs.some(([a, b]) => v >= a && v <= b)) out.push(i) })
  return out
}

/** What hearing verse `i` asks of the time, and costs of the listening allowance. */
export function heardMs(shape: Shape, i: number): number {
  const a = shape.audioMs?.[i]
  return a != null && a > 0 ? Math.floor(a * HEARD_NUM / HEARD_DEN) : shape.words[i] * HEARD_FALLBACK_MS_PER_WORD
}
/** How long the voice takes over verse `i` at the fastest speed: what a beat must have brought to have heard it. */
const listenMs = (shape: Shape, i: number): number => {
  const a = shape.audioMs?.[i]
  return a != null && a > 0 ? Math.floor(a * 2 / 3) : shape.words[i] * HEARD_FALLBACK_MS_PER_WORD
}

/** What the verses a beat says the voice finished take at the fastest speed, heard before or not: how much of a late
 *  beat's gap listening can account for (`earnedMs`). */
export function heardCostMs(shape: Shape, heard: Ranges | undefined): number {
  return indicesIn(shape, heard).reduce((n, i) => n + listenMs(shape, i), 0)
}

/** The time a beat brings, from the gap since the previous beat (the server's own clock): up to 20 s while the reader is
 *  active on a showing screen; while the voice reads, up to 20 s or, when the beat comes late (a locked phone), what the
 *  verses it finished allow; the larger of the two. */
export function earnedMs(elapsedMs: number, f: { active: boolean; visible: boolean; listening: boolean; heardCostMs: number }): number {
  if (elapsedMs <= 0) return 0
  const screen = f.active && f.visible ? Math.min(elapsedMs, BEAT_CAP_MS) : 0
  const voice = f.listening ? Math.min(elapsedMs, Math.max(BEAT_CAP_MS, Math.min(LISTEN_CAP_MS, f.heardCostMs * 2 + 5_000))) : 0
  return Math.max(screen, voice)
}

/** The chapter after one beat. Heard verses first, in order: no more than the beat's time and the listening bank allow
 *  at the fastest speed. Then the verses on screen, in reading order, as far as the glance time (the beat's and the
 *  bank) reaches. */
export function applyBeat(t: ReadThrough, shape: Shape, b: BeatEvidence): ReadThrough {
  const ms = Math.max(0, Math.floor(b.ms))
  const s: ReadThrough = { seen: [...t.seen], heard: [...t.heard], bank: t.bank, activeMs: t.activeMs + ms, listenBank: 0 }
  let allow = ms + t.listenBank
  for (const i of indicesIn(shape, b.heard)) {
    if (s.heard[i]) continue
    const cost = listenMs(shape, i)
    if (cost > allow) break
    allow -= cost
    s.heard[i] = 1
    s.seen[i] = shape.words[i]
  }
  s.listenBank = Math.min(allow, LISTEN_BANK_MS)
  let budget = Math.floor(ms / GLANCE_MS_PER_WORD) + s.bank
  for (const i of indicesIn(shape, b.seen)) {
    if (budget <= 0) break
    const take = Math.min(shape.words[i] - s.seen[i], budget)
    if (take <= 0) continue
    s.seen[i] += take
    budget -= take
  }
  s.bank = Math.min(budget, GLANCE_BANK_WORDS)
  return s
}

export interface Judgement {
  /** Every part went past the reader (`SLACK_DIV`), the last verse whole. */
  covered: boolean
  /** Runs of verses not yet taken in, as verse numbers; empty once covered. */
  gaps: [number, number][]
  requiredMs: number
  owingMs: number
  read: boolean
}

/** Where the chapter stands. */
export function judge(t: ReadThrough, shape: Shape): Judgement {
  const n = shape.words.length
  const total = shape.words.reduce((a, w) => a + w, 0)
  let uncovered = 0, need = 0
  const gaps: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const open = !t.heard[i] && t.seen[i] < shape.words[i]
    if (open) {
      uncovered += shape.words[i] - t.seen[i]
      const g = gaps[gaps.length - 1]
      if (g && g[1] === shape.verses[i - 1]) g[1] = shape.verses[i]
      else gaps.push([shape.verses[i], shape.verses[i]])
    }
    need += t.heard[i] ? heardMs(shape, i) : shape.words[i] * (shape.msPerWord ?? MS_PER_WORD)
  }
  const lastIn = n === 0 || !!t.heard[n - 1] || t.seen[n - 1] >= shape.words[n - 1]
  const covered = lastIn && uncovered <= Math.floor(total / SLACK_DIV)
  const requiredMs = Math.min(MAX_MS, Math.max(MIN_MS, need))
  const owingMs = Math.max(0, requiredMs - t.activeMs)
  return { covered, gaps: covered ? [] : gaps, requiredMs, owingMs, read: covered && owingMs === 0 }
}

/** Joins ranges that touch or overlap, keeping at most `MAX_RANGES`: what a device sends for the verses of an interval. */
export function addRange(rs: [number, number][], a: number, b: number): [number, number][] {
  if (!(a > 0) || !(b >= a)) return rs
  const all = [...rs, [a, b] as [number, number]].sort((x, y) => x[0] - y[0])
  const out: [number, number][] = []
  for (const r of all) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out.slice(-MAX_RANGES)
}
