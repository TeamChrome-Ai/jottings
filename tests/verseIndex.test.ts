import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  COL_PAD, EDGE_CLEAR, EDGE_W, FINE_BACK, FINE_BOX_GAP, FINE_BOX_H, FINE_IN, FINE_STEP, INDEX_IN_MS, INDEX_OUT_MS, INDEX_REST_MS, INITIAL, INPUT_FRESH_MS,
  JUMP_HOLD_MS, LABEL_GAP, MIN_SCREENS, SCRUB_SLOP, TAP_MAX_MS, TURN_LEFT,
  createVerseIndex, fineBoxAt, fineStop, indexStep, indexVerses, labelStops, nearestLabel, neighbours, stopAt, stopAtOffset, stopTargets, stopY,
  type IndexEnv, type IndexEvent, type IndexPort, type IndexState, type PageNow,
} from '../client/src/lib/verseIndex'
import { HOUSE_TEMPO } from '../client/src/lib/motionSpeed'

const verses = (n: number) => Array.from({ length: n }, (_, k) => ({ v: k + 1, t: 'x' }))
const does = (r: { effects: { do: string }[] }) => r.effects.map(f => f.do)

describe('the numbers', () => {
  it('fade in 140 and out 320 on screen at 1×, after a real 1.2 s', () => {
    expect(Math.round(INDEX_IN_MS / HOUSE_TEMPO)).toBe(140)
    expect(Math.round(INDEX_OUT_MS / HOUSE_TEMPO)).toBe(320)
    expect(INDEX_REST_MS).toBe(1200)
  })
  it('keep the band the old zone, 120 clear of the ends, inside the 20 px gutter', () => {
    expect(EDGE_W).toBe(18)
    expect(EDGE_CLEAR).toBe(120)
  })
  it('enter fine mode 40 px in from the band and leave it under 24: a hysteresis, one verse per 16 px', () => {
    expect(FINE_IN).toBe(40)
    expect(FINE_BACK).toBe(24)
    expect(FINE_BACK).toBeLessThan(FINE_IN)
    expect(FINE_STEP).toBe(16)
  })
  it('tell a tap from a scrub at the touch slop, within the long-press delay; a sideways turn at the pager’s own slop', () => {
    expect(SCRUB_SLOP).toBe(8)
    expect(TAP_MAX_MS).toBe(500)
    const src = readFileSync(new URL('../client/src/components/motion/reader.tsx', import.meta.url), 'utf8')
    expect(TURN_LEFT).toBe(Number(/export const DRAG_SLOP = (\d+)/.exec(src)![1]))
  })
  it('hold the index’s offset 300 ms after a scrub, as the footnote hold does; the reader’s input is fresh for 400', () => {
    expect(JUMP_HOLD_MS).toBe(300)
    expect(INPUT_FRESH_MS).toBe(400)
    expect(MIN_SCREENS).toBe(1.5)
  })
  it('the lib imports no react-native and only types from @shared, so all of it runs here', () => {
    const src = readFileSync(new URL('../client/src/lib/verseIndex.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/from 'react(-native)?'/)
    for (const m of src.matchAll(/^import (.*) from '(@shared\/[^']+)'/gm)) expect(m[1], m[0]).toMatch(/^type /)
  })
})

describe('the stops', () => {
  it('are the verses the shown Bible prints, `m` verses left out, `nc:` where its chapter turns', () => {
    const vs = [{ v: 27, t: 'a', nv: 27 }, { v: 28, t: 'b', nc: 3, nv: 1 }, { v: 29, t: 'c', nc: 3, nv: 2 }, { v: 30, t: '', m: 1 as const }]
    const stops = indexVerses(vs, 2)
    expect(stops.map(s => s.label)).toEqual(['27', '3:1', '2'])
    expect(stops.map(s => s.v)).toEqual([27, 28, 29])
    expect(stops.map(s => s.printed)).toEqual([27, 1, 2])
    expect(stops.map(s => s.turn)).toEqual([false, true, false])
  })
  it('name the chapter on the first stop when the chapter opens inside another printed one', () => {
    const vs = [{ v: 1, t: 'a', nc: 3, nv: 19 }, { v: 2, t: 'b', nc: 3, nv: 20 }]
    expect(indexVerses(vs, 4, 3).map(s => s.label)).toEqual(['19', '20'])
    expect(indexVerses(vs, 4).map(s => s.label)).toEqual(['19', '20'])
    expect(indexVerses([{ v: 1, t: 'a' }, { v: 2, t: 'b', nc: 5, nv: 1 }], 4, 4).map(s => s.label)).toEqual(['1', '5:1'])
  })
  it('are plain numbers for an English chapter', () => {
    expect(indexVerses(verses(3), 7).map(s => s.label)).toEqual(['1', '2', '3'])
  })
})

describe('the labels', () => {
  it('step by 5 in John 1 and by 10 in Psalm 119 on a 460 px column, never closer than 20 px', () => {
    const john = labelStops(indexVerses(verses(51), 1), 460)
    expect(john.map(k => k + 1)).toEqual([1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50])
    const ps = labelStops(indexVerses(verses(176), 119), 460)
    expect(ps.slice(0, 3).map(k => k + 1)).toEqual([1, 10, 20])
    for (let k = 1; k < ps.length; k++) expect(stopY(ps[k], 176, 460) - stopY(ps[k - 1], 176, 460)).toBeGreaterThanOrEqual(LABEL_GAP)
  })
  it('label a two-verse psalm with its first verse only, and nothing with no stops', () => {
    expect(labelStops(indexVerses(verses(2), 117), 460)).toEqual([0])
    expect(labelStops(indexVerses(verses(1), 117), 460)).toEqual([0])
    expect(labelStops([], 460)).toEqual([])
  })
  it('label a printed-chapter turn whenever there is room, in the printed numbering', () => {
    const vs = [...verses(18), ...Array.from({ length: 10 }, (_, k) => ({ v: 19 + k, t: 'x', nc: 2, nv: k + 1 }))]
    const stops = indexVerses(vs, 1)
    const labels = labelStops(stops, 460)
    expect(stops[18].label).toBe('2:1')
    expect(labels.map(k => stops[k].label)).toEqual(['1', '5', '10', '15', '2:1', '5', '10'])
    // a turn one stop after a label has no room
    const tight = indexVerses([...verses(20), ...Array.from({ length: 10 }, (_, k) => ({ v: 21 + k, t: 'x', nc: 2, nv: k + 1 }))], 1)
    expect(labelStops(tight, 460).map(k => tight[k].label)).toEqual(['1', '5', '10', '15', '20', '5', '10'])
  })
  it('paint in accent the last label at or above the current verse', () => {
    expect(nearestLabel([0, 4, 9], 7)).toBe(4)
    expect(nearestLabel([0, 4, 9], 9)).toBe(9)
    expect(nearestLabel([0, 4, 9], 0)).toBe(0)
  })
})

describe('the finger', () => {
  it('sits on the dot: coarse is the inverse of the column position, clamped past the ends', () => {
    for (let i = 0; i < 51; i++) expect(stopAt(stopY(i, 51, 460), 51, 460)).toBe(i)
    for (let i = 0; i < 176; i++) expect(stopAt(stopY(i, 176, 460), 176, 460)).toBe(i)
    expect(stopAt(-40, 51, 460)).toBe(0)
    expect(stopAt(900, 51, 460)).toBe(50)
    expect(stopAt(COL_PAD, 1, 460)).toBe(0)
    expect(stopY(0, 1, 460)).toBe(COL_PAD)
  })
  it('steps one verse per 16 px in fine mode, from where it began, clamped to the chapter', () => {
    expect(fineStop(20, 300, 300 + 3 * FINE_STEP, 51)).toBe(23)
    expect(fineStop(20, 300, 300 - 2 * FINE_STEP, 51)).toBe(18)
    expect(fineStop(20, 300, 307, 51)).toBe(20)
    expect(fineStop(1, 300, 0, 51)).toBe(0)
    expect(fineStop(49, 0, 900, 51)).toBe(50)
  })
  it('lists three neighbours either side, empty rows past the ends', () => {
    expect(neighbours(1, 51)).toEqual([null, null, 0, 1, 2, 3, 4])
    expect(neighbours(50, 51)).toEqual([47, 48, 49, 50, null, null, null])
  })
  it('puts the fine box beside the finger, further in, and keeps it inside the column', () => {
    expect(fineBoxAt(60, 200, 460)).toEqual({ x: -(60 + FINE_BOX_GAP), y: 200 - FINE_BOX_H / 2 })
    expect(fineBoxAt(60, 10, 460).y).toBe(0)
    expect(fineBoxAt(60, 455, 460).y).toBe(460 - FINE_BOX_H)
  })
})

describe('where each verse lands', () => {
  // title 0-200; para 0: verses 1-3 (2 and 3 share a line at 100), para 1: 4-5 (no own marks), para 7: stale (left by
  // a regrouping, its range inside para 0's)
  const page = (o: Partial<PageNow> = {}): PageNow => ({
    paras: new Map([
      [0, { index: 0, y: 200, height: 300, firstVerse: 1, lastVerse: 3 }],
      [1, { index: 1, y: 500, height: 200, firstVerse: 4, lastVerse: 5 }],
      [7, { index: 7, y: 260, height: 40, firstVerse: 2, lastVerse: 2 }],
    ]),
    marks: new Map([[2, { index: 0, y: 100 }], [3, { index: 0, y: 100 }], [5, { index: 9, y: 10 }]]),
    y: 0, contentH: 2000, viewportH: 600, ...o,
  })
  const stops = indexVerses(verses(5), 1)
  it('puts the first at the chapter head, shares a line, ignores stale paragraphs and marks from another paragraph', () => {
    expect(stopTargets(stops, page())).toEqual([0, 300, 300, 500, 600])
  })
  it('ignores a mark beyond its paragraph’s height and places the verse by its share instead', () => {
    expect(stopTargets(stops, page({ marks: new Map([[2, { index: 0, y: 900 }]]) }))).toEqual([0, 300, 400, 500, 600])
  })
  it('never goes back up, and stops at the end of the scroll', () => {
    expect(stopTargets(stops, page({ contentH: 1150 }))).toEqual([0, 300, 300, 500, 550])
    const back = page({ marks: new Map([[2, { index: 0, y: 200 }], [3, { index: 0, y: 50 }]]) })
    expect(stopTargets(stops, back)).toEqual([0, 400, 400, 500, 600])
  })
  it('drops the stale suffix even when it comes first in verse order, and a verse no paragraph holds takes the last target', () => {
    const p = page({ paras: new Map([[0, { index: 0, y: 200, height: 300, firstVerse: 1, lastVerse: 3 }], [3, { index: 3, y: 100, height: 50, firstVerse: 4, lastVerse: 5 }]]) })
    expect(stopTargets(stops, p)).toEqual([0, 300, 300, 300, 300])
    expect(stopTargets(indexVerses(verses(2), 1), page({ paras: new Map() }))).toEqual([0, 0])
    expect(stopTargets([], page())).toEqual([])
  })
  it('a chapter shorter than the screen lands everything at 0', () => {
    expect(stopTargets(stops, page({ contentH: 500 }))).toEqual([0, 0, 0, 0, 0])
  })
  it('reads the verse at the top as the first of a shared line, within half a line of the offset', () => {
    expect(stopAtOffset([0, 300, 300, 500], 305)).toBe(1)
    expect(stopAtOffset([0, 300, 300, 500], 290)).toBe(1)
    expect(stopAtOffset([0, 300, 300, 500], 287)).toBe(0)
    expect(stopAtOffset([0, 300, 300, 500], 2000)).toBe(3)
    expect(stopAtOffset([], 0)).toBe(0)
  })
})

describe('the state machine', () => {
  const col = { n: 51, h: 460 }
  const run = (evs: IndexEvent[], s: IndexState = INITIAL) => evs.reduce<{ state: IndexState; effects: { do: string }[] }>((r, e) => { const n = indexStep(r.state, e, col); return { state: n.state, effects: [...r.effects, ...n.effects] } }, { state: s, effects: [] })
  const down = (y = 200, t = 0, x = 9): IndexEvent => ({ type: 'down', x, y, t })
  const move = (x: number, y: number): IndexEvent => ({ type: 'move', x, y })
  const SHOWN: IndexState = { ...INITIAL, kind: 'shown', pin: null }
  it('turns the chapter on a quick still press, shown or not', () => {
    expect(does(run([down(), { type: 'up', t: 120 }]))).toEqual(['turn'])
    expect(does(run([down(), { type: 'up', t: 120 }], SHOWN))).toEqual(['turn'])
    expect(does(run([down(), move(9 + SCRUB_SLOP - 1, 200 + SCRUB_SLOP - 1), { type: 'up', t: 120 }]))).toEqual(['turn'])
  })
  it('turns nothing on a still press held past TAP_MAX_MS', () => {
    expect(does(run([down(), { type: 'up', t: TAP_MAX_MS }]))).toEqual([])
    expect(run([down(), { type: 'up', t: TAP_MAX_MS }]).state).toEqual(INITIAL)
  })
  it('a sideways drag does nothing, unless let go 24 px or more to the left of where it began: then it turns', () => {
    expect(does(run([down(), move(9 + SCRUB_SLOP, 200), { type: 'up', t: 100 }]))).toEqual([])
    expect(does(run([down(), move(9 + SCRUB_SLOP, 203), move(9 + TURN_LEFT - 1, 230), { type: 'up', t: 900 }]))).toEqual([])
    expect(does(run([down(), move(9 + SCRUB_SLOP, 203), move(9 + TURN_LEFT, 230), { type: 'up', t: 900 }]))).toEqual(['turn'])
    // to the right (off the edge) never
    expect(does(run([down(60, 0, 60), move(60 - SCRUB_SLOP, 60), move(0, 60), { type: 'up', t: 100 }]))).toEqual([])
    // a sideways drag that then goes vertical stays a sideways drag
    expect(does(run([down(), move(9 + SCRUB_SLOP, 200), move(9 + SCRUB_SLOP, 400), { type: 'up', t: 100 }]))).toEqual([])
  })
  it('scrubs a vertical drag even while hidden: grab, tick, show, jump; one release with the landing, then the dwell', () => {
    const r = run([down(), move(9, 200 + SCRUB_SLOP), { type: 'up', t: 900 }])
    expect(does(r)).toEqual(['grab', 'tick', 'show', 'cancelRest', 'step', 'release', 'armRest'])
    const i = stopAt(200 + SCRUB_SLOP, 51, 460)
    expect(r.effects).toContainEqual({ do: 'step', i, fine: false })
    expect(r.state).toEqual({ kind: 'shown', pin: i, press: { kind: 'idle' } })
  })
  it('scrubs a drag that goes vertical after a sideways start of under the slop, and never a diagonal one', () => {
    expect(does(run([down(), move(9 + 5, 200 + SCRUB_SLOP)]))).toEqual(['grab', 'tick', 'show', 'cancelRest', 'step'])
    expect(does(run([down(), move(9 + SCRUB_SLOP + 1, 200 + SCRUB_SLOP)]))).toEqual([])
  })
  it('does not show again when already shown, and brings a fading index back', () => {
    expect(does(run([down(), move(9, 220)], SHOWN))).toEqual(['grab', 'tick', 'cancelRest', 'step'])
    expect(does(run([down(), move(9, 220)], { ...INITIAL, kind: 'fading', pin: 3 }))).toEqual(['grab', 'tick', 'show', 'cancelRest', 'step'])
  })
  it('steps only when the verse changes', () => {
    const y0 = stopY(10, 51, 460)
    const r = run([down(y0), move(9, y0 + SCRUB_SLOP), move(9, y0 + SCRUB_SLOP + 1), move(9, y0 + SCRUB_SLOP + 2), move(9, y0 + 40)])
    expect(r.effects.filter(f => f.do === 'step').map(f => (f as { i: number }).i)).toEqual([stopAt(y0 + SCRUB_SLOP, 51, 460), stopAt(y0 + 40, 51, 460)])
  })
  it('goes fine 40 px in from the band, not at 39, and back to coarse under 24, not at 24', () => {
    const start = run([down(), move(9, 210)])
    const at = (x: number) => indexStep(start.state, move(x, 210), col)
    expect(at(EDGE_W + FINE_IN - 1).state).toMatchObject({ kind: 'held', fine: null })
    expect(does(at(EDGE_W + FINE_IN - 1))).toEqual([])
    const fine = at(EDGE_W + FINE_IN)
    expect(fine.state).toMatchObject({ kind: 'held', fine: { y: 210, i: stopAt(210, 51, 460) } })
    expect(does(fine)).toEqual(['tick', 'step'])
    expect(fine.effects[1]).toEqual({ do: 'step', i: stopAt(210, 51, 460), fine: true })
    const wobble = indexStep(fine.state, move(EDGE_W + FINE_IN - 10, 210), col)
    expect(wobble.state).toMatchObject({ kind: 'held', fine: { y: 210 } })
    expect(does(wobble)).toEqual([])
    expect(indexStep(fine.state, move(EDGE_W + FINE_BACK, 210), col).state).toMatchObject({ fine: { y: 210 } })
    const back = indexStep(fine.state, move(EDGE_W + FINE_BACK - 1, 210), col)
    expect(back.state).toMatchObject({ kind: 'held', fine: null })
    expect(does(back)).toEqual(['step'])
  })
  it('in fine mode one verse per 16 px from where it began, whatever the column would say', () => {
    const i0 = stopAt(210, 51, 460)
    const r = run([down(), move(9, 210), move(EDGE_W + FINE_IN, 210), move(EDGE_W + FINE_IN, 210 + 3 * FINE_STEP), move(EDGE_W + FINE_IN, 210 - FINE_STEP)])
    const steps = r.effects.filter(f => f.do === 'step') as { i: number; fine: boolean }[]
    expect(steps.map(s => s.i)).toEqual([i0, i0, i0 + 3, i0 - 1])
    expect(steps.map(s => s.fine)).toEqual([false, true, true, true])
    expect(r.state).toMatchObject({ kind: 'held', i: i0 - 1 })
  })
  it('does not wake for the screen’s own scrolls, nor in a short chapter, nor while held', () => {
    expect(does(run([{ type: 'scrolled', byReader: false, long: true }]))).toEqual([])
    expect(does(run([{ type: 'scrolled', byReader: true, long: false }]))).toEqual([])
    expect(run([{ type: 'scrolled', byReader: true, long: false }]).state).toEqual(INITIAL)
    const held = run([down(), move(9, 220)])
    const r = indexStep(held.state, { type: 'scrolled', byReader: true, long: true }, col)
    expect(r.state).toBe(held.state)
    expect(does(r)).toEqual([])
    expect(does(indexStep(held.state, { type: 'rest' }, col))).toEqual([])
  })
  it('shows on the reader’s scroll, keeps showing while the page moves, fades at rest, hides once faded, and unpins', () => {
    const r = run([{ type: 'scrolled', byReader: true, long: true }, { type: 'scrolled', byReader: false, long: true }, { type: 'rest' }, { type: 'faded' }], { ...SHOWN, kind: 'hidden' })
    expect(does(r)).toEqual(['show', 'armRest', 'armRest', 'hide'])
    expect(r.state).toEqual(INITIAL)
    expect(run([{ type: 'scrolled', byReader: true, long: true }], { ...SHOWN, pin: 4 }).state).toEqual(SHOWN)
    expect(run([{ type: 'scrolled', byReader: false, long: true }], { ...SHOWN, pin: 4 }).state).toEqual({ ...SHOWN, pin: 4 })
  })
  it('a fading index comes back for the reader’s scroll, keeps its pin through the screen’s, and a short chapter unpins without showing', () => {
    const fading: IndexState = { ...INITIAL, kind: 'fading', pin: 4 }
    expect(indexStep(fading, { type: 'scrolled', byReader: true, long: true }, col)).toEqual({ state: SHOWN, effects: [{ do: 'show' }, { do: 'armRest' }] })
    expect(indexStep(fading, { type: 'scrolled', byReader: false, long: true }, col)).toEqual({ state: fading, effects: [] })
    expect(indexStep({ ...SHOWN, pin: 4 }, { type: 'scrolled', byReader: true, long: false }, col)).toEqual({ state: SHOWN, effects: [] })
  })
  it('pins the landing, and a cancelled scrub lands where it is', () => {
    const held = run([down(), move(9, 220)])
    const r = indexStep(held.state, { type: 'cancel' }, col)
    const i = stopAt(220, 51, 460)
    expect(r).toEqual({ state: { kind: 'shown', pin: i, press: { kind: 'idle' } }, effects: [{ do: 'release', i }, { do: 'armRest' }] })
    expect(indexStep({ ...SHOWN, press: { kind: 'pressed', x: 9, y: 200, t: 0 } }, { type: 'cancel' }, col)).toEqual({ state: SHOWN, effects: [] })
  })
  it('lets go of a held scrub on another chapter without a landing, and hides at once', () => {
    const r = run([down(), move(9, 220), { type: 'reset' }])
    expect(r.effects.slice(-3)).toEqual([{ do: 'release', i: null }, { do: 'cancelRest' }, { do: 'hideNow' }])
    expect(r.state).toEqual(INITIAL)
    expect(indexStep({ ...SHOWN, pin: 2 }, { type: 'reset' }, col)).toEqual({ state: INITIAL, effects: [{ do: 'cancelRest' }, { do: 'hideNow' }] })
  })
  it('every grab gets exactly one release, on up, cancel or reset', () => {
    for (const end of [{ type: 'up', t: 900 }, { type: 'cancel' }, { type: 'reset' }] as IndexEvent[]) {
      const r = run([down(), move(9, 220), move(9, 240), move(EDGE_W + FINE_IN, 240), end])
      expect(does(r).filter(d => d === 'grab')).toHaveLength(1)
      expect(does(r).filter(d => d === 'release')).toHaveLength(1)
    }
  })
  it('ignores a second touch-down while held and a move with no finger down', () => {
    const held = run([down(), move(9, 220)])
    expect(indexStep(held.state, down(300, 50), col)).toEqual({ state: held.state, effects: [] })
    expect(indexStep(INITIAL, move(9, 300), col)).toEqual({ state: INITIAL, effects: [] })
    expect(indexStep(INITIAL, { type: 'up', t: 10 }, col)).toEqual({ state: INITIAL, effects: [] })
  })
  it('a vertical drag with no chapter yet is nothing (a sideways-left one may still turn)', () => {
    const none = { n: 0, h: 460 }
    expect(indexStep({ ...INITIAL, press: { kind: 'pressed', x: 9, y: 200, t: 0 } }, move(9, 300), none)).toMatchObject({ state: { press: { kind: 'aside' } }, effects: [] })
  })
})

describe('the controller (fake clock)', () => {
  /** A 51-verse chapter in one paragraph, 40 px a verse under a 200 px head; the last eight stops share the clamped end. */
  function harness(o: { stops?: ReturnType<typeof indexVerses>; page?: Partial<PageNow>; noPage?: boolean } = {}) {
    let now = 1000
    const timers: { at: number; fn: () => void }[] = []
    const calls: string[] = []
    const page: PageNow = { paras: new Map([[0, { index: 0, y: 200, height: 51 * 40, firstVerse: 1, lastVerse: 51 }]]), marks: new Map(), y: 0, contentH: 2500, viewportH: 600, ...o.page }
    const env: IndexEnv = {
      now: () => now,
      after: (ms, fn) => { const t = { at: now + ms, fn }; timers.push(t); return () => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) } },
      tick: () => calls.push('tick'),
      fade: on => calls.push(on ? 'fade:in' : 'fade:out'),
      vanish: () => calls.push('vanish'),
      view: v => calls.push(`view:${v.cur}${v.fine ? 'f' : ''}`),
      held: v => calls.push(`held:${v}`),
      box: at => calls.push(`box:${at.x},${Math.round(at.y)}`),
    }
    const port: IndexPort = {
      page: () => o.noPage ? null : page,
      jump: y => { calls.push(`jump:${y}`); page.y = y },
      grab: () => calls.push('grab'),
      release: v => calls.push(`release:${v}`),
      turn: () => calls.push('turn'),
    }
    const ctl = createVerseIndex(env, port)
    ctl.chapter(o.stops ?? indexVerses(verses(51), 1))
    ctl.layout(460)
    calls.length = 0
    const advance = (ms: number) => {
      const end = now + ms
      for (;;) {
        const due = timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        timers.splice(timers.indexOf(due), 1)
        now = due.at
        due.fn()
      }
      now = end
    }
    const band = { right: 412, top: 120 }
    /** A finger `x` px from the band's right edge, `y` down the column. */
    const at = (x: number, y: number) => ({ x: band.right - x, y: band.top + y })
    const take = () => calls.splice(0)
    return { ctl, calls, take, advance, page, band, at }
  }
  const target = (k: number) => k === 0 ? 0 : Math.min(1900, 200 + 40 * k)

  it('shows on the reader’s drag, fades 1.2 s of real time after the last scroll event, hides once faded', () => {
    const { ctl, take, advance } = harness()
    ctl.scrolled()
    expect(take()).toEqual([])
    ctl.input()
    ctl.scrolled()
    expect(take()).toEqual(['fade:in'])
    advance(1199)
    expect(take()).toEqual([])
    advance(1)
    expect(take()).toEqual(['fade:out'])
    ctl.faded()
    ctl.scrolled()
    expect(take()).toEqual([])
    ctl.input()
    ctl.scrolled()
    expect(take()).toEqual(['fade:in'])
  })
  it('keeps showing while the page moves: every scroll event re-arms the dwell, the reader’s or the screen’s', () => {
    const { ctl, take, advance } = harness()
    ctl.input(); ctl.scrolled()
    advance(1000)
    ctl.scrolled()
    advance(1000)
    expect(take()).toEqual(['fade:in'])
    advance(200)
    expect(take()).toEqual(['fade:out'])
  })
  it('the reader’s input is fresh for 400 ms, then a scroll is the screen’s', () => {
    const { ctl, take, advance } = harness()
    ctl.input()
    advance(INPUT_FRESH_MS)
    ctl.scrolled()
    expect(take()).toEqual([])
  })
  it('a fading index comes back on a scroll, from where the fade stands', () => {
    const { ctl, take, advance } = harness()
    ctl.input(); ctl.scrolled()
    advance(1200)
    expect(take()).toEqual(['fade:in', 'fade:out'])
    ctl.input(); ctl.scrolled()
    expect(take()).toEqual(['fade:in'])
  })
  it('never shows by scrolling a chapter under 1.5 screens, nor before the page has laid out', () => {
    const short = harness({ page: { contentH: 899 } })
    short.ctl.input(); short.ctl.scrolled()
    expect(short.take()).toEqual([])
    const none = harness({ noPage: true })
    none.ctl.input(); none.ctl.scrolled()
    expect(none.take()).toEqual([])
  })
  it('a tap turns the chapter and touches nothing else; a press held 500 ms turns nothing', () => {
    const { ctl, take, advance, at, band } = harness()
    ctl.down(at(9, 200), band)
    advance(120)
    ctl.up()
    expect(take()).toEqual(['turn'])
    ctl.down(at(9, 200), band)
    advance(TAP_MAX_MS)
    ctl.up()
    expect(take()).toEqual([])
  })
  it('a sideways drag turns only when let go 24 px left of where it began', () => {
    const { ctl, take, at, band } = harness()
    ctl.down(at(9, 200), band); ctl.move(at(9 + SCRUB_SLOP, 202)); ctl.move(at(9 + TURN_LEFT, 240)); ctl.up()
    expect(take()).toEqual(['turn'])
    ctl.down(at(9, 200), band); ctl.move(at(9 + SCRUB_SLOP, 202)); ctl.move(at(9 + TURN_LEFT - 1, 240)); ctl.up()
    expect(take()).toEqual([])
  })
  it('a scrub: grab before the first jump, one jump per target, the pill per verse, one release and the dwell from the landing', () => {
    const { ctl, take, advance, at, band } = harness()
    ctl.down(at(9, 200), band)
    expect(take()).toEqual([])
    ctl.move(at(9, 200 + SCRUB_SLOP))
    const i = stopAt(200 + SCRUB_SLOP, 51, 460)
    expect(take()).toEqual(['grab', 'tick', 'fade:in', `jump:${target(i)}`, `held:${i + 1}`, `view:${i}`])
    ctl.move(at(9, stopY(i + 1, 51, 460)))
    expect(take()).toEqual([`jump:${target(i + 1)}`, `held:${i + 2}`, `view:${i + 1}`])
    advance(2000)
    expect(take()).toEqual([])
    ctl.up()
    expect(take()).toEqual(['held:null', `release:${i + 2}`])
    advance(1199)
    expect(take()).toEqual([])
    advance(1)
    expect(take()).toEqual(['fade:out'])
  })
  it('verses on one line share a target and the page scrolls once, while the pill and the dot still step', () => {
    const page: Partial<PageNow> = { paras: new Map([[0, { index: 0, y: 200, height: 400, firstVerse: 1, lastVerse: 4 }]]), marks: new Map([[2, { index: 0, y: 100 }], [3, { index: 0, y: 100 }], [4, { index: 0, y: 300 }]]), contentH: 1600 }
    const { ctl, take, at, band } = harness({ stops: indexVerses(verses(4), 1), page })
    ctl.down(at(9, stopY(0, 4, 460)), band)
    ctl.move(at(9, stopY(1, 4, 460)))
    expect(take()).toEqual(['grab', 'tick', 'fade:in', 'jump:300', 'held:2', 'view:1'])
    ctl.move(at(9, stopY(2, 4, 460)))
    expect(take()).toEqual(['held:3', 'view:2'])
    ctl.move(at(9, stopY(3, 4, 460)))
    expect(take()).toEqual(['jump:500', 'held:4', 'view:3'])
  })
  it('flashes the landing only when it is not the verse that was at the top at the grab', () => {
    const { ctl, take, at, band } = harness()
    ctl.down(at(9, 0), band)
    ctl.move(at(9, SCRUB_SLOP))
    expect(take()).toEqual(['grab', 'tick', 'fade:in', 'jump:0', 'held:1'])
    ctl.up()
    expect(take()).toEqual(['held:null', 'release:null'])
    ctl.down(at(9, 0), band)
    ctl.move(at(9, 200))
    const i = stopAt(200, 51, 460)
    ctl.up()
    expect(take().slice(-1)).toEqual([`release:${i + 1}`])
  })
  it('pins the landing at the clamped end: late scroll events keep the dot on it, the reader’s own scroll lets it go', () => {
    const { ctl, take, at, band, page } = harness()
    ctl.down(at(9, 300), band)
    ctl.move(at(9, 900))
    expect(take()).toEqual(['grab', 'tick', 'fade:in', 'jump:1900', 'held:51', 'view:50'])
    ctl.up()
    expect(take()).toEqual(['held:null', 'release:51'])
    expect(page.y).toBe(1900)
    ctl.scrolled()
    ctl.scrolled()
    expect(take()).toEqual([])
    ctl.input()
    ctl.scrolled()
    expect(take()).toEqual([`view:${stopAtOffset(stopTargets(indexVerses(verses(51), 1), page), 1900)}`])
  })
  it('the face is told of a scroll only when the verse at the top changes', () => {
    const { ctl, take, page } = harness()
    ctl.input(); ctl.scrolled()
    expect(take()).toEqual(['fade:in'])
    page.y = 5; ctl.scrolled()
    page.y = 100; ctl.scrolled()
    expect(take()).toEqual([])
    page.y = 240; ctl.scrolled()
    page.y = 250; ctl.scrolled()
    expect(take()).toEqual(['view:1'])
    page.y = 280; ctl.scrolled()
    expect(take()).toEqual(['view:2'])
  })
  it('fine mode: one tick as it begins, the box follows every move, one verse per 16 px, coarse again under 24 px', () => {
    const { ctl, take, at, band } = harness()
    ctl.down(at(9, 200), band)
    ctl.move(at(9, 210))
    const i = stopAt(210, 51, 460)
    take()
    ctl.move(at(EDGE_W + FINE_IN - 1, 210))
    expect(take()).toEqual([])
    ctl.move(at(EDGE_W + FINE_IN, 210))
    expect(take()).toEqual(['tick', `view:${i}f`, `box:${-(EDGE_W + FINE_IN + FINE_BOX_GAP)},${Math.round(210 - FINE_BOX_H / 2)}`])
    ctl.move(at(EDGE_W + FINE_IN + 2, 210 + 3 * FINE_STEP))
    expect(take()).toEqual([`jump:${target(i + 3)}`, `held:${i + 4}`, `view:${i + 3}f`, `box:${-(EDGE_W + FINE_IN + 2 + FINE_BOX_GAP)},${Math.round(210 + 3 * FINE_STEP - FINE_BOX_H / 2)}`])
    ctl.move(at(EDGE_W + FINE_BACK - 1, 210 + 3 * FINE_STEP))
    const back = stopAt(210 + 3 * FINE_STEP, 51, 460)
    expect(take()).toEqual([`jump:${target(back)}`, `held:${back + 1}`, `view:${back}`])
  })
  it('a cancelled scrub lands where it is; another chapter lets go without a landing and hides at once', () => {
    const c = harness()
    c.ctl.down(c.at(9, 200), c.band); c.ctl.move(c.at(9, 220)); c.take()
    c.ctl.cancel()
    expect(c.take()).toEqual(['held:null', `release:${stopAt(220, 51, 460) + 1}`])
    const r = harness()
    r.ctl.down(r.at(9, 200), r.band); r.ctl.move(r.at(9, 220)); r.take()
    r.ctl.chapter(indexVerses(verses(20), 2))
    expect(r.take()).toEqual(['held:null', 'release:null', 'vanish', 'view:0'])
    r.advance(2000)
    expect(r.take()).toEqual([])
    const d = harness()
    d.ctl.input(); d.ctl.scrolled(); d.take()
    d.ctl.dispose()
    expect(d.take()).toEqual(['vanish'])
    d.advance(2000)
    expect(d.take()).toEqual([])
  })
  it('a scrub on the band always shows, even in a short chapter, and the index’s own jumps never re-arm or unpin', () => {
    const { ctl, take, advance, at, band } = harness({ page: { contentH: 800 } })
    ctl.down(at(9, 200), band)
    ctl.move(at(9, 230))
    expect(take()[2]).toBe('fade:in')
    ctl.scrolled()
    ctl.up()
    ctl.scrolled()
    expect(take().filter(c => c.startsWith('view'))).toEqual([])
    advance(1200)
    expect(take()).toEqual(['fade:out'])
  })
  it('a drag on the band before the chapter has laid out neither grabs nor jumps', () => {
    const { ctl, take, at, band } = harness({ stops: [] })
    ctl.down(at(9, 200), band); ctl.move(at(9, 300)); ctl.up()
    expect(take()).toEqual([])
  })
})
