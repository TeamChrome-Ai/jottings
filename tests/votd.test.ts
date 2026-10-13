import { describe, it, expect } from 'vitest'
import { VOTD_REFS, parseVotd, votdIndex, presentVotd } from '../shared/votd'

describe('verse of the day', () => {
  it('has a full year of distinct references', () => {
    expect(VOTD_REFS.length).toBeGreaterThanOrEqual(366)
    expect(new Set(VOTD_REFS).size).toBe(VOTD_REFS.length)
    for (const r of VOTD_REFS) { const p = parseVotd(r); expect(p.book).toBeGreaterThan(0); expect(p.book).toBeLessThanOrEqual(66); expect(p.chapter).toBeGreaterThan(0); expect(p.v1).toBeGreaterThan(0); if (p.v2) expect(p.v2).toBeGreaterThan(p.v1) }
  })
  it('never repeats within a year and shifts between years', () => {
    const seen = new Set<number>()
    for (let d = new Date(2027, 0, 1); d.getFullYear() === 2027; d.setDate(d.getDate() + 1)) seen.add(votdIndex(d))
    expect(seen.size).toBe(365)
    expect(votdIndex(new Date(2027, 2, 1))).not.toBe(votdIndex(new Date(2028, 2, 1)))
  })
  it('presents a continuation verse as a sentence', () => {
    expect(presentVotd('but they that wait upon Jehovah shall renew strength.')).toBe('But they that wait upon Jehovah shall renew strength.')
    expect(presentVotd('—Fear not, for I am with thee.')).toBe('Fear not, for I am with thee.')
  })
})
