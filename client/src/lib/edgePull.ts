// Vertical chapter turns from the ends of the scroll: the numbers and the gesture arithmetic, free of React Native so
// the tests run in node. The functions marked 'worklet' also run on the UI thread inside the native pager.

/** Finger travel past the edge (after the slop) that turns the chapter on release. */
export const PULL_FAR = 72
/** Finger travel before a touch that began at an edge counts as a pull; under Android's 8 dp scroll slop, so the pull
 *  claims the touch before the scroll view does. */
export const PULL_SLOP = 6
/** Blank space between chapters stacked vertically during a pull and a vertical turn; the cue sits in it. */
export const PULL_GAP = 120
/** Height of the cue (chevron and label). */
export const CUE_H = 48
/** Wheel events closer together than this belong to one gesture (a trackpad's momentum tail included). */
export const WHEEL_GAP_MS = 220
/** After a wheel turn the rest of the gesture is swallowed until the wheel has been still this long: the turn's
 *  re-render can hold up input for a couple of hundred ms, which must not read as the start of a new gesture. */
export const WHEEL_TAIL_MS = 450
/** Wheel delta to pull distance. A mouse notch is 48 to 100 px depending on the platform, so a turn takes two or
 *  three deliberate notches; one never does. */
export const WHEEL_GAIN = 0.5
/** Scroll offsets within this of an end count as at the end (fractional pixels on high-density screens). */
export const EDGE_EPS = 2

export interface Edges { top: boolean; bottom: boolean }
export type PullDir = 1 | -1

export function edgesOf(y: number, contentH: number, viewportH: number): Edges {
  return { top: y <= EDGE_EPS, bottom: y + viewportH >= contentH - EDGE_EPS }
}
/** At neither end: no pull can open. */
export const NO_EDGES: Edges = { top: false, bottom: false }

/**
 * Where each page of a pager sits, so the page a turn lands on is judged by ITS scroll and not the last page's. Native
 * cannot ask a scroll view where it is, and onScroll reaches the reader only from the current page, so the reader
 * reports every offset it learns or sets: onScroll of the current page, the scrollTo it makes on a neighbour readied
 * for a pull, a landing. A page never heard of sits at 0 (a fresh mount). A page whose landing is still to come is
 * `unknown` and at no end until that landing or a scroll reports in: no pull, rather than the wrong one.
 */
export interface EdgeLedger {
  scrolled(key: string, y: number): void
  /** Scrolled to its end (the reader does not know the offset). */
  toEnd(key: string): void
  unknown(key: string): void
  drop(key: string): void
  /** The last offset reported, 0 for a page never heard of, null while unknown or at an end. */
  y(key: string): number | null
  edges(key: string, contentH: number, viewportH: number): Edges
}
export function createEdgeLedger(): EdgeLedger {
  const ys = new Map<string, number | 'end' | 'unknown'>()
  return {
    scrolled(key, y) { ys.set(key, y) },
    toEnd(key) { ys.set(key, 'end') },
    unknown(key) { ys.set(key, 'unknown') },
    drop(key) { ys.delete(key) },
    y(key) { const v = ys.get(key) ?? 0; return typeof v === 'number' ? v : null },
    edges(key, contentH, viewportH) {
      const v = ys.get(key) ?? 0
      if (v === 'unknown') return NO_EDGES
      if (v === 'end') return { top: contentH <= viewportH + EDGE_EPS, bottom: true }
      return edgesOf(v, contentH, viewportH)
    },
  }
}

/**
 * How far the page moves for `px` of pull: follows the finger at first, then stiffens so the gap never fills and the
 * next chapter never peeks. At the first or last chapter (`open` false) it gives half as much.
 */
export function pullShift(px: number, open: boolean): number {
  'worklet'
  const g = open ? PULL_GAP : PULL_GAP / 2
  return g * (1 - Math.exp(-Math.max(0, px) / g))
}

/**
 * Decide what a touch that began with the scroll at `top` / `bottom` is, from its travel so far: 1 = pulling past the
 * bottom (next chapter), -1 = past the top (previous), 0 = not a pull (sideways, or back into the text), null = too
 * early to say.
 */
export function pullOpen(dx: number, dy: number, top: boolean, bottom: boolean): PullDir | 0 | null {
  'worklet'
  const ax = Math.abs(dx), ay = Math.abs(dy)
  if (ax >= PULL_SLOP && ax >= ay) return 0
  if (ay < PULL_SLOP) return null
  const dir: PullDir = dy < 0 ? 1 : -1
  return (dir > 0 ? bottom : top) ? dir : 0
}

/** Pull distance for a finger `dy` from where the touch began (the slop is not counted). */
export function pullPx(dy: number, dir: PullDir): number {
  'worklet'
  return Math.max(0, -dy * dir - PULL_SLOP)
}

/** Whether a pull released at `px` turns the chapter. */
export function pullTurns(px: number, open: boolean): boolean {
  'worklet'
  return open && px >= PULL_FAR
}

/**
 * A pull is told from a flick by its own shape, not by what came before it: it turns only if, at release, the finger
 * was moving at a hand's pace (under PULL_HAND_PX_MS over the last PULL_PACE_MS) or had been held past PULL_FAR for
 * PULL_HOLD_MS. A flick (a short, fast stroke released at once) eases back even when it travelled past PULL_FAR, so a
 * run of flicks down a chapter never turns it, while a pull made the moment a fling lands always does.
 */
export const PULL_HAND_PX_MS = 1.5, PULL_PACE_MS = 60, PULL_HOLD_MS = 120
export function pullDeliberate(speedPxMs: number, heldMs: number): boolean {
  'worklet'
  return speedPxMs < PULL_HAND_PX_MS || heldMs >= PULL_HOLD_MS
}

export interface PullStep { dir: PullDir; px: number }
export interface PullEnd extends PullStep { deliberate: boolean }

/** One touch on the web: `start` with the scroll's edges at touch-down (a touch that goes down before the scroll has
 *  reached an end is never a pull), `move` returns the live pull (null while it is not one), `end` returns the pull as
 *  released and whether it was deliberate. Times are the events' own timestamps (ms). */
export function createTouchPull() {
  type Touch = { x: number; y: number; t: number; top: boolean; bottom: boolean; dir: PullDir | 0 | null; px: number; far: number | null; trail: [number, number][] }
  let s: Touch | null = null
  return {
    start(x: number, y: number, e: Edges, t = 0) { s = e.top || e.bottom ? { x, y, t, top: e.top, bottom: e.bottom, dir: null, px: 0, far: null, trail: [[t, 0]] } : null },
    move(x: number, y: number, t = 0): PullStep | null {
      if (!s || s.dir === 0) return null
      const dy = y - s.y
      if (s.dir === null) {
        s.dir = pullOpen(x - s.x, dy, s.top, s.bottom)
        if (!s.dir) return null
      }
      s.px = pullPx(dy, s.dir)
      if (s.px < PULL_FAR) s.far = null
      else s.far ??= t
      s.trail.push([t, s.px])
      while (s.trail.length > 2 && s.trail[1][0] <= t - PULL_PACE_MS) s.trail.shift()
      return { dir: s.dir, px: s.px }
    },
    end(t = 0): PullEnd | null {
      if (!s || !s.dir) { s = null; return null }
      // pace over the last PULL_PACE_MS: from the newest sample at least that old (or the touch-down, if younger)
      while (s.trail.length > 1 && s.trail[1][0] <= t - PULL_PACE_MS) s.trail.shift()
      const [t0, p0] = s.trail[0]
      const speed = Math.abs(s.px - p0) / Math.max(1, t - t0)
      const r = { dir: s.dir, px: s.px, deliberate: pullDeliberate(speed, s.far === null ? 0 : t - s.far) }
      s = null
      return r
    },
  }
}

export type WheelStep =
  | { kind: 'pass' }                       // not ours: the scroll view scrolls as usual
  | { kind: 'swallow' }                    // the tail of a gesture that already turned: eat it
  | { kind: 'pull'; dir: PullDir; px: number }
  | { kind: 'turn'; dir: PullDir; px: number }

/**
 * Mouse wheel and trackpad. A gesture is a run of wheel events less than WHEEL_GAP_MS apart. It can pull only if the
 * scroll was already at the end it pushes against when the gesture began, so a fling that scrolls down and hits the
 * bottom never turns, however long its momentum runs on. Its deltas past the edge add up (times WHEEL_GAIN); at
 * PULL_FAR it turns once and the rest of the gesture is swallowed (until a WHEEL_TAIL_MS pause). Turning back into
 * the text ends the pull.
 */
export function createWheelPull() {
  let last = -Infinity, dir: PullDir | 0 = 0, sum = 0, spent = false
  return {
    feed(dy: number, t: number, e: Edges): WheelStep {
      if (t - last > (spent ? WHEEL_TAIL_MS : WHEEL_GAP_MS)) {
        dir = dy > 0 && e.bottom ? 1 : dy < 0 && e.top ? -1 : 0
        sum = 0
        spent = false
      }
      last = t
      if (spent) return { kind: 'swallow' }
      if (!dir || dy === 0) return { kind: 'pass' }
      if (Math.sign(dy) !== dir) { dir = 0; sum = 0; return { kind: 'pass' } }
      sum += Math.abs(dy) * WHEEL_GAIN
      if (sum >= PULL_FAR) { spent = true; return { kind: 'turn', dir, px: sum } }
      return { kind: 'pull', dir, px: sum }
    },
  }
}

/** Wheel delta in pixels whatever the event's unit (lines, pages). */
export function wheelPx(deltaY: number, mode: number, pageH: number): number {
  return mode === 1 ? deltaY * 16 : mode === 2 ? deltaY * pageH : deltaY
}
