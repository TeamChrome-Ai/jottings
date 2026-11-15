import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { User } from '@shared/types'
import { get, getToken, post, setToken, setUnauthorizedHandler } from '../lib/api'
import { sendMarks } from '../lib/readMarks'
import { setReadingWith } from './readingWith'

const TOKEN_KEY = 'berean_token'
const USER_KEY = 'berean_user'
/** The most a sign-out waits on each of its requests: offline, or on a stalled connection, it goes ahead without them. */
const LEAVE_MS = 2500
const within = (p: Promise<unknown>) => Promise.race([p.catch(() => {}), new Promise(r => setTimeout(r, LEAVE_MS))])

// SecureStore has no web implementation; the web build falls back to localStorage via AsyncStorage.
const secure = {
  get: (k: string) => Platform.OS === 'web' ? AsyncStorage.getItem(k) : SecureStore.getItemAsync(k),
  set: (k: string, v: string) => Platform.OS === 'web' ? AsyncStorage.setItem(k, v) : SecureStore.setItemAsync(k, v),
  del: (k: string) => Platform.OS === 'web' ? AsyncStorage.removeItem(k) : SecureStore.deleteItemAsync(k),
}

/**
 * Who the device is signed in as, for code that runs with no screen mounted (read aloud started by a car): the
 * account's id, undefined signed out. The provider is not there to hand the stored token to the API, so it is handed
 * here when the API has none; with the provider mounted this changes nothing.
 */
export async function storedSession(): Promise<number | undefined> {
  try {
    const [t, u] = await Promise.all([secure.get(TOKEN_KEY), AsyncStorage.getItem(USER_KEY)])
    if (!t || !u) return undefined
    if (!getToken()) setToken(t)
    return (JSON.parse(u) as User).id
  } catch { return undefined }
}

interface AuthCtx {
  user: User | null; ready: boolean
  login: (handle: string, password: string) => Promise<void>
  register: (handle: string, displayName: string, password: string) => Promise<void>
  google: (idToken: string) => Promise<void>
  logout: () => Promise<void>
  /** Puts a changed profile (a new picture, a new name) in the store and on the device at once. */
  update: (u: User) => void
}
const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  const accept = useCallback(async (r: { user: User; token: string }) => {
    setToken(r.token)
    await secure.set(TOKEN_KEY, r.token)
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(r.user))
    setUser(r.user)
  }, [])
  // one sign-out at a time: a 401 to one of its own requests calls it again
  const leaving = useRef<Promise<void> | null>(null)
  const logout = useCallback(() => leaving.current ??= (async () => {
    try {
      // while the token still works: undos still waiting here are dropped once nobody is signed in, and the logout
      // ends the session it names
      await within(sendMarks())
      await within(post('/auth/logout'))
      setToken(null)
      await secure.del(TOKEN_KEY).catch(() => {})
      await AsyncStorage.removeItem(USER_KEY)
      setUser(null)
      setReadingWith(null)
    } finally { leaving.current = null }
  })(), [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [t, u] = await Promise.all([secure.get(TOKEN_KEY), AsyncStorage.getItem(USER_KEY)])
        if (cancelled || !t) return
        setToken(t)
        if (u) setUser(JSON.parse(u) as User)
        // refresh the profile when reachable; a 401 here triggers the sign-out handler
        // an unchanged profile keeps the stored object: every effect keyed on `user` would otherwise refire (refetch, beat) at startup
        // a reply after a sign-out or another sign-in is the old session's (the provider never unmounts)
        get<{ user: User }>('/me').then(r => { if (!cancelled && getToken() === t) { setUser(prev => (prev && JSON.stringify(prev) === JSON.stringify(r.user) ? prev : r.user)); AsyncStorage.setItem(USER_KEY, JSON.stringify(r.user)).catch(() => {}) } }).catch(() => {})
      } finally { if (!cancelled) setReady(true) }
    })()
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    setUnauthorizedHandler(() => { logout().catch(() => {}) })
    return () => setUnauthorizedHandler(null)
  }, [logout])

  const update = useCallback((u: User) => { setUser(u); AsyncStorage.setItem(USER_KEY, JSON.stringify(u)).catch(() => {}) }, [])
  const value = useMemo<AuthCtx>(() => ({
    user, ready, logout, update,
    login: async (handle, password) => accept(await post<{ user: User; token: string }>('/auth/login', { handle, password })),
    register: async (handle, display_name, password) => accept(await post<{ user: User; token: string }>('/auth/register', { handle, display_name, password })),
    google: async id_token => accept(await post<{ user: User; token: string }>('/auth/google', { id_token })),
  }), [user, ready, accept, logout, update])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
