/**
 * "Your data": export (GET /api/me/export) and partial deletion (DELETE /api/me/data) per docs/API.md.
 * Export bypasses `api()` because the body is a file to hand to the user, not JSON to decode; `backup.ts` saves it.
 */
import { ApiError, api, getApiBase, getToken } from './api'
import { NOUN } from '@shared/brand'
import { forgetMarks } from './readMarks'

export type DataCategory = 'activity' | 'bookmarks' | 'highlights' | 'position' | 'outlines' | 'posts' | 'groups' | 'reports' | 'blocks' | 'friends'

export interface CategoryInfo {
  id: DataCategory
  label: string
  hint: string
  /** Noun for the deleted-row count: [singular, plural]. */
  noun: [string, string]
}

/** Order is the order the contract lists them; the screen renders one SwitchRow each. */
export const DATA_CATEGORIES: readonly CategoryInfo[] = [
  { id: 'activity', label: 'Activity', hint: 'Reading time, streaks, chapter credits, badges and the chapters you marked as read', noun: ['activity record', 'activity records'] },
  { id: 'bookmarks', label: 'Bookmarks', hint: 'Every verse, chapter and book you bookmarked', noun: ['bookmark', 'bookmarks'] },
  { id: 'highlights', label: 'Highlights', hint: 'Every highlight and its colour', noun: ['highlight', 'highlights'] },
  { id: 'position', label: 'Position', hint: 'Where you left off reading', noun: ['reading position', 'reading positions'] },
  { id: 'outlines', label: NOUN.Many, hint: `All your ${NOUN.many}; shared links stop working`, noun: [NOUN.one, NOUN.many] },
  { id: 'posts', label: 'Posts', hint: 'Every group post you wrote', noun: ['post', 'posts'] },
  { id: 'groups', label: 'Groups', hint: 'Leave all groups; groups you own are deleted', noun: ['group membership', 'group memberships'] },
  { id: 'reports', label: 'Reports', hint: 'Reports you filed', noun: ['report', 'reports'] },
  { id: 'blocks', label: 'Blocks', hint: 'Your block list', noun: ['block', 'blocks'] },
  { id: 'friends', label: 'Friends', hint: 'Friendships, invites, reactions, codes and contact fingerprints', noun: ['item', 'items'] },
]

const IDS: ReadonlySet<string> = new Set(DATA_CATEGORIES.map(c => c.id))

// ---------------- export ----------------

/** Raw export body as the server sent it (already pretty or not; we do not re-serialize). */
export async function fetchExport(): Promise<string> {
  const token = getToken()
  if (!token) throw new ApiError(401, 'Sign in to export your data')
  const res = await fetch(`${getApiBase()}/api/me/export`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null)
    const error = body !== null && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : res.statusText
    throw new ApiError(res.status, error || `Export failed (${res.status})`)
  }
  return res.text()
}

// ---------------- partial deletion ----------------

export type DeletedCounts = Partial<Record<DataCategory, number>>

function isDataCategory(s: string): s is DataCategory { return IDS.has(s) }

/** `{ deleted: { category: rowcount } }`; unknown categories are dropped, non-numeric counts rejected. */
function parseDeleteResponse(body: unknown): DeletedCounts {
  if (body === null || typeof body !== 'object' || !('deleted' in body)) throw new Error('Unexpected response from the server')
  const raw = body.deleted
  if (raw === null || typeof raw !== 'object') throw new Error('Unexpected response from the server')
  const out: DeletedCounts = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!isDataCategory(k)) continue
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Unexpected response from the server')
    out[k] = v
  }
  return out
}

export async function deleteMyData(categories: readonly DataCategory[]): Promise<DeletedCounts> {
  if (categories.length === 0) throw new Error('Choose at least one category')
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
    parts.push(`${n.toLocaleString()} ${n === 1 ? c.noun[0] : c.noun[1]}`)
  }
  return parts.length === 0 ? 'Nothing to delete in the selected categories' : `Deleted: ${parts.join(', ')}`
}
