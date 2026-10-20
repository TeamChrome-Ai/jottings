/**
 * Thin fetch wrapper. Base URL comes from Settings (AsyncStorage override) or app.json; the bearer token
 * from SecureStore via the auth store. A 401 signs the user out (tokens carry no expiry handling beyond that).
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { defaultApiBase } from './config'
import { deviceId } from './device'
import { withEdition } from './editionCore'
import { peekLang, t } from '@shared/i18n'

export const API_BASE_KEY = 'berean_api_base'

let base = defaultApiBase()
let token: string | null = null
let onUnauthorized: (() => void) | null = null
const baseListeners = new Set<(b: string) => void>()

let baseLoad: Promise<string> | null = null
/** Reads the Settings override once; every request waits on it, so none goes to the default base before it lands. */
export function loadApiBase(): Promise<string> {
  baseLoad ??= AsyncStorage.getItem(API_BASE_KEY).then(saved => { if (saved) base = saved; return base }, () => base)
  return baseLoad
}
export function getApiBase() { return base }
export async function setApiBase(b: string) {
  await loadApiBase()
  base = b.trim().replace(/\/+$/, '') || defaultApiBase()
  cache.clear()
  if (b.trim()) await AsyncStorage.setItem(API_BASE_KEY, base)
  else await AsyncStorage.removeItem(API_BASE_KEY)
  baseListeners.forEach(l => l(base))
}
export const onApiBaseChange = (l: (b: string) => void) => { baseListeners.add(l); return () => { baseListeners.delete(l) } }

export function setToken(t: string | null) { if (t !== token) cache.clear(); token = t }
export function getToken() { return token }
export function setUnauthorizedHandler(h: (() => void) | null) { onUnauthorized = h }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
/** True for "could not reach the server" (as opposed to an HTTP error). */
export const isNetworkError = (e: unknown) => !(e instanceof ApiError)

/** React Native's Android HTTP client has no timeouts of its own, so a stalled connection would otherwise never settle. */
export const DEFAULT_TIMEOUT_MS = 15_000
export class TimeoutError extends Error {
  constructor() { super(t('The server did not answer in time. Check your connection and try again.')) }
}
/** The request never reached the server (no connection, DNS, TLS): the platform's wording ("Network request failed",
 *  "Failed to fetch") is replaced so every screen shows the same plain sentence. */
export class NetworkError extends Error {
  constructor() { super(t('No internet connection. Check Wi‑Fi or mobile data and try again.')) }
}

/** `fetch` that gives up after `ms` with a TimeoutError (a network error to `isNetworkError`); the caller's own signal still aborts it. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const ctl = new AbortController()
  const outer = init.signal
  const onAbort = () => ctl.abort()
  if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', onAbort) }
  let timedOut = false
  const t = setTimeout(() => { timedOut = true; ctl.abort() }, ms)
  try {
    return await fetch(url, { ...init, signal: ctl.signal })
  } catch (e) {
    throw timedOut ? new TimeoutError() : e
  } finally {
    clearTimeout(t)
    outer?.removeEventListener('abort', onAbort)
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const { json, timeoutMs, ...rest } = init
  // a write can change what a cached read holds (a beat moves /stats, a PUT moves /position): drop it on both sides of the request
  const write = (rest.method ?? 'GET').toUpperCase() !== 'GET'
  if (write) cache.clear()
  try {
    await loadApiBase()
    const headers: Record<string, string> = { Accept: 'application/json', ...((rest.headers as Record<string, string>) ?? {}) }
    if (json !== undefined) headers['Content-Type'] = 'application/json'
    if (token) headers['Authorization'] = `Bearer ${token}`
    // bans only (lib/device.ts): signed-in and signing-in requests, never a reader without an account
    if (token || path.startsWith('/auth/')) { const d = await deviceId(); if (d) headers['x-jottings-device'] = d }
    // the server's error messages in the app's language (rs/src/i18n.rs)
    if (peekLang() !== 'en') headers['x-jottings-lang'] = peekLang()
    let res: Response
    try {
      // a read whose answer depends on the edition names it (editionCore.ts withEdition)
      res = await fetchWithTimeout(`${base}/api${write ? path : withEdition(path)}`, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body }, timeoutMs)
    } catch (e) {
      if (e instanceof TimeoutError || (e instanceof Error && e.name === 'AbortError')) throw e
      throw new NetworkError()
    }
    if (res.status === 204) return undefined as T
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 401 && token) onUnauthorized?.()
      throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText)
    }
    return data as T
  } finally {
    if (write) cache.clear()
  }
}

export const get = <T,>(path: string, opts?: { timeoutMs?: number }) => api<T>(path, opts)
export const post = <T,>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} })
export const put = <T,>(path: string, json?: unknown) => api<T>(path, { method: 'PUT', json })
export const patch = <T,>(path: string, json?: unknown) => api<T>(path, { method: 'PATCH', json })
export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' })

const cache = new Map<string, { at: number; p: Promise<unknown> }>()
/**
 * GET for reads that screens repeat on every focus (/stats, /stats/progress, /position): concurrent and repeated
 * calls inside `ttlMs` share one request. Any write, token change or base change empties the cache, and a failed
 * request is never kept, so the next call goes to the network again.
 */
export function cachedGet<T>(path: string, { ttlMs = 30_000, timeoutMs }: { ttlMs?: number; timeoutMs?: number } = {}): Promise<T> {
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < ttlMs) return hit.p as Promise<T>
  const p = get<T>(path, { timeoutMs })
  const entry = { at: Date.now(), p }
  cache.set(path, entry)
  p.catch(() => { if (cache.get(path) === entry) cache.delete(path) })
  return p
}
