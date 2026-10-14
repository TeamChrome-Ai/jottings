import { wordCount } from '@shared/reading'
import type { Shape } from '@shared/readThrough'
import type { ChapterMarks } from './tts'

/** A paragraph as laid out (components/ChapterView.tsx `ParaLayout`), in the scroll's coordinates. */
interface Para { index: number; y: number; height: number; firstVerse: number; lastVerse: number }
/** Where each verse starts inside its paragraph, where measured: (paragraph index, y). */
type Marks = ReadonlyMap<number, { index: number; y: number }>

/**
 * The verses any part of which lies between `top` and `bottom` (scroll offsets), as [first, last]; null when none
 * does. A verse runs from its own start to the next one's (or its paragraph's end); a verse whose start is not yet
 * measured is placed by its share of the paragraph, as `verseY` places it.
 */
export function versesBetween(paras: Iterable<Para>, marks: Marks, top: number, bottom: number): [number, number] | null {
  let first = Infinity, last = -Infinity
  for (const p of paras) {
    if (p.y + p.height <= top || p.y >= bottom) continue
    const n = p.lastVerse - p.firstVerse + 1
    const start = (v: number) => {
      if (v === p.firstVerse) return p.y
      const m = marks.get(v)
      return m && m.index === p.index ? p.y + m.y : p.y + ((v - p.firstVerse) / n) * p.height
    }
    for (let v = p.firstVerse; v <= p.lastVerse; v++) {
      const end = v < p.lastVerse ? start(v + 1) : p.y + p.height
      if (start(v) < bottom && end > top) { first = Math.min(first, v); last = Math.max(last, v) }
    }
  }
  return first <= last ? [first, last] : null
}

/** A chapter's shape for the read-through rule, from its verses and, while the voice reads it, the recording playing. */
export function chapterShape(verses: readonly { v: number; t: string }[], marks: ChapterMarks | null): Shape {
  const spans = new Map<number, number>()
  for (const m of marks?.verses ?? []) if (m.end > m.start) spans.set(m.v, m.end - m.start)
  return { verses: verses.map(v => v.v), words: verses.map(v => wordCount(v.t)), audioMs: marks ? verses.map(v => spans.get(v.v) ?? null) : undefined }
}
