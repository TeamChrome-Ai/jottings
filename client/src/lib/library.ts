/**
 * Bookmarks and outlines through one door: the API when signed in, this device when not (`localLibrary.ts`).
 * An operation on an existing record goes wherever its id says (negative ids are local), so a record left on the
 * device by an unfinished merge still opens, edits and deletes while signed in. Lists include those leftovers.
 * Screens wait for the auth store's `ready` before the first call, or a restored session would read as signed out.
 */
import type { Bookmark, Outline } from '@shared/types'
import { api, del, get, getToken, post } from './api'
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
  if (!o) throw new NotOnDevice()
  return o
}
export class NotOnDevice extends Error {
  readonly status = 404
  constructor() { super(t('This {one} is not on this device', { one: NOUN.one })) }
}

/** `keepalive` lets the editor's last save outlive a closing web page; storage writes need no such help. */
export async function saveOutlineItems(outlineId: number, items: readonly ItemInput[], keepalive = false): Promise<void> {
  const id = current(outlineId)
  if (isLocalId(id)) { await setLocalOutlineItems(id, items); return }
  await api(`/outlines/${id}/items`, { method: 'PUT', json: { items }, keepalive })
}

export async function patchOutline(outlineId: number, meta: OutlineMeta, keepalive = false): Promise<void> {
  const id = current(outlineId)
  if (isLocalId(id)) { await patchLocalOutline(id, meta); return }
  await api(`/outlines/${id}`, { method: 'PATCH', json: meta, keepalive })
}

export async function deleteOutline(outlineId: number): Promise<void> {
  const id = current(outlineId)
  if (isLocalId(id)) await deleteLocalOutline(id)
  else await del(`/outlines/${id}`)
}

/** Signed in, the server copies the outline; signed out, the copy is made on this device from what is on screen. */
export async function forkOutline(o: Outline): Promise<Outline> {
  if (signedIn()) return post<Outline>(`/outlines/${o.id}/fork`)
  const items = (o.items ?? []).map(({ id: _id, outline_id: _oid, position: _pos, ...rest }) => rest)
  return createLocalOutline({ title: o.title, description: o.description, print_style: o.print_style }, items)
}
