// The reader's own "read" marks on a device, and the path store that counts them (client/src/lib/readMarks.ts,
// paths.ts), against a stand-in server: signed out, at sign-in, against a server from before marks (404), offline, and
// the Home card's "Next on your path" in each of the ways it used to stay on a chapter.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const store = new Map<string, string>()
  /** The server: an account's marks and path, whether it knows marks at all, and every request it was sent. */
  const server = {
    token: null as string | null, online: true, hasMarks: true, clock: '2026-10-13T12:00:00.000Z',
    marks: new Map<string, string>(), account: { path: null, history: [], read: [] } as Record<string, unknown>, calls: [] as string[], bodies: [] as unknown[],
  }
  return { store, server }
})
vi.mock('../client/node_modules/@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => h.store.get(k) ?? null, setItem: async (k: string, v: string) => { h.store.set(k, v) },
    removeItem: async (k: string) => { h.store.delete(k) }, getAllKeys: async () => [...h.store.keys()],
  },
}))
vi.mock('../client/src/lib/api', () => {
  class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const s = h.server
    s.calls.push(`${method} ${path}`); s.bodies.push(body)
    if (!s.online) throw new Error('Network request failed')
    if (!s.token) throw new ApiError(401, 'sign in')
    if (path === '/me/path' && method === 'GET') return JSON.parse(JSON.stringify(s.account))
    const m = /^\/me\/marks(?:\/(\d+)\/(\d+))?$/.exec(path)
    if (!m || !s.hasMarks) throw new ApiError(404, 'no such API')
    const k = `${m[1]}.${m[2]}`
    if (method === 'GET') return { marks: [...s.marks].map(([key, at]) => [...key.split('.').map(Number), at]) }
    if (method === 'PUT') { s.marks.set(k, s.clock); return { ok: true, marked_at: s.clock } }
    if (method === 'DELETE') { s.marks.delete(k); return { ok: true } }
    for (const [b, c, at] of (body as { marks: [number, number, string][] }).marks) s.marks.set(`${b}.${c}`, at)
    return { ok: true }
  }
  return {
    ApiError, getToken: () => h.server.token,
    get: (p: string) => call('GET', p), cachedGet: (p: string) => call('GET', p), post: (p: string, b: unknown) => call('POST', p, b), put: (p: string, b: unknown) => call('PUT', p, b), del: (p: string) => call('DELETE', p),
  }
})
vi.mock('../client/src/store/auth', () => ({ useAuth: () => ({ user: null, ready: true }) }))
vi.mock('../client/src/lib/companion', () => ({ loadCompanionIndex: async () => null }))
vi.mock('../client/src/lib/edition', () => ({ useEdition: () => '1961' }))

const { store, server } = h
/** Lets every promise already under way finish (the stand-ins use no timers). */
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)) }
/** The app started again: modules keep what they read this launch, so a launch is a fresh module graph over the same storage. */
async function launch() {
  vi.resetModules()
  return { M: await import('../client/src/lib/readMarks'), P: await import('../client/src/lib/paths') }
}
const shown = (M: { peekMarks: () => { at: ReadonlyMap<string, string> } }) => [...M.peekMarks().at.keys()].sort()
const calls = (re: RegExp = /marks/) => server.calls.filter(c => re.test(c))
const stored = () => JSON.parse(store.get('berean_read_marks') ?? '{}') as { uid: number | null; known: unknown[]; local: unknown[]; cleared: string[] }

beforeEach(() => {
  store.clear()
  Object.assign(server, { token: null, online: true, hasMarks: true, clock: '2026-10-13T12:00:00.000Z', account: { path: null, history: [], read: [] } })
  server.marks.clear(); server.calls.length = 0; server.bodies.length = 0
})

describe('signed out', () => {
  it('a mark is kept on the device, survives a restart, is undone, and the server is never asked', async () => {
    let { M } = await launch()
    await M.loadMarks(undefined)
    await M.markRead(40, 1)
    await M.markRead(43, 3)
    await M.markRead(43, 99)   // not a chapter: nothing happens
    await settle()
    expect(shown(M)).toEqual(['40.1', '43.3'])
    ;({ M } = await launch())
    await M.loadMarks(undefined)
    expect(shown(M)).toEqual(['40.1', '43.3'])
    await M.unmarkRead(40, 1)
    await settle()
    expect([shown(M), stored().cleared, server.calls]).toEqual([['43.3'], [], []])
  })
  it('the sentence that explains a mark is said the first time only', async () => {
    const { M } = await launch()
    expect([await M.firstMark(), await M.firstMark()]).toEqual([true, false])
    expect(await (await launch()).M.firstMark()).toBe(false)
  })
})

describe('signing in', () => {
  it('carries the device’s marks into the account in one request with their times, then shows the account’s', async () => {
    let { M } = await launch()
    await M.loadMarks(undefined)
    await M.markRead(40, 1)
    await M.markRead(40, 2)
    const times = stored().local
    server.token = 't'
    server.marks.set('19.23', '2026-01-01T00:00:00.000Z')   // marked on another device before
    ;({ M } = await launch())
    await M.loadMarks(7)
    expect(calls()).toEqual(['POST /me/marks', 'GET /me/marks'])
    expect(server.bodies[0]).toEqual({ marks: times })
    expect([shown(M), stored().uid, stored().local]).toEqual([['19.23', '40.1', '40.2'], 7, []])
    // signing out again: the account's marks leave the device
    await M.loadMarks(undefined)
    expect(shown(M)).toEqual([])
  })
  it('a tap is one plain request, an undo another, and neither reads the whole list back', async () => {
    server.token = 't'
    const { M } = await launch()
    await M.loadMarks(7)
    server.calls.length = 0
    server.clock = '2026-10-13T12:00:05.000Z'
    await M.markRead(43, 3)
    expect(shown(M)).toEqual(['43.3'])   // shown before the server has answered
    await settle()
    expect([calls(), M.peekMarks().at.get('43.3'), stored().local]).toEqual([['PUT /me/marks/43/3'], '2026-10-13T12:00:05.000Z', []])
    await M.unmarkRead(43, 3)
    expect(shown(M)).toEqual([])
    await settle()
    expect([calls(), server.marks.size, stored().cleared]).toEqual([['PUT /me/marks/43/3', 'DELETE /me/marks/43/3'], 0, []])
  })
  it('a mark made on another device shows after a refresh', async () => {
    server.token = 't'
    const { M } = await launch()
    await M.loadMarks(7)
    server.marks.set('45.8', '2026-10-13T11:00:00.000Z')
    expect(shown(M)).toEqual([])
    await M.refreshMarks()
    expect(shown(M)).toEqual(['45.8'])
  })
  it('offline, marks and undos wait on the device and go up at the next refresh', async () => {
    server.token = 't'
    server.marks.set('40.1', '2026-10-01T00:00:00.000Z')
    let { M } = await launch()
    await M.loadMarks(7)
    server.online = false
    await M.markRead(40, 2)
    await M.markRead(40, 3)
    await M.unmarkRead(40, 1)
    await settle()
    expect([shown(M), stored().local.length, stored().cleared]).toEqual([['40.2', '40.3'], 2, ['40.1']])
    // the app is closed and opened again with the connection back
    server.online = true
    server.calls.length = 0
    ;({ M } = await launch())
    await M.loadMarks(7)
    expect(calls()).toEqual(['POST /me/marks', 'DELETE /me/marks/40/1', 'GET /me/marks'])
    expect([[...server.marks.keys()].sort(), shown(M), stored().local, stored().cleared]).toEqual([['40.2', '40.3'], ['40.2', '40.3'], [], []])
  })
  it('deleting the activity drops every mark from the device too', async () => {
    server.token = 't'
    server.marks.set('40.1', '2026-10-01T00:00:00.000Z')
    const { M } = await launch()
    await M.loadMarks(7)
    await M.forgetMarks()
    expect([shown(M), stored().known, stored().local]).toEqual([[], [], []])
  })
})

describe('against a server from before marks (the new app, not yet deployed to)', () => {
  it('a mark is kept on the device and shown, the server is asked once per launch and never in a loop, and it goes up once the server knows marks', async () => {
    server.token = 't'
    server.hasMarks = false
    let { M } = await launch()
    await M.loadMarks(7)
    expect(calls()).toEqual(['GET /me/marks'])   // the one 404 of this launch
    await M.markRead(40, 1)
    await M.markRead(40, 2)
    await M.unmarkRead(40, 2)
    await M.refreshMarks()
    await M.refreshMarks()
    await settle()
    expect([calls().length, shown(M), stored().local.length]).toEqual([1, ['40.1'], 1])
    // the next launch asks again, once, and keeps the mark
    server.calls.length = 0
    ;({ M } = await launch())
    await M.loadMarks(7)
    await M.refreshMarks()
    expect([calls(), shown(M)]).toEqual([['POST /me/marks'], ['40.1']])
    // the server is updated: the next launch carries the mark into the account
    server.hasMarks = true
    server.calls.length = 0
    ;({ M } = await launch())
    await M.loadMarks(7)
    expect([[...server.marks.keys()], shown(M), stored().local]).toEqual([['40.1'], ['40.1'], []])
  })
})

describe('"Next on your path" (Home’s card reads the path store)', () => {
  const GOSPELS = { id: 'gospels', started_at: '2026-10-13T08:00:00.000Z', target_date: null, pace_per_week: null, with_ministry: false, custom: null }
  const next = (P: { peekPathNext: () => { next: { book: number; chapter: number } | null } | null | undefined }) => { const n = P.peekPathNext()?.next; return n ? `${n.book}.${n.chapter}` : n }
  const onPath = async () => {
    server.token = 't'
    server.account = { path: GOSPELS, history: [], read: [], marked: [] }
    const L = await launch()
    await L.P.loadPath(7)
    await L.M.loadMarks(7)
    return L
  }

  it('a chapter read but never credited holds the card until the reader marks it; the undo puts it back', async () => {
    const { M, P } = await onPath()
    expect(next(P)).toBe('40.1')
    await M.markRead(40, 1)
    expect(next(P)).toBe('40.2')   // at once, before the server has answered
    await settle()
    expect(next(P)).toBe('40.2')
    // the reader's own next turn from Matthew 2 goes past a marked Matthew 3 as it goes past a credited one
    await M.markRead(40, 3)
    expect(P.peekNextPortion({ book: 40, chapter: 2 })).toEqual({ book: 40, chapter: 4 })
    await M.unmarkRead(40, 1)
    expect(next(P)).toBe('40.1')
  })
  it('a credit this device never saw (another device, a lost answer) moves the card when Home is shown again', async () => {
    const { P } = await onPath()
    // credited on the server; nothing told this device
    server.account = { ...server.account, read: [[40, 1]] }
    expect(next(P)).toBe('40.1')   // what it did before: the card stayed until the app was started again
    const refreshing = P.refreshPath()
    expect(next(P)).toBe('40.1')   // nothing is cleared while the answer is on its way: the card does not blink
    await refreshing
    expect(next(P)).toBe('40.2')
  })
  it('a credit the device dated before the path’s start (its clock is behind the server’s) counts once the server is asked', async () => {
    const { P } = await onPath()
    // the phone's clock reads 07:59 when the server, which stamped the start at 08:00, credits Matthew 1
    P.noteLocalRead(40, 1, '2026-10-13T07:59:00.000Z')
    await settle()
    expect(next(P)).toBe('40.1')
    server.account = { ...server.account, read: [[40, 1]] }
    await P.refreshPath()
    expect(next(P)).toBe('40.2')
  })
  it('a first load that failed is tried again on the next return, instead of showing no path until a restart', async () => {
    server.token = 't'
    server.account = { path: GOSPELS, history: [], read: [[40, 1]], marked: [] }
    server.online = false
    const { P } = await launch()
    await P.loadPath(7)
    expect(P.peekPathNext()).toBeNull()
    server.online = true
    await P.refreshPath()
    expect(next(P)).toBe('40.2')
  })
  it('offline, a refresh leaves the card as it is', async () => {
    const { P } = await onPath()
    P.noteLocalRead(40, 1, '2026-10-13T09:00:00.000Z')
    await settle()
    server.online = false
    await P.refreshPath()
    expect(next(P)).toBe('40.2')
  })
  it('against a server from before marks the mark still moves the reader’s own card', async () => {
    server.hasMarks = false
    const { M, P } = await onPath()
    await M.markRead(40, 1)
    await settle()
    expect(next(P)).toBe('40.2')
  })
  it('the server’s own list of marks stands in until this device has read its marks', async () => {
    server.token = 't'
    server.account = { path: GOSPELS, history: [], read: [], marked: [[40, 1], [40, 2]] }
    const { P } = await launch()
    await P.loadPath(7)
    expect(next(P)).toBe('40.3')
  })
  it('signed out: a chapter the device judged read moves the card, and so does a mark; nothing is sent', async () => {
    store.set('berean_path', JSON.stringify({ path: GOSPELS, history: [] }))
    const { M, P } = await launch()
    await P.loadPath(undefined)
    await M.loadMarks(undefined)
    expect(next(P)).toBe('40.1')
    P.noteLocalRead(40, 1, '2026-10-13T09:00:00.000Z')
    await settle()
    expect(next(P)).toBe('40.2')
    await M.markRead(40, 2)
    expect(next(P)).toBe('40.3')
    // the background task (the morning notice) reads the device alone and says the same
    expect((await P.localPathNext())?.next).toEqual({ book: 40, chapter: 3 })
    await P.refreshPath()
    expect(server.calls).toEqual([])
  })
})
