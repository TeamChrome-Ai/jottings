/**
 * The verse index of the ministry, as tools/ministry_index.ts builds it: which paragraphs refer to which verses, and in
 * what order a verse's paragraphs are listed. Pure functions over text; the builder does the files and the database,
 * rs/src/ministry.rs serves the result (its snippet mirrors `snippetOf`). The app never imports this module.
 *
 * The ranking rule, per verse, best first:
 *   1. quote: the paragraph gives the verse's own words: five running words of it, three of them not small words (the
 *      whole verse when it has three or four) beside a reference to it, or in a reading on its passage when no other
 *      verse of the chapter has those five words;
 *      or, anywhere, eight running words found in that verse and in no other (at least three not small, so "and he said
 *      unto them, Verily I say" matches nothing);
 *   2. verse: it names the verse alone ("John 3:16", "verse 16" or "(v. 16)" in a reading on John 3), or, in Darby's
 *      Notes and Comments on the chapter, opens with its verse marker ("—2. Jude and Peter …", "1. There is …");
 *   3. range: the verse is inside a range it names of at most RANGE_CAP verses ("Romans 8:28–39") or a verse marker
 *      names several ("—24, 25. These are …"), or, in the Notes and Comments, the paragraph is one of the MARKER_RUN
 *      after a marker on it; a longer range names no verse in particular and counts for none;
 *   4. list: the paragraph names LIST_REFS references or more. It is a list of proofs (Darby's "see Rom. 3:24; 5:1, 9;
 *      Eph. 2:8 …"), not ministry on any one of them: it counts for each verse it names (ranges up to LIST_RANGE_CAP),
 *      after every other paragraph, and it never counts as a quotation.
 *   5. chapter: the row of the whole chapter (verse 0, which counts for every verse of it): the paragraph names the
 *      chapter alone ("Romans 8", "chapter 8" in a reading on Romans), or it opens a section on at most SECTION_CHAPTERS
 *      chapters (the Synopsis on Genesis 6–8 has a row on each of the three; a section on a whole book has none).
 * Within a class, a paragraph in a section on the passage holding the verse (a commentary on the chapter; for a chapter
 * row, a passage in the chapter) comes first, then paragraphs naming fewer references (the one given to the verse before
 * the one that passes it on the way), then reading order: author, collection, work, section, paragraph.
 *
 * The rows of a section's figures (shared/figures.ts `figureRows`) are units too (`rowHits`). A row of a table of
 * references (a harmony's passage, a line of an index of names, a chart's column) counts for every verse of what it
 * names, whatever its length, in the list class after every paragraph (ROW_RANK); a row of an argument (a prayer beside
 * its answer) counts as a paragraph's references do, and for the verses it quotes without naming them.
 */
import { BOOKS } from './books.js'
import { paragraphHomes, paragraphsOf, type Para, type Passage, type WorkKind } from './companion.js'
import { scanPrefaceRefs, type RefHome } from './ref.js'
import type { FigureRow } from './figures.js'
import { MENTIONS, type Mention } from './ministry.js'

export const LIST_REFS = 20
export const RANGE_CAP = 20
export const LIST_RANGE_CAP = 5
export const QUOTE_WORDS = 5
export const FREE_QUOTE_WORDS = 8
/** How much text a result shows around its reference. */
export const SNIPPET_CHARS = 200

/** `book * 1e6 + chapter * 1e3 + verse`, the scripture tables' verse id. */
export const verseId = (book: number, chapter: number, verse: number) => book * 1_000_000 + chapter * 1000 + verse
export const verseOf = (id: number) => ({ book: Math.floor(id / 1_000_000), chapter: Math.floor(id / 1000) % 1000, verse: id % 1000 })

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }
/**
 * A paragraph as the index reads it and the server quotes it: tags dropped, the corpus's five entities decoded, a
 * block quotation's lines without their "> ", lines joined by a space. rs/src/ministry.rs `plain` is the same.
 */
export const plainOf = (p: Para) => p.lines.join(' ').replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, m => ENTITIES[m])

// ---------- words, for quotations ----------

const SMALL = new Set(('a an and are as at be but by do for from had has have he her him his i if in is it me my no not of on or our she ' +
  'so that the thee their them then there they thou thy to unto us was we were what when which who will with ye you your said saith says say ' +
  'shall all this these those upon into also even').split(' '))
/** A word too common to be looked for alone ("the", "of", "unto"): words asked for in the ministry need one that is not
 *  (rs/src/ministry.rs keeps the same list). */
export const isSmallWord = (w: string) => SMALL.has(w.toLowerCase().replace(/['’]/g, ''))

/** Words for matching: lower case, apostrophes dropped, letters only, with where each stands in `text` (UTF-16). */
export function wordsOf(text: string): { w: string; start: number; end: number }[] {
  const out: { w: string; start: number; end: number }[] = []
  for (const m of text.matchAll(/[A-Za-z][A-Za-z’']*/g)) out.push({ w: m[0].toLowerCase().replace(/[’']/g, ''), start: m.index!, end: m.index! + m[0].length })
  return out
}
const gram = (ws: readonly string[], i: number, n: number) => ws.slice(i, i + n).join(' ')
/** Words that say something: a run of only "and he said unto them" is not a quotation of anything. */
const content = (ws: readonly string[]) => ws.filter(w => !SMALL.has(w)).length

/** The text of the Bible the quotations are matched against: the words of each verse, and the eight-word runs found in one verse only. */
export interface BibleWords {
  words: Map<number, string[]>
  /** An eight-word run → the one verse it is found in (0 when it is found in more than one). */
  runs: Map<string, number>
  /** Verses in each chapter, `book * 1000 + chapter` → count. */
  counts: Map<number, number>
}
export function bibleWords(books: readonly { n: number; chapters: readonly { c: number; verses: readonly { v: number; t: string }[] }[] }[]): BibleWords {
  const words = new Map<number, string[]>(), runs = new Map<string, number>(), counts = new Map<number, number>()
  for (const b of books) for (const c of b.chapters) {
    counts.set(b.n * 1000 + c.c, c.verses.reduce((m, v) => Math.max(m, v.v), 0))
    for (const v of c.verses) {
      const id = verseId(b.n, c.c, v.v)
      const ws = wordsOf(v.t).map(x => x.w)
      words.set(id, ws)
      const seen = new Set<string>()
      for (let i = 0; i + FREE_QUOTE_WORDS <= ws.length; i++) {
        const g = gram(ws, i, FREE_QUOTE_WORDS)
        if (seen.has(g)) continue
        seen.add(g)
        const had = runs.get(g)
        runs.set(g, had === undefined ? id : had === id ? id : 0)
      }
    }
  }
  return { words, runs, counts }
}

// ---------- one paragraph ----------

export interface Hit { verse: number; mention: Mention; start: number; end: number }
/** Is `a` the better way to refer to a verse than `b` (MENTIONS is best first). */
const better = (a: Mention, b: Mention) => MENTIONS.indexOf(a) < MENTIONS.indexOf(b)

/**
 * Every verse a paragraph refers to, each once with its best mention: explicit references and the writer's shorthand
 * read by scanPrefaceRefs (with `home`, the book and chapter a commentary is on; a bare "(verse 8)" closing a quotation
 * is the verse it quotes, quotedChapter), ranges expanded (RANGE_CAP), verses checked against Darby's verse counts, and
 * quotations found by their words. `start`/`end` are where the reference (or for a quotation, the quoted words) stands
 * in `plain`.
 */
/** The verses of the chapter in hand a bare quotation may come from, and how many of them hold each five-word run. */
export interface Nearby { verses: readonly number[]; runs: ReadonlyMap<string, number> }
export function nearbyOf(bible: BibleWords, verses: readonly number[]): Nearby {
  const runs = new Map<string, number>()
  for (const id of verses) {
    const vw = bible.words.get(id) ?? []
    for (const g of new Set(vw.map((_, i) => gram(vw, i, QUOTE_WORDS)))) runs.set(g, (runs.get(g) ?? 0) + 1)
  }
  return { verses, runs }
}

/** The writer's bare "verse 22", "vv. 4–6", "(v. 22)": a reference that names no book or chapter. */
const BARE = /^(?:vv?\.|[Vv]er(?:ses?|se|s)?\b\.?)/
/** A quotation closing just before a reference: “…” (v. 22), “…,” v. 17, “….” (Ver. 5.) */
const QUOTED_BEFORE = /[.,]?[”"][.,;]?\s*\(?\s*$/
/** Each Bible's verse ids by their number, for quotedChapter. */
const numbered = new WeakMap<BibleWords, Map<number, number[]>>()

/**
 * The writer quotes a verse and gives only its number, the book being plain to the reader (“The silver is mine, and the
 * gold is mine, saith the Lord of hosts” (verse 8), in Coates's reading on Ezra 4, is Haggai 2:8): the chapter
 * (`book * 1000 + chapter`) of the one verse numbered `n` sharing the most four-word runs of the quotation, when it
 * shares more than `at`, the verse the reference reads as; else undefined.
 */
function quotedChapter(plain: string, start: number, n: number, at: number, bible: BibleWords): number | undefined {
  const lead = QUOTED_BEFORE.exec(plain.slice(Math.max(0, start - 6), start))
  if (!lead) return undefined
  const close = start - lead[0].length, open = plain.lastIndexOf('“', close)
  if (open < 0 || close - open > 500) return undefined
  const ws = wordsOf(plain.slice(open + 1, close)).map(x => x.w)
  const runs = new Set<string>()
  for (let i = 0; i + 4 <= ws.length; i++) if (content(ws.slice(i, i + 4)) >= 2) runs.add(gram(ws, i, 4))
  if (!runs.size) return undefined
  const shared = (id: number) => { const vw = bible.words.get(id) ?? []; let k = 0; for (let i = 0; i + 4 <= vw.length; i++) if (runs.has(gram(vw, i, 4))) k++; return k }
  let byN = numbered.get(bible)
  if (!byN) {
    numbered.set(bible, byN = new Map())
    for (const id of bible.words.keys()) { const list = byN.get(id % 1000); if (list) list.push(id); else byN.set(id % 1000, [id]) }
  }
  let best = 0, top = 0, tie = false
  for (const id of byN.get(n) ?? []) {
    const k = shared(id)
    if (k > top) { best = id; top = k; tie = false } else if (k && k === top) tie = true
  }
  return top && !tie && top > shared(at) ? Math.floor(best / 1000) : undefined
}

export function paragraphHits(plain: string, bible: BibleWords, home?: RefHome, nearby?: Nearby): { hits: Hit[]; refs: number } {
  const spans = scanPrefaceRefs(plain, home)
  const list = spans.length >= LIST_REFS
  const cap = list ? LIST_RANGE_CAP : RANGE_CAP
  const best = new Map<number, Hit>()
  const put = (h: Hit) => {
    const had = best.get(h.verse)
    if (!had || better(h.mention, had.mention)) best.set(h.verse, h)
  }
  const words = wordsOf(plain)
  const ws = words.map(x => x.w)
  // five-word runs of the paragraph, with where each starts, for "does it give this verse's words"
  const fives = new Map<string, number>()
  for (let i = 0; i + QUOTE_WORDS <= ws.length; i++) { const g = gram(ws, i, QUOTE_WORDS); if (!fives.has(g)) fives.set(g, i) }
  const joined = ` ${ws.join(' ')} `
  /** Where the paragraph gives the verse's words: [first word, last word] of the longest run found, or null. */
  const quoted = (verse: number): [number, number] | null => {
    const vw = bible.words.get(verse)
    if (!vw || vw.length < 3) return null
    if (vw.length < QUOTE_WORDS) {
      const at = joined.indexOf(` ${vw.join(' ')} `)
      if (at < 0 || content(vw) < 2) return null
      const first = joined.slice(0, at + 1).split(' ').length - 2
      return [first, first + vw.length - 1]
    }
    let found: [number, number] | null = null
    for (let i = 0; i + QUOTE_WORDS <= vw.length; i++) {
      const at = fives.get(gram(vw, i, QUOTE_WORDS))
      if (at === undefined) continue
      // grow the run while the verse and the paragraph go on together
      let k = QUOTE_WORDS
      while (i + k < vw.length && at + k < ws.length && vw[i + k] === ws[at + k]) k++
      if (content(ws.slice(at, at + k)) < 3) continue
      if (!found || k > found[1] - found[0] + 1) found = [at, at + k - 1]
    }
    return found
  }
  for (const s of spans) {
    let { book, chapter } = s.ref
    const { v1, v2 } = s.ref
    const quoting = v1 !== undefined && BARE.test(plain.slice(s.start, s.end)) ? quotedChapter(plain, s.start, v1, verseId(book, chapter, v1), bible) : undefined
    if (quoting) { book = Math.floor(quoting / 1000); chapter = quoting % 1000 }
    const count = bible.counts.get(book * 1000 + chapter) ?? 0
    if (v1 === undefined) {
      // "John 3–4": the reference read stops at its first chapter; a run of a few chapters is on each, a longer one
      // ("Genesis 1–47") on none
      const run = /^\s?(?:--|[-–—])\s?(\d{1,3})(?![\d:])/.exec(plain.slice(s.end))
      const last = run ? +run[1] : chapter
      if (last < chapter || last - chapter + 1 > SECTION_CHAPTERS) continue
      const end = s.end + (run?.[0].length ?? 0)
      for (let c = chapter; c <= last; c++) if (bible.counts.has(book * 1000 + c)) put({ verse: verseId(book, c, 0), mention: 'chapter', start: s.start, end })
      continue
    }
    if (v1 < 1 || v1 > count) continue
    const to = Math.min(v2 ?? v1, count)
    if (to - v1 + 1 > cap) continue
    for (let v = v1; v <= to; v++) {
      const id = verseId(book, chapter, v)
      const q = list ? null : quoted(id)
      if (q) put({ verse: id, mention: 'quote', start: words[q[0]].start, end: words[q[1]].end })
      else put({ verse: id, mention: list ? 'list' : to > v1 ? 'range' : 'verse', start: s.start, end: s.end })
    }
  }
  // in a reading on a passage, the verses of the chapter in hand are quoted as the writer goes, by five running words
  // (a phrase the chapter says more than once, "the fowl of the heavens", is no one verse's)
  if (!list && nearby) for (const id of nearby.verses) {
    if (best.get(id)?.mention === 'quote') continue
    const q = quoted(id)
    if (q && q[1] - q[0] + 1 >= QUOTE_WORDS && nearby.runs.get(gram(ws, q[0], QUOTE_WORDS)) === 1) put({ verse: id, mention: 'quote', start: words[q[0]].start, end: words[q[1]].end })
  }
  // quotations with no reference: eight running words found in one verse only
  if (!list) {
    for (let i = 0; i + FREE_QUOTE_WORDS <= ws.length; i++) {
      const g = ws.slice(i, i + FREE_QUOTE_WORDS)
      const id = bible.runs.get(g.join(' '))
      if (!id || best.get(id)?.mention === 'quote' || content(g) < 3) continue
      const vw = bible.words.get(id)!
      const j = vw.indexOf(g[0])
      let k = FREE_QUOTE_WORDS
      // the run found may begin later in the verse than its first word's first place; grow it as far as both go
      for (let from = j; from >= 0 && from + FREE_QUOTE_WORDS <= vw.length; from = vw.indexOf(g[0], from + 1)) {
        if (gram(vw, from, FREE_QUOTE_WORDS) !== g.join(' ')) continue
        while (from + k < vw.length && i + k < ws.length && vw[from + k] === ws[i + k]) k++
        break
      }
      put({ verse: id, mention: 'quote', start: words[i].start, end: words[i + k - 1].end })
      i += k - 1
    }
  }
  return { hits: [...best.values()], refs: spans.length }
}

/** A result's place in its verse's list: lower first (see the rule at the top). Fits in 32 bits. */
export function rankOf(mention: Mention, onPassage: boolean, refs: number): number {
  return MENTIONS.indexOf(mention) * 10_000_000 + (onPassage ? 0 : 1) * 1_000_000 + Math.min(refs, 999) * 1000
}
export const mentionOfRank = (rank: number): Mention => MENTIONS[Math.floor(rank / 10_000_000)]

/** Does a section's passage hold the verse; for a whole chapter (verse 0), is a passage in the chapter. */
export function onPassage(passages: readonly Passage[], verse: number): boolean {
  const { book, chapter, verse: v } = verseOf(verse)
  return passages.some(p => p[0] === book && (chapter > p[1] || (chapter === p[1] && (v === 0 || v >= p[2]))) && (chapter < p[3] || (chapter === p[3] && (p[4] === 0 || v <= p[4]))))
}

/** A section whose passages lie within at most this many chapters is on each of them (`chapterRows`), as is a run of
 *  chapters named ("John 3–4"). */
export const SECTION_CHAPTERS = 3

/**
 * The rows of the whole chapters a section is on (verse 0, given to its first paragraph, the reference at the paragraph's
 * start), when its passages lie within at most SECTION_CHAPTERS chapters: the Synopsis on Genesis 6–8 is on each of the
 * three, "Hints on Genesis" (1–50) on none.
 */
function chapterRows(passages: readonly Passage[], counts: ReadonlyMap<number, number>): Hit[] {
  const ids = new Set<number>()
  for (const [book, from, , to] of passages) for (let c = from; c <= to; c++) ids.add(verseId(book, c, 0))
  if (ids.size > SECTION_CHAPTERS) return []
  return [...ids].filter(id => counts.has(id / 1000)).map((verse): Hit => ({ verse, mention: 'chapter', start: 0, end: 0 }))
}

/**
 * A verse marker opening a paragraph of Darby's Notes and Comments: "1. ", "—2. ", "7, 8. ", "—24, 25. ", "11–13. ".
 * An outline's numbered points ("1. The work of faith") read the same, so only works of kind 'notes' are read for them.
 */
const MARKER = /^(?:—\s?)?(\d{1,3}(?:\s?[–-]\s?\d{1,3})?(?:\s?,\s?\d{1,3}(?:\s?[–-]\s?\d{1,3})?)*)\.(?:\s|$)/
/**
 * How many paragraphs after a verse marker are on its verses too. Darby stays on a verse for a paragraph or two (after
 * "—2. Jude and Peter …", two more on the sons of God), then moves on with no marker. Read over the whole Notes and
 * Comments, the first paragraph after a marker was on its verses about nine times in ten, the second two in three, the
 * third fewer than half, and past the sixth almost never.
 */
export const MARKER_RUN = 2

/**
 * The verses a paragraph's opening verse marker names in `chapter` (its verse 0 id), and where the numbers stand; no
 * verses when the chapter lacks one of them or they are more than RANGE_CAP; null when the paragraph opens with none.
 */
function markerOf(plain: string, chapter: number, counts: ReadonlyMap<number, number>): { verses: number[]; start: number; end: number } | null {
  const m = MARKER.exec(plain)
  if (!m) return null
  const vs = new Set<number>()
  for (const item of m[1].split(',')) {
    const [from, to = from] = item.split(/[–-]/).map(Number)
    for (let v = from; v <= to; v++) vs.add(v)
  }
  const count = counts.get(chapter / 1000) ?? 0
  const start = m[0].indexOf(m[1])
  const real = vs.size <= RANGE_CAP && [...vs].every(v => v >= 1 && v <= count)
  return { verses: real ? [...vs].map(v => chapter + v) : [], start, end: start + m[1].length }
}

/** `hits` and `more`, each verse once at its better mention (the one in `hits` on a tie). */
function merged(hits: Hit[], more: readonly Hit[]): Hit[] {
  const best = new Map(hits.map(h => [h.verse, h]))
  for (const h of more) { const had = best.get(h.verse); if (!had || better(h.mention, had.mention)) best.set(h.verse, h) }
  return [...best.values()]
}

/**
 * A section's paragraphs, each with its hits. `home` is where the section's shorthand points (shared/companion.ts
 * homeOf); in a section on several chapters of one book, a bare "verse 4" or "(v. 4)" is in the chapter in hand, the
 * first of the passage until the paragraph or an earlier one names another of its chapters (paragraphHomes, as the
 * reader links them). In a section on a passage (`passages`), five running words of a verse of the chapter in hand are
 * a quotation of it with no reference needed (Coates on Genesis 1: “Let us make man”), as the companion places its
 * paragraphs. The first paragraph carries the section's chapter rows (`chapterRows`).
 *
 * In Darby's Notes and Comments (`kind` 'notes') on one chapter, a paragraph opening with a verse marker ("—2. Jude and
 * Peter …", "24, 25. These are …") is on the verses it names, and the MARKER_RUN paragraphs after it, short of the next
 * marker, are on them too (a range, the reference at the paragraph's start). A marker naming a verse the chapter lacks
 * ends the last one's run and starts none.
 */
export function sectionHits(text: string, bible: BibleWords, home?: RefHome, passages: readonly Passage[] = [], kind?: WorkKind): { para: number; plain: string; hits: Hit[]; refs: number }[] {
  const plains = paragraphsOf(text).map(plainOf)
  const homes = paragraphHomes(plains, home, passages)
  /** The verses of the chapter in hand that the section's passage holds: where a bare quotation is looked for. */
  const memo = new Map<number, Nearby>()
  const nearby = (c: number | undefined) => {
    if (!home || !c) return undefined
    let got = memo.get(c)
    if (!got) {
      const n = bible.counts.get(home.book * 1000 + c) ?? 0
      memo.set(c, got = nearbyOf(bible, Array.from({ length: n }, (_, i) => verseId(home.book, c, i + 1)).filter(v => onPassage(passages, v))))
    }
    return got
  }
  const rows = chapterRows(passages, bible.counts)
  /** The chapter a section of the Notes and Comments is on (its verse 0 id), whose verse markers are read; else 0. */
  const marked = kind === 'notes' && home?.chapter ? verseId(home.book, home.chapter, 0) : 0
  /** The verses the last marker named, as the paragraphs after it are on them, and the last of those paragraphs. */
  let run: { hits: Hit[]; to: number } = { hits: [], to: -1 }
  return plains.map((plain, para) => {
    const r = paragraphHits(plain, bible, homes[para], nearby(homes[para]?.chapter))
    const m =marked ? markerOf(plain, marked, bible.counts) : null
    if (m) run = { hits: m.verses.map((verse): Hit => ({ verse, mention: 'range', start: 0, end: 0 })), to: para + MARKER_RUN }
    const more = m ? m.verses.map((verse): Hit => ({ verse, mention: m.verses.length > 1 ? 'range' : 'verse', start: m.start, end: m.end }))
      : para <= run.to ? run.hits : []
    return { para, plain, hits: merged(r.hits, para ? more : [...more, ...rows]), refs: r.refs }
  })
}

/**
 * About SNIPPET_CHARS characters of `plain` around [start, end), cut between words, "…" where text is left out; `hl`
 * is the reference inside the snippet. rs/src/ministry.rs `snippet` is the same, in UTF-16 units.
 */
export function snippetOf(plain: string, start: number, end: number, size = SNIPPET_CHARS): { snippet: string; hl: [number, number] } {
  const before = Math.max(0, Math.floor((size - (end - start)) * 0.4))
  let a = Math.max(0, start - before)
  let b = Math.min(plain.length, Math.max(end, a + size))
  if (b - a < size) a = Math.max(0, b - size)
  // cut between words: forward to a word start, back to a word end
  if (a > 0 && plain[a - 1] !== ' ') { const sp = plain.indexOf(' ', a); a = sp >= 0 && sp < start ? sp + 1 : Math.min(a, start) }
  if (b < plain.length && plain[b] !== ' ') { const sp = plain.lastIndexOf(' ', b); b = sp >= end ? sp : Math.max(b, end) }
  const head = a > 0 ? '…' : '', tail = b < plain.length ? '…' : ''
  const body = plain.slice(a, b).trim()
  const lead = plain.slice(a, b).length - plain.slice(a, b).trimStart().length
  return { snippet: head + body + tail, hl: [head.length + start - a - lead, head.length + end - a - lead] }
}

/** Book and chapter a verse id is in, as "Genesis 1:26": for the builder's report. */
export const formatVerseId = (id: number) => { const { book, chapter, verse } = verseOf(id); return `${BOOKS[book - 1].name} ${chapter}:${verse}` }

/** Where a row of a table of references ranks: in the list class, after every paragraph (whose ranks stop below it). */
export const ROW_RANK = 3 * 10_000_000 + 2_000_000

/** Every verse of a passage, by the Bible's verse counts (a whole chapter, a range across chapters). */
export function versesOfPassage(p: Passage, counts: ReadonlyMap<number, number>): number[] {
  const [book, c1, v1, c2, v2] = p
  const out: number[] = []
  for (let c = c1; c <= c2; c++) {
    const n = counts.get(book * 1000 + c) ?? 0
    const from = c === c1 ? v1 : 1
    const to = c === c2 && v2 ? Math.min(v2, n) : n
    for (let v = from; v <= to; v++) out.push(verseId(book, c, v))
  }
  return out
}

/**
 * A figure row's hits and its rank for each (see the rule at the top). `refs`: how many references the row names, for
 * the tie-break of an argument row.
 */
export function rowHits(row: FigureRow, bible: BibleWords, home: RefHome | undefined, passages: readonly Passage[]): { verse: number; mention: Mention; rank: number; start: number; end: number }[] {
  const out = new Map<number, { verse: number; mention: Mention; rank: number; start: number; end: number }>()
  const put = (h: { verse: number; mention: Mention; rank: number; start: number; end: number }) => { const had = out.get(h.verse); if (!had || h.rank < had.rank) out.set(h.verse, h) }
  if (row.reference) {
    const spans: { p: Passage; start: number; end: number }[] = row.passages.length
      ? row.passages.map(p => ({ p, start: row.at?.[0] ?? 0, end: row.at?.[1] ?? row.text.length }))
      : scanPrefaceRefs(row.text).map(s => {
        const { book, chapter, v1, v2 } = s.ref
        return { p: [book, chapter, v1 ?? 1, chapter, v1 === undefined ? 0 : v2 ?? v1] as Passage, start: s.start, end: s.end }
      })
    const n = spans.length
    for (const s of spans) for (const verse of versesOfPassage(s.p, bible.counts)) put({ verse, mention: 'list', rank: ROW_RANK + Math.min(n, 999) * 1000, start: s.start, end: s.end })
    return [...out.values()]
  }
  const r = paragraphHits(row.text, bible, home)
  for (const h of r.hits) put({ ...h, rank: rankOf(h.mention, onPassage(passages, h.verse), r.refs) })
  if (row.extra) {
    // the verses the row quotes without naming: the row's first cell is what it says of them
    const cut = row.text.indexOf(' · ')
    for (const s of scanPrefaceRefs(row.extra)) {
      const { book, chapter, v1, v2 } = s.ref
      if (v1 === undefined) continue
      for (let v = v1; v <= (v2 ?? v1); v++) put({ verse: verseId(book, chapter, v), mention: 'verse', rank: rankOf('verse', onPassage(passages, verseId(book, chapter, v)), r.refs + 1), start: 0, end: cut > 0 ? cut : row.text.length })
    }
  }
  return [...out.values()]
}
