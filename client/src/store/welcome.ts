import { useSyncExternalStore } from 'react'

/**
 * The welcome as it is shown: no run, or one (a device's first launch, or "Welcome" in Settings). It lives outside
 * React because the root layout remounts every screen once the Bible shown is known, and again for a new language: on
 * the web that first remount comes just after the first launch's run has started and `onboarded` is stored, and a run
 * held in the component was lost to it, so a new device never saw the welcome. The first-launch showing is the
 * `onboarded` pref; a replay never touches it.
 */
export interface WelcomeRun { key: number; replay: boolean }
let run: WelcomeRun | null = null
let replays = 0
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const get = () => run
const put = (r: WelcomeRun | null) => { run = r; listeners.forEach(fn => fn()) }

/** The first launch's own run. */
export function startWelcome() { put({ key: 0, replay: false }) }
/** Each replay is a new key, so the welcome restarts from the top even if it is showing. */
export function playWelcome() { put({ key: ++replays, replay: true }) }
export function closeWelcome() { if (run) put(null) }
export function useWelcomeRun(): WelcomeRun | null { return useSyncExternalStore(subscribe, get, get) }
