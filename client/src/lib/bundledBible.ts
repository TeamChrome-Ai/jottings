/**
 * Native builds ship the whole Bible (text + footnotes) inside the app, so reading and search work with no server at
 * all. Each chapter is its own Metro JSON module (the committed client/public/bible/B/C.json the web serves), evaluated
 * the first time it is read: opening the app parses one chapter (a few KB), not the 6 MB archive. Search reads them
 * all, once, when it builds its index. bundledBible.web.ts returns null: the web fetches the same files instead.
 *
 * The 1890 edition (docs/EDITION.md) rides along as what differs: client/public/bible1890/notes/<book>.json holds each
 * chapter's notes (or, where its text differs, the whole chapter), laid over the 1961 chapter on first read.
 */
import type { ChapterData } from './bible'
import { applyOverlay, peekEdition, type Edition, type OverlayEntry } from './editionCore'

const files = require.context('../../public/bible', true, /^\.\/\d+\/\d+\.json$/)
const overlays = require.context('../../public/bible1890/notes', false, /^\.\/\d+\.json$/)
const file = (book: number, chapter: number) => `./${book}/${chapter}.json`
/** Each 1890 chapter made once, so a verse keeps one object (bible.ts caches its tokens by object). */
const made = new Map<string, ChapterData>()

export function bundledChapter(book: number, chapter: number, e: Edition = peekEdition()): ChapterData | null {
  let base: ChapterData & { ed?: string }
  try { base = files(file(book, chapter)) as ChapterData } catch { return null }
  // a neutered build (docs/EDITION.md, "Production build") bundles the 1890 chapters themselves: nothing to lay over
  if (e === '1961' || base.ed === '1890') return base
  const k = `${book}.${chapter}`
  let hit = made.get(k)
  if (!hit) {
    let entry: OverlayEntry | undefined
    try { entry = (overlays(`./${book}.json`) as Record<string, OverlayEntry>)[String(chapter)] } catch { entry = undefined }
    hit = applyOverlay(base, entry)
    made.set(k, hit)
  }
  return hit
}
/** Every bundled chapter as "book.chapter", without reading any of them. */
export const bundledKeys = (): string[] => files.keys().map(k => k.slice(2, -5).replace('/', '.'))
export function bundledChapters(e: Edition = peekEdition()): Map<string, ChapterData> {
  const out = new Map<string, ChapterData>()
  for (const k of files.keys()) {
    const m = /^\.\/(\d+)\/(\d+)\.json$/.exec(k)
    const c = m && bundledChapter(+m[1], +m[2], e)
    if (m && c) out.set(`${m[1]}.${m[2]}`, c)
  }
  return out
}
export const hasBundledBible = true
