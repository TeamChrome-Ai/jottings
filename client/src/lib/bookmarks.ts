/**
 * The three kinds of bookmark, as the server tells them apart (docs/API.md): a verse, a chapter (`verse` null) and a
 * book (`chapter` null too). Pure: the reader, the picker, the Bookmarks screen and the local library share it.
 */
import type { Bookmark } from '@shared/types'
import { BOOKS } from '@shared/books'
import { formatRef } from '@shared/ref'

export type BookmarkKind = 'book' | 'chapter' | 'verse'
export interface BookmarkTarget { book: number; chapter?: number | null; verse?: number | null }

export const bookmarkKind = (b: BookmarkTarget): BookmarkKind => (b.chapter == null ? 'book' : b.verse == null ? 'chapter' : 'verse')

/** "43", "43.3" or "43.3.16": one key per target, so one bookmark per target on the device and at the merge. */
export function bookmarkKey(b: BookmarkTarget): string {
  if (b.chapter == null) return `${b.book}`
  return b.verse == null ? `${b.book}.${b.chapter}` : `${b.book}.${b.chapter}.${b.verse}`
}

/** "Genesis", "Genesis 1", "Genesis 1:3". */
export function bookmarkTitle(b: BookmarkTarget): string {
  if (b.chapter == null) return BOOKS[b.book - 1].name
  return formatRef({ book: b.book, chapter: b.chapter, v1: b.verse ?? undefined })
}

/** Bookmark ids by `bookmarkKey`: what the reader and the picker toggle and mark. */
export const bookmarkIds = (list: readonly Bookmark[]): Map<string, number> => new Map(list.map(b => [bookmarkKey(b), b.id]))

const GROUPS: readonly { kind: BookmarkKind; title: string }[] = [{ kind: 'book', title: 'Books' }, { kind: 'chapter', title: 'Chapters' }, { kind: 'verse', title: 'Verses' }]
export interface BookmarkGroup { kind: BookmarkKind; title: string; items: Bookmark[] }

/** Books, Chapters, Verses, only those with something in them, each newest first. */
export function groupBookmarks(list: readonly Bookmark[]): BookmarkGroup[] {
  const newest = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))
  return GROUPS.map(g => ({ ...g, items: newest.filter(b => bookmarkKind(b) === g.kind) })).filter(g => g.items.length > 0)
}

/**
 * Where a bookmark opens: a verse at the verse, a chapter at its top, a book where you last were in it (`last`, the
 * saved reading position) or else at its first chapter.
 */
export function bookmarkPlace(b: BookmarkTarget, last?: { book: number; chapter: number; verse: number } | null): { book: number; chapter: number; verse: number | null } {
  if (b.chapter == null) return last && last.book === b.book ? { book: b.book, chapter: last.chapter, verse: last.verse } : { book: b.book, chapter: 1, verse: null }
  return { book: b.book, chapter: b.chapter, verse: b.verse ?? null }
}

/** The verses of one chapter that carry a bookmark, from `bookmarkIds`. */
export function markedVerses(marks: ReadonlyMap<string, number>, book: number, chapter: number): Set<number> {
  const here = `${bookmarkKey({ book, chapter })}.`
  return new Set([...marks.keys()].filter(k => k.startsWith(here)).map(k => Number(k.slice(here.length))))
}
