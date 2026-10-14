/**
 * What else there is on what was searched for (the Search screen's "On this subject"): the dictionary's articles
 * whose headword matches, and the ministry whose titles carry the words. Pure, so tests/subject.test.ts holds the
 * rules; the screen loads the two lists and draws them.
 */
import type { CbdIndex, CbdIndexRow } from '@shared/cbd'
import { searchHeadwords } from '@shared/cbd'

/** The dictionary shows this many articles as chips; the rest are one tap away in the dictionary's own search. */
export const SUBJECT_ARTICLES = 8
/** The library's title search answers with at most this many (rs/src/ministry.rs): at the limit there may be more. */
export const MINISTRY_LIMIT = 30

/** A subject is words: a search by Strong's number, or one too short to mean anything, has none. */
export const isSubject = (query: string): boolean => {
  const q = query.trim().replace(/"/g, '')
  return q.replace(/[^\p{L}]/gu, '').length >= 3 && !/^[GH]\d+$/i.test(q)
}

/** The articles to offer and whether there are more than are shown. */
export function subjectArticles(index: CbdIndex | null, query: string): { rows: CbdIndexRow[]; more: boolean } {
  if (!index || !isSubject(query)) return { rows: [], more: false }
  const all = searchHeadwords(index, query.replace(/"/g, ''), SUBJECT_ARTICLES + 1)
  return { rows: all.slice(0, SUBJECT_ARTICLES), more: all.length > SUBJECT_ARTICLES }
}

/** "1 paper", "12 papers", "30 or more papers". */
export const paperCount = (n: number): string => (n >= MINISTRY_LIMIT ? `${MINISTRY_LIMIT} or more papers` : `${n} ${n === 1 ? 'paper' : 'papers'}`)
