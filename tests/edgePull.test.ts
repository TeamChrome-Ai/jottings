import { describe, it, expect } from 'vitest'
import { NO_EDGES, PULL_FAR, PULL_GAP, PULL_HAND_PX_MS, PULL_HOLD_MS, PULL_SLOP, WHEEL_GAP_MS, WHEEL_TAIL_MS, createEdgeLedger, createTouchPull, createWheelPull, edgesOf, pullDeliberate, pullOpen, pullPx, pullShift, pullTurns, wheelPx } from '../client/src/lib/edgePull'

const BOTTOM = { top: false, bottom: true }, TOP = { top: true, bottom: false }, MIDDLE = { top: false, bottom: false }, SHORT = { top: true, bottom: true }

describe('edgesOf', () => {
  it('reads the ends of the scroll with a little tolerance', () => {
    expect(edgesOf(0, 3000, 800)).toEqual(TOP)
    expect(edgesOf(2199, 3000, 800)).toEqual(BOTTOM)
    expect(edgesOf(1000, 3000, 800)).toEqual(MIDDLE)
    expect(edgesOf(0, 500, 800)).toEqual(SHORT)   // a chapter shorter than the screen is at both ends
  })
})

describe('edges at the bottom (build 26 regressions)', () => {
  it('fractional offsets at the end of a long chapter are the bottom only, never the top', () => {
    expect(edgesOf(3121.5, 3857, 735)).toEqual(BOTTOM)
    expect(edgesOf(3122.4, 3857, 735)).toEqual(BOTTOM)
    expect(edgesOf(0.6, 3857, 735)).toEqual(TOP)
  })
  it('a chapter shorter than the screen (Psalm 117) is at both ends, one just longer (Obadiah) at one', () => {
    expect(edgesOf(0, 700, 735)).toEqual(SHORT)
    expect(edgesOf(0, 3173, 735)).toEqual(TOP)
  })
  it('scrolling back from the bottom (finger down, wheel up) is never a pull', () => {
    expect(pullOpen(0, 40, false, true)).toBe(0)
    const t = createTouchPull()
    t.start(200, 200, BOTTOM)
    for (let y = 205; y <= 600; y += 5) expect(t.move(200, y)).toBeNull()
    expect(t.end()).toBeNull()
    const w = createWheelPull()
    for (let i = 0; i < 10; i++) expect(w.feed(-100, i * 30, BOTTOM).kind).toBe('pass')
  })
  it('a touch that goes down before the scroll has reached the end (stopping a fling short of it) is never a pull', () => {
    const t = createTouchPull()
    t.start(200, 760, MIDDLE, 0)
    expect(t.move(200, 300, 20)).toBeNull()
    expect(t.end(24)).toBeNull()
  })
  it('each touch is judged afresh: a pull does not latch into the next touch', () => {
    const t = createTouchPull()
    t.start(200, 600, BOTTOM)
    t.move(200, 500)
    expect(t.end()?.dir).toBe(1)
    t.start(200, 600, MIDDLE)
    expect(t.move(200, 400)).toBeNull()
    expect(t.end()).toBeNull()
  })
})

/** A touch at the bottom: finger from y 700 up by `dist` over `ms` (16 ms steps), then released `holdMs` later. */
function stroke(dist: number, ms: number, holdMs = 0, edges = BOTTOM) {
  const t = createTouchPull()
  t.start(200, 700, edges, 1000)
  const steps = Math.max(1, Math.round(ms / 16))
  for (let i = 1; i <= steps; i++) t.move(200, 700 - dist * i / steps, 1000 + ms * i / steps)
  return t.end(1000 + ms + holdMs)
}

describe('pull or flick: judged by the stroke itself (build 27)', () => {
  it('a deliberate pull turns however soon after a fling it starts: nothing before the touch counts', () => {
    const r = stroke(220, 280)                      // ~0.8 px/ms, a hand's pace
    expect(r?.dir).toBe(1)
    expect(r!.px).toBeGreaterThanOrEqual(PULL_FAR)
    expect(r!.deliberate).toBe(true)
    expect(pullTurns(r!.px, true) && r!.deliberate).toBe(true)
  })
  it('a flick (short, fast, released at once) never turns, even past PULL_FAR', () => {
    const r = stroke(500, 20)
    expect(r!.px).toBeGreaterThan(PULL_FAR)
    expect(r!.deliberate).toBe(false)
  })
  it('a run of flicks at the end: none of them turns', () => {
    for (let i = 0; i < 6; i++) expect(stroke(400 + i * 40, 16 + i * 4)?.deliberate).toBe(false)
  })
  it('a fast stroke that is then held past the threshold turns', () => {
    expect(stroke(300, 40, PULL_HOLD_MS + 10)?.deliberate).toBe(true)
    expect(stroke(300, 40, 30)?.deliberate).toBe(false)
  })
  it('a quick drag that slows before release turns: only the last PULL_PACE_MS count', () => {
    const t = createTouchPull()
    t.start(200, 700, BOTTOM, 0)
    t.move(200, 500, 30)                             // 200 px in 30 ms
    t.move(200, 490, 60)
    t.move(200, 485, 100)
    t.move(200, 482, 140)                            // then a crawl
    expect(t.end(150)?.deliberate).toBe(true)
  })
  it('a stroke released inside 80 ms short of the threshold eases back (not a pull that turns)', () => {
    const r = stroke(50, 60)
    expect(pullTurns(r!.px, true)).toBe(false)
  })
  it('pullDeliberate: under a hand pace, or held long enough', () => {
    expect(pullDeliberate(PULL_HAND_PX_MS - 0.01, 0)).toBe(true)
    expect(pullDeliberate(PULL_HAND_PX_MS, 0)).toBe(false)
    expect(pullDeliberate(9, PULL_HOLD_MS)).toBe(true)
  })
})

describe('pullOpen', () => {
  it('waits for the slop, then pulls only past the end the scroll was at', () => {
    expect(pullOpen(0, -(PULL_SLOP - 1), false, true)).toBeNull()
    expect(pullOpen(0, -PULL_SLOP, false, true)).toBe(1)       // finger up at the bottom: next
    expect(pullOpen(0, PULL_SLOP, true, false)).toBe(-1)       // finger down at the top: previous
    expect(pullOpen(0, PULL_SLOP, false, true)).toBe(0)        // down at the bottom is scrolling back into the text
    expect(pullOpen(0, -PULL_SLOP, true, false)).toBe(0)
    expect(pullOpen(0, -PULL_SLOP, false, false)).toBe(0)
  })
  it('leaves sideways drags to the chapter swipe', () => {
    expect(pullOpen(PULL_SLOP, -2, false, true)).toBe(0)
    expect(pullOpen(-10, 9, true, false)).toBe(0)
  })
})

describe('pull distance', () => {
  it('does not count the slop and never goes negative', () => {
    expect(pullPx(-(PULL_SLOP + 72), 1)).toBe(72)
    expect(pullPx(PULL_SLOP + 10, -1)).toBe(10)
    expect(pullPx(20, 1)).toBe(0)
  })
  it('turns at PULL_FAR, and never at the first or last chapter', () => {
    expect(pullTurns(PULL_FAR - 1, true)).toBe(false)
    expect(pullTurns(PULL_FAR, true)).toBe(true)
    expect(pullTurns(500, false)).toBe(false)
  })
  it('moves the page less than the finger and never fills the gap', () => {
    const at = pullShift(PULL_FAR, true)
    expect(at).toBeGreaterThan(40)
    expect(at).toBeLessThan(PULL_FAR)
    expect(pullShift(5000, true)).toBeLessThanOrEqual(PULL_GAP)
    expect(pullShift(PULL_FAR, false)).toBeLessThan(at)
    expect(pullShift(-5, true)).toBe(0)
  })
})

describe('createTouchPull', () => {
  it('pulls past the bottom and reports the release', () => {
    const t = createTouchPull()
    t.start(200, 600, BOTTOM)
    expect(t.move(200, 597)).toBeNull()
    expect(t.move(201, 590)).toEqual({ dir: 1, px: 4 })
    expect(t.move(201, 600 - PULL_SLOP - 80)).toEqual({ dir: 1, px: 80 })
    expect(t.end()).toMatchObject({ dir: 1, px: 80 })
  })
  it('a release short of the threshold is still a pull, just not a turn', () => {
    const t = createTouchPull()
    t.start(200, 300, TOP)
    t.move(200, 300 + PULL_SLOP + 40)
    const r = t.end()
    expect(r).toMatchObject({ dir: -1, px: 40 })
    expect(pullTurns(r!.px, true)).toBe(false)
  })
  it('never pulls from a touch that began away from the ends', () => {
    const t = createTouchPull()
    t.start(200, 600, MIDDLE)
    expect(t.move(200, 100)).toBeNull()
    expect(t.end()).toBeNull()
  })
  it('a touch that first scrolls back into the text stays a scroll', () => {
    const t = createTouchPull()
    t.start(200, 600, BOTTOM)
    expect(t.move(200, 620)).toBeNull()
    expect(t.move(200, 400)).toBeNull()
    expect(t.end()).toBeNull()
  })
  it('a sideways touch is the chapter swipe’s', () => {
    const t = createTouchPull()
    t.start(300, 600, SHORT)
    expect(t.move(240, 596)).toBeNull()
    expect(t.move(100, 500)).toBeNull()
    expect(t.end()).toBeNull()
  })
})

describe('createWheelPull', () => {
  /** Feed evenly spaced wheel events; `edge(i)` gives the scroll's edges before event i. */
  const run = (w: ReturnType<typeof createWheelPull>, deltas: number[], t0: number, step: number, edge: (i: number) => typeof BOTTOM) =>
    deltas.map((d, i) => w.feed(d, t0 + i * step, edge(i)))

  it('two 100 px notches at the bottom turn, once', () => {
    const w = createWheelPull()
    const s = run(w, [100, 100, 100, 100], 1000, 60, () => BOTTOM)
    expect(s[0]).toEqual({ kind: 'pull', dir: 1, px: 50 })
    expect(s[1]).toEqual({ kind: 'turn', dir: 1, px: 100 })
    expect(s.slice(2).every(x => x.kind === 'swallow')).toBe(true)
  })
  it('smaller notches (48-53 px on Linux and Firefox) take three', () => {
    const s = run(createWheelPull(), [50, 50, 50], 0, 60, () => BOTTOM)
    expect(s.map(x => x.kind)).toEqual(['pull', 'pull', 'turn'])
  })
  it('one notch pulls and is let go', () => {
    const w = createWheelPull()
    expect(w.feed(100, 0, BOTTOM).kind).toBe('pull')
    // the next notch comes after the gesture has ended: it starts from nothing
    expect(w.feed(100, WHEEL_GAP_MS + 1, BOTTOM)).toEqual({ kind: 'pull', dir: 1, px: 50 })
  })
  it('momentum that scrolls down and reaches the end never turns, however long it runs', () => {
    const w = createWheelPull()
    const deltas = Array.from({ length: 120 }, (_, i) => Math.max(1, 60 - i * 0.5))
    const s = run(w, deltas, 0, 16, i => i < 30 ? MIDDLE : BOTTOM)
    expect(s.every(x => x.kind === 'pass')).toBe(true)
  })
  it('a trackpad swipe begun at the bottom turns once and swallows its own momentum', () => {
    const w = createWheelPull()
    const deltas = [4, 8, 14, 20, 26, 30, 28, 24, 20, 16, 12, 8, 6, 4, 2, 1]
    const s = run(w, deltas, 0, 16, () => BOTTOM)
    expect(s.filter(x => x.kind === 'turn')).toHaveLength(1)
    const turnAt = s.findIndex(x => x.kind === 'turn')
    expect(s.slice(turnAt + 1).every(x => x.kind === 'swallow')).toBe(true)
    // after a pause the next gesture is judged afresh (the new chapter is at its top: scrolling down passes)
    expect(w.feed(40, 16 * deltas.length + WHEEL_TAIL_MS + 10, TOP).kind).toBe('pass')
  })
  it('a turned gesture stays swallowed through a stall shorter than WHEEL_TAIL_MS (the turn re-rendering)', () => {
    const w = createWheelPull()
    const s = run(w, [100, 100], 0, 60, () => BOTTOM)
    expect(s[1].kind).toBe('turn')
    expect(w.feed(40, 60 + WHEEL_GAP_MS + 50, TOP).kind).toBe('swallow')
    expect(w.feed(40, 60 + WHEEL_GAP_MS + 50 + WHEEL_TAIL_MS + 1, TOP).kind).toBe('pass')
  })
  it('pulls past the top toward the previous chapter', () => {
    const w = createWheelPull()
    const s = run(w, [-60, -60, -60], 0, 30, () => TOP)
    expect(s.map(x => x.kind)).toEqual(['pull', 'pull', 'turn'])
    expect(s[2]).toMatchObject({ dir: -1 })
  })
  it('turning back into the text ends the pull', () => {
    const w = createWheelPull()
    expect(w.feed(60, 0, BOTTOM).kind).toBe('pull')
    expect(w.feed(-30, 20, BOTTOM).kind).toBe('pass')
    expect(w.feed(60, 40, BOTTOM).kind).toBe('pass')
  })
  it('normalises line and page deltas', () => {
    expect(wheelPx(3, 1, 800)).toBe(48)
    expect(wheelPx(1, 2, 800)).toBe(800)
    expect(wheelPx(100, 0, 800)).toBe(100)
  })
})

describe('the edge ledger: a page landed on is judged by its own scroll (ministry reader, build 31)', () => {
  const H = 3000, V = 800
  /** What a touch that begins now and moves `dy` would open, from the ledger's edges for `key`. */
  const opens = (l: ReturnType<typeof createEdgeLedger>, key: string, dy: number) => { const e = l.edges(key, H, V); return pullOpen(0, dy, e.top, e.bottom) }
  it('a page never heard of sits at 0 (a fresh mount): the previous pull opens, the next does not', () => {
    const l = createEdgeLedger()
    expect(l.edges('a/1', H, V)).toEqual(TOP)
    expect(opens(l, 'a/1', 40)).toBe(-1)
    expect(opens(l, 'a/1', -40)).toBe(0)
  })
  it('a page with its landing still to come is at no end: no pull either way', () => {
    const l = createEdgeLedger()
    l.unknown('a/2')
    expect(l.edges('a/2', H, V)).toEqual(NO_EDGES)
    expect(l.y('a/2')).toBeNull()
    expect(opens(l, 'a/2', 40)).toBe(0)
    expect(opens(l, 'a/2', -40)).toBe(0)
    // the landing reports in: mid-page, still nothing
    l.scrolled('a/2', 1200)
    expect(l.edges('a/2', H, V)).toEqual(MIDDLE)
    expect(l.y('a/2')).toBe(1200)
  })
  it('the previous section pulled in at its end: only the next pull opens (the reported bug was the previous cue here)', () => {
    const l = createEdgeLedger()
    l.toEnd('a/1')
    expect(l.edges('a/1', H, V)).toEqual(BOTTOM)
    expect(opens(l, 'a/1', 40)).toBe(0)
    expect(opens(l, 'a/1', -40)).toBe(1)
    expect(l.y('a/1')).toBeNull()
    // a section shorter than the screen is at both ends even at its end
    expect(l.edges('a/1', 500, V)).toEqual(SHORT)
  })
  it('a stale top is cleared by the first scroll, and a scroll back to 0 restores it', () => {
    const l = createEdgeLedger()
    l.scrolled('a/3', 0)
    expect(l.edges('a/3', H, V)).toEqual(TOP)
    l.scrolled('a/3', 900)
    expect(l.edges('a/3', H, V)).toEqual(MIDDLE)
    expect(opens(l, 'a/3', 40)).toBe(0)
    l.scrolled('a/3', 2200)
    expect(l.edges('a/3', H, V)).toEqual(BOTTOM)
    l.scrolled('a/3', 1)
    expect(l.edges('a/3', H, V)).toEqual(TOP)
  })
  it('pages are kept apart: turning back to a page finds it where it was left, and a dropped page starts afresh', () => {
    const l = createEdgeLedger()
    l.scrolled('a/1', 1500)
    l.scrolled('a/2', 0)
    expect(l.edges('a/2', H, V)).toEqual(TOP)
    expect(l.edges('a/1', H, V)).toEqual(MIDDLE)
    l.drop('a/1')
    expect(l.edges('a/1', H, V)).toEqual(TOP)
    expect(l.y('a/1')).toBe(0)
  })
})
