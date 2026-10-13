import { describe, it, expect } from 'vitest'
import { LORDS_DAY, dayLetter, dayName, weekOf, weekdayOf } from '../client/src/lib/week'

describe('week', () => {
  it('starts on the Lord’s day', () => {
    expect(weekOf('2026-09-25')).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'])
    expect(weekOf('2026-09-20')[0]).toBe('2026-09-20')
    expect(weekOf('2026-09-26')[6]).toBe('2026-09-26')
    expect(weekOf('2026-01-01')[0]).toBe('2025-12-28')
    expect(weekdayOf('2026-09-20')).toBe(0)
  })

  it('writes Sunday out as the Lord’s day and keeps S in the strip', () => {
    expect(dayName('2026-09-20', 'en-GB')).toBe(LORDS_DAY)
    expect(dayName('2026-09-21', 'en-GB')).toBe('Monday')
    expect(dayName(new Date(2026, 8, 20, 12), 'en-GB')).toBe(LORDS_DAY)
    expect(dayLetter('2026-09-20', 'en-GB')).toBe('S')
  })
})
