/**
 * The verse a finger holds on the reader's verse index (components/VerseIndex.tsx), for the toolbar's chapter pill:
 * "John 1:29 ▾" while held, "John 1 ▾" otherwise. Module state read by the pill alone, so a scrub re-renders the pill
 * and never the chapter screen.
 */
import { useSyncExternalStore } from 'react'

let held: number | null = null
const subs = new Set<() => void>()
export const heldVerse = () => held
export function setHeldVerse(v: number | null) { if (v === held) return; held = v; for (const s of subs) s() }
const subscribe = (s: () => void) => { subs.add(s); return () => { subs.delete(s) } }
export const useHeldVerse = () => useSyncExternalStore(subscribe, heldVerse, heldVerse)
