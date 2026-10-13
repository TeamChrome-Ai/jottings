/** Native chapter storage: one file per chapter under <documentDirectory>/bible/<book>/<chapter>.json, the 1890
 *  edition's under bible1890/ (editionCore.ts): a chapter of one edition is never read as the other's. */
import { Directory, File, Paths } from 'expo-file-system'
import type { Edition } from './editionCore'

const EDITIONS: readonly Edition[] = ['1961', '1890']
const root = (e: Edition) => new Directory(Paths.document, e === '1961' ? 'bible' : 'bible1890')
const fileFor = (book: number, chapter: number, e: Edition) => new File(root(e), String(book), `${chapter}.json`)

export async function readChapterFile(book: number, chapter: number, e: Edition): Promise<string | null> {
  try {
    const f = fileFor(book, chapter, e)
    if (!f.exists) return null
    return await f.text()
  } catch { return null }
}

export async function writeChapterFile(book: number, chapter: number, json: string, e: Edition): Promise<void> {
  const dir = new Directory(root(e), String(book))
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  const f = fileFor(book, chapter, e)
  f.write(json)
}

/** The edition's stored chapter keys as "book.chapter". */
export async function listChapterFiles(e: Edition): Promise<string[]> {
  const r = root(e)
  if (!r.exists) return []
  const out: string[] = []
  for (const d of r.list()) {
    if (!(d instanceof Directory)) continue
    const b = parseInt(d.name, 10)
    if (!b) continue
    for (const f of d.list()) {
      const m = /^(\d+)\.json$/.exec(f.name)
      if (m) out.push(`${b}.${m[1]}`)
    }
  }
  return out
}

/** Every stored chapter of the edition as [key, json]. */
export async function readAllChapterFiles(e: Edition): Promise<[string, string][]> {
  const out: [string, string][] = []
  for (const k of await listChapterFiles(e)) {
    const [b, c] = k.split('.').map(Number)
    const json = await readChapterFile(b, c, e)
    if (json) out.push([k, json])
  }
  return out
}

/** The edition's stored chapters, or every edition's. */
export async function removeAllChapterFiles(e?: Edition): Promise<void> {
  for (const x of e ? [e] : EDITIONS) { const r = root(x); if (r.exists) r.delete() }
}
