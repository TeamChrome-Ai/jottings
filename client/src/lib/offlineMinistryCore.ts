/**
 * The offline ministry store's pure parts, free of React Native so the tests run in node: the server's pack listing
 * (GET /api/ministry/offline), where an author's files land on the phone, a row's status from what is stored and what
 * is in flight, download progress, and Ministry on a verse answered from the stored verse index the way
 * rs/src/ministry.rs `group` answers it (same grouping, order, paging and snippets).
 */
import { collectionHidden, collectionsByWork, notesHidden, remapPara, stripCallersAt, subheadingIndices } from '@shared/cleanse'
import { paragraphsOf, type WorkMeta } from '@shared/companion'
import { mentionOfRank, plainOf, snippetOf } from '@shared/ministryIndex'
import { MINISTRY_AUTHORS, type Library, type LibraryAuthor, type MinistryGroup, type MinistryItem, type MinistryRefs, type MinistrySection, type WorkContents } from '@shared/ministry'
import { t, tc } from '@shared/i18n'

// ---------- the server's listing ----------

export interface PackWork { id: string; bytes: number; sections: number }
export interface PackAuthor {
  id: string
  name: string
  short: string
  /** The data's version; a phone holding another one has an older download. */
  version: string
  /** The gzip pack: about what the download moves over the wire. */
  bytes: number
  /** The works' JSON as stored on the phone. */
  rawBytes: number
  sections: number
  /** The verse index rides in the pack: Ministry on a verse works offline too. */
  refs: boolean
  refsBytes: number
  works: PackWork[]
}
export interface PackListing { authors: PackAuthor[] }

/** The listing as the server sent it, or null for anything else (a proxy's HTML, an older server). */
export function parseListing(v: unknown): PackListing | null {
  if (!v || typeof v !== 'object' || !Array.isArray((v as PackListing).authors)) return null
  const authors = (v as PackListing).authors.filter(a => a && typeof a.id === 'string' && typeof a.version === 'string' && Array.isArray(a.works)
    && a.works.every(w => w && typeof w.id === 'string' && typeof w.bytes === 'number'))
  return { authors }
}

/** Everything a download moves, in the works' bytes: the works and the verse index. */
export const packTotal = (a: Pick<PackAuthor, 'works' | 'refs' | 'refsBytes'>) => a.works.reduce((n, w) => n + w.bytes, 0) + (a.refs ? a.refsBytes : 0)

/** How far a download is, 0..1: the works done plus the part of the current one that has landed. */
export function progressOf(doneBytes: number, currentBytes: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, (doneBytes + Math.max(0, currentBytes)) / total))
}

// ---------- the phone's files ----------

/** The store's root folder under the document directory. */
export const OFFLINE_ROOT = 'ministry'
/** Where an author's files land, as path segments under the document directory. author.json is written last: its
 *  presence is what "on this phone" means, so a download cut short leaves no half author. */
export const authorPaths = (author: string) => ({
  dir: [OFFLINE_ROOT, author],
  marker: [OFFLINE_ROOT, author, 'author.json'],
  companion: [OFFLINE_ROOT, author, 'companion.json'],
  work: (work: string) => [OFFLINE_ROOT, author, 'works', `${work}.json`],
  refs: (book: number) => [OFFLINE_ROOT, author, 'refs', `${book}.json`],
})

/** author.json: the listing's entry when it was downloaded and the library's entry for the author. */
export interface StoredAuthor { version: string; bytes: number; rawBytes: number; sections: number; refs: boolean; author: LibraryAuthor; downloadedAt: number }
export function parseStoredAuthor(v: unknown): StoredAuthor | null {
  const s = v as StoredAuthor | null
  if (!s || typeof s !== 'object' || typeof s.version !== 'string' || !s.author || typeof s.author.id !== 'string' || !Array.isArray(s.author.collections)) return null
  return { version: s.version, bytes: +s.bytes || 0, rawBytes: +s.rawBytes || 0, sections: +s.sections || 0, refs: !!s.refs, author: s.author, downloadedAt: +s.downloadedAt || 0 }
}
/** One work's file: its contents (as GET /api/ministry/:author/:work) and every section with its text. */
export interface StoredWork { contents: WorkContents; sections: MinistrySection[] }
export const isStoredWork = (v: unknown): v is StoredWork => {
  const w = v as StoredWork | null
  return !!w && typeof w === 'object' && !!w.contents && Array.isArray(w.contents.sections) && Array.isArray(w.sections)
}

/** The library the stored authors make, registry order (Darby first); null when nothing is stored. */
export function libraryFromStored(stored: readonly StoredAuthor[]): Library | null {
  if (!stored.length) return null
  const order = MINISTRY_AUTHORS.map(a => a.id)
  const authors = [...stored].sort((a, b) => order.indexOf(a.author.id) - order.indexOf(b.author.id)).map(s => s.author)
  return { authors }
}

/** A companion index (works with their sections' metadata, no text) from the stored works of the companion's
 *  collections: Darby's Synopsis, all of Coates. */
export function companionWorksOf(author: LibraryAuthor): string[] {
  const cols = author.id === 'darby' ? author.collections.filter(c => c.id === 'synopsis') : author.collections
  return cols.flatMap(c => c.works.map(w => w.id))
}
export const companionIndexFrom = (works: readonly WorkContents[]): { works: WorkMeta[] } =>
  ({ works: works.map(w => ({ id: w.work.id, title: w.work.title, kind: w.work.kind, sections: w.sections })) })

// ---------- a row's status ----------

export type OfflineStatus =
  | { kind: 'none' }
  | { kind: 'downloading'; fraction: number }
  | { kind: 'stored'; bytes: number; version: string; refs: boolean; /** the server has newer data */ stale?: boolean }

export function deriveStatus(stored: StoredAuthor | null, inFlight: number | null, latest?: Pick<PackAuthor, 'version'> | null): OfflineStatus {
  if (inFlight !== null) return { kind: 'downloading', fraction: inFlight }
  if (!stored) return { kind: 'none' }
  return { kind: 'stored', bytes: stored.rawBytes, version: stored.version, refs: stored.refs, ...(latest && latest.version !== stored.version ? { stale: true } : {}) }
}

/** "48 MB", "3.5 MB", "820 KB": one decimal under 10 MB, none above. */
export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return t('{n} KB', { n: Math.max(1, Math.round(n / 1024)) })
  const mb = n / (1024 * 1024)
  return t('{n} MB', { n: mb < 10 ? mb.toFixed(1) : Math.round(mb) })
}

/** The Settings row's detail line. */
export function statusDetail(status: OfflineStatus, latest: PackAuthor | null | undefined): string {
  switch (status.kind) {
    case 'downloading': return t('Downloading… {pct}%', { pct: Math.round(status.fraction * 100) })
    case 'stored': return status.stale ? t('On this phone · {size} · update available', { size: formatBytes(status.bytes) }) : t('On this phone · {size}', { size: formatBytes(status.bytes) })
    case 'none': return latest ? t('Download · {size}', { size: formatBytes(latest.bytes) }) : latest === null ? t('Download · needs a connection') : tc('verb', 'Download')
  }
}

// ---------- Ministry on a verse, from the stored index ----------

/** A row of the stored index: verse (in its chapter), rank, work (index into the author's works, library order), n,
 *  paragraph (a figure row's slot when note is -1), note (0 the text, k the k-th footnote, -1 a figure row), start,
 *  end, and for a figure row its text. Rows of a chapter come sorted by rank, then reading order. */
export type RefsRow = [verse: number, rank: number, work: number, n: number, para: number, note: number, start: number, end: number, text?: string]
export type RefsChapters = Record<string, RefsRow[]>

export const PER_PAGE = 20

/** The verses of a chapter some row refers to, from every stored author. */
export function versesOfRows(rowsByAuthor: readonly (RefsRow[] | null)[]): Set<number> {
  const out = new Set<number>()
  for (const rows of rowsByAuthor) for (const r of rows ?? []) out.add(r[0])
  return out
}

/** The works of a stored author in the pack's order (the index's `work` column), with the collection each is in. The
 *  author entry is the stored one, whole: the index counts works the cleanse hides, so the order must keep them. */
export function worksInOrder(author: LibraryAuthor): { id: string; title: string; collection: string }[] {
  return author.collections.flatMap(c => c.works.map(w => ({ id: w.id, title: w.title, collection: c.id })))
}

/** The rows the cleanse leaves of a stored chapter's index (shared/cleanse.ts): none into a hidden work, no footnote of
 *  a work whose notes are hidden. A row into a Synopsis sub-heading is dropped where the section is read (groupFromRows),
 *  so a verse named only in a sub-heading still counts here. */
export function cleanseRows(rows: readonly RefsRow[], author: LibraryAuthor): RefsRow[] {
  const works = worksInOrder(author)
  return rows.filter(r => { const w = works[r[2]]; return !!w && !collectionHidden(w.collection) && !(r[5] > 0 && notesHidden(w.collection)) })
}

/** A footnote as the server quotes it: lines joined by a space, tags dropped, entities decoded. */
export const notePlain = (note: string) => plainOf({ quote: false, lines: note.split(/\n+/) })

/**
 * One author's page for the verses, as rs/src/ministry.rs `group`: a paragraph named for several selected verses is
 * listed once, at its best; best rank first, then reading order; PER_PAGE items a page, `page` clamped to the last.
 * `section` reads a stored section as stored (null when the file is not there: the item keeps an empty snippet).
 * `cleanse`: the rows the cleanse leaves (cleanseRows), the Synopsis's paragraphs renumbered past its sub-headings and
 * a row into one dropped, the callers out of a noteless work's snippet, a letter titled by its date.
 */
export async function groupFromRows(author: LibraryAuthor, rows: readonly RefsRow[], verses: readonly number[], page: number,
  section: (work: string, n: number) => Promise<MinistrySection | null>, cleanse = false): Promise<MinistryGroup> {
  const works = worksInOrder(author)
  const want = new Set(verses)
  const seen = new Set<string>()
  const groups: RefsRow[] = []
  for (const r of cleanse ? cleanseRows(rows, author) : rows) {
    if (!want.has(r[0])) continue
    const k = `${r[2]}/${r[3]}/${r[4]}/${r[5]}`
    if (seen.has(k)) continue
    seen.add(k)
    groups.push(r)
  }
  const read = async (r: RefsRow) => { const w = works[r[2]]; return w ? { w, s: await section(w.id, r[3]) } : null }
  // under the cleanse a Synopsis row may point at a sub-heading, which is nothing: those are found before the page is cut
  const kept: { r: RefsRow; w: typeof works[number]; s: MinistrySection | null; para: number }[] = []
  for (const r of groups) {
    if (!cleanse) { const w = works[r[2]]; if (w) kept.push({ r, w, s: null, para: r[4] }); continue }
    const got = await read(r)
    if (!got) continue
    let para = r[4]
    if (r[5] === 0 && got.w.collection === 'synopsis' && got.s) {
      const at = remapPara(para, subheadingIndices(got.s.text))
      if (at === null) continue
      para = at
    }
    kept.push({ ...got, r, para })
  }
  const total = kept.length
  const pages = Math.max(1, Math.ceil(total / PER_PAGE))
  const p = Math.min(Math.max(1, page), pages)
  const items: MinistryItem[] = []
  for (const k of kept.slice((p - 1) * PER_PAGE, p * PER_PAGE)) {
    const [, rank, , n, rawPara, note, start0, end0, rowText] = k.r
    const w = k.w
    const s = cleanse ? k.s : await section(w.id, n)
    let plain = ''
    let [start, end] = [start0, end0]
    if (note < 0) plain = rowText ?? ''
    else if (note > 0) plain = notePlain(s?.notes?.[note - 1] ?? '')
    else if (s) {
      plain = plainOf(paragraphsOf(s.text)[rawPara] ?? { quote: false, lines: [] })
      if (cleanse && notesHidden(w.collection)) ({ text: plain, start, end } = stripCallersAt(plain, start, end))
    }
    // a section whose file is missing keeps an empty snippet, the reference nowhere in it
    const { snippet, hl } = plain ? snippetOf(plain, Math.min(start, plain.length), Math.min(end, plain.length)) : { snippet: '', hl: [0, 0] as [number, number] }
    const title = s ? s.title : ''
    const item: MinistryItem = { work: { id: w.id, title: w.title, collection: w.collection }, n, section: title, para: k.para, mention: mentionOfRank(rank), snippet, hl }
    if (note > 0) item.note = note
    if (note < 0) item.row = true
    items.push(item)
  }
  return { author: author.id, name: author.name, short: author.short, source: author.source, total, page: p, pages, items }
}

/** The whole answer for a selection: every stored author with something (registry order), or one author's page. */
export async function refsFromStored(book: number, chapter: number, verses: readonly number[], authors: readonly { author: LibraryAuthor; rows: RefsRow[] | null }[],
  section: (author: string, work: string, n: number) => Promise<MinistrySection | null>, only?: string, page = 1, cleanse = false): Promise<MinistryRefs> {
  const order = MINISTRY_AUTHORS.map(a => a.id)
  const list = [...authors].filter(a => !only || a.author.id === only).sort((a, b) => order.indexOf(a.author.id) - order.indexOf(b.author.id))
  const groups: MinistryGroup[] = []
  for (const { author, rows } of list) {
    const g = await groupFromRows(author, rows ?? [], verses, only ? page : 1, (w, n) => section(author.id, w, n), cleanse)
    if (only || g.total > 0) groups.push(g)
  }
  return { book, chapter, verses: [...new Set(verses)].sort((a, b) => a - b), groups }
}

export { collectionsByWork }
