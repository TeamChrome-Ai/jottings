/**
 * Web chapter storage: IndexedDB (the whole Bible is ~6 MB of JSON, far past localStorage's quota).
 * Same interface as the native file store. Keys are editionCore.ts chapterStoreKey: "book.chapter" for the 1961
 * edition, as they always were, "1890:book.chapter" for the 1890 edition.
 */
import { chapterStoreKey, parseStoreKey, type Edition } from './editionCore'

const DB = 'berean'
const STORE = 'chapters'
let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return }
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  dbp.catch(() => { dbp = null })
  return dbp
}
function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const r = run(t.objectStore(STORE))
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  }))
}

export async function readChapterFile(book: number, chapter: number, e: Edition): Promise<string | null> {
  try { return (await tx<string | undefined>('readonly', s => s.get(chapterStoreKey(e, book, chapter)))) ?? null } catch { return null }
}
export async function writeChapterFile(book: number, chapter: number, json: string, e: Edition): Promise<void> {
  try { await tx('readwrite', s => s.put(json, chapterStoreKey(e, book, chapter))) } catch { /* quota or private mode: stays online-only */ }
}
/** The edition's stored chapter keys as "book.chapter". */
export async function listChapterFiles(e: Edition): Promise<string[]> {
  try {
    return (await tx<IDBValidKey[]>('readonly', s => s.getAllKeys())).map(k => parseStoreKey(String(k))).filter(k => k?.edition === e).map(k => `${k!.book}.${k!.chapter}`)
  } catch { return [] }
}
/** The edition's stored chapters, or every edition's. */
export async function removeAllChapterFiles(e?: Edition): Promise<void> {
  try {
    if (!e) { await tx('readwrite', s => s.clear()); return }
    const keys = (await tx<IDBValidKey[]>('readonly', s => s.getAllKeys())).filter(k => parseStoreKey(String(k))?.edition === e)
    for (const k of keys) await tx('readwrite', s => s.delete(k))
  } catch { /* nothing stored */ }
}
/** Every stored chapter of the edition as ["book.chapter", json], in one transaction. */
export async function readAllChapterFiles(e: Edition): Promise<[string, string][]> {
  try {
    const db = await open()
    const all: [string, string][] = await new Promise((resolve, reject) => {
      const s = db.transaction(STORE, 'readonly').objectStore(STORE)
      const keys = s.getAllKeys()
      const vals = s.getAll()
      vals.onsuccess = () => resolve(keys.result.map((k, i) => [String(k), vals.result[i] as string]))
      vals.onerror = () => reject(vals.error)
    })
    return all.flatMap(([k, json]) => { const p = parseStoreKey(k); return p && p.edition === e ? [[`${p.book}.${p.chapter}`, json] as [string, string]] : [] })
  } catch { return [] }
}
