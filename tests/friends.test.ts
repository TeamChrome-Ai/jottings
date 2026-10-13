import { describe, expect, it } from 'vitest'
import { BRAND, SCHEMES, siteUrl } from '../shared/brand'
import { inviteToken, keptMoment, presentFriendStreak, streakMilestone, summariseReactions, targetName, type FriendStreak, type ReactionKind } from '../shared/friends'

const fs = (p: Partial<FriendStreak>): FriendStreak => ({ current: 0, longest: 0, day: '2026-09-26', kept: false, mine_met: false, theirs_met: false, run_start: null, state: 'none', ...p })

describe('friend streak presenter', () => {
  it('names a kept day, and the first one as a start', () => {
    expect(presentFriendStreak(fs({ current: 12, longest: 12, kept: true, state: 'kept', run_start: '2026-09-15' }), 'Anna')).toMatchObject({ show: true, tone: 'kept', count: 12, headline: '12 days together', line: 'Kept today' })
    expect(presentFriendStreak(fs({ current: 1, kept: true, state: 'kept' }), 'Anna').line).toBe('Started today')
    expect(presentFriendStreak(fs({ current: 1, kept: true, state: 'kept' }), 'Anna').headline).toBe('1 day together')
  })
  it('says plainly who is still to read, never with guilt', () => {
    const w = (mine: boolean, theirs: boolean) => presentFriendStreak(fs({ current: 4, state: 'waiting', mine_met: mine, theirs_met: theirs }), 'Anna').line
    expect(w(true, false)).toBe('Waiting for Anna')
    expect(w(false, true)).toBe('Anna has read today. Your turn')
    expect(w(false, false)).toBe('Read today to keep it going')
  })
  it('shows a lapse gently with the best run, and nothing when not shared', () => {
    const p = presentFriendStreak(fs({ current: 0, longest: 9, state: 'lapsed' }), 'Anna')
    expect(p).toMatchObject({ tone: 'lapsed', count: 9, headline: 'Lapsed', line: 'Start again today. Your best was 9 days' })
    expect(p.label).toBe('Lapsed. Start again today. Your best was 9 days')
    expect(presentFriendStreak(null, 'Anna').show).toBe(false)
    expect(presentFriendStreak(fs({}), 'Anna').line).toBe('Both read on the same day to start one')
  })
  it('offers the highest milestone of the running streak, named by its run', () => {
    expect(streakMilestone(fs({ current: 6, run_start: '2026-09-21' }))).toBeNull()
    expect(streakMilestone(fs({ current: 7, run_start: '2026-09-20' }))).toEqual({ days: 7, target: 'streak:7:2026-09-20' })
    expect(streakMilestone(fs({ current: 45, run_start: '2026-08-13' }))).toEqual({ days: 30, target: 'streak:30:2026-08-13' })
    expect(streakMilestone(fs({ current: 0, longest: 40, state: 'lapsed' }))).toBeNull()
  })
  it('plays the kept moment once per kept day and counts up from what was shown', () => {
    const kept = fs({ current: 8, kept: true, state: 'kept', day: '2026-09-26' })
    expect(keptMoment(undefined, kept)).toEqual({ play: true, from: 7 })
    expect(keptMoment({ day: '2026-09-25', kept: true, count: 7 }, kept)).toEqual({ play: true, from: 7 })
    expect(keptMoment({ day: '2026-09-26', kept: false, count: 7 }, kept)).toEqual({ play: true, from: 7 })
    expect(keptMoment({ day: '2026-09-26', kept: true, count: 8 }, kept)).toEqual({ play: false, from: 8 })
    expect(keptMoment({ day: '2026-09-25', kept: true, count: 20 }, kept).from).toBe(8)
    expect(keptMoment(undefined, fs({ current: 3, state: 'waiting' })).play).toBe(false)
  })
})

describe('reaction summaries', () => {
  const r = (kind: ReactionKind, name: string) => ({ kind, from: { display_name: name, handle: name.toLowerCase() } })
  it('reads as one quiet line', () => {
    expect(summariseReactions([])).toBe('')
    expect(summariseReactions([r('heart', 'Anna')])).toBe('A heart from Anna')
    expect(summariseReactions([r('heart', 'Anna'), r('heart', 'Ben')])).toBe('2 hearts from Anna and Ben')
    expect(summariseReactions([r('heart', 'Anna'), r('heart', 'Ben'), r('heart', 'Cara')])).toBe('3 hearts from Anna and 2 others')
    expect(summariseReactions([r('heart', 'Anna'), r('smile', 'Ben'), r('heart', 'Cara')])).toBe('2 hearts and a smile from Anna and 2 others')
    expect(summariseReactions([r('clap', 'Anna'), r('seal', 'Ben')])).toBe('A round of applause and a well-done seal from Anna and Ben')
    expect(summariseReactions([{ kind: 'heart', from: { display_name: '', handle: 'anna' } }, r('smile', 'Ben')])).toBe('A heart and a smile from anna and Ben')
  })
  it('names what was reacted to', () => {
    const names: Record<string, string> = { streak_7: 'One week' }
    expect(targetName('badge:streak_7', c => names[c])).toBe('One week')
    expect(targetName('badge:unknown', c => names[c])).toBe('unknown')
    expect(targetName('streak:30:2026-08-13', () => undefined)).toBe('30-day friend streak')
  })
})

describe('invite tokens in scanned codes and links', () => {
  const t = 'Ab3dEf5hIj7kLm9nOp1q'
  it('reads the app’s own links and the bare token', () => {
    for (const s of [t, siteUrl(`/friends?t=${t}`), `http://localhost:8787/friends?t=${t}`, siteUrl(`/friends/?t=${t}&x=1`), siteUrl(`/friends?x=1&t=${t}`), ...SCHEMES.map(scheme => `${scheme}://friends?t=${t}`), `  ${t}\n`]) {
      expect(inviteToken(s), s).toBe(t)
    }
  })
  it('ignores anything else', () => {
    for (const s of ['', 'hello', 'short1', siteUrl(`/groups?join=${t}`), `https://example.org/other?t=${t}`, siteUrl(`/friends?t=${t}!`), siteUrl('/friends?t=abc'), `not-${BRAND.scheme}://friends?t=${t}`]) {
      expect(inviteToken(s), s).toBeNull()
    }
  })
})

describe('group streak presenter', () => {
  const g = (p: Partial<import('../shared/friends').GroupStreak>) => ({ current: 0, longest: 0, day: '2026-09-26', kept: false, run_start: null, state: 'none' as const, today: [], met_today: 0, members: 5, ...p })
  it('counts who has read today and names nobody', async () => {
    const { presentGroupStreak, groupAsStreak } = await import('../shared/friends')
    expect(presentGroupStreak(g({ current: 4, state: 'waiting', met_today: 3 }))).toMatchObject({ headline: '4 days together', line: '3 of 5 have read today' })
    expect(presentGroupStreak(g({ current: 5, state: 'kept', kept: true, met_today: 5 })).line).toBe('All 5 have read today')
    expect(presentGroupStreak(g({ current: 5, state: 'kept', kept: true, met_today: 2, members: 2 })).line).toBe('Both have read today')
    expect(presentGroupStreak(g({ state: 'lapsed', longest: 12 }))).toMatchObject({ tone: 'lapsed', count: 12, line: 'Start again today. The group’s best was 12 days' })
    expect(presentGroupStreak(g({ met_today: 1 })).line).toBe('A day on which everyone reads starts one. 1 of 5 have read today')
    expect(presentGroupStreak(null).show).toBe(false)
    const s = groupAsStreak(g({ current: 3, state: 'waiting', today: [{ id: 7, met: true }, { id: 8, met: false }], met_today: 1 }), 7)
    expect([s.mine_met, s.theirs_met, s.current]).toEqual([true, true, 3])
  })
})
