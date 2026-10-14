import { describe, it, expect } from 'vitest'
import { applyBeat, earnedMs, freshThrough, heardCostMs, judge, type ReadThrough, type Shape } from '../shared/readThrough'
import { requiredSeconds } from '../shared/reading'
import { adopt, newVisit, noteHeard, noteScreen, takeEvidence } from '../client/src/lib/readCredit'

// Readers, second by second, judged by the end-and-time rule (what the server applies to apps before 1.0.5) and by the
// read-through rule. The screen is a window of words: a phone shows about 120 at the default text size. Every reader
// beats every 15 s and once on leaving, as the app does, and the app's own glance (a look each second) decides which
// verses a beat says were seen. PRINT_PERSONAS=1 prints the table.

/** John 3 as the recordings have it: 36 verses, 802 words, the fastest voice at 206 words a minute. */
const JOHN3_WORDS = [27, 24, 23, 30, 31, 21, 15, 34, 13, 18, 31, 22, 23, 21, 15, 25, 25, 33, 26, 23, 24, 15, 21, 11, 15, 32, 19, 19, 31, 9, 26, 20, 13, 24, 13, 30]
const NARRATION_WPM = 206
const shapeOf = (words: number[]): Shape => ({ verses: words.map((_, i) => i + 1), words, audioMs: words.map(w => Math.round(w / NARRATION_WPM * 60_000)) })
const JOHN3 = shapeOf(JOHN3_WORDS)
const PSALM117 = shapeOf([12, 15])
const SCREEN = 120

/** What the reader does in second `t`: the window of words on screen (null: not showing), a touch, the verse the voice
 *  finished (1-based), whether the voice is reading, and 'gone' once the reader has left the chapter. */
interface Moment { from: number; to: number; touch?: boolean; visible?: boolean; heard?: number; listening?: boolean }
type Script = (t: number) => Moment | 'gone'

const starts = (s: Shape) => { const a: number[] = []; let n = 0; for (const w of s.words) { a.push(n); n += w } return a }
const total = (s: Shape) => s.words.reduce((a, w) => a + w, 0)
/** Verse numbers any part of which is in the word window. */
function versesIn(s: Shape, from: number, to: number): [number, number] | null {
  const st = starts(s)
  let a = 0, b = -1
  s.words.forEach((w, i) => { if (st[i] < to && st[i] + w > from) { if (!a) a = i + 1; b = i + 1 } })
  return a ? [a, b] : null
}

interface Outcome { creditedAt: number | null }
/** Runs sittings of a script (each a fresh app session) against both rules. */
function run(shape: Shape, sittings: { at: number; script: Script }[]): { old: Outcome; now: Outcome } {
  const required = requiredSeconds(total(shape)) * 1000
  let through: ReadThrough = freshThrough(shape)
  const old: Outcome = { creditedAt: null }, now: Outcome = { creditedAt: null }
  for (const { at, script } of sittings) {
    let dwell = 0, lastBeat = at, lastTouch = at, reachedOld = false
    const visit = newVisit(1, 1)
    adopt(visit, through, shape)
    let m: Moment | 'gone' = script(0)
    const idleWindow = (cur: Moment | null) => Math.min(180_000, Math.max(60_000, (cur ? Math.max(0, cur.to - cur.from) : 0) * 600))
    /** The last second on the chapter: the beat that closes the visit goes as the reader leaves, the screen still on. */
    let last: Moment | null = null
    const beat = (t: number, closing: boolean) => {
      const cur = m === 'gone' ? last : m
      const elapsed = t - lastBeat
      lastBeat = t
      const visible = !!cur && cur.visible !== false
      const oldActive = t - lastTouch < 60_000
      const newActive = t - lastTouch < idleWindow(cur)
      // the old rule: the time while active and showing; credited when this beat finds the reader at the end
      if (oldActive && visible) dwell += Math.min(elapsed, 20_000)
      if (!closing && cur) reachedOld = cur.to >= total(shape) || cur.heard === shape.words.length || (reachedOld && !!cur.listening)
      if (old.creditedAt === null && reachedOld && dwell >= required) old.creditedAt = t
      // the read-through rule
      const { seen, heard } = takeEvidence(visit, shape)
      const ms = earnedMs(elapsed, { active: newActive, visible, listening: !!cur?.listening || heard.length > 0, heardCostMs: heardCostMs(shape, heard) })
      through = applyBeat(through, shape, { ms, seen, heard })
      adopt(visit, through, shape)
      if (now.creditedAt === null && judge(through, shape).read) now.creditedAt = t
    }
    for (let s = 0; ; s++) {
      const t = at + s * 1000
      m = script(s)
      if (m === 'gone') { beat(t, true); break }
      last = m
      if (m.touch || (m.heard ?? 0) > 0 || s === 0) lastTouch = t
      const showing = m.visible !== false
      noteScreen(visit, shape, showing ? versesIn(shape, m.from, m.to) : null, t, showing && t - lastTouch < idleWindow(m))
      if (m.heard) noteHeard(visit, m.heard)
      if (s > 0 && s % 15 === 0) beat(t, false)
      if (s > 3600) throw new Error('a script never left')
    }
  }
  return { old, now }
}

/** Reading down the chapter at `wpm`, scrolling as it goes; then `after` seconds more where `then` puts the screen. */
function reading(shape: Shape, wpm: number, after: number, then: (t: number) => Moment = () => ({ from: total(shape) - SCREEN, to: total(shape), touch: false }), screen = SCREEN, touchEvery = 4): Script {
  const W = total(shape), done = Math.ceil(W / wpm * 60)
  return s => {
    if (s <= done) { const r = Math.min(W, s * wpm / 60); const from = Math.max(0, Math.min(W - screen, r - 20)); return { from, to: Math.min(W, from + screen), touch: s % touchEvery === 0 } }
    if (s <= done + after) return then(s - done)
    return 'gone'
  }
}
/** The voice reading the chapter at `speed`, half a second between verses; the screen follows it, or is off. */
function listening(shape: Shape, speed: number, screenOn: boolean): Script {
  const ends: number[] = []
  let t = 0
  for (const a of shape.audioMs!) { t += (a ?? 0) / speed + 500; ends.push(t) }
  return s => {
    const ms = s * 1000
    if (ms > t + 2000) return 'gone'
    const i = ends.findIndex(e => e > ms)
    const v = i < 0 ? shape.words.length : i + 1
    const finished = ends.findIndex(e => e > ms - 1000 && e <= ms)
    const st = starts(shape)[v - 1]
    return { from: Math.max(0, st - 20), to: Math.min(total(shape), st - 20 + SCREEN), visible: screenOn, listening: ms <= t, heard: finished >= 0 ? finished + 1 : undefined }
  }
}
const W3 = total(JOHN3)
/** Psalm 2: 12 verses, 204 words, under two screens. */
const PSALM2 = shapeOf([12, 15, 14, 16, 18, 17, 22, 18, 17, 20, 13, 22])
const atTop = (): Moment => ({ from: 0, to: SCREEN, touch: true })
const atEnd = (touch = false): Moment => ({ from: W3 - SCREEN, to: W3, touch })

const PERSONAS: { name: string; shape: Shape; sittings: { at: number; script: Script }[]; now: boolean }[] = [
  { name: 'reads at 200 wpm, leaves when done', shape: JOHN3, now: true, sittings: [{ at: 0, script: reading(JOHN3, 200, 5) }] },
  { name: 'reads at 350 wpm, leaves when done', shape: JOHN3, now: false, sittings: [{ at: 0, script: reading(JOHN3, 350, 5) }] },
  { name: 'reads at 350 wpm, waits for the count', shape: JOHN3, now: true, sittings: [{ at: 0, script: reading(JOHN3, 350, 60, () => atEnd(true)) }] },
  { name: 'flicks to the end, waits there 4 min', shape: JOHN3, now: false, sittings: [{ at: 0, script: s => s <= 10 ? { from: s / 10 * (W3 - SCREEN), to: s / 10 * (W3 - SCREEN) + SCREEN, touch: true } : s <= 250 ? atEnd(s % 30 === 0) : 'gone' }] },
  { name: 'Psalm 2: flicks to the end, waits there 2 min', shape: PSALM2, now: false, sittings: [{ at: 0, script: s => s === 0 ? { from: 0, to: SCREEN, touch: true } : s <= 120 ? { from: 204 - SCREEN, to: 204, touch: s % 30 === 0 } : 'gone' }] },
  { name: 'idles at the top, flicks to the end', shape: JOHN3, now: false, sittings: [{ at: 0, script: s => s <= 200 ? atTop() : s <= 205 ? { from: (s - 200) / 5 * (W3 - SCREEN), to: (s - 200) / 5 * (W3 - SCREEN) + SCREEN, touch: true } : s <= 230 ? atEnd(true) : 'gone' }] },
  { name: 'reads to the end, goes back up to re-read', shape: JOHN3, now: true, sittings: [{ at: 0, script: reading(JOHN3, 300, 90, () => ({ from: 100, to: 100 + SCREEN, touch: true })) }] },
  { name: 'listens at 1×, screen on', shape: JOHN3, now: true, sittings: [{ at: 0, script: listening(JOHN3, 1, true) }] },
  { name: 'listens at 1.25×, screen on', shape: JOHN3, now: true, sittings: [{ at: 0, script: listening(JOHN3, 1.25, true) }] },
  { name: 'listens at 1.5×, screen off', shape: JOHN3, now: true, sittings: [{ at: 0, script: listening(JOHN3, 1.5, false) }] },
  { name: 'reads half in the morning, half at night', shape: JOHN3, now: true, sittings: [
    { at: 0, script: s => s <= 120 ? { from: Math.min(400, s * 220 / 60), to: Math.min(400, s * 220 / 60) + SCREEN, touch: s % 4 === 0 } : 'gone' },
    { at: 10 * 3_600_000, script: s => s <= 120 ? { from: Math.min(W3 - SCREEN, 400 + s * 220 / 60), to: Math.min(W3, 400 + s * 220 / 60 + SCREEN), touch: s % 4 === 0 } : 'gone' }] },
  { name: 'Psalm 117 at 200 wpm, leaves when done', shape: PSALM117, now: true, sittings: [{ at: 0, script: s => s <= 12 ? { from: 0, to: 27, touch: s === 0 } : 'gone' }] },
  { name: 'slow reader on a tablet, touches every 90 s', shape: JOHN3, now: true, sittings: [{ at: 0, script: reading(JOHN3, 120, 10, undefined, 300, 90) }] },
]

describe('readers, by the old rule and the new', () => {
  const rows = PERSONAS.map(p => ({ p, r: run(p.shape, p.sittings) }))
  if (process.env.PRINT_PERSONAS) {
    const at = (o: Outcome) => (o.creditedAt === null ? 'not counted' : `counted at ${Math.round((o.creditedAt % 3_600_000) / 1000)} s`)
    console.log(rows.map(({ p, r }) => `${p.name.padEnd(46)} old: ${at(r.old).padEnd(16)} new: ${at(r.now)}`).join('\n'))
  }
  for (const { p, r } of rows) it(`${p.name}: ${p.now ? 'counts' : 'does not count'}`, () => { expect(r.now.creditedAt !== null).toBe(p.now) })
  it('the old rule let two of the gamed visits through and missed the listeners, the short psalm and the second sitting', () => {
    const old = Object.fromEntries(rows.map(({ p, r }) => [p.name, r.old.creditedAt !== null]))
    expect(old['flicks to the end, waits there 4 min']).toBe(true)
    expect(old['idles at the top, flicks to the end']).toBe(true)
    expect(old['listens at 1.5×, screen off']).toBe(false)
    expect(old['Psalm 117 at 200 wpm, leaves when done']).toBe(false)
    expect(old['reads half in the morning, half at night']).toBe(false)
  })
})
