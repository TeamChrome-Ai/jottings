/**
 * The Strong's numbers behind an English word (GET /api/strongs/word/{word}): a word of the ministry carries no tag,
 * so the sheet asks which numbers Darby's text renders with it and opens on the commonest. Answers are kept for the
 * session; a slow or failed request answers "" (no number), and the sheet has the subject alone, as for any untagged
 * word in the Bible reader.
 */
import { get } from './api'

export interface WordCode { code: string; count: number; lemma: string | null }
const cache = new Map<string, Promise<WordCode[]>>()

export function wordCodes(word: string): Promise<WordCode[]> {
  const k = word.toLowerCase()
  let p = cache.get(k)
  if (!p) {
    p = get<{ codes: WordCode[] }>(`/strongs/word/${encodeURIComponent(word)}`).then(r => r.codes, () => { cache.delete(k); return [] })
    cache.set(k, p)
  }
  return p
}

/** The word's commonest number, or "" when none is known within `waitMs` (the sheet opens on time either way). */
export function topWordCode(word: string, waitMs = 700): Promise<string> {
  return Promise.race([wordCodes(word).then(c => c[0]?.code ?? ''), new Promise<string>(r => setTimeout(() => r(''), waitMs))])
}
