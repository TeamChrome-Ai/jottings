/**
 * The word under a tap in prose (a ministry page): the tokens either side of a character offset. The reader's prose
 * keeps hyphens and apostrophes inside a word ("world-system", "Lord’s"), unlike the Bible tokenizer, which splits on
 * anything outside A-Z (client/src/lib/bible.ts): Darby's own compounds are looked up whole.
 */

export interface WordTap {
  /** The word tapped, as printed (trailing punctuation off). */
  word: string
  /** The words before and after it in the same paragraph ("" at an edge), for two-word terms ("old man", "Lord’s table"). */
  prev: string
  next: string
}

const WORD = /[\p{L}\p{M}\p{N}]+(?:[’'\-][\p{L}\p{M}\p{N}]+)*/gu

/** Every word of a text with where it starts. */
export function proseWords(text: string): { word: string; at: number }[] {
  const out: { word: string; at: number }[] = []
  for (const m of text.matchAll(WORD)) out.push({ word: m[0], at: m.index })
  return out
}

/** The word covering (or ending exactly at) character `offset` of `text`, with its neighbours; null on a space. */
export function wordAtOffset(text: string, offset: number): WordTap | null {
  const words = proseWords(text)
  const i = words.findIndex(w => offset >= w.at && offset <= w.at + w.word.length)
  if (i < 0) return null
  return { word: words[i].word, prev: words[i - 1]?.word ?? '', next: words[i + 1]?.word ?? '' }
}

/** The tap for word `i` of a tokenised run. */
export const wordTapAt = (words: readonly string[], i: number): WordTap => ({ word: words[i], prev: words[i - 1] ?? '', next: words[i + 1] ?? '' })
