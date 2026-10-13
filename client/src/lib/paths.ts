/**
 * The reader's path on the device (docs/PATHS.md, API in its "API" section). Signed in, the server is the truth
 * (`GET/PUT/DELETE /api/me/path`); signed out, the same state lives in AsyncStorage under `berean_path`, and progress
 * comes from a local read set (`berean_path_reads`) the reader appends to when a visit is credited (useActivity: the
 * server's credit signed in, the same rule judged on the device signed out). On sign-in a local path moves to the
 * account when the account has none (its start kept); the read sets are unioned for progress either way. One store
 * outside React (useSyncExternalStore), so the reader, Home, read aloud and the Paths screen see one answer. Web-safe.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AuthorId, CompanionIndex } from '@shared/companion'
import {
  chapterKey, defaultWithMinistry, nextOnPath, nextPortion, paceFor, pathCompanion, portionOf, progress as progressOf, readSetOf, readSetSince, standing, withMinistry,
  type CustomPath, type GroupPath, type PathAccount, type PathHistoryEntry, type PathId, type PathState, type Portion, type Progress, type Standing,
} from '@shared/paths'
import { cachedGet, del, getToken, put } from './api'
import { loadCompanionIndex } from './companion'
import { useAuth } from '../store/auth'
import { onEditionChange, pathOffered, shownPathId } from './editionCore'
import { useEdition } from './edition'

export const PATH_KEY = 'berean_path'
export const PATH_READS_KEY = 'berean_path_reads'

type LocalRead = [book: number, chapter: number, at: string]
interface Local { path: PathState | null; history: PathHistoryEntry[] }

// ---------------- the local read set ----------------

let reads: LocalRead[] = []
let readsLoad: Promise<void> | null = null
function loadReads(): Promise<void> {
  readsLoad ??= AsyncStorage.getItem(PATH_READS_KEY).then(s => { if (s) { try { reads = JSON.parse(s) as LocalRead[] } catch { reads = [] } } }, () => {})
  return readsLoad
}
/**
 * A chapter credited on this device now (or at `at`): the path counts it from here on without waiting for the server.
 * Signed in it mirrors the server's credit; signed out it is the credit. One row per chapter, the latest time kept.
 */
export function noteLocalRead(book: number, chapter: number, at: string = new Date().toISOString()): void {
  void loadReads().then(() => {
    reads = [...reads.filter(([b, c]) => b !== book || c !== chapter), [book, chapter, at]]
    AsyncStorage.setItem(PATH_READS_KEY, JSON.stringify(reads)).catch(() => {})
    emit()
  })
}

/** Whether any chapter has ever been credited on this device (signed in or out): Home's sign-in prompt keeps its place
 *  above the library only once one has. */
export const anyLocalRead = (): Promise<boolean> => loadReads().then(() => reads.length > 0)

/** Every chapter ever credited on this device, by `chapterKey`: signed-out Stats and the whole-Bible strip read it. */
export const localReadSet = (): Promise<Set<string>> => loadReads().then(() => new Set(reads.map(([b, c]) => chapterKey(b, c))))

// ---------------- the store ----------------

interface Snapshot {
  /** Undefined until the first load (local or server) has answered. */
  account: PathAccount | undefined
  /** The signed-in account the snapshot is for; undefined signed out. */
  uid: number | undefined
  indexes: Partial<Record<AuthorId, CompanionIndex | null>>
  /** The last PUT/DELETE that failed, for a quiet line on the Paths screen; cleared by the next success. */
  error: string | null
}
let snap: Snapshot = { account: undefined, uid: undefined, indexes: {}, error: null }
const listeners = new Set<() => void>()
const emit = () => { snap = { ...snap }; listeners.forEach(l => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const getSnap = () => snap
const set = (patch: Partial<Snapshot>) => { snap = { ...snap, ...patch }; listeners.forEach(l => l()) }

async function readLocal(): Promise<Local> {
  try { const s = await AsyncStorage.getItem(PATH_KEY); if (s) return JSON.parse(s) as Local } catch { /* a torn write starts over */ }
  return { path: null, history: [] }
}
const writeLocal = (l: Local) => AsyncStorage.setItem(PATH_KEY, JSON.stringify(l)).catch(() => {})
const clearLocal = () => AsyncStorage.removeItem(PATH_KEY).catch(() => {})

/**
 * The path as the edition shows it (editionCore.ts shownPathId): a reader on the Coates path walks the Synopsis path while
 * Coates is hidden. Only what is read here changes; the state kept (server or device) is untouched, so a change of pace
 * keeps the stored path and the other edition shows it again.
 */
function shown<P extends PathState | null | undefined>(p: P): P {
  if (!p) return p
  const id = shownPathId(p.id)
  return (id === p.id ? p : { ...p, id }) as P
}
/** The paths left behind that the edition offers again. */
const shownHistory = (h: PathHistoryEntry[]) => (h.every(x => pathOffered(x.id)) ? h : h.filter(x => pathOffered(x.id)))
// another edition: an index it could not have is asked for again, and the one the shown path pairs with
onEditionChange(() => { set({ indexes: Object.fromEntries(Object.entries(snap.indexes).filter(([, i]) => !!i)) }); wantIndex(snap.account?.path ?? null) })

/** The companion index a path pairs with, fetched once the path asks for it. */
function wantIndex(stored: PathState | null) {
  const state = shown(stored)
  const author = state && withMinistry(state) ? pathCompanion(state) : undefined
  if (!author || author in snap.indexes) return
  set({ indexes: { ...snap.indexes, [author]: null } })
  void loadCompanionIndex(author).then(i => { if (i) set({ indexes: { ...snap.indexes, [author]: i } }) })
}

let loading: Promise<void> | null = null
/** Loads the state for `uid` (the server's, merging a local path into an empty account) or the local one. */
function load(uid: number | undefined): Promise<void> {
  if (snap.uid === uid && snap.account !== undefined) return Promise.resolve()
  loading = (async () => {
    await loadReads()
    if (uid === undefined) {
      const l = await readLocal()
      set({ uid, account: { path: l.path, history: l.history, read: [] }, error: null })
      wantIndex(l.path)
      return
    }
    const token = getToken()
    let acc = await cachedGet<PathAccount>('/me/path')
    const l = await readLocal()
    if (l.path && !acc.path) {
      // the path begun signed out goes to the account with its start; the server answers with the reads it knows
      const p = l.path
      acc = await put<PathAccount>('/me/path', { id: p.id, started_at: p.started_at, target_date: p.target_date, pace_per_week: p.pace_per_week, with_ministry: p.with_ministry, custom: p.id === 'custom' ? p.custom : undefined })
    }
    if (l.path || l.history.length) void clearLocal()
    if (getToken() !== token) return
    set({ uid, account: acc, error: null })
    wantIndex(acc.path)
  })().catch(e => { if (snap.account === undefined) set({ uid, account: { path: null, history: [], read: [] } }); set({ error: errText(e) }) })
  return loading
}
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong')

/** The chapters that count: the server's reads since the start, plus this device's own since the start. */
function readSet(acc: PathAccount | undefined): Set<string> {
  if (!acc?.path) return new Set()
  const s = readSetOf(acc.read)
  for (const k of readSetSince(reads, acc.path.started_at)) s.add(k)
  return s
}

// ---------------- changes ----------------

export interface StartOptions { pace_per_week?: number | null; target_date?: string | null; with_ministry?: boolean; custom?: CustomPath }
type Change = { id: PathId | 'custom'; started_at?: string } & StartOptions
async function apply(change: Partial<Change> | null): Promise<void> {
  const acc = snap.account ?? { path: null, history: [], read: [] }
  try {
    if (snap.uid !== undefined) {
      const next = change === null ? await del<{ ok: true }>('/me/path').then(() => ({ path: null, history: [], read: [] } as PathAccount)) : await put<PathAccount>('/me/path', change)
      set({ account: next, error: null })
      wantIndex(next.path)
      return
    }
    // signed out: the same rules as rs/src/paths.rs, on the device
    let l: Local = { path: acc.path, history: acc.history }
    if (change === null) l = { path: null, history: [] }
    else if (change.id && (!l.path || l.path.id !== change.id || (change.id === 'custom' && JSON.stringify(change.custom?.books) !== JSON.stringify(l.path.custom?.books)))) {
      const now = new Date().toISOString()
      const history = l.path ? [...l.history, { id: l.path.id, started_at: l.path.started_at, ended_at: now, custom: l.path.custom }] : [...l.history]
      const back = history.findIndex(h => h.id === change.id && (change.id !== 'custom' || JSON.stringify(h.custom?.books) === JSON.stringify(change.custom?.books)))
      const started_at = back >= 0 ? history.splice(back, 1)[0].started_at : change.started_at ?? now
      l = { history, path: { id: change.id, started_at, target_date: change.target_date ?? null, pace_per_week: change.pace_per_week === undefined ? l.path?.pace_per_week ?? null : change.pace_per_week, with_ministry: change.with_ministry ?? defaultWithMinistry(change.id), custom: change.id === 'custom' ? change.custom ?? null : null } }
    } else if (l.path) {
      l = { ...l, path: { ...l.path, pace_per_week: change.pace_per_week === undefined ? l.path.pace_per_week : change.pace_per_week, target_date: change.target_date === undefined ? l.path.target_date : change.target_date, with_ministry: change.with_ministry ?? l.path.with_ministry, custom: l.path.id === 'custom' && change.custom ? change.custom : l.path.custom } }
    }
    await writeLocal(l)
    set({ account: { path: l.path, history: l.history, read: [] }, error: null })
    wantIndex(l.path)
  } catch (e) { set({ error: errText(e) }) }
}

// ---------------- what the UI reads ----------------

export interface PathView {
  /** Undefined while the first load is out. */
  state: PathState | null | undefined
  history: PathHistoryEntry[]
  /** Chapters that count for the path (the streak's credits since its start, this device's included). Empty without a path. */
  readSet: Set<string>
  progress: Progress | null
  /** The next portion and its 0-based index; null without a path or once it is finished. */
  next: { index: number; portion: Portion } | null
  /** Chapters a day to finish by the target; null without a target. */
  paceNeeded: number | null
  /** Against the target: expected, done, delta (ahead > 0, behind < 0); nulls without a target. */
  standing: Standing | null
  /** The companion index the pairing needs (`then`), once it has loaded. */
  indexes: Partial<Record<AuthorId, CompanionIndex | null>>
  loading: boolean
  error: string | null
  /** Start a path, or switch to it (the current one goes to history with its start; a path in history resumes from its own). */
  start: (id: PathId | 'custom', opts?: StartOptions) => Promise<void>
  /** Stop: the path and its history go, the reading stays. */
  stop: () => Promise<void>
  setPace: (pace_per_week: number | null) => Promise<void>
  /** YYYY-MM-DD in the reader's own days, or null. */
  setTargetDate: (target_date: string | null) => Promise<void>
  setWithMinistry: (on: boolean) => Promise<void>
  /** Re-choose a custom path's books (a different set of books is a new path and goes through `start`). */
  setCustom: (custom: CustomPath) => Promise<void>
  /** Re-read the account's state (after a credit elsewhere, or a screen focus). */
  refresh: () => Promise<void>
}

/** The reader's path, live: state, progress, the next portion, and the ways to change it. */
export function usePath(): PathView {
  const { user } = useAuth()
  const uid = user?.id
  const s = useSyncExternalStore(subscribe, getSnap, getSnap)
  useEdition()
  useEffect(() => { void load(uid) }, [uid])
  const state = shown(s.uid === uid ? s.account?.path : undefined)
  const acc = s.uid === uid ? s.account : undefined
  const set_ = readSet(acc)
  const pr = state ? progressOf(state, set_) : null
  const today = dayOf(new Date())
  const refresh = useCallback(async () => { set({ account: undefined }); await load(uid) }, [uid])
  return {
    state, history: shownHistory(acc?.history ?? []), readSet: set_, progress: pr,
    next: state ? nextPortion(state, set_, s.indexes) : null,
    paceNeeded: pr && state ? paceFor(pr, state.target_date, today) : null,
    standing: pr && state ? standing(pr, state.started_at, state.target_date, today) : null,
    indexes: s.indexes, loading: acc === undefined, error: s.error,
    start: (id, opts) => apply({ id, ...opts }),
    stop: () => apply(null),
    setPace: pace_per_week => apply({ pace_per_week }),
    setTargetDate: target_date => apply({ target_date }),
    setWithMinistry: on => apply({ with_ministry: on }),
    setCustom: custom => apply(state?.id === 'custom' && JSON.stringify(custom.books) !== JSON.stringify(state.custom?.books) ? { id: 'custom', custom } : { custom }),
    refresh,
  }
}

/** The reader's day as YYYY-MM-DD (the target date is one of these). */
export const dayOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * The next portion without a hook, for read aloud's continue-into-next and the reader's next turn: what the last load
 * knows (null while nothing has loaded, without a path, or when the path is finished). `after` names the chapter
 * about to be left: while the reader is on a path chapter the portion after it is meant, whether or not it is read.
 */
export function peekNextPortion(after?: { book: number; chapter: number }): Portion | null {
  const acc = snap.account
  if (!acc?.path) return null
  const set_ = readSet(acc)
  if (after) set_.add(chapterKey(after.book, after.chapter))
  return nextPortion(shown(acc.path), set_, snap.indexes)?.portion ?? null
}
/** The path as last loaded, without a hook (null without one or before the first load). */
export const peekPath = (): PathState | null => shown(snap.account?.path ?? null)
/** Called on every change of the path store (a load, a change, a credit on this device); returns the unsubscribe. */
export const onPathChange = (l: () => void): (() => void) => subscribe(l)

/**
 * What the reader needs at `book` `chapter` (docs/PATHS.md rule 3), from the store: whether the chapter is on the active
 * path, the portion it belongs to (its `then` once the companion index is in) and the portion the next turn goes to.
 * One memo per (store change, chapter): the reader re-renders on every spoken word and this must cost nothing then.
 */
export interface PathHere { onPath: boolean; portion: Portion | null; next: Portion | null }
const OFF_PATH: PathHere = { onPath: false, portion: null, next: null }
export function usePathHere(book: number, chapter: number): PathHere {
  const { user } = useAuth()
  const uid = user?.id
  const s = useSyncExternalStore(subscribe, getSnap, getSnap)
  const edition = useEdition()
  useEffect(() => { void load(uid) }, [uid])
  return useMemo(() => {
    const acc = s.uid === uid ? s.account : undefined
    const p = shown(acc?.path)
    if (!p) return OFF_PATH
    const portion = portionOf(p, book, chapter, s.indexes)
    if (!portion) return OFF_PATH
    return { onPath: true, portion, next: nextOnPath(p, readSet(acc), book, chapter, s.indexes) }
  }, [s, uid, book, chapter, edition])  // eslint-disable-line react-hooks/exhaustive-deps
}

/** For the morning notice: the path and its next portion. Undefined before the first load (the caller reads the device itself), null without a path. */
export function peekPathNext(): { path: PathState; next: Portion | null } | null | undefined {
  const acc = snap.account
  if (acc === undefined) return undefined
  const p = shown(acc.path)
  return p ? { path: p, next: nextPortion(p, readSet(acc), snap.indexes)?.portion ?? null } : null
}
/** The same from the device alone (the background task, no store loaded): the local path and this device's reads. */
export async function localPathNext(): Promise<{ path: PathState; next: Portion | null } | null> {
  await loadReads()
  const p = shown((await readLocal()).path)
  return p ? { path: p, next: nextPortion(p, readSetSince(reads, p.started_at))?.portion ?? null } : null
}

// ---------------- a group's path ----------------

export interface GroupPathView {
  /** The group's path with each member's place; null while the group walks none; undefined until loaded. */
  path: GroupPath | null | undefined
  loading: boolean
  error: string | null
  /** Admins: start (or, with `restart`, start again) a built-in path for the group, set its target, or `null` to take it off. */
  setGroupPath: (path_id: PathId | null, opts?: { restart?: boolean; target_date?: string | null }) => Promise<void>
  refresh: () => Promise<void>
}
/** A group's path from `GET /api/groups/:slug` (shared with the group screen's read through the request cache). */
export function useGroupPath(slug: string | undefined): GroupPathView {
  const s = useSyncExternalStore(subscribeGroup, getGroups, getGroups)
  const g = slug ? s[slug] : undefined
  useEffect(() => { if (slug && !groups[slug]) void loadGroup(slug) }, [slug])
  return {
    path: g?.path, loading: !!slug && g === undefined, error: g?.error ?? null,
    setGroupPath: async (path_id, opts) => {
      if (!slug) return
      try { const v = await put<{ path: GroupPath | null }>(`/groups/${slug}/path`, { path_id, ...opts }); setGroup(slug, { path: v.path, error: null }) } catch (e) { setGroup(slug, { ...(groups[slug] ?? { path: null }), error: errText(e) }) }
    },
    refresh: () => (slug ? loadGroup(slug) : Promise.resolve()),
  }
}
type GroupEntry = { path: GroupPath | null; error: string | null }
let groups: Record<string, GroupEntry> = {}
const groupListeners = new Set<() => void>()
const subscribeGroup = (l: () => void) => { groupListeners.add(l); return () => { groupListeners.delete(l) } }
const getGroups = () => groups
const setGroup = (slug: string, e: GroupEntry) => { groups = { ...groups, [slug]: e }; groupListeners.forEach(l => l()) }
async function loadGroup(slug: string): Promise<void> {
  try { const v = await cachedGet<{ path?: GroupPath | null }>(`/groups/${slug}`); setGroup(slug, { path: v.path ?? null, error: null }) } catch (e) { setGroup(slug, { path: groups[slug]?.path ?? null, error: errText(e) }) }
}
