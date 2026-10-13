import AsyncStorage from '@react-native-async-storage/async-storage'
import { cachedGet, getToken, put } from '../lib/api'

export interface Position { book: number; chapter: number; verse: number }
const KEY = 'berean_pos'
const DEFAULT: Position = { book: 43, chapter: 1, verse: 1 }

/** The last position read or written this launch, so repeat loads skip AsyncStorage. `undefined` = not read yet. */
let local: Position | null | undefined
let stored = ''
let synced = ''

/** This device's own copy (memory, then AsyncStorage); null when nothing was ever saved. Never touches the network. */
export async function localPosition(): Promise<Position | null> {
  if (local !== undefined) return local
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (local !== undefined) return local
    local = raw ? JSON.parse(raw) as Position : null
    stored = raw ?? ''
  } catch { local = null }
  return local
}

/**
 * The server's position when signed in and reachable, else the local copy, else John 1. `waitMs` caps how long the
 * server gets before the local copy is used (a screen that shows only a spinner until this settles).
 */
export async function loadPosition(signedIn: boolean, opts?: { waitMs?: number }): Promise<Position> {
  if (signedIn) {
    const server = cachedGet<Position>('/position').then(p => (p.book >= 1 ? p : null), () => null)
    const waitMs = opts?.waitMs
    const p = await (waitMs ? Promise.race([server, new Promise<null>(res => setTimeout(() => res(null), waitMs))]) : server)
    if (p) return p
  }
  return (await localPosition()) ?? DEFAULT
}

/** The readers call this on a timer: an unchanged position is neither rewritten locally nor re-sent. */
export function savePosition(p: Position, signedIn: boolean) {
  const s = JSON.stringify({ book: p.book, chapter: p.chapter, verse: p.verse })
  local = p
  if (s !== stored) { stored = s; AsyncStorage.setItem(KEY, s).catch(() => { if (stored === s) stored = '' }) }
  if (!signedIn) return
  const sent = `${getToken()}|${s}`
  if (sent === synced) return
  synced = sent
  put('/position', p).catch(() => { if (synced === sent) synced = '' })
}
