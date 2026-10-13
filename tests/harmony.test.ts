import { describe, it, expect, vi, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { compactRef, harmonyOf, isEntry, type HarmonyRow, type ParallelsFigure } from '../shared/figures'
import type { MinistrySection } from '../shared/ministry'
import { HAS_TEXTS } from './_texts'

vi.mock('../client/node_modules/react-native', () => ({ Platform: { OS: 'web', select: (o: Record<string, unknown>) => o.web } }))
const { THEMES, band, contrast } = await import('../client/src/theme')

const ROOT = path.resolve(__dirname, '..')
let fig: ParallelsFigure, h: ReturnType<typeof harmonyOf>
// read when the tests start, not as the file loads: where the texts are absent nothing is opened (tests/_texts.ts)
beforeAll(() => {
  if (!HAS_TEXTS) return
  const sections = (JSON.parse(readFileSync(path.join(ROOT, 'data/ministry/darby/cw-expository-4.json'), 'utf8')) as { sections: MinistrySection[] }).sections
  fig = sections.find(s => s.title === 'Relative order of three synoptical Gospels')!.figures![0] as ParallelsFigure
  h = harmonyOf(fig)
})
/** A row as numbers per column: [[29], [94], [167]]. */
const ns = (r: HarmonyRow) => r.cells.map(c => c.map(e => e.n))
const rowOf = (n: number) => h.rows.filter(r => r.cells.some(c => c.some(e => e.n === n)))

describe('the synoptic harmony read in parallel', () => {
  it.skipIf(!HAS_TEXTS)('sets the feeding of the five thousand as one triple row', () => {
    const [r] = rowOf(94)
    expect(rowOf(94).length).toBe(1)
    expect(ns(r)).toEqual([[29], [94], [167]])
    expect(r.share).toBe(3)
    expect(r.subject).toBe('(On twelve’s return) goes into desert—feeds 5,000.')   // Mark's words
    expect(r.cells.map(c => compactRef(c[0].passage!))).toEqual(['14:13–21', '6:30–44', '9:10–17'])
  })

  it.skipIf(!HAS_TEXTS)('sets a parable only Luke tells as a row alone', () => {
    const prodigal = rowOf(200)                                   // Luke 15: lost sheep, silver, prodigal son
    expect(prodigal.map(ns)).toEqual([[[], [], [200]]])
    expect(prodigal[0].share).toBe(1)
    expect(rowOf(176).map(ns)).toEqual([[[], [], [176]]])         // the good Samaritan
  })

  it.skipIf(!HAS_TEXTS)('counts 129 rows: 39 triple, 25 double, 65 single, every passage in one at least', () => {
    expect(h.rows.length).toBe(129)
    expect([3, 2, 1].map(s => h.rows.filter(r => r.share === s).length)).toEqual([39, 25, 65])
    const all = new Set(h.rows.flatMap(r => r.cells.flat().map(e => e.n)))
    expect(all.size).toBe(238)
    expect(fig.items.filter(isEntry).every(e => all.has(e.n))).toBe(true)
  })

  it.skipIf(!HAS_TEXTS)('lets a cell hold two passages and a passage stand in two rows where the figures say so', () => {
    expect(h.ambiguous.length).toBe(20)
    // Matthew 13 against Mark 4:1–34 and 6:1–16, Luke 8:4–21 and 13:18–22
    expect(rowOf(91).map(ns)).toEqual([[[27], [88, 91], [163, 192]]])
    // Mark 3:21–35 by its runs: the blasphemy, then His brethren
    expect(rowOf(87).map(ns)).toEqual([[[24], [87], [179]], [[26], [87], [163]]])
    expect(rowOf(87).map(r => r.subject)).toEqual([
      'People come together, friends treat him as beside himself. Full blasphemy of Pharisees against Holy Spirit—no forgiveness—',
      'Owns disciples not natural ties.',
    ])
    // the storm and Legion: Matthew's two passages, Luke's storm and the foxes (Matthew 8:19–22)
    expect(rowOf(89).map(ns)).toEqual([[[14, 15], [89], [164, 173]]])
  })

  it.skipIf(!HAS_TEXTS)('takes a one-way figure only in sequence, and keeps the rest as a comparison', () => {
    expect(h.joined).toEqual([
      { from: 15, to: [89, 164] }, { from: 59, to: [221] }, { from: 96, to: [31] }, { from: 113, to: [48] },
      { from: 173, to: [14] }, { from: 206, to: [40, 106] }, { from: 209, to: [42, 108] },
    ])
    expect(h.kept.length).toBe(19)
    // Matthew's birth of Jesus names Luke 2:1–20, whose figure is 0: two rows, each comparing the other
    expect(h.kept[0]).toEqual({ from: 2, to: [140], why: 'not returned' })
    expect(rowOf(2)[0].compare.map(e => e.n)).toEqual([140])
    // a figure within one Gospel never joins (Luke 12:8–12 to 21:5–38)
    expect(ns(rowOf(184)[0])).toEqual([[], [], [184]])
    expect(rowOf(184)[0].compare.map(e => e.n)).toEqual([21, 87, 220])
  })

  it.skipIf(!HAS_TEXTS)('follows Mark, the rest where their own Gospel sets them', () => {
    // Mark never goes back (a row by its first Mark passage: Matthew 13's row holds Mark 4:1–34 and 6:1–16)
    const marks = h.rows.filter(r => r.cells[1].length).map(r => r.cells[1][0].n)
    expect(marks.filter((n, i) => i && n < marks[i - 1])).toEqual([])
    // Luke's journey to Jerusalem stays one run between Mark 9:33–50 and 10:1–16
    const at = (n: number) => h.rows.findIndex(r => r.cells.some(c => c.some(e => e.n === n)))
    const journey = [172, 174, 175, 176, 177, 178, 180, 181, 182, 183, 190, 191, 193, 194, 197, 199, 205].map(at)
    expect(journey).toEqual([...journey].sort((a, b) => a - b))
    expect(Math.min(...journey)).toBeGreaterThan(at(105))
    expect(Math.max(...journey)).toBeLessThan(at(106))
    // the infancy: Matthew's, then Luke's, before John the Baptist
    expect([1, 2, 3, 4, 138, 139, 140, 141, 142].map(at)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(ns(h.rows[9])).toEqual([[5], [74], [143]])
    // the page's notes before the passage printed after them
    expect(h.rows.flatMap(r => r.notes.map(n => [n, ns(r)]))).toEqual([
      ['All this is either only in Luke or items from various parts of the history put morally together.', [[], [], [183]]],
      ['Only in Luke', [[], [], [194]]],
      ['Here history resumed. Last scene begins.', [[45], [110], [210]]],
      ['(See John’s Gospel.)', [[], [133], []]],
    ])
  })

  it('shades the shared cells so the accent reads on them in every theme, Black too', () => {
    for (const t of THEMES) {
      expect(contrast(t.accent, band(t)), t.id).toBeGreaterThanOrEqual(4.5)
      expect(contrast(band(t), t.bg), t.id).toBeGreaterThanOrEqual(1.05)
    }
  })
})
