import { useEffect, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { checkInvites, configureInvites, invitesWaiting, noteInvitesCount, noteInvitesWaiting, onInviteNews, onInvitesWaiting } from '../lib/inviteNotice'
import { loadFriendsCached } from '../lib/friends'
import { inviteToastText } from '../lib/inviteNoticePlan'
import { syncInviteTask } from '../lib/inviteTask'
import { onBeat } from './useActivity'
import { useAuth } from '../store/auth'
import { usePref } from '../store/prefs'
import { useToast } from '../store/toast'

/**
 * Friend invites while the app is open (heartbeats and the app coming forward: `lib/inviteNotice.ts`) and the
 * background check's registration (`lib/inviteTask.ts`, native only). Mount once, under the toast provider.
 */
export function useInviteNotice() {
  const { user } = useAuth()
  const notify = usePref('inviteNotify')
  // the background task also tops up the verse-of-the-day queue, so it runs while the switch or any verse item is on
  const verseOn = usePref('verseNotify').items.length > 0
  const toast = useToast()
  const uid = user?.id ?? null

  useEffect(() => {
    configureInvites({ uid, notify })
    // the first check on a device only takes note of what is waiting; later ones find what is new
    if (uid === null) return
    void checkInvites(true)
    // the count for Settings before any screen or heartbeat has said it (Home's read shares this one)
    loadFriendsCached().then(o => { if (invitesWaiting() === 0) noteInvitesCount(o.incoming.length) }).catch(() => {})
  }, [uid, notify])

  useEffect(() => { syncInviteTask((uid !== null && notify) || verseOn).catch(() => {}) }, [uid, notify, verseOn])

  useEffect(() => onBeat(r => noteInvitesWaiting(r.incoming_invites)), [])

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void checkInvites() })
    return () => sub.remove()
  }, [])

  useEffect(() => onInviteNews(fresh => { const t = notify ? inviteToastText(fresh) : null; if (t) toast.show(t) }), [toast, notify])
}

/** Invites waiting for the reader, live: the Friends count on Home and in Settings. */
export const useInvitesWaiting = () => useSyncExternalStore(onInvitesWaiting, invitesWaiting, invitesWaiting)
