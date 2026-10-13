import { describe, it, expect } from 'vitest'
import { BRAND, withArticle } from '../shared/brand'
import {
  BACKUP_FORMAT, DARBY_APP_NOTES_TITLE, buildDeviceBackup, describeCounts, isEmptyBackup, jottingKey, parseBackup, readPrefs,
  type BackupContent,
} from '../client/src/lib/backupFile'

// the shape of a backup saved by the old Darby Bible app (a real one, 2026-10-13)
const SETTING = JSON.stringify({
  DataList: [
    { id: '22', bookmark: '1', bookmarkDate: '1791895590109' },
    { id: '24', bookmark: '1', bookmarkDate: '1791895590121', note: 'a note on the living soul', noteDate: '1791895582471' },
    { id: '26', highlight: '3', highlightDate: '1791895592350' },
  ],
  DailyVerses: [], DailyReading: [],
  SettingList: { Font: 'Sans', NightMode: false, Size: 16, Spacing: 1.05, screen_stay: true },
}) + '\r\n'

const content: BackupContent = {
  bookmarks: [{ book: 43, chapter: 3, verse: 16, label: 'born anew' }, { book: 19, chapter: 23, verse: null, label: null }, { book: 45, chapter: null, verse: null, label: null }],
  highlights: [{ verse_id: 43_003_016, color: 'yellow' }, { verse_id: 1_001_001, color: 'pink' }],
  jottings: [{ title: 'Grace', description: null, print_style: 'inline', items: [
    { kind: 'heading', book: null, chapter: null, v1: null, v2: null, text: 'By grace', url: null, depth: 0 },
    { kind: 'verse', book: 49, chapter: 2, v1: 8, v2: 9, text: null, url: null, depth: 1 },
    { kind: 'note', book: null, chapter: null, v1: null, v2: null, text: 'not of works', url: null, depth: 1 },
    { kind: 'link', book: null, chapter: null, v1: null, v2: null, text: 'more', url: 'https://example.org/x', depth: 0 },
  ] }],
  position: { book: 45, chapter: 11, verse: 7 },
  prefs: { fontSize: 21, theme: 'system', paragraphs: true },
}

describe('the old Darby Bible app backup', () => {
  it('brings over bookmarks, highlights and notes, the notes as one jotting in Bible order', () => {
    const p = parseBackup(SETTING)
    expect(p.kind).toBe('darby-app')
    expect(p.content.bookmarks).toEqual([{ book: 1, chapter: 1, verse: 22, label: null }, { book: 1, chapter: 1, verse: 24, label: null }])
    expect(p.content.highlights).toEqual([{ verse_id: 1_001_026, color: 'pink' }])
    expect(p.content.jottings).toEqual([{ title: DARBY_APP_NOTES_TITLE, description: null, print_style: 'verses-first', items: [
      { kind: 'verse', book: 1, chapter: 1, v1: 24, v2: 24, text: null, url: null, depth: 0 },
      { kind: 'note', book: null, chapter: null, v1: null, v2: null, text: 'a note on the living soul', url: null, depth: 0 },
    ] }])
    expect([p.content.position, p.content.prefs, p.history, p.skipped]).toEqual([null, null, null, 0])
  })
  it('gives no reading credit, whatever the file claims', () => {
    const doc = { ...JSON.parse(SETTING), DailyReading: [{ day: 1, done: true }], activity_days: [{ date: '2026-01-01', active_seconds: 9000 }], activity_signature: 'f'.repeat(64), user: { id: 6 }, exported_at: 'x' }
    expect(parseBackup(JSON.stringify(doc)).history).toBeNull()
  })
  it('reads a mark on a psalm\'s title: the bookmark is the psalm\'s, a highlight or note goes to verse 1 unless the verse has its own', () => {
    // 14260 is Psalm 23's title row and 14261 its verse 1; 13941 and 13942 are both rows before Psalm 1
    const p = parseBackup(JSON.stringify({ DataList: [
      { id: '14260', bookmark: '1', highlight: '4', note: 'the shepherd' }, { id: '14261', highlight: '2' },
      { id: '13941', bookmark: '1', highlight: '1' }, { id: '13942', bookmark: '1' }, { id: '31253', highlight: '5' },
    ], SettingList: {} }))
    expect(p.content.bookmarks).toEqual([{ book: 19, chapter: 23, verse: null, label: null }, { book: 19, chapter: 1, verse: null, label: null }])
    expect(p.content.highlights).toEqual([{ verse_id: 19_023_001, color: 'yellow' }, { verse_id: 66_022_021, color: 'yellow' }, { verse_id: 19_001_001, color: 'blue' }])
    expect(p.content.jottings[0].items.slice(0, 2)).toMatchObject([{ kind: 'verse', book: 19, chapter: 23, v1: 1 }, { kind: 'note', text: 'the shepherd' }])
    expect(p.skipped).toBe(0)
  })
  it('counts what it cannot place and takes a verse once', () => {
    const p = parseBackup(JSON.stringify({ DataList: [{ id: '0', bookmark: '1' }, { id: '99999', highlight: '1' }, { id: 'x', note: 'n' }, { id: '5', bookmark: '1' }, { id: '5', bookmark: '1' }, { id: '6', bookmark: '0', highlight: '9' }, 7], SettingList: {} }))
    expect(p.content.bookmarks).toEqual([{ book: 1, chapter: 1, verse: 5, label: null }])
    expect(p.content.highlights).toEqual([{ verse_id: 1_001_006, color: 'yellow' }])
    expect(p.skipped).toBe(5)
  })
})

describe('the app’s own backup', () => {
  it('made on a device reads back as it was written, with no reading history', () => {
    const p = parseBackup(buildDeviceBackup(content, '2026-10-13T12:00:00Z', '1.0.2'))
    expect(p.kind).toBe('jottings')
    expect(p.content).toEqual(content)
    expect([p.history, p.skipped, isEmptyBackup(p)]).toEqual([null, 0, false])
  })
  it('reads the account export, its signed history untouched', () => {
    const doc = {
      format: BACKUP_FORMAT, version: 1, exported_at: '2026-10-13T12:00:00Z', user: { id: 6, handle: 'anna', settings: { friends: { discoverable: true }, fontSize: 99 } },
      reading_position: { book: 43, chapter: 1, verse: 1, updated_at: 'x' },
      bookmarks: [{ book: 43, chapter: 3, verse: 16, label: null, color: null, created_at: 'x' }],
      highlights: [{ verse_id: 43_003_016, color: 'green', created_at: 'x' }],
      outlines: [{ id: 4, title: ' Grace ', visibility: 'private', items: [{ position: 0, kind: 'verse', book: 49, chapter: 2, v1: 8, v2: null, text: null, url: null, depth: 0 }] }],
      activity_days: [{ date: '2026-10-12', active_seconds: 700, pages: 3, chapters: 1 }], page_credits: [], chapters_read: [], badges: [],
      activity_signature: 'ab'.repeat(32), device_settings: { fontSize: 20 },
    }
    const p = parseBackup(JSON.stringify(doc))
    expect(p.content.bookmarks).toEqual([{ book: 43, chapter: 3, verse: 16, label: null }])
    expect(p.content.highlights).toEqual([{ verse_id: 43_003_016, color: 'green' }])
    expect(p.content.jottings[0]).toMatchObject({ title: 'Grace', print_style: 'verses-first', items: [{ kind: 'verse', book: 49, chapter: 2, v1: 8, v2: 8 }] })
    expect(p.content.prefs).toEqual({ fontSize: 20 })
    expect(p.history).toEqual({ user: { id: 6 }, exported_at: doc.exported_at, activity_days: doc.activity_days, page_credits: [], chapters_read: [], badges: [], activity_signature: doc.activity_signature })
    // an export from before 1.0.2 names no format; one whose signature is missing or malformed carries no history
    const { format: _f, version: _v, activity_signature: _s, ...legacy } = doc
    expect(parseBackup(JSON.stringify(legacy)).history).toBeNull()
    expect(parseBackup(JSON.stringify(legacy)).content.bookmarks).toHaveLength(1)
    expect(parseBackup(JSON.stringify({ ...doc, activity_signature: 'zz' })).history).toBeNull()
  })
  it('drops what is not a real verse, colour, item or link, and counts it', () => {
    const p = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1,
      bookmarks: [{ book: 67, chapter: 1, verse: 1 }, { book: 43, chapter: 22, verse: 1 }, { book: 43, chapter: 3, verse: 37 }, { book: 43, chapter: 3, verse: 16 }, { book: 43, chapter: 3, verse: 16 }, { book: 43, chapter: null, verse: 4 }],
      highlights: [{ verse_id: 43_003_016, color: 'red' }, { verse_id: 43_003_099, color: 'blue' }, { verse_id: 43_003_000, color: 'blue' }, { verse_id: '43003016', color: 'blue' }, { verse_id: 43_003_016, color: 'blue' }],
      outlines: [{ title: '' , items: [] }, { title: 'x'.repeat(161), items: [] }, { title: 'Kept', items: [
        { kind: 'script', text: 'x' }, { kind: 'link', url: 'javascript:alert(1)', text: 'x' }, { kind: 'verse', book: 43, chapter: 3, v1: 16, v2: 2 }, { kind: 'note', text: 'x'.repeat(20_001) },
        { kind: 'note', text: 'kept', depth: 9 },
      ] }],
      reading_position: { book: 43, chapter: 99, verse: 1 }, device_settings: { fontSize: 400, theme: '../x', customFonts: [{ id: 'f' }] },
    }))
    expect(p.content.bookmarks).toEqual([{ book: 43, chapter: 3, verse: 16, label: null }])
    expect(p.content.highlights).toEqual([{ verse_id: 43_003_016, color: 'blue' }])
    expect(p.content.jottings).toEqual([{ title: 'Kept', description: null, print_style: 'verses-first', items: [{ kind: 'note', book: null, chapter: null, v1: null, v2: null, text: 'kept', url: null, depth: 3 }] }])
    expect([p.content.position, p.content.prefs]).toEqual([null, null])
    expect(p.skipped).toBe(4 + 4 + 2 + 4)
  })
  it('refuses a file that is not a backup, and one from a newer app', () => {
    expect(() => parseBackup('not json')).toThrow(/could not be read/)
    expect(() => parseBackup('[1,2]')).toThrow(/not a backup/)
    expect(() => parseBackup('{"hello":1}')).toThrow(`not ${withArticle(BRAND.name)} backup or a Darby Bible app backup`)
    expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 2 }))).toThrow(`newer ${BRAND.name}`)
    expect(isEmptyBackup(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1 })))).toBe(true)
    expect(parseBackup('﻿' + SETTING).kind).toBe('darby-app')
  })
})

describe('the small rules', () => {
  it('keeps only reading settings of the right kind and range', () => {
    expect(readPrefs({ fontSize: 22, lineHeight: 9, font: 'custom:abc', theme: 'slate', onboarded: false, streakReminder: { enabled: false }, ttsPause: 'long', readerName: 'x'.repeat(60) }))
      .toEqual({ fontSize: 22, theme: 'slate', ttsPause: 'long', readerName: 'x'.repeat(40) })
    expect([readPrefs({}), readPrefs(null), readPrefs([1])]).toEqual([null, null, null])
  })
  it('knows the same jotting however its single verses were stored', () => {
    const a = jottingKey('Grace', [{ kind: 'verse', book: 49, chapter: 2, v1: 8, v2: null, depth: 0 }])
    expect(jottingKey(' Grace ', [{ kind: 'verse', book: 49, chapter: 2, v1: 8, v2: 8, text: null, url: null, depth: 0 }])).toBe(a)
    expect(jottingKey('Grace', [{ kind: 'verse', book: 49, chapter: 2, v1: 8, v2: 9, depth: 0 }])).not.toBe(a)
  })
  it('words the counts', () => {
    expect(describeCounts({ bookmarks: 1, highlights: 1200, jottings: 0 })).toBe('1 bookmark, 1,200 highlights')
    expect(describeCounts({ bookmarks: 0, highlights: 0, jottings: 0 })).toBe('')
  })
})
