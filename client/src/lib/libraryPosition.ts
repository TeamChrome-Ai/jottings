/**
 * Where each work of the ministry library was left, on this device only (like the reader's own position before
 * sign-in): section, paragraph and how far into it. One AsyncStorage entry for every work, read once per launch;
 * writes are coalesced, so the reader can report on every scroll pause without touching storage each time.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { latestPosition, parsePositions, positionKey, rememberPosition, type Positions, type WorkPosition } from './libraryNav'

const KEY = 'berean_library_pos'
/** A burst of reports (a scroll, a turn) is written once, this long after the last. */
const WRITE_MS = 800

let cache: Positions | null = null
let reading: Promise<Positions> | null = null
let timer: ReturnType<typeof setTimeout> | null = null
/** While the guided tour runs, the work it opens is not noted as read (it is the tour's page, not the reader's). */
let held = false
export const holdPositions = (on: boolean) => { held = on }

/** Every kept position (memory after the first read). */
export function loadPositions(): Promise<Positions> {
  if (cache) return Promise.resolve(cache)
  reading ??= AsyncStorage.getItem(KEY).then(parsePositions, () => ({})).then(p => { cache ??= p; return cache })
  return reading
}

/** The kept position for a work, if any; synchronous once `loadPositions` has resolved. */
export const peekPosition = (author: string, work: string): WorkPosition | null | undefined => cache ? cache[positionKey(author, work)] ?? null : undefined

export function savePosition(author: string, work: string, pos: Omit<WorkPosition, 't'>) {
  if (held) return
  void loadPositions().then(ps => {
    const next = rememberPosition(ps, positionKey(author, work), { ...pos, t: Date.now() })
    if (next === ps) return
    cache = next
    if (timer) clearTimeout(timer)
    timer = setTimeout(flushPositions, WRITE_MS)
  })
}

/** Write now (a screen leaving, the app going to the background). */
export function flushPositions() {
  if (timer) { clearTimeout(timer); timer = null }
  if (cache) AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {})
}

export async function lastRead() { return latestPosition(await loadPositions()) }
