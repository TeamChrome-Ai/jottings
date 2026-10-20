// The Bible's books in their usual groups, for search: a query that names a group ("prophecies", "the gospels") lists
// its books, and "love in the gospels" searches only those books. The groups travel as a search scope: comma-separated
// book numbers and ranges ("40-43", "23-39,66"), which the server (rs/src/search.rs `scope_sql`) and the device's own
// index (shared/search.ts `inScope`) both read.
import { BOOKS, findBook } from './books.js'
import { N_, t, tc } from './i18n.js'

export interface BookGroup {
  id: string
  /** As a heading: "The prophets". */
  name: string
  /** What a reader types for it, lower case. */
  words: readonly string[]
  /** Inclusive book-number ranges. */
  ranges: readonly (readonly [number, number])[]
}

export const BOOK_GROUPS: readonly BookGroup[] = [
  { id: 'law', name: N_('The law'), words: ['law', 'the law', 'pentateuch', 'the pentateuch', 'torah', 'books of moses', 'the books of moses'], ranges: [[1, 5]] },
  { id: 'history', name: N_('The histories'), words: ['history', 'histories', 'historical books', 'the historical books', 'history books'], ranges: [[6, 17]] },
  { id: 'poetry', name: N_('Poetry and wisdom'), words: ['poetry', 'poetical books', 'the poetical books', 'wisdom', 'wisdom books', 'wisdom literature', 'poetry and wisdom'], ranges: [[18, 22]] },
  { id: 'prophecy', name: N_('Prophecy'), words: ['prophecy', 'prophecies', 'prophetic books', 'the prophetic books', 'prophetic'], ranges: [[23, 39], [66, 66]] },
  { id: 'prophets', name: N_('The prophets'), words: ['prophets', 'the prophets', 'prophet books'], ranges: [[23, 39]] },
  { id: 'major', name: N_('The major prophets'), words: ['major prophets', 'the major prophets'], ranges: [[23, 27]] },
  { id: 'minor', name: N_('The minor prophets'), words: ['minor prophets', 'the minor prophets', 'the twelve', 'twelve prophets', 'the twelve prophets'], ranges: [[28, 39]] },
  { id: 'gospels', name: N_('The gospels'), words: ['gospels', 'the gospels', 'the four gospels', 'four gospels'], ranges: [[40, 43]] },
  { id: 'paul', name: N_('Paul’s epistles'), words: ['pauline epistles', 'the pauline epistles', 'paul’s epistles', "paul's epistles", 'pauls epistles', 'epistles of paul', 'the epistles of paul', 'paul’s letters', "paul's letters", 'pauls letters', 'letters of paul'], ranges: [[45, 57]] },
  { id: 'general', name: N_('The general epistles'), words: ['general epistles', 'the general epistles', 'catholic epistles', 'the catholic epistles'], ranges: [[58, 65]] },
  { id: 'epistles', name: N_('The epistles'), words: ['epistles', 'the epistles', 'letters', 'the letters'], ranges: [[45, 65]] },
  { id: 'ot', name: N_('The Old Testament'), words: ['old testament', 'the old testament', 'ot'], ranges: [[1, 39]] },
  { id: 'nt', name: N_('The New Testament'), words: ['new testament', 'the new testament', 'nt'], ranges: [[40, 66]] },
]

const clean = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
const byWord = new Map<string, BookGroup>()
for (const g of BOOK_GROUPS) for (const w of g.words) byWord.set(clean(w), g)

/** The group a query names, the whole query and nothing else ("prophecies", "The Gospels"). */
export function groupNamed(q: string): BookGroup | undefined {
  return byWord.get(clean(q))
}

/** The books of a group, in order. */
export const groupBooks = (g: BookGroup): number[] => g.ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))

/** A group's scope as the search API takes it: "40-43", "23-39,66". */
export const groupScope = (g: BookGroup): string => g.ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',')

/** Parses a scope ("all", "OT", "NT", "43", "40-43", "23-39,66") into ranges; null for every book. */
export function scopeRanges(scope: string | undefined | null): [number, number][] | null {
  const s = (scope ?? '').trim()
  if (!s || s === 'all') return null
  if (s === 'OT') return [[1, 39]]
  if (s === 'NT') return [[40, 66]]
  const out: [number, number][] = []
  for (const part of s.split(',').slice(0, 20)) {
    const m = /^\s*(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*$/.exec(part)
    if (!m) return null
    const a = +m[1], b = m[2] ? +m[2] : a
    if (a < 1 || b > 66 || a > b) return null
    out.push([a, b])
  }
  return out.length ? out : null
}

/** A book is in a scope. */
export function inScopeRanges(book: number, scope: string | undefined | null): boolean {
  const r = scopeRanges(scope)
  return !r || r.some(([a, b]) => book >= a && book <= b)
}

/** What a query asks for when it ends "in <a group or a book>": "love in the gospels", "comfort in Isaiah". A quoted
 *  query is a phrase and never split; "in the beginning" names no group and stays as it is. */
export interface ScopedQuery { query: string; scope: string; label: string }
export function splitScope(q: string): ScopedQuery | null {
  if (/["“”]/.test(q)) return null
  const m = /^(.+?)\s+in\s+(.+)$/i.exec(q.trim())
  if (!m || !m[1].trim()) return null
  const where = m[2].trim()
  const g = groupNamed(where)
  if (g) return { query: m[1].trim(), scope: groupScope(g), label: t(g.name) }
  // a book by name, at least three letters: "he" and "is" are Hebrews' and Isaiah's short forms, and ordinary words
  const name = where.replace(/^the\s+/i, '')
  const book = name.replace(/[^a-z]/gi, '').length >= 3 && /^\d?\s?[a-z]/i.test(name) && name.split(/\s+/).length <= 4 ? findBook(name) : undefined
  if (book) return { query: m[1].trim(), scope: String(book.n), label: book.name }
  return null
}

/** The books of a scope by name, for a label: "Isaiah to Malachi, Revelation". */
export function scopeLabel(scope: string): string {
  const r = scopeRanges(scope)
  if (!r) return tc('books', 'All')
  return r.map(([a, b]) => (a === b ? BOOKS[a - 1].name : t('{from} to {to}', { from: BOOKS[a - 1].name, to: BOOKS[b - 1].name }))).join(', ')
}
