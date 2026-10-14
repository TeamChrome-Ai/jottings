import {
  addRange, applyBeat, BEAT_CAP_MS, earnedMs, fitThrough, freshThrough, GLANCE_BANK_WORDS, GLANCE_MS_PER_WORD, heardCostMs, judge, KEEP_MS,
  type Judgement, type ReadThrough, type Shape,
} from '@shared/readThrough'

/** The server counts at most this much of the time between two beats while the reader is on a showing screen. */
export const MAX_BEAT_MS = BEAT_CAP_MS

/** Where the server says a beat's chapter stands (rs/src/readthrough.rs `Standing`). */
export interface Standing { book: number; chapter: number; through: ReadThrough; judgement: Judgement; credited_today: boolean; audio_ms?: (number | null)[]; ms_per_word?: number }

/**
 * The device's glance over the screen, finer than a beat (a look each second and on every scroll): the time the screen
 * shows is spent on its words in reading order at the glance pace, so a verse is seen once it has been on screen long
 * enough for its words, and a fling past it is not seen at all. The server bounds a beat by the same pace over its
 * 15 s; this is what keeps a short chapter flung through in a second from being seen in the next 15.
 */
export interface Glance { taken: Map<number, number>; bank: number; carryMs: number; at: number | null }
/** The most of the gap between two looks the glance counts (a look comes each second). */
export const LOOK_MAX_MS = 2_000

/** One stay on a chapter: what has gone past the reader since the last beat (signed out, the last look), and the
 *  chapter's state as of then, the server's when signed in and the device's own when not. */
export interface Visit {
  book: number; chapter: number
  /** Verses seen (`Glance`) since the last beat. */
  seen: [number, number][]
  glance: Glance
  /** Verses the voice finished since the last beat. */
  heard: [number, number][]
  /** Every verse the voice finished on this visit: one the chapter's state does not have yet goes again. */
  heardAll: number[]
  /** The chapter's shape as this visit last saw it: a beat closing the visit goes with the next chapter already showing. */
  shape?: Shape
  /** The fastest recording of each verse, as the server times a verse heard (its answer carries it while listening). */
  audioMs?: (number | null)[]
  /** The reader's own pace, ms a word read, once the server has learned it. */
  msPerWord?: number
  /** The verses on screen just now: being read, so never named as still to read. */
  screen: [number, number] | null
  /** The chapter as of the last beat (or look); null until the first answer. */
  through: ReadThrough | null
  /** At the end right now, and the furthest scroll progress: what older servers judge by, kept for the stats. */
  reached: boolean
  progress: number
  /** When an early beat was last sent because the rule looked met. */
  promptedAt: number
  credited: boolean
}

export const newVisit = (book: number, chapter: number): Visit => ({
  book, chapter, seen: [], glance: { taken: new Map(), bank: 0, carryMs: 0, at: null }, heard: [], heardAll: [], screen: null, through: null,
  reached: false, progress: 0, promptedAt: 0, credited: false,
})

/** A look at the screen at `now`: the verses on it (`r`, null while the text is not laid out or not showing), and
 *  whether the time is counting. Spends the time since the last look on the words showing (`Glance`). */
export function noteScreen(v: Visit, shape: Shape | undefined, r: [number, number] | null, now: number, counting: boolean) {
  const g = v.glance
  const dt = g.at === null || !counting ? 0 : Math.min(LOOK_MAX_MS, Math.max(0, now - g.at))
  g.at = now
  v.screen = r
  if (!shape || !r) { g.carryMs = 0; return }
  const ms = dt + g.carryMs
  let budget = Math.floor(ms / GLANCE_MS_PER_WORD) + g.bank
  g.carryMs = ms % GLANCE_MS_PER_WORD
  for (let i = 0; i < shape.verses.length && budget > 0; i++) {
    const n = shape.verses[i]
    if (n < r[0] || n > r[1]) continue
    const have = g.taken.get(n) ?? 0
    if (have >= shape.words[i]) continue
    const take = Math.min(shape.words[i] - have, budget)
    budget -= take
    g.taken.set(n, have + take)
    if (have + take >= shape.words[i]) v.seen = addRange(v.seen, n, n)
  }
  g.bank = Math.min(budget, GLANCE_BANK_WORDS)
}

/** Takes the server's (or the device's) state for the chapter: verses it has whole count as taken in here too. */
export function adopt(v: Visit, through: ReadThrough, shape: Shape | undefined) {
  v.through = through
  shape?.verses.forEach((n, i) => { if (through.heard[i] || through.seen[i] >= shape.words[i]) v.glance.taken.set(n, shape.words[i]) })
}
export function noteHeard(v: Visit, verse: number) {
  v.heard = addRange(v.heard, verse, verse)
  if (!v.heardAll.includes(verse)) v.heardAll.push(verse)
}
/** What the next beat carries; the visit starts gathering afresh. `restore` puts it back if the beat never arrives.
 *  Verses seen or heard here that the chapter's state still lacks (a beat's time held fewer than the device took in)
 *  go again, so none is left out. */
export function takeEvidence(v: Visit, shape?: Shape): { seen: [number, number][]; heard: [number, number][]; restore: () => void } {
  let seen = v.seen, heard = v.heard
  const t = v.through
  if (shape && t && t.seen.length === shape.words.length) shape.verses.forEach((n, i) => {
    if (t.heard[i]) return
    if (v.heardAll.includes(n)) heard = addRange(heard, n, n)
    else if ((v.glance.taken.get(n) ?? 0) >= shape.words[i] && t.seen[i] < shape.words[i]) seen = addRange(seen, n, n)
  })
  v.seen = []; v.heard = []
  return { seen, heard, restore: () => { for (const r of seen) v.seen = addRange(v.seen, r[0], r[1]); for (const r of heard) v.heard = addRange(v.heard, r[0], r[1]) } }
}

/** What a beat sent at `now` will bring, as far as the device can tell: the time since the previous beat, capped, while
 *  the reader is active (or the voice reads). The server counts whole seconds between arrivals, so a 15 s beat can land
 *  as 14: the estimate takes a second off and never runs ahead of the server's tally. */
export function earned(lastBeatAt: number | null, now: number, counting: boolean): number {
  if (!counting || lastBeatAt === null || now <= lastBeatAt) return 0
  const ms = now - lastBeatAt
  return ms >= MAX_BEAT_MS + 1000 ? MAX_BEAT_MS : Math.max(0, Math.floor(ms / 1000) - 1) * 1000
}

/** Parts of the range `g` not on `screen`. */
function offScreen(g: [number, number], screen: [number, number] | null): [number, number][] {
  if (!screen || screen[1] < g[0] || screen[0] > g[1]) return [g]
  const out: [number, number][] = []
  if (g[0] < screen[0]) out.push([g[0], screen[0] - 1])
  if (g[1] > screen[1]) out.push([screen[1] + 1, g[1]])
  return out
}

/** How far the chapter is from counting if the reader stays. `ms`: until it counts (0: the next beat credits it), null
 *  while parts of it away from the screen are still to read, which `gaps` names. */
export interface Estimate { ms: number | null; gaps: [number, number][] }

/** The visit's chapter as the next beat would leave it, `pendingMs` from now. */
export function estimate(v: Visit, given: Shape, pendingMs: number): Estimate {
  const shape = { ...given, ...(v.audioMs && v.audioMs.length === given.words.length ? { audioMs: v.audioMs } : {}), ...(v.msPerWord ? { msPerWord: v.msPerWord } : {}) }
  const base = fitThrough(v.through, shape)
  const t = applyBeat(base, shape, { ms: pendingMs, seen: v.screen ? [...v.seen, v.screen] : v.seen, heard: v.heard })
  const j = judge(t, shape)
  if (j.read) return { ms: 0, gaps: [] }
  const away = j.gaps.flatMap(g => offScreen(g, v.screen))
  if (away.length) return { ms: null, gaps: away }
  // only the verses on screen are left to take in: that takes a moment, or the time still owing if longer
  let left = 0
  shape.verses.forEach((n, i) => { if (v.screen && n >= v.screen[0] && n <= v.screen[1] && !t.heard[i]) left += shape.words[i] - t.seen[i] })
  return { ms: Math.max(j.owingMs, Math.max(0, left - t.bank) * GLANCE_MS_PER_WORD), gaps: [] }
}

/** Signed out the device keeps the chapters part-read itself, for as long as the server would. */
const local = new Map<string, { through: ReadThrough; at: number }>()
const localKey = (b: number, c: number) => `${b}.${c}`
/** The device's own state for a chapter, signed out: what an earlier visit left within `KEEP_MS`, else fresh. */
export function localThrough(b: number, c: number, shape: Shape, now: number): ReadThrough {
  const kept = local.get(localKey(b, c))
  return kept && now - kept.at < KEEP_MS ? fitThrough(kept.through, shape) : freshThrough(shape)
}
export function forgetLocal() { local.clear() }

/**
 * Signed out the device judges the visit by the server's rule: the time since the last look (as the server would count
 * it), the verses on screen and heard since, and whether the chapter is now read. A credited chapter starts afresh.
 */
export function judgeLocal(v: Visit, shape: Shape, sinceMs: number, f: { active: boolean; visible: boolean; listening: boolean }, now: number): boolean {
  const base = v.through ? fitThrough(v.through, shape) : localThrough(v.book, v.chapter, shape, now)
  if (!v.through) adopt(v, base, shape)
  const { seen, heard } = takeEvidence(v, shape)
  // the voice finishing a verse is the voice reading, though it has gone quiet at the chapter's end
  const ms = earnedMs(sinceMs, { ...f, listening: f.listening || heard.length > 0, heardCostMs: heardCostMs(shape, heard) })
  const t = applyBeat(base, shape, { ms, seen, heard })
  const read = !v.credited && judge(t, shape).read
  const next = read ? freshThrough(shape) : t
  adopt(v, next, shape)
  local.set(localKey(v.book, v.chapter), { through: next, at: now })
  return read
}
