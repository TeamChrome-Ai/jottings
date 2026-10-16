import { get } from './api'
import { localOutlinesFull } from './localLibrary'
import { matchOutline, searchWords, type OutlineMatch } from './outlineMatch'
export type { OutlineMatch } from './outlineMatch'

/** The reader's jottings that hold the words: those on this device, and signed in, the account's too. Newest first. */
export async function searchOwnOutlines(q: string, signedIn: boolean, limit = 20): Promise<OutlineMatch[]> {
  const words = searchWords(q)
  if (!words.length) return []
  const [local, remote] = await Promise.all([
    localOutlinesFull().then(rows => rows.map(o => matchOutline(o, words)).filter((m): m is OutlineMatch => m !== null)).catch(() => [] as OutlineMatch[]),
    signedIn ? get<OutlineMatch[]>(`/outlines/search?q=${encodeURIComponent(q)}&limit=${limit}`).catch(() => [] as OutlineMatch[]) : Promise.resolve([] as OutlineMatch[]),
  ])
  return [...local, ...remote].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, limit)
}
