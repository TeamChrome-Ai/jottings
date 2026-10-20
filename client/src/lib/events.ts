/**
 * Group events without React Native: what each option counts (the hints under the form's controls), the one-line
 * summary of an event, and the draft validation that mirrors rs/src/groups.rs `validate_event`. Pure, so tests/events.test.ts
 * runs it as it is; client/src/lib/community.ts re-exports the pieces the screens use.
 */
import { BOOKS } from '@shared/books'
import { N_, t, tc, tn } from '@shared/i18n'
import type { EventCountsFrom, EventMetric, EventRepeat, EventVisibility, GroupEvent } from '@shared/types'

// ---------------- metrics ----------------
/** `explain` says exactly what the server counts (rs/src/groups.rs leaderboard); keep it to one line. The words are
 *  read in the reader's language when the form shows them. */
export interface MetricInfo { value: EventMetric; label: string; unit: string; explain: string }
export const METRICS: MetricInfo[] = [
  { value: 'active_minutes', get label() { return t('Active minutes') }, get unit() { return tc('unit', 'min') }, get explain() { return t('Time with the reader open and moving; a pause of over 20 s between beats is not counted.') } },
  { value: 'pages', get label() { return t('Chapters') }, get unit() { return tc('unit', 'ch.') }, get explain() { return t('Read through, each part of it, with time on each to match its length; the same chapter counts once a day.') } },
  { value: 'chapters', get label() { return t('New chapters') }, get unit() { return tc('unit', 'ch.') }, get explain() { return t('Chapters read for the first time ever; a chapter read before the event counts nothing.') } },
  { value: 'score', get label() { return t('Score') }, get unit() { return tc('unit', 'pts') }, get explain() { return t('Minutes × time weight + chapters × chapter weight.') } },
  { value: 'streak', get label() { return t('Streak') }, get unit() { return tc('unit', 'days') }, get explain() { return t('Days in a row with the member’s own daily goal of minutes met.') } },
]
export const metricInfo = (m: EventMetric): MetricInfo => METRICS.find(x => x.value === m) ?? METRICS[0]
export const metricLabel = (m: EventMetric) => metricInfo(m).label
export const metricUnit = (m: EventMetric) => metricInfo(m).unit
export const isMetric = (s: string): s is EventMetric => METRICS.some(m => m.value === s)
/** A value with its unit; the streak's days stay "days" in English whatever the count, as they always have. */
export const fmtValue = (v: number, m: EventMetric) => {
  const n = Number.isInteger(v) ? v : v.toFixed(1)
  return m === 'active_minutes' ? t('{n} min', { n }) : m === 'score' ? t('{n} pts', { n }) : m === 'streak' ? tn(v, '{n} days', '{n} days', { n }) : t('{n} ch.', { n })
}
/** Whether the book list restricts the metric: only the two chapter counts and the score's chapter part look at it. */
export const usesBooks = (m: EventMetric) => m === 'pages' || m === 'chapters' || m === 'score'

// ---------------- the other options, each with what it does ----------------
export interface OptionInfo<V extends string> { value: V; label: string; explain: string }
export const VISIBILITIES: OptionInfo<EventVisibility>[] = [
  { value: 'members', get label() { return t('Everyone') }, get explain() { return t('Every member sees the whole leaderboard.') } },
  { value: 'private_admin', get label() { return t('Admins only') }, get explain() { return t('Admins see the leaderboard; each member sees their own row and place only.') } },
]
export const COUNTS_FROM: OptionInfo<EventCountsFrom>[] = [
  { value: 'event_start', get label() { return t('Event start') }, get explain() { return t('Reading before the start date does not count.') } },
  { value: 'group_join', get label() { return t('Group join') }, get explain() { return t('Reading since each member joined the group counts too, even before the start date.') } },
]
export const REPEATS: OptionInfo<EventRepeat>[] = [
  { value: 'none', get label() { return t('Once') }, get explain() { return t('The event ends on its end date.') } },
  { value: 'weekly', get label() { return t('Weekly') }, get explain() { return t('When it ends, a new event with the same name and options starts for the next week.') } },
  { value: 'monthly', get label() { return t('Monthly') }, get explain() { return t('When it ends, a new event with the same name and options starts for the next month.') } },
]
export const LATE_JOIN_HINT = {
  get on() { return t('A member who joins the group after the start is scored from the start date like everyone.') },
  get off() { return t('Members who join the group after the start date are left off the leaderboard.') },
}
export const GOAL_HINT = N_('Shown on the leaderboard as a bar to fill; nothing is locked or awarded.')
export const BOOKS_HINT = N_('Only chapters inside these books count; minutes and streak ignore it.')
export const DATES_HINT = N_('Inclusive, by each member’s own calendar day.')
export const DESCRIPTION_HINT = N_('One line under the event’s name.')
export const explainOf = <V extends string>(list: OptionInfo<V>[], v: V) => list.find(o => o.value === v)?.explain ?? ''
export const isOneOf = <V extends string>(list: OptionInfo<V>[], s: string): s is V => list.some(o => o.value === s)

/** The score formula with the admin's numbers, and one worked example so the weights mean something. */
export function scoreFormula(timeWeight: number, chapterWeight: number): string {
  const tw = num(timeWeight), cw = num(chapterWeight)
  return t('Score = minutes × {tw} + chapters × {cw}. 30 min and 2 chapters score {example}.', { tw, cw, example: num(30 * timeWeight + 2 * chapterWeight) })
}
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100))

// ---------------- labels ----------------
/** The books as a reader says them: consecutive books collapse to "Matthew–John", the rest are listed; empty = All books. */
export function booksLabel(books: readonly number[] | null | undefined): string {
  const set = [...new Set((books ?? []).filter(n => n >= 1 && n <= BOOKS.length))].sort((a, b) => a - b)
  if (set.length === 0 || set.length === BOOKS.length) return t('All books')
  const runs: [number, number][] = []
  for (const n of set) { const last = runs[runs.length - 1]; if (last && last[1] === n - 1) last[1] = n; else runs.push([n, n]) }
  const name = (n: number) => BOOKS[n - 1].name
  return runs.map(([a, b]) => (a === b ? name(a) : `${name(a)}–${name(b)}`)).join(', ')
}
/** The effective book list of an event from any server: `books`, else the legacy from–to range. */
export function eventBooks(ev: Pick<GroupEvent, 'books'> & { book_from?: number | null; book_to?: number | null }): number[] | null {
  if (ev.books && ev.books.length > 0) return ev.books
  if (ev.book_from) { const to = Math.max(ev.book_from, ev.book_to ?? ev.book_from); return Array.from({ length: to - ev.book_from + 1 }, (_, i) => ev.book_from! + i) }
  return null
}
const months = () => [tc('month', 'Jan'), tc('month', 'Feb'), tc('month', 'Mar'), tc('month', 'Apr'), tc('month', 'May'), tc('month', 'June'), tc('month', 'July'), tc('month', 'Aug'), tc('month', 'Sept'), tc('month', 'Oct'), tc('month', 'Nov'), tc('month', 'Dec')]
const parts = (day: string) => { const [y, m, d] = day.split('-').map(Number); return { y, m, d } }
/** "1–30 Sept", "28 Sept – 4 Oct", "20 Dec 2026 – 3 Jan 2027": the year only when the two differ or neither is this year. */
export function dateSpan(a: string, b: string, thisYear = new Date().getFullYear()): string {
  const x = parts(a), y = parts(b), MONTHS = months()
  if (!Number.isFinite(x.d) || !Number.isFinite(y.d)) return `${a} – ${b}`
  const yr = (p: { y: number }) => (x.y !== y.y || x.y !== thisYear ? ` ${p.y}` : '')
  if (x.y === y.y && x.m === y.m) return x.d === y.d ? `${x.d} ${MONTHS[x.m - 1]}${yr(x)}` : `${x.d}–${y.d} ${MONTHS[x.m - 1]}${yr(x)}`
  return `${x.d} ${MONTHS[x.m - 1]}${yr(x)} – ${y.d} ${MONTHS[y.m - 1]}${yr(y)}`
}
/** The list row's one line: "Chapters · Matthew–John · 1–30 Sept · goal 20". */
export function eventLine(ev: GroupEvent & { book_from?: number | null; book_to?: number | null }, thisYear?: number): string {
  const out = [ev.metric === 'score' ? t('{metric} ({tw} × min + {cw} × ch.)', { metric: metricLabel(ev.metric), tw: num(ev.time_weight), cw: num(ev.page_weight) }) : metricLabel(ev.metric)]
  const books = eventBooks(ev)
  if (books && usesBooks(ev.metric)) out.push(booksLabel(books))
  out.push(dateSpan(ev.starts_at, ev.ends_at, thisYear))
  if (ev.goal != null) out.push(t('goal {value}', { value: fmtValue(ev.goal, ev.metric) }))
  if (ev.visibility === 'private_admin') out.push(t('admins only'))
  if (ev.repeat && ev.repeat !== 'none') out.push(ev.repeat === 'weekly' ? tc('repeats', 'weekly') : ev.repeat === 'monthly' ? tc('repeats', 'monthly') : ev.repeat)
  return out.join(' · ')
}

// ---------------- dates ----------------
export const utcDay = (d: Date = new Date()): string => d.toISOString().slice(0, 10)
/** Calendar arithmetic on a YYYY-MM-DD string; an unparseable input is returned unchanged (toISOString throws on NaN). */
export const addDays = (iso: string, n: number): string => {
  const t = Date.parse(`${iso}T00:00:00Z`)
  return Number.isNaN(t) ? iso : utcDay(new Date(t + n * 86400_000))
}
/** Real calendar day in YYYY-MM-DD: shape check plus a round-trip so 2026-13-01 and 2026-02-30 are rejected. */
export const isDay = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const t = Date.parse(`${s}T00:00:00Z`)
  return !Number.isNaN(t) && utcDay(new Date(t)) === s
}
export type EventStatus = 'live' | 'upcoming' | 'ended'
export function eventStatus(ev: Pick<GroupEvent, 'starts_at' | 'ends_at'>, today: string): EventStatus {
  if (today < ev.starts_at) return 'upcoming'
  if (today > ev.ends_at) return 'ended'
  return 'live'
}
/** Number input → optional payload value; empty string means "not set". */
export const numOrNull = (s: string): number | null => {
  const n = Number(s)
  return s.trim() === '' || !Number.isFinite(n) ? null : n
}

// ---------------- the form's draft ----------------
export interface EventDraft {
  name: string; description: string; metric: EventMetric; starts_at: string; ends_at: string; time_weight: string; page_weight: string; goal: string
  /** Empty = every book. */
  books: number[]; visibility: EventVisibility; counts_from: EventCountsFrom; repeat: EventRepeat; late_join: boolean
}
export const draftOf = (ev: (GroupEvent & { book_from?: number | null; book_to?: number | null }) | undefined, today: string): EventDraft => ({
  name: ev?.name ?? '', description: ev?.description ?? '', metric: ev?.metric ?? 'active_minutes',
  starts_at: ev?.starts_at ?? today, ends_at: ev?.ends_at ?? addDays(today, 6),
  time_weight: String(ev?.time_weight ?? 1), page_weight: String(ev?.page_weight ?? 4),
  goal: ev?.goal != null ? String(ev.goal) : '', books: ev ? eventBooks(ev) ?? [] : [],
  visibility: ev?.visibility ?? 'members', counts_from: ev?.counts_from ?? 'event_start', repeat: ev?.repeat ?? 'none', late_join: ev?.late_join ?? true,
})
/** Validation mirrors rs/src/groups.rs validate_event so the server rarely gets to say no. */
export function problems(d: EventDraft): string[] {
  const out: string[] = []
  const n = d.name.trim().length
  if (n < 2 || n > 80) out.push(t('Name: 2-80 characters.'))
  if (d.description.trim().length > 120) out.push(t('Description: up to 120 characters.'))
  if (!isDay(d.starts_at)) out.push(t('Start date must be a real YYYY-MM-DD.'))
  if (!isDay(d.ends_at)) out.push(t('End date must be a real YYYY-MM-DD.'))
  if (isDay(d.starts_at) && isDay(d.ends_at) && d.ends_at < d.starts_at) out.push(t('The event ends before it starts.'))
  if (d.metric === 'score') {
    for (const [k, v] of [['time', d.time_weight], ['chapter', d.page_weight]] as const) {
      const x = numOrNull(v); if (x == null || x < 0 || x > 100) out.push(k === 'time' ? t('Time weight: a number from 0 to 100.') : t('Chapter weight: a number from 0 to 100.'))
    }
  }
  if (d.goal.trim() !== '') { const g = numOrNull(d.goal); if (g == null || g < 0) out.push(t('Goal: a number of 0 or more, or leave it empty.')) }
  if (d.books.some(b => !Number.isInteger(b) || b < 1 || b > BOOKS.length)) out.push(t('Books: pick from the list.'))
  if (!isOneOf(VISIBILITIES, d.visibility)) out.push(t('Leaderboard: pick who sees it.'))
  if (!isOneOf(COUNTS_FROM, d.counts_from)) out.push(t('Counting from: pick one.'))
  if (!isOneOf(REPEATS, d.repeat)) out.push(t('Repeat: pick one.'))
  return out
}
/** The request body for POST/PATCH …/events: `books` always sent (empty = every book), so a list replaces a legacy range. */
export function payloadOf(d: EventDraft) {
  return {
    name: d.name.trim(), description: d.description.trim() || null, metric: d.metric, starts_at: d.starts_at, ends_at: d.ends_at,
    time_weight: numOrNull(d.time_weight) ?? 1, page_weight: numOrNull(d.page_weight) ?? 4, goal: numOrNull(d.goal),
    books: [...new Set(d.books)].sort((a, b) => a - b), visibility: d.visibility, counts_from: d.counts_from, repeat: d.repeat, late_join: d.late_join,
  }
}
