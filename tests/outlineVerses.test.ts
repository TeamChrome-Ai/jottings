// The verse text a jotting shows (client/src/lib/outlines.ts fetchVerseRows) follows the Bible the reader reads: after
// a switch of Bible or of English edition it is the new one's wording, not the one held from before.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ source: '1961', listeners: new Set<() => void>(), fetched: [] as string[] }))
vi.mock('../client/node_modules/@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {} } }))
vi.mock('../client/node_modules/react-native', () => ({ Platform: { OS: 'android' }, Alert: { alert: () => {} } }))
vi.mock('../client/node_modules/expo-clipboard', () => ({}))
vi.mock('../client/node_modules/expo-router', () => ({ router: {} }))
vi.mock('../client/src/i18n', () => ({ dateLocale: () => 'en' }))
vi.mock('../client/src/lib/api', () => ({ ApiError: class extends Error {}, get: vi.fn(), getApiBase: () => '' }))
vi.mock('../client/src/lib/library', () => ({ NotOnDevice: class extends Error {}, getOwnOutline: vi.fn(), isLocalId: () => false, saveOutlineItems: vi.fn() }))
vi.mock('../client/src/lib/text', () => ({
  peekSource: () => h.source,
  onSourceChange: (l: () => void) => { h.listeners.add(l); return () => { h.listeners.delete(l) } },
}))
// each Bible's John 3:16, as the chapter files hold it
vi.mock('../client/src/lib/bible', () => ({
  fetchChapter: async (book: number, chapter: number, e: string = h.source) => {
    h.fetched.push(`${e}:${book}.${chapter}`)
    return { verses: [{ v: 16, t: `${e} John 3:16` }] }
  },
}))

import { fetchVerseRows } from '../client/src/lib/outlines'

/** The reader picks another Bible, as lib/text.ts says it. */
const switchTo = (s: string) => { h.source = s; h.listeners.forEach(l => l()) }

beforeEach(() => { h.fetched.length = 0 })

describe('a jotting\'s verse text', () => {
  it('is the wording of the Bible read now', async () => {
    const ref = { book: 43, chapter: 3, v1: 16 }
    expect((await fetchVerseRows(ref))[0].t).toBe('1961 John 3:16')
    switchTo('fr')
    expect((await fetchVerseRows(ref))[0].t).toBe('fr John 3:16')
    switchTo('1890')
    expect((await fetchVerseRows(ref))[0].t).toBe('1890 John 3:16')
    // what was read for a Bible is still held for it
    switchTo('fr')
    expect((await fetchVerseRows(ref))[0].t).toBe('fr John 3:16')
    expect(h.fetched).toEqual(['1961:43.3', 'fr:43.3', '1890:43.3'])
  })
})
