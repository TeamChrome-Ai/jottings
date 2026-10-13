/**
 * Verse search without the server. Answers what rs/src/search.rs answers: the same query grammar, the same
 * matches, FTS5's bm25() order and snippet() windows, and the trigram substring fallback. Pure: the caller
 * supplies the verses and keeps the index.
 *
 * The index is two flat arrays: every token of every verse as a term id (phrase checks, tf, snippets) and, per
 * term, the verses holding it (candidates). Term ids follow the sorted term list, so a prefix is an id range.
 */
import { bareBook, looksLikeRef, parseRef, type Ref } from './ref.js'
import type { SearchHit, SearchOrder, SearchResponse } from './types.js'

export interface VerseRow { book: number; chapter: number; verse: number; text: string }

export interface SearchIndex {
  rows: VerseRow[]
  /** sorted; a term's id is its position */
  terms: string[]
  /** post[postStart[t] .. postStart[t + 1]) = ascending row numbers containing term t */
  postStart: Uint32Array
  post: Uint16Array
  /** occurrences of the term in that row, parallel to post (capped at 255) */
  postTf: Uint8Array
  /** toks[tokStart[r] .. tokStart[r + 1]) = row r's tokens as term ids, in order */
  tokStart: Uint32Array
  toks: Uint16Array
  /** mean characters - 2 per row, the trigram fallback's average length; set on its first use */
  gramsAvg?: number
}

// ---------- tokens: FTS5 unicode61 with remove_diacritics 2 ----------

/** Letters and digits are token characters; everything else separates (apostrophes and hyphens included). */
export function isWordChar(c: number): boolean {
  if (c < 128) return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
  if (c < 0xc0) return c === 0xaa || c === 0xb5 || c === 0xba
  if (c < 0x250) return c !== 0xd7 && c !== 0xf7
  // Greek to the end of the general scripts, then CJK and beyond; punctuation and symbols (U+2000..2BFF, the
  // CJK punctuation block) separate
  return (c >= 0x370 && c < 0x2000) || (c >= 0x2c00 && (c < 0x3000 || c > 0x303f))
}

const DIACRITIC: Record<string, string> = {
  à: 'a', á: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a', ç: 'c', è: 'e', é: 'e', ê: 'e', ë: 'e', ì: 'i', í: 'i', î: 'i', ï: 'i',
  ñ: 'n', ò: 'o', ó: 'o', ô: 'o', õ: 'o', ö: 'o', ø: 'o', ù: 'u', ú: 'u', û: 'u', ü: 'u', ý: 'y', ÿ: 'y',
}
const HAS_DIACRITIC = /[à-åç-ëì-ïñò-öøù-üýÿ]/
const DIACRITIC_G = /[à-åç-ëì-ïñò-öøù-üýÿ]/g
/** Case and accents folded as the server's index folds them ("Ïtalia" = "italia"); æ and œ stay ligatures. */
export function fold(term: string): string {
  const t = term.toLowerCase()
  return HAS_DIACRITIC.test(t) ? t.replace(DIACRITIC_G, ch => DIACRITIC[ch]) : t
}

/** Calls `each(start, end)` for every token of `text`, in order (UTF-16 offsets, end exclusive). */
export function forEachToken(text: string, each: (start: number, end: number) => void) {
  let s = -1
  for (let i = 0; i < text.length; i++) {
    if (isWordChar(text.charCodeAt(i))) { if (s < 0) s = i }
    else if (s >= 0) { each(s, i); s = -1 }
  }
  if (s >= 0) each(s, text.length)
}

/** The folded terms of `text`, as the index sees them. */
export function termsOf(text: string): string[] {
  const out: string[] = []
  forEachToken(text, (s, e) => out.push(fold(text.slice(s, e))))
  return out
}

// ---------- queries: fts_query() in rs/src/search.rs ----------

/** A run of terms that must be adjacent; with `prefix` the last term matches any term it begins. */
export interface Phrase { terms: string[]; prefix: boolean }

/**
 * Quoted phrases stay phrases; bare words of 3+ characters match as prefixes; hyphenated words become phrases
 * (prefix on the last part). Every phrase must match (AND). null when the query holds no searchable text.
 */
export function parseQuery(q: string, prefix: boolean): Phrase[] | null {
  const parts: Phrase[] = []
  let rest = q
  while (rest) {
    rest = rest.trimStart()
    if (!rest) break
    if (rest[0] === '"') {
      const r = rest.slice(1)
      const close = r.indexOf('"')
      const phrase = r.slice(0, close < 0 ? r.length : close).trim()
      if (phrase) parts.push({ terms: termsOf(phrase), prefix: false })
      rest = close < 0 ? '' : r.slice(close + 1)
      continue
    }
    const ws = /\s/.exec(rest)
    const end = ws ? ws.index : rest.length
    const word = rest.slice(0, end)
    rest = rest.slice(end)
    const pieces = word.split(/[-–—]/)
      .map(p => [...p].filter(ch => isWordChar(ch.codePointAt(0)!) || ch === "'" || ch === '’').join(''))
      .filter(p => p)
    if (!pieces.length) continue
    if (pieces.length > 1) parts.push({ terms: termsOf(pieces.join(' ')), prefix })
    else parts.push({ terms: termsOf(pieces[0]), prefix: prefix && [...pieces[0]].length >= 3 })
  }
  return parts.length ? parts : null
}

// ---------- index ----------

/** Adds verses in canonical order, a slice at a time so a UI thread can yield between slices. */
export class IndexBuilder {
  private rows: VerseRow[] = []
  private ids = new Map<string, number>()
  private names: string[] = []
  private raw = new Uint32Array(1 << 20)
  private count = 0
  private starts: number[] = []

  add(rows: readonly VerseRow[]) {
    for (const row of rows) {
      this.rows.push(row)
      this.starts.push(this.count)
      // one toLowerCase per verse; per-token folding only where the lengths differ or accents occur
      const lower = row.text.toLowerCase()
      const src = lower.length === row.text.length ? lower : row.text
      forEachToken(src, (s, e) => {
        let term = src.slice(s, e)
        if (src !== lower || HAS_HIGH.test(term)) term = fold(term)
        let id = this.ids.get(term)
        if (id === undefined) { id = this.names.length; this.ids.set(term, id); this.names.push(term) }
        if (this.count === this.raw.length) { const grown = new Uint32Array(this.raw.length * 2); grown.set(this.raw); this.raw = grown }
        this.raw[this.count++] = id
      })
    }
  }

  finish(): SearchIndex {
    const n = this.rows.length, nt = this.names.length
    // Uint16 storage: a larger vocabulary or verse count needs wider arrays
    if (nt > 0xffff || n > 0xffff) throw new Error(`search index: ${nt} terms, ${n} verses exceed 16-bit ids`)
    const order = this.names.map((_, i) => i).sort((a, b) => (this.names[a] < this.names[b] ? -1 : this.names[a] > this.names[b] ? 1 : 0))
    const remap = new Uint32Array(nt)
    order.forEach((old, id) => { remap[old] = id })
    const terms = order.map(i => this.names[i])
    const toks = new Uint16Array(this.count)
    for (let i = 0; i < this.count; i++) toks[i] = remap[this.raw[i]]
    const tokStart = new Uint32Array(n + 1)
    this.starts.forEach((s, r) => { tokStart[r] = s })
    tokStart[n] = this.count
    this.raw = new Uint32Array(0); this.ids.clear()
    return { rows: this.rows, terms, tokStart, toks, ...postings(toks, tokStart, nt) }
  }
}
const HAS_HIGH = /[^\x00-\x7f]/

export function buildIndex(rows: readonly VerseRow[]): SearchIndex {
  const b = new IndexBuilder()
  b.add(rows)
  return b.finish()
}

function postings(toks: Uint16Array, tokStart: Uint32Array, nt: number) {
  const n = tokStart.length - 1
  const last = new Int32Array(nt).fill(-1)
  const postStart = new Uint32Array(nt + 1)
  for (let r = 0; r < n; r++) for (let i = tokStart[r]; i < tokStart[r + 1]; i++) { const t = toks[i]; if (last[t] !== r) { last[t] = r; postStart[t + 1]++ } }
  for (let t = 0; t < nt; t++) postStart[t + 1] += postStart[t]
  const post = new Uint16Array(postStart[nt])
  const postTf = new Uint8Array(postStart[nt])
  const at = postStart.slice(0, nt)
  last.fill(-1)
  for (let r = 0; r < n; r++) {
    for (let i = tokStart[r]; i < tokStart[r + 1]; i++) {
      const t = toks[i]
      if (last[t] !== r) { last[t] = r; post[at[t]] = r; postTf[at[t]++] = 1 }
      else if (postTf[at[t] - 1] < 0xff) postTf[at[t] - 1]++
    }
  }
  return { postStart, post, postTf }
}

// ---------- persistence: the arrays as one buffer; rows come from the caller ----------

const MAGIC = 0x42534958 // "BSIX"
const FORMAT = 2
const HEAD = 8 * 4
const pad4 = (bytes: number) => (bytes + 3) & ~3

/** Section byte lengths in file order: term characters, postStart, post, postTf, tokStart, toks. */
const layout = (n: number, nt: number, nChars: number, nPost: number, nToks: number) =>
  [nChars * 2, (nt + 1) * 4, nPost * 2, nPost, (n + 1) * 4, nToks * 2].map(pad4)

export function serializeIndex(ix: SearchIndex): Uint8Array {
  const termChars = ix.terms.join('\n')
  const n = ix.rows.length, nt = ix.terms.length, nPost = ix.post.length, nToks = ix.toks.length
  const sizes = layout(n, nt, termChars.length, nPost, nToks)
  const buf = new ArrayBuffer(HEAD + sizes.reduce((a, b) => a + b, 0))
  new Uint32Array(buf, 0, 8).set([MAGIC, FORMAT, n, nt, termChars.length, nPost, nToks, 0])
  let off = HEAD
  const chars = new Uint16Array(buf, off, termChars.length)
  for (let i = 0; i < termChars.length; i++) chars[i] = termChars.charCodeAt(i)
  off += sizes[0]
  new Uint32Array(buf, off, nt + 1).set(ix.postStart); off += sizes[1]
  new Uint16Array(buf, off, nPost).set(ix.post); off += sizes[2]
  new Uint8Array(buf, off, nPost).set(ix.postTf); off += sizes[3]
  new Uint32Array(buf, off, n + 1).set(ix.tokStart); off += sizes[4]
  new Uint16Array(buf, off, nToks).set(ix.toks)
  return new Uint8Array(buf)
}

/** null when the bytes are not an index of these rows (another format, another text, or truncated). */
export function restoreIndex(rows: VerseRow[], bytes: Uint8Array): SearchIndex | null {
  if (bytes.byteLength < HEAD) return null
  // typed views need 4-byte alignment
  const own = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice()
  const buf = own.buffer, base = own.byteOffset
  const [magic, format, n, nt, nChars, nPost, nToks] = new Uint32Array(buf, base, 8)
  if (magic !== MAGIC || format !== FORMAT || n !== rows.length) return null
  const sizes = layout(n, nt, nChars, nPost, nToks)
  if (HEAD + sizes.reduce((a, b) => a + b, 0) > own.byteLength) return null
  let off = base + HEAD
  const chars = new Uint16Array(buf, off, nChars); off += sizes[0]
  let s = ''
  for (let i = 0; i < nChars; i += 8192) s += String.fromCharCode(...Array.from(chars.subarray(i, i + 8192)))
  const terms = nChars ? s.split('\n') : []
  if (terms.length !== nt) return null
  const postStart = new Uint32Array(buf, off, nt + 1); off += sizes[1]
  const post = new Uint16Array(buf, off, nPost); off += sizes[2]
  const postTf = new Uint8Array(buf, off, nPost); off += sizes[3]
  const tokStart = new Uint32Array(buf, off, n + 1); off += sizes[4]
  const toks = new Uint16Array(buf, off, nToks)
  if (tokStart[n] !== nToks || postStart[nt] !== nPost) return null
  return { rows, terms, postStart, post, postTf, tokStart, toks }
}

// ---------- matching ----------

function lowerBound(a: string[], s: string): number {
  let lo = 0, hi = a.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < s) lo = mid + 1; else hi = mid }
  return lo
}
/** Term-id range [lo, hi) for a term, or every term it begins. */
function termRange(ix: SearchIndex, term: string, prefix: boolean): [number, number] {
  const lo = lowerBound(ix.terms, term)
  if (!prefix) return ix.terms[lo] === term ? [lo, lo + 1] : [lo, lo]
  return [lo, lowerBound(ix.terms, term + '￿')]
}

type Ranges = [number, number][]
const phraseRanges = (ix: SearchIndex, p: Phrase): Ranges => p.terms.map((t, i) => termRange(ix, t, p.prefix && i === p.terms.length - 1))

/** Start positions of the phrase within row r (overlapping instances count, as in FTS5). */
function instancesIn(ix: SearchIndex, r: number, rg: Ranges, out?: number[]): number {
  const toks = ix.toks, L = rg.length
  let tf = 0
  for (let i = ix.tokStart[r], end = ix.tokStart[r + 1] - L; i <= end; i++) {
    let k = 0
    for (; k < L; k++) { const t = toks[i + k]; if (t < rg[k][0] || t >= rg[k][1]) break }
    if (k === L) { tf++; out?.push(i - ix.tokStart[r]) }
  }
  return tf
}

/** A phrase over the whole text: tf per row (0 = no match), the matching rows ascending, and their count. */
interface PhraseMatch { tf: Uint16Array; list: ArrayLike<number>; rows: number }

function nonZero(tf: Uint16Array): number[] {
  const out: number[] = []
  for (let r = 0; r < tf.length; r++) if (tf[r]) out.push(r)
  return out
}

function matchPhrase(ix: SearchIndex, rg: Ranges): PhraseMatch {
  const n = ix.rows.length
  const tf = new Uint16Array(n)
  if (!rg.length || rg.some(([lo, hi]) => lo >= hi)) return { tf, list: [], rows: 0 }
  const { postStart, post, postTf } = ix
  if (rg.length === 1) {
    const [lo, hi] = rg[0]
    for (let j = postStart[lo]; j < postStart[hi]; j++) tf[post[j]] += postTf[j]
    const list = hi - lo === 1 ? post.subarray(postStart[lo], postStart[hi]) : nonZero(tf)
    return { tf, list, rows: list.length }
  }
  // candidates: the rows holding the rarest term of the phrase
  let best = 0, bestCount = Infinity
  rg.forEach(([lo, hi], k) => { const c = postStart[hi] - postStart[lo]; if (c < bestCount) { bestCount = c; best = k } })
  const [lo, hi] = rg[best]
  const mark = new Uint8Array(n)
  for (let j = postStart[lo]; j < postStart[hi]; j++) mark[post[j]] = 1
  const list: number[] = []
  for (let r = 0; r < n; r++) {
    if (!mark[r]) continue
    const c = instancesIn(ix, r, rg)
    if (c) { tf[r] = c; list.push(r) }
  }
  return { tf, list, rows: list.length }
}

const K1 = 1.2, B = 0.75
/** FTS5 bm25(): per phrase idf from the rows it matches in the whole table, length-normalised tf. */
function bm25(nRows: number, avgdl: number, phrases: PhraseMatch[], r: number, dl: number): number {
  let score = 0
  for (const p of phrases) {
    let idf = Math.log((nRows - p.rows + 0.5) / (p.rows + 0.5))
    if (idf <= 0) idf = 1e-6
    const f = p.tf[r]
    score += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * dl / avgdl))
  }
  return -score
}

function inScope(book: number, scope: string): boolean {
  if (scope === 'OT') return book <= 39
  if (scope === 'NT') return book >= 40
  const n = Number(scope)
  return Number.isInteger(n) && n >= 1 && n <= 66 ? book === n : true
}

/** The best `k` rows by rank, fed in ascending row order so equal ranks keep canonical order (the server's rowid order). */
class Top {
  rows: number[] = []
  ranks: number[] = []
  total = 0
  /** Matches in the `first` group (the word itself, searchIndex): how many, when the search has such a group. */
  exact = 0
  /** `bible`: every match is kept as it comes and `settle` puts them in canonical order; else the best `k` by rank.
   *  `first` marks the rows that lead a Bible-order list, in canonical order among themselves. */
  constructor(private k: number, private bible = false, private first: Uint8Array | null = null) {}
  add(r: number, rank: number) {
    this.total++
    if (this.first?.[r]) this.exact++
    if (this.bible) { this.rows.push(r); this.ranks.push(rank); return }
    const len = this.rows.length
    if (len === this.k && !(rank < this.ranks[len - 1])) return
    let lo = 0, hi = len
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.ranks[mid] <= rank) lo = mid + 1; else hi = mid }
    this.rows.splice(lo, 0, r); this.ranks.splice(lo, 0, rank)
    if (this.rows.length > this.k) { this.rows.pop(); this.ranks.pop() }
  }
  /** Bible order: the first `k` matches by book, chapter and verse (ORDER BY v.book, v.chapter, v.verse). */
  settle(verses: VerseRow[]): this {
    if (!this.bible) return this
    const first = this.first
    const at = this.rows.map((_, i) => i).sort((a, b) => {
      const x = verses[this.rows[a]], y = verses[this.rows[b]]
      return (first ? first[this.rows[b]] - first[this.rows[a]] : 0) || x.book - y.book || x.chapter - y.chapter || x.verse - y.verse
    }).slice(0, this.k)
    const rows = at.map(i => this.rows[i]), ranks = at.map(i => this.ranks[i])
    this.rows = rows; this.ranks = ranks
    return this
  }
}

// ---------- snippets ----------

const SNIPPET_TOKENS = 24
const ELLIPSIS = '…'

/**
 * FTS5 snippet(t, 0, '<mark>', '</mark>', '…', 24): the 24-token window holding the most distinct phrases,
 * centred on its hits or started at a sentence, matches marked, no escaping (verse text holds no markup).
 */
export function ftsSnippet(ix: SearchIndex, r: number, ranges: Ranges[]): string {
  const text = ix.rows[r].text
  const starts: number[] = [], ends: number[] = []
  forEachToken(text, (s, e) => { starts.push(s); ends.push(e) })
  const nDoc = starts.length
  // instances sorted by position, lower phrase first on a tie
  const inst: { p: number; pos: number; size: number }[] = []
  ranges.forEach((rg, p) => { const at: number[] = []; instancesIn(ix, r, rg, at); for (const pos of at) inst.push({ p, pos, size: rg.length }) })
  inst.sort((a, b) => a.pos - b.pos || a.p - b.p)

  // sentence starts: token 0, and a token after whitespace that follows '.' or ':'
  const sentence: number[] = []
  for (let t = 0; t < nDoc; t++) {
    if (t === 0) { sentence.push(0); continue }
    let i = starts[t] - 1
    for (; i >= 0; i--) { const c = text[i]; if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') break }
    if (i !== starts[t] - 1 && i >= 0 && (text[i] === '.' || text[i] === ':')) sentence.push(t)
  }

  const score = (from: number): { score: number; adj: number } => {
    const seen = new Set<number>()
    let sc = 0, first = -1, lastEnd = 0
    for (const x of inst) {
      if (x.pos < from || x.pos >= from + SNIPPET_TOKENS) continue
      sc += seen.has(x.p) ? 1 : 1000
      seen.add(x.p)
      if (first < 0) first = x.pos
      lastEnd = x.pos + x.size
    }
    let adj = first - Math.trunc((SNIPPET_TOKENS - (lastEnd - first)) / 2)
    if (adj + SNIPPET_TOKENS > nDoc) adj = nDoc - SNIPPET_TOKENS
    if (adj < 0) adj = 0
    return { score: sc, adj }
  }
  let bestScore = 0, bestStart = 0
  for (const x of inst) {
    const s = score(x.pos)
    if (s.score > bestScore) { bestScore = s.score; bestStart = s.adj }
    if (sentence.length && nDoc > SNIPPET_TOKENS) {
      let j = 0
      for (; j < sentence.length - 1; j++) if (sentence[j + 1] > x.pos) break
      if (sentence[j] < x.pos) {
        const t = score(sentence[j]).score + (sentence[j] === 0 ? 120 : 100)
        if (t > bestScore) { bestScore = t; bestStart = sentence[j] }
      }
    }
  }

  // overlapping instances coalesce into one mark
  const marks: { s: number; e: number }[] = []
  for (const x of inst) {
    const e = x.pos + x.size - 1
    const m = marks[marks.length - 1]
    if (m && x.pos <= m.e) m.e = Math.max(m.e, e)
    else marks.push({ s: x.pos, e })
  }
  const rangeStart = bestStart, rangeEnd = bestStart + SNIPPET_TOKENS - 1
  let out = rangeStart > 0 ? ELLIPSIS : ''
  let off = 0, it = 0
  while (it < marks.length && marks[it].s < rangeStart) it++
  for (let pos = rangeStart; pos < nDoc && pos <= rangeEnd; pos++) {
    if (rangeStart && pos === rangeStart) off = starts[pos]
    const m = marks[it]
    if (m && pos === m.s) { out += text.slice(off, starts[pos]) + '<mark>'; off = starts[pos] }
    if (m && pos === m.e) { out += text.slice(off, ends[pos]) + '</mark>'; off = ends[pos]; it++ }
    if (pos === rangeEnd) {
      out += text.slice(off, ends[pos]); off = ends[pos]
      const open = marks[it]
      if (open && pos >= open.s && pos < open.e) out += '</mark>'
    }
  }
  return out + (rangeEnd >= nDoc - 1 ? text.slice(off) : ELLIPSIS)
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** window_snippet(): 70 bytes of UTF-8 either side of the first case-insensitive occurrence, widened to whole characters. */
export function windowSnippet(text: string, q: string): string {
  const needle = q.replace(/"/g, '').trim()
  const i = text.toLowerCase().indexOf(needle.toLowerCase())
  if (i < 0) return [...text].length > 160 ? [...text].slice(0, 160).join('') + ELLIPSIS : text
  const end = i + needle.length
  const at = [0]
  for (let k = 0; k < text.length; k++) { const c = text.charCodeAt(k); at.push(at[k] + (c < 0x80 ? 1 : c < 0x800 || (c >= 0xd800 && c < 0xe000) ? 2 : 3)) }
  let a = i
  while (a > 0 && at[a] > Math.max(0, at[i] - 70)) a--
  let b = end
  while (b < text.length && at[b] < at[end] + 70) b++
  return (a > 0 ? ELLIPSIS : '') + escHtml(text.slice(a, i)) + '<mark>' + escHtml(text.slice(i, end)) + '</mark>' + escHtml(text.slice(end, b)) + (b < text.length ? ELLIPSIS : '')
}

// ---------- search ----------

export interface SearchOpts { limit?: number; offset?: number; scope?: string; /** as the API's `order`; left out, `defaultOrder` picks */ order?: SearchOrder }

/**
 * The order of text hits when the reader has not chosen one (default_order in rs/src/search.rs): one word or one
 * quoted phrase is a concordance lookup and reads in Bible order; several terms are a hunt for the verse that has
 * them all, best match first.
 */
export function defaultOrder(q: string): SearchOrder {
  return (parseQuery(q.trim(), true)?.length ?? 0) <= 1 ? 'bible' : 'match'
}

/** The endings that are still the word looked up: "ant" leads with "ant" and "ants", not "anticipate" (whole_forms in rs/src/search.rs). */
const WHOLE_ENDINGS = ['', 's', 'es']
/**
 * One bare word read as a concordance lookup also matches every longer word it begins, and in Bible order those
 * crowd out the word itself ("ant": Psalms' "anticipate" before Proverbs' "ants"). The rows holding the word itself
 * or its plural lead; null when the query is not one bare word or the text never has the word itself.
 */
function wholeWordRows(ix: SearchIndex, phrases: Phrase[]): Uint8Array | null {
  if (phrases.length !== 1 || !phrases[0].prefix || phrases[0].terms.length !== 1) return null
  const first = new Uint8Array(ix.rows.length)
  let any = false
  for (const end of WHOLE_ENDINGS) {
    const [lo, hi] = termRange(ix, phrases[0].terms[0] + end, false)
    for (let j = ix.postStart[lo]; j < ix.postStart[hi]; j++) { first[ix.post[j]] = 1; any = true }
  }
  return any ? first : null
}

function ftsSearch(ix: SearchIndex, phrases: Phrase[], scope: string, k: number, bible: boolean): { top: Top; ranges: Ranges[] } {
  const n = ix.rows.length
  const ranges = phrases.map(p => phraseRanges(ix, p))
  const matched = ranges.map(rg => matchPhrase(ix, rg))
  const rarest = matched.reduce((a, b) => (b.rows < a.rows ? b : a))
  const avgdl = ix.tokStart[n] / n
  const top = new Top(k, bible, bible ? wholeWordRows(ix, phrases) : null)
  for (let i = 0; i < rarest.list.length; i++) {
    const r = rarest.list[i]
    if (!inScope(ix.rows[r].book, scope) || !matched.every(m => m.tf[r])) continue
    top.add(r, bm25(n, avgdl, matched, r, ix.tokStart[r + 1] - ix.tokStart[r]))
  }
  return { top: top.settle(ix.rows), ranges }
}

/** Characters as SQLite counts them (code points). */
const codePoints = (s: string) => s.length - (s.match(/[\udc00-\udfff]/g)?.length ?? 0)
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** FTS5 trigram "phrase": a case-insensitive substring; tf counts overlapping occurrences, dl is characters - 2. */
function substringSearch(ix: SearchIndex, plain: string, scope: string, k: number, bible: boolean): Top {
  const n = ix.rows.length
  if (ix.gramsAvg === undefined) {
    let grams = 0
    for (const row of ix.rows) grams += Math.max(0, codePoints(row.text) - 2)
    ix.gramsAvg = grams / n
  }
  const re = new RegExp(escRe(plain), 'gi')
  const tf = new Uint16Array(n)
  let rows = 0
  for (let r = 0; r < n; r++) {
    const text = ix.rows[r].text
    re.lastIndex = 0
    let c = 0
    for (let m = re.exec(text); m; m = re.exec(text)) { c++; re.lastIndex = m.index + 1 }
    if (c) { tf[r] = Math.min(c, 0xffff); rows++ }
  }
  const m: PhraseMatch[] = [{ tf, list: [], rows }]
  const top = new Top(k, bible)
  for (let r = 0; r < n; r++) if (tf[r] && inScope(ix.rows[r].book, scope)) top.add(r, bm25(n, ix.gramsAvg, m, r, Math.max(0, codePoints(ix.rows[r].text) - 2)))
  return top.settle(ix.rows)
}

/** The server's search() over the index: same kinds, hits, totals and order. */
export function searchIndex(ix: SearchIndex, rawQuery: string, opts: SearchOpts = {}): SearchResponse {
  const t0 = Date.now()
  const q = rawQuery.trim()
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50))
  const offset = Math.max(0, opts.offset ?? 0)
  const scope = opts.scope ?? 'all'
  const done = (r: Omit<SearchResponse, 'query' | 'took_ms'>): SearchResponse => ({ ...r, query: q, took_ms: Date.now() - t0 })
  if (!q) return done({ kind: 'text', hits: [], total: 0 })

  const cite = (ref: Ref): SearchResponse => {
    const v1 = ref.v1 ?? 1, v2 = ref.v2 ?? ref.v1 ?? 999
    const hits = ix.rows.filter(v => v.book === ref.book && v.chapter === ref.chapter && v.verse >= v1 && v.verse <= v2)
      .map(v => ({ book: v.book, chapter: v.chapter, verse: v.verse, text: v.text, snippet: v.text, rank: 0 }))
    return done({ kind: 'ref', ref, hits, total: hits.length })
  }
  // A reference with a chapter or verse is a citation. A book's name alone ("song", "mark") is a word first: its hits
  // come back with `book` so the screen can offer the book, and only a name the text never uses ("jn", "song of
  // solomon") is a citation of chapter 1. A name of several words is searched as a phrase. (search() in rs/src/search.rs)
  let book: Ref | undefined
  let words = q
  if (looksLikeRef(q)) {
    const ref = parseRef(q)
    if (ref) {
      if (!bareBook(q)) return cite(ref)
      book = ref
      const parts = q.split(/\s+/)
      if (parts.length > 1) words = `"${parts.join(' ')}"`
    }
  }

  // a two-letter alias that is also a word ("he", "is", "am") is just the word: no Hebrews row over its verses
  const offer = book && (q.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3 ? book : undefined
  const page = (top: Top, snippet: (r: number) => string): SearchHit[] => top.rows.slice(offset).map((r, i) => {
    const v = ix.rows[r]
    return { book: v.book, chapter: v.chapter, verse: v.verse, text: v.text, snippet: snippet(r), rank: top.ranks[offset + i] }
  })
  // the server retries without prefixes when the prefix query finds nothing; exact matches are a subset of
  // prefix matches, so that retry never finds more and is skipped here
  const order = opts.order ?? defaultOrder(words)
  const bible = order === 'bible'
  const phrases = parseQuery(words, true)
  if (phrases) {
    const { top, ranges } = ftsSearch(ix, phrases, scope, offset + limit, bible)
    // `exact`: how many of the hits lead as the word itself, when some but not all do
    const exact = top.exact > 0 && top.exact < top.total ? { exact: top.exact } : {}
    if (top.total) return done({ kind: 'text', hits: page(top, r => ftsSnippet(ix, r, ranges)), total: top.total, order, ...exact, ...(offer ? { book: offer } : {}) })
  }
  const plain = words.replace(/"/g, '').split(/\s+/).filter(Boolean).join(' ')
  if ([...plain].length >= 3) {
    const top = substringSearch(ix, plain, scope, offset + limit, bible)
    if (top.total || !book) return done({ kind: 'text', hits: page(top, r => windowSnippet(ix.rows[r].text, plain)), total: top.total, order, ...(offer ? { book: offer } : {}) })
  }
  return book ? cite(book) : done({ kind: 'text', hits: [], total: 0, order })
}
