import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '@shared/types'
import { get, post, setToken, setUnauthorizedHandler } from '../lib/api'

const TOKEN_KEY = 'berean_token'
const USER_KEY = 'berean_user'

// SecureStore has no web implementation; the web build falls back to localStorage via AsyncStorage.
const secure = {
  get: (k: string) => Platform.OS === 'web' ? AsyncStorage.getItem(k) : SecureStore.getItemAsync(k),
  set: (k: string, v: string) => Platform.OS === 'web' ? AsyncStorage.setItem(k, v) : SecureStore.setItemAsync(k, v),
  del: (k: string) => Platform.OS === 'web' ? AsyncStorage.removeItem(k) : SecureStore.deleteItemAsync(k),
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
  const logout = useCallback(async () => {
    post('/auth/logout').catch(() => {})
    setToken(null)
    await secure.del(TOKEN_KEY).catch(() => {})
    await AsyncStorage.removeItem(USER_KEY)
    setUser(null)
  }, [])

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
        get<{ user: User }>('/me').then(r => { if (!cancelled) { setUser(prev => (prev && JSON.stringify(prev) === JSON.stringify(r.user) ? prev : r.user)); AsyncStorage.setItem(USER_KEY, JSON.stringify(r.user)).catch(() => {}) } }).catch(() => {})
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
