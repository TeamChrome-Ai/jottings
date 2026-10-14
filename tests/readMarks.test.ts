// The reader's own "read" marks as pure rules (docs/PATHS.md rule 1): what one device keeps and sends, what the line
// at a chapter's end says, the marks in a backup file, and the visit rule a signed-out device judges by itself.
import { beforeEach, describe, it, expect } from 'vitest'
import { chapterKey, nextPortion, pathChapters, portionAt, progress, readSetOf, type PathState } from '../shared/paths'
import {
  MAX_MARKS, NO_MARKS, afterCleared, afterFetched, afterSent, forReader, isChapter, marksOf, marksSince, readMarkList, readMarkState, withMark, withMarks, withoutMark,
  type Mark, type MarkState,
} from '../client/src/lib/readMarksCore'
import { END_WORDS, endLine, type EndFacts } from '../client/src/lib/chapterEnd'
import { MARKS_FIELD, describeMarks, readBackupMarks, withBackupMarks } from '../client/src/lib/backupMarks'
import type { Shape } from '../shared/readThrough'
import { forgetLocal, judgeLocal, newVisit, noteHeard, noteScreen, type Visit } from '../client/src/lib/readCredit'

const NOW = '2026-10-13T12:00:00.000Z'
const keys = (s: MarkState) => [...marksOf(s).keys()].sort()
const signedIn = (uid = 7): MarkState => forReader(NO_MARKS, uid)

describe('which chapters can be marked', () => {
  it('only a chapter the Bible has', () => {
    expect([isChapter(43, 21), isChapter(19, 150), isChapter(31, 1), isChapter(1, 1), isChapter(66, 22)]).toEqual([true, true, true, true, true])
    expect([isChapter(43, 22), isChapter(43, 0), isChapter(0, 1), isChapter(67, 1), isChapter(19, 151), isChapter(31, 2), isChapter(1.5, 1), isChapter('43', 3), isChapter(43, null)]).toEqual(Array(9).fill(false))
  })
  it('a list from a file or the server keeps real chapters once each, with the later time, in the Bible’s order', () => {
    const got = readMarkList([[43, 3, '2026-03-01T10:00:00Z'], { book: 40, chapter: 1, marked_at: '2026-02-01T10:00:00.000Z' }, [43, 3, '2026-04-01T10:00:00.000Z'], [43, 22, NOW], [99, 1], 'x', null, [40, 2], [40, 3, 'last week']], NOW)
    expect(got).toEqual([[40, 1, '2026-02-01T10:00:00.000Z'], [40, 2, NOW], [40, 3, NOW], [43, 3, '2026-04-01T10:00:00.000Z']])
    expect(readMarkList('nonsense', NOW)).toEqual([])
    // every chapter of the Bible is the most there can be
    const all = pathChapters('bible').map(([b, c]) => [b, c, NOW])
    expect(readMarkList([...all, ...all], NOW)).toHaveLength(MAX_MARKS)
  })
  it('a torn or foreign stored state starts empty', () => {
    expect(readMarkState(null, NOW)).toEqual(NO_MARKS)
    expect(readMarkState('{"uid":7,"known":[[40,1,"2026-02-01T10:00:00.000Z"],[40,99,"x"]],"local":"no","cleared":["43.3","43.99",5]}', NOW)).toEqual({ uid: 7, known: [[40, 1, '2026-02-01T10:00:00.000Z']], local: [], cleared: ['43.3'] })
    expect(readMarkState('{"uid":', NOW)).toEqual(NO_MARKS)
  })
})

describe('signed out: the marks are the device’s own', () => {
  it('a mark shows at once and an undo takes it away, with nothing left waiting', () => {
    let s = withMark(NO_MARKS, 40, 1, NOW)
    s = withMark(s, 43, 3, NOW)
    expect(keys(s)).toEqual(['40.1', '43.3'])
    s = withoutMark(s, 40, 1)
    expect([keys(s), s.cleared]).toEqual([['43.3'], []])
  })
  it('marked again, a chapter keeps one mark with the new time: a path begun since then counts it', () => {
    let s = withMark(NO_MARKS, 40, 1, '2026-01-01T00:00:00.000Z')
    expect([...marksSince(marksOf(s), '2026-02-01T00:00:00.000Z')]).toEqual([])
    s = withMark(s, 40, 1, '2026-02-03T00:00:00.000Z')
    expect([s.local.length, [...marksSince(marksOf(s), '2026-02-01T00:00:00.000Z')]]).toEqual([1, ['40.1']])
  })
})

describe('signed in: the account’s marks, and what waits on the device', () => {
  it('at sign-in the device’s marks stay to be sent, and leave the device’s list as the server takes them', () => {
    const device = withMark(withMark(NO_MARKS, 40, 1, '2026-02-01T00:00:00.000Z'), 40, 2, '2026-02-02T00:00:00.000Z')
    let s = forReader(device, 7)
    expect([s.uid, s.local.length, keys(s)]).toEqual([7, 2, ['40.1', '40.2']])
    s = afterSent(s, s.local)
    expect([s.local, keys(s)]).toEqual([[], ['40.1', '40.2']])
    // the account's own list, as the server gives it, then stands
    s = afterFetched(s, [[40, 1, '2026-02-01T00:00:00.000Z'], [40, 2, '2026-02-02T00:00:00.000Z'], [19, 23, '2026-01-01T00:00:00.000Z']])
    expect(keys(s)).toEqual(['19.23', '40.1', '40.2'])
  })
  it('a server that has no marks yet takes nothing: they wait, still shown, however often it is asked', () => {
    let s = withMark(signedIn(), 40, 1, NOW)
    for (let i = 0; i < 3; i++) s = afterFetched(s, [])
    expect([s.local.length, keys(s)]).toEqual([1, ['40.1']])
  })
  it('the server’s own time for a mark replaces the device’s', () => {
    const s = withMark(signedIn(), 40, 1, '2026-02-01T00:00:00.000Z')
    const sent = s.local
    expect(afterSent(s, sent, [[40, 1, '2026-02-01T00:05:00.000Z']]).known).toEqual([[40, 1, '2026-02-01T00:05:00.000Z']])
  })
  it('an undo hides the mark at once and waits for the server; marked again meanwhile, it stays', () => {
    let s = afterFetched(signedIn(), [[40, 1, NOW], [40, 2, NOW]])
    s = withoutMark(s, 40, 1)
    expect([keys(s), s.cleared]).toEqual([['40.2'], ['40.1']])
    expect(afterCleared(s, '40.1')).toMatchObject({ known: [[40, 2, NOW]], cleared: [] })
    // marked again before the undo reached the server: nothing is cleared any more
    const again = withMark(s, 40, 1, '2026-10-13T12:01:00.000Z')
    expect([keys(again), again.cleared]).toEqual([['40.1', '40.2'], []])
  })
  it('a mark undone while it was on its way to the server stays undone when the server answers', () => {
    let s = withMark(signedIn(), 40, 1, NOW)
    const sent = s.local
    s = withoutMark(s, 40, 1)
    s = afterSent(s, sent)
    expect([keys(s), s.cleared]).toEqual([[], ['40.1']])
    expect(keys(afterCleared(s, '40.1'))).toEqual([])
  })
  it('a mark made afresh while the older one was on its way keeps waiting with its own time', () => {
    let s = withMark(signedIn(), 40, 1, '2026-02-01T00:00:00.000Z')
    const sent = s.local
    s = withMark(s, 40, 1, '2026-03-01T00:00:00.000Z')
    s = afterSent(s, sent)
    expect([s.local, marksOf(s).get('40.1')]).toEqual([[[40, 1, '2026-03-01T00:00:00.000Z']], '2026-03-01T00:00:00.000Z'])
  })
  it('signing out drops the account’s marks from the device and keeps what never reached it', () => {
    let s = afterFetched(signedIn(), [[40, 1, NOW]])
    s = withMark(s, 40, 2, NOW)
    const out = forReader(s, null)
    expect([out.uid, keys(out), out.cleared]).toEqual([null, ['40.2'], []])
    // the same reader again is no change at all
    expect(forReader(s, 7)).toBe(s)
  })
  it('a restored backup only adds: a chapter marked already keeps its mark, and twice adds nothing', () => {
    const start = afterFetched(signedIn(), [[40, 1, '2026-02-01T00:00:00.000Z']])
    const file: Mark[] = [[40, 1, '2026-01-01T00:00:00.000Z'], [40, 2, '2026-01-02T00:00:00.000Z'], [40, 2, '2026-01-02T00:00:00.000Z'], [99, 1, NOW]]
    const [s, added] = withMarks(start, file)
    expect([added, keys(s), marksOf(s).get('40.1')]).toEqual([1, ['40.1', '40.2'], '2026-02-01T00:00:00.000Z'])
    const [again, none] = withMarks(s, file)
    expect([none, again]).toEqual([0, s])
  })
})

describe('the reader’s own path counts a chapter credited OR marked since its start', () => {
  const GOSPELS: PathState = { id: 'gospels', started_at: '2026-02-01T00:00:00.000Z', target_date: null, pace_per_week: null, with_ministry: false }
  const counted = (credits: [number, number][], marks: MarkState) => new Set([...readSetOf(credits), ...marksSince(marksOf(marks), GOSPELS.started_at)])
  it('read but never credited, the first chapter holds "Next on your path" until it is marked', () => {
    // Matthew 1 read faster than the rule allows: no credit, and Home's card stays on it
    expect(nextPortion(GOSPELS, counted([], NO_MARKS))?.portion).toEqual({ book: 40, chapter: 1 })
    const marked = withMark(NO_MARKS, 40, 1, '2026-02-02T08:00:00.000Z')
    expect(nextPortion(GOSPELS, counted([], marked))?.portion).toEqual({ book: 40, chapter: 2 })
    expect(progress(GOSPELS, counted([], marked))).toEqual({ done: 1, total: 89, position: 2 })
    // undone, the path goes back
    expect(nextPortion(GOSPELS, counted([], withoutMark(marked, 40, 1)))?.portion).toEqual({ book: 40, chapter: 1 })
  })
  it('a credit and a mark on different chapters both move it on; a mark from before the start does not', () => {
    const marks = withMark(withMark(NO_MARKS, 40, 2, '2026-02-03T00:00:00.000Z'), 40, 3, '2026-01-15T00:00:00.000Z')
    expect(nextPortion(GOSPELS, counted([[40, 1]], marks))?.portion).toEqual({ book: 40, chapter: 3 })
  })
  it('a portion is one chapter on every path, so no first portion waits for a second chapter', () => {
    for (const id of ['gospels', 'life-of-christ', 'psalms-proverbs', 'new-testament', 'bible', 'in-order', 'synopsis', 'coates'] as const) {
      const [first, second] = pathChapters(id)
      expect(portionAt(id, 0)).toEqual({ book: first[0], chapter: first[1] })
      expect(nextPortion(id, new Set([chapterKey(first[0], first[1])]))?.portion, id).toEqual({ book: second[0], chapter: second[1] })
    }
  })
})

describe('the line at a chapter’s end', () => {
  const OFF = { onPath: false, byCredit: false, byMark: false }
  const facts = (f: Partial<EndFacts>): EndFacts => ({ credited: false, marked: false, path: OFF, ...f })
  it('credited: "Read", with nothing to tap', () => {
    expect(endLine(facts({ credited: true }))).toEqual({ kind: 'read' })
    expect(endLine(facts({ credited: true, marked: true }))).toEqual({ kind: 'read' })
  })
  it('no clock at the end: the mark alone, or the verses still to read beside it', () => {
    expect(endLine(facts({}))).toEqual({ kind: 'open', toRead: null, firstGap: null })
    expect(endLine(facts({ gaps: [[9, 14]] }))).toEqual({ kind: 'open', toRead: 'Verses 9–14', firstGap: 9 })
    expect(Object.values(END_WORDS).join(' ')).not.toMatch(/\d:\d\d|Counts as read in/)
  })
  it('marked: it says so and offers the undo; a credit later simply takes over', () => {
    expect(endLine(facts({ marked: true }))).toEqual({ kind: 'marked' })
    expect(endLine(facts({ marked: true, credited: true }))).toEqual({ kind: 'read' })
  })
  it('on a path the path’s own count decides, so a chapter read before the path began can still be marked', () => {
    const on = (byCredit: boolean, byMark: boolean) => ({ onPath: true, byCredit, byMark })
    expect(endLine(facts({ credited: true, path: on(true, false) }))).toEqual({ kind: 'read' })
    expect(endLine(facts({ marked: true, path: on(false, true) }))).toEqual({ kind: 'marked' })
    // credited this morning, the path started this afternoon: the server cannot credit it twice in a day, and the card stayed
    expect(endLine(facts({ credited: true, path: on(false, false) }))).toEqual({ kind: 'before-path', by: 'credit' })
    expect(endLine(facts({ marked: true, path: on(false, false) }))).toEqual({ kind: 'before-path', by: 'mark' })
    // marked now, it is the mark the path counts, and it can be undone
    expect(endLine(facts({ credited: true, marked: true, path: on(false, true) }))).toEqual({ kind: 'marked' })
    expect(endLine(facts({ path: on(false, false) }))).toEqual({ kind: 'open', toRead: null, firstGap: null })
  })
  it('the words are plain and short', () => {
    expect([END_WORDS.read, END_WORDS.mark, END_WORDS.marked, END_WORDS.undo]).toEqual(['Read', 'Mark as read', 'Marked as read', 'Undo'])
    expect(END_WORDS.beforePath).toEqual({ credit: 'Read before this path began', mark: 'Marked before this path began' })
    for (const w of [END_WORDS.explained, END_WORDS.beforePath.credit]) expect(w).not.toMatch(/!/)
    expect(END_WORDS.explained).toMatch(/your own mark.*path.*streaks, reading time and badges/)
  })
})

describe('marks in a backup file', () => {
  it('ride under chapter_marks, as the account export writes them, and come back as real chapters only', () => {
    const doc = withBackupMarks({ format: 'jottings-backup', version: 1, bookmarks: [] }, [[43, 3, '2026-03-01T10:00:00.000Z'], [40, 1, '2026-02-01T10:00:00.000Z']], NOW)
    expect(doc[MARKS_FIELD]).toEqual([{ book: 40, chapter: 1, marked_at: '2026-02-01T10:00:00.000Z' }, { book: 43, chapter: 3, marked_at: '2026-03-01T10:00:00.000Z' }])
    expect(readBackupMarks(JSON.stringify(doc), NOW)).toEqual([[40, 1, '2026-02-01T10:00:00.000Z'], [43, 3, '2026-03-01T10:00:00.000Z']])
    expect(readBackupMarks('﻿' + JSON.stringify({ chapter_marks: [{ book: 43, chapter: 99, marked_at: NOW }, { book: 1, chapter: 1 }] }), NOW)).toEqual([[1, 1, NOW]])
  })
  it('an account export’s own marks are kept and the ones still waiting on the device are added', () => {
    const exported = { chapter_marks: [{ book: 40, chapter: 1, marked_at: '2026-02-01T10:00:00.000Z' }] }
    expect(withBackupMarks(exported, [[40, 1, '2026-02-01T10:00:00.000Z'], [40, 2, '2026-02-05T10:00:00.000Z']], NOW)[MARKS_FIELD]).toHaveLength(2)
  })
  it('a file without them, an older backup or one that is not JSON holds none', () => {
    expect(readBackupMarks(JSON.stringify({ format: 'jottings-backup', bookmarks: [] }), NOW)).toEqual([])
    expect(readBackupMarks(JSON.stringify({ DataList: [], SettingList: {} }), NOW)).toEqual([])
    expect(readBackupMarks('not json', NOW)).toEqual([])
    expect(readBackupMarks('[1,2]', NOW)).toEqual([])
    expect([describeMarks(0), describeMarks(1), describeMarks(12)]).toEqual(['', '1 chapter marked as read', '12 chapters marked as read'])
  })
})

describe('signed out, the device judges a visit by the server’s rule', () => {
  // six verses of 100 words: 600 words, 144 s
  const shape: Shape = { verses: [1, 2, 3, 4, 5, 6], words: [100, 100, 100, 100, 100, 100] }
  const ON = { active: true, visible: true, listening: false }
  beforeEach(() => forgetLocal())
  /** `secs` seconds of looks at verses `a`..`b` (one a second, as the app makes them), then the 15-second judgement. */
  let clock = 0
  const look = (v: Visit, secs: number, a: number, b: number, f = ON, now = 0) => {
    for (let i = 0; i < secs; i++) { clock += 1000; noteScreen(v, shape, f.visible ? [a, b] : null, clock, f.active && f.visible) }
    return judgeLocal(v, shape, secs * 1000, f, now)
  }
  it('a chapter read down to its end in its time is read by the look that meets it, wherever the reader is then', () => {
    const v = newVisit(57, 1)
    const screens: [number, number][] = [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 6], [2, 3], [2, 3], [2, 3]]
    expect(screens.map(([a, b]) => look(v, 15, a, b))).toEqual([false, false, false, false, false, false, false, false, false])
    expect(look(v, 15, 2, 3)).toBe(true)
  })
  it('a chapter flicked through is not read however long the wait at its end', () => {
    const v = newVisit(57, 1)
    look(v, 5, 1, 6)
    for (let i = 0; i < 14; i++) expect(look(v, 15, 6, 6)).toBe(false)
  })
  it('idle time is not reading time, unless the voice is reading', () => {
    const v = newVisit(57, 1)
    for (let i = 0; i < 20; i++) expect(look(v, 15, 1, 6, { active: false, visible: true, listening: false })).toBe(false)
    expect(v.through!.activeMs).toBe(0)
    const w = newVisit(57, 1)
    const heard = [1, 2, 3, 4, 5, 6].map(n => { noteHeard(w, n); return judgeLocal(w, shape, 30_000, { active: false, visible: false, listening: true }, 0) })
    expect(heard).toEqual([false, false, false, false, false, true])
  })
  it('two visits to a chapter add up, within two days', () => {
    const a = newVisit(57, 1)
    for (const [x, y] of [[1, 2], [2, 3], [3, 3], [3, 3], [3, 3]] as [number, number][]) look(a, 15, x, y, ON, 0)
    const b = newVisit(57, 1)
    const later = [[4, 5], [5, 6], [6, 6], [6, 6], [6, 6]].map(([x, y]) => look(b, 15, x, y, ON, 3_600_000))
    expect(later.at(-1)).toBe(true)
    forgetLocal()
    const c = newVisit(57, 1)
    for (const [x, y] of [[1, 2], [2, 3], [3, 3], [3, 3], [3, 3]] as [number, number][]) look(c, 15, x, y, ON, 0)
    const d = newVisit(57, 1)
    expect([[4, 5], [5, 6], [6, 6], [6, 6], [6, 6]].map(([x, y]) => look(d, 15, x, y, ON, 49 * 3_600_000)).some(Boolean)).toBe(false)
  })
})
