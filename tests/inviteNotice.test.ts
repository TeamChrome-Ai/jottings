import { describe, it, expect } from 'vitest'
import { MARK_IDS, NOTICE_EACH_MAX, emptyMark, inviteNoticeText, inviteToastText, markSeen, planNotices, pollPath, readMark, takeFresh, type IncomingReply, type InviteLite } from '../client/src/lib/inviteNoticePlan'

const inv = (id: number, at: string, name = 'Anna', handle = 'anna'): InviteLite => ({ id, from: { handle, display_name: name }, created_at: at })
const reply = (invites: InviteLite[], now = '2026-09-27T12:00:00.000Z'): IncomingReply => ({ open: true, now, invites })

describe('the first check on a device', () => {
  it('announces nothing and marks what is waiting, with the server clock as the next since', () => {
    const r = takeFresh(reply([inv(3, '2026-09-27T11:00:00.000Z')]), emptyMark(7))
    expect(r.fresh).toEqual([])
    expect(r.mark).toEqual({ uid: 7, since: '2026-09-27T12:00:00.000Z', ids: [3] })
  })
  it('asks for everything waiting without since, then only what is newer', () => {
    expect(pollPath(emptyMark(1))).toBe('/friends/invites/incoming')
    expect(pollPath({ uid: 1, since: '2026-09-27T12:00:00.000Z', ids: [] })).toBe('/friends/invites/incoming?since=2026-09-27T12%3A00%3A00.000Z')
  })
})

describe('later checks', () => {
  const mark = { uid: 7, since: '2026-09-27T12:00:00.000Z', ids: [3] }
  it('announces each new invite once, oldest first, and moves since to the newest', () => {
    const r = takeFresh(reply([inv(9, '2026-09-27T12:05:00.000Z', 'Ben', 'ben'), inv(8, '2026-09-27T12:01:00.000Z')]), mark)
    expect(r.fresh.map(i => i.id)).toEqual([8, 9])
    expect(r.mark).toEqual({ uid: 7, since: '2026-09-27T12:05:00.000Z', ids: [3, 8, 9] })
    // the same reply again (the app and the background check both asked) announces nothing
    const again = takeFresh(reply([inv(9, '2026-09-27T12:05:00.000Z', 'Ben', 'ben'), inv(8, '2026-09-27T12:01:00.000Z')]), r.mark)
    expect(again.fresh).toEqual([])
    expect(again.mark).toEqual(r.mark)
  })
  it('keeps since when nothing new came, rather than trusting a device clock', () => {
    expect(takeFresh(reply([]), mark).mark).toEqual(mark)
  })
  it('never moves since backwards', () => {
    const r = takeFresh(reply([inv(4, '2026-09-27T11:00:00.000Z')]), mark)
    expect(r.fresh.map(i => i.id)).toEqual([4])
    expect(r.mark.since).toBe(mark.since)
  })
  it('an invite seen on screen first is never announced', () => {
    const seen = markSeen(mark, [inv(8, '2026-09-27T12:01:00.000Z')])
    expect(seen.ids).toEqual([3, 8])
    expect(seen.since).toBe('2026-09-27T12:01:00.000Z')
    expect(takeFresh(reply([inv(8, '2026-09-27T12:01:00.000Z')]), seen).fresh).toEqual([])
    // nothing new seen: the same mark, so nothing is written
    expect(markSeen(seen, [inv(8, '2026-09-27T12:01:00.000Z')])).toBe(seen)
  })
  it('keeps the newest ids only', () => {
    const many = Array.from({ length: MARK_IDS + 5 }, (_, i) => inv(100 + i, '2026-09-27T12:10:00.000Z'))
    const r = takeFresh(reply(many), mark)
    expect(r.mark.ids.length).toBe(MARK_IDS)
    expect(r.mark.ids[r.mark.ids.length - 1]).toBe(100 + MARK_IDS + 4)
  })
})

describe('the stored mark', () => {
  it('reads another account’s, a damaged or a missing one as a fresh start', () => {
    expect(readMark({ uid: 2, since: '2026-09-27T12:00:00.000Z', ids: [1] }, 7)).toEqual(emptyMark(7))
    expect(readMark('nonsense', 7)).toEqual(emptyMark(7))
    expect(readMark(null, 7)).toEqual(emptyMark(7))
    expect(readMark({ uid: 7, since: 5, ids: [1, 'x', 2.5, 3] }, 7)).toEqual({ uid: 7, since: null, ids: [1, 3] })
    expect(readMark({ uid: 7, since: '2026-09-27T12:00:00.000Z', ids: [1] }, 7)).toEqual({ uid: 7, since: '2026-09-27T12:00:00.000Z', ids: [1] })
  })
})

describe('the words', () => {
  it('names who and their handle', () => {
    expect(inviteNoticeText(inv(1, 'x'))).toEqual({ title: 'Anna (@anna) wants to be friends', body: 'Accept or decline in Friends' })
    expect(inviteNoticeText(inv(1, 'x', '  ', 'ben_k')).title).toBe('ben_k (@ben_k) wants to be friends')
  })
  it('one notice each, one summary past a few, keyed by invite so a repeat replaces', () => {
    const three = [1, 2, 3].map(i => inv(i, 'x', `P${i}`, `p${i}`))
    expect(planNotices(three).map(n => n.key)).toEqual(['friend-invite-1', 'friend-invite-2', 'friend-invite-3'])
    const more = Array.from({ length: NOTICE_EACH_MAX + 1 }, (_, i) => inv(i + 1, 'x'))
    expect(planNotices(more)).toEqual([{ key: `friend-invites-${NOTICE_EACH_MAX + 1}`, title: `${NOTICE_EACH_MAX + 1} friend invites`, body: 'Accept or decline in Friends' }])
    expect(planNotices([])).toEqual([])
  })
  it('the toast is short', () => {
    expect(inviteToastText([inv(1, 'x', 'Anna Smith')])).toBe('Anna invited you')
    expect(inviteToastText([inv(1, 'x'), inv(2, 'x')])).toBe('2 friend invites')
    expect(inviteToastText([])).toBeNull()
  })
})
