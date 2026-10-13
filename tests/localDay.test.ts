// The reader's own day, pinned to Denver (UTC-6 in summer, UTC-7 in winter). Vitest runs each file in its own process,
// and Node re-reads TZ when it is assigned, so this does not reach the other files.
process.env.TZ = 'America/Denver'
import { describe, it, expect } from 'vitest'
import type { StreakInfo } from '@shared/types'
import { localDay, shiftDay, streakToday, tzOffsetMin, withTz } from '../client/src/lib/localDay'
import { EMPTY_LOG, planReminders, summarizeStreak } from '../client/src/lib/reminderPlan'

// 20:30 on Saturday 26 September in Denver is already 02:30 on the Lord's day in UTC
const EVENING = new Date('2026-09-27T02:30:00Z')

describe('localDay', () => {
  it('is the device’s calendar date, not the UTC one', () => {
    expect(EVENING.toISOString().slice(0, 10)).toBe('2026-09-27')
    expect(localDay(EVENING)).toBe('2026-09-26')
    expect(localDay(new Date('2026-09-26T06:30:00Z'))).toBe('2026-09-26') // 00:30 local
    expect(localDay(new Date('2026-09-26T05:59:00Z'))).toBe('2026-09-25') // 23:59 local
    expect(localDay(new Date(2027, 0, 1, 0, 0))).toBe('2027-01-01')
  })

  it('sends the offset as minutes east of UTC', () => {
    expect(tzOffsetMin(EVENING)).toBe(-360)
    expect(tzOffsetMin(new Date('2026-01-15T12:00:00Z'))).toBe(-420)
    // UTC itself goes out as 0, never -0
    expect(Object.is(tzOffsetMin({ getTimezoneOffset: () => 0 } as Date), 0)).toBe(true)
    expect(tzOffsetMin({ getTimezoneOffset: () => -600 } as Date)).toBe(600) // Sydney
    expect(withTz('/stats', EVENING)).toBe('/stats?tz=-360')
    expect(withTz('/stats/calendar?from=2026-01-01', EVENING)).toBe('/stats/calendar?from=2026-01-01&tz=-360')
  })

  it('shifts day keys across month, year and leap day', () => {
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29')
    // the clock change weekend in Denver has no effect on key arithmetic
    expect(shiftDay('2026-11-01', 1)).toBe('2026-11-02')
  })
})

const day = (date: string, met: 0 | 1 = 1) => ({ date, active_seconds: met ? 700 : 40, pages: 0, met })
const info = (over: Partial<StreakInfo>): StreakInfo => ({ current: 0, longest: 0, today_active_seconds: 0, today_goal_seconds: 600, days: [], ...over })

describe('streakToday', () => {
  it('takes the server’s figures when they describe the device’s day', () => {
    const s = info({ today: '2026-09-26', current: 4, today_active_seconds: 300, days: [day('2026-09-26', 0), day('2026-09-25'), day('2026-09-24'), day('2026-09-23'), day('2026-09-22')] })
    expect(streakToday(s, '2026-09-26')).toEqual({ current: 4, todayMet: false, todaySeconds: 300, alive: true })
  })

  it('re-judges stats read before midnight and looked at after it', () => {
    // read at 23:50 on the 25th with the 25th met: the next morning the streak still runs, today is empty
    const met = info({ today: '2026-09-25', current: 3, today_active_seconds: 700, days: [day('2026-09-25'), day('2026-09-24'), day('2026-09-23')] })
    expect(streakToday(met, '2026-09-26')).toEqual({ current: 3, todayMet: false, todaySeconds: 0, alive: true })
    // the 25th left unmet: by the 26th the run has ended
    const unmet = info({ today: '2026-09-25', current: 2, today_active_seconds: 40, days: [day('2026-09-25', 0), day('2026-09-24'), day('2026-09-23')] })
    expect(streakToday(unmet, '2026-09-26')).toMatchObject({ current: 0, alive: false })
  })

  it('keeps a run credited to a day ahead of the device (a flight west)', () => {
    const s = info({ today: '2026-09-27', current: 2, days: [day('2026-09-27'), day('2026-09-26')] })
    expect(streakToday(s, '2026-09-26')).toMatchObject({ current: 2, alive: true, todayMet: true })
  })

  it('reads a server without `today` as describing the device’s day', () => {
    expect(streakToday(info({ current: 5, today_active_seconds: 600 }), '2026-09-26')).toEqual({ current: 5, todayMet: true, todaySeconds: 600, alive: true })
  })
})

describe('the evening reminder in Denver', () => {
  // the reader met the 25th (local) and has not read on the 26th; stats read at 19:30 local with the offset
  const stats = info({ today: '2026-09-26', current: 6, longest: 6, today_active_seconds: 0, days: [day('2026-09-25'), day('2026-09-24'), day('2026-09-23'), day('2026-09-22'), day('2026-09-21'), day('2026-09-20')] })
  const at1930 = new Date('2026-09-27T01:30:00Z')

  it('fires at 20:00 on the local day the goal is still open, though UTC has rolled over', () => {
    const plan = planReminders({ now: at1930, enabled: true, hour: 20, minute: 0, streak: summarizeStreak(stats, localDay(at1930)), log: EMPTY_LOG })
    expect(plan.fires.map(f => [f.kind, f.at.toISOString()])).toEqual([
      ['daily', '2026-09-27T02:00:00.000Z'], // 20:00 on the 26th in Denver
      ['daily', '2026-09-28T02:00:00.000Z'],
    ])
    expect(plan.fires[0].body).toContain('Day 7 is waiting.')
  })

  it('skips tonight once the local day is met', () => {
    const met = { ...stats, today_active_seconds: 650, days: [day('2026-09-26'), ...stats.days] }
    const plan = planReminders({ now: at1930, enabled: true, hour: 20, minute: 0, streak: summarizeStreak({ ...met, current: 7 }, localDay(at1930)), log: EMPTY_LOG })
    expect(plan.fires.map(f => f.at.toISOString())).toEqual(['2026-09-28T02:00:00.000Z'])
  })

  it('judged on the UTC date instead, the same stats would have read as a lapse', () => {
    // what the app did before: "today" was 2026-09-27, so yesterday (the 26th) unmet ended the run
    expect(streakToday({ ...stats }, '2026-09-27').current).toBe(0)
  })
})
