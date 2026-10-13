/**
 * Paths: reading plans as the app does them (docs/PATHS.md). A path is an order of chapters and a pace, never a
 * calendar; a portion is complete when its chapter is credited after the path's start. Pure functions, no text: the
 * built-in orders come from the book table, from `shared/pathOrders.json` (the life of Christ by Darby's synoptic
 * harmony and the chronological order, written by tools/path_orders.ts and compiled into the server as well) and, for
 * the two companion paths, from the companion index the caller has loaded (`sectionsFor`). Chapter lists are built once
 * per path on first use and kept (1,189 pairs at most).
 */
import { BOOKS } from './books.js'
import { sectionsFor, type AuthorId, type CompanionIndex } from './companion.js'
import orders from './pathOrders.json'

export type PathId = 'gospels' | 'life-of-christ' | 'psalms-proverbs' | 'new-testament' | 'bible' | 'in-order' | 'synopsis' | 'coates'
export const PATH_IDS: readonly PathId[] = ['gospels', 'life-of-christ', 'psalms-proverbs', 'new-testament', 'bible', 'in-order', 'synopsis', 'coates']
export const isPathId = (s: string): s is PathId => (PATH_IDS as readonly string[]).includes(s)

/** A companion section to read after the chapter: the API's `/companion/{author}/{work}/{n}`. */
export interface Then { author: AuthorId; work: string; n: number }
/** One step of a path: a chapter, then (the companion paths) the sections on it. Scripture first; `then` is a courtesy, never required. */
export interface Portion { book: number; chapter: number; then?: Then[] }
/** A reader's own path: whole books, in the chosen order. */
export interface CustomPath { title: string; books: number[] }
/** What identifies a path's order: a built-in id, or `custom` with its books. `PathState` satisfies it. */
export type PathLike = PathId | { id: PathId | 'custom'; custom?: CustomPath | null; with_ministry?: boolean | null }

/**
 * The active path, as the server and AsyncStorage keep it. `started_at` is an ISO instant; a chapter counts when credited
 * at or after it. `target_date` (YYYY-MM-DD, the reader's own day) or `pace_per_week` or neither: with a target the app is
 * exact (`paceFor`, `standing`); a pace only says how many a week the reader means to read. `with_ministry` pairs the
 * `synopsis` / `coates` chapters with their sections (`then`); off, those paths are the Scripture order alone. The
 * ministry part never counts toward completion either way.
 */
export interface PathState { id: PathId | 'custom'; started_at: string; target_date: string | null; pace_per_week: number | null; with_ministry: boolean; custom?: CustomPath | null }
/** A path left for another: coming back to it resumes from its own start. */
export interface PathHistoryEntry { id: PathId | 'custom'; started_at: string; ended_at: string; custom?: CustomPath | null }
/** What `GET /api/me/path` answers: the state (null: no path), the paths left behind, and the chapters credited since the start. */
export interface PathAccount { path: PathState | null; history: PathHistoryEntry[]; read: [book: number, chapter: number][] }
/** A group's path on `GET /api/groups/:slug`: each member's progress from their own chapters read after the group's start. */
export interface GroupPath { id: PathId; started_at: string; target_date: string | null; members: { user_id: number; done: number; position: number }[] }

export interface Progress {
  /** Portions whose chapter is read. */
  done: number
  total: number
  /** The 1-based place of the next portion ("Mark 4, the 12th of 89"); `total` once every portion is read. */
  position: number
}

/** The books Coates outlined (kind `outline` in data/coates/index.json): the route of the `coates` path. tests/paths.test.ts holds it to the index. */
export const COATES_BOOKS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19, 22, 28, 31, 32, 33, 34, 35, 36, 37, 38, 40, 41, 42, 43, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 62, 66]

type Ch = [book: number, chapter: number]
/** tools/path_orders.ts writes the file as pairs; the JSON type is number[][]. */
const ORDERS = orders as unknown as Record<'life-of-christ' | 'in-order', Ch[]>
const bookChapters = (books: readonly number[]): Ch[] => books.flatMap(b => Array.from({ length: BOOKS[b - 1]?.chapters ?? 0 }, (_, i): Ch => [b, i + 1]))
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

interface Def { title: string; blurb: string; chapters: () => Ch[] }
const DEFS: Record<PathId, Def> = {
  'gospels': { title: 'The Gospels', blurb: 'Matthew, Mark, Luke and John, a chapter at a time.', chapters: () => bookChapters(range(40, 43)) },
  'life-of-christ': { title: 'The life of Christ', blurb: 'The four Gospels in the order of events, as Darby’s harmony sets them.', chapters: () => ORDERS['life-of-christ'] },
  'psalms-proverbs': { title: 'Psalms and Proverbs', blurb: 'The hundred and fifty psalms, then the thirty-one chapters of Proverbs.', chapters: () => bookChapters([19, 20]) },
  'new-testament': { title: 'The New Testament', blurb: 'Matthew to Revelation.', chapters: () => bookChapters(range(40, 66)) },
  'bible': { title: 'The whole Bible', blurb: 'Genesis to Revelation, every chapter in its place.', chapters: () => bookChapters(range(1, 66)) },
  'in-order': { title: 'In the order it happened', blurb: 'The Bible in the order of its events: Job beside the patriarchs, the prophets among the kings, the letters as Acts unfolds.', chapters: () => ORDERS['in-order'] },
  'synopsis': { title: 'With Darby’s Synopsis', blurb: 'Genesis to Revelation, each chapter followed by the Synopsis on it.', chapters: () => bookChapters(range(1, 66)) },
  'coates': { title: 'With Coates’s Outlines', blurb: 'The books Coates outlined, each chapter followed by his reading on it.', chapters: () => bookChapters(COATES_BOOKS) },
}
/** Which companion the path pairs each chapter with. */
const COMPANION: Partial<Record<PathId, AuthorId>> = { synopsis: 'darby', coates: 'coates' }
export const pathCompanion = (p: PathLike): AuthorId | undefined => typeof p === 'string' ? COMPANION[p] : p.id === 'custom' ? undefined : COMPANION[p.id]
/** What `with_ministry` starts as: on for the two paired paths, off (and meaningless) for the rest. */
export const defaultWithMinistry = (id: PathId | 'custom'): boolean => id !== 'custom' && COMPANION[id] !== undefined
/** Whether this path pairs chapters with sections: its own switch, else the default for its id. */
export const withMinistry = (p: PathLike): boolean => typeof p === 'string' ? defaultWithMinistry(p) : (p.with_ministry ?? defaultWithMinistry(p.id))

const built = new Map<PathId, Ch[]>()
const customKey = (c: CustomPath) => c.books.join(',')
let customCache: { key: string; chapters: Ch[] } | null = null
/** The chapters of a path, in order. A custom path with a book named twice reads it twice. */
export function pathChapters(p: PathLike): Ch[] {
  const id = typeof p === 'string' ? p : p.id
  if (id === 'custom') {
    const c = (typeof p === 'string' ? null : p.custom) ?? { title: '', books: [] }
    if (customCache?.key !== customKey(c)) customCache = { key: customKey(c), chapters: bookChapters(c.books.filter(b => b >= 1 && b <= 66)) }
    return customCache.chapters
  }
  let v = built.get(id)
  if (!v) { v = DEFS[id].chapters(); built.set(id, v) }
  return v
}
export const pathLength = (p: PathLike): number => pathChapters(p).length
/** The distinct books on the route, in the order the path reaches them (the strip's tint). */
export const pathBooks = (p: PathLike): number[] => [...new Set(pathChapters(p).map(([b]) => b))]

export function pathTitle(p: PathLike): string {
  if (typeof p === 'string') return DEFS[p].title
  return p.id === 'custom' ? (p.custom?.title.trim() || 'Your path') : DEFS[p.id].title
}
export function pathBlurb(p: PathLike): string {
  if (typeof p === 'string') return DEFS[p].blurb
  if (p.id !== 'custom') return DEFS[p.id].blurb
  const books = (p.custom?.books ?? []).map(b => BOOKS[b - 1]?.name).filter(Boolean)
  return books.length === 0 ? 'No books chosen yet.' : books.length <= 3 ? books.join(', ') : `${books.slice(0, 2).join(', ')} and ${books.length - 2} more books`
}

/** The companion's outline sections on a chapter (walks through the book only; addresses are not part of a path). */
export function thenFor(index: CompanionIndex, book: number, chapter: number): Then[] {
  return sectionsFor(index, book, chapter).filter(pl => pl.work.kind !== 'addresses').map(pl => ({ author: pl.author, work: pl.work.id, n: pl.n }))
}
/**
 * The i-th portion (0-based), or undefined past the end. For `synopsis` and `coates` with the pairing on, the companion
 * index (loaded at runtime, `loadCompanionIndex`) fills `then`; without it, with the pairing off, or for a chapter no
 * section treats, the chapter stands alone.
 */
export function portionAt(p: PathLike, i: number, indexes?: Partial<Record<AuthorId, CompanionIndex | null>>): Portion | undefined {
  const ch = pathChapters(p)[i]
  if (!ch) return undefined
  const [book, chapter] = ch
  const author = withMinistry(p) ? pathCompanion(p) : undefined
  const index = author ? indexes?.[author] : undefined
  if (!index) return { book, chapter }
  const then = thenFor(index, book, chapter)
  return then.length ? { book, chapter, then } : { book, chapter }
}

export const chapterKey = (book: number, chapter: number) => `${book}.${chapter}`
/** The read set a path judges by: chapters credited at or after `since` (ISO instants compare as strings). */
export function readSetSince(reads: Iterable<[book: number, chapter: number, at: string]>, since: string): Set<string> {
  const s = new Set<string>()
  for (const [b, c, at] of reads) if (at >= since) s.add(chapterKey(b, c))
  return s
}
/**
 * A read set as `GET /stats/progress` gives an account's reads: book number → its chapters read, ascending. Keys that
 * name no chapter of the Bible are left out, so every count made from this is a count of real chapters.
 */
export function readProgress(readSet: ReadonlySet<string>): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const b of BOOKS) {
    const chs: number[] = []
    for (let c = 1; c <= b.chapters; c++) if (readSet.has(chapterKey(b.n, c))) chs.push(c)
    if (chs.length) out[String(b.n)] = chs
  }
  return out
}
/** What a read set amounts to: its chapters, and the books whose every chapter is in it. */
export function readTotals(readSet: ReadonlySet<string>): { chapters: number; books: number } {
  const p = readProgress(readSet)
  let chapters = 0, books = 0
  for (const b of BOOKS) { const n = p[String(b.n)]?.length ?? 0; chapters += n; if (n === b.chapters) books++ }
  return { chapters, books }
}
/** A read set from the server's `read` list (already filtered to the path's start). */
export const readSetOf = (read: Iterable<[number, number]>): Set<string> => new Set(Array.from(read, ([b, c]) => chapterKey(b, c)))

/** The first unread portion and its 0-based index; null once every portion is read (or the path is empty). */
export function nextPortion(p: PathLike, readSet: ReadonlySet<string>, indexes?: Partial<Record<AuthorId, CompanionIndex | null>>): { index: number; portion: Portion } | null {
  const chs = pathChapters(p)
  for (let i = 0; i < chs.length; i++) if (!readSet.has(chapterKey(chs[i][0], chs[i][1]))) return { index: i, portion: portionAt(p, i, indexes)! }
  return null
}
export function progress(p: PathLike, readSet: ReadonlySet<string>): Progress {
  const chs = pathChapters(p)
  let done = 0, first = -1
  chs.forEach(([b, c], i) => { if (readSet.has(chapterKey(b, c))) done++; else if (first < 0) first = i })
  return { done, total: chs.length, position: first < 0 ? chs.length : first + 1 }
}
/** True while `book` `chapter` is on the path (the reader's pill dot). */
export const onPath = (p: PathLike, book: number, chapter: number): boolean => pathChapters(p).some(([b, c]) => b === book && c === chapter)
/** The portion whose chapter is `book` `chapter` (its `then` filled as `portionAt` does), or null off the path. A chapter a custom path names twice is its first. */
export function portionOf(p: PathLike, book: number, chapter: number, indexes?: Partial<Record<AuthorId, CompanionIndex | null>>): Portion | null {
  const i = pathChapters(p).findIndex(([b, c]) => b === book && c === chapter)
  return i < 0 ? null : portionAt(p, i, indexes) ?? null
}
/**
 * Where the reader's "next" goes from `book` `chapter` while the path is on (docs/PATHS.md rule 3): the first unread
 * portion AFTER this one in the path's order, whether or not this one has been credited yet. A page turn only goes
 * forward: a portion skipped earlier is Home's business (`nextPortion`), not the pull's. Null when the chapter is not on
 * the path and null past the last unread portion (the canonical next applies, without path wording).
 */
export function nextOnPath(p: PathLike, readSet: ReadonlySet<string>, book: number, chapter: number, indexes?: Partial<Record<AuthorId, CompanionIndex | null>>): Portion | null {
  const chs = pathChapters(p)
  const at = chs.findIndex(([b, c]) => b === book && c === chapter)
  if (at < 0) return null
  for (let i = at + 1; i < chs.length; i++) if (!readSet.has(chapterKey(chs[i][0], chs[i][1]))) return portionAt(p, i, indexes) ?? null
  return null
}

const DAY_MS = 86_400_000
/** Days from one YYYY-MM-DD (or ISO instant, its date part) to another, whole, as the calendar counts them. */
const daysBetween = (from: string, to: string) => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / DAY_MS)
/** The reader's day as YYYY-MM-DD, from a Date in their zone. */
export const dayOf = (d: Date = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Chapters a day needed from `today` to finish by `target_date` (both YYYY-MM-DD), exact and rounded up: what is left
 * over the days left, today and the target day both counted. Null without a target or with nothing left; a target
 * already past or today asks for everything left today.
 */
export function paceFor(pr: Progress, target_date: string | null | undefined, today: string = dayOf()): number | null {
  const left = pr.total - pr.done
  if (!target_date || left <= 0) return null
  const days = Math.max(1, daysBetween(today, target_date) + 1)
  return Math.ceil(left / days)
}
export interface Standing {
  /** Portions that should be done by the end of `today` at an even pace from the start to the target; null without a target. */
  expected: number | null
  done: number
  /** done − expected: positive ahead, negative behind, 0 on track; null without a target. */
  delta: number | null
}
/**
 * Where the reader stands against their target: the whole path spread evenly over the days from the start day to the
 * target day inclusive, `expected` the share due by the end of `today` (rounded to the nearest portion, capped at the
 * total; the total once the target is past). Honest and exact (docs/PATHS.md rule 2): the UI says "on track",
 * "2 chapters ahead" or "5 chapters behind" from `delta`, never a day count.
 */
export function standing(pr: Progress, started_at: string, target_date: string | null | undefined, today: string = dayOf()): Standing {
  if (!target_date) return { expected: null, done: pr.done, delta: null }
  // the start is a timestamp (UTC); the path's first day is the READER's day it fell on, or an evening start west of
  // Greenwich counted from "tomorrow" and read a day ahead until midnight
  const start = started_at.length > 10 ? dayOf(new Date(started_at)) : started_at
  const span = Math.max(1, daysBetween(start, target_date) + 1)
  const gone = Math.min(span, Math.max(0, daysBetween(start, today) + 1))
  const expected = Math.min(pr.total, Math.round(pr.total * gone / span))
  return { expected, done: pr.done, delta: pr.done - expected }
}
