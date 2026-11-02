/**
 * The group a reader is reading to right now (report #33: parents reading to a child from either phone). While it is
 * set, every beat names the group and a chapter read through is credited to the group's shared log, not to the reader
 * (docs/READING.md, "Reading with a group"). Memory only: the app starting again turns it off, so it cannot be left on
 * for days by mistake.
 */
import { useSyncExternalStore } from 'react'

export interface ReadingWith { groupId: number; name: string; slug: string }

let current: ReadingWith | null = null
const subs = new Set<() => void>()
export const readingWith = () => current
export function setReadingWith(g: ReadingWith | null) { if (g?.groupId === current?.groupId) return; current = g; for (const s of subs) s() }
/** The reader's groups as last loaded: a group that is gone (left, removed, deleted) takes the toggle with it. */
export function keepReadingWithAmong(groups: readonly { id: number }[]) { if (current && !groups.some(g => g.id === current?.groupId)) setReadingWith(null) }
const subscribe = (s: () => void) => { subs.add(s); return () => { subs.delete(s) } }
export const useReadingWith = () => useSyncExternalStore(subscribe, readingWith, readingWith)
