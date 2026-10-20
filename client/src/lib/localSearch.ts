/**
 * Verse search on the device (shared/search.ts) whenever the whole text is here: always on native, where the
 * Bible is bundled, and on web once every chapter is stored. Otherwise callers get null and ask the server.
 * The index is built once per launch in short turns, so the UI keeps drawing, and native keeps it on disk.
 */
import Constants from 'expo-constants'
import { IndexBuilder, restoreIndex, searchIndex, serializeIndex, type SearchIndex, type VerseRow } from '@shared/search'
import type { SearchOrder, SearchResponse } from '@shared/types'
import { TOTAL_CHAPTERS, onOfflineChange, type ChapterData } from './bible'
import { bundledChapters, hasBundledBible } from './bundledBible'
import { listChapterFiles, readAllChapterFiles } from './chapterStore'
import { loadIndexBytes, saveIndexBytes } from './searchIndexStore'
import { onSourceChange, peekSource } from './text'

/** Build work per turn of the event loop: short while nobody waits, long once a query waits on the index. */
const IDLE_BUDGET_MS = 12
const WAITING_BUDGET_MS = 100
const CHUNK = 100
const nextTick = () => new Promise<void>(res => setTimeout(res, 0))
let waiting = false

let complete: boolean | null = hasBundledBible ? true : null
let index: Promise<SearchIndex | null> | null = null
onOfflineChange(() => { if (!hasBundledBible) complete = null })
// the index is of the text shown: the edition's (the same text unless the 1890 edition has its own), or another
// language's Bible; storeKey tells them apart
onSourceChange(() => { complete = hasBundledBible ? true : null; index = null })

async function haveWholeText(): Promise<boolean> {
  if (complete === null) {
    complete = (await listChapterFiles(peekSource())).length >= TOTAL_CHAPTERS
    if (!complete) index = null
  }
  return complete
}

async function loadRows(): Promise<VerseRow[] | null> {
  let chapters: ChapterData[]
  const e = peekSource()
  if (hasBundledBible) chapters = [...bundledChapters(e).values()]
  else {
    chapters = []
    for (const [k, json] of await readAllChapterFiles(e)) {
      try { const ch = JSON.parse(json) as ChapterData; ch.book = Number(k.split('.')[0]); chapters.push(ch) } catch { /* a damaged chapter: counted below */ }
    }
  }
  if (chapters.length < TOTAL_CHAPTERS) return null
  chapters.sort((a, b) => a.book - b.book || a.c - b.c)
  const rows: VerseRow[] = []
  for (const ch of chapters) for (const v of ch.verses) rows.push({ book: ch.book, chapter: ch.c, verse: v.v, text: v.t })
  return rows
}

/** Changes with the app build or the text itself (verse count and length), so a stored index never outlives its text. */
function storeKey(rows: VerseRow[]): string {
  let chars = 0
  for (const r of rows) chars += r.text.length
  const c = Constants.expoConfig
  return `${c?.version ?? '0'}-${c?.android?.versionCode ?? c?.ios?.buildNumber ?? '0'}-${peekSource()}-${rows.length}-${chars}`.replace(/[^\w.-]/g, '_')
}

async function build(): Promise<SearchIndex | null> {
  const rows = await loadRows()
  if (!rows) return null
  const key = storeKey(rows)
  const stored = await loadIndexBytes(key)
  const restored = stored && restoreIndex(rows, stored)
  if (restored) return restored
  const b = new IndexBuilder()
  // timers are clamped (4 ms nested on web, a frame on native), so yield per time budget, not per chunk
  for (let i = 0; i < rows.length;) {
    await nextTick()
    const t0 = Date.now()
    while (i < rows.length && Date.now() - t0 < (waiting ? WAITING_BUDGET_MS : IDLE_BUDGET_MS)) { b.add(rows.slice(i, i + CHUNK)); i += CHUNK }
  }
  const ix = b.finish()
  nextTick().then(() => saveIndexBytes(key, serializeIndex(ix)))
  return ix
}

function getIndex(): Promise<SearchIndex | null> {
  if (!index) {
    const p = build().catch(() => null)
    index = p
    p.then(ix => {
      if (!ix) { if (index === p) index = null; return }
      // the first call pays for compiling the search path (tens of ms): spend it before the reader's first query
      nextTick().then(() => searchIndex(ix, 'the lord'))
    })
  }
  return index
}

/** Starts loading the index in the background; safe to call on every visit. */
export function warmLocalSearch() {
  haveWholeText().then(ok => { if (ok) getIndex() }).catch(() => {})
}

/** The server's /api/search answer computed here, or null when the whole text is not on this device. */
export async function searchLocal(q: string, scope: string, limit: number, order?: SearchOrder): Promise<SearchResponse | null> {
  if (!(await haveWholeText())) return null
  waiting = true
  try {
    const ix = await getIndex()
    return ix && searchIndex(ix, q, { scope, limit, order })
  } finally { waiting = false }
}
