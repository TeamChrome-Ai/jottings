/**
 * Moderation: reports, blocks and the admin queue. Shapes mirror docs/API.md "Moderation"; every call goes
 * through the shared api client so a 401 still signs the user out and errors surface as ApiError.
 */
import { del, get, post } from './api'
import type { ProfileResponse } from './community'
import { NOUN } from '@shared/brand'
import { REASONS, type ReportReason } from './reportReasons'

// ---------------- reports ----------------
export type ReportKind = 'post' | 'outline' | 'user'
// the reasons a reader may give are the service's own policy: lib/reportReasons.ts (docs/BRAND.md)
export { REASONS, type ReportReason }
export const DETAILS_MAX = 500
const reasonLabel = (r: string) => REASONS.find(x => x.value === r)?.label ?? r
export { reasonLabel }

/** What a Report button points at; `label` is shown in the sheet title ("Report @handle", "Report post"). */
export interface ReportTarget { kind: ReportKind; id: number; label?: string }

/** Server-side lifecycle; `pending`-like states are `hidden` and `escalated` (admin review outstanding). */
export type ReportStatus = 'allowed' | 'hidden' | 'escalated' | 'resolved' | (string & {})

export const submitReport = (t: ReportTarget, reason: ReportReason, details: string) =>
  post<{ id: number; status: ReportStatus }>('/reports', { kind: t.kind, id: t.id, reason, ...(details.trim() ? { details: details.trim() } : {}) })

// ---------------- blocks ----------------
export interface BlockedUser { user_id: number; handle: string; display_name: string }
export const listBlocks = () => get<BlockedUser[]>('/blocks')
export const blockUser = (user_id: number) => post<unknown>('/blocks', { user_id })
export const unblockUser = (user_id: number) => del<unknown>(`/blocks/${user_id}`)

const hasUserId = (p: object): p is { user_id: number } => 'user_id' in p && typeof p.user_id === 'number'
/**
 * Feed posts identify their author by handle only (see rs/src/groups.rs feed SELECT); blocks are keyed by user id.
 * Use an id the row already carries if the server adds one, otherwise one profile fetch resolves it.
 */
export async function resolveUserId(author: { handle: string }): Promise<number> {
  if (hasUserId(author)) return author.user_id
  const r = await get<ProfileResponse>(`/users/${encodeURIComponent(author.handle)}`)
  return r.user.id
}

// ---------------- admin queue ----------------
export type AdminFilter = 'pending' | 'all'
export type ModerationAction = 'allow' | 'remove' | 'ban' | 'unban'
/** The three "no decision" verdicts are named in the contract; decisive ones (allow, hide, ban) are shown verbatim. */
export type AiVerdict = 'escalate' | 'refused' | 'error' | (string & {})
export interface AdminReport {
  id: number; kind: ReportKind; target_id: number; reason: ReportReason | (string & {}); details: string | null
  status: ReportStatus; ai_verdict: AiVerdict | null; ai_reason: string | null; ai_category: string | null
  created_at: string
  reporter: { handle: string } | null
  /** Null once the content is gone (removed/banned before the admin opened the queue) — contract does not promise it. */
  /** `author.banned`: the account is suspended, by an admin or by the judge under the church rule. */
  target: { preview: string | null; author: { id: number; handle: string; banned?: 0 | 1 } | null; hidden: 0 | 1 | boolean } | null
}
export const adminReports = (status: AdminFilter) => get<AdminReport[]>(`/admin/reports?status=${status}`)
export const adminAct = (id: number, action: ModerationAction) => post<unknown>(`/admin/reports/${id}`, { action })
export const adminSummary = () => get<{ pending: number }>('/admin/summary')

export type AiSummary = { kind: 'pending' } | { kind: 'undecided'; text: string } | { kind: 'verdict'; verdict: string }
export function aiSummary(r: Pick<AdminReport, 'ai_verdict'>): AiSummary {
  switch (r.ai_verdict) {
    case null: case '': return { kind: 'pending' }
    case 'escalate': case 'error': return { kind: 'undecided', text: 'AI could not decide' }
    case 'refused': return { kind: 'undecided', text: 'AI refused — needs a human' }
    default: return { kind: 'verdict', verdict: r.ai_verdict }
  }
}

export const KIND_LABEL: Record<ReportKind, string> = { post: 'Post', outline: NOUN.One, user: 'User' }
export const isReportKind = (s: string): s is ReportKind => s === 'post' || s === 'outline' || s === 'user'
