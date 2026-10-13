/**
 * The Bible as a strip (docs/PATHS.md rule 4): the 66 books left to right, each as wide as its share of the 1,189
 * chapters, a thin gap between the testaments. Pure geometry for PathStrip.tsx: segments with x and width, how much of
 * each book is read (a fill fraction), where a chapter sits (a dot), and which route books can carry a label without
 * the labels touching. Tested in tests/pathStrip.test.ts. No React, no colours.
 */
import { BOOKS } from '@shared/books'
import { chapterKey } from '@shared/paths'

export interface StripSegment {
  book: number
  /** Left edge and width, px. */
  x: number
  width: number
  /** The book is on the path's route (tinted); every book when the strip shows the whole Bible. */
  onRoute: boolean
  /** Chapters of this book that count, read: 0..1 of `chapters` (the route's chapters in the book, else the whole book). */
  fill: number
  /** How many of its chapters count. */
  chapters: number
  read: number
}
export interface StripLayout { width: number; segments: StripSegment[] }
export interface StripLabel { book: number; text: string; /** centre, px */ x: number }

export interface StripInput {
  /** The strip's width in px (measured). */
  width: number
  /** Books on the route in path order, or null for the whole Bible. */
  route?: readonly number[] | null
  /** The path's chapters, when the fill should count only those (a path of the Gospels fills each Gospel by its own chapters). */
  routeChapters?: readonly (readonly [number, number])[] | null
  /** Chapters read, by `chapterKey`. */
  readSet?: ReadonlySet<string> | null
  /** Or: the first `doneUpTo` portions of `routeChapters` count as read (a group member's place, known only as a count). */
  doneUpTo?: number | null
  /** Gap between books, px. */
  gap?: number
  /** Extra gap between Malachi and Matthew, px. */
  testamentGap?: number
  /** No book narrower than this, so Obadiah and Jude stay visible. */
  minWidth?: number
}

export const TOTAL_CHAPTERS = BOOKS.reduce((n, b) => n + b.chapters, 0)

/**
 * Widths: each book's share of the width left after the gaps, then every book under `minWidth` is lifted to it and the
 * rest shrink together to make room; repeated until no book falls under (at most 66 rounds). Positions are laid out
 * left to right at fractional px; the last edge lands on `width` exactly.
 */
export function layoutStrip(input: StripInput): StripLayout {
  const { width, route = null, routeChapters = null, readSet = null, doneUpTo = null, gap = 1, testamentGap = 6, minWidth = 2 } = input
  const avail = Math.max(0, width - gap * (BOOKS.length - 1) - testamentGap)
  const widths = BOOKS.map(b => avail * b.chapters / TOTAL_CHAPTERS)
  if (avail >= minWidth * BOOKS.length) {
    const fixed = new Set<number>()
    for (let round = 0; round < BOOKS.length; round++) {
      let changed = false
      for (let i = 0; i < widths.length; i++) if (!fixed.has(i) && widths[i] < minWidth) { fixed.add(i); changed = true }
      if (!changed) break
      const rest = avail - minWidth * fixed.size
      const restChapters = BOOKS.reduce((n, b, i) => fixed.has(i) ? n : n + b.chapters, 0)
      for (let i = 0; i < widths.length; i++) widths[i] = fixed.has(i) ? minWidth : rest * BOOKS[i].chapters / restChapters
    }
  }
  const routeSet = route ? new Set(route) : null
  const counted = countChapters(routeChapters, readSet, doneUpTo)
  let x = 0
  const segments: StripSegment[] = BOOKS.map((b, i) => {
    if (i === 39) x += testamentGap
    const w = widths[i]
    const c = counted?.get(b.n)
    const chapters = c ? c.total : b.chapters
    // with a route given, a book off it shows nothing read (its reads are not the path's)
    const read = c ? c.read : counted ? 0 : readSet ? countRead(readSet, b.n, b.chapters) : 0
    const seg: StripSegment = { book: b.n, x, width: w, onRoute: routeSet ? routeSet.has(b.n) : true, chapters, read, fill: chapters ? read / chapters : 0 }
    x += w + gap
    return seg
  })
  return { width, segments }
}

function countRead(readSet: ReadonlySet<string>, book: number, chapters: number): number {
  let n = 0
  for (let c = 1; c <= chapters; c++) if (readSet.has(chapterKey(book, c))) n++
  return n
}
/** Per book: how many of the route's chapters it holds and how many of those are read (by set, or by the first `doneUpTo`). */
function countChapters(routeChapters: StripInput['routeChapters'], readSet: ReadonlySet<string> | null, doneUpTo: number | null): Map<number, { total: number; read: number }> | null {
  if (!routeChapters) return null
  const m = new Map<number, { total: number; read: number }>()
  routeChapters.forEach(([b, c], i) => {
    const e = m.get(b) ?? { total: 0, read: 0 }
    e.total++
    if (doneUpTo != null ? i < doneUpTo : readSet?.has(chapterKey(b, c))) e.read++
    m.set(b, e)
  })
  return m
}

/** The centre x of a chapter: its slot inside the book's segment, or null for a book the strip does not know. */
export function chapterX(layout: StripLayout, book: number, chapter: number): number | null {
  const seg = layout.segments[book - 1]
  const meta = BOOKS[book - 1]
  if (!seg || !meta) return null
  const n = Math.min(Math.max(1, chapter), meta.chapters)
  return seg.x + seg.width * (n - 0.5) / meta.chapters
}

/**
 * Labels (the books' abbreviations) under the route's books, each centred on its book: a phone's strip gives Matthew
 * 9 px, so a label may be wider than its book, and the rule is only that labels never touch. Walking left to right, a
 * label whose left edge would land within `minGap` of the last label's right edge is thinned out. `charWidth` is the
 * caption face's average advance, px.
 */
export function stripLabels(layout: StripLayout, opts: { charWidth?: number; minGap?: number; overhang?: number } = {}): StripLabel[] {
  // a label may reach `overhang` px past either end of the strip (the card's padding holds it)
  const { charWidth = 6.2, minGap = 4, overhang = 12 } = opts
  const out: StripLabel[] = []
  let rightEdge = -Infinity
  for (const seg of layout.segments) {
    if (!seg.onRoute || seg.width <= 0) continue
    const text = BOOKS[seg.book - 1].abbr
    const w = text.length * charWidth
    const x = seg.x + seg.width / 2
    if (x - w / 2 < rightEdge + minGap || x - w / 2 < -overhang || x + w / 2 > layout.width + overhang) continue
    out.push({ book: seg.book, text, x })
    rightEdge = x + w / 2
  }
  return out
}

/**
 * Dots that would sit on top of each other (two members on one chapter) are spread `spacing` apart around their common
 * centre, so each stays a dot. Returns the x of each in input order.
 */
export function spreadDots(xs: readonly number[], spacing = 6, minDistance = 4): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x)
  const out = xs.slice()
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && order[j + 1].x - order[j].x < minDistance) j++
    const n = j - i + 1
    if (n > 1) {
      const centre = order.slice(i, j + 1).reduce((s, d) => s + d.x, 0) / n
      for (let k = 0; k < n; k++) out[order[i + k].i] = centre + (k - (n - 1) / 2) * spacing
    }
    i = j + 1
  }
  return out
}
