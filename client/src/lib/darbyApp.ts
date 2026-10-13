/**
 * The old app readers are coming from: "Darby Bible" by Bible apps for spirit (Google Play
 * wiktoria.goroch.darby_bible…, read at version 5.1.0). Its backup (Settings → Backup (Import/Export) → EXPORT, a
 * `.setting` file) names a verse by the id of its row in the app's own text table, and a highlight by a number.
 * Both are set down here from that table and the app's code, so tests/darbyApp.test.ts can hold them. Pure.
 *
 * The table: ids 1 to 31,253 in Bible order, one row a verse. In the Psalms a row for the title stands before each
 * psalm, and a second before Psalms 1, 42, 73, 90 and 107, which open the five books of the Psalms. Three verses the
 * translation leaves out have no row (their numbers are skipped), and two chapters end a verse sooner than ours.
 */
import { VERSE_COUNTS } from '@shared/verseCounts'

export const DARBY_APP_ROWS = 31_253
const PSALMS = 19
const BOOK_OPENERS: ReadonlySet<number> = new Set([1, 42, 73, 90, 107])
/** `book.chapter` -> the verse number with no row: Matthew 23:14, Acts 8:37, Acts 15:34. */
const NO_ROW: Readonly<Record<string, number>> = { '40.23': 14, '44.8': 37, '44.15': 34 }
/** `book.chapter` -> its last verse there: Romans 11 has no verse 36 and Revelation 12 no verse 18. */
const LAST: Readonly<Record<string, number>> = { '45.11': 35, '66.12': 17 }

interface Chapter { first: number; rows: number; book: number; chapter: number; titles: number; skip: number }
let chapters: Chapter[] | null = null
function table(): Chapter[] {
  if (chapters) return chapters
  const out: Chapter[] = []
  let first = 1
  VERSE_COUNTS.forEach((counts, b) => counts.forEach((n, c) => {
    const book = b + 1, chapter = c + 1, key = `${book}.${chapter}`
    const titles = book === PSALMS ? (BOOK_OPENERS.has(chapter) ? 2 : 1) : 0
    const skip = NO_ROW[key] ?? 0
    const rows = titles + (LAST[key] ?? n) - (skip ? 1 : 0)
    out.push({ first, rows, book, chapter, titles, skip })
    first += rows
  }))
  return (chapters = out)
}

/** A row's place; `verse` null for a psalm's title row. null for an id the table does not have. */
export function darbyAppPlace(id: number): { book: number; chapter: number; verse: number | null } | null {
  if (!Number.isInteger(id) || id < 1 || id > DARBY_APP_ROWS) return null
  const t = table()
  let lo = 0, hi = t.length - 1
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t[mid].first <= id) lo = mid; else hi = mid - 1 }
  const ch = t[lo], at = id - ch.first
  if (at >= ch.rows) return null
  if (at < ch.titles) return { book: ch.book, chapter: ch.chapter, verse: null }
  const n = at - ch.titles + 1
  return { book: ch.book, chapter: ch.chapter, verse: ch.skip && n >= ch.skip ? n + 1 : n }
}

/**
 * Its highlight numbers, by the colours it shows them in (highlight_color1..4): light blue, yellow, pink, green.
 * 5 underlines the verse without a colour; here that is a yellow highlight, as is a number the app never wrote.
 */
export const DARBY_APP_COLORS: Readonly<Record<string, 'yellow' | 'green' | 'blue' | 'pink'>> = { '1': 'blue', '2': 'yellow', '3': 'pink', '4': 'green', '5': 'yellow' }
