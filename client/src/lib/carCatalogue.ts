import { BRAND } from '@shared/brand'
import { BOOKS } from '@shared/books'
import { peekLang, t } from '@shared/i18n'
import { parseRef } from '@shared/ref'
import { ownChapters, ownNumber, peekShownText } from '@shared/texts'

/**
 * What a car is shown of the app (modules/media-library serves it to Android Auto): a tree to browse, written once as
 * JSON so it is there before JavaScript is, and what a driver's "play John 3" names. Two roots: Continue listening,
 * which holds the place the reading last reached, and Bible, by testament, book and chapter. Every word a driver reads
 * is in the app's language, and the chapters are the shown Bible's own (a French reader's Psaume 51 opens at its verse).
 */
export interface CarNode { t: string; s?: string; i?: 'continue' | 'bible'; c?: string[] }
export interface CarCatalogue { key: string; nodes: Record<string, CarNode> }
/** A playable entry on its own: a search's result, the place to continue from. */
export interface CarItem { id: string; t: string; s?: string }
/** A chapter and the verse to read from, in the English numbering everything is kept in. */
export interface Place { book: number; chapter: number; verse: number }

/** Where the service puts the place to continue from (Catalogue.kt). */
const PLACE = '@place'
/** Raised when the tree's shape changes, so a phone's stored copy is written again. */
const VERSION = 1

export const chapterId = (book: number, chapter: number, verse = 1): string => (verse > 1 ? `c/${book}/${chapter}/${verse}` : `c/${book}/${chapter}`)

/** The chapter an id names, or null for anything else (a book, a root, a chapter there is not). */
export function placeOf(id: string): Place | null {
  const m = /^c\/(\d+)\/(\d+)(?:\/(\d+))?$/.exec(id)
  if (!m) return null
  const [book, chapter, verse] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 1]
  const b = BOOKS[book - 1]
  return b && chapter >= 1 && chapter <= b.chapters && verse >= 1 ? { book, chapter, verse } : null
}

/** What the tree on file was written for: a change of language or of Bible writes it again. */
export const catalogueKey = (): string => `${VERSION}:${peekLang()}:${peekShownText()}`

/** A book's chapters as the shown Bible numbers them, each under the id of the English chapter and verse it begins at. */
const chaptersOf = (book: number): CarItem[] => ownChapters(book).map(({ n, c, v }) => ({ id: chapterId(book, c, v), t: `${BOOKS[book - 1].refName} ${n}` }))

export function carCatalogue(): CarCatalogue {
  const nodes: Record<string, CarNode> = {
    root: { t: BRAND.name, c: ['continue', 'bible'] },
    continue: { t: t('Continue listening'), i: 'continue', c: [PLACE] },
    bible: { t: t('Bible'), i: 'bible', c: ['ot', 'nt'] },
    ot: { t: t('Old Testament'), c: [] },
    nt: { t: t('New Testament'), c: [] },
  }
  for (const b of BOOKS) {
    const chapters = chaptersOf(b.n)
    nodes[b.testament === 'OT' ? 'ot' : 'nt'].c!.push(`b/${b.n}`)
    nodes[`b/${b.n}`] = { t: b.name, c: chapters.map(x => x.id) }
    for (const x of chapters) nodes[x.id] = { t: x.t }
  }
  return { key: catalogueKey(), nodes }
}

/** The words a voice request wraps a reference in ("play the gospel of John chapter 3 on" and the app's name). */
const APP = BRAND.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const reference = (query: string): string => query.toLowerCase()
  .replace(/^\s*(?:play|read|listen to|open)\b/, '')
  .replace(new RegExp(`\\b(?:on|in|from|with)\\s+${APP}\\s*$`), '')
  .replace(/\bthe\s+(?:book|gospel|epistle|letter)\s+(?:of|to the|to|according to)\b/, '')
  .replace(/\bthird\b/, '3')
  .replace(/\bchapter\b/, '')
  .replace(/\s*\bverses?\b\s*/, ':')
  .replace(/\s+/g, ' ')
  .trim()

/** The chapter a request names, null when it names none. A misspelt book ("Jhon 3") is taken only with a number after it. */
export function carSearch(query: string): Place | null {
  const q = reference(query)
  if (!q) return null
  const r = parseRef(q) ?? (/\d/.test(q) ? parseRef(q, { fuzzy: true }) : null)
  return r ? { book: r.book, chapter: r.chapter, verse: r.v1 ?? 1 } : null
}

/** What a search lists: the chapter named, or every chapter of a book named with no number. */
export function carFind(query: string): CarItem[] {
  const p = carSearch(query)
  if (!p) return []
  const chapters = chaptersOf(p.book)
  // "1 John" has a number and names no chapter
  const numbered = /\d/.test(reference(query).replace(/^[1-3]\s*/, ''))
  return numbered ? chapters.filter(x => placeOf(x.id)?.chapter === p.chapter).slice(0, 1) : chapters
}

/** The entry under Continue listening: the chapter the reading last reached, opened at its verse. */
export function continueItem(p: Place): CarItem {
  const own = ownNumber(p.book, p.chapter, p.verse)
  const title = `${BOOKS[p.book - 1].refName} ${own.c}`
  return p.verse > 1 ? { id: chapterId(p.book, p.chapter, p.verse), t: title, s: t('From verse {n}', { n: own.v }) } : { id: chapterId(p.book, p.chapter), t: title }
}
