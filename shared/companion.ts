/**
 * The companion beside the text: J. N. Darby's Synopsis of the Books of the Bible (data/synopsis,
 * tools/synopsis_convert.py) and C. A. Coates's Outlines and addresses (data/coates, tools/coates_convert.py), one data
 * shape for both. Which sections treat a chapter, which of them to open for the verse in view, which paragraph to open
 * at, and the library's search. Pure functions; rs/src/companion.rs mirrors `sectionsFor`.
 */
import { BOOKS, findBook } from './books.js'
import { looksLikeRef, parseRef, scanPrefaceRefs, type RefHome } from './ref.js'

export type AuthorId = 'darby' | 'coates'
export interface Author {
  id: AuthorId
  /** As a heading: "J. N. Darby". */
  name: string
  /** In a label or a segment: "Darby". */
  short: string
  /** What one of the author's sections is called in a count: "12 sections", "27 readings". */
  unit: string
  /** The credit under every reading. */
  source: string
  /** The title the author's works are volumes of, when they are ("Synopsis" of the Books of the Bible). */
  series?: string
}
/** Darby first: the sheet's first segment and the library's first author. */
export const AUTHORS: readonly Author[] = [
  { id: 'darby', name: 'J. N. Darby', short: 'Darby', unit: 'section', series: 'Synopsis', source: 'J. N. Darby (1800–1882), Synopsis of the Books of the Bible. Text from Bible Truth Publishers’ online edition; public domain.' },
  { id: 'coates', name: 'C. A. Coates', short: 'Coates', unit: 'reading', source: 'C. A. Coates (1862–1945). Text of the Kingston Bible Trust edition; public domain.' },
]
export const authorOf = (id: string): Author | undefined => AUTHORS.find(a => a.id === id)

/** A passage a section treats: book, from chapter:verse, to chapter:verse; `toVerse` 0 runs to the end of `toChapter`. */
export type Passage = [book: number, fromChapter: number, fromVerse: number, toChapter: number, toVerse: number]
/**
 * `outline`: walks through a book (Darby's Synopsis, Coates's Outlines, Darby's expository papers); `addresses`: talks on
 * a text; `introduction`: prefaces; `papers`: the rest of a writer's papers and tracts; `notes`: notes of readings and
 * jottings (Darby's Notes and Comments); `letters`.
 */
export type WorkKind = 'outline' | 'addresses' | 'introduction' | 'papers' | 'notes' | 'letters'
export interface SectionMeta { title: string; part?: string; passages: Passage[] }
export interface Section extends SectionMeta { text: string; notes?: string[] }
export interface WorkMeta { id: string; title: string; kind: WorkKind; sections: SectionMeta[] }
/** Where a work sits, as a heading's small line: "Synopsis · Genesis", "An Outline of Genesis · …". */
export function workLine(place: Pick<Place, 'author' | 'work' | 'section'>): string {
  const series = authorOf(place.author)?.series
  return [series && place.work.kind !== 'introduction' ? `${series} · ${place.work.title}` : place.work.title, place.section.part].filter(Boolean).join(' · ')
}

/** One author's index.json, with the author it belongs to. */
export interface CompanionIndex { author: AuthorId; works: WorkMeta[] }
/** A section and where it sits: author, work, and its 1-based number there (the API's `/companion/{author}/{work}/{n}`). */
export interface Place { author: AuthorId; work: Pick<WorkMeta, 'id' | 'title' | 'kind'>; n: number; section: SectionMeta }
/** A place with its text: a chapter's readings as the reader's sheet shows them. */
export interface Reading extends Place { section: Section }

/** The verses of `chapter` a passage covers, [from, to] (`to` Infinity: to the chapter's end), or null. */
export function versesIn(p: Passage, book: number, chapter: number): [number, number] | null {
  if (p[0] !== book || chapter < p[1] || chapter > p[3]) return null
  return [chapter === p[1] ? p[2] : 1, chapter === p[3] && p[4] ? p[4] : Infinity]
}

const placeOf = (index: CompanionIndex, w: WorkMeta, i: number): Place => ({ author: index.author, work: { id: w.id, title: w.title, kind: w.kind }, n: i + 1, section: w.sections[i] })

/**
 * The book a section is a commentary on, where its "chapter 9" and "verse 4" point (with the chapter, when it treats one):
 * its own passage, or for a book's introduction the work's first. None for an address or a letter, whose shorthand leans
 * only on the reference just before it.
 */
export function homeOf(place: Pick<Place, 'work' | 'section'>, work?: Pick<WorkMeta, 'sections'>): RefHome | undefined {
  if (place.work.kind === 'addresses' || place.work.kind === 'letters') return undefined
  const ps = place.section.passages
  // a book's introduction takes the book of the walk it opens; a volume of papers has no such book
  const p = ps[0] ?? (place.work.kind === 'outline' ? work?.sections.find(s => s.passages.length)?.passages[0] : undefined)
  if (!p) return undefined
  return ps.length === 1 && p[1] === p[3] ? { book: p[0], chapter: p[1] } : { book: p[0] }
}

/** Every section of one author treating `book` `chapter`: the walks through a book first, in reading order, then the
 * addresses whose text is in the chapter. */
export function sectionsFor(index: CompanionIndex, book: number, chapter: number): Place[] {
  const outlines: Place[] = [], addresses: Place[] = []
  for (const w of index.works) {
    w.sections.forEach((s, i) => {
      if (s.passages.some(p => versesIn(p, book, chapter))) (w.kind === 'addresses' ? addresses : outlines).push(placeOf(index, w, i))
    })
  }
  return [...outlines, ...addresses]
}

/**
 * Which of a chapter's sections to open for `verse`: a walk through the book before an address; among them one whose
 * passage holds the verse, the narrowest first (Colossians 1:9–24 before 1:1–24 for verse 10); failing that the nearest;
 * failing that the first. -1 for none.
 */
export function sectionForVerse(places: readonly Place[], book: number, chapter: number, verse: number): number {
  let best = -1, bestScore = Infinity
  places.forEach((pl, i) => {
    for (const p of pl.section.passages) {
      const r = versesIn(p, book, chapter)
      if (!r) continue
      const miss = verse < r[0] ? r[0] - verse : verse > r[1] ? verse - r[1] : 0
      // a chapter-long passage counts as 200 verses: narrower than several chapters, wider than any range within it
      const width = p[3] > p[1] ? 1000 + (p[3] - p[1]) : Number.isFinite(r[1]) ? r[1] - r[0] : 200
      const score = (pl.work.kind === 'addresses' ? 1e7 : 0) + miss * 1e4 + width
      if (score < bestScore) { bestScore = score; best = i }
    }
  })
  return best
}

const at = (chapter: number, verse: number) => chapter * 1000 + verse
/** Letters and single spaces, lower case: a quotation and the verse it comes from compare equal whatever the typography. */
const plainWords = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[’'‘]/g, '').replace(/[^a-z]+/g, ' ').trim()
/** The verses of the open chapter, for placing the scripture a paragraph quotes. */
export interface ChapterText { chapter: number; verses: readonly { v: number; t: string }[] }

/**
 * Where each paragraph of a section stands in its passage, for opening it at the verse in view: the first place in the
 * passage the paragraph points to, as chapter × 1000 + verse. A place is an explicit reference ("Genesis 1:26"), the
 * writer's own "verse 26" or "chapter 31" read against the book (scanPrefaceRefs with a home), or, given the open
 * chapter's text, a quotation of
 * one of its verses (“Let us make man”: both writers quote the chapter as they go, and Coates quotes this very
 * translation). Both go straight through a chapter, so only the longest run of places that never goes back is kept: a
 * paragraph glancing back at verse 1 late in the reading, or ahead to the chapter's end early on, does not move the
 * landing. Paragraphs with no kept place are -1.
 */
export function paragraphAnchors(paragraphs: readonly string[], passages: readonly Passage[], text?: ChapterText): number[] {
  const inside = (b: number, c: number, v: number) => passages.some(p => { const r = versesIn(p, b, c); return !!r && v >= r[0] && v <= r[1] })
  // a lone chapter is where a bare "verse 26" points; a reading over several chapters follows the last chapter named
  const home = passages.length === 1 && passages[0][1] === passages[0][3] ? passages[0] : null
  let chapter = home ? home[1] : 0
  const book = passages[0]?.[0] ?? 0
  const verses = text ? text.verses.filter(v => inside(book, text.chapter, v.v)).map(v => ({ v: v.v, words: ` ${plainWords(v.t)} ` })) : []
  let last = 0
  /** The verse a quotation comes from: the one verse holding its opening words (six, else four); of several (a refrain,
   * "God saw that it was good"), the first after the last place, as the writer goes on through the chapter. */
  const quoted = (q: string): number => {
    const words = plainWords(q).split(' ')
    for (const n of [6, 4]) {
      if (words.length < n) continue
      const probe = ` ${words.slice(0, n).join(' ')} `
      const hits = verses.filter(v => v.words.includes(probe))
      const hit = hits.length > 1 ? hits.find(v => at(text!.chapter, v.v) > last) ?? hits[0] : hits[0]
      if (hit) return at(text!.chapter, hit.v)
    }
    return -1
  }
  const raw = paragraphs.map(par => {
    const plain = par.replace(/<[^>]+>/g, '')
    // every candidate with where it stands in the paragraph; the earliest wins. "verse 13" follows the chapter last named,
    // in this paragraph or an earlier one
    const found: [number, number][] = []
    for (const s of scanPrefaceRefs(plain, book ? { book, chapter: chapter || undefined } : undefined)) {
      const v = s.ref.v1 ?? 1
      if (s.ref.book === book && inside(book, s.ref.chapter, v)) { found.push([s.start, at(s.ref.chapter, v)]); break }
    }
    if (verses.length) {
      for (const q of plain.matchAll(/[“"]([^”"]{12,})[”"]/g)) {
        const a = quoted(q[1])
        if (a >= 0) { found.push([q.index!, a]); break }
      }
    }
    if (!found.length) return -1
    const [, a] = found.reduce((x, y) => y[0] < x[0] ? y : x)
    chapter = Math.floor(a / 1000)
    last = a
    return a
  })
  // the longest non-decreasing run of the placed paragraphs (ties keep the earliest)
  const placed = raw.map((a, i) => [a, i] as const).filter(([a]) => a >= 0)
  const len = placed.map(() => 1), prev = placed.map(() => -1)
  for (let i = 0; i < placed.length; i++) for (let j = 0; j < i; j++) if (placed[j][0] <= placed[i][0] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j }
  let end = -1
  for (let i = 0; i < placed.length; i++) if (end < 0 || len[i] > len[end]) end = i
  const out = raw.map(() => -1)
  for (let i = end; i >= 0; i = prev[i]) out[placed[i][1]] = placed[i][0]
  return out
}

/**
 * The paragraph to open at for `chapter:verse`: the last one placed at or before it. The top (0) when none is, or when
 * that is the first placed paragraph: whatever comes before it introduces it, and the heading stays in view.
 */
export function paragraphFor(anchors: readonly number[], chapter: number, verse: number): number {
  const want = at(chapter, verse)
  let best = 0
  const first = anchors.findIndex(a => a >= 0)
  anchors.forEach((a, i) => { if (a >= 0 && a <= want) best = i })
  return best === first ? 0 : best
}

/** A section that is exactly this one chapter ("Job 3", "Chapter 15"): its title only repeats the sheet's. */
export const isWholeChapter = (ps: readonly Passage[], book: number, chapter: number) =>
  ps.length === 1 && ps[0][0] === book && ps[0][1] === chapter && ps[0][3] === chapter && ps[0][2] === 1 && ps[0][4] === 0

/**
 * "Genesis 1", "Genesis 29–35", "Colossians 1:24–2:10", "Romans 15:13", "Jude 3–4"; `abbr` for tight places; `bare`
 * without the book, where it is named already ("Chapter 1", "Chapters 29–35", "1:24–2:10", "Verses 3–4").
 */
export function formatPassage(p: Passage, style: 'full' | 'abbr' | 'bare' = 'full'): string {
  const [b, c1, v1, c2, v2] = p
  const meta = BOOKS[b - 1]
  const whole = v1 === 1 && v2 === 0
  if (style === 'bare') {
    if (meta.chapters === 1) return whole ? meta.name : `${v2 && v2 !== v1 ? 'Verses' : 'Verse'} ${v1}${v2 && v2 !== v1 ? `–${v2}` : ''}`
    if (whole) return c1 === c2 ? `Chapter ${c1}` : `Chapters ${c1}–${c2}`
  }
  const name = style === 'bare' ? '' : `${style === 'abbr' ? meta.abbr : meta.name} `
  if (meta.chapters === 1) return whole ? name.trim() : `${name}${v1}${v2 && v2 !== v1 ? `–${v2}` : ''}`
  if (whole) return c1 === c2 ? `${name}${c1}` : `${name}${c1}–${c2}`
  if (c1 === c2) return `${name}${c1}:${v1}${v2 === 0 ? '–end' : v2 !== v1 ? `–${v2}` : ''}`
  return `${name}${c1}:${v1}–${c2}${v2 ? `:${v2}` : ''}`
}

/** A reading's title without the place and date it was given: "Chapter 1 verse 9 (Bridport, 11 July 1925)" → "Chapter 1 verse 9". */
export const undated = (title: string) => title.replace(/\s*\([^()]*\d[^()]*\)\s*$/, '')

/**
 * Short names for a chapter's sections, to choose between them in the sheet: for a walk through the book the passage
 * within it ("1:1–16", "Chapter 1"), for an address its title; the title (undated) wherever two would read alike (Coates
 * read 1 Timothy 1 three times: "Chapter 1 (first reading)").
 */
export function chipLabels(places: readonly Place[], book: number, chapter: number): string[] {
  const labels = places.map(pl => {
    const p = pl.work.kind === 'addresses' ? undefined : pl.section.passages.find(x => versesIn(x, book, chapter))
    return p ? formatPassage(p, 'bare') : undated(pl.section.title)
  })
  return labels.map((l, i) => labels.indexOf(l) !== labels.lastIndexOf(l) ? undated(places[i].section.title) : l)
}

/** A section's passages as one line: "Ezra 4–5; Haggai 1–2". */
export const formatPassages = (ps: readonly Passage[], style: 'full' | 'abbr' = 'full') => ps.map(p => formatPassage(p, style)).join('; ')

/** Where "Read this passage" goes: the first chapter and verse the section treats. */
export const passageStart = (p: Passage) => ({ book: p[0], chapter: p[1], v1: p[2] > 1 ? p[2] : undefined })

/** A title that is itself a passage ("Chapter 3", "Genesis 6–8", "Psalm 42 and Psalm 44"): a passage line under it would repeat it. */
export function titleIsPassage(title: string): boolean {
  if (/^(?:chapters?|psalms?)\b/i.test(title)) return true
  const m = /^((?:[1-3]\s?)?[A-Z][a-z]+(?:\s(?:of\s)?[A-Z][a-z]+)?)\s+\d/.exec(title)
  return !!m && !!findBook(m[1])
}

/** One paragraph: a block quotation ("> " lines in the data) or prose; `lines` keep hymn and verse lines. */
export interface Para { quote: boolean; lines: string[] }
export function paragraphsOf(text: string): Para[] {
  return text.split(/\n{2,}/).filter(p => p.trim()).map(p => {
    const lines = p.split('\n')
    const quote = lines.every(l => l.startsWith('> ') || l === '>')
    return { quote, lines: quote ? lines.map(l => l.replace(/^> ?/, '')) : lines }
  })
}

/**
 * Pages of a long section, cut at paragraph boundaries: about `size` characters each. The paragraphs of page k are
 * `paragraphs.slice(starts[k], starts[k + 1])`.
 */
export function pageStarts(paragraphs: readonly string[], size: number): number[] {
  const total = paragraphs.reduce((n, p) => n + p.length, 0)
  const pages = Math.max(1, Math.round(total / size))
  const target = total / pages
  const starts = [0]
  let run = 0
  paragraphs.forEach((p, i) => {
    // a paragraph goes to the next page when more than half of it would pass this page's share
    if (i > 0 && starts.length < pages && run + p.length / 2 >= target * starts.length) starts.push(i)
    run += p.length
  })
  return starts
}

/**
 * Search both authors by passage or title. A reference with a chapter ("rom 8", "Genesis 24:10") lists the sections
 * treating that chapter, author by author, the one for the verse first; a book alone ("Ezra", "deut") every section in
 * the book; anything else the sections whose own title holds every word as a word start ("stand fast", "tabernacle").
 * Titles that are passages ("Chapter 3", "Genesis 6–8") are found by passage, never by their words.
 */
export function searchCompanion(indexes: readonly CompanionIndex[], query: string): Place[] {
  const q = query.trim()
  if (!q) return []
  if (/\d/.test(q) && looksLikeRef(q)) {
    const ref = parseRef(q)
    if (ref) {
      return indexes.flatMap(index => {
        const places = sectionsFor(index, ref.book, ref.chapter)
        const first = sectionForVerse(places, ref.book, ref.chapter, ref.v1 ?? 1)
        return first > 0 ? [places[first], ...places.filter((_, i) => i !== first)] : places
      })
    }
  }
  const book = !/\d/.test(q) && q.length >= 2 ? findBook(q) : undefined
  if (book) {
    const out: Place[] = []
    for (const index of indexes) for (let c = 1; c <= book.chapters; c++) {
      for (const pl of sectionsFor(index, book.n, c)) if (!out.some(o => o.author === pl.author && o.work.id === pl.work.id && o.n === pl.n)) out.push(pl)
    }
    if (out.length) return out
  }
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, '')
  const words = fold(q).match(/[a-z0-9]+/g) ?? []
  if (!words.length) return []
  const res = words.map(w => new RegExp(`\\b${w}`))
  const out: Place[] = []
  for (const index of indexes) for (const w of index.works) {
    w.sections.forEach((s, i) => {
      if (titleIsPassage(s.title)) return
      const hay = fold(`${s.title} ${s.part ?? ''}`)
      if (res.every(r => r.test(hay))) out.push(placeOf(index, w, i))
    })
  }
  return out
}
