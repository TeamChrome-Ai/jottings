/**
 * "Your data": export (GET /api/me/export) and partial deletion (DELETE /api/me/data) per docs/API.md.
 * Export bypasses `api()` because the body is a file to hand to the user, not JSON to decode; `backup.ts` saves it.
 */
import { ApiError, api, getApiBase, getToken } from './api'
import { NOUN } from '@shared/brand'
import { N_, t, tn } from '@shared/i18n'
import { forgetMarks } from './readMarks'

export type DataCategory = 'activity' | 'bookmarks' | 'highlights' | 'position' | 'outlines' | 'posts' | 'groups' | 'reports' | 'blocks' | 'friends'

export interface CategoryInfo {
  id: DataCategory
  label: string
  hint: string
  /** The deleted-row count: "12 bookmarks". */
  count: (n: number) => string
}

/** Order is the order the contract lists them; the screen renders one SwitchRow each, translating `label` and `hint`. */
export const DATA_CATEGORIES: readonly CategoryInfo[] = [
  { id: 'activity', label: N_('Activity'), hint: N_('Reading time, streaks, chapter credits, badges and the chapters you marked as read'), count: n => tn(n, '{n} activity record', '{n} activity records', { n: n.toLocaleString() }) },
  { id: 'bookmarks', label: N_('Bookmarks'), hint: N_('Every verse, chapter and book you bookmarked'), count: n => tn(n, '{n} bookmark', '{n} bookmarks', { n: n.toLocaleString() }) },
  { id: 'highlights', label: N_('Highlights'), hint: N_('Every highlight and its colour'), count: n => tn(n, '{n} highlight', '{n} highlights', { n: n.toLocaleString() }) },
  { id: 'position', label: N_('Position'), hint: N_('Where you left off reading'), count: n => tn(n, '{n} reading position', '{n} reading positions', { n: n.toLocaleString() }) },
  // the brand's noun fills this hint, so it comes already in the reader's language
  { id: 'outlines', label: NOUN.Many, get hint() { return t('All your {many}; shared links stop working', { many: NOUN.many }) }, count: n => tn(n, '{n} {one}', '{n} {many}', { n: n.toLocaleString(), one: NOUN.one, many: NOUN.many }) },
  { id: 'posts', label: N_('Posts'), hint: N_('Every group post you wrote'), count: n => tn(n, '{n} post', '{n} posts', { n: n.toLocaleString() }) },
  { id: 'groups', label: N_('Groups'), hint: N_('Leave all groups; groups you own are deleted'), count: n => tn(n, '{n} group membership', '{n} group memberships', { n: n.toLocaleString() }) },
  { id: 'reports', label: N_('Reports'), hint: N_('Reports you filed'), count: n => tn(n, '{n} report', '{n} reports', { n: n.toLocaleString() }) },
  { id: 'blocks', label: N_('Blocks'), hint: N_('Your block list'), count: n => tn(n, '{n} block', '{n} blocks', { n: n.toLocaleString() }) },
  { id: 'friends', label: N_('Friends'), hint: N_('Friendships, invites, reactions, codes and contact fingerprints'), count: n => tn(n, '{n} item', '{n} items', { n: n.toLocaleString() }) },
]

const IDS: ReadonlySet<string> = new Set(DATA_CATEGORIES.map(c => c.id))

// ---------------- export ----------------

/** Raw export body as the server sent it (already pretty or not; we do not re-serialize). */
export async function fetchExport(): Promise<string> {
  const token = getToken()
  if (!token) throw new ApiError(401, t('Sign in to export your data'))
  const res = await fetch(`${getApiBase()}/api/me/export`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null)
    const error = body !== null && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : res.statusText
    throw new ApiError(res.status, error || t('Export failed ({status})', { status: res.status }))
  }
  return res.text()
}

// ---------------- partial deletion ----------------

export type DeletedCounts = Partial<Record<DataCategory, number>>

function isDataCategory(s: string): s is DataCategory { return IDS.has(s) }

/** `{ deleted: { category: rowcount } }`; unknown categories are dropped, non-numeric counts rejected. */
function parseDeleteResponse(body: unknown): DeletedCounts {
  if (body === null || typeof body !== 'object' || !('deleted' in body)) throw new Error(t('Unexpected response from the server'))
  const raw = body.deleted
  if (raw === null || typeof raw !== 'object') throw new Error(t('Unexpected response from the server'))
  const out: DeletedCounts = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!isDataCategory(k)) continue
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(t('Unexpected response from the server'))
    out[k] = v
  }
  return out
}

export async function deleteMyData(categories: readonly DataCategory[]): Promise<DeletedCounts> {
  if (categories.length === 0) throw new Error(t('Choose at least one category'))
  const body = await api<unknown>('/me/data', { method: 'DELETE', json: { categories } })
  // the reader's own "read" marks go with the activity, the copy on this device too
  if (categories.includes('activity')) await forgetMarks()
  return parseDeleteResponse(body)
}

/** "Deleted: 12 bookmarks, 3 jottings" in contract order; zero counts are omitted, and all-zero says so. */
export function summarizeDeleted(counts: DeletedCounts): string {
  const parts: string[] = []
  for (const c of DATA_CATEGORIES) {
    const n = counts[c.id]
    if (n === undefined || n === 0) continue
    parts.push(c.count(n))
  }
  return parts.length === 0 ? t('Nothing to delete in the selected categories') : t('Deleted: {list}', { list: parts.join(', ') })
}
