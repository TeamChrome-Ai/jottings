import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Bookmark } from '../shared/types'

// the device's storage, the API and the highlight cache, as the local library sees them
const store = new Map<string, string>()
vi.mock('../client/node_modules/@react-native-async-storage/async-storage', () => ({
  default: { getItem: async (k: string) => store.get(k) ?? null, setItem: async (k: string, v: string) => { store.set(k, v) } },
}))
vi.mock('../client/src/lib/api', () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }))
vi.mock('../client/src/lib/highlights', () => ({ adoptLocalHighlights: vi.fn(), localHighlightChapters: async () => [] }))

import { get, post } from '../client/src/lib/api'
import { addLocalBookmark, localBookmarks, mergeLocalLibrary } from '../client/src/lib/localLibrary'
import { bookmarkIds, bookmarkKey, bookmarkKind, bookmarkPlace, bookmarkTitle, groupBookmarks, markedVerses } from '../client/src/lib/bookmarks'

const bm = (id: number, book: number, chapter: number | null, verse: number | null, created_at: string): Bookmark => ({ id, book, chapter, verse, label: null, color: null, created_at })

describe('bookmark kinds', () => {
  it('tells a verse, a chapter and a book apart by what is null', () => {
    expect([bookmarkKind({ book: 43, chapter: 3, verse: 16 }), bookmarkKind({ book: 43, chapter: 3, verse: null }), bookmarkKind({ book: 43 })]).toEqual(['verse', 'chapter', 'book'])
    expect([bookmarkKey({ book: 43, chapter: 3, verse: 16 }), bookmarkKey({ book: 43, chapter: 3 }), bookmarkKey({ book: 43, chapter: null, verse: null })]).toEqual(['43.3.16', '43.3', '43'])
    expect([bookmarkTitle({ book: 1 }), bookmarkTitle({ book: 1, chapter: 1 }), bookmarkTitle({ book: 43, chapter: 3, verse: 16 }), bookmarkTitle({ book: 65, chapter: 1, verse: 3 })])
      .toEqual(['Genesis', 'Genesis 1', 'John 3:16', 'Jude 3'])
  })
  it('groups books, chapters and verses in that order, only those that exist, newest first', () => {
    const list = [bm(1, 43, 3, 16, '2026-09-01'), bm(2, 19, 23, null, '2026-09-02'), bm(3, 43, 1, 1, '2026-09-03'), bm(4, 1, 5, null, '2026-09-01')]
    expect(groupBookmarks(list).map(g => [g.title, g.items.map(b => b.id)])).toEqual([['Chapters', [2, 4]], ['Verses', [3, 1]]])
    expect(groupBookmarks([...list, bm(5, 45, null, null, '2026-08-01')]).map(g => g.title)).toEqual(['Books', 'Chapters', 'Verses'])
    expect(groupBookmarks([])).toEqual([])
  })
  it('opens a verse at the verse, a chapter at its top, a book where you last were in it', () => {
    const last = { book: 19, chapter: 23, verse: 4 }
    expect(bookmarkPlace({ book: 43, chapter: 3, verse: 16 }, last)).toEqual({ book: 43, chapter: 3, verse: 16 })
    expect(bookmarkPlace({ book: 43, chapter: 3 }, last)).toEqual({ book: 43, chapter: 3, verse: null })
    expect(bookmarkPlace({ book: 19 }, last)).toEqual({ book: 19, chapter: 23, verse: 4 })
    expect(bookmarkPlace({ book: 43 }, last)).toEqual({ book: 43, chapter: 1, verse: null })
    expect(bookmarkPlace({ book: 43 }, null)).toEqual({ book: 43, chapter: 1, verse: null })
  })
  it('marks the verses of the open chapter only, not the chapter or the book', () => {
    const marks = bookmarkIds([bm(1, 43, 3, 16, 'a'), bm(2, 43, 3, null, 'b'), bm(3, 43, null, null, 'c'), bm(4, 43, 31, 2, 'd'), bm(5, 43, 3, 2, 'e')])
    expect([...markedVerses(marks, 43, 3)].sort((a, b) => a - b)).toEqual([2, 16])
    expect(markedVerses(marks, 43, 31)).toEqual(new Set([2]))
  })
})

describe('bookmarks on the device', () => {
  beforeEach(() => { vi.mocked(get).mockReset(); vi.mocked(post).mockReset() })
  it('keeps one per verse, chapter and book, and carries each kind into the account once', async () => {
    const verse = await addLocalBookmark({ book: 43, chapter: 3, verse: 16 })
    const chapter = await addLocalBookmark({ book: 43, chapter: 3 })
    const book = await addLocalBookmark({ book: 43, chapter: null, verse: 7 })
    expect([verse.id, chapter.id, book.id].every(id => id < 0)).toBe(true)
    expect([book.chapter, book.verse]).toEqual([null, null])
    // a repeat of each is the row already there
    expect((await addLocalBookmark({ book: 43, chapter: 3, verse: 16 })).id).toBe(verse.id)
    expect((await addLocalBookmark({ book: 43, chapter: 3, verse: null })).id).toBe(chapter.id)
    expect((await addLocalBookmark({ book: 43 })).id).toBe(book.id)
    expect((await localBookmarks()).map(bookmarkKey).sort()).toEqual(['43', '43.3', '43.3.16'])

    // the account already has the chapter: only the verse and the book go up, each with its own nulls
    vi.mocked(get).mockResolvedValue([bm(9, 43, 3, null, '2026-01-01')])
    vi.mocked(post).mockResolvedValue({})
    const r = await mergeLocalLibrary(1)
    expect(r.bookmarks).toBe(3)
    expect(vi.mocked(post).mock.calls).toEqual([
      ['/bookmarks', { book: 43, chapter: 3, verse: 16, label: null }],
      ['/bookmarks', { book: 43, chapter: null, verse: null, label: null }],
    ])
    expect(await localBookmarks()).toEqual([])
  })
})
