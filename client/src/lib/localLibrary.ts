/**
 * Bookmarks and outlines for a reader who is not signed in, kept in AsyncStorage (localStorage on the web) in the
 * server's own shapes (`Bookmark`, `Outline`). Local records carry negative ids, so they never collide with a
 * server row and `isLocalId()` routes any later operation on them back here. Highlights keep their per-chapter
 * device cache in `highlights.ts` under the `local` owner.
 *
 * At sign-in `mergeLocalLibrary()` carries everything into the account once and removes each local record as soon
 * as the server holds it, so an interrupted merge resumes without duplicating. An outline that is in an editor's
 * hands is left on the device, as it is, until it is free: an outline is not moved under its editor.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Bookmark, Outline, OutlineItem } from '@shared/types'
import { api, del, get, getToken, post, put } from './api'
import { newWriter, outlineBusy, outlineClaimed } from './outlineEditors'
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

/** Read-modify-write under a per-key queue: two quick taps never both read the old box. `stored`: called in the very
 *  step in which the new box becomes the one that is read, for what must be true from that instant. */
function update<R, T>(key: string, fn: (box: Box<R>) => T, stored?: (out: T) => void): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const cur = await read<R>(key)
    const box: Box<R> = { next: cur.next, rows: [...cur.rows] }
    const out = fn(box)
    // memory follows storage: a failed write leaves both on the old box and the caller sees the error
    await AsyncStorage.setItem(key, JSON.stringify(box))
    boxes.set(key, box)
    stored?.(out)
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

/** The outlines whose copy is being dropped at this moment: uploaded, the drop decided, the storage still writing. */
const dropping = new Set<number>()

export async function localOutline(id: number): Promise<Outline | null> {
  // its copy is going as this is asked: what is read is what is there when that write is done (the copy still, if
  // the write failed; nothing, if not, and then the outline is the account's: lib/library.ts `getOwnOutline`)
  if (dropping.has(id)) await (queues.get(OUTLINES_KEY) ?? Promise.resolve()).catch(() => {})
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

/** One at a time: a run, and each move of an outline that became free meanwhile, takes its turn after what was asked
 *  for before it, whatever came of that. So nothing asked for is dropped because the thing before it failed, and the
 *  same outline is never uploaded twice at once. */
let turn: Promise<unknown> = Promise.resolve()
function inTurn<T>(task: () => Promise<T>): Promise<T> {
  const mine = turn.then(task)
  turn = mine.catch(() => {})
  return mine
}
/** The whole run that is asked for and has not begun, and the sign-in that asked for it. */
interface Asked { session: string | null; uid: number; run: Promise<MergeResult> }
let asked: Asked | null = null
/** A run or a move is of the session it began in. That session has ended (the reader signed out, or another signed
 *  in): it sends nothing more and takes nothing more off the device. What it had moved is that reader's; what it had
 *  not is the device's still, for whoever signs in next. */
class SessionEnded extends Error { constructor() { super('the session this was begun in has ended') } }
/** Whether the session signed in is still `session`. */
type Live = () => boolean
const liveIn = (session: string | null): Live => () => session !== null && getToken() === session
/** Local outline id -> the server id it became, for screens still open on the local id when the merge ran. */
const moved = new Map<number, number>()
export const movedTo = (id: number): number | undefined => moved.get(id)
const mergeListeners = new Set<() => void>()
/** Fires after a merge moved anything, so a screen showing tints or bookmarks can reload them from the account. */
export const onLibraryMerged = (fn: () => void) => { mergeListeners.add(fn); return () => { mergeListeners.delete(fn) } }
const announced = (r: MergeResult): MergeResult => { if (mergedAnything(r)) mergeListeners.forEach(fn => fn()); return r }

/**
 * Uploads what the account does not have yet, then drops the local copies. Server data wins where both hold the
 * same verse (a highlight's colour, a bookmark's label). A record that fails stays local and the error propagates;
 * the next call picks up where this one stopped.
 *
 * A run reads what the device holds once, as it begins, so a run that has begun is not the run of a call that comes
 * after: such a call is given a run that begins after it was made, once, however the one on its way ends (a sign-in
 * while the run of an earlier sign-in is still going, which had passed by an outline that is free now). Calls of one
 * sign-in that come before that run has begun share it. And a run is of the session that asked for it (`SessionEnded`):
 * after sign-out it stops, and another reader's sign-in has a run of its own, after it, which reads the device afresh
 * and sends and keeps everything under that reader's session and id.
 *
 * An outline that a screen has in hand (an editor mounted on it, or a screen opening it for one), or with a save on
 * its way to this device's copy, is left where it is: it stays an outline of the device, edited and saved here as
 * before sign-in, and in the reader's list. It is moved when it is free (`moveFreedOutline`, at the registry's
 * word), or at the next sign-in or launch. Nothing waits on a timer, and a save that never lands only means the
 * outline is not moved yet.
 */
export function mergeLocalLibrary(uid: number): Promise<MergeResult> {
  const session = getToken()
  if (asked && asked.session === session && asked.uid === uid) return asked.run
  const mine: Asked = { session, uid, run: inTurn(() => { if (asked === mine) asked = null; return run(uid, liveIn(session)) }).then(announced) }
  asked = mine
  return mine.run
}

/**
 * An outline of this device has become free (lib/outlineEditors.ts `onOutlineFree`): it is moved to the account, in
 * its turn. This is the move that outline is owed, and its own: it does not ride on a run that may be on its way
 * with other things and may fail on them (at the release this came from, the order of the outlines alone decided
 * whether one failing kept another back). One call is one move of one outline, tried once: an outline that cannot
 * be uploaded now waits, like any other, for the next sign-in or launch.
 *
 * Its turn may come some requests after the word that it was free. So whether the reader is signed in, like
 * whether the outline is still free, is asked when the turn comes: signed out by then, there is no account to move
 * it to, nothing is sent, and the run at the next sign-in moves it. The move is of the session signed in when it
 * begins, as a run is: that session ended while it is on its way, it stops, and says nothing.
 */
export function moveFreedOutline(id: number): Promise<MergeResult> {
  return inTurn(async () => {
    const result: MergeResult = { bookmarks: 0, highlights: 0, outlines: 0 }
    const session = getToken()
    if (session === null || outlineBusy(id)) return result
    try { if (await moveOutline(id, liveIn(session))) result.outlines = 1 } catch (e) { if (!(e instanceof SessionEnded)) throw e }
    return result
  }).then(announced)
}

async function run(uid: number, live: Live): Promise<MergeResult> {
  const result: MergeResult = { bookmarks: 0, highlights: 0, outlines: 0 }
  /** Before anything is sent, and before anything is taken off the device or kept as `uid`'s. */
  const still = () => { if (!live()) throw new SessionEnded() }

  const bms = (await read<Bookmark>(BOOKMARKS_KEY)).rows
  if (bms.length) {
    still()
    const server = await get<Bookmark[]>('/bookmarks')
    const have = new Set(server.map(bookmarkKey))
    for (const b of bms) {
      still()
      if (!have.has(bookmarkKey(b))) { await post('/bookmarks', { book: b.book, chapter: b.chapter ?? null, verse: b.verse ?? null, label: b.label ?? null }); still() }
      await removeLocalBookmark(b.id)
      result.bookmarks++
    }
  }

  for (const { book, chapter, tints } of await localHighlightChapters()) {
    still()
    const rows = await get<{ verse_id: number; color: string }[]>(`/highlights?book=${book}&chapter=${chapter}`)
    const merged: HighlightMap = new Map(rows.map(r => [r.verse_id, r.color]))
    for (const [verseId, color] of tints) {
      still()
      if (!merged.has(verseId)) { await put('/highlights', { verse_id: verseId, color }); merged.set(verseId, color) }
      result.highlights++
    }
    // what was read and sent above was this reader's only while their session lasted
    still()
    await adoptLocalHighlights(uid, book, chapter, merged)
  }

  for (const { id } of (await read<LocalOutline>(OUTLINES_KEY)).rows) {
    // in an editor's hands: it is the device's until it is free
    if (outlineBusy(id)) continue
    if (await moveOutline(id, live)) result.outlines++
  }
  return result
}

/**
 * Moves one outline of this device to the account: makes the account's copy (or takes up the one an earlier run
 * made), uploads the device's copy to it, and drops the device's copy. Whether it moved.
 *
 * That the outline was free when the upload began says nothing of when it ends. So the deciding look is the last
 * one: the device's copy is dropped only as it was uploaded, and only when no screen has it in hand, and the look,
 * the dropping and the record of the move are one step of the storage's own queue.
 * - Saved to since it was read (the reader's sheet; an editor opened and closed meanwhile): what it now holds is
 *   uploaded in its turn, title and all, and the drop is tried again.
 * - A screen has it by then (an edit screen claims an outline before it reads it, lib/outlineEditors.ts
 *   `outlineOpening`, and does not wait for an upload): it is not moved under that screen. The move is given up,
 *   and the outline is the device's as before, to be moved when it is free.
 * - Deleted by the reader meanwhile: the move is given up likewise.
 * A screen that comes for the outline after the drop is decided reads it when the drop is written, and is given the
 * account's outline (`localOutline`, lib/library.ts `getOwnOutline`).
 *
 * The account's copy is an outline of the account's from the moment it is made, and someone else may save to it
 * (another device, Ask). So what this run saves to a copy it made names the stamp the run last left on it and a
 * name of the run's own, as an editor's saves do (rs/src/outlines.rs `changed_since`): a save of anyone else's is
 * not written over. When there is one, the copy is theirs and stays; the device's copy forgets it, and is moved
 * later as an outline of its own. Giving a move up takes the run's copy away only while it is still as the run left
 * it. A copy an earlier run made is taken up without a stamp, as it always was (and an outline of the device with
 * such a copy is, as it always was, in the list beside it until the move is finished); if the copy has gone from
 * the account since, the device's copy forgets it and is uploaded as new. The outline is recorded as moved only when
 * its copy has been dropped.
 *
 * `live`: whether the session the move began in is still the one signed in. Asked before each request and at the
 * drop: once it has ended nothing more is sent and the copy is not dropped (`SessionEnded`). What a request already
 * sent has made is recorded all the same (the account's copy, for that reader's next sign-in to take up; another
 * reader's run finds no such outline of theirs, forgets it, and uploads the device's copy as new).
 */
async function moveOutline(id: number, live: Live): Promise<boolean> {
  const still = () => { if (!live()) throw new SessionEnded() }
  const o = (await read<LocalOutline>(OUTLINES_KEY)).rows.find(r => r.id === id)
  if (!o) return false
  const meta = (r: LocalOutline) => ({ title: r.title, description: r.description, print_style: r.print_style })
  /** The account's copy was made by an earlier run that could not finish. */
  const resumed = o.uploaded_as !== undefined
  const writer = newWriter()
  /** The stamp this run last left on the copy it made. */
  let stamp: string | undefined
  /** The title and settings the account's copy is known to have. */
  let sent: string | null = null
  let serverId = o.uploaded_as
  if (serverId === undefined) {
    sent = JSON.stringify(meta(o))
    still()
    const made = await post<Outline>('/outlines', meta(o))
    serverId = made.id
    stamp = made.updated_at
    const sid = serverId
    await update<LocalOutline, void>(OUTLINES_KEY, box => { box.rows = box.rows.map(r => (r.id === id ? { ...r, uploaded_as: sid } : r)) })
  }
  const by = () => (stamp ? { if_updated: stamp, writer } : null)
  /** The device's copy has no copy on the account any more. */
  const forget = () => update<LocalOutline, void>(OUTLINES_KEY, box => { box.rows = box.rows.map(r => { if (r.id !== id) return r; const { uploaded_as: _up, ...rest } = r; return rest }) })
  const giveUp = async (): Promise<false> => {
    if (resumed || !live()) return false
    // not known how the copy stands (no connection): it is left, for the next run to take up
    const now = await get<Outline>(`/outlines/${serverId}`).catch(() => null)
    if (!now || !live()) return false
    // as this run left it: taken away. With a save of someone else's on it: theirs, and it stays
    if (now.updated_at === stamp && !await del(`/outlines/${serverId}`).then(() => true, () => false)) return false
    await forget()
    return false
  }
  for (let first = true; ; first = false) {
    const row = (await read<LocalOutline>(OUTLINES_KEY)).rows.find(r => r.id === id)
    if (!row) return giveUp()
    try {
      if (JSON.stringify(meta(row)) !== sent) {
        still()
        const now = await api<Outline | undefined>(`/outlines/${serverId}`, { method: 'PATCH', json: { ...meta(row), ...by() } })
        if (stamp) stamp = now?.updated_at ?? stamp
        sent = JSON.stringify(meta(row))
      }
      const items = (row.items ?? []).map(({ id: _id, outline_id: _oid, position: _pos, ...rest }) => rest)
      // a copy just made has no lines to take away; any other may have, from an upload before this one
      if (items.length || resumed || !first) {
        still()
        const now = await put<Outline | undefined>(`/outlines/${serverId}/items`, { items, ...by() })
        if (stamp) stamp = now?.updated_at ?? stamp
      }
    } catch (e) {
      const status = (e as { status?: number }).status
      // someone else has saved to the copy this run made: it is theirs, and the device's jotting is moved later as one
      // of its own
      if (status === 409 && !resumed) { await forget(); return false }
      // the copy an earlier run made is no jotting of this reader's (gone from the account since, or made on the
      // account of the reader who was signed in then): it is forgotten, and the device's copy is uploaded as new,
      // now. Once: what is made now is not a copy taken up
      if (status === 404 && resumed) { await forget(); return moveOutline(id, live) }
      throw e
    }
    const sid = serverId
    const how = await update<LocalOutline, 'dropped' | 'held' | 'saved since' | 'ended'>(OUTLINES_KEY, box => {
      if (!live()) return 'ended'
      if (outlineClaimed(id)) return 'held'
      if (box.rows.find(r => r.id === id) !== row) return 'saved since'
      box.rows = box.rows.filter(r => r.id !== id)
      dropping.add(id)
      return 'dropped'
      // it is the account's from the instant its copy is no longer read here
    }, out => { if (out === 'dropped') moved.set(id, sid) }).finally(() => { dropping.delete(id) })
    if (how === 'ended') throw new SessionEnded()
    if (how === 'held') return giveUp()
    if (how === 'dropped') return true
  }
}

/** "2 bookmarks, 1 jotting" for the sign-in toast. */
export function describeMerge(r: MergeResult): string {
  return [
    r.bookmarks ? tn(r.bookmarks, '{n} bookmark', '{n} bookmarks') : '',
    r.highlights ? tn(r.highlights, '{n} highlight', '{n} highlights') : '',
    r.outlines ? tn(r.outlines, '{n} {one}', '{n} {many}', { one: NOUN.one, many: NOUN.many }) : '',
  ].filter(Boolean).join(', ')
}
