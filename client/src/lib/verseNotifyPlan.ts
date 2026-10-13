import { BOOKS } from '@shared/books'
import { formatRef } from '@shared/ref'
import { presentVotd } from '@shared/votd'
import { pathTitle, type PathState, type Portion } from '@shared/paths'
import { verseCard } from '../widgets/model'

/**
 * The verse notifications as pure decisions: which mornings to schedule from a given "now", what each one says, which
 * verse of a chosen book a day gets, and when a device left alone needs its queue topped up. `verseNotify.ts` applies
 * them; the tests read them. A reader keeps a list of items, each a book (or any book: the day's verse of the day,
 * as Home and the widget show it) at a time of morning.
 */

/** Mornings scheduled ahead at each refresh, and the point below which the background task tops the queue up. */
export const VERSE_NOTIFY_DAYS = 14
export const VERSE_NOTIFY_MIN_DAYS = 7
/** iOS keeps at most 64 pending notifications per app: 14 mornings × 4 items = 56 leaves room for the streak reminder. */
export const VERSE_NOTIFY_MAX_ITEMS = 4
/** This feature's scheduled notifications, so a refresh cancels only its own. */
export const VERSE_NOTIFY_PREFIX = 'votd-'
/** Where a tap lands: the chapter route (`/read/<book>/<chapter>?v=<verse>`); the widget opens the same. */
export const VERSE_ROUTE_PREFIX = '/read/'
/** What a notification body shows before the system cuts it: iOS about four lines, Android's expanded view a little more. */
export const VERSE_BODY_MAX = 240
export const VERSE_NOTIFY_PRESETS = ['06:00', '07:00', '08:00'] as const
/** Book 0: the verse of the day from anywhere in the Bible. */
export const ANY_BOOK = 0
export const ANY_BOOK_LABEL = 'Any book'
/** Book -1: the reader's path (docs/PATHS.md): the morning's notice is its next portion. Stored as the book value, so
 *  older builds reading the pref see an unknown book and fall back to Any book rather than fail. */
export const PATH_BOOK = -1
export const PATH_LABEL = 'Your path'
export const NO_PATH_LABEL = 'Your path · no path started'
/** A verse shorter than this is a fragment ("And he died."); one longer would be cut in the notification. */
export const VERSE_MIN_CHARS = 40
export const VERSE_MAX_CHARS = 280

type ChapterText = { verses: { v: number; t: string }[] }
export type ChapterReader = (book: number, chapter: number) => ChapterText | null
export interface VerseNotifyItem { book: number; hour: number; minute: number }
export interface VerseNotifyPref { items: VerseNotifyItem[] }
export interface VerseNotice { identifier: string; title: string; body: string; url: string; at: Date }
export interface BookVerse { chapter: number; v: number; t: string }
/** The reader's path at scheduling time: its state and the next portion (null once finished). No path: null. */
export type PathNext = { path: PathState; next: Portion | null } | null

export const DEFAULT_ITEM: VerseNotifyItem = { book: ANY_BOOK, hour: 6, minute: 0 }
export const isValidTime = (hour: unknown, minute: unknown): boolean =>
  Number.isInteger(hour) && (hour as number) >= 0 && (hour as number) <= 23 && Number.isInteger(minute) && (minute as number) >= 0 && (minute as number) <= 59

/**
 * The stored pref, read loosely and capped. Records from versionCode 31's first shape (`{ enabled, hour, minute }`)
 * become one Any-book item at that time when they were on, none otherwise; anything unreadable is off.
 */
export function readVerseNotify(raw: unknown): VerseNotifyPref {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  if (Array.isArray(r.items)) {
    const items: VerseNotifyItem[] = []
    for (const it of r.items as unknown[]) {
      const o = it && typeof it === 'object' ? it as Record<string, unknown> : null
      if (!o || !isValidTime(o.hour, o.minute)) continue
      const book = Number.isInteger(o.book) && ((o.book as number) >= 0 && (o.book as number) <= BOOKS.length || o.book === PATH_BOOK) ? o.book as number : ANY_BOOK
      items.push({ book, hour: o.hour as number, minute: o.minute as number })
      if (items.length === VERSE_NOTIFY_MAX_ITEMS) break
    }
    return { items }
  }
  if (r.enabled === true) return { items: [{ book: ANY_BOOK, hour: isValidTime(r.hour, r.minute) ? r.hour as number : 6, minute: isValidTime(r.hour, r.minute) ? r.minute as number : 0 }] }
  return { items: [] }
}

/**
 * The next `days` firing times at hour:minute, built in the device's local time (`new Date(y, m, d, h, min)`), so
 * "6:00" is 6:00 on whatever clock the phone keeps. A traveller's phone carries the old zone's instants until the
 * next refresh (app start, foreground, or the background task), which rebuilds them in the new zone. Today's time is
 * included while it is still ahead of `now`; otherwise the list starts tomorrow.
 */
export function verseNotifyDates(now: Date, hour: number, minute: number, days = VERSE_NOTIFY_DAYS): Date[] {
  const out: Date[] = []
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)
  const offset = first.getTime() > now.getTime() ? 0 : 1
  for (let i = 0; i < days; i++) out.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset + i, hour, minute, 0, 0))
  return out
}

/** Cut at a word so the body ends cleanly; the whole verse when it fits. */
export function trimVerse(text: string, max = VERSE_BODY_MAX): string {
  const t = text.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  // a cut that lands on a word's end keeps the word; one inside a word backs off to the last space
  const wordEnd = /[\s,;:.!?—–-]/.test(t.charAt(max - 1))
  const space = wordEnd ? cut.length : cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.—–-]+$/, '')}…`
}

// ---------------- a verse from one book ----------------

/**
 * Whether a verse can stand alone as a morning's text: between 40 and 280 characters, and not a line of a genealogy
 * (Genesis 5, 1 Chronicles 1-9, Matthew 1): "begat"/"begot" is the sure sign (not "begotten": John 3:16 has "only-begotten"), and three or more capitalised words
 * with "son of" catches the lists that have neither. A book left with nothing usable (none is) would fall back to
 * its first verse.
 */
export function usableVerse(text: string): boolean {
  const t = text.trim()
  if (t.length < VERSE_MIN_CHARS || t.length > VERSE_MAX_CHARS) return false
  if (/\bbeg[ao]t\b/i.test(t)) return false
  // capitalised words inside a sentence (never its first word); no lookbehind, for Hermes
  const names = t.split(/[.;:!?]\s+/).reduce((n, s) => n + (s.match(/\s[A-Z][a-z]+/g) ?? []).length, 0)
  return !(names >= 3 && /\bson of\b/.test(t))
}

/** Every usable verse of a book in canonical order, read once per (reader, book): the bundled text never changes. */
const usableCache = new WeakMap<ChapterReader, Map<number, BookVerse[]>>()
export function bookVerses(book: number, chapter: ChapterReader): BookVerse[] {
  let perBook = usableCache.get(chapter)
  if (!perBook) { perBook = new Map(); usableCache.set(chapter, perBook) }
  const hit = perBook.get(book)
  if (hit) return hit
  const meta = BOOKS[book - 1]
  const all: BookVerse[] = []
  const usable: BookVerse[] = []
  for (let c = 1; c <= (meta?.chapters ?? 0); c++) {
    for (const v of chapter(book, c)?.verses ?? []) {
      const bv = { chapter: c, v: v.v, t: v.t }
      all.push(bv)
      if (usableVerse(v.t)) usable.push(bv)
    }
  }
  const out = usable.length ? usable : all.slice(0, 1)
  perBook.set(book, out)
  return out
}

/** The device's calendar day as a count (days since 1970-01-01 in local terms): the same number all day, in any zone. */
export const localDayNumber = (d: Date): number => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)

/**
 * The verse of `book` for the local day of `at`: the book's usable verses walked in order, one a day, round again
 * at the end (the day count modulo their number). Null only for a book the reader cannot open at all.
 */
export function verseInBook(book: number, at: Date, chapter: ChapterReader): BookVerse | null {
  const verses = bookVerses(book, chapter)
  if (!verses.length) return null
  return verses[localDayNumber(at) % verses.length]
}

// ---------------- what a morning says ----------------

/**
 * The notification for item `i` on the morning `at`. Any book: the same verse the widget and Home show that day
 * (`verseCard` reads the device's calendar day off `at`); a chosen book: `verseInBook`. The reference is the title,
 * the text the body. A chapter the app cannot read (never for the bundled Bible) leaves the body as an invitation.
 */
export function verseNotice(at: Date, chapter: ChapterReader, book = ANY_BOOK, i = 0, path: PathNext = null): VerseNotice | null {
  const identifier = `${VERSE_NOTIFY_PREFIX}${i}-${at.getTime()}`
  if (book === PATH_BOOK) return path ? pathNotice(identifier, at, chapter, path) : null
  if (book === ANY_BOOK) {
    const card = verseCard(at, chapter)
    return { identifier, title: card.label, body: card.text ? trimVerse(card.text) : 'Open today’s verse', url: card.url.replace(/^[a-z]+:\/\//, '/'), at }
  }
  const bv = verseInBook(book, at, chapter)
  if (!bv) return { identifier, title: BOOKS[book - 1]?.name ?? 'Verse of the day', body: 'Open today’s verse', url: `${VERSE_ROUTE_PREFIX}${book}/1`, at }
  return { identifier, title: formatRef({ book, chapter: bv.chapter, v1: bv.v }), body: trimVerse(presentVotd(bv.t)), url: `${VERSE_ROUTE_PREFIX}${book}/${bv.chapter}?v=${bv.v}`, at }
}

/**
 * The path item's morning: "Mark 4 · The Gospels", the chapter's first verse, the chapter as the route. The next portion
 * is the one unread at scheduling time, the same for every morning ahead (which chapters the reader will have read by
 * then is theirs to decide, rule 1); each credit reschedules, so the queue follows the reading. A finished path says so
 * once and opens the Paths screen's home.
 */
function pathNotice(identifier: string, at: Date, chapter: ChapterReader, { path, next }: NonNullable<PathNext>): VerseNotice {
  const title = pathTitle(path)
  if (!next) return { identifier, title: `${title} · finished`, body: 'Every chapter on your path is read. Start another when you like.', url: '/', at }
  const first = chapter(next.book, next.chapter)?.verses[0]
  return {
    identifier, at,
    title: `${formatRef({ book: next.book, chapter: next.chapter })} · ${title}`,
    body: first ? trimVerse(presentVotd(first.t)) : 'Open the next chapter on your path',
    url: `${VERSE_ROUTE_PREFIX}${next.book}/${next.chapter}`,
  }
}

/** All `days` notices for every item from `now`, in firing order. A path item without a path schedules nothing. */
export function verseNotices(now: Date, items: VerseNotifyItem[], chapter: ChapterReader, days = VERSE_NOTIFY_DAYS, path: PathNext = null): VerseNotice[] {
  const out: VerseNotice[] = []
  items.slice(0, VERSE_NOTIFY_MAX_ITEMS).forEach((it, i) => { for (const at of verseNotifyDates(now, it.hour, it.minute, days)) { const n = verseNotice(at, chapter, it.book, i, path); if (n) out.push(n) } })
  return out.sort((a, b) => a.at.getTime() - b.at.getTime())
}

/**
 * The background task's rule: fewer than `min` mornings of this feature still ahead of `now` means the queue is
 * rebuilt. Past times (the system fired or dropped them) do not count; with several items a morning counts once.
 * A phone opened every day never gets here; one left alone is topped up around the seventh morning and keeps going.
 */
export function needsTopUp(scheduledAt: (Date | number)[], now: Date, min = VERSE_NOTIFY_MIN_DAYS): boolean {
  const ahead = scheduledAt.filter(t => (typeof t === 'number' ? t : t.getTime()) > now.getTime()).map(t => localDayNumber(new Date(t)))
  return new Set(ahead).size < min
}

// ---------------- Settings wording ----------------

export const timeLabel = (hour: number, minute: number) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
/** A book's name for an item's row, "Any book", or the path ("Your path"; "Your path · no path started" while none is on). */
export const bookLabel = (book: number, style: 'full' | 'abbr' = 'full', pathOn = true): string =>
  book === PATH_BOOK ? (pathOn ? PATH_LABEL : NO_PATH_LABEL) : book === ANY_BOOK ? ANY_BOOK_LABEL : (style === 'abbr' ? BOOKS[book - 1]?.abbr : BOOKS[book - 1]?.name) ?? ANY_BOOK_LABEL
/** An item's row: "Every morning at 06:00". */
export const verseItemDetail = (it: VerseNotifyItem): string => `Every morning at ${timeLabel(it.hour, it.minute)}`

/**
 * The Settings row's one line: "Off"; "Psalms at 06:00"; two items by short name, "Ps at 06:00, John at 07:00";
 * three or more as a count from the earliest time, "3 books, from 06:00".
 */
export function verseNotifyDetail(pref: VerseNotifyPref): string {
  const items = pref.items
  if (!items.length) return 'Off'
  if (items.length === 1) return `${bookLabel(items[0].book)} at ${timeLabel(items[0].hour, items[0].minute)}`
  if (items.length === 2) return items.map(it => `${bookLabel(it.book, 'abbr')} at ${timeLabel(it.hour, it.minute)}`).join(', ')
  const first = items.reduce((a, b) => (a.hour * 60 + a.minute <= b.hour * 60 + b.minute ? a : b))
  return `${items.length} books, from ${timeLabel(first.hour, first.minute)}`
}
