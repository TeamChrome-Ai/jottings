import { describe, expect, it } from 'vitest'
import { hourKey, lastHours, serverTotals } from '../client/src/lib/liveStats'

describe('the admin live numbers', () => {
  const now = new Date('2026-10-12T15:38:00Z')
  it('keys an hour as the server does, in UTC', () => { expect(hourKey(now)).toBe('2026-10-12T15') })
  it('lists the last hours oldest first, with 0 where nothing was counted', () => {
    const rows = [{ key: '2026-10-12T14', n: 132 }, { key: '2026-10-12T15', n: 87 }, { key: '2026-10-11T03', n: 9 }]
    const h = lastHours(rows, now, 4)
    expect(h.map(x => x.key)).toEqual(['2026-10-12T12', '2026-10-12T13', '2026-10-12T14', '2026-10-12T15'])
    expect(h.map(x => x.value)).toEqual([0, 0, 132, 87])
  })
  it('can chart another figure of the same rows', () => {
    const rows = [{ key: '2026-10-12T15', n: 400, errors: 0, opens: 55, avg_ms: 3, max_ms: 90 }]
    expect(lastHours(rows, now, 1, r => r.opens)[0].value).toBe(55)
  })
  it('totals the server hours, the average weighted by requests', () => {
    const t = serverTotals([{ key: 'a', n: 100, errors: 1, opens: 10, avg_ms: 2, max_ms: 50 }, { key: 'b', n: 300, errors: 0, opens: 30, avg_ms: 6, max_ms: 900 }])
    expect(t).toEqual({ requests: 400, errors: 1, opens: 40, avgMs: 5 })
    // the average is over the requests the server timed, when it says how many those were
    expect(serverTotals([{ key: 'a', n: 100, timed: 50, errors: 0, opens: 0, avg_ms: 2, max_ms: 5 }, { key: 'b', n: 100, timed: 150, errors: 0, opens: 0, avg_ms: 6, max_ms: 9 }]).avgMs).toBe(5)
    expect(serverTotals([]).avgMs).toBe(0)
  })
})
