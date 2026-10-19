import type { Ref } from '@shared/ref'

/** Part of a paragraph's line that quotes a verse: characters [a, b) of the line as shown. */
export interface QuoteLink { line: number; a: number; b: number; ref: Ref }

// words as the verse index matches them (shared/ministryIndex.ts wordsOf): letters only, apostrophes inside a word kept
// out, so "Lord's" and the typeset "Lord’s" read the same, and a footnote caller (² or [2]) is no word at all
const WORD = /\p{L}+(?:['’]\p{L}+)*/gu
const fold = (w: string) => w.toLowerCase().replace(/['’]/g, '')

/** "God so loved" → god, so, loved: what a quotation is found by. */
export const quoteWords = (text: string) => [...text.matchAll(WORD)].map(m => fold(m[0]))

export const refOfVerse = (id: number): Ref => ({ book: Math.floor(id / 1_000_000), chapter: Math.floor(id / 1000) % 1000, v1: id % 1000 })

/**
 * Where a paragraph's quotations stand in its lines as shown (`lines`, each line's text as its spans join it). Each
 * quotation's words are found in order after the one before, so a quotation the typesetting has changed (dashes,
 * curled quotes, a caller dropped) is still found and one quoted twice links where it stands; words that cannot be
 * found link nothing. A quotation over a line break is a link on each line.
 */
export function quoteLinks(lines: readonly string[], quotes: readonly { verse: number; words: string }[]): QuoteLink[] {
  const shown: { w: string; line: number; a: number; b: number }[] = []
  lines.forEach((text, line) => { for (const m of text.matchAll(WORD)) shown.push({ w: fold(m[0]), line, a: m.index!, b: m.index! + m[0].length }) })
  const out: QuoteLink[] = []
  let from = 0
  for (const q of quotes) {
    const ws = quoteWords(q.words)
    if (!ws.length) continue
    let k = -1
    for (let i = from; i + ws.length <= shown.length && k < 0; i++) if (ws.every((w, j) => shown[i + j].w === w)) k = i
    if (k < 0) continue
    from = k + ws.length
    const ref = refOfVerse(q.verse)
    const words = shown.slice(k, from)
    for (let line = words[0].line; line <= words[words.length - 1].line; line++) {
      const on = words.filter(w => w.line === line)
      if (on.length) out.push({ line, a: on[0].a, b: on[on.length - 1].b, ref })
    }
  }
  return out
}
