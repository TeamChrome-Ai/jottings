import { useSyncExternalStore } from 'react'

/**
 * "Play the welcome again" (Settings): a request that lives for this launch only. The first-launch showing is the
 * `onboarded` pref; a replay never touches it.
 */
let replay = 0
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const get = () => replay

export function playWelcome() { replay++; listeners.forEach(fn => fn()) }
/** A counter: each replay request is a new value, so the welcome restarts from the top even if it is showing. */
export function useWelcomeReplay(): number { return useSyncExternalStore(subscribe, get, get) }
