import { AppState } from 'react-native'
import { get } from './api'
import { checkInvitesOnce, noteInvitesSeen } from './inviteMark'
import { notifyAllowed, postInviteNotices } from './inviteNotify'
import type { IncomingReply, InviteLite } from './inviteNoticePlan'

/**
 * Friend invites noticed while the app is open, on the path the reactions notice takes: every reader heartbeat
 * reports how many invites are waiting, and a larger number than last time (or the app coming forward) asks
 * `GET /friends/invites/incoming` for the new ones. In the foreground they are a quiet toast (`onInviteNews`, shown by
 * `useInviteNotice`) and the Friends card's count; in the background, a notification on the "Friend invites" channel.
 * The mark they share with the background check (`inviteMark.ts`) announces each invite once.
 */

let uid: number | null = null
let notify = true
let beatCount = 0
let lastCheck = 0
let busy = false
/** A check asked for while one runs: one more pass afterwards, so a heartbeat's news is never dropped. */
let again = false
/** The app coming forward checks at most this often; a heartbeat reporting more invites checks at once. */
const FORWARD_GAP_MS = 60_000

const news = new Set<(fresh: InviteLite[]) => void>()
/** New invites while the app is in the foreground; the listener shows the toast and refreshes lists. */
export const onInviteNews = (l: (fresh: InviteLite[]) => void) => { news.add(l); return () => { news.delete(l) } }

let waiting = 0
const waitingListeners = new Set<() => void>()
/** Invites waiting for the reader, as last heard (a heartbeat, the Friends screen, Home): the Friends count. */
export const invitesWaiting = () => waiting
export const onInvitesWaiting = (l: () => void) => { waitingListeners.add(l); return () => { waitingListeners.delete(l) } }
function setWaiting(n: number) { if (n !== waiting) { waiting = n; waitingListeners.forEach(l => l()) } }

export function configureInvites(c: { uid: number | null; notify: boolean }) {
  if (c.uid !== uid) { beatCount = 0; lastCheck = 0; setWaiting(0) }
  uid = c.uid
  notify = c.notify
}

/** A heartbeat's `incoming_invites`. */
export function noteInvitesWaiting(n: number | undefined) {
  if (typeof n !== 'number') return
  const grew = n > beatCount
  beatCount = n
  setWaiting(n)
  if (grew) void checkInvites(true)
}

/** The count alone, from a read that shows nothing yet (the app starting): nothing is marked seen. */
export function noteInvitesCount(n: number) {
  setWaiting(n)
  beatCount = n
}

/** The invites a screen has shown (the Friends screen, Home's card): the count, and never announced later. */
export function noteInvitesShown(invites: InviteLite[]) {
  setWaiting(invites.length)
  beatCount = invites.length
  if (uid !== null) noteInvitesSeen(uid, invites).catch(() => {})
}

export async function checkInvites(now = false) {
  if (uid === null || (!now && Date.now() - lastCheck < FORWARD_GAP_MS)) return
  if (busy) { again ||= now; return }
  busy = true
  lastCheck = Date.now()
  const me = uid
  try {
    const { fresh } = await checkInvitesOnce(me, path => get<IncomingReply>(path))
    if (!fresh.length || me !== uid) return
    setWaiting(Math.max(waiting, fresh.length))
    if (AppState.currentState === 'active') news.forEach(l => l(fresh))
    else if (notify && (await notifyAllowed())) await postInviteNotices(fresh)
  } catch { /* a notice is never worth an error */ } finally {
    busy = false
    if (again) { again = false; void checkInvites(true) }
  }
}
