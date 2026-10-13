import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NOUN } from '../shared/brand'

// a device with nobody signed in: storage is real (a map), the server is never reached
const store = new Map<string, string>()
vi.mock('../client/node_modules/@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null, setItem: async (k: string, v: string) => { store.set(k, v) },
    removeItem: async (k: string) => { store.delete(k) }, getAllKeys: async () => [...store.keys()],
  },
}))
vi.mock('../client/node_modules/react-native', () => ({ Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android } }))
vi.mock('../client/node_modules/expo-constants', () => ({ default: { expoConfig: { version: '1.0.2' } } }))
vi.mock('../client/node_modules/expo-file-system', () => ({ File: class {}, Paths: {} }))
vi.mock('../client/node_modules/expo-sharing', () => ({}))
vi.mock('../client/src/theme', () => ({ isThemeId: (s: string) => s === 'slate' || s === 'paper' }))
vi.mock('../client/src/lib/yourdata', () => ({ fetchExport: vi.fn() }))
const session = { token: null as string | null }
vi.mock('../client/src/lib/api', () => {
  class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
  const never = () => { throw new Error('the server was called while signed out') }
  return { ApiError, getToken: () => session.token, get: vi.fn(never), post: vi.fn(never), put: vi.fn(never), del: vi.fn(never), api: vi.fn(never), cachedGet: vi.fn(never) }
})

import { backupText, deviceContent } from '../client/src/lib/backup'
import { DARBY_APP_NOTES_TITLE, describeCounts, parseBackup } from '../client/src/lib/backupFile'
import { addLocalBookmark, createLocalOutline } from '../client/src/lib/localLibrary'
import { setHighlight } from '../client/src/lib/highlights'
import type { Prefs, PrefsStore } from '../client/src/store/prefs'

const prefsStore = (start: Partial<Prefs> = {}) => {
  let p = { fontSize: 19, theme: 'system', paragraphs: false, ...start } as Prefs
  const s: PrefsStore = { get: () => p, isLoaded: () => true, set: n => { p = { ...p, ...n } }, reset: () => {}, subscribe: () => () => {} }
  return s
}
const SETTING = JSON.stringify({
  DataList: [{ id: '22', bookmark: '1' }, { id: '24', bookmark: '1', note: 'a note' }, { id: '26', highlight: '3' }],
  DailyVerses: [], DailyReading: [], SettingList: { Font: 'Sans', Size: 16 },
})

beforeEach(() => { session.token = null })

describe('restore, signed out', () => {
  it('puts a device backup back on an empty device, and a second restore adds nothing', async () => {
    // the old phone
    await addLocalBookmark({ book: 43, chapter: 3, verse: 16 })
    await addLocalBookmark({ book: 19, chapter: 23 })
    await setHighlight(null, 43_003_016, 'green')
    await setHighlight(null, 45_011_007, 'pink')
    await createLocalOutline({ title: 'Grace' }, [{ kind: 'verse', book: 49, chapter: 2, v1: 8, v2: 9, text: null, url: null, depth: 0 }, { kind: 'note', book: null, chapter: null, v1: null, v2: null, text: 'not of works', url: null, depth: 0 }])
    store.set('berean_pos', JSON.stringify({ book: 45, chapter: 11, verse: 7 }))
    const old = prefsStore({ fontSize: 23, theme: 'slate' as Prefs['theme'], paragraphs: true })
    const file = await backupText(false, old.get())
    const before = await deviceContent(old.get())
    expect([before.bookmarks.length, before.highlights.length, before.jottings.length, before.position]).toEqual([2, 2, 1, { book: 45, chapter: 11, verse: 7 }])

    // the new phone: nothing on it. Modules keep what they read this launch, so the "new phone" is a fresh module graph
    store.clear()
    vi.resetModules()
    const B = await import('../client/src/lib/backup')
    const L = await import('../client/src/lib/localLibrary')
    const H = await import('../client/src/lib/highlights')
    const P = await import('../client/src/hooks/usePosition')
    const fresh = prefsStore()
    const parsed = parseBackup(file)
    const r = await B.applyBackup(parsed, null, fresh)
    expect(r).toEqual({ bookmarks: 2, highlights: 2, jottings: 1, refused: 0, position: true, settings: true, history: null })
    expect((await L.localBookmarks()).map(b => [b.book, b.chapter, b.verse ?? null]).sort()).toEqual([[19, 23, null], [43, 3, 16]])
    expect([...(await H.cachedHighlights(null, 43, 3))]).toEqual([[43_003_016, 'green']])
    expect([...(await H.cachedHighlights(null, 45, 11))]).toEqual([[45_011_007, 'pink']])
    const [o] = await L.localOutlines()
    expect((await L.localOutline(o.id))?.items?.map(i => [i.kind, i.v1 ?? null, i.text ?? null])).toEqual([['verse', 8, null], ['note', null, 'not of works']])
    expect(await P.localPosition()).toEqual({ book: 45, chapter: 11, verse: 7 })
    expect([fresh.get().fontSize, fresh.get().theme, fresh.get().paragraphs]).toEqual([23, 'slate', true])
    expect(await B.deviceContent(fresh.get())).toEqual(before)

    const again = await B.applyBackup(parsed, null, fresh)
    expect(again).toMatchObject({ bookmarks: 0, highlights: 0, jottings: 0, position: false })
    expect((await L.localOutlines()).length).toBe(1)
    expect(B.describeRestore(again, 0, describeCounts)).toMatch(/^Nothing new to add/)
  })

  it('imports the old Darby Bible app backup beside what is already here, keeping the colour already chosen', async () => {
    store.clear(); vi.resetModules()
    const B = await import('../client/src/lib/backup')
    const L = await import('../client/src/lib/localLibrary')
    const H = await import('../client/src/lib/highlights')
    await L.addLocalBookmark({ book: 1, chapter: 1, verse: 22 })
    await H.setHighlight(null, 1_001_026, 'pink')
    store.set('berean_pos', JSON.stringify({ book: 43, chapter: 1, verse: 1 }))
    const prefs = prefsStore({ fontSize: 25 })
    const r = await B.applyBackup(parseBackup(SETTING), null, prefs)
    expect(r).toEqual({ bookmarks: 1, highlights: 0, jottings: 1, refused: 0, position: false, settings: false, history: null })
    expect([...(await H.cachedHighlights(null, 1, 1))]).toEqual([[1_001_026, 'pink']])
    expect((await L.localOutlines()).map(o => o.title)).toEqual([DARBY_APP_NOTES_TITLE])
    expect(prefs.get().fontSize).toBe(25)
    expect(B.describeRestore(r, 0, describeCounts)).toBe(`Added 1 bookmark, 1 ${NOUN.one}.`)
  })

  it('leaves a signed history for an account', async () => {
    store.clear(); vi.resetModules()
    const B = await import('../client/src/lib/backup')
    const file = JSON.stringify({ format: 'jottings-backup', version: 1, exported_at: 'x', user: { id: 6 }, outlines: [], activity_days: [{ date: '2026-10-12', active_seconds: 700, pages: 1, chapters: 1 }], activity_signature: 'ab'.repeat(32) })
    const r = await B.applyBackup(parseBackup(file), null, prefsStore())
    expect(r.history).toBe(B.HISTORY_NEEDS_ACCOUNT)
  })
})

describe('restore, signed in', () => {
  it('asks the server to restore the history and shows its refusal as written', async () => {
    store.clear(); vi.resetModules()
    session.token = 't'
    const A = await import('../client/src/lib/api')
    const B = await import('../client/src/lib/backup')
    const file = JSON.stringify({ format: 'jottings-backup', version: 1, exported_at: 'x', user: { id: 6 }, outlines: [], activity_days: [{ date: '2026-10-12', active_seconds: 700, pages: 1, chapters: 1 }], activity_signature: 'ab'.repeat(32) })
    const parsed = parseBackup(file)
    vi.mocked(A.post).mockResolvedValueOnce({ restored: { days: 1, credits: 0, chapters: 0, badges: 0 } })
    expect((await B.applyBackup(parsed, { id: 6 }, prefsStore())).history).toBe('Your streak and reading history are restored.')
    expect(vi.mocked(A.post).mock.calls[0]).toEqual(['/me/restore-activity', parsed.history])
    vi.mocked(A.post).mockRejectedValueOnce(new A.ApiError(403, 'This reading history belongs to another account that is still open.'))
    expect((await B.applyBackup(parsed, { id: 7 }, prefsStore())).history).toBe('This reading history belongs to another account that is still open.')
    vi.mocked(A.post).mockRejectedValueOnce(new Error('offline'))
    expect((await B.applyBackup(parsed, { id: 6 }, prefsStore())).history).toMatch(/could not be restored just now/)
  })
})
