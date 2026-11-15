// The reader's own "read" marks on a device, and the path store that counts them (client/src/lib/readMarks.ts,
// paths.ts), against a stand-in server: signed out, at sign-in, against a server from before marks (404), offline, and
// the Home card's "Next on your path" in each of the ways it used to stay on a chapter.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextOnPath, type PathState } from '../shared/paths'

const h = vi.hoisted(() => {
  const store = new Map<string, string>()
  /** The server: an account's marks and path, whether it knows marks at all, and every request it was sent; the badges
   *  the next mark earns, and an answer it is holding back. */
  const server = {
    token: null as string | null, uid: 7 as number | undefined, online: true, hasMarks: true, clock: '2026-10-13T12:00:00.000Z',
    marks: new Map<string, string>(), account: { path: null, history: [], read: [] } as Record<string, unknown>, calls: [] as string[], bodies: [] as unknown[],
    badges: [] as { code: string; name: string }[], hold: null as Promise<void> | null,
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
    if (s.hold) await s.hold
    if (!s.online) throw new Error('Network request failed')
    if (!s.token) throw new ApiError(401, 'sign in')
    if (path === '/me/path' && method === 'GET') return JSON.parse(JSON.stringify(s.account))
    const m = /^\/me\/marks(?:\/(\d+)\/(\d+))?$/.exec(path)
    if (!m || !s.hasMarks) throw new ApiError(404, 'no such API')
    const k = `${m[1]}.${m[2]}`
    if (method === 'GET') return { marks: [...s.marks].map(([key, at]) => [...key.split('.').map(Number), at]) }
    if (method === 'PUT') { s.marks.set(k, s.clock); return { ok: true, marked_at: s.clock, new_badges: s.badges.splice(0) } }
    if (method === 'DELETE') { s.marks.delete(k); return { ok: true } }
    for (const [b, c, at] of (body as { marks: [number, number, string][] }).marks) s.marks.set(`${b}.${c}`, at)
    return { ok: true, new_badges: s.badges.splice(0) }
  }
  return {
    ApiError, getToken: () => h.server.token,
    get: (p: string) => call('GET', p), cachedGet: (p: string) => call('GET', p), post: (p: string, b: unknown) => call('POST', p, b), put: (p: string, b: unknown) => call('PUT', p, b), del: (p: string) => call('DELETE', p),
  }
})
vi.mock('../client/src/store/auth', () => ({ useAuth: () => ({ user: null, ready: true }), storedSession: async () => (h.server.token ? h.server.uid : undefined) }))
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
  Object.assign(server, { token: null, online: true, hasMarks: true, clock: '2026-10-13T12:00:00.000Z', account: { path: null, history: [], read: [] }, badges: [], hold: null })
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
  it('a device told the sentence from before (a mark earned nothing) hears the new one once', async () => {
    store.set('berean_mark_explained', '1')
    const { M } = await launch()
    expect([await M.firstMark(), await M.firstMark()]).toEqual([true, false])
  })
  it('nothing is said to have reached an account, and no badge comes back', async () => {
    const { M } = await launch()
    await M.loadMarks(undefined)
    let sent = 0
    M.onMarksSent(() => sent++)
    expect([await M.markRead(45, 5), await M.unmarkRead(45, 5), sent]).toEqual([[], [], 0])
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
    let answer = () => {}
    server.hold = new Promise<void>(r => { answer = r })
    const sent = M.markRead(43, 3)
    await settle()
    expect([shown(M), server.marks.size]).toEqual([['43.3'], 0])   // shown before the server has answered
    server.hold = null
    answer()
    expect(await sent).toEqual([])
    expect([calls(), M.peekMarks().at.get('43.3'), stored().local]).toEqual([['PUT /me/marks/43/3'], '2026-10-13T12:00:05.000Z', []])
    await M.unmarkRead(43, 3)
    expect(shown(M)).toEqual([])
    await settle()
    expect([calls(), server.marks.size, stored().cleared]).toEqual([['PUT /me/marks/43/3', 'DELETE /me/marks/43/3'], 0, []])
  })
  it('a mark counts as the chapter read: the badges it earns come back to the tap that made it, once', async () => {
    server.token = 't'
    const { M } = await launch()
    await M.loadMarks(7)
    server.badges = [{ code: 'book_57', name: 'Philemon' }]
    expect(await M.markRead(57, 1)).toEqual([{ code: 'book_57', name: 'Philemon' }])
    expect(await M.markRead(45, 1)).toEqual([])
    // offline taps wait; the one that finds the connection back carries them all up in one bulk, with its badges
    server.online = false
    await M.markRead(45, 2)
    server.online = true
    server.badges = [{ code: 'chapters_3', name: 'Three chapters' }]
    expect(await M.markRead(45, 3)).toEqual([{ code: 'chapters_3', name: 'Three chapters' }])
    expect(calls().slice(-1)).toEqual(['GET /me/marks'])
    expect(calls().filter(c => c === 'POST /me/marks')).toHaveLength(1)
  })
  it('says when marks and undos reach the account, so a screen holding its credits asks again', async () => {
    server.token = 't'
    const { M } = await launch()
    await M.loadMarks(7)
    let sent = 0
    const off = M.onMarksSent(() => sent++)
    await M.markRead(45, 5)
    await M.unmarkRead(45, 5)
    await M.refreshMarks()   // nothing went up
    server.online = false
    await M.markRead(45, 6)   // nothing reached the server
    expect(sent).toBe(2)
    off()
    server.online = true
    await M.refreshMarks()
    expect(sent).toBe(2)
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
    expect(P.peekPathNextAfter(40, 2)).toEqual({ book: 40, chapter: 4 })
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

// Read aloud goes on into the path's next portion (docs/PATHS.md rule 3) when a car started the app and no screen is
// mounted: no hook has loaded the path, so read aloud asks for it itself (pathForReadAloud).
describe('the path for read aloud, with no screen mounted', () => {
  const at = (id: string, more: Record<string, unknown> = {}) => ({ id, started_at: '2026-09-01T00:00:00Z', target_date: null, pace_per_week: null, with_ministry: false, ...more })
  const LIFE = at('life-of-christ'), COATES = at('coates'), OWN = at('custom', { custom: { title: 'Mine', books: [45, 58] } })
  const signedIn = (path: unknown) => { server.token = 't'; server.account = { path, history: [], read: [] } }

  it('until it has been asked for, a chapter has no next portion and the Bible\'s order applies', async () => {
    store.set('berean_path', JSON.stringify({ path: LIFE, history: [] }))
    const { P } = await launch()
    expect(P.peekPathNextAfter(40, 2)).toBeNull()
  })

  it('signed out: the path kept on the device, and the server is not asked', async () => {
    store.set('berean_path', JSON.stringify({ path: LIFE, history: [] }))
    const { P } = await launch()
    await P.pathForReadAloud()
    const next = P.peekPathNextAfter(40, 2)
    expect(next).toMatchObject({ book: 42, chapter: 1 })       // the life of Christ: Luke 1 after Matthew 2, not Matthew 3
    expect(server.calls).toEqual([])
  })

  it('signed in: the account\'s path, Coates\'s order from Nehemiah to the Psalms and a path of chosen books into the next book', async () => {
    signedIn(COATES)
    let { P } = await launch()
    await P.pathForReadAloud()
    // Coates's order leaves Esther and Job out: after Nehemiah come the Psalms, not Esther 1
    expect(P.peekPathNextAfter(16, 13)).toMatchObject(nextOnPath(COATES as PathState, new Set(), 16, 13)!)
    expect(P.peekPathNextAfter(16, 13)).toMatchObject({ book: 19, chapter: 1 })
    signedIn(OWN)
    ;({ P } = await launch())
    await P.pathForReadAloud()
    expect(P.peekPathNextAfter(45, 16)).toMatchObject({ book: 58, chapter: 1 })   // Romans, then Hebrews: not 1 Corinthians 1
  })

  it('asked again by each start, it asks the server once', async () => {
    signedIn(LIFE)
    const { P } = await launch()
    await P.pathForReadAloud()
    await P.pathForReadAloud()
    await P.pathForReadAloud()
    expect(calls(/path/)).toEqual(['GET /me/path'])
  })

  it('an account\'s path that cannot be fetched: the asking ends, the Bible\'s order applies, and the next start asks again', async () => {
    signedIn(LIFE)
    server.online = false
    const { P } = await launch()
    await P.pathForReadAloud()
    expect(P.peekPathNextAfter(40, 2)).toBeNull()
    await P.pathForReadAloud()
    expect(P.peekPathNextAfter(40, 2)).toBeNull()
    server.online = true
    await P.pathForReadAloud()
    expect(P.peekPathNextAfter(40, 2)).toMatchObject({ book: 42, chapter: 1 })
  })

  it('the path a screen has loaded already is left as it is', async () => {
    signedIn(LIFE)
    const { P } = await launch()
    await P.loadPath(7)
    server.calls.length = 0
    await P.pathForReadAloud()
    expect(server.calls).toEqual([])
    expect(P.peekPathNextAfter(40, 2)).toMatchObject({ book: 42, chapter: 1 })
  })
})
