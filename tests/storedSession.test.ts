import { beforeEach, describe, expect, it, vi } from 'vitest'

// Who the device is signed in as, for read aloud started with no screen mounted (client/src/store/auth.tsx
// storedSession): the provider is not there to hand the stored token to the API.
const h = vi.hoisted(() => ({ secure: new Map<string, string>(), store: new Map<string, string>(), token: null as string | null, broken: false }))
vi.mock('../client/node_modules/expo-secure-store', () => ({
  getItemAsync: async (k: string) => { if (h.broken) throw new Error('keystore'); return h.secure.get(k) ?? null },
  setItemAsync: async (k: string, v: string) => { h.secure.set(k, v) },
  deleteItemAsync: async (k: string) => { h.secure.delete(k) },
}))
vi.mock('../client/node_modules/@react-native-async-storage/async-storage', () => ({
  default: { getItem: async (k: string) => h.store.get(k) ?? null, setItem: async (k: string, v: string) => { h.store.set(k, v) }, removeItem: async (k: string) => { h.store.delete(k) } },
}))
vi.mock('../client/node_modules/react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('../client/src/lib/api', () => ({ get: async () => ({}), post: async () => ({}), getToken: () => h.token, setToken: (t: string | null) => { h.token = t }, setUnauthorizedHandler: () => {} }))
vi.mock('../client/src/lib/readMarks', () => ({ sendMarks: async () => {} }))
vi.mock('../client/src/store/readingWith', () => ({ setReadingWith: () => {} }))

const { storedSession } = await import('../client/src/store/auth')

beforeEach(() => { h.secure.clear(); h.store.clear(); h.token = null; h.broken = false })

describe('the session kept on the device, with no screen mounted', () => {
  it('signed out: nobody, and the API is given nothing', async () => {
    expect(await storedSession()).toBeUndefined()
    expect(h.token).toBeNull()
  })

  it('signed in: the account, and its token handed to the API that has none', async () => {
    h.secure.set('berean_token', 'tok')
    h.store.set('berean_user', JSON.stringify({ id: 7, handle: 'reader' }))
    expect(await storedSession()).toBe(7)
    expect(h.token).toBe('tok')
  })

  it('leaves the token the screens have already given the API', async () => {
    h.secure.set('berean_token', 'older')
    h.store.set('berean_user', JSON.stringify({ id: 7 }))
    h.token = 'current'
    expect(await storedSession()).toBe(7)
    expect(h.token).toBe('current')
  })

  it('half a session, or a store that cannot be read, is nobody', async () => {
    h.secure.set('berean_token', 'tok')
    expect(await storedSession()).toBeUndefined()
    expect(h.token).toBeNull()
    h.store.set('berean_user', JSON.stringify({ id: 7 }))
    h.broken = true
    expect(await storedSession()).toBeUndefined()
    expect(h.token).toBeNull()
  })
})
