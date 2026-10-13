/**
 * The edition on this device (editionCore.ts has the rules): the server's last answer to GET /api/edition, kept in
 * storage and asked again on start and whenever the app comes back to the foreground. Until the first answer the stored
 * one stands; with none, the build's default (1961). The web reads its stored answer before anything renders
 * (localStorage is synchronous); native holds the first render until it is read (app/_layout.tsx).
 */
import { useSyncExternalStore } from 'react'
import { AppState, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { fetchWithTimeout, getApiBase, loadApiBase } from './api'
import { onEditionChange, parseEdition, peekEdition, setCleanseState, setEditionState, type Edition } from './editionCore'

export const EDITION_KEY = 'berean_edition'
/** The cleanse flag beside it ("1" / "0"), kept the same way. */
export const CLEANSE_KEY = 'berean_cleanse'
/** The question is small and optional: a slow server leaves the stored answer standing. */
const ASK_TIMEOUT_MS = 4_000

if (Platform.OS === 'web') {
  try {
    const e = parseEdition(globalThis.localStorage?.getItem(EDITION_KEY)); if (e) setEditionState(e)
    const c = globalThis.localStorage?.getItem(CLEANSE_KEY); if (c === '1' || c === '0') setCleanseState(c === '1')
  } catch { /* no storage: the default */ }
}

let loaded = Platform.OS === 'web'
const loadedListeners = new Set<() => void>()
let loading: Promise<Edition> | null = null
/** Reads the stored answer once. */
export function loadEdition(): Promise<Edition> {
  loading ??= Promise.all([AsyncStorage.getItem(EDITION_KEY), AsyncStorage.getItem(CLEANSE_KEY)])
    .then(([v, c]) => { const e = parseEdition(v); if (e) setEditionState(e); if (c === '1' || c === '0') setCleanseState(c === '1') }, () => {})
    .then(() => { loaded = true; loadedListeners.forEach(l => l()); return peekEdition() })
  return loading
}
const subscribeLoaded = (l: () => void) => { loadedListeners.add(l); return () => { loadedListeners.delete(l) } }
/** True once the stored answer has been read (at once on the web). */
export const useEditionLoaded = (): boolean => useSyncExternalStore(subscribeLoaded, () => loaded, () => loaded)

let asking: Promise<Edition> | null = null
/** Asks the server; a new answer is applied and kept. Offline, or on any failure, the edition stays as it is. */
export function refreshEdition(): Promise<Edition> {
  asking ??= (async () => {
    await loadEdition()
    try {
      await loadApiBase()
      const r = await fetchWithTimeout(`${getApiBase()}/api/edition`, { headers: { Accept: 'application/json' } }, ASK_TIMEOUT_MS)
      const body = r.ok ? ((await r.json()) as { edition?: unknown; cleanse?: unknown }) : null
      const e = body ? parseEdition(body.edition) : null
      if (e) {
        // an older server says nothing of the cleanse: off, as before it
        const cl = body?.cleanse === true
        setEditionState(e); setCleanseState(cl)
        AsyncStorage.setItem(EDITION_KEY, e).catch(() => {}); AsyncStorage.setItem(CLEANSE_KEY, cl ? '1' : '0').catch(() => {})
      }
    } catch { /* the stored answer stands */ }
    return peekEdition()
  })().finally(() => { asking = null })
  return asking
}

/** Asks now and on every return to the foreground (on the web, a tab shown again); returns the unsubscribe. */
export function watchEdition(): () => void {
  void refreshEdition()
  const sub = AppState.addEventListener('change', s => { if (s === 'active') void refreshEdition() })
  return () => sub.remove()
}

const subscribe = (l: () => void) => onEditionChange(() => l())
/** The edition shown, live. */
export const useEdition = (): Edition => useSyncExternalStore(subscribe, peekEdition, peekEdition)
