import { useSyncExternalStore } from 'react'

/**
 * The news of an update as it is shown: no run, or one (the launch's own, or "What is new" in Settings). It lives
 * outside React because the root layout remounts every screen for a new language or Bible: a run in flight must not be
 * lost by that, and neither a finished one nor the launch's question may start again. Whether the device has seen the
 * news is the `seenNew` pref; a replay never touches it.
 */
export interface NewsRun { key: number; replay: boolean }
let run: NewsRun | null = null
let runs = 0
let asked = false
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const get = () => run
const put = (r: NewsRun | null) => { run = r; listeners.forEach(fn => fn()) }

/** Each run is a new key, so the scenes start from the top even if they are showing. */
export function playNews(replay = true) { put({ key: ++runs, replay }) }
export function closeNews() { if (run) put(null) }
export function useNewsRun(): NewsRun | null { return useSyncExternalStore(subscribe, get, get) }

/** Whether this launch has already settled if the news is due: it is asked once, however often the shell mounts. */
export const newsAsked = () => asked
export function markNewsAsked() { asked = true }
