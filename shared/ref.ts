import { BOOKS, findBook, findBookFuzzy, type BookMeta } from './books.js'

/** A verse range within a single chapter (chapter-only when v1 is undefined). */
export interface Ref { book: number; chapter: number; v1?: number; v2?: number }

const REF_RE = /^\s*((?:[1-3]|i{1,3}|first|second|third)?\s*[a-z][a-z .]*?)\s*(\d+)?(?:\s*[:.v]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?\s*$/i

/** Parse "jn 3:16", "jn 3v16", "1 cor 13", "ps 23:1-4", "gen" -> Ref | null. `fuzzy` also accepts a misspelt book ("Jhon 3:16"). */
export function parseRef(input: string, opts: { fuzzy?: boolean } = {}): Ref | null {
  const m = REF_RE.exec(input)
  if (!m) return null
  const book = opts.fuzzy ? findBookFuzzy(m[1]) : findBook(m[1])
  if (!book) return null
  // "1 john" without a chapter but the leading digit already consumed: fine
  let chapter = m[2] ? parseInt(m[2], 10) : 1
  // "jude 3", "phlm 10": single-chapter books take the number as a verse
  if (book.chapters === 1 && m[2] && !m[3]) {
    const ref: Ref = { book: book.n, chapter: 1, v1: chapter }
    return ref
  }
  if (chapter < 1 || chapter > book.chapters) return null
  const ref: Ref = { book: book.n, chapter }
  if (m[3]) {
    ref.v1 = parseInt(m[3], 10)
    if (m[4]) ref.v2 = parseInt(m[4], 10)
    if (ref.v2 !== undefined && ref.v2 < ref.v1) return null
  }
  return ref
}

/**
 * A book's name or alias and nothing after it ("song", "1 kings", "sos"): no chapter, no verse. Search reads such a
 * query as a word first and offers the book beside the hits (bare_book in rs/src/refparse.rs).
 */
export function bareBook(input: string): BookMeta | undefined {
  const m = REF_RE.exec(input)
  return m && !m[2] && !m[3] ? findBook(m[1]) : undefined
}

/** Does the input look like it is trying to be a reference at all (vs. free text)? */
export function looksLikeRef(input: string): boolean {
  return /^\s*(?:[1-3]\s*)?[a-z]{2,}[a-z .]*\s*\d/i.test(input) || (!!findBook(input.trim()) && input.trim().length >= 2)
}

export function formatRef(r: Ref, style: 'full' | 'abbr' = 'full'): string {
  const b = BOOKS[r.book - 1]
  const name = style === 'abbr' ? b.abbr : b.name
  const single = b.chapters === 1
  let s = single && r.v1 !== undefined ? `${name}` : `${name} ${r.chapter}`
  if (r.v1 !== undefined) s += single ? ` ${r.v1}` : `:${r.v1}`
  if (r.v2 !== undefined && r.v2 !== r.v1) s += `-${r.v2}`
  return s
}

/**
 * Several verses of one chapter, every consecutive run compressed: [1, 2, 4, 5] -> "Genesis 1:1-2, 4-5".
 * Order and duplicates in `verses` do not matter; an empty list names the chapter.
 */
export function formatVerseRuns(book: number, chapter: number, verses: readonly number[], style: 'full' | 'abbr' = 'full'): string {
  const vs = [...new Set(verses)].sort((a, b) => a - b)
  const runs: [number, number][] = []
  for (const v of vs) {
    const last = runs[runs.length - 1]
    if (last && v === last[1] + 1) last[1] = v
    else runs.push([v, v])
  }
  if (!runs.length) return formatRef({ book, chapter }, style)
  const head = formatRef({ book, chapter, v1: runs[0][0], v2: runs[0][1] }, style)
  return [head, ...runs.slice(1).map(([a, b]) => a === b ? `${a}` : `${a}-${b}`)].join(', ')
}

export const refKey = (r: Ref) => `${r.book}.${r.chapter}${r.v1 !== undefined ? '.' + r.v1 : ''}${r.v2 !== undefined ? '-' + r.v2 : ''}`
export const refPath = (r: Ref) => `/read/${r.book}/${r.chapter}${r.v1 !== undefined ? '#v' + r.v1 : ''}`

export interface RefContext { book: number; chapter: number }
export interface RefSpan { start: number; end: number; ref: Ref }

/**
 * Find scripture references inside free text. Handles the forms Darby's notes use as well as plain prose:
 *   "John 3:16", "1 John 4:9-10", "Gen 9:26 and 24.7" (the second keeps the book), "chs. 6:12; 7.8; 8.14",
 *   "Ex 3:14,15" (each verse its own link), and with `ctx` (the chapter the text sits in) "ch. 5:25",
 *   "ver. 15", "vers. 13,14,25". Every span is a tappable range; lists yield one span per item.
 */
export function scanRefs(text: string, ctx?: RefContext): RefSpan[] {
  const out: RefSpan[] = []
  // one pass, left to right; the book (and chapter) of the last hit carry into bare continuations
  const re = /((?:[1-3]\s?)?[A-Z][a-z]+\.?(?:\s(?:of\s)?[A-Z][a-z]+)?)\s?(\d{1,3})(?:\s?[:.]\s?(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?)?|\b(chs?|vers?s?|vv?)\.?\s?(\d{1,3})(?:\s?[:.]\s?(\d{1,3}))?(?:\s?[-–]\s?(\d{1,3}))?|(\d{1,3})\s?[:.]\s?(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?|(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?/g
  let m: RegExpExecArray | null
  let cur: { book: BookMeta; chapter: number } | null = null
  let lastEnd = -1
  const push = (start: number, end: number, ref: Ref) => { out.push({ start, end, ref }); lastEnd = end }
  const gapOk = (from: number, to: number, list: boolean) => {
    if (from < 0 || to < from) return false
    const gap = text.slice(from, to)
    // "9:26 and 24.7", "6:12; 7.8", "3:14,15": a short run of separators, nothing else
    return list ? /^,\s?$/.test(gap) : /^(?:[;,]\s?|\s(?:and|&)\s|\s)$/.test(gap) && gap.length <= 6
  }
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) {
      // "Book c[:v[-v]]", possibly preceded by a stray capitalised word ("Compare John 3:16")
      let name = m[1], start = m.index
      let book = findBook(name)
      if (!book && /\s/.test(name)) { const last = name.split(/\s+/).pop()!; book = findBook(last); if (book) start = m.index + m[0].indexOf(last) }
      if (!book) { cur = null; continue }
      const chapter = parseInt(m[2], 10)
      if (chapter < 1 || chapter > book.chapters) { cur = null; continue }
      const ref: Ref = { book: book.n, chapter }
      if (m[3]) { ref.v1 = parseInt(m[3], 10); if (m[4]) ref.v2 = parseInt(m[4], 10) }
      cur = { book, chapter }
      push(start, m.index + m[0].length, ref)
    } else if (m[5] !== undefined) {
      // "ch. 5:25" / "chs. 6:12" / "ver. 15" / "vers. 13" relative to the chapter the text lives in
      if (!ctx) { continue }
      const book = BOOKS[ctx.book - 1]
      const kind = m[5].startsWith('c') ? 'ch' : 'v'
      const a = parseInt(m[6], 10), b = m[7] ? parseInt(m[7], 10) : undefined, c = m[8] ? parseInt(m[8], 10) : undefined
      let ref: Ref
      if (kind === 'ch') { if (a < 1 || a > book.chapters) continue; ref = { book: ctx.book, chapter: a }; if (b !== undefined) { ref.v1 = b; if (c !== undefined) ref.v2 = c } }
      else { ref = { book: ctx.book, chapter: ctx.chapter, v1: a }; if (c !== undefined) ref.v2 = c; else if (b !== undefined) ref.v2 = b }
      cur = { book, chapter: ref.chapter }
      push(m.index, m.index + m[0].length, ref)
    } else if (m[9] !== undefined) {
      // bare "c.v" continuing the previous book: "Gen 9:26 and 24.7", "chs. 6:12; 7.8"
      if (!cur || !gapOk(lastEnd, m.index, false)) continue
      const chapter = parseInt(m[9], 10)
      if (chapter < 1 || chapter > cur.book.chapters) continue
      const ref: Ref = { book: cur.book.n, chapter, v1: parseInt(m[10], 10) }
      if (m[11]) ref.v2 = parseInt(m[11], 10)
      cur = { book: cur.book, chapter }
      push(m.index, m.index + m[0].length, ref)
    } else if (m[12] !== undefined) {
      // bare verse continuing a verse list: "3:14,15", "vers. 13,14,25"
      if (!cur || !gapOk(lastEnd, m.index, true)) continue
      const prev = out[out.length - 1]
      if (!prev || prev.ref.v1 === undefined) continue
      const ref: Ref = { book: cur.book.n, chapter: cur.chapter, v1: parseInt(m[12], 10) }
      if (m[13]) ref.v2 = parseInt(m[13], 10)
      push(m.index, m.index + m[0].length, ref)
    }
  }
  return out
}

export type { BookMeta }

const ROMAN = /^(c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/
const ROMAN_VALUE: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 }
/** "xix" -> 19, "XV" -> 15 (up to 399); undefined for a word that is not a well-formed numeral ("ill", "civil"). */
export function romanToInt(s: string): number | undefined {
  const t = s.toLowerCase()
  if (!t || !ROMAN.test(t)) return undefined
  let n = 0
  for (let i = 0; i < t.length; i++) {
    const a = ROMAN_VALUE[t[i]], b = ROMAN_VALUE[t[i + 1]] ?? 0
    n += a < b ? -a : a
  }
  return n
}

// a verse number; the scanned prefaces also print a capital I for the figure 1 ("xv. I2", "ix. 3I")
const PN = String.raw`(?:\d[\dI]{0,2}|I\d{1,2})(?![\dA-Za-z])`
const PRANGE = String.raw`\s?(?:--|[-–—])\s?`
const PREFACE_RE = new RegExp([
  // Book chapter[.verse[-verse]]: "John xix. 34", "Rev. xxii. 14", "I Cor. xv. 49", "Romans XV. I2", "Psalm 147.1", "Gen. 5. 3 -- 29", "John viii"
  String.raw`\b((?:(?:[1-3]|I{1,3})\s?)?[A-Z][a-z]+\.?(?:\s(?:of\s)?[A-Z][a-z]+\.?)?)(?:\s?(\d{1,3})(?![\dA-Za-z])|\s([ivxlc]+)\b|\s([IVXLC]+)(?=\.))(?:\s?[:.]\s?(${PN})(?:${PRANGE}(${PN}))?)?`,
  // "ch. 3. 30", "verse 21": relative to the reference just before ("v. 33" is a roman chapter in these lists); with a
  // home book also "chapter 9", "chap. 3:2", "verses 13–14", "vv. 4–6"
  String.raw`\b(chapters?|chaps?\.|chs?\.|[Vv]erses|[Vv]er(?:se|s)?\b\.?|vv\.)\s?(\d{1,3})(?![\dA-Za-z])(?:\s?[:.]\s?(${PN}))?(?:${PRANGE}(${PN}))?`,
  // bare "ii. 13" continuing the book: "Matt. i. 20, 22; ii. 13"
  String.raw`\b([ivxlc]+|[IVXLC]+)\.\s?(${PN})(?:${PRANGE}(${PN}))?`,
  // bare "7. 11" continuing the book: "Gen. 5. 3 -- 29; 7. 11"
  String.raw`\b(\d{1,3})\s?[:.]\s?(${PN})(?:${PRANGE}(${PN}))?`,
  // bare verse continuing a verse list: "20, 22, 24"
  String.raw`\b(${PN})(?:${PRANGE}(${PN}))?`,
].join('|'), 'g')
// what may stand between two items of one list: "(?)", "(peculiar character)", an italic "bis", then the separator
const QUALIFIER = String.raw`(?:\s*\([^()]{1,24}\))?(?:\s*bis)?`
const CHAPTER_GAP = new RegExp(String.raw`^${QUALIFIER}\s*(?:[;,]|\s(?:and|&))\s*$`)
const VERSE_GAP = new RegExp(String.raw`^${QUALIFIER}\s*,\s*$`)
// "ch." and "verse" only count this close to the reference they lean on
const RELATIVE_REACH = 200
// with a home book, only this close: further off, "chapter 9" is the home book's
const HOME_REACH = 60
/** The keywords only a home book gives a meaning to (the notices never use them for a reference). */
const HOME_ONLY = /^(?:chapters?|chaps?\.|verses|vv\.)$/i

/** The book a text is about, and its chapter when it is about one: where "chapter 9" and "verse 4" point. */
export interface RefHome { book: number; chapter?: number }

/**
 * References as the 1871-1961 prefaces print them, for the About screen: roman chapters ("John xix. 34", "1 John ii. 13",
 * "I Cor. xv. 49", "Mark xvi."), arabic with a dot ("Psalm 147.1", "Exod. 3.14", "Gen. 5. 3 -- 29"), and the lists of the
 * Kurios table ("Matt. i. 20, 22, 24; ii. 13, 15 (?); iii. 3", "xii. 11, 29 bis, 30"), where a bare chapter after a
 * semicolon and a bare verse after a comma keep the book. "ch. 3. 30" and "verse 21" resolve against the reference just
 * before. A capitalised word must be a real book with a chapter it has: "Depot i", "Greek l", "Nehemiah 80" stay text.
 *
 * With a `home` (a commentary on a book: Darby's Synopsis, Coates's Outlines), "chapter 9", "ch. 9", "chap. 3:2" and
 * "Chapter 9" are that book's unless a reference stands just before (within HOME_REACH), and "verse 4", "verses 13–14",
 * "vv. 4–6" the home chapter, or, when the text is on several chapters, the one last named.
 */
export function scanPrefaceRefs(text: string, home?: RefHome): RefSpan[] {
  const out: RefSpan[] = []
  // the book and chapter the next bare continuation belongs to, and where the last reference ended
  const at: { cur: { book: BookMeta; chapter: number } | null; end: number } = { cur: null, end: -1 }
  const num = (s: string) => parseInt(s.replace(/I/g, '1'), 10)
  const push = (start: number, end: number, book: BookMeta, chapter: number, v1?: string, v2?: string) => {
    const ref: Ref = { book: book.n, chapter }
    if (v1 !== undefined) {
      ref.v1 = num(v1)
      if (v2 !== undefined && num(v2) > ref.v1) ref.v2 = num(v2)
    }
    out.push({ start, end, ref })
    at.cur = { book, chapter }
    at.end = end
  }
  const gap = (re: RegExp, to: number) => at.end >= 0 && re.test(text.slice(at.end, to))
  const homeBook = home ? BOOKS[home.book - 1] : undefined
  /** "chapter 9" / "verse 4" at [start, end): against the reference just before, or with a home book against it. */
  const relative = (word: string, start: number, end: number, n: string, v?: string, v2?: string) => {
    const cur = at.cur
    const near = cur && start - at.end <= (homeBook ? HOME_REACH : RELATIVE_REACH) ? cur : null
    if (!homeBook && (!near || HOME_ONLY.test(word))) return
    if (/^ch/i.test(word)) {
      const book = near ? near.book : homeBook!
      const chapter = parseInt(n, 10)
      if (chapter >= 1 && chapter <= book.chapters) push(start, end, book, chapter, v, v2)
      return
    }
    if (v !== undefined) return
    const base = near ?? (home?.chapter ? { book: homeBook!, chapter: home.chapter } : cur && cur.book === homeBook ? cur : null)
    if (base) push(start, end, base.book, base.chapter, n, v2)
  }
  const re = new RegExp(PREFACE_RE)
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length
    const cur = at.cur
    if (m[1] !== undefined) {
      let start = m.index
      let book = findBook(m[1])
      // "In Luke vi. 1": a capitalised word in front of the book
      if (!book && /\s/.test(m[1])) {
        const last = m[1].split(/\s+/).pop()!
        book = findBook(last)
        if (book) start = m.index + m[1].length - last.length
      }
      const roman = m[3] ?? m[4]
      let chapter = roman !== undefined ? romanToInt(roman) : parseInt(m[2], 10)
      let v1: string | undefined = m[5]
      // "Jude 5": a one-chapter book reads the lone number as the verse
      if (book && book.chapters === 1 && roman === undefined && v1 === undefined) { v1 = m[2]; chapter = 1 }
      // "In 2 Corinthians 11", "See 1 Peter 3:22", "So 1 Corinthians 11": the word before a numbered book was read as a
      // book (or a book's abbreviation) with the number as its chapter; look again after it
      const numbered = m[2] !== undefined && m[5] === undefined && /^[1-3]$/.test(m[2]) && /^\s?([A-Z][a-z]+)/.exec(text.slice(end))
      // "Chapter 9", "Verse 4" opening a sentence
      if (!book && homeBook && m[2] !== undefined && /^(?:chapters?|verses?)$/i.test(m[1])) { relative(m[1], m.index, end, m[2], m[5], m[6]); continue }
      if (!book || (numbered && findBook(`${m[2]} ${numbered[1]}`)?.name.startsWith(m[2]))) { at.cur = null; re.lastIndex = m.index + /^\S+/.exec(m[1])![0].length; continue }
      if (chapter === undefined || chapter < 1 || chapter > book.chapters) { at.cur = null; continue }
      push(start, end, book, chapter, v1, m[6])
    } else if (m[7] !== undefined) {
      relative(m[7], m.index, end, m[8], m[9], m[10])
    } else if (m[11] !== undefined) {
      const chapter = romanToInt(m[11])
      if (!cur || chapter === undefined || chapter > cur.book.chapters || !gap(CHAPTER_GAP, m.index)) continue
      push(m.index, end, cur.book, chapter, m[12], m[13])
    } else if (m[14] !== undefined) {
      const chapter = parseInt(m[14], 10)
      if (cur && chapter >= 1 && chapter <= cur.book.chapters && gap(CHAPTER_GAP, m.index)) { push(m.index, end, cur.book, chapter, m[15], m[16]); continue }
      // "iii. 12 bis, 15.\n2 Peter ii. 9": the last verse of one entry, then the next book; rescan after the number
      re.lastIndex = m.index + m[14].length
      const prev = out[out.length - 1]
      if (cur && prev?.ref.v1 !== undefined && gap(VERSE_GAP, m.index)) push(m.index, re.lastIndex, cur.book, cur.chapter, m[14])
    } else if (m[17] !== undefined) {
      const prev = out[out.length - 1]
      if (!cur || !prev || prev.ref.v1 === undefined || !gap(VERSE_GAP, m.index)) continue
      push(m.index, end, cur.book, cur.chapter, m[17], m[18])
    }
  }
  return out
}
