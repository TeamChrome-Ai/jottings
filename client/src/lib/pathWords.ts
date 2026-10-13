/**
 * The words the path surfaces share (Home's card, the Paths screen, a group's page), and the calendar arithmetic
 * behind the "Finish by" picker. Exact and plain (docs/PATHS.md rule 2): a count, a day, "on track" / "2 ahead" /
 * "5 behind", never "about". Pure; tested in tests/pathStrip.test.ts.
 */
import { BOOKS } from '@shared/books'
import { dayOf, type Portion, type Progress, type Standing } from '@shared/paths'

/** "Mark 4". */
export const portionTitle = (p: Portion): string => `${BOOKS[p.book - 1]?.name ?? '?'} ${p.chapter}`
/** The ministry courtesy under a portion: "then Darby on Mark 4" / "then Coates on Mark 4"; null when the portion stands alone. */
export function thenLine(p: Portion): string | null {
  const t = p.then?.[0]
  if (!t) return null
  return `then ${t.author === 'darby' ? 'Darby' : 'Coates'} on ${portionTitle(p)}`
}
/** "12 of 89": the place of the next portion over the length; "89 of 89" once finished. */
export const countWords = (pr: Progress): string => `${pr.position} of ${pr.total}`

/** "on track", "2 ahead", "5 behind"; null without a target. */
export function standingWords(s: Standing | null | undefined): string | null {
  if (!s || s.delta == null) return null
  if (s.delta === 0) return 'on track'
  return s.delta > 0 ? `${s.delta} ahead` : `${-s.delta} behind`
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** "31 Dec", with the year when it is not this year's ("31 Dec 2027"). */
export function fmtTargetDay(day: string, today: string = dayOf()): string {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return day
  return `${d} ${MONTHS[m - 1]}${y === Number(today.slice(0, 4)) ? '' : ` ${y}`}`
}
/**
 * The one line under the count while a target is set: "3 a day to finish by 31 Dec · 2 ahead". Null without a target;
 * "Finished, 3 ahead" style is never needed because a finished path has no pace line (paceNeeded is null then).
 */
export function paceLine(paceNeeded: number | null, standing: Standing | null, target_date: string | null | undefined, today: string = dayOf()): string | null {
  if (!target_date || paceNeeded == null) return null
  const s = standingWords(standing)
  return `${paceNeeded} a day to finish by ${fmtTargetDay(target_date, today)}${s ? ` · ${s}` : ''}`
}
/** The words for a pace with no target: "3 a week". */
export const paceWords = (pace_per_week: number | null | undefined): string | null => pace_per_week ? `${pace_per_week} a week` : null

// ---------------- the calendar ----------------

const pad = (n: number) => String(n).padStart(2, '0')
export const ymd = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`
export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate()
/** The same day of the month `n` months on (clamped to the month's last day): "In a month". */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  const y2 = Math.floor(t / 12), m2 = t % 12 + 1
  return ymd(y2, m2, Math.min(d, daysInMonth(y2, m2)))
}
/** "By the end of the year": 31 December of `today`'s year (of next year when today is that day). */
export function endOfYear(today: string = dayOf()): string {
  const y = Number(today.slice(0, 4))
  const eoy = ymd(y, 12, 31)
  return eoy > today ? eoy : ymd(y + 1, 12, 31)
}
export interface MonthCell { day: string | null; n: number; past: boolean; today: boolean }
/**
 * A month as rows of seven, the Lord's day first (the week strip's order); leading blanks (`day` null) before the 1st,
 * trailing blanks after the last so every row is whole. Days before `today` are `past`.
 */
export function monthGrid(y: number, m: number, today: string = dayOf()): MonthCell[][] {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const n = daysInMonth(y, m)
  const cells: MonthCell[] = []
  for (let i = 0; i < first; i++) cells.push({ day: null, n: 0, past: false, today: false })
  for (let d = 1; d <= n; d++) { const day = ymd(y, m, d); cells.push({ day, n: d, past: day < today, today: day === today }) }
  while (cells.length % 7) cells.push({ day: null, n: 0, past: false, today: false })
  const rows: MonthCell[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  return rows
}
export const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
