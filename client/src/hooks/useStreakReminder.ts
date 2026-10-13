import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { router } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { getToken } from '../lib/api'
import { REMINDER_ROUTE, askNotifyPermission, configureReminder, notifyPermission, reschedule } from '../lib/streakReminder'
import { REACTIONS_ROUTE, noteUnseenReactions } from '../lib/reactionNotice'
import { INVITES_ROUTE } from '../lib/inviteNotify'
import { VERSE_ROUTE_PREFIX } from '../lib/verseNotifyPlan'
import { onBeat } from './useActivity'
import { useAuth } from '../store/auth'
import { usePref } from '../store/prefs'
import { fetchStats } from './useStreakAlive'

const refreshStats = () => { if (getToken()) fetchStats().catch(() => {}) }

/**
 * Keeps the streak notifications in step with the app: the pref and sign-in go to the scheduler, the app coming
 * forward refreshes the streak (which reschedules), and a tapped notification opens the Read tab (a verse of the day
 * its chapter). Mount once, under the navigator; the web build uses `useStreakReminder.web.ts`.
 */
export function useStreakReminder() {
  const { user } = useAuth()
  const pref = usePref('streakReminder')
  const signedIn = !!user
  const asked = useRef(false)

  useEffect(() => {
    configureReminder({ ...pref, signedIn })
    if (signedIn) refreshStats()
  }, [pref, signedIn])

  // on by default: a signed-in reader is asked once, and only while the system has no answer yet
  useEffect(() => {
    if (!signedIn || !pref.enabled || asked.current) return
    asked.current = true
    notifyPermission().then(p => { if (p === 'undetermined') return askNotifyPermission().then(() => reschedule()) }).catch(() => {})
  }, [signedIn, pref.enabled])

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') { void reschedule(); refreshStats() } })
    return () => sub.remove()
  }, [])

  // a friend's reaction noticed while reading: one quiet notice, under the same switch as the reminder
  useEffect(() => onBeat(r => { void noteUnseenReactions(r.unseen_reactions ?? 0) }), [])

  useEffect(() => {
    const open = (r: Notifications.NotificationResponse | null) => {
      const url = r?.notification.request.content.data?.url
      // the verse of the day carries its chapter route (`verseNotifyPlan.ts`); the others are fixed
      const verse = typeof url === 'string' && url.startsWith(VERSE_ROUTE_PREFIX)
      if (!verse && url !== REMINDER_ROUTE && url !== REACTIONS_ROUTE && url !== INVITES_ROUTE) return
      Notifications.clearLastNotificationResponse()
      router.navigate(url)
    }
    // a cold start from a tap: the response is waiting before any listener exists
    open(Notifications.getLastNotificationResponse())
    const sub = Notifications.addNotificationResponseReceivedListener(open)
    return () => sub.remove()
  }, [])
}
