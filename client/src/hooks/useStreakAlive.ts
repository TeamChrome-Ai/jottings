import { useEffect, useSyncExternalStore } from 'react'
import type { Stats, StreakInfo } from '@shared/types'
import { cachedGet, getToken } from '../lib/api'
import { useAuth } from '../store/auth'
import { onBeat } from './useActivity'
import { noteStreak } from '../lib/streakReminder'
import { localDay, streakToday, withTz } from '../lib/localDay'
import { noteWidgetStreak } from '../widgets'

/**
 * Whether the signed-in reader's streak is alive: today or yesterday met the goal, both the device's own calendar
 * days (`streakToday`). One boolean outside React, fed by every /stats read and every reader heartbeat, so the one tab icon that
 * reads it re-renders only when it flips.
 */
let alive = false
const listeners = new Set<() => void>()
function set(v: boolean) {
  if (v === alive) return
  alive = v
  listeners.forEach(l => l())
}
/** Also hands the streak to the reminders, which reschedule against it, and to the home-screen widget (sign-out clears that one itself). */
export const publishStreak = (s: StreakInfo | null | undefined) => { set(!!s && streakToday(s, localDay()).alive); noteStreak(s); if (s) noteWidgetStreak(s) }

/** GET /stats (with the device's offset) through the shared read cache, publishing the streak; a reply for a token since replaced is not published. */
export function fetchStats(): Promise<Stats> {
  const token = getToken()
  return cachedGet<Stats>(withTz('/stats')).then(s => { if (getToken() === token) publishStreak(s.streak); return s })
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const snapshot = () => alive

/** Reads the flag; the first reader of a signed-in session fetches /stats once (shared with Home's own read). */
export function useStreakAlive(): boolean {
  const { user } = useAuth()
  const uid = user?.id
  useEffect(() => {
    if (!uid) { publishStreak(null); return }
    fetchStats().catch(() => {})
    return onBeat(r => publishStreak(r.streak))
  }, [uid])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
