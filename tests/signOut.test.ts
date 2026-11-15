// Signing out (client/src/store/auth.tsx logout) against a stand-in server reached through the real request layer
// (client/src/lib/api.ts) and the real marks store (client/src/lib/readMarks.ts): what waits for the account goes up and
// the logout names the session it ends, both while the token is still set. React's hooks are stood in for so the
// provider's own `logout` can be called as the app calls it.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  server: {
    online: true, sessions: new Set<string>(), marks: new Map<string, string>(),
    /** A connection that takes requests and never answers them. */
    stalled: false,
    /** Every request that reached the server: method, path, and its Authorization header. */
    requests: [] as string[],
    /** While set, GET /me is answered as the server saw it on arrival, once this settles. */
    meLate: null as null | Promise<void>,
  },
  /** The provider's context value, as the last render made it. */
  ctx: null as null | { logout: () => Promise<void>; login: (handle: string, password: string) => Promise<void> },
  /** The provider's state in the order its hooks ask for it: the reader first. */
  states: [] as { v: unknown }[],
}))
vi.mock('../client/node_modules/@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => h.store.get(k) ?? null, setItem: async (k: string, v: string) => { h.store.set(k, v) },
    removeItem: async (k: string) => { h.store.delete(k) }, getAllKeys: async () => [...h.store.keys()],
  },
}))
vi.mock('../client/node_modules/expo-secure-store', () => ({
  getItemAsync: async (k: string) => h.store.get(k) ?? null, setItemAsync: async (k: string, v: string) => { h.store.set(k, v) },
  deleteItemAsync: async (k: string) => { h.store.delete(k) },
}))
vi.mock('../client/node_modules/react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('../client/node_modules/react', () => ({
  createContext: () => ({ Provider: 'Provider' }), useContext: () => null,
  useState: (v: unknown) => {
    const cell = { v }; h.states.push(cell)
    return [v, (x: unknown) => { cell.v = typeof x === 'function' ? (x as (p: unknown) => unknown)(cell.v) : x }]
  },
  useCallback: (f: unknown) => f, useRef: (v: unknown) => ({ current: v }),
  useMemo: (f: () => unknown) => { const v = f(); h.ctx = v as typeof h.ctx; return v },
  useEffect: (f: () => void) => { f() },
}))
vi.mock('../client/src/lib/config', () => ({ defaultApiBase: () => 'https://srv' }))
vi.mock('../client/src/lib/device', () => ({ deviceId: async () => null }))
vi.mock('../client/src/store/readingWith', () => ({ setReadingWith: () => {} }))

const { store, server } = h
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
  if (!server.online) throw new TypeError('Network request failed')
  const method = init.method ?? 'GET', path = url.replace('https://srv/api', '').split('?')[0]
  const auth = (init.headers as Record<string, string>).Authorization ?? null
  server.requests.push(`${method} ${path} ${auth ?? '-'}`)
  if (server.stalled) return new Promise<Response>((_, fail) => init.signal?.addEventListener('abort', () => fail(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  const tok = auth?.replace('Bearer ', '') ?? null
  if (path === '/auth/login') { server.sessions.add('tok2'); return json(200, { user: { id: 8 }, token: 'tok2' }) }
  if (path === '/me' && server.meLate) {
    const answer = tok && server.sessions.has(tok) ? json(200, { user: { id: 7 } }) : json(401, { error: 'sign in' })
    await server.meLate
    return answer
  }
  // the logout ends the session it names (rs/src/routes.rs); with none named it ends nothing and still answers ok
  if (path === '/auth/logout') { if (tok) server.sessions.delete(tok); return json(200, { ok: true }) }
  if (!tok || !server.sessions.has(tok)) return json(401, { error: 'sign in' })
  if (path === '/me') return json(200, { user: { id: 7 } })
  const m = /^\/me\/marks(?:\/(\d+)\/(\d+))?$/.exec(path)
  if (!m) return json(404, { error: 'no such API' })
  if (method === 'GET') return json(200, { marks: [...server.marks].map(([k, at]) => [...k.split('.').map(Number), at]) })
  if (method === 'DELETE') { server.marks.delete(`${m[1]}.${m[2]}`); return json(200, { ok: true }) }
  if (method === 'PUT') { server.marks.set(`${m[1]}.${m[2]}`, '2026-10-13T12:00:00.000Z'); return json(200, { ok: true }) }
  return json(404, { error: 'no such API' })
})

/** Lets every promise already under way finish. */
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)) }
/** The app started on a device where reader 7 is signed in with `tok`: the provider restores the session. */
async function launch() {
  vi.resetModules()
  h.states.length = 0
  const A = await import('../client/src/lib/api')
  const M = await import('../client/src/lib/readMarks')
  const { AuthProvider } = await import('../client/src/store/auth')
  AuthProvider({ children: null })
  await settle()
  return { A, M, logout: () => h.ctx!.logout() }
}
/** The reader the provider holds. */
const reader = () => h.states[0].v
const shown = (M: { peekMarks: () => { at: ReadonlyMap<string, string> } }) => [...M.peekMarks().at.keys()].sort()

beforeEach(() => {
  store.clear(); store.set('berean_token', 'tok'); store.set('berean_user', JSON.stringify({ id: 7 }))
  Object.assign(server, { online: true, stalled: false, meLate: null }); server.sessions.clear(); server.sessions.add('tok')
  server.marks.clear(); server.marks.set('43.3', '2026-10-12T12:00:00.000Z'); server.requests.length = 0
  h.ctx = null
})

describe('signing out', () => {
  it('sends an undo still waiting, then the logout, both with the session they are for', async () => {
    const { A, M, logout } = await launch()
    expect(A.getToken()).toBe('tok')
    await M.loadMarks(7)
    expect(shown(M)).toEqual(['43.3'])
    server.online = false
    await M.unmarkRead(43, 3)
    expect(shown(M)).toEqual([])
    server.online = true
    server.requests.length = 0
    await logout()
    await M.loadMarks(undefined)   // useMarks, as the reader goes
    expect(server.requests).toEqual(['DELETE /me/marks/43/3 Bearer tok', 'POST /auth/logout Bearer tok'])
    expect(server.marks.has('43.3')).toBe(false)
    expect(server.sessions.has('tok')).toBe(false)
    expect(A.getToken()).toBe(null)
    expect(store.has('berean_token')).toBe(false)
    // the same reader signs in again: the chapter stays unmarked
    server.sessions.add('tok2'); A.setToken('tok2')
    await M.loadMarks(7)
    expect(shown(M)).toEqual([])
  })

  it('on a connection that never answers, goes ahead after a few seconds', async () => {
    const { A, M, logout } = await launch()
    await M.loadMarks(7)
    server.online = false
    await M.unmarkRead(43, 3)
    server.online = true; server.stalled = true
    server.requests.length = 0
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let over = false
      void logout().then(() => { over = true })
      await vi.advanceTimersByTimeAsync(2400)
      expect(over).toBe(false)
      await vi.advanceTimersByTimeAsync(2700)
      expect(over).toBe(true)
    } finally { vi.useRealTimers() }
    expect(server.requests).toEqual(['DELETE /me/marks/43/3 Bearer tok', 'POST /auth/logout Bearer tok'])
    expect(A.getToken()).toBe(null)
  })

  it('when the server has ended the session already, asks once and signs out', async () => {
    const { A, M, logout } = await launch()
    await M.loadMarks(7)
    server.online = false
    await M.unmarkRead(43, 3)
    server.online = true
    server.sessions.clear()
    server.requests.length = 0
    await logout()
    await settle()
    expect(server.requests).toEqual(['DELETE /me/marks/43/3 Bearer tok', 'POST /auth/logout Bearer tok'])
    expect(A.getToken()).toBe(null)
  })
})

describe('the profile asked for at start', () => {
  let answer!: () => void
  beforeEach(() => { server.meLate = new Promise<void>(r => { answer = r }) })

  it('refreshes the reader while the session it was asked for stands', async () => {
    store.set('berean_user', JSON.stringify({ id: 7, display_name: 'old' }))
    await launch()
    answer(); await settle()
    expect(reader()).toEqual({ id: 7 })
    expect(JSON.parse(store.get('berean_user')!)).toEqual({ id: 7 })
  })

  it('answering after a sign-out and another reader’s sign-in, is neither shown nor kept', async () => {
    const { A, logout } = await launch()
    await logout()
    await h.ctx!.login('ruth', 'pw')
    expect(A.getToken()).toBe('tok2')
    answer(); await settle()
    expect(reader()).toEqual({ id: 8 })
    expect(JSON.parse(store.get('berean_user')!)).toEqual({ id: 8 })
  })

  it('answering after a sign-out, leaves nobody signed in on the device', async () => {
    const { A, logout } = await launch()
    await logout()
    answer(); await settle()
    expect(A.getToken()).toBe(null)
    expect(reader()).toBe(null)
    expect(store.has('berean_user')).toBe(false)
  })

  it('refused for a session that has since been replaced, does not sign the new one out', async () => {
    server.sessions.clear()   // the session the device kept had ended on the server
    const { A, logout } = await launch()
    await logout()
    await h.ctx!.login('ruth', 'pw')
    server.requests.length = 0
    answer(); await settle()
    expect(server.requests).toEqual([])
    expect(server.sessions.has('tok2')).toBe(true)
    expect(A.getToken()).toBe('tok2')
    expect(reader()).toEqual({ id: 8 })
  })
})
