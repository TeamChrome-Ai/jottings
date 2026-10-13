/**
 * The offline ministry store, native: an author's works kept on the phone by choice (Settings → Offline), off by
 * default, removable. Nothing of the ministry is stored otherwise; what the library or the sheet opens without a
 * download is held in memory only. Files under <documentDirectory>/ministry/<author>/ (offlineMinistryCore.ts
 * authorPaths): works/<work>.json, one per work as GET /api/ministry/offline/:author/:work sends it, so a reader open
 * parses one volume, not the whole author; refs/<book>.json, the verse index by chapter, when the pack has it;
 * companion.json, the author's companion index; author.json last, the mark that the author is whole.
 * offlineMinistry.web.ts is the inert twin: the web keeps its HTTP cache and shows no such feature.
 *
 * While the cleanse is on (editionCore.ts peekCleanse, shared/cleanse.ts) what is read is filtered on the way out: the
 * hidden collections are not listed, their works read as not there, the sections come cleansed and the index rows into
 * hidden material are dropped. The files stay as downloaded; `cleanse undo` reads them whole again.
 */
import { Directory, File, Paths } from 'expo-file-system'
import { cleanseAuthor, cleanseContents, cleanseSection, collectionHidden } from '@shared/cleanse'
import type { CompanionIndex, AuthorId } from '@shared/companion'
import type { Library, LibraryAuthor, MinistrySection, WorkContents } from '@shared/ministry'
import { get, getApiBase, loadApiBase } from './api'
import { authorShown, onEditionChange, peekCleanse } from './editionCore'
import {
  authorPaths, cleanseRows, companionWorksOf, deriveStatus, isStoredWork, libraryFromStored, packTotal, parseListing, parseStoredAuthor, progressOf,
  type OfflineStatus, type PackAuthor, type PackListing, type RefsChapters, type RefsRow, type StoredAuthor, type StoredWork,
} from './offlineMinistryCore'

export const offlineSupported = true

const fileAt = (path: readonly string[]) => new File(Paths.document, ...path)
const dirAt = (path: readonly string[]) => new Directory(Paths.document, ...path)

async function readJson<T>(path: readonly string[]): Promise<T | null> {
  try { const f = fileAt(path); if (!f.exists) return null; return JSON.parse(await f.text()) as T } catch { return null }
}
function writeJson(path: readonly string[], v: unknown) {
  const dir = dirAt(path.slice(0, -1))
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  const f = fileAt(path)
  if (f.exists) f.delete()
  f.write(JSON.stringify(v))
}

// ---------- what is stored ----------

const stored = new Map<string, StoredAuthor | null>()
const storedLoads = new Map<string, Promise<StoredAuthor | null>>()
/** The author's marker, read once and kept until a download or a removal changes it. An author the edition leaves out
 *  (editionCore.ts) reads as not stored: the files stay on the phone, unread, and are there again with the other edition. */
export function storedAuthor(author: string): Promise<StoredAuthor | null> {
  if (!authorShown(author)) return Promise.resolve(null)
  if (stored.has(author)) return Promise.resolve(stored.get(author) ?? null)
  let p = storedLoads.get(author)
  if (!p) {
    p = readJson<unknown>(authorPaths(author).marker).then(v => { const s = parseStoredAuthor(v); stored.set(author, s); return s }).finally(() => storedLoads.delete(author))
    storedLoads.set(author, p)
  }
  return p
}
/** True once the author's files are whole on the phone. */
export const isStored = (author: string) => storedAuthor(author).then(s => !!s)

/** Every stored author, from the folders under ministry/. */
export async function storedAuthors(): Promise<StoredAuthor[]> {
  const out: StoredAuthor[] = []
  try {
    const root = dirAt([authorPaths('').dir[0]])
    if (!root.exists) return out
    for (const d of root.list()) {
      if (!(d instanceof Directory)) continue
      const s = await storedAuthor(d.name)
      if (s) out.push(s)
    }
  } catch { /* nothing stored */ }
  return out
}
/** The library the stored authors make (without the collections the cleanse hides); null when none is stored. */
export const storedLibrary = async (): Promise<Library | null> => {
  const all = await storedAuthors()
  return libraryFromStored(peekCleanse() ? all.map(s => ({ ...s, author: cleanseAuthor(s.author) })) : all)
}

// a few parsed volumes stay in memory: the reader's neighbours share the one being read
const WORK_CACHE = 6
const works = new Map<string, Promise<StoredWork | null>>()
/** A stored work as downloaded, whole. */
export function readWorkRaw(author: string, work: string): Promise<StoredWork | null> {
  const k = `${author}/${work}`
  const hit = works.get(k)
  if (hit) return hit
  const p = (async () => {
    if (!(await storedAuthor(author))) return null
    const v = await readJson<unknown>(authorPaths(author).work(work))
    return isStoredWork(v) ? v : null
  })()
  works.set(k, p)
  if (works.size > WORK_CACHE) { const first = works.keys().next().value; if (first !== undefined) works.delete(first) }
  p.then(v => { if (!v) works.delete(k) }, () => works.delete(k))
  return p
}
const cleansed = new Map<string, StoredWork>()
onEditionChange(() => cleansed.clear())
/** A stored work as shown: whole, or under the cleanse filtered (shared/cleanse.ts; a hidden collection's is not there). */
export async function readWork(author: string, work: string): Promise<StoredWork | null> {
  const raw = await readWorkRaw(author, work)
  if (!raw || !peekCleanse()) return raw
  const k = `${author}/${work}`
  const hit = cleansed.get(k)
  if (hit) return hit
  const collection = raw.contents.work.collection
  if (collectionHidden(collection)) return null
  const w: StoredWork = { contents: cleanseContents(raw.contents), sections: raw.sections.map((s, i) => cleanseSection(s, collection, i + 1)) }
  cleansed.set(k, w)
  if (cleansed.size > WORK_CACHE) { const first = cleansed.keys().next().value; if (first !== undefined) cleansed.delete(first) }
  return w
}
export const readContents = async (author: string, work: string): Promise<WorkContents | null> => (await readWork(author, work))?.contents ?? null
export const readSection = async (author: string, work: string, n: number): Promise<MinistrySection | null> => (await readWork(author, work))?.sections[n - 1] ?? null
/** A stored section as downloaded (the index's offsets are into it; offlineMinistryCore.ts groupFromRows cleanses it itself). */
export const readSectionRaw = async (author: string, work: string, n: number): Promise<MinistrySection | null> => (await readWorkRaw(author, work))?.sections[n - 1] ?? null
/** The author's companion index as downloaded with the works. */
export async function readCompanionIndex(author: AuthorId): Promise<CompanionIndex | null> {
  if (!(await storedAuthor(author))) return null
  const v = await readJson<{ works: CompanionIndex['works'] }>(authorPaths(author).companion)
  return v && Array.isArray(v.works) ? { author, works: v.works } : null
}
/** The stored index's rows for a chapter: null when the author is not stored or its pack had no index; [] for a chapter
 *  nobody wrote on. */
const refsBooks = new Map<string, Promise<RefsChapters | null>>()
export async function readRefs(author: string, book: number, chapter: number): Promise<RefsRow[] | null> {
  const s = await storedAuthor(author)
  if (!s || !s.refs) return null
  const k = `${author}/${book}`
  let p = refsBooks.get(k)
  if (!p) { p = readJson<RefsChapters>(authorPaths(author).refs(book)); refsBooks.set(k, p) }
  const chapters = await p
  const rows = chapters ? chapters[String(chapter)] ?? [] : []
  return peekCleanse() ? cleanseRows(rows, s.author) : rows
}

// ---------- the listing, statuses and their listeners ----------

const listeners = new Set<() => void>()
const changed = () => { listeners.forEach(l => l()) }
/** Called whenever a status changes (progress, done, removed). */
export function subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l) } }

const inFlight = new Map<string, { fraction: number; ctl: AbortController }>()

let listing: PackListing | null | undefined
/** GET /api/ministry/offline: sizes before downloading; null when it cannot be had. Kept for the session once it lands. */
export async function fetchListing(force = false): Promise<PackListing | null> {
  if (listing && !force) return shownListing(listing)
  try { listing = parseListing(await get<unknown>('/ministry/offline')) } catch { listing = null }
  return shownListing(listing)
}
const shownListing = <T extends PackListing | null | undefined>(l: T): T => (l ? { ...l, authors: l.authors.filter(a => authorShown(a.id)) } : l)
export const peekListing = () => shownListing(listing)

export async function status(author: string): Promise<OfflineStatus> {
  const flight = inFlight.get(author)
  return deriveStatus(await storedAuthor(author), flight ? flight.fraction : null, listing?.authors.find(a => a.id === author))
}

// ---------- download, cancel, remove ----------

class Cancelled extends Error { constructor() { super('cancelled') } }

async function downloadFile(url: string, path: readonly string[], ctl: AbortController, onBytes: (n: number) => void): Promise<File> {
  const dir = dirAt(path.slice(0, -1))
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  const f = fileAt(path)
  if (f.exists) f.delete()
  const task = File.createDownloadTask(url, f, { signal: ctl.signal, onProgress: p => onBytes(p.bytesWritten) })
  const got = await task.downloadAsync()
  if (!got) throw new Error('download paused')
  return got
}

/**
 * Downloads an author: every work as its own file, the verse index split by book, the companion index, then the
 * marker. Progress by bytes of the listing; a failure or a cancel removes the folder, so the author is whole or absent.
 * Resolves true when done, false when cancelled; throws for a failure (the message is for the user).
 */
export async function download(author: string, onProgress?: (fraction: number) => void): Promise<boolean> {
  if (inFlight.has(author) || !authorShown(author)) return false
  const ctl = new AbortController()
  const flight = { fraction: 0, ctl }
  inFlight.set(author, flight)
  const report = (fraction: number) => { flight.fraction = fraction; onProgress?.(fraction); changed() }
  const paths = authorPaths(author)
  try {
    const list = await fetchListing(true)
    const pack: PackAuthor | undefined = list?.authors.find(a => a.id === author)
    if (!pack) throw new Error('This needs a connection to the server.')
    const lib = await get<Library>('/ministry')
    const entry: LibraryAuthor | undefined = lib.authors.find(a => a.id === author)
    if (!entry) throw new Error('The server has no such author.')
    await loadApiBase()
    const base = `${getApiBase()}/api`
    const dir = dirAt(paths.dir)
    if (dir.exists) dir.delete()
    stored.set(author, null); works.clear(); cleansed.clear(); refsBooks.clear()
    const total = packTotal(pack)
    let done = 0
    report(0)
    for (const w of pack.works) {
      await downloadFile(`${base}/ministry/offline/${encodeURIComponent(author)}/${encodeURIComponent(w.id)}`, paths.work(w.id), ctl, n => report(progressOf(done, Math.min(n, w.bytes), total)))
      done += w.bytes
      report(progressOf(done, 0, total))
    }
    if (pack.refs) {
      const tmp = [...paths.dir, 'refs.download']
      const f = await downloadFile(`${base}/ministry/offline/${encodeURIComponent(author)}/refs`, tmp, ctl, n => report(progressOf(done, Math.min(n, pack.refsBytes), total)))
      const all = JSON.parse(await f.text()) as Record<string, RefsChapters>
      f.delete()
      for (const [book, chapters] of Object.entries(all)) writeJson(paths.refs(Number(book)), chapters)
    }
    // the companion's index of the author: the sheet's "on this chapter" without the server
    if (companionWorksOf(entry).length) {
      try { writeJson(paths.companion, await get<{ works: unknown[] }>(`/companion/${author}`)) } catch { /* the sheet asks the server, the library still reads */ }
    }
    if (ctl.signal.aborted) throw new Cancelled()
    const marker: StoredAuthor = { version: pack.version, bytes: pack.bytes, rawBytes: pack.rawBytes, sections: pack.sections, refs: pack.refs, author: entry, downloadedAt: Date.now() }
    writeJson(paths.marker, marker)
    stored.set(author, marker)
    report(1)
    return true
  } catch (e) {
    try { const dir = dirAt(paths.dir); if (dir.exists) dir.delete() } catch { /* half a folder is read as nothing: the marker is missing */ }
    stored.set(author, null)
    if (ctl.signal.aborted || e instanceof Cancelled || (e instanceof Error && e.name === 'AbortError')) return false
    throw e instanceof Error ? e : new Error('The download did not finish.')
  } finally {
    inFlight.delete(author)
    changed()
  }
}

/** Stops a download in flight; its files go. */
export function cancel(author: string) { inFlight.get(author)?.ctl.abort() }

/** Removes a stored author; the library and the sheet go back to asking the server. */
export async function remove(author: string): Promise<void> {
  cancel(author)
  try { const dir = dirAt(authorPaths(author).dir); if (dir.exists) dir.delete() } catch { /* already gone */ }
  stored.set(author, null)
  works.clear(); cleansed.clear(); refsBooks.clear()
  changed()
}
