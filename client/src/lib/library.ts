/**
 * Bookmarks and outlines through one door: the API when signed in, this device when not (`localLibrary.ts`).
 * An operation on an existing record goes wherever its id says (negative ids are local), so a record left on the
 * device by an unfinished merge still opens, edits and deletes while signed in. Lists include those leftovers.
 * Screens wait for the auth store's `ready` before the first call, or a restored session would read as signed out.
 */
import type { Bookmark, Outline } from '@shared/types'
import { ApiError, api, del, get, getToken, post } from './api'
import type { BookmarkTarget } from './bookmarks'
import {
  addLocalBookmark, createLocalOutline, deleteLocalOutline, isLocalId, localBookmarks, localOutline, localOutlines, movedTo, patchLocalOutline,
  removeLocalBookmark, setLocalOutlineItems, type ItemInput, type OutlineMeta,
} from './localLibrary'
import { NOUN } from '@shared/brand'
import { t } from '@shared/i18n'

export { isLocalId }
const signedIn = () => getToken() !== null
/** An outline open on its local id when sign-in moved it to the account keeps working under its new id. */
const current = (id: number) => (isLocalId(id) ? movedTo(id) ?? id : id)
/** The id an outline has now: the account's, for one that was opened under this device's id and has moved since. */
export const currentOutlineId = current

// ---------------- bookmarks ----------------
export async function listBookmarks(): Promise<Bookmark[]> {
  if (!signedIn()) return localBookmarks()
  const [server, local] = await Promise.all([get<Bookmark[]>('/bookmarks'), localBookmarks()])
  return local.length ? [...local, ...server] : server
}

/** A verse, a chapter (no verse) or a book (no chapter); one per target, so adding one that exists returns it. */
export const addBookmark = (b: BookmarkTarget & { label?: string | null }): Promise<Bookmark> =>
  signedIn() ? post<Bookmark>('/bookmarks', { book: b.book, chapter: b.chapter ?? null, verse: b.verse ?? null, label: b.label ?? null }) : addLocalBookmark(b)

export const removeBookmark = async (id: number): Promise<void> => {
  if (isLocalId(id)) await removeLocalBookmark(id)
  else await del(`/bookmarks/${id}`)
}

// ---------------- outlines ----------------
export async function listOutlines(): Promise<Outline[]> {
  if (!signedIn()) return localOutlines()
  const [server, local] = await Promise.all([get<Outline[]>('/outlines'), localOutlines()])
  return local.length ? [...local, ...server] : server
}

export const createOutline = (meta: OutlineMeta & { title: string }): Promise<Outline> =>
  signedIn() ? post<Outline>('/outlines', meta) : createLocalOutline(meta)

/** Local ids resolve on the device; a missing one reads as the server's 404. */
export async function getOwnOutline(localOrServerId: number): Promise<Outline> {
  const id = current(localOrServerId)
  if (!isLocalId(id)) return get<Outline>(`/outlines/${id}`)
  const o = await localOutline(id)
  if (o) return o
  // not on the device: because it has moved to the account as this was asked, or because there is none
  const now = current(localOrServerId)
  if (!isLocalId(now)) return get<Outline>(`/outlines/${now}`)
  throw new NotOnDevice()
}
export class NotOnDevice extends Error {
  readonly status = 404
  constructor() { super(t('This {one} is not on this device', { one: NOUN.one })) }
}

/** Who a save is from, and what its sender last saw: `writer`, a name the sender made for itself (one editor on a
 *  screen, one write made for the reader), and `seen`, the outline's `updated_at` as the sender last saw it. */
export interface SavedBy { seen?: string; writer: string }
/** What a save to the account's copy names of that (`if_updated`, `writer`).
 *  - With no `by`, nothing: the callers that are not editors (verses added from the reader, the tour, a restore,
 *    the lines of a jotting Ask has just made). Such a save is made whatever the stamp, and leaves the outline with
 *    no last writer, so that an editor behind it is refused.
 *  - With `by`, always both. An editor that has no stamp of the account's copy (it opened on this device's copy,
 *    which has since moved to the account) has nothing to say what it last saw: its save is not sent, and it is
 *    answered here as the server answers an editor that is behind, so that it stops and loads the outline again. */
function named(by: SavedBy | undefined): { if_updated: string; writer: string } | null {
  if (!by) return null
  if (!by.seen) throw new ApiError(409, 'changed since')
  return { if_updated: by.seen, writer: by.writer }
}

/** `keepalive` lets the editor's last save outlive a closing web page; storage writes need no such help.
 *  `by`: who is saving and the stamp they last saw. The server then saves only if the outline still has that stamp, or
 *  if its last save was this writer's own, and answers 409 (an `ApiError`) with nothing changed otherwise: someone
 *  else has saved since. Without it the save is made whatever the outline's stamp. Gives the outline's new
 *  `updated_at`; none for one kept on this device. */
export async function saveOutlineItems(outlineId: number, items: readonly ItemInput[], keepalive = false, by?: SavedBy): Promise<string | undefined> {
  if (isLocalId(current(outlineId)) && await onDevice(outlineId, !!by, id => setLocalOutlineItems(id, items))) return undefined
  return (await api<Outline | undefined>(`/outlines/${current(outlineId)}/items`, { method: 'PUT', json: { items, ...named(by) }, keepalive }))?.updated_at
}
/** Writes to this device's copy of an outline. The copy may have gone by the time the write's turn comes, because
 *  the outline moved to the account meanwhile (it was the device's when asked).
 *  - An editor's save (`editor`) is then the account's to answer, and this is false: the editor has no stamp of the
 *    account's copy, so it is told it is behind (`named`), stops, and loads the outline again.
 *  - Any other save fails, as a write to a copy that is no longer on the device always has: its lines were worked
 *    out from the copy that has gone, and are not sent to the account over what the outline has become since (that
 *    copy may have gained lines before it was uploaded). The caller's reader is told, and what they ask again is
 *    read from the account's outline and saved to it. None of the callers that are not editors can do better here:
 *    this door is given the lines, not the change that made them.
 *  Any other failure is the caller's to hear of. */
async function onDevice(outlineId: number, editor: boolean, write: (id: number) => Promise<unknown>): Promise<boolean> {
  try { await write(outlineId); return true } catch (e) {
    if (isLocalId(current(outlineId)) || !editor) throw e
    return false
  }
}

/** `by`, and what is given back: as for `saveOutlineItems`. */
export async function patchOutline(outlineId: number, meta: OutlineMeta, keepalive = false, by?: SavedBy): Promise<string | undefined> {
  if (isLocalId(current(outlineId)) && await onDevice(outlineId, !!by, id => patchLocalOutline(id, meta))) return undefined
  return (await api<Outline | undefined>(`/outlines/${current(outlineId)}`, { method: 'PATCH', json: { ...meta, ...named(by) }, keepalive }))?.updated_at
}

export async function deleteOutline(outlineId: number): Promise<void> {
  const id = current(outlineId)
  if (!isLocalId(id)) { await del(`/outlines/${id}`); return }
  await deleteLocalOutline(id)
  // it moved to the account while this was on its way: what the reader deletes is the outline it has just become
  const became = movedTo(id)
  if (became !== undefined && signedIn()) await del(`/outlines/${became}`)
}

/** Signed in, the server copies the outline (someone else's only with the share code it was opened by); signed out,
 *  the copy is made on this device from what is on screen. */
export async function forkOutline(o: Outline): Promise<Outline> {
  if (signedIn()) return post<Outline>(`/outlines/${o.id}/fork`, { code: o.share_code })
  const items = (o.items ?? []).map(({ id: _id, outline_id: _oid, position: _pos, ...rest }) => rest)
  return createLocalOutline({ title: o.title, description: o.description, print_style: o.print_style }, items)
}
