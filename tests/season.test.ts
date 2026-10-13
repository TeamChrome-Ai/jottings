import { describe, it, expect } from 'vitest'
import { easterSunday, seasonOn } from '../client/src/lib/season'

describe('the seasons the name marks', () => {
  it('finds Easter Sunday', () => {
    expect([2024, 2025, 2026, 2027, 2028, 2038].map(y => { const e = easterSunday(y); return `${y}-${e.month}-${e.day}` }))
      .toEqual(['2024-3-31', '2025-4-20', '2026-4-5', '2027-3-28', '2028-4-16', '2038-4-25'])
  })
  it('marks Good Friday to Easter Monday', () => {
    const on = (m: number, d: number, h = 12) => seasonOn(new Date(2027, m - 1, d, h))
    expect([on(3, 25), on(3, 26), on(3, 27), on(3, 28), on(3, 29), on(3, 30)]).toEqual([null, 'easter', 'easter', 'easter', 'easter', null])
    expect([on(3, 26, 0), on(3, 29, 23)]).toEqual(['easter', 'easter'])
    // Easter in April, and a day in the year's last week is not near it
    expect([seasonOn(new Date(2026, 3, 3)), seasonOn(new Date(2026, 3, 6)), seasonOn(new Date(2026, 3, 7))]).toEqual(['easter', 'easter', null])
  })
  it('marks 18 to 26 December', () => {
    const on = (d: number) => seasonOn(new Date(2026, 11, d))
    expect([on(17), on(18), on(25), on(26), on(27)]).toEqual([null, 'christmas', 'christmas', 'christmas', null])
    expect(seasonOn(new Date(2026, 9, 13))).toBeNull()
  })
})
