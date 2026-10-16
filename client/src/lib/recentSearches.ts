// The last few searches, on this device only (never sent anywhere): shown folded under an empty search field.
import AsyncStorage from '@react-native-async-storage/async-storage'

export const RECENT_MAX = 3
const KEY = 'berean_recent_searches'

/** `q` first, a same search (case and spacing aside) not kept twice, at most `RECENT_MAX`. */
export function pushRecent(list: readonly string[], q: string, max = RECENT_MAX): string[] {
  const t = q.trim().replace(/\s+/g, ' ')
  if (!t) return [...list]
  const k = t.toLowerCase()
  return [t, ...list.filter(x => x.toLowerCase() !== k)].slice(0, max)
}
export const dropRecent = (list: readonly string[], q: string): string[] => list.filter(x => x !== q)

export async function loadRecent(): Promise<string[]> {
  try { const v = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [] }
  catch { return [] }
}
export const saveRecent = (list: readonly string[]) => AsyncStorage.setItem(KEY, JSON.stringify(list.slice(0, RECENT_MAX))).catch(() => {})
