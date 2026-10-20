/**
 * Feedback to the site admin (docs/API.md "Feedback") and the admin's supporter flag. Sending works signed out: the
 * shared api client adds the token only when there is one.
 */
import { del, get, patch, post } from './api'
import { N_ } from '@shared/i18n'

/** Same cap as rs/src/feedback.rs MESSAGE_MAX. */
export const MESSAGE_MAX = 2000
/** Same cap as rs/src/feedback.rs DIAGNOSTICS_MAX: the read-aloud log a reader chose to add. */
export const DIAGNOSTICS_MAX = 24_000

export interface FeedbackIn { message: string; email?: string; app_version?: string; platform?: string; diagnostics?: string }

/** The request body: text trimmed, a blank email left out. Null when there is nothing to send. */
export function feedbackBody(message: string, email: string, appVersion: string, platform: string): FeedbackIn | null {
  const m = message.trim()
  if (!m || m.length > MESSAGE_MAX) return null
  const e = email.trim()
  return { message: m, ...(e ? { email: e } : {}), ...(appVersion ? { app_version: appVersion } : {}), platform }
}

/** "1.0.0 (25)": the app version and Android versionCode, for the report (the Settings footer shows the version alone). */
export function appVersionLabel(version: string | undefined, versionCode: number | undefined): string {
  return `${version ?? ''}${versionCode ? ` (${versionCode})` : ''}`.trim()
}

export const sendFeedback = (body: FeedbackIn) => post<{ ok: true; id: number }>('/feedback', body)

export interface FeedbackRow {
  id: number; message: string; email: string | null; app_version: string | null; platform: string | null; created_at: string
  /** The read-aloud log the sender chose to add (lib/readAloudLog.ts). */
  diagnostics?: string | null
  user: { id: number; handle: string } | null
  /** The admin's answer, and whether its sender has been shown it. */
  reply?: string | null; replied_at?: string | null; reply_seen?: boolean
}
/** The one-tap answer (rs/src/feedback.rs THANKS), also the body of the email to a sender without an account. */
export const THANKS = N_('Thank you for this. The fix will be in the next update.')
export const REPLY_MAX = 1000
/** `reaches_sender`: the sender has an account, so the answer waits for them in the app. */
export const replyFeedback = (id: number, body: { thanks: true } | { text: string }) => post<{ ok: true; reaches_sender: boolean }>(`/admin/feedback/${id}/reply`, body)
export interface MyReply { id: number; message: string; created_at: string; reply: string; replied_at: string | null; seen: boolean }
/** The reader's own messages that were answered; `unseen` counts the answers they have not been shown. */
export const myReplies = () => get<{ replies: MyReply[]; unseen: number }>('/feedback/mine')
export const markRepliesSeen = () => post<unknown>('/feedback/mine/seen')
export const adminFeedback = () => get<FeedbackRow[]>('/admin/feedback')
export const deleteFeedback = (id: number) => del<unknown>(`/admin/feedback/${id}`)
/** Site admin: take an account's name away; they are asked for a new one when they next open the app. */
export const forceRename = (userId: number, display_name?: string) => post<{ id: number; handle: string; display_name: string }>(`/admin/users/${userId}/rename`, display_name ? { display_name } : {})
export const setSupporter = (userId: number, supporter: boolean) => patch<{ id: number; handle: string; supporter: boolean }>(`/admin/users/${userId}`, { supporter })
