import type { StreakInfo } from '@shared/types'
import { t, tn } from '@shared/i18n'
import { shiftDay, streakToday } from './localDay'

/**
 * What the streak notifications should be, as a pure decision: no clock, no storage, no notification API. A
 * scheduled notification cannot look at the streak when it fires, so the caller throws the whole plan away and
 * applies a fresh one whenever anything it depends on may have changed.
 */

/** The streak as the reminders need it; `summarizeStreak` builds it from /stats or a heartbeat. */
export interface StreakSummary {
  /** The device's day has met the goal: its minutes. */
  todayMet: boolean
  current: number
  longest: number
  goalMinutes: number
  /** The most recent run of met days: its last day (YYYY-MM-DD, reader-local) and its length; null when no day was ever met. */
  lastRun: { end: string; length: number } | null
}

/** One monthly notice: `sent` is a fire time already past, `pending` one still scheduled (epoch ms). */
export interface NudgeEntry { sent: number | null; pending: number | null; sentRun: string | null; pendingRun: string | null }
/** Kept on the device so a reschedule or a restart never repeats a monthly notice. */
export interface NudgeLog { start: NudgeEntry; lapse: NudgeEntry }
export const EMPTY_NUDGE: NudgeEntry = { sent: null, pending: null, sentRun: null, pendingRun: null }
export const EMPTY_LOG: NudgeLog = { start: EMPTY_NUDGE, lapse: EMPTY_NUDGE }

export type FireKind = 'daily' | 'start' | 'lapse'
export interface Fire { kind: FireKind; at: Date; title: string; body: string }

export interface PlanInput {
  now: Date
  enabled: boolean
  hour: number
  minute: number
  streak: StreakSummary
  log: NudgeLog
}

/** A monthly notice waits at least this many calendar days after the last one of its kind. */
export const NUDGE_GAP_DAYS = 30
export const REMINDER_PRESETS = ['17:00', '19:00', '20:00', '21:00'] as const

const DAY_MS = 86_400_000

/**
 * The streak as of `today`, the device's calendar day (`localDay()`), whichever day the stats were read on.
 * `days` rows come newest first from the server, but nothing here relies on the order.
 */
export function summarizeStreak(s: StreakInfo, today: string): StreakSummary {
  const metDays = s.days.filter(d => d.met === 1).map(d => d.date).sort().reverse()
  const { todayMet, current } = streakToday(s, today)
  let lastRun: StreakSummary['lastRun'] = null
  if (metDays.length) {
    let length = 1
    while (length < metDays.length && metDays[length] === shiftDay(metDays[0], -length)) length++
    lastRun = { end: metDays[0], length }
  }
  return { todayMet, current, longest: Math.max(s.longest, current), goalMinutes: Math.max(1, Math.round(s.today_goal_seconds / 60)), lastRun }
}

/**
 * The notifications to schedule from `now` on, and the monthly log to store.
 *
 * - Mid-streak (`current` > 0): a daily reminder today at the chosen time if that is still ahead and today's goal is
 *   not met, and always one tomorrow (the next reschedule drops it if the day gets met first).
 * - Never met a day: an invitation to start, at most once per `NUDGE_GAP_DAYS`.
 * - A streak that lapsed: one notice per lapse, and never within `NUDGE_GAP_DAYS` of the previous one.
 *
 * Monthly notices go out at the next chosen time. One that fired is `sent`; one still ahead stays `pending` and is
 * planned again (or dropped) on every call, so a reschedule neither repeats it nor loses it.
 */
export function planReminders({ now, enabled, hour, minute, streak, log }: PlanInput): { fires: Fire[]; log: NudgeLog } {
  const ms = now.getTime()
  const settled: NudgeLog = { start: settle(log.start, ms), lapse: settle(log.lapse, ms) }
  const drop = (e: NudgeEntry): NudgeEntry => ({ ...e, pending: null, pendingRun: null })
  const idle = { start: drop(settled.start), lapse: drop(settled.lapse) }
  if (!enabled) return { fires: [], log: idle }

  const today = at(now, 0, hour, minute), tomorrow = at(now, 1, hour, minute)
  const next = today.getTime() > ms ? today : tomorrow

  if (streak.current > 0) {
    const fires: Fire[] = []
    if (today.getTime() > ms && !streak.todayMet) fires.push(daily(today, streak.current + 1))
    fires.push(daily(tomorrow, streak.todayMet ? streak.current + 1 : null))
    return { fires, log: idle }
  }

  if (!streak.lastRun && streak.longest === 0) {
    const e = settled.start
    if (!due(e.sent, next)) return { fires: [], log: idle }
    const m = streak.goalMinutes
    return {
      fires: [{ kind: 'start', at: next, title: t('Start a streak?'), body: tn(m, '{n} minute a day, and the app keeps count. Today is a good day to begin.', '{n} minutes a day, and the app keeps count. Today is a good day to begin.') }],
      log: { start: { ...e, pending: next.getTime() }, lapse: idle.lapse },
    }
  }

  const e = settled.lapse
  const run = streak.lastRun
  if ((run && e.sentRun === run.end) || !due(e.sent, next)) return { fires: [], log: idle }
  const n = run?.length ?? 0
  return {
    fires: [{ kind: 'lapse', at: next, title: t('Your streak paused'), body: n > 1 ? t('You read {n} days in a row. Pick it up where you left off.', { n }) : t('Pick it up where you left off.') }],
    log: { start: idle.start, lapse: { ...e, pending: next.getTime(), pendingRun: run?.end ?? null } },
  }
}

function daily(when: Date, day: number | null): Fire {
  return { kind: 'daily', at: when, title: t('Keep the streak going'), body: day ? t('A few minutes of reading keeps today’s streak alive. Day {day} is waiting.', { day }) : t('A few minutes of reading keeps today’s streak alive.') }
}

/** A pending notice whose time has passed has fired. */
function settle(e: NudgeEntry, t: number): NudgeEntry {
  return e.pending !== null && e.pending <= t ? { sent: e.pending, pending: null, sentRun: e.pendingRun, pendingRun: null } : e
}

/** Calendar days in local time, so a clock change between the two dates does not shorten the gap. */
function due(sent: number | null, next: Date): boolean {
  if (sent === null) return true
  const a = new Date(sent), days = Math.round((dayStart(next) - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / DAY_MS)
  return days >= NUDGE_GAP_DAYS
}
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** Local wall-clock time `offset` days from `now`; built from fields so a clock change keeps the chosen time. */
function at(now: Date, offset: number, hour: number, minute: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, minute, 0, 0)
}

/** `18:30`, `8:05`, `1830` or `830`; null when it is not a time of day. */
export function parseTime(text: string): { hour: number; minute: number } | null {
  const m = text.trim().match(/^(\d{1,2}):?(\d{2})$/)
  if (!m) return null
  const hour = Number(m[1]), minute = Number(m[2])
  return hour < 24 && minute < 60 ? { hour, minute } : null
}
export const formatTime = (hour: number, minute: number) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

/** A stored log that is missing or from an older shape reads as empty rather than blocking or repeating notices. */
export function readLog(raw: unknown): NudgeLog {
  const entry = (v: unknown): NudgeEntry => {
    if (!v || typeof v !== 'object') return EMPTY_NUDGE
    const o = v as Record<string, unknown>
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
    const str = (x: unknown) => (typeof x === 'string' ? x : null)
    return { sent: num(o.sent), pending: num(o.pending), sentRun: str(o.sentRun), pendingRun: str(o.pendingRun) }
  }
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return { start: entry(o.start), lapse: entry(o.lapse) }
}
