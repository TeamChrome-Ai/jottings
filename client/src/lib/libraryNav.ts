/**
 * The ministry library's navigation, free of React Native so the tests run in node: the library the app falls back on
 * when the server's list cannot be had (the companion's Synopsis and Coates), where a work sits in its collection and
 * which section a turn brings in (across works, as Genesis 50 turns to Exodus 1), the contents picker's grid or list,
 * the toolbar's title, the reading position kept per work, and the reader's deep link (`n`, `p`, `from`).
 */
import { BOOKS, type BookMeta } from '@shared/books'
import { AUTHORS, formatPassage, formatPassages, titleIsPassage, type CompanionIndex, type Passage, type Place, type WorkKind, type WorkMeta } from '@shared/companion'
import { MINISTRY_AUTHORS, type CollectionSummary, type Library, type LibraryAuthor, type MinistrySectionMeta, type SectionHit, type WorkContents, type WorkSummary } from '@shared/ministry'
import { formatVerseRuns, type Ref } from '@shared/ref'

/** Lower case without accents or apostrophes, for matching titles. */
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, '')

// ---------- the library ----------

/** The collection the companion's works make when the server's library is not there: one per author's series. */
export function libraryFromCompanion(indexes: readonly CompanionIndex[]): Library {
  const authors: LibraryAuthor[] = []
  for (const index of indexes) {
    const a = MINISTRY_AUTHORS.find(x => x.id === index.author)
    const c = AUTHORS.find(x => x.id === index.author)
    if (!a || !c) continue
    const summary = (w: WorkMeta): WorkSummary => ({ id: w.id, title: w.title, kind: w.kind, count: w.sections.length })
    const collections: CollectionSummary[] = index.author === 'darby'
      ? [{ id: 'synopsis', title: 'Synopsis', works: index.works.map(summary) }]
      : [
          { id: 'outlines', title: 'Outlines', works: index.works.filter(w => w.kind === 'outline').map(summary) },
          ...index.works.filter(w => w.kind !== 'outline').map(w => ({ id: w.id, title: w.title, works: [summary(w)] })),
        ].filter(x => x.works.length)
    authors.push({ id: a.id, name: a.name, short: a.short, born: a.born, died: a.died, source: c.source, collections })
  }
  return { authors }
}

/** A companion work's contents, from its index: the Synopsis and Coates open without asking the server. */
export function contentsFromIndex(index: CompanionIndex, work: string, collection = ''): WorkContents | null {
  const w = index.works.find(x => x.id === work)
  return w ? { author: index.author, work: { id: w.id, title: w.title, kind: w.kind, collection }, sections: w.sections } : null
}

export interface Shelf { author: LibraryAuthor; collection: CollectionSummary; /** the work's place in the collection */ at: number }
/** Where a work sits: its author and collection. */
export function shelfOf(library: Library | null | undefined, author: string, work: string): Shelf | null {
  const a = library?.authors.find(x => x.id === author)
  if (!a) return null
  for (const collection of a.collections) {
    const at = collection.works.findIndex(w => w.id === work)
    if (at >= 0) return { author: a, collection, at }
  }
  return null
}

/** The collection a legacy `kind` link (`?author=coates&kind=outline`) meant: the first holding a work of that kind. */
export const collectionOfKind = (a: LibraryAuthor, kind: string) => a.collections.find(c => c.works.some(w => w.kind === kind))

export interface Spot { work: string; n: number }
/**
 * The section a turn toward `dir` brings in: the next or previous one in the work, else across into the next or the
 * previous work of the collection (its first section, or the last of the one before). `count` is the work's own
 * number of sections when its contents are in (the summary's otherwise).
 */
export function neighbourOf(shelf: Shelf | null, work: string, n: number, count: number, dir: 1 | -1): Spot | null {
  if (dir > 0 && n < count) return { work, n: n + 1 }
  if (dir < 0 && n > 1) return { work, n: n - 1 }
  if (!shelf) return null
  const w = shelf.collection.works[shelf.at + dir]
  if (!w || w.count < 1) return null
  return { work: w.id, n: dir > 0 ? 1 : w.count }
}

/** A page's place on the pager: works of a collection are laid end to end, so a turn across two works is one step. */
export const pageIndex = (at: number, n: number) => at * 100_000 + n

// ---------- titles ----------

/** "An Outline of the Epistle to the Romans" is "Romans" beside its fellows; a quoted title loses its quotes. */
export const shortTitle = (title: string) => title
  .replace(/^(?:An\s+)?Outlines?\s+of\s+(?:the\s+)?/i, '')
  // "the First Book of Samuel" is 1 Samuel; "the Books of the Chronicles" is both
  .replace(/^(First|Second|Third)\s+Book\s+of\s+(?:the\s+)?/i, (_m, n: string) => `${({ first: 1, second: 2, third: 3 } as Record<string, number>)[n.toLowerCase()]} `)
  .replace(/^Books?\s+of\s+(?:the\s+)?/i, '')
  // "the First Epistle to the Corinthians" is 1 Corinthians; "Matthew's Gospel" is Matthew
  .replace(/^(First|Second|Third)\s+Epistle\s+(?:to|of)\s+(?:the\s+)?/i, (_m, n: string) => `${({ first: 1, second: 2, third: 3 } as Record<string, number>)[n.toLowerCase()]} `)
  .replace(/^(\w+)[’']s\s+Gospel$/i, '$1')
  .replace(/^(?:Epistles?|Gospel)\s+(?:to|of)\s+(?:the\s+)?/i, '').replace(/^["“](.*)["”]$/, '$1')

const byName = (s: string) => BOOKS.find(b => b.name.toLowerCase() === s.toLowerCase())
/** The book a work walks through, read from its title ("Genesis", "The Lamentations of Jeremiah", "1 and 2 Kings",
 * "An Outline of Genesis"), with its chip label ("Gen", "Lam", "1–2 Kgs"); none for anything else. */
export function bookOfTitle(title: string): { book: BookMeta; label: string } | null {
  const t = shortTitle(title).replace(/^The\s+/i, '').trim()
  const exact = byName(t)
  if (exact) return { book: exact, label: exact.abbr }
  const pair = /^([1-3])\s+and\s+([1-3])\s+(.+)$/i.exec(t)
  if (pair) {
    const b = byName(`${pair[1]} ${pair[3]}`)
    if (b) return { book: b, label: `${pair[1]}–${pair[2]} ${b.abbr.replace(/^[1-3]\s*/, '')}` }
  }
  // a paired book named once for both ("the Books of the Chronicles"): the first, labelled as the pair
  const both = byName(`1 ${t}`)
  if (both && byName(`2 ${t}`)) return { book: both, label: `1–2 ${both.abbr.replace(/^[1-3]\s*/, '')}` }
  const first = byName(t.split(/\s+/)[0])
  return first ? { book: first, label: first.abbr } : null
}

/** Whether a collection's works are books of the Bible (the Synopsis, Coates's Outlines): chips like the reader's. */
export function worksAreBooks(works: readonly Pick<WorkSummary, 'title' | 'kind'>[]): boolean {
  const walks = works.filter(w => w.kind !== 'introduction')
  return walks.length > 0 && walks.filter(w => bookOfTitle(w.title)).length >= walks.length * 0.8
}

const plural = (n: number, unit: string) => `${n} ${n === 1 ? unit : unit === 'address' ? 'addresses' : unit + 's'}`
/** What a work's sections are called in a count. */
export function unitOf(kind: WorkKind, author?: string): string {
  if (kind === 'letters') return 'letter'
  if (kind === 'addresses') return 'address'
  if (kind === 'outline' && author === 'coates') return 'reading'
  if (kind === 'notes') return 'reading'
  return 'section'
}
export const countOf = (kind: WorkKind, n: number, author?: string) => plural(n, unitOf(kind, author))

/** A collection's line in the library: "66 books, Genesis to Revelation", "34 volumes", "8 addresses". */
export function collectionDetail(c: CollectionSummary, author?: string): string {
  if (c.works.length === 1) return countOf(c.works[0].kind, c.works[0].count, author)
  if (worksAreBooks(c.works)) {
    const books = c.works.map(w => bookOfTitle(w.title)).filter((b): b is NonNullable<typeof b> => !!b)
    return `${plural(books.length, 'book')}, ${books[0].book.name} to ${books[books.length - 1].book.name}`
  }
  return plural(c.works.length, shelfUnit(c.works))
}
/** What the works of a collection are, one by one: short papers and tracts (a few sections each), books of addresses,
 * or volumes. */
function shelfUnit(works: readonly Pick<WorkSummary, 'kind' | 'count'>[]): string {
  if (works.every(w => w.kind === 'papers' && w.count <= 5)) return 'paper'
  if (works.every(w => w.kind === 'addresses')) return 'book'
  return 'volume'
}

/** A letter's line: its date and to whom, as the edition heads it ("To G. V. Wigram · 12 March 1845"). */
export function letterLine(s: Pick<MinistrySectionMeta, 'title' | 'date' | 'to'>): string {
  const to = s.to?.trim() ? (/^to\b/i.test(s.to.trim()) ? s.to.trim() : `To ${s.to.trim()}`) : ''
  return [to, s.date?.trim() ?? ''].filter(Boolean).join(' · ') || s.title
}

/** The year a letter's date names, for grouping; none when it names none. */
export const yearOf = (date?: string) => { const m = date ? /\b(1[6-9]\d\d)\b/.exec(date) : null; return m ? m[1] : '' }

/**
 * A numbered section's short label, for a cell of the grid: "3" for "Chapter 3" or "Genesis 3", "6–8" for "Genesis
 * 6–8", "5, 6" for "Chapters 5, 6"; a letter is its number. Null for a titled piece ("Introduction", "Book 1").
 */
export function cellLabel(title: string, kind: WorkKind, n: number): string | null {
  if (kind === 'letters') return String(n)
  const m = /^(.+?)\s+(\d+(?::\d+)?(?:\s*[–-]\s*\d+(?::\d+)?)?(?:\s*(?:,|and)\s*\d+)*)$/i.exec(title.trim())
  if (!m) return null
  const head = m[1]
  if (!/^chapters?$/i.test(head) && !(/^psalms?$/i.test(head)) && !byName(head)) return null
  return m[2].replace(/\s*-\s*/g, '–').replace(/\s*and\s*/gi, ', ')
}

// ---------- the contents picker ----------

export interface PickerItem {
  n: number
  /** The grid cell's label, or the chip's (a titled piece in a grid). */
  cell: string
  /** Whether the cell is a number (a fixed-width cell) or a titled piece (a chip). */
  numbered: boolean
  /** The list row's title and muted line, and the number set before the title (a letter's). */
  title: string
  detail: string
  lead?: string
}
export interface PickerGroup { label: string; items: PickerItem[] }
export type PickerMode = 'grid' | 'list'
export interface PickerLayout { mode: PickerMode; groups: PickerGroup[] }

/** Consecutive runs of items under the same label. */
function runs(items: readonly PickerItem[], label: (i: number) => string): PickerGroup[] {
  const out: PickerGroup[] = []
  items.forEach((it, i) => {
    const l = label(i)
    const last = out[out.length - 1]
    if (last && last.label === l) last.items.push(it)
    else out.push({ label: l, items: [it] })
  })
  return out
}

/**
 * A section's passage line, unless the title already names it: "Luke 15" under "Notes of a reading at 3, Lonsdale
 * square: Luke 15" would repeat it, as would "1 Timothy 1–2" under "Reading on 1 Timothy 1 and 2" (both chapters
 * named), "Jeremiah 51" under "Jeremiah. Chapter 51", or the whole book under a title that names the book ("Notes on
 * Revelation"). Case, dashes and punctuation are not held against a match.
 */
function passageLine(title: string, passages: readonly Passage[]): string {
  if (!passages.length || titleIsPassage(title)) return ''
  const norm = (x: string) => ` ${fold(x).replace(/[.,;:!?()–-]/g, ' ').replace(/\s+/g, ' ').trim()} `
  const t = norm(title.replace(/\bchapters?\b/gi, ' '))
  const has = (x: string) => t.includes(norm(x))
  const named = passages.every(p => {
    const [b, c1, v1, c2, v2] = p
    const book = BOOKS[b - 1]
    const whole = v1 === 1 && v2 === 0
    const chapters = whole && has(`${book.name} ${c1}`) && (c1 === c2 || t.includes(` ${c2} `))
    return has(formatPassage(p)) || chapters || (whole && c1 === 1 && c2 === book.chapters && has(book.name))
  })
  return named ? '' : formatPassages(passages)
}

/** A title for telling repeats apart: case, punctuation and spacing are not differences ("square. Hebrews 5" and "square Hebrews 5"). */
const sameTitle = (x: string) => fold(x).replace(/[.,;:!?—–-]/g, ' ').replace(/\s+/g, ' ').trim()
const capital = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

/**
 * The list's rows read against their group: a row that repeats its group's label ("Detached memoranda from a reading
 * meeting: The world seeth me no more" under "Detached memoranda from a reading meeting") loses the label and its
 * separator (": ", " — ", ". ", " "); a bare number left over is "Reading 1" (the work's unit), "1 and 2" is "Sections
 * 1 and 2"; a title that is the label and nothing else stays as printed. A lone row under a label it repeats needs no
 * label. Repeated rows (the same title and detail under the same label) are told apart in the detail: "(continued)"
 * for a pair side by side, else " · 2", " · 3".
 */
function polish(groups: PickerGroup[], sections: readonly MinistrySectionMeta[], kind: WorkKind, author?: string): PickerGroup[] {
  const unit = capital(unitOf(kind, author))
  for (const g of groups) {
    if (!g.label) continue
    const label = fold(g.label)
    let repeats = 0
    for (const it of g.items) {
      const t = it.title.trim()
      if (!fold(t).startsWith(label)) continue
      const m = /^(?:\s*[:;.—–-]\s+|\s+)(.+)$/.exec(t.slice(g.label.length))
      if (t.slice(g.label.length).trim() !== '' && !m) continue
      repeats++
      const rest = m ? m[1].trim() : ''
      if (!rest) continue
      it.title = /^\d+$/.test(rest) ? `${unit} ${rest}` : /^\d+(?:\s*(?:,|and|–|-)\s*\d+)+$/.test(rest) ? `${unit}s ${rest}` : capital(rest)
      // the passage is read against the row as shown, label and all: "John 1" is kept under "Section 1" (it was in "On
      // the Gospel of John 1"), the whole of 1 Peter is not under "Readings on 1 Peter"
      const s = sections[it.n - 1]
      it.detail = [s.subtitle, passageLine(`${g.label} ${it.title}`, s.passages)].filter(Boolean).join(' · ')
    }
    if (g.items.length === 1 && repeats) g.label = ''
  }
  const merged: PickerGroup[] = []
  for (const g of groups) {
    const last = merged[merged.length - 1]
    if (last && last.label === g.label) last.items.push(...g.items)
    else merged.push(g)
  }
  // a repeat is the same row under the same label: "Reading 1" under two parts is told apart by them
  const rows = merged.flatMap(g => g.items.map(it => ({ it, key: `${sameTitle(g.label)}\u0000${sameTitle(it.title)}\u0000${sameTitle(it.detail)}` })))
  const total = new Map<string, number>()
  for (const r of rows) total.set(r.key, (total.get(r.key) ?? 0) + 1)
  const seen = new Map<string, number>()
  rows.forEach((r, i) => {
    const nth = (seen.get(r.key) ?? 0) + 1
    seen.set(r.key, nth)
    if (nth === 1) return
    const pair = total.get(r.key) === 2 && i > 0 && rows[i - 1].key === r.key
    r.it.detail = pair ? [r.it.detail, '(continued)'].filter(Boolean).join(' ') : `${r.it.detail} · ${nth}`.trimStart()
  })
  return merged
}

/**
 * How a work's contents are offered: a grid of numbers where its sections are numbered (Coates's "Chapter 1" to
 * "Chapter 50", the Synopsis's "Genesis 1", letters by number), its titled pieces as chips in their place; a list of
 * titles grouped under their `part` for the rest (a volume of papers); numbers under several parts are grouped by
 * part. A volume of letters is a list by number, grouped by year, each named by its recipient and date with its
 * topics under it. A list's row carries the section's subtitle and passage under it, the passage left out where the
 * title names it; its title loses the group label it repeats, and repeated rows are numbered in the detail (polish).
 * `author` names the unit a bare number is given ("Reading 1" in Darby's notes).
 */
export function pickerLayout(kind: WorkKind, sections: readonly MinistrySectionMeta[], author?: string): PickerLayout {
  const items: PickerItem[] = sections.map((s, i) => {
    const n = i + 1
    const cell = cellLabel(s.title, kind, n)
    const passage = passageLine(s.title, s.passages)
    return kind === 'letters'
      ? { n, cell: String(n), numbered: true, title: letterLine(s), detail: s.subtitle ?? '', lead: String(n) }
      : { n, cell: cell ?? s.title, numbered: cell !== null, title: s.title, detail: [s.subtitle, passage].filter(Boolean).join(' · ') }
  })
  // an undated letter stays with the year before it rather than breaking the year in two
  let year = ''
  const years = kind === 'letters' ? sections.map(s => (year = yearOf(s.date) || year)) : []
  const byYear = new Set(years.filter(Boolean)).size > 1
  const numbered = items.filter(it => it.numbered).length
  const grid = kind !== 'letters' && numbered >= 2 && numbered >= items.length * 0.6
  // a piece of several sections is a group; a piece of one is a row of its own, under no heading
  const partOf = (i: number) => {
    const p = sections[i].part ?? ''
    return p && sections.filter(s => s.part === p).length > 1 ? p : ''
  }
  // numbered sections of several pieces (a volume's "Chapter 1" under each of its papers) keep their pieces as groups
  const parted = sections.some((_, i) => partOf(i))
  if (grid) return { mode: 'grid', groups: parted ? runs(items, partOf) : [{ label: '', items }] }
  if (byYear) return { mode: 'list', groups: runs(items, i => years[i]) }
  return { mode: 'list', groups: kind === 'letters' ? runs(items, partOf) : polish(runs(items, partOf), sections, kind, author) }
}

/** The works of a collection as the picker's first level: book chips by testament, or a list of volumes. */
export interface ShelfItem { id: string; label: string; title: string; detail: string; testament?: 'OT' | 'NT' }
export function shelfItems(works: readonly WorkSummary[], author?: string): { books: boolean; groups: { label: string; items: ShelfItem[] }[] } {
  const books = worksAreBooks(works)
  const items: ShelfItem[] = works.map(w => {
    const b = w.kind === 'introduction' ? null : bookOfTitle(w.title)
    return { id: w.id, label: b?.label ?? shortTitle(w.title), title: w.title, detail: countOf(w.kind, w.count, author), testament: b?.book.testament }
  })
  if (!books) return { books, groups: [{ label: '', items }] }
  // an introduction leads, unlabelled; works that are not one book ("The Building of the Wall") follow the
  // testaments as "Other"
  const label = (t: 'OT' | 'NT' | undefined, intro: boolean) => intro ? '' : t === 'OT' ? 'Old Testament' : t === 'NT' ? 'New Testament' : 'Other'
  const order = ['', 'Old Testament', 'New Testament', 'Other']
  const groups: { label: string; items: ShelfItem[] }[] = []
  for (const [i, it] of items.entries()) {
    const l = label(it.testament, works[i].kind === 'introduction')
    const g = groups.find(x => x.label === l)
    if (g) g.items.push(it); else groups.push({ label: l, items: [it] })
  }
  groups.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
  return { books, groups }
}

/**
 * Whether a work opens on its contents rather than in the reader. A book of the Bible (the Synopsis, Coates's
 * Outlines) reads at once, as a Bible book does; a volume of papers, addresses or letters shows its list first, so
 * its pieces can be seen and chosen; a work of one section has nothing to list.
 */
export const opensToContents = (works: readonly Pick<WorkSummary, 'title' | 'kind'>[], work: Pick<WorkSummary, 'count'>) => !worksAreBooks(works) && work.count > 1

/** The contents page's header (the volume short beside its fellows) and its muted line: the collection, or the
 * author where the collection is the work itself, and the count ("Collected Writings · 41 sections"). */
export function contentsHeading(shelf: Shelf | null, work: Pick<WorkSummary, 'title' | 'kind' | 'count'>, author?: string): { title: string; line: string } {
  const many = !!shelf && shelf.collection.works.length > 1
  const count = countOf(work.kind, work.count, author)
  return { title: many ? shortTitle(work.title) : work.title, line: [many ? shelf.collection.title : shelf?.author.name ?? '', count].filter(Boolean).join(' · ') }
}

/** The "‹ All books" link back to a collection's works. */
export const worksNoun = (works: readonly Pick<WorkSummary, 'title' | 'kind' | 'count'>[]) => worksAreBooks(works) ? 'books' : `${shelfUnit(works)}s`

/**
 * The toolbar's title for a section, short enough for a phone: "Genesis 3" (Coates's "Chapter 3" of An Outline of
 * Genesis), "Genesis 6–8" (the Synopsis), "Genesis · Introduction", "Letter 12", a paper's own title.
 */
export function toolbarTitle(work: Pick<WorkSummary, 'title' | 'kind'>, section: Pick<MinistrySectionMeta, 'title' | 'part'> | undefined, n: number): string {
  if (work.kind === 'letters') return `Letter ${n}`
  if (!section) return shortTitle(work.title)
  const cell = cellLabel(section.title, work.kind, n)
  const book = bookOfTitle(work.title)
  if (cell && /^chapters?\s/i.test(section.title)) return book ? `${book.book.name} ${cell}` : section.part ? `${section.part} · ${section.title}` : section.title
  if (cell) return section.title
  if (book && work.kind !== 'introduction') return `${shortTitle(work.title).replace(/^The\s+/i, '')} · ${section.title}`
  return section.title
}

/**
 * A section heading's small line: collection, work and part ("Synopsis · Genesis", "Collected Writings · Volume 1 ·
 * The Church"), the collection left out where the work's title already names it ("An Outline of Genesis" in the
 * Outlines, "Letters, volume 1" in the Letters) or is the work itself.
 */
export function headingLine(collection: string | undefined, work: string, part?: string): string {
  collection = collection?.replace(/\s+of\s+the\s+Books\s+of\s+the\s+Bible$/i, '')
  const stem = fold(collection ?? '').replace(/s$/, '').trim()
  const named = !stem || fold(work).includes(stem)
  return [named ? '' : collection, work, part].filter(Boolean).join(' · ')
}

// ---------- the reading position, per work, on the device ----------

export interface WorkPosition {
  n: number
  /** The first paragraph in view, and how far into it the view begins (px). */
  p: number
  dy: number
  /** When it was kept (ms since the epoch): the latest is the library's "Continue reading". */
  t: number
  /** Shown by "Continue reading" before the work's contents are in. */
  title?: string
  section?: string
}
export type Positions = Record<string, WorkPosition>
export const POSITIONS_KEPT = 200
export const positionKey = (author: string, work: string) => `${author}/${work}`

/** Stored positions, whatever was stored: anything malformed is dropped. */
export function parsePositions(raw: string | null | undefined): Positions {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: Positions = {}
    for (const [k, p] of Object.entries(v as Record<string, Partial<WorkPosition>>)) {
      if (!/^[^/]+\/[^/]+$/.test(k) || !p || typeof p !== 'object') continue
      const n = Number(p.n), para = Number(p.p ?? 0), dy = Number(p.dy ?? 0), t = Number(p.t ?? 0)
      if (!Number.isInteger(n) || n < 1 || !Number.isInteger(para) || para < 0 || !Number.isFinite(dy) || !Number.isFinite(t)) continue
      out[k] = { n, p: para, dy: Math.max(0, dy), t, ...(typeof p.title === 'string' ? { title: p.title } : null), ...(typeof p.section === 'string' ? { section: p.section } : null) }
    }
    return out
  } catch { return {} }
}

/** A place re-reported unchanged is kept as it was (no write) unless it is older than this: then it is touched, so the
 * work being read stays the latest. */
export const TOUCH_MS = 60_000
/** Keep `pos` for `key`; the oldest go once more than `cap` works are kept. Unchanged input comes back as is. */
export function rememberPosition(ps: Positions, key: string, pos: WorkPosition, cap = POSITIONS_KEPT): Positions {
  const old = ps[key]
  if (old && old.n === pos.n && old.p === pos.p && Math.round(old.dy) === Math.round(pos.dy) && old.title === pos.title && old.section === pos.section && pos.t - old.t < TOUCH_MS) return ps
  const next: Positions = { ...ps, [key]: { ...pos, dy: Math.round(pos.dy) } }
  const keys = Object.keys(next)
  if (keys.length > cap) keys.sort((a, b) => next[a].t - next[b].t).slice(0, keys.length - cap).forEach(k => { delete next[k] })
  return next
}

/** The latest kept position: where "Continue reading" goes. */
export function latestPosition(ps: Positions): { author: string; work: string; pos: WorkPosition } | null {
  let best: string | null = null
  for (const k of Object.keys(ps)) if (!best || ps[k].t > ps[best].t) best = k
  if (!best) return null
  const [author, work] = best.split('/')
  return { author, work, pos: ps[best] }
}

// ---------- the deep link ----------

/** The verse a reading was opened from ("1.1.26", "45.15.13-14"): "Back to the verse" returns there. */
export interface FromVerse { book: number; chapter: number; v1: number; v2?: number }
export function parseFrom(s: string | undefined | null): FromVerse | null {
  const m = s ? /^(\d{1,2})\.(\d{1,3})\.(\d{1,3})(?:-(\d{1,3}))?$/.exec(s.trim()) : null
  if (!m) return null
  const [book, chapter, v1] = [+m[1], +m[2], +m[3]]
  const v2 = m[4] ? +m[4] : undefined
  const b = BOOKS[book - 1]
  if (!b || chapter < 1 || chapter > b.chapters || v1 < 1 || (v2 !== undefined && v2 < v1)) return null
  return v2 !== undefined && v2 > v1 ? { book, chapter, v1, v2 } : { book, chapter, v1 }
}
export const formatFrom = (f: FromVerse) => `${f.book}.${f.chapter}.${f.v1}${f.v2 && f.v2 > f.v1 ? `-${f.v2}` : ''}`
export const fromRef = (f: FromVerse): Ref => ({ book: f.book, chapter: f.chapter, v1: f.v1, v2: f.v2 })
/** "Genesis 1:26", "Romans 15:13–14"; "Gen 1:26" where space is short. */
export const fromLabel = (f: FromVerse, style: 'full' | 'abbr' = 'full') => formatVerseRuns(f.book, f.chapter, f.v2 ? Array.from({ length: f.v2 - f.v1 + 1 }, (_, i) => f.v1 + i) : [f.v1], style)

const int = (s: string | undefined, min: number) => { if (!s || !/^\d+$/.test(s)) return undefined; const n = parseInt(s, 10); return n >= min ? n : undefined }
/** The reader's params: `n` a 1-based section, `p` a paragraph (index into paragraphsOf(section.text)), `from` a verse. */
export interface ReaderLink { n?: number; p?: number; from: FromVerse | null }
export function readerLink(params: { n?: string; p?: string; from?: string }): ReaderLink {
  return { n: int(params.n, 1), p: int(params.p, 0), from: parseFrom(params.from) }
}

/**
 * Where the reader lands: the linked section and paragraph (washed once), else the linked section at the place kept for
 * it when it is the one being read, else the kept place, else the top of the first section. `count` clamps a section
 * past the end (a work shortened by a data rebuild) once the contents are in.
 */
export function landing(link: ReaderLink, kept: WorkPosition | null | undefined, count?: number): { n: number; p: number; dy: number; wash: boolean } {
  const clamp = (n: number) => count ? Math.min(Math.max(1, n), count) : Math.max(1, n)
  if (link.n !== undefined) {
    if (link.p !== undefined) return { n: clamp(link.n), p: link.p, dy: 0, wash: true }
    if (kept && kept.n === link.n) return { n: clamp(link.n), p: kept.p, dy: kept.dy, wash: false }
    return { n: clamp(link.n), p: 0, dy: 0, wash: false }
  }
  if (kept) return { n: clamp(kept.n), p: kept.p, dy: kept.dy, wash: false }
  return { n: 1, p: 0, dy: 0, wash: false }
}

/**
 * The paragraph at the top of the view and how far into it the view begins, from where each paragraph starts (in
 * the scroll's coordinates, `tops[i]` undefined until laid out). `lead` px of the view count as above the reading line.
 */
export function paragraphAt(tops: readonly (number | undefined)[], scrollY: number, lead = 40): { p: number; dy: number } {
  // the lowest top at or above the line; a figure's rows need not stand in slot order (a harmony read in parallel
  // follows Mark, its slots the page), so every top is weighed, the first of equals kept (a pericope's passages)
  let p = -1
  for (let i = 0; i < tops.length; i++) {
    const t = tops[i]
    if (t === undefined || t > scrollY + lead) continue
    if (p < 0 || t > tops[p]!) p = i
  }
  if (p < 0) return { p: 0, dy: 0 }
  return { p, dy: Math.max(0, Math.round(scrollY - tops[p]!)) }
}

// ---------- search ----------

export interface WorkHit { author: LibraryAuthor; collection: CollectionSummary; work: WorkSummary }
/** Works whose title (or its collection's) holds every word of `query` as a word start: "letters 2", "collected 12". */
export function searchWorks(library: Library | null | undefined, query: string, limit = 20): WorkHit[] {
  const words = fold(query).match(/[a-z0-9]+/g) ?? []
  if (!library || !words.length || !/[a-z]/.test(words.join(''))) return []
  const res = words.map(w => new RegExp(`\\b${w}${/^\d+$/.test(w) ? '\\b' : ''}`))
  const out: WorkHit[] = []
  for (const author of library.authors) for (const collection of author.collections) for (const work of collection.works) {
    const hay = fold(`${collection.title} ${work.title}`)
    if (res.every(r => r.test(hay))) out.push({ author, collection, work })
    if (out.length >= limit) return out
  }
  return out
}

/** The server's title hits the companion's own search has not already listed (the same author, work and section). */
export function newSectionHits(hits: readonly SectionHit[], places: readonly Place[]): SectionHit[] {
  const seen = new Set(places.map(p => `${p.author}/${p.work.id}/${p.n}`))
  return hits.filter(h => !seen.has(`${h.author}/${h.work.id}/${h.n}`))
}
/**
 * A title hit's detail line, as a companion place's: the author, where the section sits ("Synopsis · Romans",
 * "Collected Writings 34: Miscellaneous 3", a letter's date and recipient), and its passage when the title is not one.
 */
export function sectionHitDetail(hit: SectionHit, library: Library | null | undefined): string {
  const author = library?.authors.find(a => a.id === hit.author)
  const short = author?.short ?? MINISTRY_AUTHORS.find(a => a.id === hit.author)?.short ?? AUTHORS.find(a => a.id === hit.author)?.short ?? hit.author
  const collection = author?.collections.find(c => c.id === hit.work.collection)
  const where = hit.work.kind === 'letters' && (hit.date || hit.to) && !fold(hit.title).startsWith('to ') ? letterLine(hit) : hit.part
  const passage = hit.passages.length && !titleIsPassage(hit.title) ? formatPassages(hit.passages) : ''
  return [short, headingLine(collection?.title, hit.work.title, where), passage].filter(Boolean).join(' · ')
}
