/**
 * Figures: what a printed page carries beside its text and a text file cannot, a table, passages set in parallel
 * columns, a diagram. The converters restore them as data (tools/ministry_convert.py `FIGURES`, from transcriptions in
 * tools/ministry_figures/; the inventory is data/ministry/FIGURES.md), the section carries them in `figures`, and the
 * library reader draws them (client/src/components/Figures.tsx) in the app's table style, every reference a link.
 * Each row of a figure (a passage of a harmony, a table's row, a chart's column) is a unit of the verse index
 * (`figureRows`): it is addressed as the section's paragraphs are, by a slot after them, so a link, a landing and the
 * wash on arrival treat it as one more paragraph.
 */
import type { Passage } from './companion.js'

export type Figure = ParallelsFigure | TableFigure | DiagramFigure | ChartFigure

interface FigureBase {
  /** Its transcription's name (tools/ministry_figures/<id>.txt): the same figure however often it is restored. */
  id: string
  /** Where it stands: after this paragraph of the section's text (an index into paragraphsOf); absent, after the last. */
  after?: number
  /** Its heading, when the page gives it one. */
  title?: string
  /** One line under it: where it is printed and where it was taken from. */
  source: string
}

/**
 * Passages of several books in parallel columns, each column in its own book's order and numbered through the figure,
 * each passage pointing to its parallels by number (Darby's "Relative order of three synoptical Gospels"). `items` are
 * in the page's order: page by page, and within a page column by column.
 */
export interface ParallelsFigure extends FigureBase {
  kind: 'parallels'
  columns: { title: string; book: number }[]
  items: ParallelItem[]
}
export type ParallelItem = ParallelEntry | ParallelNote

export interface ParallelEntry {
  /** The passage's number, printed beside it; the numbers run on from column to column. */
  n: number
  col: number
  /** The printed page it stands on. */
  page?: number
  /** The reference as the column prints it, without the book: "1:1–17", "3" (a chapter), "5, 6, 7", "19:27–20:19". */
  ref: string
  /** What the page prints instead, where it misprints the reference ("17:5–7" for Mark 16:5–7). */
  printed?: string
  /** `ref` in full; null where the page prints none. */
  passage: Passage | null
  /**
   * The words, in runs: each run after the small figures that go with it, the numbers of its parallels in the other
   * columns (`[0]`: none; `[]`: none printed), `printed` the figures the page has where it misprints them. `<i>` and
   * `<sc>` as printed.
   */
  parts: { see: number[]; text: string; printed?: number[] }[]
}

/** A line the page prints in a column where it has no passage ("Only in Luke"). */
export interface ParallelNote { col: number; page?: number; note: string }

/** A plain table: its column headings (empty for a column under the heading before it) and rows of cells, text with
 *  `<i>`. */
export interface TableFigure extends FigureBase {
  kind: 'table'
  /**
   * `list`: a table of references (an index of names and places), whose rows count for every verse they name after all
   * commentary; else the rows are argument (a prayer beside its answer) and count as a paragraph's references do.
   */
  index?: 'list'
  /** Per row, the verses it quotes without naming them ("Psalm 132:9; Psalm 132:16"), for the index. */
  rowRefs?: string[]
  columns: string[]
  rows: string[][]
  /** Per column; left where absent. */
  align?: ('left' | 'right')[]
  /** Rows a light rule stands before (a subtotal). */
  rules?: number[]
  /** Headings across the table before row `at` ("Used in quotations."). */
  groups?: { at: number; label: string }[]
  /** The totals, under a light rule. */
  foot?: string[]
  /** The page's notes to the table, in the order of their callers ("*", "†") in the cells. */
  notes?: string[]
}

export const isEntry = (it: ParallelItem): it is ParallelEntry => 'n' in it

/** The figure's passages by number. */
export function entriesOf(fig: ParallelsFigure): Map<number, ParallelEntry> {
  const out = new Map<number, ParallelEntry>()
  for (const it of fig.items) if (isEntry(it)) out.set(it.n, it)
  return out
}

/** Every number an entry points to, in the order printed, once each; 0 (no parallel) left out. */
export const seeOf = (e: ParallelEntry): number[] => [...new Set(e.parts.flatMap(p => p.see).filter(n => n > 0))]

/**
 * An entry's parallels, per column of the figure: the entries its figures point to, in their column's order; a column
 * it names no parallel in is empty.
 */
export function parallelsOf(fig: ParallelsFigure, e: ParallelEntry, byN = entriesOf(fig)): ParallelEntry[][] {
  const cols: ParallelEntry[][] = fig.columns.map(() => [])
  for (const n of seeOf(e)) {
    const p = byN.get(n)
    // a figure may point within its own column too (Luke 12:8–12 to Luke 21:5–38)
    if (p && p !== e) cols[p.col].push(p)
  }
  return cols.map(c => c.sort((a, b) => a.n - b.n))
}

/** An entry has no parallel at all: every run is marked 0, or none points anywhere. */
export const alone = (e: ParallelEntry) => seeOf(e).length === 0

/** Where a tap on a passage goes: its first chapter, and its verses when it stays within one chapter. */
export function refOfPassage(p: Passage): { book: number; chapter: number; v1?: number; v2?: number } {
  const [book, c1, v1, c2, v2] = p
  if (v1 === 1 && v2 === 0) return { book, chapter: c1 }
  if (c1 === c2 && v2 >= v1) return { book, chapter: c1, v1, v2: v2 > v1 ? v2 : undefined }
  return { book, chapter: c1, v1 }
}

/** A figure's items by printed page, each page's items by column: the page as the book sets it. */
export function pagesOf(fig: ParallelsFigure): { page: number | undefined; cols: ParallelItem[][] }[] {
  const out: { page: number | undefined; cols: ParallelItem[][] }[] = []
  for (const it of fig.items) {
    let pg = out[out.length - 1]
    if (!pg || pg.page !== it.page) out.push(pg = { page: it.page, cols: fig.columns.map(() => []) })
    pg.cols[it.col].push(it)
  }
  return out
}

/**
 * A drawing (a plan, a sketch map), redrawn from the page's figure as shapes in a coordinate box `width` × `height`
 * and drawn in the theme's colours, never a picture of the page. `alt` says what it shows, in words.
 */
export interface DiagramFigure extends FigureBase {
  kind: 'diagram'
  width: number
  height: number
  alt: string
  shapes: Shape[]
  /** At most this wide on screen (px): a small figure is not blown up to the column. */
  maxWidth?: number
  /** At least this many px per unit: a large map keeps its lettering legible and scrolls sideways instead. */
  minScale?: number
}
/** The theme's inks: the text, the muted grey, the accent, the soft accent and the card as fills. */
export type Tone = 'ink' | 'muted' | 'accent' | 'soft' | 'card'
export type Shape =
  /** A line through the points (x, y, x, y …); `closed` joins the last to the first. */
  | { t: 'line'; points: number[]; closed?: boolean; dash?: 'dash' | 'dot'; weight?: number; tone?: Tone; fill?: Tone; arrow?: boolean }
  /** An SVG path (curves: coastlines). */
  | { t: 'path'; d: string; dash?: 'dash' | 'dot'; weight?: number; tone?: Tone; fill?: Tone }
  | { t: 'dot'; x: number; y: number; r?: number; tone?: Tone }
  /** Text at (x, y), its baseline there; `lines` more lines under it; `caps` in small capitals, as the page letters. */
  | { t: 'text'; x: number; y: number; text: string; lines?: string[]; size?: number; pitch?: number; anchor?: 'start' | 'middle' | 'end'; italic?: boolean; caps?: boolean; tone?: Tone; rotate?: number }

/**
 * A chart of periods against passages (Darby's two charts of the Revelation): the periods down the side (`bands`), the
 * passages across (`columns`), and in each column the page's words where it sets them, a column's cross lines marking
 * where a thing begins or ends. Read as a list, column by column, each note under the period it stands in; drawn as
 * printed on request (`shapes` the rules and headings, `blocks` the words, in the chart's units).
 */
export interface ChartFigure extends FigureBase {
  kind: 'chart'
  width: number
  height: number
  bands: { y0: number; y1: number; label: string }[]
  columns: { x0: number; x1: number; head: string; ref?: string; passage?: Passage }[]
  /** The words, as the page breaks their lines (`ChartBlock`). */
  blocks: ChartBlock[]
  shapes: Shape[]
  /** The blocks' type size and line pitch, in the chart's units; `caps` lettered in capitals. */
  size: number
  pitch: number
  caps?: boolean
  note?: string
}

/**
 * Words in a chart, as the page breaks their lines, `<i>` italic: in column `col` (to `to`, when they span several), the
 * first line's baseline at `y`, centred or set from the column's left (`align`); "—" a short rule between two notes.
 * `rotate`: set up the column from its foot at `y`, the first line leftmost (the page's turned lettering). `ref`: words
 * on a passage of their own ("Chapters 4 and 5" across the first three columns), `head` their heading.
 */
export interface ChartBlock { col: number; to?: number; y: number; lines: string[]; rotate?: boolean; size?: number; pitch?: number; align?: 'left' | 'middle'; ref?: string; passage?: Passage; head?: boolean }

/** A block's words as running text: its lines joined, a word broken at a line end mended, "—" parting two notes. */
export function blockText(lines: readonly string[]): string[] {
  const out: string[] = []
  let cur = ''
  for (const l of lines) {
    if (l === '—') { if (cur) out.push(cur); cur = ''; continue }
    cur = !cur ? l : /[a-z]-$/.test(cur) && /^(<i>)?[a-z]/.test(l) ? cur.slice(0, -1) + l : `${cur} ${l}`
  }
  if (cur) out.push(cur)
  return out
}

/** The period a block begins in. */
export const bandOf = (fig: ChartFigure, y: number) => fig.bands.find(b => y >= b.y0 && y < b.y1) ?? fig.bands[fig.bands.length - 1]

/**
 * How wide a table's columns are drawn (px), for a table `width` px wide at type size `fs`: a column whose cells are all
 * short (figures, references) its longest cell's width; the rest share what is left, by their longest cell, at least `min` each.
 * `scroll`: the table cannot fit and is set at `total` px, scrolling sideways.
 */
export function tableWidths(fig: Pick<TableFigure, 'columns' | 'rows' | 'foot'>, width: number, fs: number, min = 84): { widths: number[]; total: number; scroll: boolean } {
  const plainLen = (t: string) => t.replace(/<[^>]+>/g, '').length
  const cols = fig.columns.map((_, i) => Math.max(...fig.rows.map(r => plainLen(r[i] ?? '')), plainLen(fig.foot?.[i] ?? '')))
  // a heading is set in small capitals, tracked: wider a letter than the figures under it
  const heads = fig.columns.map(h => Math.max(0, ...h.split(/\s+/).map(w => w.length)) * 1.15)
  const em = fs * 0.56, pad = 12
  // figures and references ("Rom. 15:12") keep their width; the words share what is left
  const short = cols.map(n => n <= 16)
  const fixed = cols.map((n, i) => short[i] ? Math.ceil(Math.max(n, heads[i], 2) * em + pad) : 0)
  const used = fixed.reduce((a, b) => a + b, 0)
  const flex = cols.map((n, i) => short[i] ? 0 : Math.min(n, 60))
  const weight = flex.reduce((a, b) => a + b, 0)
  const left = width - used
  const flexCount = flex.filter(Boolean).length
  if (left >= flexCount * min) {
    const widths = cols.map((_, i) => short[i] ? fixed[i] : Math.floor(left * flex[i] / (weight || 1)))
    // all short: the first column takes the slack, so the table spans its rules
    if (!flexCount) widths[0] += left
    // no column narrower than `min` while another could give
    return { widths, total: width, scroll: false }
  }
  const widths = cols.map((_, i) => short[i] ? fixed[i] : min)
  return { widths, total: widths.reduce((a, b) => a + b, 0), scroll: true }
}

/** A chart read as a list: each column, and after it any passage its blocks name of their own ("Chapters 4 and 5"). */
export function chartSections(fig: ChartFigure): { head: string; ref?: string; passage?: Passage; blocks: ChartBlock[] }[] {
  const out: { head: string; ref?: string; passage?: Passage; blocks: ChartBlock[] }[] = []
  fig.columns.forEach((col, i) => {
    out.push({ head: col.head, ref: col.ref, passage: col.passage, blocks: fig.blocks.filter(b => b.col === i && !b.ref) })
    for (const ref of new Set(fig.blocks.filter(b => b.ref && (b.to ?? b.col) === i).map(b => b.ref!))) {
      const own = fig.blocks.filter(b => b.ref === ref)
      out.push({ head: '', ref, passage: own.find(b => b.passage)?.passage, blocks: own.filter(b => !b.head) })
    }
  })
  return out.filter(s => s.ref || s.head || s.blocks.length)
}

const untag = (t: string) => t.replace(/<[^>]+>/g, '')

/**
 * A row of a figure as the verse index reads it. `text`: its words as they read, plain ("A Mercy-seat · Rom. 3:25",
 * "Mark 6:30–44 · Matthew 14:13–21 · Luke 9:10–17 — (On twelve’s return) goes into desert—feeds 5,000."); `passages`:
 * what the row is on, where the figure says it outright (a harmony's passage, a chart's column), with `at` its place in
 * `text`; else the references in `text` are read (a table's row) and, for an argument table, `extra` (the verses a row
 * quotes without naming); `reference`: a row of a table of references, counted after all commentary.
 */
export interface FigureRow { fig: number; text: string; reference: boolean; passages: Passage[]; at?: [number, number]; extra?: string }

/** A section's figure rows in order: the n-th is addressed as paragraph `paragraphs + n` (see `rowSlot`). */
export function figureRows(figures: readonly Figure[]): FigureRow[] {
  const out: FigureRow[] = []
  figures.forEach((f, fig) => {
    if (f.kind === 'parallels') {
      const byN = entriesOf(f)
      for (const e of f.items) {
        if (!isEntry(e)) continue
        const own = `${f.columns[e.col].title} ${e.ref}`.trim()
        const others = parallelsOf(f, e, byN).flat().filter(x => x.passage).map(x => `${f.columns[x.col].title} ${x.ref}`)
        const words = e.parts.map(p => untag(p.text)).join(' ')
        const text = [own, ...others].join(' · ') + (words ? ` — ${words}` : '')
        out.push({ fig, text, reference: true, passages: e.passage ? [e.passage] : [], at: [0, own.length] })
      }
    } else if (f.kind === 'table') {
      f.rows.forEach((r, i) => out.push({ fig, text: r.map(untag).filter(Boolean).join(' · '), reference: f.index === 'list', passages: [], extra: f.rowRefs?.[i] || undefined }))
    } else if (f.kind === 'chart') {
      for (const s of chartSections(f)) {
        const head = s.ref ?? s.head
        const words = s.blocks.flatMap(b => blockText(b.lines)).map(untag).join(' ')
        out.push({ fig, text: head + (words ? ` — ${words}` : ''), reference: true, passages: s.passage ? [s.passage] : [], at: s.passage ? [0, head.length] : undefined })
      }
    }
  })
  return out
}

/** The slot of a section's k-th figure row: after its `paragraphs` paragraphs. */
export const rowSlot = (paragraphs: number, k: number) => paragraphs + k

/** How many rows of a figure are index units (and slots): a harmony's passages, a table's rows, a chart's list sections. */
export function rowCount(f: Figure): number {
  return f.kind === 'parallels' ? f.items.filter(isEntry).length : f.kind === 'table' ? f.rows.length : f.kind === 'chart' ? chartSections(f).length : 0
}

// ---------- a harmony read in parallel ----------

/**
 * One row of a harmony read in parallel: a pericope, the passages Darby's figures set against each other, one cell per
 * column (Matthew, Mark, Luke). A cell holds two passages where the figures give two (Mark 4:1–34 and 6:1–16 against
 * Matthew 13); a passage whose runs point to different pericopes stands in each (Mark 3:21–35: the blasphemy, then His
 * brethren).
 */
export interface HarmonyRow {
  /** Per column, the passages, in their column's order; empty where that Gospel has none. */
  cells: ParallelEntry[][]
  /** Darby's words for the row: the lead passage's runs that belong here (`<i>`, `<sc>` as printed). */
  subject: string
  /** Whose words the subject is: Mark's first passage, else Matthew's, else Luke's. */
  lead: ParallelEntry
  /** How many Gospels share it: 3 triple tradition, 2 double, 1 one alone. */
  share: 1 | 2 | 3
  /** Passages the row's figures name that stand in other rows: Darby's "compare", kept as links. */
  compare: ParallelEntry[]
  /** The page's column notes printed just before the row's passage ("Only in Luke"). */
  notes: string[]
}

/** A one-way figure left as a comparison: it names passages in several rows, or its row stands elsewhere in Mark's
 *  order, or its row has no Mark passage and the passage it names points elsewhere. */
export interface OneWay { from: number; to: number[]; why: 'several rows' | 'out of order' | 'not returned' }

export interface Harmony {
  rows: HarmonyRow[]
  /** Rows where one Gospel holds more than one passage, or a passage stands in more than one row. */
  ambiguous: HarmonyRow[]
  /** One-way figures taken as parallels (`joined`) and left as "compare" (`kept`). */
  joined: { from: number; to: number[] }[]
  kept: OneWay[]
}

/**
 * The harmony read in parallel (`Harmony`), from Darby's figures alone.
 *
 * Grouping. The figures stand before runs of a passage's words, so a run is the unit: a passage whose runs point to
 * different pericopes (Mark 3:21–35) stands in each of their rows. Two runs are linked when each passage names the
 * other (a returned figure). A run whose figures are all one-way is Darby comparing, unless it stands in sequence: its
 * figures all name one row, and either that row's Mark passage lies between the Mark passages of the rows its own
 * Gospel's neighbours stand in (Matthew 8:28–34, after 8:18–27, against Mark 4:35–41), or the passage it names prints
 * no figures at all (Matthew 15:1–20). A figure within one Gospel (Luke 12:8–12 to 21:5–38) never joins. A run with no
 * figure (0) goes with the next linked run of its passage, else the one before; a passage with no link is a row alone.
 *
 * Order. Rows follow Mark, "the most strictly chronological". A passage in a row without Mark takes the place of the
 * nearest passage before it in its own Gospel that stands in that Gospel's sequence (the longest run of its rows agreeing
 * with Mark's order); the row stands at the later of its passages' places, so Luke's journey to Jerusalem stays one run
 * after Mark 9:33–50 and the Sermon on the Mount stands where Luke sets his sermon. Page notes stand before the row of
 * the passage printed next after them.
 */
export function harmonyOf(fig: ParallelsFigure): Harmony {
  const byN = entriesOf(fig)
  const entries = [...byN.values()].sort((a, b) => a.n - b.n)
  const MARK = fig.columns.findIndex(c => c.book === 41)
  // runs: `${n}:${i}`; a run's figures, other columns only
  const runsOf = (e: ParallelEntry) => e.parts.map((_, i) => `${e.n}:${i}`)
  const figsOf = (e: ParallelEntry, i: number) => [...new Set(e.parts[i].see.filter(n => n > 0 && n !== e.n && byN.get(n) && byN.get(n)!.col !== e.col))]
  const names = (a: ParallelEntry, b: number) => a.parts.some(p => p.see.includes(b))
  const blank = (e: ParallelEntry) => e.parts.every(p => !p.see.length)

  const parent = new Map<string, string>()
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r }
  const union = (a: string, b: string) => { parent.set(find(a), find(b)) }
  for (const e of entries) for (const r of runsOf(e)) parent.set(r, r)

  // 1. returned figures
  const linked = new Set<string>()
  for (const a of entries) a.parts.forEach((_, i) => {
    for (const n of figsOf(a, i)) {
      const b = byN.get(n)!
      b.parts.forEach((p, j) => { if (p.see.includes(a.n)) { union(`${a.n}:${i}`, `${n}:${j}`); linked.add(`${a.n}:${i}`); linked.add(`${n}:${j}`) } })
    }
  })
  // a passage no figure links is one unit (its runs together)
  const unitOf = (e: ParallelEntry) => {
    const own = runsOf(e).filter(r => linked.has(r))
    return own.length ? own.map(find) : [find(runsOf(e)[0])]
  }
  for (const e of entries) if (!runsOf(e).some(r => linked.has(r))) runsOf(e).forEach(r => union(r, runsOf(e)[0]))
  // the Mark passages in each group so far
  const marksIn = new Map<string, number[]>()
  for (const e of entries) if (e.col === MARK) for (const r of runsOf(e)) if (linked.has(r) || !runsOf(e).some(x => linked.has(x))) {
    const g = find(r); marksIn.set(g, [...(marksIn.get(g) ?? []), e.n])
  }
  const marksOf = (e: ParallelEntry) => e.col === MARK ? [e.n] : [...new Set(unitOf(e).flatMap(g => marksIn.get(g) ?? []))]
  /** The Mark passages of the nearest neighbour in `e`'s column, walking `dir`, whose row has one. */
  const anchor = (e: ParallelEntry, dir: 1 | -1): number[] | null => {
    for (let n = e.n + dir; byN.get(n)?.col === e.col; n += dir) { const m = marksOf(byN.get(n)!); if (m.length) return m }
    return null
  }

  // 2. one-way runs in sequence
  const joined: Harmony['joined'] = [], kept: OneWay[] = []
  const joins: [string, string][] = []
  for (const a of entries) a.parts.forEach((_, i) => {
    const run = `${a.n}:${i}`, figs = figsOf(a, i)
    if (!figs.length || linked.has(run)) return
    const groups = [...new Set(figs.flatMap(n => unitOf(byN.get(n)!)))]
    if (groups.length > 1) { kept.push({ from: a.n, to: figs, why: 'several rows' }); return }
    const g = groups[0]
    const marks = marksIn.get(g) ?? []
    const lo = anchor(a, -1), hi = anchor(a, 1)
    const between = !!lo && !!hi && marks.some(m => m >= Math.min(Math.max(...lo), Math.min(...hi)) && m <= Math.max(Math.max(...lo), Math.min(...hi)))
    const silent = figs.every(n => blank(byN.get(n)!))
    if (between || silent) { joins.push([run, g]); joined.push({ from: a.n, to: figs }) }
    else kept.push({ from: a.n, to: figs, why: marks.length ? 'out of order' : 'not returned' })
  })
  for (const [r, g] of joins) { union(r, g); linked.add(r) }

  // 3. a run without a link goes with its passage's next linked run, else the one before
  for (const e of entries) {
    const rs = runsOf(e), on = rs.map(r => linked.has(r))
    if (!on.some(Boolean)) continue
    rs.forEach((r, i) => {
      if (on[i]) return
      let j = on.findIndex((x, k) => x && k > i)
      if (j < 0) j = on.lastIndexOf(true)
      union(r, rs[j])
    })
  }

  // the rows: each group's runs by passage
  const groups = new Map<string, Map<number, number[]>>()
  for (const e of entries) runsOf(e).forEach((r, i) => {
    const g = find(r)
    if (!groups.has(g)) groups.set(g, new Map())
    const m = groups.get(g)!
    m.set(e.n, [...(m.get(e.n) ?? []), i])
  })
  const lists = [...groups.values()]
  const rowsOfN = new Map<number, number[]>()
  lists.forEach((m, k) => { for (const n of m.keys()) rowsOfN.set(n, [...(rowsOfN.get(n) ?? []), k]) })

  // order: Mark rows by Mark. Every other passage takes its place on Mark's line from the nearest passage before it in
  // its own Gospel that stands in that Gospel's sequence (the longest run of its rows agreeing with Mark's order), so
  // one passage Darby links back across the history (Luke 11:15–26 to Mark 3:21–35) does not drag its neighbours along
  const marksOfRow = (k: number) => [...lists[k].keys()].filter(n => byN.get(n)!.col === MARK)
  const rowMarks = (n: number) => rowsOfN.get(n)!.flatMap(marksOfRow)
  const inSeq = new Set<number>()
  fig.columns.forEach((_, col) => {
    if (col === MARK) return
    const seq = entries.filter(e => e.col === col && rowMarks(e.n).length).map(e => ({ n: e.n, v: Math.min(...rowMarks(e.n)) }))
    // longest non-decreasing run (patience would do; 100 passages do not need it)
    const len = seq.map(() => 1), prev = seq.map(() => -1)
    seq.forEach((x, i) => { for (let j = 0; j < i; j++) if (seq[j].v <= x.v && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j } })
    for (let i = len.indexOf(Math.max(0, ...len)); i >= 0; i = prev[i]) inSeq.add(seq[i].n)
  })
  const placeBefore = (e: ParallelEntry) => {
    for (let n = e.n - 1; byN.get(n)?.col === e.col; n--) if (inSeq.has(n)) return Math.max(...rowMarks(n))
    return 0
  }
  const cmp = (a: number[], b: number[]) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length }
  const keys = lists.map((m, k) => {
    const marks = marksOfRow(k)
    // a Mark passage standing in two rows: its runs' order
    if (marks.length) { const m0 = Math.min(...marks); return [m0, -1, Math.min(...m.get(m0)!)] }
    return [...m.keys()].map(n => { const e = byN.get(n)!; return [placeBefore(e), e.col, n] }).reduce((x, y) => cmp(x, y) >= 0 ? x : y)
  })
  const order = lists.map((_, k) => k).sort((a, b) => cmp(keys[a], keys[b]))

  // the runs as the page runs them ("mountain—Appoints"), a row that starts mid-passage capitalised as a heading is
  const text = (e: ParallelEntry, runs: number[]) => runs.map(i => e.parts[i].text).reduce((a, t) => !a ? t : a.endsWith('—') ? a + t : `${a} ${t}`, '')
  const heading = (t: string) => t.replace(/^(<[a-z]+>)?([a-z])/, (_, tag = '', ch: string) => tag + ch.toUpperCase())
  const rows: HarmonyRow[] = order.map(k => {
    const m = lists[k]
    const cells: ParallelEntry[][] = fig.columns.map(() => [])
    for (const n of [...m.keys()].sort((a, b) => a - b)) { const e = byN.get(n)!; cells[e.col].push(e) }
    const leadCol = [MARK, ...fig.columns.map((_, c) => c).filter(c => c !== MARK)].find(c => cells[c].length)!
    const subject = heading(cells[leadCol].map(e => text(e, m.get(e.n)!)).join(' '))
    const inRow = new Set(m.keys())
    const compare = [...new Set([...m].flatMap(([n, runs]) => runs.flatMap(i => byN.get(n)!.parts[i].see)))]
      .filter(n => n > 0 && !inRow.has(n) && byN.get(n)).sort((a, b) => a - b).map(n => byN.get(n)!)
    const share = cells.filter(c => c.length).length as 1 | 2 | 3
    return { cells, subject, lead: cells[leadCol][0], share, compare, notes: [] }
  })
  // page notes: before the row of the passage printed next after them on their page
  fig.items.forEach((it, i) => {
    if (isEntry(it)) return
    const next = fig.items.slice(i + 1).find((x): x is ParallelEntry => isEntry(x) && x.page === it.page)
    const at = next ? rows.findIndex(r => r.cells.some(c => c.includes(next))) : rows.length - 1
    rows[at].notes.push(it.note)
  })
  const twice = new Set([...rowsOfN].filter(([, ks]) => ks.length > 1).map(([n]) => n))
  const ambiguous = rows.filter(r => r.cells.some(c => c.length > 1) || r.cells.flat().some(e => twice.has(e.n)))
  return { rows, ambiguous, joined, kept }
}

/** A passage's reference without its book, compact: "14:13–21", "5–7" (three chapters), "19:27–20:19". */
export function compactRef(p: Passage): string {
  const [, c1, v1, c2, v2] = p
  if (v1 === 1 && v2 === 0) return c1 === c2 ? `${c1}` : `${c1}–${c2}`
  if (c1 === c2) return `${c1}:${v1}${v2 === 0 ? '–end' : v2 !== v1 ? `–${v2}` : ''}`
  return `${c1}:${v1}–${c2}${v2 ? `:${v2}` : ''}`
}
