/** What the ministry's loaders and its sheet share, free of React Native so the tests run in node: the request paths,
 *  the words for a list that cannot be had, and the rule for the words of a verse a reader picks to look for and how
 *  they are asked for. */
import { wholeWord } from '@shared/cbd'
import { N_ } from '@shared/i18n'
import { isSmallWord, wordsOf } from '@shared/ministryIndex'

/** Selected verses as the API reads them: runs compressed, "16", "16-18", "1,3,7-9". */
export function selectionKey(verses: readonly number[]): string {
  const vs = [...new Set(verses)].sort((a, b) => a - b)
  const runs: [number, number][] = []
  for (const v of vs) {
    const last = runs[runs.length - 1]
    if (last && v === last[1] + 1) last[1] = v
    else runs.push([v, v])
  }
  return runs.map(([a, b]) => a === b ? `${a}` : `${a}-${b}`).join(',')
}

/** What is asked of a selection: one author's page (else every author's first), and the words picked (`q`), if any. */
export interface RefsAsk { author?: string; page?: number; q?: string }

export function refsPath(book: number, chapter: number, verses: readonly number[], { author, page = 1, q }: RefsAsk = {}): string {
  const query = [author ? `author=${encodeURIComponent(author)}&page=${page}` : '', q ? `q=${encodeURIComponent(q)}` : ''].filter(Boolean).join('&')
  return `/ministry/refs/${book}/${chapter}/${selectionKey(verses)}${query ? `?${query}` : ''}`
}

/** What to say when a list cannot be had. */
export const ministryUnavailable = N_('This needs a connection the first time it is opened; what you have opened stays on this device.')

/** Words of a verse picked to be looked for in the ministry: one word, or a run of them, by their place among the
 *  verse's words (bible.ts `tokenize`, `wi`), `from` ≤ `to`. */
export interface WordPick { verse: number; from: number; to: number }
/** The most words asked for at once (docs/API.md, `q`). */
export const MAX_PICKED = 12

/** A word that can be looked for alone: it has letters (the server's words do) and is not a small word ("the", "of"). */
export const askable = (word: string) => wordsOf(word).some(w => !isSmallWord(w.w))

/**
 * The words picked after a tap on one. Nothing picked: the tapped word. One word picked: the run from it to the word
 * tapped, in the same verse (at most MAX_PICKED words, from the first one toward the tap); the same word again clears.
 * A run picked, or one word in another verse: start over at the tapped word. A tap that would leave a small word alone
 * changes nothing; inside a run a small word is welcome.
 */
export function pickWords(picked: WordPick | null, verse: number, wi: number, word: string): WordPick | null {
  const one = picked && picked.verse === verse && picked.from === picked.to ? picked.from : null
  if (one === null) return askable(word) ? { verse, from: wi, to: wi } : picked
  if (wi === one) return null
  const end = wi > one ? Math.min(wi, one + MAX_PICKED - 1) : Math.max(wi, one - MAX_PICKED + 1)
  return { verse, from: Math.min(one, end), to: Math.max(one, end) }
}

type Tokens = readonly { tok: string; wi: number; word: boolean }[]

/**
 * Where the words picked stand in the verse's text (its tokens joined, bible.ts `tokenize`), `[start, end)`: from the
 * first word picked to the last, each end out to its whole word, as the tokenizer splits "Judæa" into "Jud", "æ", "a"
 * (`wholeWord`). Null when the pick names no word of them.
 */
export function pickedSpan(toks: Tokens, p: WordPick): { start: number; end: number } | null {
  const a = toks.findIndex(k => k.word && k.wi === p.from), b = toks.findIndex(k => k.word && k.wi === p.to)
  if (a < 0 || b < a) return null
  const at = (i: number) => toks.slice(0, i).reduce((n, k) => n + k.tok.length, 0)
  const before = wholeWord(toks.slice(0, a + 1), a).length - toks[a].tok.length, after = wholeWord(toks.slice(b), 0).length - toks[b].tok.length
  return { start: at(a) - before, end: at(b + 1) + after }
}

/** The words picked, as asked for: the text of `pickedSpan`, what stands between them as it stands (the server reads
 *  past punctuation). One word picked asks as the word sheet asks for the word tapped, so the two share a list. */
export function pickedPhrase(toks: Tokens, p: WordPick): string {
  const s = pickedSpan(toks, p)
  return s ? toks.map(k => k.tok).join('').slice(s.start, s.end) : ''
}
