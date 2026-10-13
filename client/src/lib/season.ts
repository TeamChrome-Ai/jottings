/**
 * The two seasons the name marks (components/Wordmark.tsx): at Easter its "o" is an egg, at Christmas a bauble. Pure,
 * by the reader's own calendar day, so tests/season.test.ts holds the dates.
 */
export type Season = 'easter' | 'christmas'

/** Easter Sunday of a year in the Gregorian calendar (the Western date; Meeus/Jones/Butcher). */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1
  return { month, day }
}

const DAY = 86_400_000
/** Good Friday to Easter Monday; 18 to 26 December. */
export function seasonOn(date: Date): Season | null {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate()
  if (m === 12 && d >= 18 && d <= 26) return 'christmas'
  const e = easterSunday(y)
  // whole days between the two calendar dates, whatever the clock or a daylight-saving change says
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, e.month - 1, e.day)) / DAY)
  return days >= -2 && days <= 1 ? 'easter' : null
}
