/**
 * The ministry library's loaders, one implementation for both platforms: ministryLibrary.ts hands it the offline store
 * (native: authors downloaded under Settings → Offline, offlineMinistry.ts), ministryLibrary.web.ts none (memory only).
 * Nothing is written by these loaders: what they fetch is held in memory for the session.
 *
 * - The library (GET /api/ministry): the server's list; failing that the downloaded authors; failing that the
 *   companion's own works (the Synopsis and Coates), so the library is never empty.
 * - A work's contents (GET /api/ministry/:author/:work): the phone's copy when the author is downloaded; a companion
 *   work's from its index, without asking; else the server.
 * - A section (GET /api/ministry/:author/:work/:n): the phone's copy when the author is downloaded; a companion work's
 *   through the companion's loader, so the reader's sheet and the library share one copy; else the server.
 *
 * - A title search (GET /api/ministry/search?q=): the server only, each query's answer kept for the session; offline, or
 *   when the server has no answer, nothing (the library's own searches still work).
 *
 * `peek*` answer synchronously from memory: a page a turn carries in shows in the same commit, with no spinner.
 */
import type { AuthorId } from '@shared/companion'
import type { Library, MinistryReading, MinistrySection, SectionHit, SectionSearch, TextSearch, WorkContents } from '@shared/ministry'
import { get } from './api'
import { loadCompanionIndex, loadCompanionSection } from './companion'
import { contentsFromIndex, libraryFromCompanion } from './libraryNav'

/** What the phone holds of the ministry by the reader's choice; null answers mean "not downloaded". */
export interface OfflineStore {
  library(): Promise<Library | null>
  contents(author: string, work: string): Promise<WorkContents | null>
  section(author: string, work: string, n: number): Promise<MinistrySection | null>
}

const COMPANION: readonly AuthorId[] = ['darby', 'coates']
const isCompanionAuthor = (a: string): a is AuthorId => (COMPANION as readonly string[]).includes(a)
/** With downloaded authors on hand the server gets this long for the list before the phone's copy shows. */
const LIBRARY_TIMEOUT_MS = 4_000

export type TextAnswer = ({ kind: 'found' } & TextSearch) | { kind: 'unavailable' } | { kind: 'unsupported' }
export interface TextAsk { page?: number; author?: string }
const NOTHING: TextAnswer = { kind: 'found', q: '', total: 0, exact: 0, page: 1, pages: 1, authors: [], items: [] }

const isTextSearch = (r: unknown): r is TextSearch => {
  const s = r as TextSearch | null
  return !!s && typeof s.q === 'string' && [s.total, s.exact, s.page, s.pages].every(n => typeof n === 'number')
    && Array.isArray(s.authors) && s.authors.every(a => typeof a?.id === 'string' && typeof a.short === 'string' && typeof a.total === 'number')
    && Array.isArray(s.items) && s.items.every(i => typeof i?.author === 'string' && typeof i.work?.id === 'string' && typeof i.n === 'number'
      && typeof i.para === 'number' && typeof i.snippet === 'string' && Array.isArray(i.hl) && i.hl.length === 2)
}
const statusOf = (e: unknown) => (e as { status?: unknown } | null)?.status

/**
 * `shown`: whether the edition shows an author (editionCore.ts authorShown); one it leaves out is in no list and has no
 * contents or section, whatever is held for it. `reset` drops everything held (another edition's answers); an answer
 * asked for before it is neither kept nor shared.
 */
export function createMinistryLoaders(store: OfflineStore | null, shown: (author: string) => boolean = () => true) {
  let library: Library | null = null
  const contents = new Map<string, WorkContents>()
  const sections = new Map<string, MinistrySection>()
  const searches = new Map<string, SectionHit[]>()
  const texts = new Map<string, TextAnswer>()
  let textUnsupported = false
  let resets = 0
  const inflight = new Map<string, Promise<unknown>>()
  /** One request per key at a time: a page and its neighbour asking together share it, never across a reset. */
  const once = <T,>(key: string, run: () => Promise<T>): Promise<T> => {
    const k = `${resets}:${key}`
    const hit = inflight.get(k) as Promise<T> | undefined
    if (hit) return hit
    const p = run().finally(() => inflight.delete(k))
    inflight.set(k, p)
    return p
  }
  const offline = async <T,>(read: (s: OfflineStore) => Promise<T | null>): Promise<T | null> => {
    if (!store) return null
    try { return await read(store) } catch { return null }
  }

  const visible = (l: Library): Library => (l.authors.every(a => shown(a.id)) ? l : { ...l, authors: l.authors.filter(a => shown(a.id)) })

  /** The companion work, when this is one: its index is on hand without the server. */
  async function companionWork(author: string, work: string) {
    if (!isCompanionAuthor(author)) return null
    const index = await loadCompanionIndex(author)
    return index && index.works.some(w => w.id === work) ? index : null
  }

  function loadLibrary(): Promise<Library> {
    if (library) return Promise.resolve(visible(library))
    const asked = resets
    return once('library', async () => {
      const kept = await offline(s => s.library())
      try {
        const l = await get<Library>('/ministry', kept ? { timeoutMs: LIBRARY_TIMEOUT_MS } : undefined)
        if (l && Array.isArray(l.authors)) { if (asked === resets) library = l; return visible(l) }
      } catch { /* the phone's copy, else the companion's */ }
      if (kept && Array.isArray(kept.authors) && kept.authors.length) return visible(kept)
      const indexes = await Promise.all(COMPANION.filter(shown).map(a => loadCompanionIndex(a)))
      return libraryFromCompanion(indexes.filter((i): i is NonNullable<typeof i> => !!i))
    })
  }

  function loadContents(author: string, work: string): Promise<WorkContents | null> {
    if (!shown(author)) return Promise.resolve(null)
    const k = `${author}/${work}`
    const hit = contents.get(k)
    if (hit) return Promise.resolve(hit)
    const asked = resets
    return once(`c:${k}`, async () => {
      let c: WorkContents | null = await offline(s => s.contents(author, work))
      if (!c) {
        const index = await companionWork(author, work)
        c = index ? contentsFromIndex(index, work) : null
      }
      if (!c) {
        try { c = await get<WorkContents>(`/ministry/${encodeURIComponent(author)}/${encodeURIComponent(work)}`) } catch { return null }
      }
      if (c && Array.isArray(c.sections)) { if (asked === resets) contents.set(k, c); return c }
      return null
    })
  }

  function loadSection(author: string, work: string, n: number): Promise<MinistrySection | null> {
    if (!shown(author)) return Promise.resolve(null)
    const k = `${author}/${work}/${n}`
    const hit = sections.get(k)
    if (hit) return Promise.resolve(hit)
    const asked = resets
    return once(`s:${k}`, async () => {
      let s: MinistrySection | null = await offline(st => st.section(author, work, n))
      if (!s) {
        if (await companionWork(author, work)) s = await loadCompanionSection(author as AuthorId, work, n)
        else {
          try { s = (await get<MinistryReading>(`/ministry/${encodeURIComponent(author)}/${encodeURIComponent(work)}/${n}`)).section } catch { return null }
        }
      }
      if (s && typeof s.text === 'string') { if (asked === resets) sections.set(k, s); return s }
      return null
    })
  }

  /** Sections whose title has every word of `query`, the server's order (a phrase first); [] offline or on any failure. */
  function searchSections(query: string): Promise<SectionHit[]> {
    const q = query.trim()
    if (!q) return Promise.resolve([])
    const hit = searches.get(q)
    if (hit) return Promise.resolve(hit.filter(h => shown(h.author)))
    const asked = resets
    return once(`q:${q}`, async () => {
      try {
        const r = await get<SectionSearch>(`/ministry/search?q=${encodeURIComponent(q)}`)
        const hits = Array.isArray(r?.hits) ? r.hits : []
        if (asked === resets) searches.set(q, hits)
        return hits.filter(h => shown(h.author))
      } catch { return [] }
    })
  }

  function searchText(query: string, { page = 1, author }: TextAsk = {}): Promise<TextAnswer> {
    const q = query.trim()
    if (!q) return Promise.resolve(NOTHING)
    if (textUnsupported) return Promise.resolve({ kind: 'unsupported' })
    const k = `${q}|${author ?? ''}|${page}`
    const hit = texts.get(k)
    if (hit) return Promise.resolve(hit)
    const asked = resets
    return once(`x:${k}`, async (): Promise<TextAnswer> => {
      try {
        const r = await get<unknown>(`/ministry/text?q=${encodeURIComponent(q)}${page > 1 ? `&page=${page}` : ''}${author ? `&author=${encodeURIComponent(author)}` : ''}`)
        if (!isTextSearch(r)) return { kind: 'unavailable' }
        const found: TextAnswer = { kind: 'found', ...r }
        if (asked === resets) texts.set(k, found)
        return found
      } catch (e) {
        const serverOlderThanTheSearch = statusOf(e) === 404 && !author
        if (serverOlderThanTheSearch) { textUnsupported = true; return { kind: 'unsupported' } }
        return { kind: 'unavailable' }
      }
    })
  }

  return {
    loadLibrary,
    searchSections,
    searchText,
    peekLibrary: () => (library ? visible(library) : null),
    loadContents,
    peekContents: (author: string, work: string) => (shown(author) ? contents.get(`${author}/${work}`) : undefined),
    loadSection,
    peekSection: (author: string, work: string, n: number) => (shown(author) ? sections.get(`${author}/${work}/${n}`) : undefined),
    reset: () => { library = null; contents.clear(); sections.clear(); searches.clear(); texts.clear(); resets++ },
  }
}
