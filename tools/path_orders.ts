// Writes shared/pathOrders.json: the two built-in paths whose chapter order is data, not a rule (shared/paths.ts reads
// it; rs/src/paths.rs compiles the same file in, so both sides agree by construction).
// Usage: node --experimental-strip-types --import ./tools/ts-resolve.mjs tools/path_orders.ts
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { harmonyOf, type ParallelsFigure } from '../shared/figures.js'
import { BOOKS } from '../shared/books.js'
import type { MinistrySection } from '../shared/ministry.js'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
type Ch = [book: number, chapter: number]

/**
 * The life of Christ: Darby's "Relative order of three synoptical Gospels" (Collected Writings, Expository 4) read in
 * parallel (`harmonyOf`), row by row in Mark's order. A row's chapters are the chapters its Matthew, Mark and Luke
 * passages touch, in column order, each chapter where the harmony first reaches it (Matthew 8 before 5-7, as Darby
 * sets them); a later row touching a chapter already placed adds nothing. Every one of the 68 synoptic chapters is
 * reached. The figure has no John column at all, so John's chapters are placed by hand where Robertson's harmony of
 * the Gospels puts them, each after the row that first reaches its anchor chapter:
 * John 1-4 after the baptism and temptation (Matthew 4), 5 with the sabbath controversies (Matthew 12), 6 after the
 * feeding of the five thousand (Matthew 14), 7-10 at the feast of tabernacles (Luke 10), 11 before the last journey
 * (Luke 17), 12 with the entry (Luke 19), 13-17 with the supper (Matthew 26), 18-19 with the trial and cross
 * (Matthew 27), 20 with the resurrection (Matthew 28), 21 last (Luke 24).
 */
const JOHN_AFTER: [anchor: Ch, chapters: number[]][] = [
  [[40, 4], [1, 2, 3, 4]], [[40, 12], [5]], [[40, 14], [6]], [[42, 10], [7, 8, 9, 10]], [[42, 17], [11]], [[42, 19], [12]],
  [[40, 26], [13, 14, 15, 16, 17]], [[40, 27], [18, 19]], [[40, 28], [20]], [[42, 24], [21]],
]
export function lifeOfChrist(fig: ParallelsFigure): Ch[] {
  const seen = new Set<string>(), out: Ch[] = []
  const add = (b: number, c: number) => { const k = `${b}.${c}`; if (!seen.has(k)) { seen.add(k); out.push([b, c]) } }
  for (const row of harmonyOf(fig).rows) {
    const touched: Ch[] = []
    for (const cell of row.cells) for (const e of cell) { if (!e.passage) continue; const [b, c1, , c2] = e.passage; for (let c = c1; c <= c2; c++) touched.push([b, c]) }
    const before = out.length
    for (const [b, c] of touched) add(b, c)
    const fresh = out.slice(before)
    for (const [[ab, ac], johns] of JOHN_AFTER) if (fresh.some(([b, c]) => b === ab && c === ac)) for (const c of johns) add(43, c)
  }
  return out
}

/**
 * In the order it happened: a book-level chronological order derived from the standard datings of the books
 * (Job in the patriarchal age, the Psalms with David, the wisdom books with Solomon, each prophet in his reign, each
 * letter at its place in Acts), whole books except where a book is split around another:
 * Job inside Genesis 11 | 12; 1 Chronicles beside 2 Samuel and the Psalms after them (David's); 2 Chronicles 1-9,
 * Proverbs, Ecclesiastes and the Song with Solomon after 1 Kings 11; the eighth-century prophets after the fall of
 * Samaria (2 Kings 17); Ezra 1-6 with Haggai and Zechariah, Esther before Ezra 7; Acts split around the letters
 * written during it. A book-level order with these interleavings, not a verse harmony.
 */
const IN_ORDER: [book: number, from?: number, to?: number][] = [
  [1, 1, 11], [18], [1, 12, 50], [2], [3], [4], [5], [6], [7], [8], [9], [10], [13], [19],
  [11, 1, 11], [14, 1, 9], [20], [21], [22],
  [11, 12, 22], [12, 1, 17], [31], [29], [32], [30], [28], [33],
  [12, 18, 25], [14, 10, 36], [23], [34], [36], [35], [24], [25], [26], [27],
  [15, 1, 6], [37], [38], [17], [15, 7, 10], [16], [39],
  [40], [41], [42], [43],
  [44, 1, 12], [59], [44, 13, 15], [48], [44, 16, 18], [52], [53], [44, 19, 19], [46], [47], [45], [44, 20, 28],
  [49], [50], [51], [57], [54], [56], [55], [58], [60], [61], [65], [62], [63], [64], [66],
]
export function inOrder(): Ch[] {
  const out: Ch[] = []
  for (const [b, from, to] of IN_ORDER) for (let c = from ?? 1; c <= (to ?? BOOKS[b - 1].chapters); c++) out.push([b, c])
  return out
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const sections = (JSON.parse(readFileSync(path.join(ROOT, 'data/ministry/darby/cw-expository-4.json'), 'utf8')) as { sections: MinistrySection[] }).sections
  const fig = sections.find(s => s.title === 'Relative order of three synoptical Gospels')!.figures![0] as ParallelsFigure
  const doc = { 'life-of-christ': lifeOfChrist(fig), 'in-order': inOrder() }
  const fmt = (v: Ch[]) => '[\n' + v.map(([b, c]) => `  [${b}, ${c}]`).join(',\n') + '\n]'
  writeFileSync(path.join(ROOT, 'shared/pathOrders.json'), '{\n' + Object.entries(doc).map(([k, v]) => `"${k}": ${fmt(v)}`).join(',\n') + '\n}\n')
  console.log(Object.entries(doc).map(([k, v]) => `${k}: ${v.length} chapters`).join('\n'))
}
