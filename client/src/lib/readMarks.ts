/**
 * The reader's own "read" marks on this device (rules in `readMarksCore.ts`; server: `/api/me/marks`, rs/src/marks.rs).
 * One store outside React, as the path's is (`paths.ts` counts the marks made since a path's start beside the credits).
 * Signed out the marks stay in AsyncStorage under `berean_read_marks`; at sign-in they go to the account in one bulk
 * and leave the device's list as the server takes them, as the device's bookmarks do.
 *
 * A tap shows at once and is sent after. Whatever the server does not take (no connection, too many at once, or a
 * server from before marks, which answers 404) waits here and goes with the next change, the next refresh or the next
 * launch; a 404 stops the asking until then, so an app newer than its server never loops on it. No React here
 * (`hooks/useMarks.ts` is the hook), so the backup and the path store can read it anywhere.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { chapterKey } from '@shared/paths'
import { ApiError, cachedGet, del, getToken, post, put } from './api'
import { MAX_MARKS, NO_MARKS, afterCleared, afterFetched, afterSent, forReader, isChapter, marksOf, readMarkList, readMarkState, withMark, withMarks, withoutMark, type Mark, type MarkState } from './readMarksCore'

export const MARKS_KEY = 'berean_read_marks'
const EXPLAINED_KEY = 'berean_mark_explained'

export interface MarksView {
  /** False until this device's marks have been read. */
  ready: boolean
  /** The signed-in reader the marks are for; null signed out. */
  uid: number | null
  /** Marked chapters by `chapterKey`, each with the time of its mark. */
  at: ReadonlyMap<string, string>
}
let state: MarkState = NO_MARKS
let view: MarksView = { ready: false, uid: null, at: new Map() }
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
function commit(next: MarkState) {
  if (next === state && view.ready) return
  state = next
  view = { ready: true, uid: next.uid, at: marksOf(next) }
  AsyncStorage.setItem(MARKS_KEY, JSON.stringify(next)).catch(() => {})
  listeners.forEach(l => l())
}
const now = () => new Date().toISOString()

let stored: Promise<void> | null = null
/** This device's copy, read once. */
function fromDevice(): Promise<void> {
  stored ??= AsyncStorage.getItem(MARKS_KEY).then(s => s, () => null).then(s => {
    state = readMarkState(s, now())
    view = { ready: true, uid: state.uid, at: marksOf(state) }
    listeners.forEach(l => l())
  })
  return stored
}

/** Marks made by a tap since launch: one of these alone goes up as the plain set, anything older or more in one bulk with its times. */
const tapped = new Set<string>()
/** The server answered 404: it has no marks yet. Asked again at the next launch or sign-in. */
let unsupported = false
let chain: Promise<void> = Promise.resolve()
/** One run at a time: what waits here goes up (marks, then undos), then, when asked, the account's marks come down. */
function sync(fetch: boolean): Promise<void> {
  chain = chain.then(() => run(fetch)).catch(() => {})
  return chain
}
async function run(fetch: boolean): Promise<void> {
  const uid = state.uid, token = getToken()
  if (uid === null || !token || unsupported) return
  const mine = () => state.uid === uid && getToken() === token
  const up = state.local.slice(0, MAX_MARKS)
  try {
    if (up.length === 1 && tapped.has(chapterKey(up[0][0], up[0][1]))) {
      const [b, c] = up[0]
      const r = await put<{ marked_at?: string }>(`/me/marks/${b}/${c}`)
      if (!mine()) return
      commit(afterSent(state, up, [[b, c, typeof r?.marked_at === 'string' ? r.marked_at : up[0][2]]]))
    } else if (up.length) {
      await post('/me/marks', { marks: up })
      if (!mine()) return
      commit(afterSent(state, up))
    }
  } catch (e) {
    if (!(e instanceof ApiError)) return
    if (e.status === 404) unsupported = true
    // refused as they stand (not a chapter): they would be refused every time, so they do not wait
    else if (e.status === 400 && mine()) commit({ ...state, local: state.local.filter(m => !up.includes(m)) })
    return
  }
  try {
    for (const k of [...state.cleared]) {
      await del(`/me/marks/${k.replace('.', '/')}`)
      if (!mine()) return
      commit(afterCleared(state, k))
    }
    if (!fetch && !(up.length > 1)) return
    // through the request cache: Home asks on every return, and any write (a beat, a mark) empties the cache first
    const r = await cachedGet<{ marks?: unknown }>('/me/marks')
    if (mine()) commit(afterFetched(state, readMarkList(r?.marks, now())))
  } catch (e) { if (e instanceof ApiError && e.status === 404) unsupported = true }
}

let loadedFor: number | null | undefined
/** The marks for `uid` (undefined: nobody signed in): this device's, then the account's, with what waits here sent to it. Once per reader per launch. */
export function loadMarks(uid: number | undefined): Promise<void> {
  const who = uid ?? null
  return fromDevice().then(() => {
    if (loadedFor === who) return
    loadedFor = who
    unsupported = false
    commit(forReader(state, who))
    return sync(true)
  })
}
/** Sends what waits and re-reads the account's marks (Home on focus: a mark made on another device shows). */
export const refreshMarks = (): Promise<void> => (loadedFor == null ? Promise.resolve() : sync(true))

/** Marks the chapter as read: shown at once, sent after. */
export function markRead(book: number, chapter: number): Promise<void> {
  if (!isChapter(book, chapter)) return Promise.resolve()
  return fromDevice().then(() => { tapped.add(chapterKey(book, chapter)); commit(withMark(state, book, chapter, now())); void sync(false) })
}
export function unmarkRead(book: number, chapter: number): Promise<void> {
  return fromDevice().then(() => { commit(withoutMark(state, book, chapter)); void sync(false) })
}
/** Marks from a backup, adding only; how many were new. */
export function addMarks(marks: readonly Mark[]): Promise<number> {
  return fromDevice().then(() => { const [next, n] = withMarks(state, marks); if (n) { commit(next); void sync(false) } return n })
}
/** Every mark goes from this device: the reader deleted their activity (the server has dropped the account's). */
export const forgetMarks = (): Promise<void> => fromDevice().then(() => { tapped.clear(); commit({ ...state, known: [], local: [], cleared: [] }) })
/** Every mark shown on this device, for a backup. */
export const allMarks = (): Promise<Mark[]> => fromDevice().then(() => [...view.at].map(([k, at]): Mark => [Number(k.split('.')[0]), Number(k.split('.')[1]), at]))

/** True the first time it is asked on this device, and never again: the one sentence that explains a mark is said once. */
export async function firstMark(): Promise<boolean> {
  try {
    if (await AsyncStorage.getItem(EXPLAINED_KEY)) return false
    await AsyncStorage.setItem(EXPLAINED_KEY, '1')
    return true
  } catch { return false }
}

/** The marks as last known, without a hook (paths.ts). */
export const peekMarks = (): MarksView => view
/** Called on every change of the marks; returns the unsubscribe. */
export const onMarksChange = (l: () => void): (() => void) => subscribe(l)
/** This device's own marks alone (the background task: no store, nobody asked). */
export const deviceMarks = (): Promise<ReadonlyMap<string, string>> => fromDevice().then(() => view.at)
