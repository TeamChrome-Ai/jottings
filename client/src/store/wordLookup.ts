/**
 * The Word lookup switch of the ministry reader, kept for the session (not a saved preference: like the Bible reader's
 * own switch, it is a mode turned on for a study, off again by the next opening of the app). Module state, so it holds
 * across sections, works and returns to the library; `useWordLookup` subscribes a component to it.
 */
import { useSyncExternalStore } from 'react'

let on = false
const subs = new Set<() => void>()
export const wordLookupOn = () => on
export function setWordLookup(v: boolean) { if (v === on) return; on = v; for (const s of subs) s() }
const subscribe = (s: () => void) => { subs.add(s); return () => { subs.delete(s) } }
export const useWordLookup = () => useSyncExternalStore(subscribe, wordLookupOn, wordLookupOn)
