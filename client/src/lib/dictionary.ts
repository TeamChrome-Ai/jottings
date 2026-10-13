/**
 * Native builds ship the Concise Bible Dictionary inside the app, like the Bible: Metro JSON modules evaluated on
 * first use. The index (~260 KB) serves search, word lookup and the links to Strong’s; the articles are one module per
 * initial letter of the id (data/cbd/articles, 10 to 410 KB), so opening an article parses its letter, not all 3.3 MB.
 * dictionary.web.ts reads the same two shapes from /api/dictionary instead.
 * Both resolve to null rather than throw, so a missing dictionary never breaks word lookup.
 */
import { buildIndex, type CbdEntry, type CbdIndex, type CbdIndexRow } from '@shared/cbd'

let index: CbdIndex | null = null
const letters = new Map<string, Map<string, CbdEntry>>()
const articles = require.context('../../../data/cbd/articles', false, /^\.\/[a-z]\.json$/)

export async function loadDictionaryIndex(): Promise<CbdIndex | null> {
  if (!index) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      index = buildIndex(require('../../../data/cbd/index.json') as CbdIndexRow[])
    } catch { return null }
  }
  return index
}

export async function loadDictionaryEntry(id: string): Promise<CbdEntry | null> {
  const l = id[0]
  let m = letters.get(l)
  if (!m) {
    try { m = new Map((articles(`./${l}.json`) as CbdEntry[]).map(e => [e.id, e])) } catch { return null }
    letters.set(l, m)
  }
  return m.get(id) ?? null
}

export const dictionaryOffline = true
