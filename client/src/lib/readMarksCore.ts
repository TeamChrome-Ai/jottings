/**
 * Chapters a reader marked as read by hand (docs/PATHS.md rule 1; the server's side is rs/src/marks.rs), as one device
 * keeps them. A mark is the reader's own: it ticks the chapter in their reader and moves their own path on. It is not
 * a credit and earns nothing. Pure; `readMarks.ts` does the storage and the network.
 *
 * Signed out the marks live on the device (`local`). Signed in the account's are the truth (`known`, as last fetched)
 * and the device holds only what the server has not taken yet: marks made here (`local`) and marks undone here
 * (`cleared`). Against a server from before marks both simply wait, so nothing a reader ticked is lost.
 */
import { BOOKS } from '@shared/books'
import { chapterKey } from '@shared/paths'

export type Mark = [book: number, chapter: number, at: string]
export interface MarkState {
  /** Whose `known` and `cleared` these are; null while nobody is signed in. */
  uid: number | null
  known: Mark[]
  local: Mark[]
  /** `chapterKey`s undone here and not yet undone on the server. */
  cleared: string[]
}
export const NO_MARKS: MarkState = { uid: null, known: [], local: [], cleared: [] }
/** Every chapter of the Bible: the most a reader can mark, and the most the server takes at once. */
export const MAX_MARKS = 1189

const keyOf = (m: Mark) => chapterKey(m[0], m[1])
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
export const isChapter = (book: unknown, chapter: unknown): boolean =>
  Number.isInteger(book) && Number.isInteger(chapter) && (chapter as number) >= 1 && (chapter as number) <= (BOOKS[(book as number) - 1]?.chapters ?? 0)

/**
 * Marks as a file, storage or the server gives them (`[book, chapter, at]` or `{ book, chapter, marked_at }`): only
 * chapters the Bible has, one per chapter with its latest time, the Bible's count at most. A time that cannot be read
 * becomes `now`. Nothing read here is trusted further than that: a mark earns nothing.
 */
export function readMarkList(v: unknown, now: string): Mark[] {
  const out = new Map<string, Mark>()
  for (const r of Array.isArray(v) ? v : []) {
    const [b, c, at] = Array.isArray(r) ? r as unknown[] : isObj(r) ? [r.book, r.chapter, r.marked_at] : []
    if (!isChapter(b, c)) continue
    const ms = typeof at === 'string' ? Date.parse(at) : NaN
    const m: Mark = [b as number, c as number, Number.isNaN(ms) ? now : new Date(ms).toISOString()]
    const was = out.get(keyOf(m))
    if (!was || m[2] > was[2]) out.set(keyOf(m), m)
  }
  return [...out.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1])
}
/** The state as storage holds it; anything unreadable starts empty. */
export function readMarkState(raw: string | null, now: string): MarkState {
  let v: unknown = null
  try { v = raw ? JSON.parse(raw) : null } catch { /* a torn write starts over */ }
  if (!isObj(v)) return NO_MARKS
  return {
    uid: Number.isInteger(v.uid) ? v.uid as number : null, known: readMarkList(v.known, now), local: readMarkList(v.local, now),
    cleared: (Array.isArray(v.cleared) ? v.cleared : []).filter((k): k is string => typeof k === 'string' && isChapter(Number(k.split('.')[0]), Number(k.split('.')[1]))),
  }
}

/** The chapters marked, by `chapterKey`, each with the time of its mark (the later of the account's and this device's). */
export function marksOf(s: MarkState): Map<string, string> {
  const out = new Map<string, string>()
  const gone = new Set(s.cleared)
  if (s.uid !== null) for (const m of s.known) if (!gone.has(keyOf(m))) out.set(keyOf(m), m[2])
  for (const m of s.local) { const was = out.get(keyOf(m)); if (!was || m[2] > was) out.set(keyOf(m), m[2]) }
  return out
}
/** The marks a path begun at `since` counts: made at or after it (ISO instants compare as text), as credits are. */
export function marksSince(at: ReadonlyMap<string, string>, since: string): Set<string> {
  const s = new Set<string>()
  for (const [k, t] of at) if (t >= since) s.add(k)
  return s
}

/** Marks the chapter at `at`. One marked already is marked afresh, so a path begun since counts it. */
export function withMark(s: MarkState, book: number, chapter: number, at: string): MarkState {
  const k = chapterKey(book, chapter)
  return { ...s, local: [...s.local.filter(m => keyOf(m) !== k), [book, chapter, at]], cleared: s.cleared.filter(x => x !== k) }
}
/** Undoes the mark. Signed in the server may hold it, or be about to (a set on its way), so the undo waits for it too. */
export function withoutMark(s: MarkState, book: number, chapter: number): MarkState {
  const k = chapterKey(book, chapter)
  return { ...s, local: s.local.filter(m => keyOf(m) !== k), cleared: s.uid === null || s.cleared.includes(k) ? s.cleared : [...s.cleared, k] }
}
/** Adds marks from a backup: only chapters not marked already, so a file restored twice adds nothing. The number added. */
export function withMarks(s: MarkState, marks: readonly Mark[]): [MarkState, number] {
  const have = marksOf(s)
  const add = marks.filter(m => isChapter(m[0], m[1]) && !have.has(keyOf(m)))
  const fresh = [...new Map(add.map(m => [keyOf(m), m])).values()]
  const cleared = new Set(fresh.map(keyOf))
  return [fresh.length ? { ...s, local: [...s.local, ...fresh], cleared: s.cleared.filter(k => !cleared.has(k)) } : s, fresh.length]
}

/** The server took `sent` (as `kept`: its own times when it says them): they are the account's now. A mark made
 *  afresh or undone here while they were on their way keeps waiting. */
export function afterSent(s: MarkState, sent: readonly Mark[], kept: readonly Mark[] = sent): MarkState {
  const went = new Set(sent.map(m => `${keyOf(m)}@${m[2]}`))
  const known = new Map(s.known.map(m => [keyOf(m), m]))
  for (const m of kept) { const was = known.get(keyOf(m)); if (!was || m[2] > was[2]) known.set(keyOf(m), m) }
  return { ...s, known: [...known.values()], local: s.local.filter(m => !went.has(`${keyOf(m)}@${m[2]}`)) }
}
/** The server undid the mark at `key`. */
export const afterCleared = (s: MarkState, key: string): MarkState => ({ ...s, known: s.known.filter(m => keyOf(m) !== key), cleared: s.cleared.filter(k => k !== key) })
/** The account's marks as the server lists them now. */
export const afterFetched = (s: MarkState, server: Mark[]): MarkState => ({ ...s, known: server })
/**
 * Another reader on this device, or nobody: the account's marks were theirs and go. Marks still waiting here stay with
 * the device, are its own marks while nobody is signed in, and go to the account that signs in next, as the device's
 * bookmarks do.
 */
export const forReader = (s: MarkState, uid: number | null): MarkState => (s.uid === uid ? s : { uid, known: [], local: s.local, cleared: [] })
