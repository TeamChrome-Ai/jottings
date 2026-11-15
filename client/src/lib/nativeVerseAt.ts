import type { Verse } from '@shared/types'

export const verseLabel = (v: Verse) => (v.nvTo ? `${v.nv ?? v.v}${v.ncTo ? `–${v.ncTo}:` : '-'}${v.nvTo}` : String(v.nv ?? v.v))
const WORD_CHAR = /[\p{L}\p{N}'’]/u

/**
 * Where each verse's number (or its first word, when numbers are off) sits in the paragraph text the native layout
 * measured. The key is matched as a whole word, and the search goes on past the verse's own text: drawn, a verse is
 * never shorter than its text (numbers and note marks only add), so "for" is not found inside "forth", nor a verse
 * number among the digits of the verse before.
 */
export function nativeVerseAts(joined: string, verses: readonly Verse[], opts: { showNumbers: boolean }): { v: number; at: number }[] {
  const hits: { v: number; at: number }[] = []
  let from = 0
  for (const v of verses) {
    if (v.m) continue
    const key = opts.showNumbers ? verseLabel(v) : (v.t.trim().split(/\s+/)[0] ?? '')
    if (!key) continue
    let at = joined.indexOf(key, from)
    while (at >= 0 && ((at > 0 && WORD_CHAR.test(joined[at - 1])) || WORD_CHAR.test(joined[at + key.length] ?? ''))) at = joined.indexOf(key, at + 1)
    if (at < 0) continue
    hits.push({ v: v.v, at })
    from = at + (opts.showNumbers ? key.length : 0) + v.t.trim().length
  }
  return hits
}
