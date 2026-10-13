/**
 * Verse highlights: the server is the source of truth (`GET/PUT /api/highlights`), but every chapter's
 * tints are mirrored in memory and AsyncStorage so they still show when offline. Keys carry the user id
 * so a sign-out never leaks the previous reader's colours. Signed out (`uid` null) the device copy under
 * `local` is the only copy; `localLibrary.mergeLocalLibrary()` carries it into the account at sign-in.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { get, put } from './api'

export type HighlightMap = Map<number, string>
type Row = { verse_id: number; color: string }

const PREFIX = 'berean_hl:'
const mem = new Map<string, HighlightMap>()
/** What AsyncStorage holds per key, so an unchanged sync skips the write. */
const written = new Map<string, string>()
/** A signed-in user's id, or null for highlights kept on this device only. */
export type HighlightOwner = number | null
const LOCAL = 'local'
const storageKey = (uid: HighlightOwner, book: number, chapter: number) => `${PREFIX}${uid ?? LOCAL}:${book}.${chapter}`

export const verseIdOf = (book: number, chapter: number, verse: number) => book * 1_000_000 + chapter * 1000 + verse
export const chapterOf = (verseId: number) => ({ book: Math.floor(verseId / 1_000_000), chapter: Math.floor((verseId % 1_000_000) / 1000), verse: verseId % 1000 })

/** The cached tints for a chapter (memory, then storage); empty when nothing is known. */
export async function cachedHighlights(uid: HighlightOwner, book: number, chapter: number): Promise<HighlightMap> {
  const k = storageKey(uid, book, chapter)
  const hit = mem.get(k)
  if (hit) return new Map(hit)
  try {
    const raw = await AsyncStorage.getItem(k)
    if (raw) written.set(k, raw)
    const rows = raw ? (JSON.parse(raw) as Row[]) : []
    const m: HighlightMap = new Map(rows.map(r => [r.verse_id, r.color]))
    mem.set(k, m)
    return new Map(m)
  } catch { return new Map() }
}

/** A chapter synced this recently is served from memory: page turns back and forth do not refetch it. */
const FRESH_MS = 60_000
const syncs = new Map<string, { at: number; p: Promise<HighlightMap | null> }>()

/** Fresh copy from the server, written through to the cache; null when unreachable. Signed out, the device copy. */
export function syncHighlights(uid: HighlightOwner, book: number, chapter: number): Promise<HighlightMap | null> {
  if (uid === null) return cachedHighlights(null, book, chapter)
  const k = storageKey(uid, book, chapter)
  const hit = syncs.get(k)
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.p.then(m => (m ? new Map(mem.get(k) ?? m) : null))
  const p = (async () => {
    try {
      const rows = await get<Row[]>(`/highlights?book=${book}&chapter=${chapter}`)
      const m: HighlightMap = new Map(rows.map(r => [r.verse_id, r.color]))
      await store(k, m)
      return new Map(m)
    } catch { syncs.delete(k); return null }
  })()
  syncs.set(k, { at: Date.now(), p })
  return p
}

/** Set or clear (`color === null`) one verse. The cache updates first; the PUT rejection propagates so the caller can say so. */
export async function setHighlight(uid: HighlightOwner, verseId: number, color: string | null): Promise<void> {
  const { book, chapter } = chapterOf(verseId)
  const k = storageKey(uid, book, chapter)
  const m = new Map(mem.get(k) ?? (await cachedHighlights(uid, book, chapter)))
  if (color) m.set(verseId, color); else m.delete(verseId)
  await store(k, m)
  if (uid !== null) await put('/highlights', { verse_id: verseId, color })
}

/** Every highlight kept on this device while signed out, one entry per chapter. */
export async function localHighlightChapters(): Promise<{ book: number; chapter: number; tints: HighlightMap }[]> {
  const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(`${PREFIX}${LOCAL}:`))
  const out: { book: number; chapter: number; tints: HighlightMap }[] = []
  for (const k of keys) {
    const m = /:(\d+)\.(\d+)$/.exec(k)
    if (!m) continue
    const tints = await cachedHighlights(null, +m[1], +m[2])
    if (tints.size) out.push({ book: +m[1], chapter: +m[2], tints })
  }
  return out
}

/** After the chapter's local tints are in the account: the account's cache takes the merged map, the local copy goes. */
export async function adoptLocalHighlights(uid: number, book: number, chapter: number, merged: HighlightMap): Promise<void> {
  const k = storageKey(uid, book, chapter)
  await store(k, merged)
  syncs.delete(k)
  const lk = storageKey(null, book, chapter)
  mem.delete(lk); written.delete(lk)
  await AsyncStorage.removeItem(lk)
}

async function store(k: string, m: HighlightMap) {
  mem.set(k, m)
  const json = JSON.stringify([...m].map(([verse_id, color]): Row => ({ verse_id, color })))
  if (written.get(k) === json) return
  written.set(k, json)
  try { await AsyncStorage.setItem(k, json) } catch { written.delete(k) /* quota: memory copy still serves this launch */ }
}
