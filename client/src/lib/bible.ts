/**
 * Scripture data layer. Chapters are static JSON at <apiBase>/bible/<book>/<chapter>.json (the 1890 edition's at
 * /bible1890/, docs/EDITION.md); each one read is kept as a local file so it stays readable offline. "Download whole
 * Bible" unpacks the archive into the same per-chapter files. Every cache here is the edition's own: what is held,
 * stored or bundled for one edition is never shown as the other's.
 */
import { BOOKS, type BookMeta } from '@shared/books'
import type { Chapter, Verse } from '@shared/types'
import { fetchWithTimeout, getApiBase, loadApiBase } from './api'
import { listChapterFiles, readChapterFile, removeAllChapterFiles, writeChapterFile } from './chapterStore'
import { bundledChapter, bundledKeys, hasBundledBible } from './bundledBible'
import { archivePath, chapterEdition, chapterPath, chapterStoreKey, type Meta1890, type Source } from './editionCore'
import { onSourceChange, peekSource, TEXT_VERSION } from './text'
import { WORD_RE_EN, WORD_RE_INTL } from '@shared/texts'
import meta1890 from '../../public/bible1890/meta.json'

/** The 1890 data's version (client/public/bible1890/meta.json): in its URLs, and a change sweeps its stored chapters. */
const V1890 = (meta1890 as Meta1890).v

export type ChapterData = Chapter & { book: number; words?: number }
export const TOTAL_CHAPTERS = 1189

const mem = new Map<string, Promise<ChapterData>>()
const ready = new Map<string, ChapterData>()
const listeners = new Set<() => void>()
export const onOfflineChange = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const notify = () => listeners.forEach(l => l())

/** The version in a source's URLs: the 1890 data's or a language's (a new one is a new address no cache holds). */
const versionOf = (e: Source): string => (e === 'fr' || e === 'de' ? TEXT_VERSION[e] : V1890)
export const chapterUrl = (b: number, c: number, e: Source = peekSource()) => `${getApiBase()}${chapterPath(e, b, c, versionOf(e))}`
export const key = (b: number, c: number) => `${b}.${c}`

/**
 * Chapters stored on the device outrank the bundled archive and the server, so a text correction never reaches a
 * chapter someone has already read unless the stored copies are swept. Bump this when the scripture data changes.
 * 2: the ° Elohim glosses left the New Testament (2026-09-26). 3: gone from the Old Testament too; El is ·God.
 * 4: El and Eloah glosses come from the printed edition's own · and † glyphs, at their printed places.
 * 6: 130 more line-break hyphens mended, names among them (Josa-phat, Matt 1:8; versionCode 47).
 */
export const BIBLE_DATA_VERSION = 6
const DATA_VERSION_KEY = 'berean_bible_data_version'
const DATA_VERSION_1890_KEY = 'berean_bible1890_version'
let swept: Promise<void> | null = null
function ensureDataVersion(): Promise<void> {
  if (!swept) swept = (async () => {
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
      const have = await AsyncStorage.getItem(DATA_VERSION_KEY)
      if (have !== String(BIBLE_DATA_VERSION)) { await removeAllChapterFiles(); await AsyncStorage.setItem(DATA_VERSION_KEY, String(BIBLE_DATA_VERSION)) }
      if (await AsyncStorage.getItem(DATA_VERSION_1890_KEY) !== V1890) { await removeAllChapterFiles('1890'); await AsyncStorage.setItem(DATA_VERSION_1890_KEY, V1890) }
      for (const l of ['fr', 'de'] as const) {
        const k = `berean_bible_${l}_version`
        if (await AsyncStorage.getItem(k) !== TEXT_VERSION[l]) { await removeAllChapterFiles(l); await AsyncStorage.setItem(k, TEXT_VERSION[l]) }
      }
    } catch { /* storage unavailable: nothing to sweep */ }
  })()
  return swept
}

// another edition or Bible: nothing held for the last one is shown again
onSourceChange(() => { mem.clear(); ready.clear(); notify() })

/** The chapter of the Bible shown (or of `e`, the second one side by side): the device's copy, else the app's own
 *  (native), else the server's (then kept). */
export function fetchChapter(book: number, chapter: number, e: Source = peekSource()): Promise<ChapterData> {
  const k = chapterStoreKey(e, book, chapter)
  let p = mem.get(k)
  if (!p) {
    p = (async () => {
      let c: ChapterData | null = null
      await ensureDataVersion()
      const local = await readChapterFile(book, chapter, e)
      if (local) { try { c = JSON.parse(local) as ChapterData } catch { c = null } }
      if (c && chapterEdition(c) !== e) c = null
      if (!c) c = bundledChapter(book, chapter, e)            // native: the archive inside the app
      if (!c) {
        await loadApiBase()
        const r = await fetchWithTimeout(chapterUrl(book, chapter, e))
        if (!r.ok) throw new Error(`chapter ${key(book, chapter)}: ${r.status}`)
        const text = await r.text()
        c = JSON.parse(text) as ChapterData
        // kept as the edition it says it is: a server switched to 1890 answers /bible/ with its 1890 file
        await writeChapterFile(book, chapter, text, chapterEdition(c))
        notify()
      }
      c.book = book
      adopt(c)
      if (chapterEdition(c) === e) ready.set(k, c)
      else mem.delete(k)
      return c
    })()
    mem.set(k, p)
    p.catch(() => mem.delete(k))
  }
  return p
}
/** Synchronous when the chapter is already in memory (page turns). */
export const peekChapter = (book: number, chapter: number, e: Source = peekSource()) => ready.get(chapterStoreKey(e, book, chapter))
export function warmChapter(book: number, chapter: number, e: Source = peekSource()) { fetchChapter(book, chapter, e).catch(() => {}) }
/** Local copy only; null when the chapter has not been stored (offline search). */
export async function readLocalChapter(book: number, chapter: number, e: Source = peekSource()): Promise<ChapterData | null> {
  const hit = ready.get(chapterStoreKey(e, book, chapter))
  if (hit) return hit
  await ensureDataVersion()
  const local = await readChapterFile(book, chapter, e)
  const bundled = () => adopt(bundledChapter(book, chapter, e))
  if (!local) return bundled()
  try { const c = JSON.parse(local) as ChapterData; c.book = book; return chapterEdition(c) === e ? adopt(c) : bundled() } catch { return bundled() }
}

export const book = (n: number): BookMeta => BOOKS[n - 1]
export function nextChapter(b: number, c: number): { book: number; chapter: number } | null {
  if (c < BOOKS[b - 1].chapters) return { book: b, chapter: c + 1 }
  if (b < 66) return { book: b + 1, chapter: 1 }
  return null
}
export function prevChapter(b: number, c: number): { book: number; chapter: number } | null {
  if (c > 1) return { book: b, chapter: c - 1 }
  if (b > 1) return { book: b - 1, chapter: BOOKS[b - 2].chapters }
  return null
}
const FIRST_OF_BOOK: number[] = []
for (let i = 0, n = 0; i < BOOKS.length; n += BOOKS[i].chapters, i++) FIRST_OF_BOOK.push(n)
/** Position in the whole Bible: Genesis 1 = 1, Revelation 22 = 1189. */
export const chapterIndex = (b: number, c: number) => FIRST_OF_BOOK[b - 1] + c
/**
 * Fetch the chapters `depth` turns either side, nearest first, so the reader can lay out its neighbours before a
 * swipe and a quick second turn does not wait on the network either.
 */
export function warmAround(b: number, c: number, depth = 2) {
  type At = { book: number; chapter: number } | null
  let n: At = { book: b, chapter: c }, p: At = n
  for (let i = 0; i < depth; i++) {
    n = n && nextChapter(n.book, n.chapter); if (n) warmChapter(n.book, n.chapter)
    p = p && prevChapter(p.book, p.chapter); if (p) warmChapter(p.book, p.chapter)
  }
}
export const validRef = (b: number, c: number) => b >= 1 && b <= 66 && c >= 1 && c <= (BOOKS[b - 1]?.chapters ?? 0)
export const verseId = (b: number, c: number, v: number) => b * 1_000_000 + c * 1000 + v

export interface Token { tok: string; wi: number; word: boolean; italic: boolean }
/** Verses of a Bible other than the English: they count words in every alphabet (@shared/texts WORD_RE_INTL). */
const intl = new WeakSet<object>()
function adopt<C extends ChapterData | null>(c: C): C {
  if (c && c.tx) for (const v of c.verses) intl.add(v)
  return c
}
const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' }
const unescape = (s: string) => s.replace(/&[a-z#0-9]+;/g, m => ENT[m] ?? m)

/** Verse objects are never mutated after load, so their tokens are computed once per object. */
const tokenCache = new WeakMap<object, readonly Token[]>()

/**
 * Words and separators with a running word index (footnote callers sit before word `pos`). Italics come
 * from `h` (`<i>` is the only tag in the data); plain `t` is used when no html variant exists.
 * The result is shared between callers: treat it as read-only.
 */
export function tokenize(v: Pick<Verse, 't' | 'h'>): readonly Token[] {
  const hit = tokenCache.get(v)
  if (hit) return hit
  const out: Token[] = []
  let wi = 0
  const push = (text: string, italic: boolean) => {
    for (const m of text.matchAll(intl.has(v) ? WORD_RE_INTL : WORD_RE_EN)) {
      if (m[1]) out.push({ tok: m[1], wi: wi++, word: true, italic })
      else out.push({ tok: m[2], wi: -1, word: false, italic })
    }
  }
  if (v.h && v.h.includes('<i>')) {
    const parts = v.h.split(/(<i>|<\/i>)/)
    let italic = false
    for (const p of parts) {
      if (p === '<i>') italic = true
      else if (p === '</i>') italic = false
      else if (p) push(unescape(p.replace(/<[^>]+>/g, '')), italic)
    }
  } else push(v.t, false)
  tokenCache.set(v, out)
  return out
}

// ---------- offline bundle management ----------
export async function offlineStatus(): Promise<{ have: number; total: number }> {
  if (hasBundledBible) return { have: TOTAL_CHAPTERS, total: TOTAL_CHAPTERS }
  const files = await listChapterFiles(peekSource())
  return { have: files.length, total: TOTAL_CHAPTERS }
}
export async function offlineKeys(): Promise<string[]> {
  if (hasBundledBible) return bundledKeys()
  return listChapterFiles(peekSource())
}
/** True when every chapter ships inside the app (native builds); the web build downloads on demand. */
export const bibleIsBundled = hasBundledBible

/** One archive request, unpacked into per-chapter files so the reader and offline search share them. */
export async function downloadAll(onProgress?: (done: number, total: number) => void): Promise<void> {
  const src = peekSource()
  const r = await fetch(`${getApiBase()}${archivePath(src, versionOf(src))}`)
  if (!r.ok) throw new Error(`archive: ${r.status}`)
  const { chapters, ed } = await r.json() as { v: number; ed?: string; chapters: ChapterData[] }
  const e = chapters[0]?.tx ?? chapterEdition({ ed })
  let done = 0
  for (const ch of chapters) {
    await writeChapterFile(ch.book, ch.c, JSON.stringify(ch), e)
    done++
    if (done % 25 === 0 || done === chapters.length) { onProgress?.(done, chapters.length); await new Promise(res => setTimeout(res, 0)) }
  }
  notify()
}
export async function removeOffline() { await removeAllChapterFiles(); mem.clear(); ready.clear(); notify() }
