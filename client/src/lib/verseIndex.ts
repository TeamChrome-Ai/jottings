/**
 * The scroll reader's verse index (components/VerseIndex.tsx): its numbers, a chapter's stops, the live page's verse
 * geometry, the label column, the finger-to-verse mappings, the state machine and the controller that runs it against
 * the chapter screen. Pure: no react-native, no React, so tests/verseIndex.test.ts drives all of it in node with a
 * fake clock. The component only adapts PanResponder and Animated to the controller's env.
 */
import type { Verse } from '@shared/types'

// ---- numbers (pinned in tests/verseIndex.test.ts) ----

/** The band at the right edge: exactly the old "Next chapter" zone (STYLE.md, Touch targets). Never wider: the reading
 *  gutter is 20, so a wider band would take taps and scrolls off the text. */
export const EDGE_W = 18
/** The band and the column keep this clear of the column's top (the toolbar) and bottom, as the left zone does; a
 *  docked bar taller than this pushes the bottom up to its own height. */
export const EDGE_CLEAR = 120
/** The label column, drawn over the band and the gutter: a three-digit label at 11 px, centred, fits. */
export const COL_W = 28
/** The first and last stop sit this far in from the column's ends. */
export const COL_PAD = 8
/** Labels at least this far apart; the step is the smallest of LABEL_STEPS that keeps them so (the owner's spec). */
export const LABEL_GAP = 20
export const LABEL_STEPS = [5, 10, 20, 25, 50, 100] as const
/** The column's labels dim to this while fine mode's box lists the verses instead. */
export const LABEL_DIM = 0.25
/** Travel that tells a scrub (vertical first) or a sideways drag from a tap: Android's touch slop. */
export const SCRUB_SLOP = 8
/** A still press let go within this is a tap and turns the chapter; held longer it turns nothing (the platform's
 *  long-press delay): a finger that rested on the index and thought better of it must not lose the reader's place. */
export const TAP_MAX_MS = 500
/** A sideways-first drag released this far to the left of where it began turns the chapter (the pager's DRAG_SLOP);
 *  any other sideways drag from the band does nothing. */
export const TURN_LEFT = 24
/** Fine mode begins with the finger this far inward of the band's inner edge (the owner's 40) and ends under FINE_BACK:
 *  the gap is a hysteresis, so a finger wobbling on the line cannot flip between relative and absolute mapping and
 *  leap the page. */
export const FINE_IN = 40
export const FINE_BACK = 24
/** Fine mode: one verse per this much vertical travel, from where fine mode began. */
export const FINE_STEP = 16
/** Verses listed either side of the current one in the fine box. */
export const NEIGHBOURS = 3
/** The fine box: a `card` this wide, one FINE_STEP row per neighbour (a row of the list is a step of the finger), its
 *  right edge FINE_BOX_GAP left of the finger so the finger never covers it. */
export const FINE_BOX_W = 36
export const FINE_BOX_GAP = 24
export const FINE_BOX_H = (2 * NEIGHBOURS + 1) * FINE_STEP + 8
/** Scrolling shows the index only in a chapter at least this many screens long; a drag on the band always does. */
export const MIN_SCREENS = 1.5
/** Fade in as the page starts to move, out once it has rested INDEX_REST_MS. Core Animated plays them at the house
 *  tempo (0.7), so 140 and 320 ms on screen at 1×. */
export const INDEX_IN_MS = 98
export const INDEX_OUT_MS = 224
/** Real time (a setTimeout): a dwell, not an animation, so the Animation speed does not scale it. */
export const INDEX_REST_MS = 1200
/** A scroll this soon after the reader's own input on the page (a drag begun, a wheel, a touch, a scroll key) is theirs;
 *  any other scroll (a landing, read-aloud following, the footnote hold, a turn) is the screen's and never wakes it. */
export const INPUT_FRESH_MS = 400
/** After a scrub the screen keeps the index's last offset this long against late, out-of-order scroll events for the
 *  jumps (Android throttles them); the footnote hold keeps its own offset the same way. */
export const JUMP_HOLD_MS = 300
/** The verse "at the top" when nothing is pinned: the last whose start is within this of the offset (half a line). */
export const TOP_PROBE = 12

// ---- the chapter's stops ----

/** One stop of the index: a verse as the shown Bible prints it. Verses marked `m` (no text in this Bible) are no stop. */
export interface IndexVerse {
  /** The English verse number: what the screen scrolls to, flashes and names in the pill (formatRef converts). */
  v: number
  /** Short printed label: `nv ?? v`, with `nc:` where the printed chapter changes ("3:1"); never a range. */
  label: string
  /** The printed number the label step is taken on, so labels read 5, 10, 15 in the shown Bible. */
  printed: number
  /** The printed chapter changes here: labelled whenever spacing allows. */
  turn: boolean
}

/** The stops of a chapter, in order: a pure function of the chapter data, built once per chapter. `nc` is the
 *  chapter's own printed number where its first verse's is not the English one's (shared/types Chapter). */
export function indexVerses(verses: readonly Verse[], c: number, nc?: number): IndexVerse[] {
  const shown = verses.filter(v => !v.m)
  const head = nc ?? shown[0]?.nc ?? c
  return shown.map((v, k) => {
    const own = v.nc ?? c, printed = v.nv ?? v.v
    const turn = k > 0 && own !== (shown[k - 1].nc ?? c)
    return { v: v.v, printed, turn, label: turn || (k === 0 && own !== head) ? `${own}:${printed}` : String(printed) }
  })
}

/**
 * Which stops get a label in a column `h` tall: the first always; then every stop whose printed number is a multiple
 * of the step (and every printed-chapter turn), dropping any closer than LABEL_GAP to the last one kept. Spaced by
 * stop index, never by page height, so the column does not move when a note opens.
 */
export function labelStops(stops: readonly IndexVerse[], h: number): number[] {
  const n = stops.length
  if (!n) return []
  const per = n > 1 ? Math.max(0, h - 2 * COL_PAD) / (n - 1) : 0
  const step = LABEL_STEPS.find(s => s * per >= LABEL_GAP) ?? LABEL_STEPS[LABEL_STEPS.length - 1]
  const out = [0]
  for (let k = 1; k < n; k++) {
    if ((stops[k].printed % step === 0 || stops[k].turn) && (k - out[out.length - 1]) * per >= LABEL_GAP) out.push(k)
  }
  return out
}

// ---- mappings between the column and the stops (the dot, the finger) ----

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Column y (from the band's top) of stop `i` of `n`. */
export function stopY(i: number, n: number, h: number): number {
  return COL_PAD + (n > 1 ? i / (n - 1) : 0) * Math.max(0, h - 2 * COL_PAD)
}
/** Coarse: the stop under a finger at column y, absolute; above or below the column, the first or the last.
 *  The inverse of stopY, so the finger sits on the dot. */
export function stopAt(y: number, n: number, h: number): number {
  return n <= 1 ? 0 : Math.round(clamp((y - COL_PAD) / Math.max(1, h - 2 * COL_PAD), 0, 1) * (n - 1))
}
/** Fine: one stop per FINE_STEP from where fine mode began (`anchor` at `anchorY`), clamped to the chapter. */
export function fineStop(anchor: number, anchorY: number, y: number, n: number): number {
  return clamp(anchor + Math.round((y - anchorY) / FINE_STEP), 0, Math.max(0, n - 1))
}
/** The fine box's rows: stops i-NEIGHBOURS .. i+NEIGHBOURS, null past either end (the row stays, empty). */
export function neighbours(i: number, n: number): (number | null)[] {
  return Array.from({ length: 2 * NEIGHBOURS + 1 }, (_, k) => { const j = i + k - NEIGHBOURS; return j >= 0 && j < n ? j : null })
}
/** Where the fine box sits for a finger `x` from the band's right edge and `y` down the column: a translate from the
 *  face's top-right corner (the box is anchored there), kept inside the column. */
export function fineBoxAt(x: number, y: number, h: number): { x: number; y: number } {
  return { x: -(x + FINE_BOX_GAP), y: clamp(y - FINE_BOX_H / 2, 0, Math.max(0, h - FINE_BOX_H)) }
}
/** The label painted in accent: the last label at or before stop `i` (labels[0] is 0, so there always is one). */
export function nearestLabel(labels: readonly number[], i: number): number {
  let best = labels.length ? labels[0] : 0
  for (const k of labels) { if (k > i) break; best = k }
  return best
}

// ---- the live page's geometry ----

/** components/ChapterView.tsx ParaLayout, in scroll-content coordinates. */
export interface Para { index: number; y: number; height: number; firstVerse: number; lastVerse: number }
/** Where each verse starts inside its paragraph, where measured: (paragraph index, y). */
export type Marks = ReadonlyMap<number, { index: number; y: number }>
/** The live page as the screen knows it at this moment (its refs, read at call time). */
export interface PageNow { paras: ReadonlyMap<number, Para>; marks: Marks; y: number; contentH: number; viewportH: number }

/**
 * Scroll target of every stop: the offset that puts that verse's first line at the top of the page.
 *
 * Invariants of the result (length === stops.length):
 * - validated: paragraphs are taken in index order while their verse ranges and tops both advance; the first one that
 *   does not is the start of a stale suffix left by a regrouping (the layout maps are never pruned) and it and every
 *   later one are dropped. A mark counts only when `mark.index === para.index` and it lies inside the paragraph;
 *   otherwise the verse is placed by its share of the paragraph, as screenVerses' `start()` and the screen's `verseY`
 *   place it. A stop no accepted paragraph holds takes the previous stop's target.
 * - monotone: never less than the previous stop's (a stale web marker after a reflow cannot send verse 12 above 11).
 *   Verses sharing a line therefore share a target: the controller scrolls only when the target changes, while the pill
 *   and the dot still step verse by verse.
 * - the first stop is 0: scrubbing to the top shows the chapter's head, not verse 1 with its heading cut off.
 * - clamped to [0, max(0, contentH - viewportH)]: the last screenful of verses all land at the end; the index pins the
 *   verse landed on, since the offset can no longer say which it was.
 * Cost: O(paragraphs + stops), called per verse step and per scroll event while shown (at most 176 stops).
 */
export function stopTargets(stops: readonly IndexVerse[], page: PageNow): number[] {
  const live: Para[] = []
  for (const p of [...page.paras.values()].filter(p => Number.isFinite(p.y) && p.height >= 0 && p.firstVerse <= p.lastVerse).sort((a, b) => a.index - b.index)) {
    const last = live[live.length - 1]
    if (last && (p.firstVerse <= last.lastVerse || p.y < last.y)) break
    live.push(p)
  }
  const max = Math.max(0, page.contentH - page.viewportH)
  const out: number[] = []
  let j = 0
  for (let k = 0; k < stops.length; k++) {
    const v = stops[k].v
    while (j < live.length && live[j].lastVerse < v) j++
    const p = j < live.length && live[j].firstVerse <= v ? live[j] : null
    const m = page.marks.get(v)
    const top = !p ? out[k - 1] ?? 0
      : v === p.firstVerse ? p.y
      : m && m.index === p.index && m.y >= 0 && m.y <= p.height ? p.y + m.y
      : p.y + ((v - p.firstVerse) / (p.lastVerse - p.firstVerse + 1)) * p.height
    out.push(k === 0 ? 0 : clamp(Math.max(top, out[k - 1]), 0, max))
  }
  return out
}
/** The stop at the top of the page at offset `y`: the last target within TOP_PROBE of it, and of verses sharing that
 *  line the first. The dot while the page scrolls and nothing is pinned. */
export function stopAtOffset(targets: readonly number[], y: number): number {
  let k = 0
  for (let i = 0; i < targets.length; i++) if (targets[i] <= y + TOP_PROBE) k = i
  while (k > 0 && targets[k - 1] === targets[k]) k--
  return k
}

// ---- the state machine ----

/** The finger on the band before it is a scrub (x: px from the band's right edge, y: px from the band's top). */
export type Press =
  | { kind: 'idle' }
  /** Down, not yet a tap, a scrub or a sideways drag: nothing changes on screen, so a tap never flashes the index. */
  | { kind: 'pressed'; x: number; y: number; t: number }
  /** Went sideways first: let go TURN_LEFT or more to the left of where it began, it turns the chapter; else nothing. */
  | { kind: 'aside'; x0: number; x: number }
const IDLE: Press = { kind: 'idle' }

/** The index. A scrub is a state of its own: it is always drawn, never resting, and carries no pin (the landing becomes
 *  one on release), so "held while hidden" and "pinned while held" cannot be written. */
export type IndexState =
  | { kind: 'hidden'; press: Press }
  /** Drawn. `pin`: the stop the last scrub landed on; the dot and the accent label stay on it until the reader scrolls. */
  | { kind: 'shown'; pin: number | null; press: Press }
  /** On its way out; a movement brings it back from where the fade stands. */
  | { kind: 'fading'; pin: number | null; press: Press }
  /** The finger scrubs: `i` is the stop the page shows; `fine` is where fine mode began, null while coarse. */
  | { kind: 'held'; i: number; fine: { y: number; i: number } | null }
export const INITIAL: IndexState = { kind: 'hidden', press: IDLE }

export type IndexEvent =
  /** The live page scrolled (any cause). `byReader`: within INPUT_FRESH_MS of their own input. `long`: MIN_SCREENS. */
  | { type: 'scrolled'; byReader: boolean; long: boolean }
  /** The rest timer fired. */
  | { type: 'rest' }
  /** The fade-out finished. */
  | { type: 'faded' }
  | { type: 'down'; x: number; y: number; t: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'up'; t: number }
  /** The responder was taken away. */
  | { type: 'cancel' }
  /** Another chapter, or unmount: whatever was held is let go, the index hidden at once. */
  | { type: 'reset' }

export type IndexEffect =
  | { do: 'show' } | { do: 'hide' } | { do: 'hideNow' }
  | { do: 'armRest' } | { do: 'cancelRest' }
  | { do: 'tick' }
  /** The next chapter. */
  | { do: 'turn' }
  /** The scrub takes hold: the screen lets go of its holds on the page. */
  | { do: 'grab' }
  /** Jump to stop `i`; repaint the dot, the accent label, the pill and the fine box. */
  | { do: 'step'; i: number; fine: boolean }
  /** The scrub ended on stop `i` (null: let go without a landing, on another chapter). */
  | { do: 'release'; i: number | null }

/** The column the finger is over: `n` stops, `h` px tall. */
export interface Column { n: number; h: number }

const keep = (state: IndexState) => ({ state, effects: [] as IndexEffect[] })
const withPress = (s: Exclude<IndexState, { kind: 'held' }>, press: Press): IndexState => ({ ...s, press })
const landed = (i: number): { state: IndexState; effects: IndexEffect[] } => ({ state: { kind: 'shown', pin: i, press: IDLE }, effects: [{ do: 'release', i }, { do: 'armRest' }] })

/**
 * The whole policy, as a pure step. Invariants (tests/verseIndex.test.ts):
 * - the same spot never means two things: a quick still press is always 'turn', a vertical-first drag always a scrub,
 *   shown or not; nothing outside the band ever changes meaning;
 * - every 'grab' is followed by exactly one 'release' (on up, cancel or reset);
 * - while held, 'scrolled' changes nothing (the index's own jumps never feed back) and no rest timer runs;
 * - 'step' is emitted only when the stop or the mode changes.
 */
export function indexStep(s: IndexState, e: IndexEvent, col: Column): { state: IndexState; effects: IndexEffect[] } {
  switch (e.type) {
    case 'scrolled': {
      if (s.kind === 'held') return keep(s)
      const pin = s.kind === 'hidden' || e.byReader ? null : s.pin
      if (e.long && (e.byReader || s.kind === 'shown')) {
        return { state: { kind: 'shown', pin, press: s.press }, effects: s.kind === 'shown' ? [{ do: 'armRest' }] : [{ do: 'show' }, { do: 'armRest' }] }
      }
      return keep(s.kind === 'hidden' ? s : { ...s, pin })
    }
    case 'rest':
      return s.kind === 'shown' ? { state: { kind: 'fading', pin: s.pin, press: s.press }, effects: [{ do: 'hide' }] } : keep(s)
    case 'faded':
      return s.kind === 'fading' ? keep({ kind: 'hidden', press: s.press }) : keep(s)
    case 'down':
      return s.kind === 'held' ? keep(s) : keep(withPress(s, { kind: 'pressed', x: e.x, y: e.y, t: e.t }))
    case 'move': {
      if (s.kind === 'held') {
        const inward = e.x - EDGE_W
        const fine = s.fine ? (inward < FINE_BACK ? null : s.fine) : inward >= FINE_IN ? { y: e.y, i: s.i } : null
        const i = fine ? fineStop(fine.i, fine.y, e.y, col.n) : stopAt(e.y, col.n, col.h)
        const effects: IndexEffect[] = []
        if (fine && !s.fine) effects.push({ do: 'tick' })
        if (i !== s.i || !!fine !== !!s.fine) effects.push({ do: 'step', i, fine: !!fine })
        return { state: { kind: 'held', i, fine }, effects }
      }
      const p = s.press
      if (p.kind === 'aside') return keep(withPress(s, { ...p, x: e.x }))
      if (p.kind !== 'pressed') return keep(s)
      const dx = Math.abs(e.x - p.x), dy = Math.abs(e.y - p.y)
      if (dy >= SCRUB_SLOP && dy >= dx && col.n > 0) {
        const i = stopAt(e.y, col.n, col.h)
        const effects: IndexEffect[] = [{ do: 'grab' }, { do: 'tick' }]
        if (s.kind !== 'shown') effects.push({ do: 'show' })
        effects.push({ do: 'cancelRest' }, { do: 'step', i, fine: false })
        return { state: { kind: 'held', i, fine: null }, effects }
      }
      return dx >= SCRUB_SLOP || dy >= SCRUB_SLOP ? keep(withPress(s, { kind: 'aside', x0: p.x, x: e.x })) : keep(s)
    }
    case 'up': {
      if (s.kind === 'held') return landed(s.i)
      const p = s.press
      const turn = p.kind === 'pressed' ? e.t - p.t < TAP_MAX_MS : p.kind === 'aside' && p.x - p.x0 >= TURN_LEFT
      return { state: withPress(s, IDLE), effects: turn ? [{ do: 'turn' }] : [] }
    }
    case 'cancel':
      return s.kind === 'held' ? landed(s.i) : keep(withPress(s, IDLE))
    case 'reset':
      return { state: INITIAL, effects: [...(s.kind === 'held' ? [{ do: 'release', i: null } as const] : []), { do: 'cancelRest' }, { do: 'hideNow' }] }
    default:
      e satisfies never
      return keep(s)
  }
}

// ---- the controller: the state, the pin, the dwell timer and the touch session, against the screen and the component ----

/** What the index reads and does on the chapter screen's behalf. Every member reads the screen's refs at call time. */
export interface IndexPort {
  /** The live page now; null before it has laid out (the band still taps). */
  page(): PageNow | null
  /** Put the live page at `y` (already clamped) at once. The screen records `y` as its offset, holds it against late
   *  scroll events for the whole scrub and JUMP_HOLD_MS after, and pushes the pager's edges. Never twice with the same y. */
  jump(y: number): void
  /** A finger took the index. The screen drops its holds on the page (noteHold, landed, pendingVerse/End), forgets its
   *  last look (seenFrom) and, until release: no read-aloud follow, no reading credit, no progress. */
  grab(): void
  /** It let go. `v`: the verse (English numbering) to flash once, only when the landing differs from the verse current at
   *  the grab; null otherwise. */
  release(v: number | null): void
  /** A tap on the band, or a sideways-left drag from it: the next chapter. */
  turn(): void
}

/** What the face paints: the current stop (the dot, the accent label) and whether fine mode's box is up. */
export interface FaceView { cur: number; fine: boolean }

/** What the controller asks of the component: time and timers, and the few things drawn. */
export interface IndexEnv {
  now(): number
  /** A cancellable real-time timer. */
  after(ms: number, fn: () => void): () => void
  /** One haptic tick (the scrub takes hold; fine mode begins). */
  tick(): void
  /** The face: fade in (true) or out (false); when a fade-out has ended the component reports `faded()`. */
  fade(on: boolean): void
  /** The face gone at once, no fade (another chapter). */
  vanish(): void
  /** The face's state; called only when it changes, never per scroll event. */
  view(v: FaceView): void
  /** The verse the pill names while held (English numbering); null when let go. Called only when it changes. */
  held(v: number | null): void
  /** The fine box's place, every move while fine mode is on (a translate from the face's top-right corner). */
  box(at: { x: number; y: number }): void
}

export interface XY { x: number; y: number }

export interface VerseIndexController {
  /** Another chapter (or none yet): whatever was held is let go without a flash and the index is hidden at once. */
  chapter(stops: readonly IndexVerse[]): void
  /** The band's height, which is the column's. */
  layout(h: number): void
  /** The live page scrolled, whatever moved it (the screen's onScroll, after it has updated its refs). */
  scrolled(): void
  /** The reader's own input on the page (a drag begun, a wheel, a touch, a scroll key): the scrolls that follow are theirs. */
  input(): void
  /** The finger, in page coordinates; `band` is the band's right edge and top in the same, taken at the grant. */
  down(at: XY, band: { right: number; top: number }): void
  move(at: XY): void
  up(): void
  cancel(): void
  /** The fade-out the env was asked for has ended. */
  faded(): void
  dispose(): void
}

export function createVerseIndex(env: IndexEnv, port: IndexPort): VerseIndexController {
  let state = INITIAL
  let stops: readonly IndexVerse[] = []
  let h = 0
  let band = { right: 0, top: 0 }
  let inputAt = -Infinity
  let cancelRest: (() => void) | null = null
  /** The last offset jumped to: verses on one line share it, and the page scrolls once. */
  let lastJump: number | null = null
  /** The verse at the top when the scrub took hold: the landing flashes only if it differs. */
  let grabbed: number | null = null
  let view: FaceView = { cur: 0, fine: false }
  let heldV: number | null = null

  const publish = (v: FaceView) => { if (v.cur === view.cur && v.fine === view.fine) return; view = v; env.view(v) }
  const hold = (v: number | null) => { if (v === heldV) return; heldV = v; env.held(v) }
  const atTop = (page: PageNow) => stops[stopAtOffset(stopTargets(stops, page), page.y)]?.v ?? null
  const run = (f: IndexEffect) => {
    switch (f.do) {
      case 'show': env.fade(true); return
      case 'hide': env.fade(false); return
      case 'hideNow': env.vanish(); return
      case 'armRest': cancelRest?.(); cancelRest = env.after(INDEX_REST_MS, () => { cancelRest = null; dispatch({ type: 'rest' }) }); return
      case 'cancelRest': cancelRest?.(); cancelRest = null; return
      case 'tick': env.tick(); return
      case 'turn': port.turn(); return
      case 'grab': {
        const page = port.page()
        grabbed = page ? atTop(page) : null
        lastJump = null
        port.grab()
        return
      }
      case 'step': {
        const page = port.page()
        if (page) {
          const y = stopTargets(stops, page)[f.i]
          if (y !== undefined && y !== lastJump) { lastJump = y; port.jump(y) }
        }
        hold(stops[f.i]?.v ?? null)
        publish({ cur: f.i, fine: f.fine })
        return
      }
      case 'release': {
        hold(null)
        const v = f.i === null ? null : stops[f.i]?.v ?? null
        port.release(v !== null && v !== grabbed ? v : null)
        grabbed = null
        publish({ cur: f.i ?? view.cur, fine: false })
        return
      }
      default:
        f satisfies never
    }
  }
  const dispatch = (e: IndexEvent) => {
    const r = indexStep(state, e, { n: stops.length, h })
    state = r.state
    for (const f of r.effects) run(f)
  }
  return {
    chapter(next) {
      dispatch({ type: 'reset' })
      stops = next
      lastJump = null
      publish({ cur: 0, fine: false })
    },
    layout(height) { h = height },
    scrolled() {
      const page = port.page()
      if (!page) return
      dispatch({ type: 'scrolled', byReader: env.now() - inputAt < INPUT_FRESH_MS, long: page.contentH >= MIN_SCREENS * page.viewportH })
      // the dot follows the page while it shows; a landing stays pinned until the reader scrolls
      if (state.kind === 'shown' || state.kind === 'fading') publish({ cur: state.pin ?? stopAtOffset(stopTargets(stops, page), page.y), fine: false })
    },
    input() { inputAt = env.now() },
    down(at, origin) {
      band = origin
      dispatch({ type: 'down', x: band.right - at.x, y: at.y - band.top, t: env.now() })
    },
    move(at) {
      const x = band.right - at.x, y = at.y - band.top
      dispatch({ type: 'move', x, y })
      if (state.kind === 'held' && state.fine) env.box(fineBoxAt(x, y, h))
    },
    up() { dispatch({ type: 'up', t: env.now() }) },
    cancel() { dispatch({ type: 'cancel' }) },
    faded() { dispatch({ type: 'faded' }) },
    dispose() { dispatch({ type: 'reset' }) },
  }
}
