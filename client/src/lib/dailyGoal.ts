/**
 * The reader's own daily goal (tests/dailyGoal.test.ts). A day counts for the streak at the server's figure, ten
 * minutes, the same for everyone; a reader may set themselves more. The goal is kept on this device and changes only
 * what the reader's own screens show: it is never sent, and the streak, the reminder, badges, friends and groups all
 * go by the server's figure.
 */
import { fmtDuration } from './format'

/** Minutes a day. The first is the streak's own: with it nothing is shown differently. */
export const DAILY_GOALS = [10, 15, 20, 30, 45, 60] as const
export type DailyGoal = typeof DAILY_GOALS[number]
export const DAILY_GOAL_DEFAULT: DailyGoal = 10
export const readDailyGoal = (v: unknown): DailyGoal => (DAILY_GOALS.includes(v as DailyGoal) ? v as DailyGoal : DAILY_GOAL_DEFAULT)

export interface GoalView {
  /** The bar, 0 to 1: toward the streak's minutes until the day is kept, then toward the reader's own. */
  pct: number
  /** The day counts for the streak. */
  kept: boolean
  /** Whole minutes still to read for the reader's own goal, counted only once the day is kept; 0 when it is met or there is none. */
  left: number
  line: string
}

/**
 * Today's progress as the reader sees it: `secs` read today, `streakSecs` the server's figure for a kept day, `goal`
 * the reader's minutes. Until the day is kept, and always with the default goal, it is the streak's progress as it has
 * always been shown; from there to the reader's own goal the day reads as kept with the distance left; then as done.
 */
export function goalView(secs: number, streakSecs: number, goal: number): GoalView {
  const kept = streakSecs > 0 && secs >= streakSecs
  const own = goal > DAILY_GOAL_DEFAULT ? goal * 60 : 0
  if (!kept || own <= streakSecs) return { pct: streakSecs ? Math.min(1, secs / streakSecs) : 0, kept, left: 0, line: `${fmtDuration(secs)} of ${fmtDuration(streakSecs)} today` }
  if (secs >= own) return { pct: 1, kept, left: 0, line: `Daily goal met. ${fmtDuration(secs)} today` }
  // whole minutes read, so the line never says "30 of 30" before the bar is full
  return { pct: secs / own, kept, left: Math.ceil((own - secs) / 60), line: `Streak kept. ${Math.floor(secs / 60)} of ${goal} min` }
}
