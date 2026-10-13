/**
 * The admin's live numbers (GET /api/admin/live, rs/src/live.rs), as the screen reads them. Hours arrive as UTC keys
 * (`2026-10-12T14`) and only where something was counted; the screen wants the last `n` hours, every one, by the
 * reader's own clock (tests/liveStats.test.ts).
 */
export interface Count { key: string; n: number }
/** `timed`: the requests whose time is the server's own (not a recording being downloaded); `avg_ms` is over those. */
export interface ServerHour extends Count { errors: number; opens: number; avg_ms: number; max_ms: number; timed?: number; p95_ms?: number | null }
export interface LiveStats {
  now: string
  clicks: { today: number; total: number; by_hour: Count[]; by_day: Count[] }
  accounts: { total: number; today: number; by_day: Count[] }
  readers: { today: number; minutes_today: number }
  community: { groups: number; jottings: number; feedback: number; reports_pending: number }
  /** `p95_ms`: the time 95 in 100 answers came within, over every hour held. */
  server: { since: string; by_hour: ServerHour[]; p95_ms?: number | null }
}

const pad = (n: number) => String(n).padStart(2, '0')
/** The UTC hour key of `t`, as the server writes it. */
export const hourKey = (t: Date) => `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}`
/** A UTC hour key as the hour on the reader's clock: "14". */
export const localHour = (key: string) => pad(new Date(`${key}:00:00Z`).getHours())

/** The last `n` hours ending with the one `now` is in, oldest first; an hour nothing was counted in reads 0. */
export function lastHours<T extends Count>(rows: readonly T[], now: Date, n: number, value: (r: T) => number = r => r.n): { key: string; label: string; value: number }[] {
  const by = new Map(rows.map(r => [r.key, r]))
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const key = hourKey(new Date(now.getTime() - i * 3_600_000))
    const r = by.get(key)
    out.push({ key, label: localHour(key), value: r ? value(r) : 0 })
  }
  return out
}

/** The server's request figures over the hours it has (since it last started): totals and the slowest answer. */
export function serverTotals(hours: readonly ServerHour[]) {
  const n = hours.reduce((s, h) => s + h.n, 0)
  const timed = hours.reduce((s, h) => s + (h.timed ?? h.n), 0)
  return {
    requests: n,
    errors: hours.reduce((s, h) => s + h.errors, 0),
    opens: hours.reduce((s, h) => s + h.opens, 0),
    avgMs: timed ? Math.round(hours.reduce((s, h) => s + h.avg_ms * (h.timed ?? h.n), 0) / timed * 10) / 10 : 0,
  }
}
