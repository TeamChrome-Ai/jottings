import { describe, it, expect } from 'vitest'
import { BRAND } from '../shared/brand'
import { MARK_FACE, WORDMARK, arc, assign, baselineIn, cssTransform, inOutCubic, join, keys, linear, mapKeys, outCubic, sample, schedule, trackAt, trackSpan, tween, wordOnsets } from '../client/src/lib/overture'
import { dayLine, partOfDay } from '../client/src/lib/week'

const WORDS = ['In', 'the', 'beginning', 'God', 'created', 'the', 'heavens', 'and', 'the', 'earth.']
const increasing = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1])

describe('keyframes', () => {
  it('samples an easing into linear pieces that hit both ends', () => {
    const k = tween(100, 400, 0, 1, outCubic, 6)
    expect(k.input).toHaveLength(7)
    expect(increasing(k.input)).toBe(true)
    expect(sample(k, 100)).toBe(0)
    expect(sample(k, 400)).toBe(1)
    expect(sample(k, 0)).toBe(0)          // clamped before
    expect(sample(k, 9999)).toBe(1)       // and after
    // ease-out: well past halfway at the midpoint, and never outside the range
    expect(sample(k, 250)).toBeGreaterThan(0.8)
    for (let t = 100; t <= 400; t += 7) { const v = sample(k, t); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })
  it('stays within 1% of the true curve at the jots’ 12 steps', () => {
    const k = tween(0, 1000, 0, 1, inOutCubic, 12)
    for (let t = 0; t <= 1000; t += 10) expect(Math.abs(sample(k, t) - inOutCubic(t / 1000))).toBeLessThan(0.01)
  })
  it('joins segments into one strictly increasing track, holding between them', () => {
    const k = join(tween(0, 100, 0, 1, linear, 2), tween(100, 200, 1, 1, linear, 1), tween(300, 400, 1, 0, linear, 2))
    expect(increasing(k.input)).toBe(true)
    expect(sample(k, 250)).toBe(1)
    expect(sample(k, 400)).toBe(0)
    expect(() => join(tween(0, 100, 0, 1), tween(50, 150, 1, 0))).toThrow()
  })
  it('maps values without moving the times (the note bloom about its caller)', () => {
    const bloom = keys([[0, 0.12], [380, 1.015], [560, 1]])
    const shift = mapKeys(bloom, s => 100 * (1 - s))
    expect(shift.input).toEqual(bloom.input)
    expect(sample(shift, 0)).toBeCloseTo(88)
    expect(sample(shift, 560)).toBe(0)
  })
})

describe('tracks (what the web driver writes)', () => {
  const tr = { opacity: tween(100, 300, 0, 1), y: tween(100, 400, 6, 0), scale: keys([[200, 0.5], [500, 1]]) }
  it('spans from the earliest keyframe to the latest', () => {
    expect(trackSpan(tr)).toEqual([100, 500])
    expect(trackSpan({ opacity: tween(0, 50, 0, 1) })).toEqual([0, 50])
  })
  it('starts at every channel’s first value and ends at its last', () => {
    expect(trackAt(tr, -Infinity)).toEqual({ opacity: 0, y: 6, scale: 0.5 })
    expect(trackAt(tr, 500)).toEqual({ opacity: 1, y: 0, scale: 1 })
    expect(trackAt({ opacity: tween(0, 10, 1, 0) }, 5)).not.toHaveProperty('x')
  })
  it('writes transforms in React Native’s order, rounded', () => {
    expect(cssTransform({ x: 1.23456, y: -8, scale: 0.333333 })).toBe('translateX(1.23px) translateY(-8px) scale(0.3333)')
    expect(cssTransform({ scale: 1 })).toBe('scale(1)')
    expect(cssTransform({})).toBe('')
  })
})

describe('word pacing', () => {
  it('reads like a slow voice: longer words hold longer, punctuation and weight add rests', () => {
    const t = wordOnsets(['a', 'bbbbbb', 'c,', 'd'], 1000, { base: 100, perChar: 10, punct: 50, pauseBefore: { 3: 30 } })
    expect(t).toEqual([1000, 1110, 1270, 1460])
  })
  it('counts letters, not marks', () => {
    expect(wordOnsets(['earth.', 'x'], 0, { base: 0, perChar: 10, punct: 0 })[1]).toBe(50)
  })
})

describe('jots', () => {
  it('fly along a curve from the word to the letter', () => {
    const from = { x: 50, y: 400 }, to = { x: 200, y: 300 }
    const p = arc(from, to, 40, 0, 1000)
    expect(sample(p.x, 0)).toBe(0)
    expect(sample(p.y, 0)).toBe(0)
    expect(sample(p.x, 1000)).toBeCloseTo(150)
    expect(sample(p.y, 1000)).toBeCloseTo(-100)
    // bowed: at the middle it is above the straight line between the ends
    expect(sample(p.y, 500)).toBeLessThan(-50)
    expect(Math.min(...p.y.output)).toBeGreaterThan(-140)   // but never above the control point
  })
  it('take the assignment with the least travel, leaving the spare source out', () => {
    const sources = [{ x: 300, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 100, y: 0 }]
    const targets = [{ x: 0, y: 10 }, { x: 100, y: 10 }, { x: 300, y: 10 }]
    expect(assign(sources, targets)).toEqual([1, 3, 0])
    expect(() => assign(sources.slice(0, 2), targets)).toThrow()
  })
  it('never cross on a single line', () => {
    const sources = [5, 90, 40, 160, 120, 70, 20].map(x => ({ x, y: 0 }))
    const targets = [0, 30, 60, 90, 120, 150].map(x => ({ x, y: -50 }))
    const got = assign(sources, targets).map(i => sources[i].x)
    expect(got).toEqual([...got].sort((a, b) => a - b))
  })
})

describe('wordmark', () => {
  // a brand without a wordmark (shared/brand.json) has no letters to set: the name is plain text
  const W = WORDMARK
  it.skipIf(!W)('sets the name letter by letter, the dotted letter without its dot, left to right, inside its width', () => {
    if (!W) return
    const dotted = W.letters.map((ch, i) => (W.dot && i === W.dot.letter ? W.dot.glyph : ch)).join('')
    expect(dotted).toBe(BRAND.name)
    expect(W.x).toHaveLength(W.letters.length)
    expect(W.advance).toHaveLength(W.letters.length)
    expect(increasing(W.x)).toBe(true)
    const last = W.letters.length - 1
    expect(W.x[last] + W.advance[last]).toBeCloseTo(W.width, 3)
    // each letter starts one advance (plus a small kern) after the one before
    for (let i = 1; i <= last; i++) {
      const kern = W.x[i] - (W.x[i - 1] + W.advance[i - 1])
      expect(Math.abs(kern)).toBeLessThan(0.04)
    }
    if (W.seasonal !== undefined) expect(W.letters[W.seasonal]).toBeDefined()
  })
  it.skipIf(!W?.dot)('puts the tittle above the stem, inside the letter', () => {
    const d = W?.dot
    if (!W || !d) return
    expect(W.letters[d.letter]).not.toBe(d.glyph)
    expect(d.x).toBeGreaterThan(0)
    expect(d.x).toBeLessThan(W.advance[d.letter])
    expect(d.y - d.size / 2).toBeGreaterThan(W.stemTop)
  })
  it('finds the baseline of a centred line box', () => {
    const size = 56, line = Math.ceil((MARK_FACE.ascent + MARK_FACE.descent) * size) + 2
    const b = baselineIn(size, line)
    expect(b).toBeGreaterThan(MARK_FACE.ascent * size)
    expect(line - b).toBeGreaterThan(MARK_FACE.descent * size)
  })
})

describe('schedule', () => {
  const s = schedule(WORDS, 3)
  it('lasts under twelve seconds, hand-off included', () => {
    expect(s.total).toBeLessThan(12_000)
    expect(s.total).toBe(s.page.end + s.condense.end + s.gather.end + s.handoff.end)
  })
  it('settles every word before the note, and lets the note be read before the page folds', () => {
    const lastIn = s.page.onsets[s.page.onsets.length - 1] + s.page.wordIn
    expect(increasing(s.page.onsets)).toBe(true)
    expect(s.page.onsets[0]).toBeGreaterThan(s.page.numeral[0])
    expect(s.page.caller).toBeGreaterThan(lastIn)
    expect(s.page.end - (s.page.noteText + 500)).toBeGreaterThanOrEqual(1000)
  })
  it('brings the form in only once the name has mostly lifted past it', () => {
    const h = s.handoff
    expect(h.form).toBeGreaterThanOrEqual(h.lift[0] + 0.8 * (h.lift[1] - h.lift[0]))
    expect(h.form + 2 * h.formStep + h.formIn).toBeLessThanOrEqual(h.end)
  })
  it('gives "God" a rest before it', () => {
    const gap = (i: number) => s.page.onsets[i] - s.page.onsets[i - 1]
    expect(gap(3)).toBeGreaterThan(gap(2))
  })
  it('lands every letter, then the tittle, inside the gather clock', () => {
    const g = s.gather
    const lastLetter = 7 * g.step + g.fly
    expect(lastLetter).toBeLessThan(g.tittle + g.tittleFly)
    expect(g.tittle + g.tittleFly + 320).toBeLessThanOrEqual(g.end)
    expect(s.condense.step * WORDS.length + s.condense.fold).toBeLessThanOrEqual(s.condense.end)
  })
})

describe('Home date line', () => {
  it('names the part of the day', () => {
    expect(partOfDay(new Date(2026, 8, 24, 4, 59))).toBe('night')
    expect(partOfDay(new Date(2026, 8, 24, 5))).toBe('morning')
    expect(partOfDay(new Date(2026, 8, 24, 12))).toBe('afternoon')
    expect(partOfDay(new Date(2026, 8, 24, 17))).toBe('evening')
    expect(partOfDay(new Date(2026, 8, 24, 22))).toBe('night')
  })
  it('greets by name only when there is one', () => {
    const thu = new Date(2026, 8, 24, 19)
    expect(dayLine(thu, '', 'en-GB')).toBe('Thursday')
    expect(dayLine(thu, '  Anna ', 'en-GB')).toBe('Thursday evening, Anna')
    expect(dayLine(new Date(2026, 8, 27, 9), 'Anna', 'en-GB')).toBe('Lord’s day morning, Anna')
  })
})
