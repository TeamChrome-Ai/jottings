import type { Verse } from '@shared/types'

// Paged mode's layout, kept free of React Native so the packing can be tested on its own.

/** A paragraph as laid out: several verses in paragraph mode, one verse otherwise. */
export interface Para { verses: Verse[]; hd?: string }
/**
 * Measured geometry of one paragraph's text: the top of every line, the text's height, and the line each verse
 * starts on. `head` is the height of the heading block above it (0 = none).
 */
export interface Metrics { head: number; tops: number[]; height: number; starts: number[] }
/** One piece of a page: the chapter title, a paragraph heading, or lines [a, b) of a paragraph's text. */
export type Slice =
  | { kind: 'title' }
  | { kind: 'head'; p: number }
  | { kind: 'lines'; p: number; a: number; b: number; y: number; h: number; gap: number }
/** `first` / `last`: the verses owning the page's first and last lines; `anchor`: the first verse that starts on it. */
export interface Page { slices: Slice[]; first: number; last: number; anchor: number }
export interface Layout { pages: Page[]; startPage: ReadonlyMap<number, number> }
/** Where to open a freshly laid-out chapter: a page, its last page, or the page a verse starts on. */
export type Landing = { page: number } | { last: true } | { verse: number }

export function splitParas(verses: Verse[], paragraphs: boolean): Para[] {
  const out: Para[] = []
  for (const v of verses) {
    if (!out.length || !paragraphs || v.p || v.hd) out.push({ verses: [v], hd: v.hd })
    else out[out.length - 1].verses.push(v)
  }
  return out
}

/** The line holding a position, given each line's start position (ascending). */
function lineAt(lineStarts: readonly number[], x: number): number {
  let k = 0
  while (k + 1 < lineStarts.length && lineStarts[k + 1] <= x) k++
  return k
}

/**
 * Native: geometry from onTextLayout's line boxes. `offsets` are the verses' first characters in the paragraph's
 * string of length `total`; line texts are matched to them by length, in proportion if a platform trims them.
 */
export function geomFromLines(lines: readonly { y: number; height: number; text: string }[], offsets: readonly number[], total: number): Omit<Metrics, 'head'> | null {
  if (!lines.length) return null
  const lineStarts: number[] = []
  let acc = 0
  for (const l of lines) { lineStarts.push(acc); acc += l.text.length }
  const f = total > 0 && acc > 0 ? acc / total : 1
  const last = lines[lines.length - 1]
  return { tops: lines.map(l => l.y), height: last.y + last.height, starts: offsets.map(o => lineAt(lineStarts, o * f)) }
}

/**
 * Web: geometry from the client rects of the verse spans. `fragTops` holds every fragment's top, `firstTops` each
 * verse's first fragment top, both relative to the text; fragments of one line agree to well under half a line.
 */
export function geomFromTops(fragTops: readonly number[], firstTops: readonly number[], height: number, lineHeight: number): Omit<Metrics, 'head'> | null {
  if (!fragTops.length) return null
  const sorted = [...fragTops].sort((a, b) => a - b)
  const base = sorted[0]
  const tops: number[] = []
  for (const t of sorted) if (!tops.length || t - base - tops[tops.length - 1] > lineHeight / 2) tops.push(t - base)
  const starts = firstTops.map(t => {
    let best = 0
    tops.forEach((top, k) => { if (Math.abs(top - (t - base)) < Math.abs(tops[best] - (t - base))) best = k })
    return best
  })
  return { tops, height, starts }
}

/** Fallback when no line boxes arrive: equal lines, verses placed in proportion to their character offsets. */
export function geomUniform(height: number, lineHeight: number, offsets: readonly number[], total: number): Omit<Metrics, 'head'> {
  const n = Math.max(1, Math.round(height / Math.max(1, lineHeight))), step = height / n
  return { tops: Array.from({ length: n }, (_, k) => k * step), height, starts: offsets.map(o => Math.min(n - 1, Math.floor((o / Math.max(1, total)) * n))) }
}

/**
 * Packs the title, headings and paragraph lines into pages of height `H`. A paragraph flows across a page break
 * at a line boundary, so no page ever overflows. A heading or a paragraph's opening never ends a page alone (it
 * takes its first two lines along), and a paragraph's last line never starts a page alone when it can take a
 * second one. `gap` is the space after a paragraph; at the foot of a page it is dropped.
 */
export function paginate(titleH: number, paras: readonly Para[], m: readonly Metrics[], H: number, gap: number): Layout {
  const pages: Page[] = []
  const startPage = new Map<number, number>()
  let cur: Slice[] = [], used = 0
  let first = 0, last = 0, anchor = 0
  const flush = () => {
    if (!cur.length) return
    pages.push({ slices: cur, first: first || anchor || 1, last: last || first || 1, anchor: anchor || first || 1 })
    cur = []; used = 0; first = 0; last = 0; anchor = 0
  }
  cur.push({ kind: 'title' })
  used = titleH
  paras.forEach((para, p) => {
    const g = m[p], n = g.tops.length
    const top = (k: number) => (k < n ? g.tops[k] : g.height)
    const owner = (line: number) => { let i = 0; while (i + 1 < g.starts.length && g.starts[i + 1] <= line) i++; return para.verses[i].v }
    if (used > 0 && used + g.head + top(Math.min(2, n)) > H) flush()
    if (g.head) { cur.push({ kind: 'head', p }); used += g.head }
    let k = 0
    while (k < n) {
      let j = k
      while (j < n && top(j + 1) - top(k) <= H - used) j++
      if (j === k) {
        if (cur.length) { flush(); continue }
        j = k + 1   // a single line taller than the page: it is clipped rather than looping
      }
      if (j === n - 1 && j - k > 2) j--
      cur.push({ kind: 'lines', p, a: k, b: j, y: top(k), h: top(j) - top(k), gap: 0 })
      used += top(j) - top(k)
      if (!first) first = owner(k)
      last = owner(j - 1)
      para.verses.forEach((v, i) => {
        if (g.starts[i] < k || g.starts[i] >= j) return
        startPage.set(v.v, pages.length)
        if (!anchor) anchor = v.v
      })
      k = j
      if (k < n) flush()
    }
    const s = cur[cur.length - 1]
    if (s && s.kind === 'lines' && s.p === p) { s.gap = gap; used += gap }
  })
  flush()
  return { pages, startPage }
}

/** The page a verse starts on; for a verse past the end, the last page that starts at or before it. */
export function pageOfVerse(l: Layout, verse: number): number {
  const p = l.startPage.get(verse)
  if (p !== undefined) return p
  let best = 0
  l.pages.forEach((pg, i) => { if (pg.first <= verse) best = i })
  return best
}

export function landingPage(l: Layout, land: Landing | null, anchor: number): number {
  let p: number
  if (land && 'last' in land) p = l.pages.length - 1
  else if (land && 'page' in land) p = land.page
  else p = pageOfVerse(l, land && 'verse' in land ? land.verse : anchor)
  return Math.max(0, Math.min(l.pages.length - 1, p))
}
