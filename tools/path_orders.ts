// Writes shared/pathOrders.json: the two built-in paths whose chapter order is data, not a rule (shared/paths.ts reads
// it; rs/src/paths.rs compiles the same file in, so both sides agree by construction).
// Usage: node --experimental-strip-types --import ./tools/ts-resolve.mjs tools/path_orders.ts
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { BOOKS } from '../shared/books.js'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
type Ch = [book: number, chapter: number]

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
  // the life of Christ is kept as the checked-in file has it: the four Gospels' 89 chapters in the order of Darby's
  // "Relative order of three synoptical Gospels" (Collected Writings 25), read row by row in Mark's order, John's
  // chapters placed by hand where Robertson's harmony puts them. The table is not in the converted works, so the order
  // is not rebuilt here.
  const kept = JSON.parse(readFileSync(path.join(ROOT, 'shared/pathOrders.json'), 'utf8')) as Record<string, Ch[]>
  const doc = { 'life-of-christ': kept['life-of-christ'], 'in-order': inOrder() }
  const fmt = (v: Ch[]) => '[\n' + v.map(([b, c]) => `  [${b}, ${c}]`).join(',\n') + '\n]'
  writeFileSync(path.join(ROOT, 'shared/pathOrders.json'), '{\n' + Object.entries(doc).map(([k, v]) => `"${k}": ${fmt(v)}`).join(',\n') + '\n}\n')
  console.log(Object.entries(doc).map(([k, v]) => `${k}: ${v.length} chapters`).join('\n'))
}
