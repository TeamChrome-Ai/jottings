/**
 * Weeks begin on the Lord's day (Sunday). Day keys are the reader's local calendar dates, `YYYY-MM-DD`, the same keys
 * streak `days[].date` carries; the arithmetic here reads a key as a plain date, whatever zone the device is in.
 */
const DAY_MS = 86_400_000
export const LORDS_DAY = 'Lord’s day'

const ms = (day: string) => Date.parse(day + 'T00:00:00Z')
const key = (t: number) => new Date(t).toISOString().slice(0, 10)

/** 0 for the Lord's day through 6 for Saturday. */
export const weekdayOf = (day: string): number => new Date(ms(day)).getUTCDay()

/** The seven day keys of the week holding `day`, the Lord's day first. */
export function weekOf(day: string): string[] {
  const start = ms(day) - weekdayOf(day) * DAY_MS
  return Array.from({ length: 7 }, (_, i) => key(start + i * DAY_MS))
}

/** Weekday written out, Sunday as the Lord's day. A `Date` is read in local time, a day key as the date it names. */
export function dayName(d: Date | string, locale?: string): string {
  const utc = typeof d === 'string'
  const date = utc ? new Date(ms(d)) : d
  if ((utc ? date.getUTCDay() : date.getDay()) === 0) return LORDS_DAY
  return date.toLocaleDateString(locale, { weekday: 'long', timeZone: utc ? 'UTC' : undefined })
}

/** One-letter weekday for a day key ("S" for the Lord's day). */
export const dayLetter = (day: string, locale?: string): string =>
  new Date(ms(day)).toLocaleDateString(locale, { weekday: 'narrow', timeZone: 'UTC' })

/** Morning from 5, afternoon from 12, evening from 17, night from 22 (local time). */
export function partOfDay(d: Date): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = d.getHours()
  return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'night'
}

/** Home's date line: "Thursday", or with the reader's name "Thursday evening, Anna". */
export function dayLine(d: Date, name: string, locale?: string): string {
  const day = dayName(d, locale)
  const who = name.trim()
  return who ? `${day} ${partOfDay(d)}, ${who}` : day
}
