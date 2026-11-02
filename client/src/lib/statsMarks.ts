/**
 * Stats with the reader's marks (Progress by book and its sheet, `components/MarkReadSheet.tsx`): what a chapter's cell
 * shows, and the account's counts while marks tapped there are on their way. Pure.
 */
import { BOOKS } from '@shared/books'
import type { ReadCounts } from '@shared/paths'

/** A chapter in the sheet: not read, read (credited, or read on this device signed out), or marked read by the reader. */
export type ChapterTick = 'unread' | 'read' | 'ticked'
export const tickOf = (times: number, marked: boolean): ChapterTick => (marked ? 'ticked' : times > 0 ? 'read' : 'unread')

/** A mark (`by` 1) or its undo (-1) tapped on Stats, numbered in the order tapped. */
export interface MarkTap { n: number; book: number; chapter: number; by: 1 | -1 }
/**
 * The account's counts (`GET /stats/reads`) on Stats, and the taps they do not have yet. The server credits a mark once
 * and its undo takes that credit back (docs/READING.md), so a tap moves its chapter by one until counts asked for after
 * the server took it arrive. `upTo`: the last tap the counts have.
 */
export interface StatsReads { counts: ReadCounts | null; taps: readonly MarkTap[]; upTo: number }
export const NO_READS: StatsReads = { counts: null, taps: [], upTo: 0 }

export const withTap = (s: StatsReads, tap: MarkTap): StatsReads => ({ ...s, taps: [...s.taps, tap] })
/** Counts asked for once the server had every tap up to `upTo`; the answer to an older question changes nothing. */
export const withCounts = (s: StatsReads, counts: ReadCounts, upTo: number): StatsReads =>
  upTo < s.upTo ? s : { counts, taps: s.taps.filter(x => x.n > upTo), upTo }

/**
 * The counts to draw: the account's, with each tap they do not have yet (never below 0), and every marked chapter read
 * at least once (a mark still waiting on the device to be sent).
 */
export function shownCounts({ counts, taps }: StatsReads, marked: ReadonlyMap<string, unknown>): ReadCounts | null {
  if (!counts || (!taps.length && !marked.size)) return counts
  const out: ReadCounts = { ...counts }
  const copied = new Set<string>()
  const row = (book: number): number[] | null => {
    const n = BOOKS[book - 1]?.chapters, k = String(book)
    if (!n) return null
    if (!copied.has(k)) { copied.add(k); out[k] = Array.from({ length: n }, (_, i) => counts[k]?.[i] ?? 0) }
    return out[k]
  }
  for (const t of taps) { const r = row(t.book); if (r && t.chapter >= 1 && t.chapter <= r.length) r[t.chapter - 1] = Math.max(0, r[t.chapter - 1] + t.by) }
  for (const key of marked.keys()) {
    const [b, c] = key.split('.').map(Number)
    if ((out[String(b)]?.[c - 1] ?? 0) > 0) continue
    const r = row(b)
    if (r && c >= 1 && c <= r.length) r[c - 1] = 1
  }
  return out
}
