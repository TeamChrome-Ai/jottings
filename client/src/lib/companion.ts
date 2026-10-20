/**
 * The companion (Darby's Synopsis, Coates's Outlines) on every platform: nothing of it is stored on the device unless
 * the reader downloaded the author under Settings → Offline (native, offlineMinistry.ts), whose copy is read first.
 * Otherwise each author's index (which sections treat which passages) comes from GET /api/companion/{author} once, a
 * chapter's sections from GET /api/companion/{author}/passage/{book}/{chapter} when the sheet opens, one section from
 * GET /api/companion/{author}/{work}/{n} in the library, all held in memory for the session. Failures resolve to null
 * and are asked again next time.
 */
import { sectionsFor, type AuthorId, type CompanionIndex, type Reading, type Section, type WorkMeta } from '@shared/companion'
import { get } from './api'
import { isStored, readCompanionIndex, readSection } from './offlineMinistry'
import { authorShown } from './editionCore'
import { N_ } from '@shared/i18n'

const indexes = new Map<AuthorId, Promise<CompanionIndex | null>>()
const sections = new Map<string, Section>()
const chapters = new Map<string, Reading[]>()

/** An author the edition leaves out (editionCore.ts) has nothing: no index, chapter or section, whatever is held. */
export function loadCompanionIndex(author: AuthorId): Promise<CompanionIndex | null> {
  if (!authorShown(author)) return Promise.resolve(null)
  let p = indexes.get(author)
  if (!p) {
    p = (async () => {
      const kept = await readCompanionIndex(author).catch(() => null)
      if (kept) return kept
      try { const i = await get<{ works: WorkMeta[] }>(`/companion/${author}`); return { author, works: i.works } }
      catch { indexes.delete(author); return null }
    })()
    indexes.set(author, p)
  }
  return p
}

export async function loadCompanionSection(author: AuthorId, work: string, n: number): Promise<Section | null> {
  if (!authorShown(author)) return null
  const k = `${author}/${work}/${n}`
  const hit = sections.get(k)
  if (hit) return hit
  const kept = await readSection(author, work, n).catch(() => null)
  if (kept) { sections.set(k, kept); return kept }
  try {
    const r = await get<{ section: Section }>(`/companion/${author}/${encodeURIComponent(work)}/${n}`)
    sections.set(k, r.section)
    return r.section
  } catch { return null }
}

export async function loadCompanionChapter(author: AuthorId, book: number, chapter: number): Promise<Reading[] | null> {
  if (!authorShown(author)) return null
  const k = `${author}/${book}.${chapter}`
  const hit = chapters.get(k)
  if (hit) return hit
  const idx = await loadCompanionIndex(author)
  if (idx && !sectionsFor(idx, book, chapter).length) return []
  // the author on the phone: the index says which sections, the stored works give their text
  if (idx && await isStored(author).catch(() => false)) {
    const places = sectionsFor(idx, book, chapter)
    const texts = await Promise.all(places.map(p => loadCompanionSection(author, p.work.id, p.n)))
    if (texts.every((t): t is Section => !!t)) {
      const r: Reading[] = places.map((p, i) => ({ ...p, section: texts[i] }))
      chapters.set(k, r)
      return r
    }
  }
  try {
    const r = await get<Reading[]>(`/companion/${author}/passage/${book}/${chapter}`)
    for (const p of r) sections.set(`${author}/${p.work.id}/${p.n}`, p.section)
    chapters.set(k, r)
    return r
  } catch { return null }
}

/** What to say when a reading cannot be had. */
export const companionUnavailable = N_('This needs a connection to the server.')
