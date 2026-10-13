import { useEffect } from 'react'
import { AppState } from 'react-native'
import { askNotifyPermission, notifyPermission } from '../lib/streakReminder'
import { onPathChange } from '../lib/paths'
import { configureVerseNotify, rescheduleVerseNotify } from '../lib/verseNotify'
import { usePref } from '../store/prefs'

/**
 * Keeps the verse-of-the-day notifications in step with the app: the pref goes to the scheduler, and the app coming
 * forward rebuilds the queue (a new day, a new time zone), and so does any change of the reader's path (a start, a
 * switch, a chapter credited on this device or by the server), so a "Your path" item names the chapter that is really
 * next. Needs no account. Mount once, under the navigator; taps are routed by `useStreakReminder`, which owns the
 * response listener. The web build uses `useVerseNotify.web.ts`.
 */
export function useVerseNotify() {
  const pref = usePref('verseNotify')

  useEffect(() => { configureVerseNotify(pref) }, [pref])
  // a rebuild that changes nothing is skipped inside (the plan is keyed), so this costs one comparison per change
  useEffect(() => onPathChange(() => { void rescheduleVerseNotify() }), [])

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void rescheduleVerseNotify() })
    return () => sub.remove()
  }, [])
}
