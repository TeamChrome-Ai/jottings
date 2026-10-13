import { describe, it, expect } from 'vitest'
import type { StreakInfo } from '@shared/types'
import { EMPTY_LOG, NUDGE_GAP_DAYS, formatTime, parseTime, planReminders, readLog, summarizeStreak, type NudgeLog, type StreakSummary } from '../client/src/lib/reminderPlan'

// local wall-clock times throughout, so the cases hold in any time zone
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi)
const NOON = local(2026, 9, 25, 12)
const EIGHT = { hour: 20, minute: 0 }

const alive = (current: number, todayMet: boolean): StreakSummary => ({ todayMet, current, longest: current, goalMinutes: 10, lastRun: { end: '2026-09-24', length: current } })
const never: StreakSummary = { todayMet: false, current: 0, longest: 0, goalMinutes: 10, lastRun: null }
const lapsed = (end = '2026-09-20', length = 12): StreakSummary => ({ todayMet: false, current: 0, longest: Math.max(length, 12), goalMinutes: 10, lastRun: { end, length } })

const plan = (streak: StreakSummary, now = NOON, log: NudgeLog = EMPTY_LOG, time = EIGHT, enabled = true) =>
  planReminders({ now, enabled, ...time, streak, log })
const times = (r: ReturnType<typeof plan>) => r.fires.map(f => [f.kind, f.at.getTime()])

describe('daily reminder while a streak is alive', () => {
  it('fires today and tomorrow when today is not met and the time is ahead', () => {
    const r = plan(alive(11, false))
    expect(times(r)).toEqual([['daily', local(2026, 9, 25, 20).getTime()], ['daily', local(2026, 9, 26, 20).getTime()]])
    expect(r.fires[0].title).toBe('Keep the streak going')
    expect(r.fires[0].body).toBe('A few minutes of reading keeps today’s streak alive. Day 12 is waiting.')
    // tomorrow's day number depends on today, which is still open
    expect(r.fires[1].body).toBe('A few minutes of reading keeps today’s streak alive.')
  })

  it('skips today once the goal is met, and tomorrow counts on from it', () => {
    const r = plan(alive(12, true))
    expect(times(r)).toEqual([['daily', local(2026, 9, 26, 20).getTime()]])
    expect(r.fires[0].body).toContain('Day 13 is waiting.')
  })

  it('skips today once the time has passed, or is exactly now', () => {
    expect(times(plan(alive(3, false), local(2026, 9, 25, 21)))).toEqual([['daily', local(2026, 9, 26, 20).getTime()]])
    expect(times(plan(alive(3, false), local(2026, 9, 25, 20)))).toEqual([['daily', local(2026, 9, 26, 20).getTime()]])
  })

  it('uses the chosen time and crosses month and year ends', () => {
    expect(times(plan(alive(3, false), local(2026, 12, 31, 9), EMPTY_LOG, { hour: 18, minute: 30 })))
      .toEqual([['daily', local(2026, 12, 31, 18, 30).getTime()], ['daily', local(2027, 1, 1, 18, 30).getTime()]])
  })

  it('schedules nothing when turned off', () => {
    expect(plan(alive(3, false), NOON, EMPTY_LOG, EIGHT, false).fires).toEqual([])
    expect(plan(never, NOON, EMPTY_LOG, EIGHT, false).fires).toEqual([])
  })
})

describe('monthly invitation when no day was ever met', () => {
  it('goes out at the next chosen time and is recorded as pending', () => {
    const r = plan(never)
    expect(times(r)).toEqual([['start', local(2026, 9, 25, 20).getTime()]])
    expect(r.fires[0].title).toBe('Start a streak?')
    expect(r.fires[0].body).toBe('10 minutes a day, and the app keeps count. Today is a good day to begin.')
    expect(r.log.start.pending).toBe(local(2026, 9, 25, 20).getTime())
    expect(times(plan(never, local(2026, 9, 25, 22)))).toEqual([['start', local(2026, 9, 26, 20).getTime()]])
  })

  it('is planned again, not doubled, while still pending', () => {
    const first = plan(never)
    const again = plan(never, local(2026, 9, 25, 15), first.log)
    expect(times(again)).toEqual(times(first))
    expect(again.log).toEqual(first.log)
  })

  it('waits the full gap after one has fired', () => {
    const sent = plan(never).log
    const next = plan(never, local(2026, 9, 26, 12), sent)
    expect(next.fires).toEqual([])
    expect(next.log.start).toMatchObject({ sent: local(2026, 9, 25, 20).getTime(), pending: null })
    expect(plan(never, local(2026, 9, 25 + NUDGE_GAP_DAYS - 1, 12), next.log).fires).toEqual([])
    expect(times(plan(never, local(2026, 9, 25 + NUDGE_GAP_DAYS, 12), next.log))).toEqual([['start', local(2026, 10, 25, 20).getTime()]])
  })

  it('names the reader’s own goal', () => {
    expect(plan({ ...never, goalMinutes: 1 }).fires[0].body).toMatch(/^1 minute a day/)
  })
})

describe('one notice when a streak lapses', () => {
  it('names the run that ended', () => {
    const r = plan(lapsed())
    expect(times(r)).toEqual([['lapse', local(2026, 9, 25, 20).getTime()]])
    expect(r.fires[0].title).toBe('Your streak paused')
    expect(r.fires[0].body).toBe('You read 12 days in a row. Pick it up where you left off.')
    expect(r.log.lapse).toMatchObject({ pending: local(2026, 9, 25, 20).getTime(), pendingRun: '2026-09-20' })
    expect(plan(lapsed('2026-09-20', 1)).fires[0].body).toBe('Pick it up where you left off.')
  })

  it('is sent once per lapse, however long the reader stays away', () => {
    const sent = plan(never, local(2026, 9, 26, 12), plan(lapsed()).log).log
    expect(sent.lapse).toMatchObject({ sentRun: '2026-09-20', pending: null })
    expect(plan(lapsed(), local(2027, 3, 1, 12), sent).fires).toEqual([])
  })

  it('waits the full gap before the next lapse gets its notice', () => {
    const sent = plan(lapsed(), local(2026, 9, 26, 12), plan(lapsed()).log).log
    expect(plan(lapsed('2026-10-05', 4), local(2026, 10, 10, 12), sent).fires).toEqual([])
    expect(times(plan(lapsed('2026-10-05', 4), local(2026, 10, 25, 12), sent))).toEqual([['lapse', local(2026, 10, 25, 20).getTime()]])
  })
})

describe('mid-streak', () => {
  it('schedules neither monthly notice and drops a pending one', () => {
    const pending = plan(never).log
    const r = plan(alive(1, true), local(2026, 9, 25, 15), pending)
    expect(r.fires.map(f => f.kind)).toEqual(['daily'])
    expect(r.log.start).toEqual({ sent: null, pending: null, sentRun: null, pendingRun: null })
  })
})

describe('summarizeStreak', () => {
  const info = (over: Partial<StreakInfo>): StreakInfo => ({ current: 0, longest: 0, today_active_seconds: 0, today_goal_seconds: 600, days: [], ...over })
  const day = (date: string, met: 0 | 1, pages = 0) => ({ date, active_seconds: met ? 600 : 30, pages, met })

  it('reads today’s goal from the minutes or the server’s met flag', () => {
    expect(summarizeStreak(info({ today_active_seconds: 600 }), '2026-09-25').todayMet).toBe(true)
    expect(summarizeStreak(info({ today_active_seconds: 30 }), '2026-09-25').todayMet).toBe(false)
    // a credited chapter meets the day on the server with fewer minutes than the goal
    expect(summarizeStreak(info({ today_active_seconds: 30, days: [{ date: '2026-09-25', active_seconds: 30, pages: 1, met: 1 }] }), '2026-09-25').todayMet).toBe(true)
  })

  it('finds the most recent run of met days', () => {
    const s = summarizeStreak(info({ longest: 9, days: [day('2026-09-22', 0), day('2026-09-21', 1), day('2026-09-19', 1), day('2026-09-20', 1), day('2026-09-15', 1)] }), '2026-09-25')
    expect(s.lastRun).toEqual({ end: '2026-09-21', length: 3 })
    expect(s.goalMinutes).toBe(10)
    expect(summarizeStreak(info({ days: [day('2026-09-22', 0)] }), '2026-09-25').lastRun).toBeNull()
  })
})

describe('time entry', () => {
  it('parses what people type and rejects what is not a time', () => {
    expect(parseTime('18:30')).toEqual({ hour: 18, minute: 30 })
    expect(parseTime(' 8:05 ')).toEqual({ hour: 8, minute: 5 })
    expect(parseTime('1830')).toEqual({ hour: 18, minute: 30 })
    expect(parseTime('830')).toEqual({ hour: 8, minute: 30 })
    for (const bad of ['24:00', '12:60', '7', 'ab:cd', '', '18:3']) expect(parseTime(bad)).toBeNull()
    expect(formatTime(8, 5)).toBe('08:05')
  })

  it('reads a stored log of any shape without throwing', () => {
    expect(readLog(null)).toEqual(EMPTY_LOG)
    expect(readLog({ start: { sent: 'x', pending: 5 }, lapse: 3 })).toEqual({ start: { sent: null, pending: 5, sentRun: null, pendingRun: null }, lapse: EMPTY_LOG.lapse })
  })
})
