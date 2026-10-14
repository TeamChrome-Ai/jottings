import { describe, it, expect } from 'vitest'
import { DAILY_GOALS, DAILY_GOAL_DEFAULT, goalView, readDailyGoal } from '../client/src/lib/dailyGoal'

const STREAK = 600
const min = (m: number, s = 0) => m * 60 + s

describe('the daily goal setting', () => {
  it('offers ten minutes, the streak’s own, and five more above it', () => {
    expect(DAILY_GOALS).toEqual([10, 15, 20, 30, 45, 60])
    expect(DAILY_GOAL_DEFAULT).toBe(10)
  })
  it('reads anything else as ten', () => {
    for (const g of DAILY_GOALS) expect(readDailyGoal(g)).toBe(g)
    for (const v of [undefined, null, '30', 5, 12, 0, -30, 600, NaN, {}, true]) expect(readDailyGoal(v)).toBe(10)
  })
})

describe('today’s progress against the goal', () => {
  it('with the default goal is the streak’s progress, word for word', () => {
    expect(goalView(0, STREAK, 10)).toEqual({ pct: 0, kept: false, left: 0, line: '0m of 10m today' })
    expect(goalView(min(4), STREAK, 10)).toEqual({ pct: 0.4, kept: false, left: 0, line: '4m of 10m today' })
    expect(goalView(min(10), STREAK, 10)).toEqual({ pct: 1, kept: true, left: 0, line: '10m of 10m today' })
    expect(goalView(min(75), STREAK, 10)).toEqual({ pct: 1, kept: true, left: 0, line: '1h 15m of 10m today' })
    // a server that sends no figure: no bar and no check, as before
    expect(goalView(min(4), 0, 10)).toEqual({ pct: 0, kept: false, left: 0, line: '4m of 0m today' })
  })
  it('under the streak’s ten minutes shows the same, whatever the goal', () => {
    for (const g of DAILY_GOALS) for (const secs of [0, 45, min(4), min(9, 59)]) expect(goalView(secs, STREAK, g)).toEqual(goalView(secs, STREAK, 10))
  })
  it('from ten minutes to the goal says the streak is kept and how far there is to go', () => {
    expect(goalView(min(10), STREAK, 30)).toEqual({ pct: 1 / 3, kept: true, left: 20, line: 'Streak kept. 10 of 30 min' })
    expect(goalView(min(12), STREAK, 30)).toEqual({ pct: 0.4, kept: true, left: 18, line: 'Streak kept. 12 of 30 min' })
    // whole minutes read and whole minutes left: never "30 of 30" or "0 left" before the goal
    expect(goalView(min(29, 59), STREAK, 30)).toMatchObject({ kept: true, left: 1, line: 'Streak kept. 29 of 30 min' })
    expect(goalView(min(59, 1), STREAK, 60)).toMatchObject({ left: 1, line: 'Streak kept. 59 of 60 min' })
    expect(goalView(min(10), STREAK, 15)).toMatchObject({ pct: 2 / 3, left: 5, line: 'Streak kept. 10 of 15 min' })
  })
  it('at the goal is complete', () => {
    expect(goalView(min(30), STREAK, 30)).toEqual({ pct: 1, kept: true, left: 0, line: 'Daily goal met. 30m today' })
    expect(goalView(min(75), STREAK, 60)).toEqual({ pct: 1, kept: true, left: 0, line: 'Daily goal met. 1h 15m today' })
  })
  it('never changes whether the day is kept: that is the streak’s figure alone', () => {
    for (const g of DAILY_GOALS) for (const secs of [0, 599, 600, 601, min(20), min(90)]) expect(goalView(secs, STREAK, g).kept).toBe(secs >= STREAK)
  })
  it('never fills the bar past full or lets it run backwards on the way to the goal', () => {
    for (const g of DAILY_GOALS) {
      let last = 0
      for (let secs = STREAK; secs <= min(70); secs += 30) {
        const { pct } = goalView(secs, STREAK, g)
        expect(pct).toBeGreaterThanOrEqual(last)
        expect(pct).toBeLessThanOrEqual(1)
        last = pct
      }
    }
  })
  it('is the streak’s own progress where the server’s figure is at or above the goal', () => {
    expect(goalView(min(20), 1800, 30)).toEqual({ pct: 2 / 3, kept: false, left: 0, line: '20m of 30m today' })
    expect(goalView(min(31), 1800, 30)).toEqual({ pct: 1, kept: true, left: 0, line: '31m of 30m today' })
  })
})
