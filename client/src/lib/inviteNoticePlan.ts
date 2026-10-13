/**
 * Friend-invite notices as pure decisions: which invites are new to this device, the words for each, and the mark
 * that remembers what has been announced. No clock, no storage, no notification API; `inviteNotice.ts` (the app) and
 * `inviteTask.ts` (the background check) both apply it, so an invite is announced once whichever of them sees it first.
 */

export interface InviteLite { id: number; from: { handle: string; display_name: string }; created_at: string }
/** `GET /friends/invites/incoming`: `open` is false while invites are off (then there are none). */
export interface IncomingReply { open: boolean; now: string; invites: InviteLite[] }

/**
 * Kept on the device. `since` is the newest invite time seen (server clock), the next poll's filter; `ids` are the
 * invites already announced or shown, so one seen by both the app and the background check is announced once. `uid`
 * ties the mark to the account: another reader signing in on the device starts afresh.
 */
export interface InviteMark { uid: number; since: string | null; ids: number[] }
/** Ids kept: far more than the invites that can be waiting at once (50 senders a day each, lapsing in 30 days). */
export const MARK_IDS = 200
/** More new invites than this in one check make one summary notice instead of one each. */
export const NOTICE_EACH_MAX = 3

export const emptyMark = (uid: number): InviteMark => ({ uid, since: null, ids: [] })

/** A stored mark that is missing, damaged or another account's reads as a fresh start. */
export function readMark(raw: unknown, uid: number): InviteMark {
  if (!raw || typeof raw !== 'object') return emptyMark(uid)
  const o = raw as Record<string, unknown>
  if (o.uid !== uid) return emptyMark(uid)
  const ids = Array.isArray(o.ids) ? o.ids.filter((x): x is number => Number.isInteger(x)) : []
  return { uid, since: typeof o.since === 'string' && o.since ? o.since : null, ids: ids.slice(-MARK_IDS) }
}

/** The poll's path: every invite waiting on the first check, only the newer ones after it. */
export const pollPath = (m: InviteMark) => `/friends/invites/incoming${m.since ? `?since=${encodeURIComponent(m.since)}` : ''}`

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : Date.parse(b) > Date.parse(a) ? b : a)

/**
 * The invites to announce from a poll, oldest first, and the mark to keep. The very first check on a device (no
 * `since`) only takes note: what is already waiting shows on the Friends screen and is not news. Later checks
 * announce every invite whose id the mark does not hold.
 */
export function takeFresh(reply: IncomingReply, mark: InviteMark): { fresh: InviteLite[]; mark: InviteMark } {
  const newest = reply.invites.reduce<string | null>((t, i) => later(t, i.created_at), null)
  if (!mark.since) return { fresh: [], mark: noteIds(mark, reply.invites, later(newest, reply.now)) }
  const known = new Set(mark.ids)
  const fresh = reply.invites.filter(i => !known.has(i.id)).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id)
  return { fresh, mark: noteIds(mark, fresh, later(mark.since, newest)) }
}

/** Invites the reader has seen in the app (the Friends screen, Home): never announced afterwards. */
export function markSeen(mark: InviteMark, invites: InviteLite[]): InviteMark {
  const known = new Set(mark.ids)
  const add = invites.filter(i => !known.has(i.id))
  if (!add.length) return mark
  const newest = add.reduce<string | null>((t, i) => later(t, i.created_at), null)
  return noteIds(mark, add, mark.since ? later(mark.since, newest) : null)
}

function noteIds(mark: InviteMark, add: InviteLite[], since: string | null): InviteMark {
  const ids = [...mark.ids, ...add.map(i => i.id).filter(id => !mark.ids.includes(id))].slice(-MARK_IDS)
  return { uid: mark.uid, since, ids }
}

/** The system notification for one invite: "Anna (@anna) wants to be friends". */
export function inviteNoticeText(inv: InviteLite): { title: string; body: string } {
  const name = inv.from.display_name.trim() || inv.from.handle
  return { title: `${name} (@${inv.from.handle}) wants to be friends`, body: 'Accept or decline in Friends' }
}
/** One notice for a burst of invites. */
export function inviteSummaryText(n: number): { title: string; body: string } {
  return { title: `${n} friend invites`, body: 'Accept or decline in Friends' }
}

/** The notices to post for `fresh`: one each up to NOTICE_EACH_MAX, else one summary. */
export function planNotices(fresh: InviteLite[]): { key: string; title: string; body: string }[] {
  if (!fresh.length) return []
  if (fresh.length > NOTICE_EACH_MAX) return [{ key: `friend-invites-${fresh[fresh.length - 1].id}`, ...inviteSummaryText(fresh.length) }]
  return fresh.map(i => ({ key: `friend-invite-${i.id}`, ...inviteNoticeText(i) }))
}

/** The in-app toast, short: "Anna invited you", "3 friend invites". */
export function inviteToastText(fresh: InviteLite[]): string | null {
  if (!fresh.length) return null
  if (fresh.length > 1) return `${fresh.length} friend invites`
  const f = fresh[0].from
  return `${(f.display_name.trim() || f.handle).split(/\s+/)[0]} invited you`
}
