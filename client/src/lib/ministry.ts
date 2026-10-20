/**
 * Ministry on a verse or a chapter, on every platform: fetched from the server when the sheet opens and held in memory
 * for the session; nothing is written to the device (only the Bible is stored, and what the reader chose to download
 * under Settings → Offline). A downloaded author's pack carries the verse index, so with every enabled author on the
 * phone a selection is answered from it without asking (offlineMinistryCore.ts mirrors the server's grouping); with
 * some of them, the server is asked first and the phone answers for its authors when the server cannot be reached.
 * Failures resolve to null and are asked again next time.
 */
import { enabledAuthors, type MinistryRefs } from '@shared/ministry'
import { get } from './api'
import { refsFromStored, versesOfRows, type RefsRow } from './offlineMinistryCore'
import { offlineSupported, readRefs, readSectionRaw, storedAuthor } from './offlineMinistry'
import { refsPath } from './ministryShared'
import { N_ } from '@shared/i18n'
import { authorShown, onEditionChange, peekCleanse } from './editionCore'

export { selectionKey } from './ministryShared'

/** What to say when a list cannot be had; on the phone, the way to keep it. */
export const ministryUnavailable = offlineSupported ? N_('This needs a connection to the server. Or download the authors under Settings → Offline.') : N_('This needs a connection to the server.')

const chapters = new Map<string, ReadonlySet<number>>()
const pending = new Map<string, Promise<ReadonlySet<number> | null>>()
const lists = new Map<string, MinistryRefs>()
// another edition: what was held is asked again
onEditionChange(() => { chapters.clear(); lists.clear() })

/** The stored authors whose packs carry the index, with their rows for the chapter; `all` when every enabled author is there. */
async function storedRows(book: number, chapter: number, only?: string) {
  const authors = enabledAuthors().filter(a => authorShown(a.id) && (!only || a.id === only))
  const found = await Promise.all(authors.map(async a => {
    const s = await storedAuthor(a.id)
    if (!s || !s.refs) return null
    return { author: s.author, rows: await readRefs(a.id, book, chapter) }
  }))
  const have = found.filter((f): f is NonNullable<typeof f> => !!f)
  return { have, all: have.length === authors.length && authors.length > 0 }
}

export const peekMinistryVerses = (book: number, chapter: number): ReadonlySet<number> | undefined => chapters.get(`${book}.${chapter}`)

export function ministryVerses(book: number, chapter: number): Promise<ReadonlySet<number> | null> {
  const k = `${book}.${chapter}`
  const hit = chapters.get(k)
  if (hit) return Promise.resolve(hit)
  let p = pending.get(k)
  if (!p) {
    p = (async () => {
      const { have, all } = await storedRows(book, chapter)
      const fromPhone = () => { const set = versesOfRows(have.map(h => h.rows)); chapters.set(k, set); return set as ReadonlySet<number> }
      if (all) return fromPhone()
      try {
        const r = await get<{ verses: number[] }>(`/ministry/chapter/${book}/${chapter}`)
        const set = new Set(r.verses); chapters.set(k, set); return set as ReadonlySet<number>
      } catch { return have.length ? fromPhone() : null }
    })().finally(() => pending.delete(k))
    pending.set(k, p)
  }
  return p
}

/** In flight by path: the reader asks for a selection's list quietly before the sheet opens, and the sheet shares it. */
const refsInFlight = new Map<string, Promise<MinistryRefs | null>>()
export function loadMinistryRefs(book: number, chapter: number, verses: readonly number[], author?: string, page = 1): Promise<MinistryRefs | null> {
  const path = refsPath(book, chapter, verses, author, page)
  let p = refsInFlight.get(path)
  if (!p) {
    p = fetchMinistryRefs(book, chapter, verses, author, page).finally(() => refsInFlight.delete(path))
    refsInFlight.set(path, p)
  }
  return p
}
async function fetchMinistryRefs(book: number, chapter: number, verses: readonly number[], author?: string, page = 1): Promise<MinistryRefs | null> {
  if (author && !authorShown(author)) return null
  const path = refsPath(book, chapter, verses, author, page)
  const hit = lists.get(path)
  if (hit) return hit
  const { have, all } = await storedRows(book, chapter, author)
  const fromPhone = async () => { const r = await refsFromStored(book, chapter, verses, have, readSectionRaw, author, page, peekCleanse()); lists.set(path, r); return r }
  if (all) return fromPhone()
  try {
    const r = await get<MinistryRefs>(path)
    // an answer from before the server switched edition can still name an author it now leaves out
    const v = { ...r, groups: (r.groups ?? []).filter(g => authorShown(g.author)) }
    lists.set(path, v)
    return v
  } catch { return have.length ? fromPhone() : null }
}

export type { RefsRow }
