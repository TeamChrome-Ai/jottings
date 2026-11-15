// Verse highlights against a stand-in server (client/src/lib/highlights.ts): a tap made while the chapter's sync is on
// its way is not undone by the sync's answer, which the server gave before the tap reached it.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  /** The account's highlights, by verse id. */
  server: new Map<number, string>(),
  online: true,
  /** While set, a GET's answer (as the server held it when asked) waits for this before it arrives. */
  gate: null as Promise<void> | null,
}))
vi.mock('../client/node_modules/@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => h.store.get(k) ?? null, setItem: async (k: string, v: string) => { h.store.set(k, v) },
    removeItem: async (k: string) => { h.store.delete(k) }, getAllKeys: async () => [...h.store.keys()],
  },
}))
vi.mock('../client/src/lib/api', () => ({
  get: async () => {
    if (!h.online) throw new Error('Network request failed')
    const rows = [...h.server].map(([verse_id, color]) => ({ verse_id, color }))
    if (h.gate) await h.gate
    return rows
  },
  put: async (_path: string, body: { verse_id: number; color: string | null }) => {
    if (!h.online) throw new Error('Network request failed')
    if (body.color) h.server.set(body.verse_id, body.color); else h.server.delete(body.verse_id)
    return { ok: true }
  },
}))

type H = typeof import('../client/src/lib/highlights')
/** A fresh launch: the module's memory and recent syncs start empty over the same storage. */
async function launch(): Promise<H> { vi.resetModules(); return import('../client/src/lib/highlights') }
/** The GET under way answers only when `release` is called. */
function holdGet() { let release!: () => void; h.gate = new Promise<void>(r => { release = r }); return () => { h.gate = null; release() } }
const stored = (uid: number) => new Map((JSON.parse(h.store.get(`berean_hl:${uid}:43.3`) ?? '[]') as { verse_id: number; color: string }[]).map(r => [r.verse_id, r.color]))

const V1 = 43_003_001, V16 = 43_003_016

beforeEach(() => { h.store.clear(); h.server.clear(); h.online = true; h.gate = null })

describe('a tap while the chapter syncs', () => {
  it('stays, beside what the account had', async () => {
    const H = await launch()
    h.server.set(V1, 'blue')   // from another device
    const release = holdGet()
    const synced = H.syncHighlights(7, 43, 3)
    await H.setHighlight(7, V16, 'gold')
    release()
    const want = new Map([[V1, 'blue'], [V16, 'gold']])
    expect(await synced).toEqual(want)
    expect(await H.cachedHighlights(7, 43, 3)).toEqual(want)
    expect(stored(7)).toEqual(want)
    // the next minute's syncs are served from memory
    expect(await H.syncHighlights(7, 43, 3)).toEqual(want)
  })

  it('stays on the device when its PUT failed', async () => {
    const H = await launch()
    const release = holdGet()
    const synced = H.syncHighlights(7, 43, 3)
    h.online = false
    await expect(H.setHighlight(7, V16, 'gold')).rejects.toThrow()
    h.online = true
    release()
    expect(await synced).toEqual(new Map([[V16, 'gold']]))
    expect(await H.cachedHighlights(7, 43, 3)).toEqual(new Map([[V16, 'gold']]))
    expect(stored(7)).toEqual(new Map([[V16, 'gold']]))
  })

  it('a tint cleared stays cleared', async () => {
    const H = await launch()
    h.server.set(V1, 'blue'); h.server.set(V16, 'gold')
    expect(await H.syncHighlights(7, 43, 3)).toEqual(new Map([[V1, 'blue'], [V16, 'gold']]))
    const H2 = await launch()   // a later launch: the chapter is synced afresh
    const release = holdGet()
    const synced = H2.syncHighlights(7, 43, 3)
    await H2.setHighlight(7, V16, null)
    release()
    expect(await synced).toEqual(new Map([[V1, 'blue']]))
    expect(stored(7)).toEqual(new Map([[V1, 'blue']]))
  })
})

describe('what verses had before Ask colours them (the Undo of add_highlight)', () => {
  it('is read from the server when this device has not cached the chapter', async () => {
    h.server.set(V16, 'green')
    const hl = await launch()
    expect(await hl.tintsBefore(1, [V16, V16 + 1])).toEqual(new Map([[V16, 'green']]))
  })
  it('is unknown, not none, when the server cannot be reached', async () => {
    h.server.set(V16, 'green')
    h.online = false
    const hl = await launch()
    expect(await hl.tintsBefore(1, [V16])).toBeNull()
  })
  it('is this device’s own when nobody is signed in', async () => {
    const hl = await launch()
    await hl.setHighlight(null, V16, 'pink')
    expect(await hl.tintsBefore(null, [V16, V1])).toEqual(new Map([[V16, 'pink']]))
  })
})
