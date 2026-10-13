/**
 * Strong's Exhaustive Concordance as the word sheet shows it: the response of GET /api/strongs/:code and the pure
 * helpers that lay one page of it out (grouping by book, the line shown for a verse). Word positions follow the
 * reader's tokenizer (client/src/lib/bible.ts `tokenize`), which is how the server stores them.
 */

/** Verses per page of occurrences, as the dictionary pages its headwords. */
export const OCCURRENCE_PAGE = 30

export interface StrongsBook { book: number; occurrences: number; verses: number }
/** A verse holding the number; `w`: the positions of its words tagged with it. */
export interface StrongsOccurrence { book: number; chapter: number; verse: number; text: string; w: number[] }
/**
 * One number: Strong's own entry (the word, transliteration, pronunciation, and the KJV renderings as he lists them,
 * null where he gives none), then the concordance of Darby's text: his renderings with counts, the totals, the
 * per-book counts in canonical order, and the page of verses starting at `offset`.
 */
export interface StrongsInfo {
  code: string; lemma: string | null; translit: string | null; pron: string | null; kjv: string | null
  renderings: [word: string, count: number][]
  occurrences: number; verses: number; books: StrongsBook[]
  offset: number; page: StrongsOccurrence[]
}

/** A Strong's number as typed ("G1320", "h0430", "g 26") in the tags' spelling ("G1320", "H430"), else null. */
export function strongsCode(query: string): string | null {
  const m = /^\s*([GHgh])\s*0*([1-9]\d{0,4})\s*$/.exec(query)
  return m ? m[1].toUpperCase() + m[2] : null
}

/** The 1-based page holding a book's first verse. */
export function bookPage(books: readonly StrongsBook[], book: number, size = OCCURRENCE_PAGE): number {
  let before = 0
  for (const b of books) { if (b.book === book) break; before += b.verses }
  return Math.floor(before / size) + 1
}

export interface BookGroup extends StrongsBook {
  /** The book began on an earlier page. */
  continued: boolean
  items: StrongsOccurrence[]
}
/** A page of verses (starting at `offset` in the whole list) cut into its books, each with the book's counts. */
export function groupByBook(page: readonly StrongsOccurrence[], books: readonly StrongsBook[], offset: number): BookGroup[] {
  const start = new Map<number, number>()
  let before = 0
  for (const b of books) { start.set(b.book, before); before += b.verses }
  const out: BookGroup[] = []
  page.forEach((o, i) => {
    const last = out[out.length - 1]
    if (last && last.book === o.book) { last.items.push(o); return }
    const b = books.find(x => x.book === o.book) ?? { book: o.book, occurrences: 0, verses: 0 }
    out.push({ ...b, continued: offset + i > (start.get(o.book) ?? 0), items: [o] })
  })
  return out
}

export interface LinePart { text: string; hit: boolean }
const TOKEN_RE = /([A-Za-z0-9'’]+)|([^A-Za-z0-9'’]+)/g

/**
 * A verse as the list shows it: the words at `w` set apart (`hit`), everything else plain. A verse of more than `max`
 * words is cut to `max` of them around the first tagged one (a quarter of them before it), with an ellipsis where
 * words were left out.
 */
export function concordanceLine(text: string, w: readonly number[], max = 40): LinePart[] {
  const toks: { tok: string; wi: number }[] = []
  let wi = 0
  for (const m of text.matchAll(TOKEN_RE)) toks.push(m[1] ? { tok: m[1], wi: wi++ } : { tok: m[2], wi: -1 })
  const hits = new Set(w)
  let from = 0, to = wi
  if (wi > max) {
    const first = w.length ? Math.min(...w) : 0
    from = Math.max(0, Math.min(first - Math.floor(max / 4), wi - max))
    to = from + max
  }
  const out: LinePart[] = []
  const push = (s: string, hit: boolean) => {
    const last = out[out.length - 1]
    if (last && last.hit === hit) last.text += s
    else out.push({ text: s, hit })
  }
  if (from > 0) push('… ', false)
  // a separator is shown between two shown words, before the first only from the verse's start, after the last only
  // at the verse's end
  let prev = -1
  for (const t of toks) {
    if (t.wi >= 0) { prev = t.wi; if (t.wi >= from && t.wi < to) push(t.tok, hits.has(t.wi)); continue }
    if (prev < 0 ? from === 0 : prev >= from && (prev < to - 1 || to === wi)) push(t.tok, false)
  }
  if (to < wi) push(' …', false)
  return out
}

/** The marks in Strong's rendering lists, as his key explains them; only those a list uses are shown. */
const KEY: [mark: string, meaning: string][] = [['×', 'an idiom of the original'], ['+', 'with another word']]
export function renderingKey(kjv: string | null | undefined): string {
  return KEY.filter(([m]) => kjv?.includes(m)).map(([m, s]) => `${m} ${s}`).join(' · ')
}
