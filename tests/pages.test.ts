import { describe, it, expect } from 'vitest'
import type { Verse } from '../shared/types'
import { geomFromLines, geomFromTops, geomUniform, landingPage, pageOfVerse, paginate, splitParas, type Metrics, type Para } from '../client/src/lib/pages'

const L = 30
const verse = (v: number, extra: Partial<Verse> = {}): Verse => ({ v, t: `verse ${v}`, ...extra })
/** A paragraph of `lines` equal lines whose verses start on the given lines. */
const para = (vs: number[], lines: number, starts: number[], head = 0): [Para, Metrics] => [
  { verses: vs.map(v => verse(v)) },
  { head, tops: Array.from({ length: lines }, (_, k) => k * L), height: lines * L, starts },
]
const build = (defs: [Para, Metrics][]) => ({ paras: defs.map(d => d[0]), m: defs.map(d => d[1]) })
const heights = (l: ReturnType<typeof paginate>, titleH: number) => l.pages.map(p => p.slices.reduce((a, s) => a + (s.kind === 'title' ? titleH : s.kind === 'lines' ? s.h + s.gap : 0), 0))

describe('paginate', () => {
  it('flows a paragraph across pages at line boundaries and never overflows', () => {
    const { paras, m } = build([para([1, 2, 3], 25, [0, 8, 17])])
    const l = paginate(60, paras, m, 300, 14)
    expect(l.pages.length).toBe(3)
    for (const h of heights(l, 60)) expect(h).toBeLessThanOrEqual(300 + 14)
    const lines = l.pages.flatMap(p => p.slices.filter(s => s.kind === 'lines').map(s => s.kind === 'lines' ? [s.a, s.b] : []))
    expect(lines).toEqual([[0, 8], [8, 18], [18, 25]])
    expect(l.startPage.get(1)).toBe(0)
    expect(l.startPage.get(2)).toBe(1)
    expect(l.startPage.get(3)).toBe(1)
    expect(l.pages[2].first).toBe(3)
    expect(l.pages[2].anchor).toBe(3)
  })

  it('a verse taller than the page continues on the next page instead of scrolling', () => {
    const { paras, m } = build([para([1], 40, [0])])
    const l = paginate(0, paras, m, 300, 0)
    expect(l.pages.length).toBe(4)
    expect(l.pages.every(p => p.first === 1 && p.last === 1)).toBe(true)
    expect(pageOfVerse(l, 1)).toBe(0)
  })

  it('keeps a heading with the first two lines of its paragraph', () => {
    const { paras, m } = build([para([1], 8, [0]), para([2], 5, [0], 40)])
    const l = paginate(0, paras, m, 300, 0)
    // 240 used; heading 40 + two lines 60 does not fit in 60: heading moves to the next page
    expect(l.pages[0].slices.some(s => s.kind === 'head')).toBe(false)
    expect(l.pages[1].slices[0]).toEqual({ kind: 'head', p: 1 })
  })

  it('does not leave a paragraph\'s last line alone at the top of a page', () => {
    const { paras, m } = build([para([1], 11, [0])])
    const l = paginate(0, paras, m, 300, 0)
    const counts = l.pages.map(p => p.slices.reduce((a, s) => a + (s.kind === 'lines' ? s.b - s.a : 0), 0))
    expect(counts).toEqual([9, 2])
  })

  it('lands on a verse, the last page or a page', () => {
    const { paras, m } = build([para([1, 2, 3], 25, [0, 8, 17])])
    const l = paginate(60, paras, m, 300, 14)
    expect(landingPage(l, { verse: 3 }, 1)).toBe(1)
    expect(landingPage(l, { last: true }, 1)).toBe(2)
    expect(landingPage(l, { page: 9 }, 1)).toBe(2)
    expect(landingPage(l, null, 2)).toBe(1)
  })
})

describe('geometry', () => {
  it('maps verse offsets to lines by line text length', () => {
    const lines = [{ y: 0, height: 30, text: '1 In the ' }, { y: 30, height: 30, text: 'beginning 2 And ' }, { y: 60, height: 30, text: 'the earth ' }]
    const g = geomFromLines(lines, [0, 19], 35)!
    expect(g.tops).toEqual([0, 30, 60])
    expect(g.height).toBe(90)
    expect(g.starts).toEqual([0, 1])
  })
  it('dedupes fragment tops into lines and snaps verse starts', () => {
    const g = geomFromTops([5, 5.4, 35, 35.2, 65], [5, 35.2], 90, 30)!
    expect(g.tops).toEqual([0, 30, 60])
    expect(g.starts).toEqual([0, 1])
  })
  it('falls back to equal lines', () => {
    const g = geomUniform(90, 30, [0, 50], 100)
    expect(g.tops).toEqual([0, 30, 60])
    expect(g.starts).toEqual([0, 1])
  })
})

describe('splitParas', () => {
  it('starts a paragraph at p or a heading, or at every verse when paragraphs are off', () => {
    const vs = [verse(1, { p: 1 }), verse(2), verse(3, { hd: 'ALEPH' }), verse(4)]
    expect(splitParas(vs, true).map(p => p.verses.map(v => v.v))).toEqual([[1, 2], [3, 4]])
    expect(splitParas(vs, true)[1].hd).toBe('ALEPH')
    expect(splitParas(vs, false).length).toBe(4)
  })
})
