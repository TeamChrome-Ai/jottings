/**
 * Bookmarks and outlines for a reader who is not signed in, kept in AsyncStorage (localStorage on the web) in the
 * server's own shapes (`Bookmark`, `Outline`). Local records carry negative ids, so they never collide with a
 * server row and `isLocalId()` routes any later operation on them back here. Highlights keep their per-chapter
 * device cache in `highlights.ts` under the `local` owner.
 *
 * At sign-in `mergeLocalLibrary()` carries everything into the account once and removes each local record as soon
 * as the server holds it, so an interrupted merge resumes without duplicating.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Bookmark, Outline, OutlineItem } from '@shared/types'
import { get, post, put } from './api'
import { adoptLocalHighlights, localHighlightChapters, type HighlightMap } from './highlights'
import { bookmarkKey, type BookmarkTarget } from './bookmarks'
import { NOUN } from '@shared/brand'
import { t, tn } from '@shared/i18n'

const BOOKMARKS_KEY = 'berean_local_bookmarks'
const OUTLINES_KEY = 'berean_local_outlines'

/** A stored outline remembers the server id it was uploaded as, so a merge cut off before its items resumes there. */
type LocalOutline = Outline & { uploaded_as?: number }
interface Box<R> { next: number; rows: R[] }
export type OutlineMeta = Partial<Pick<Outline, 'title' | 'description' | 'visibility' | 'print_style'>>
export type ItemInput = Omit<OutlineItem, 'id' | 'outline_id' | 'position'>

export const isLocalId = (id: number | string) => Number(id) < 0

const now = () => new Date().toISOString()

// ---------------- storage: one JSON box per kind, writes serialised per key ----------------
const boxes = new Map<string, Box<unknown>>()
const queues = new Map<string, Promise<unknown>>()

async function read<R>(key: string): Promise<Box<R>> {
  const hit = boxes.get(key)
  if (hit) return hit as Box<R>
  let box: Box<R> = { next: 1, rows: [] }
  try {
    const raw = await AsyncStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Box<R>).rows)) {
      const p = parsed as Box<R>
      box = { next: typeof p.next === 'number' && p.next > 0 ? p.next : 1, rows: p.rows }
    }
  } catch { /* unreadable: start empty rather than fail the screen */ }
  // a concurrent first read may have landed while this one waited on storage: keep the one already shared
  const raced = boxes.get(key)
  if (raced) return raced as Box<R>
  boxes.set(key, box)
  return box
}

/** Read-modify-write under a per-key queue: two quick taps never both read the old box. */
function update<R, T>(key: string, fn: (box: Box<R>) => T): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const cur = await read<R>(key)
    const box: Box<R> = { next: cur.next, rows: [...cur.rows] }
    const out = fn(box)
    // memory follows storage: a failed write leaves both on the old box and the caller sees the error
    await AsyncStorage.setItem(key, JSON.stringify(box))
    boxes.set(key, box)
    return out
  })
  queues.set(key, run)
  return run
}

const nextId = <R,>(box: Box<R>) => -(box.next++)

// ---------------- bookmarks ----------------
export async function localBookmarks(): Promise<Bookmark[]> {
  return [...(await read<Bookmark>(BOOKMARKS_KEY)).rows].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** One bookmark per verse, chapter or book, as on the server: a repeat returns the existing row. */
export function addLocalBookmark(b: BookmarkTarget & { label?: string | null }): Promise<Bookmark> {
  return update<Bookmark, Bookmark>(BOOKMARKS_KEY, box => {
    const key = bookmarkKey(b)
    const existing = box.rows.find(r => bookmarkKey(r) === key)
    if (existing) return existing
    const chapter = b.chapter ?? null
    const row: Bookmark = { id: nextId(box), book: b.book, chapter, verse: chapter === null ? null : b.verse ?? null, label: b.label ?? null, color: null, created_at: now() }
    box.rows.push(row)
    return row
  })
}

export const removeLocalBookmark = (id: number) => update<Bookmark, void>(BOOKMARKS_KEY, box => { box.rows = box.rows.filter(r => r.id !== id) })

// ---------------- outlines ----------------
const verseCount = (o: Outline) => (o.items ?? []).filter(i => i.kind === 'verse').length

/** The list view's shape: no items, `verse_count` as the server's "mine" list carries it. */
export async function localOutlines(): Promise<(Outline & { verse_count: number })[]> {
  const rows = (await read<LocalOutline>(OUTLINES_KEY)).rows
  return rows
    .map(({ items: _items, uploaded_as: _up, ...o }) => ({ ...o, verse_count: verseCount({ ...o, items: _items }) }))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

/** Every outline kept on the device with its items, newest first: what a search of the reader's own jottings reads. */
export async function localOutlinesFull(): Promise<Outline[]> {
  const rows = (await read<LocalOutline>(OUTLINES_KEY)).rows
  return rows.map(({ uploaded_as: _up, ...o }) => ({ ...o, items: [...(o.items ?? [])] })).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export async function localOutline(id: number): Promise<Outline | null> {
  const o = (await read<LocalOutline>(OUTLINES_KEY)).rows.find(r => r.id === id)
  if (!o) return null
  const { uploaded_as: _up, ...rest } = o
  return { ...rest, items: [...(o.items ?? [])] }
}

/** Items are numbered 1..n inside their outline (only the outline id is global); the editor's temporary ids are negative. */
const numberItems = (outlineId: number, items: readonly ItemInput[]): OutlineItem[] =>
  items.map((it, i) => ({ ...it, id: i + 1, outline_id: outlineId, position: i }))

export function createLocalOutline(meta: OutlineMeta & { title: string }, items: readonly ItemInput[] = []): Promise<Outline> {
  const title = meta.title.trim()
  if (!title || title.length > 160) return Promise.reject(new Error(t('A title needs 1 to 160 characters')))
  return update<LocalOutline, Outline>(OUTLINES_KEY, box => {
    const id = nextId(box)
    const t = now()
    const o: LocalOutline = {
      id, user_id: 0, title, description: meta.description ?? null, visibility: 'private', share_code: null,
      print_style: meta.print_style ?? 'verses-first', created_at: t, updated_at: t, items: numberItems(id, items),
    }
    box.rows.push(o)
    return { ...o, items: [...(o.items ?? [])] }
  })
}

/** Rewrites one outline; an id that is gone (deleted, or merged into the account meanwhile) is left gone. */
function editLocalOutline(id: number, fn: (o: LocalOutline) => LocalOutline): Promise<Outline> {
  return update<LocalOutline, Outline>(OUTLINES_KEY, box => {
    const i = box.rows.findIndex(r => r.id === id)
    if (i < 0) throw new Error(t('This {one} is no longer on this device', { one: NOUN.one }))
    const o = { ...fn(box.rows[i]), updated_at: now() }
    box.rows[i] = o
    return { ...o, items: [...(o.items ?? [])] }
  })
}

export const setLocalOutlineItems = (id: number, items: readonly ItemInput[]) => editLocalOutline(id, o => ({ ...o, items: numberItems(id, items) }))

/** Local outlines stay private: there is no link to share until the outline lives on the server. */
export const patchLocalOutline = (id: number, meta: OutlineMeta) => editLocalOutline(id, o => ({
  ...o,
  title: meta.title?.trim() || o.title,
  description: meta.description !== undefined ? meta.description : o.description,
  print_style: meta.print_style ?? o.print_style,
}))

export const deleteLocalOutline = (id: number) => update<LocalOutline, void>(OUTLINES_KEY, box => { box.rows = box.rows.filter(r => r.id !== id) })

// ---------------- merge into the account ----------------
export interface MergeResult { bookmarks: number; highlights: number; outlines: number }
export const mergedAnything = (r: MergeResult) => r.bookmarks + r.highlights + r.outlines > 0

/** True when this device holds anything a sign-in would carry over. */
export async function hasLocalLibrary(): Promise<boolean> {
  if ((await read<Bookmark>(BOOKMARKS_KEY)).rows.length || (await read<LocalOutline>(OUTLINES_KEY)).rows.length) return true
  return (await localHighlightChapters()).length > 0
}

let merging: Promise<MergeResult> | null = null
/** Local outline id -> the server id it became, for screens still open on the local id when the merge ran. */
const moved = new Map<number, number>()
export const movedTo = (id: number): number | undefined => moved.get(id)
const mergeListeners = new Set<() => void>()
/** Fires after a merge moved anything, so a screen showing tints or bookmarks can reload them from the account. */
export const onLibraryMerged = (fn: () => void) => { mergeListeners.add(fn); return () => { mergeListeners.delete(fn) } }

/**
 * Uploads what the account does not have yet, then drops the local copies. Server data wins where both hold the
 * same verse (a highlight's colour, a bookmark's label). A record that fails stays local and the error propagates;
 * the next call picks up where this one stopped. Concurrent calls share one run.
 */
export function mergeLocalLibrary(uid: number): Promise<MergeResult> {
  merging ??= run(uid)
    .then(r => { if (mergedAnything(r)) mergeListeners.forEach(fn => fn()); return r })
    .finally(() => { merging = null })
  return merging
}

async function run(uid: number): Promise<MergeResult> {
  const result: MergeResult = { bookmarks: 0, highlights: 0, outlines: 0 }

  const bms = (await read<Bookmark>(BOOKMARKS_KEY)).rows
  if (bms.length) {
    const server = await get<Bookmark[]>('/bookmarks')
    const have = new Set(server.map(bookmarkKey))
    for (const b of bms) {
      if (!have.has(bookmarkKey(b))) await post('/bookmarks', { book: b.book, chapter: b.chapter ?? null, verse: b.verse ?? null, label: b.label ?? null })
      await removeLocalBookmark(b.id)
      result.bookmarks++
    }
  }

  for (const { book, chapter, tints } of await localHighlightChapters()) {
    const rows = await get<{ verse_id: number; color: string }[]>(`/highlights?book=${book}&chapter=${chapter}`)
    const merged: HighlightMap = new Map(rows.map(r => [r.verse_id, r.color]))
    for (const [verseId, color] of tints) {
      if (!merged.has(verseId)) { await put('/highlights', { verse_id: verseId, color }); merged.set(verseId, color) }
      result.highlights++
    }
    await adoptLocalHighlights(uid, book, chapter, merged)
  }

  for (const o of (await read<LocalOutline>(OUTLINES_KEY)).rows) {
    let serverId = o.uploaded_as
    if (serverId === undefined) {
      serverId = (await post<Outline>('/outlines', { title: o.title, description: o.description, print_style: o.print_style })).id
      const sid = serverId
      await update<LocalOutline, void>(OUTLINES_KEY, box => { box.rows = box.rows.map(r => (r.id === o.id ? { ...r, uploaded_as: sid } : r)) })
    }
    const items = (o.items ?? []).map(({ id: _id, outline_id: _oid, position: _pos, ...rest }) => rest)
    if (items.length) await put(`/outlines/${serverId}/items`, { items })
    moved.set(o.id, serverId)
    await deleteLocalOutline(o.id)
    result.outlines++
  }
  return result
}

/** "2 bookmarks, 1 jotting" for the sign-in toast. */
export function describeMerge(r: MergeResult): string {
  return [
    r.bookmarks ? tn(r.bookmarks, '{n} bookmark', '{n} bookmarks') : '',
    r.highlights ? tn(r.highlights, '{n} highlight', '{n} highlights') : '',
    r.outlines ? tn(r.outlines, '{n} {one}', '{n} {many}', { one: NOUN.one, many: NOUN.many }) : '',
  ].filter(Boolean).join(', ')
}
