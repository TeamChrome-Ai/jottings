import type { StreakInfo } from '@shared/types'

/**
 * Reading days are the reader's own calendar days, read off the device clock. Every beat carries the device's date and
 * UTC offset; the stats reads carry the offset, so the server's "today" is this device's today (docs/API.md, Activity).
 */

/** The device's calendar date, `YYYY-MM-DD`, from the local getters (never `toISOString`, which is the UTC date). */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Minutes EAST of UTC, the sign the API uses: Denver in summer is -360, Sydney in winter +600. JavaScript's
 * `getTimezoneOffset()` counts the other way (Denver +360); `|| 0` keeps UTC from being sent as -0.
 */
export const tzOffsetMin = (d: Date = new Date()): number => -d.getTimezoneOffset() || 0

/** Calendar arithmetic on a day key; no clock or zone involved. */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** A stats read path with the device's offset, so the server judges today by this device's day. */
export const withTz = (path: string, d: Date = new Date()): string => `${path}${path.includes('?') ? '&' : '?'}tz=${tzOffsetMin(d)}`

export interface StreakToday {
  /** Days in the running streak as of `today`. */
  current: number
  /** `today` has met the goal: its minutes. */
  todayMet: boolean
  /** Active seconds on `today`. */
  todaySeconds: number
  /** The streak still runs: `today` or the day before met the goal. */
  alive: boolean
}

/**
 * The streak as of `today` (the device's day). The server's own figures describe `s.today`; while that is the same day
 * they are used as sent. Stats from an earlier day (read before midnight, looked at after it) are re-judged from the
 * met days, so a streak whose last day was yesterday's yesterday reads as over and today's minutes start from zero.
 */
export function streakToday(s: StreakInfo, today: string): StreakToday {
  const met = new Set(s.days.filter(d => d.met === 1).map(d => d.date))
  // a server from before versionCode 26 sends no `today`: its figures are taken as describing this day
  const same = (s.today ?? today) === today
  const todaySeconds = same ? s.today_active_seconds : (s.days.find(d => d.date === today)?.active_seconds ?? 0)
  const todayMet = met.has(today) || (same && s.today_goal_seconds > 0 && s.today_active_seconds >= s.today_goal_seconds)
  let current = s.current
  if (!same) {
    // a day credited ahead of this device's day (the device's day went back, as after a flight west) still holds the run
    const ahead = [...met].filter(d => d > today).sort().pop()
    let d = ahead ?? (todayMet ? today : shiftDay(today, -1))
    current = 0
    while (met.has(d)) { current++; d = shiftDay(d, -1) }
  }
  return { current, todayMet, todaySeconds, alive: current > 0 }
}
