import { describe, it, expect } from 'vitest'
import {
  COUNTS_FROM, METRICS, REPEATS, VISIBILITIES, booksLabel, dateSpan, draftOf, eventBooks, eventLine, eventStatus, explainOf, payloadOf, problems, scoreFormula,
  type EventDraft,
} from '../client/src/lib/events'
import type { GroupEvent } from '../shared/types'

const ev = (over: Partial<GroupEvent> & { book_from?: number | null; book_to?: number | null } = {}): GroupEvent & { book_from?: number | null; book_to?: number | null } =>
  ({ id: 1, group_id: 1, name: 'Gospels', metric: 'pages', starts_at: '2026-09-01', ends_at: '2026-09-30', time_weight: 1, page_weight: 4, goal: 20, created_by: 1, ...over })
const draft = (over: Partial<EventDraft> = {}): EventDraft => ({ ...draftOf(undefined, '2026-09-01'), name: 'Gospels', ...over })

describe('event hints', () => {
  it('every option says what it does, in one line', () => {
    for (const list of [METRICS, VISIBILITIES, COUNTS_FROM, REPEATS]) for (const o of list) { expect(o.explain.length).toBeGreaterThan(20); expect(o.explain).not.toContain('\n') }
    expect(explainOf(METRICS, 'active_minutes')).toContain('20 s')
    expect(explainOf(COUNTS_FROM, 'group_join')).toMatch(/before the start/)
    expect(explainOf(VISIBILITIES, 'private_admin')).toMatch(/own row/)
    expect(explainOf(REPEATS, 'weekly')).toMatch(/same name/)
  })
  it('spells the score formula with the admin’s numbers and a worked example', () => {
    expect(scoreFormula(1, 4)).toBe('Score = minutes × 1 + chapters × 4. 30 min and 2 chapters score 38.')
    expect(scoreFormula(0.5, 10)).toBe('Score = minutes × 0.5 + chapters × 10. 30 min and 2 chapters score 35.')
  })
})

describe('labels', () => {
  it('collapses consecutive books to a range and lists the rest', () => {
    expect(booksLabel([40, 41, 42, 43, 19])).toBe('Psalms, Matthew–John')
    expect(booksLabel([19])).toBe('Psalms')
    expect(booksLabel([1, 2, 66])).toBe('Genesis–Exodus, Revelation')
    expect(booksLabel([])).toBe('All books')
    expect(booksLabel(null)).toBe('All books')
    expect(booksLabel(Array.from({ length: 66 }, (_, i) => i + 1))).toBe('All books')
    expect(booksLabel([43, 43, 0, 99])).toBe('John')
  })
  it('reads a legacy from–to range as a book list', () => {
    expect(eventBooks(ev({ book_from: 40, book_to: 43 }))).toEqual([40, 41, 42, 43])
    expect(eventBooks(ev({ book_from: 19, book_to: null }))).toEqual([19])
    expect(eventBooks(ev({ books: [19, 40], book_from: 1, book_to: 5 }))).toEqual([19, 40])
    expect(eventBooks(ev({ books: [] }))).toBeNull()
  })
  it('writes a date span the way a reader says it', () => {
    expect(dateSpan('2026-09-01', '2026-09-30', 2026)).toBe('1–30 Sept')
    expect(dateSpan('2026-09-28', '2026-10-04', 2026)).toBe('28 Sept – 4 Oct')
    expect(dateSpan('2026-12-20', '2027-01-03', 2026)).toBe('20 Dec 2026 – 3 Jan 2027')
    expect(dateSpan('2025-06-01', '2025-06-07', 2026)).toBe('1–7 June 2025')
    expect(dateSpan('2026-03-05', '2026-03-05', 2026)).toBe('5 Mar')
  })
  it('puts the whole event on one line', () => {
    expect(eventLine(ev({ books: [40, 41, 42, 43] }), 2026)).toBe('Chapters · Matthew–John · 1–30 Sept · goal 20 ch.')
    expect(eventLine(ev({ metric: 'active_minutes', books: [40], goal: null }), 2026)).toBe('Active minutes · 1–30 Sept')
    expect(eventLine(ev({ metric: 'score', goal: null, visibility: 'private_admin', repeat: 'monthly' }), 2026)).toBe('Score (1 × min + 4 × ch.) · 1–30 Sept · admins only · monthly')
    expect(eventLine(ev({ book_from: 19, goal: 5 }), 2026)).toBe('Chapters · Psalms · 1–30 Sept · goal 5 ch.')
  })
  it('tells live from upcoming and ended by the given day', () => {
    expect(eventStatus(ev(), '2026-08-31')).toBe('upcoming')
    expect(eventStatus(ev(), '2026-09-30')).toBe('live')
    expect(eventStatus(ev(), '2026-10-01')).toBe('ended')
  })
})

describe('draft validation (mirrors validate_event)', () => {
  it('accepts the defaults with a name', () => {
    expect(problems(draft())).toEqual([])
    const d = draftOf(undefined, '2026-09-01')
    expect([d.starts_at, d.ends_at, d.visibility, d.counts_from, d.repeat, d.late_join, d.books]).toEqual(['2026-09-01', '2026-09-07', 'members', 'event_start', 'none', true, []])
  })
  it('names each problem', () => {
    expect(problems(draft({ name: 'x' }))).toEqual(['Name: 2-80 characters.'])
    expect(problems(draft({ description: 'd'.repeat(121) }))).toEqual(['Description: up to 120 characters.'])
    expect(problems(draft({ starts_at: '2026-02-30' }))).toEqual(['Start date must be a real YYYY-MM-DD.'])
    expect(problems(draft({ starts_at: '2026-09-10', ends_at: '2026-09-09' }))).toEqual(['The event ends before it starts.'])
    expect(problems(draft({ metric: 'score', time_weight: '101' }))).toEqual(['Time weight: a number from 0 to 100.'])
    expect(problems(draft({ metric: 'score', page_weight: '-1' }))).toEqual(['Chapter weight: a number from 0 to 100.'])
    expect(problems(draft({ metric: 'pages', time_weight: '101' }))).toEqual([])
    expect(problems(draft({ goal: '-3' }))).toEqual(['Goal: a number of 0 or more, or leave it empty.'])
    expect(problems(draft({ books: [0] }))).toEqual(['Books: pick from the list.'])
    expect(problems(draft({ visibility: 'everyone' as never }))).toEqual(['Leaderboard: pick who sees it.'])
    expect(problems(draft({ counts_from: 'always' as never }))).toEqual(['Counting from: pick one.'])
    expect(problems(draft({ repeat: 'daily' as never }))).toEqual(['Repeat: pick one.'])
  })
  it('sends a sorted, deduplicated book list and an empty description as null', () => {
    const p = payloadOf(draft({ books: [43, 19, 40, 40], description: '  ', goal: '20' }))
    expect(p.books).toEqual([19, 40, 43])
    expect(p.description).toBeNull()
    expect(p.goal).toBe(20)
    expect([p.visibility, p.counts_from, p.repeat, p.late_join]).toEqual(['members', 'event_start', 'none', true])
  })
  it('edits start from the event as it is, legacy range included', () => {
    const d = draftOf(ev({ book_from: 40, book_to: 43, description: 'Read together', visibility: 'private_admin', late_join: false }), '2026-09-15')
    expect([d.books, d.description, d.visibility, d.late_join, d.goal]).toEqual([[40, 41, 42, 43], 'Read together', 'private_admin', false, '20'])
  })
})
