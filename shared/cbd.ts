/**
 * The Concise Bible Dictionary (George Morrish, 1897) beside Strong's: the index shape, headword search, the matcher
 * that picks articles for a tapped word, and the links between the two (an article's Strong's numbers, a number's
 * articles). Pure functions; data/cbd/*.json come from tools/cbd_convert.py, whose `fold`, `key` and `translit_key`
 * these mirror.
 */

export interface CbdEntry { id: string; headword: string; aliases?: string[]; pron?: string; text: string }
/** One index.json row: id, headword, aliases, the Greek words the article discusses (folded), the Hebrew
 * transliterations it gives (translitKey), the target id when the whole article is "See X." ("" otherwise), 1 for an
 * article about a person or place (tools/cbd_convert.py proper_flags), and the Greek and Hebrew words it discusses as
 * Strong's numbers with Strong's spelling, in the article's order (strongs_words). */
export type CbdIndexRow = [id: string, headword: string, aliases: string[], greek: string[], hebrew: string[], see: string, proper: 0 | 1, words: [code: string, lemma: string][]]
export interface CbdIndex {
  rows: CbdIndexRow[]; byId: Map<string, CbdIndexRow>; names: Map<string, number[]>
  /** Per row: nameKey of the headword, then of each alias (search walks these on every keystroke). */
  keys: string[][]
}

/** Case, diacritics and final sigma folded ("πνεῦμα" -> "πνευμα", "Aarṓn" -> "aaron"). */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ς/g, 'σ')
/** Letters and digits only: "Abel-beth-maachah", "ABEL-BETH-MA'ACHAH" and "Abelbethmaachah" are one name. */
export const nameKey = (s: string) => fold(s).replace(/[^a-z0-9]/g, '')
/** Strong's "ʼâdôwn" / "rûwach" and Morrish's "adon" / "ruach" meet at the same key. */
export const translitKey = (s: string) => fold(s).replace(/[^a-z]/g, '').replace(/([iuo])[yw]/g, '$1')

export function buildIndex(rows: CbdIndexRow[]): CbdIndex {
  const names = new Map<string, number[]>()
  const add = (k: string, i: number) => { if (!k) return; const l = names.get(k); if (!l) names.set(k, [i]); else if (!l.includes(i)) l.push(i) }
  const keys = rows.map(r => [nameKey(r[1]), ...r[2].map(nameKey)])
  keys.forEach((k, i) => { for (const x of k) add(x, i) })
  return { rows, byId: new Map(rows.map(r => [r[0], r])), names, keys }
}

/**
 * Singular and plural spellings of one English word, most literal first: "teachers" -> teachers, teacher. Words of
 * three letters or fewer are taken as written, so "as" never becomes "Ass" nor "has" "Ha".
 */
export function wordForms(word: string): string[] {
  const w = nameKey(word.replace(/['’]s$/i, ''))
  if (w.length < 2) return []
  const out = [w]
  if (w.length <= 3) return out
  const push = (s: string) => { if (s.length >= 3 && !out.includes(s)) out.push(s) }
  if (w.endsWith('ies')) push(w.slice(0, -3) + 'y')
  // "-es" only after a sibilant: "witnesses" -> witness, but "hates" is never "hat"
  if (/(?:s|x|z|ch|sh)es$/.test(w)) push(w.slice(0, -2))
  if (w.endsWith('s')) push(w.slice(0, -1))
  if (w.endsWith('y')) push(w.slice(0, -1) + 'ies')
  push(w + 's')
  if (/(?:s|x|z|ch|sh)$/.test(w)) push(w + 'es')
  return out
}

/** Function words that are also headwords (No, On and So are places and a king) never select an article. */
const STOP = new Set(['a', 'an', 'as', 'at', 'be', 'by', 'do', 'he', 'in', 'is', 'it', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'we', 'ye', 'and', 'but', 'for', 'has', 'his', 'not', 'the', 'was', 'with'])

/** Headword search: prefix matches first (headword before alias), then contains; each group in index order. */
export function searchHeadwords(index: CbdIndex, q: string, limit = 60): CbdIndexRow[] {
  const k = nameKey(q)
  if (!k) return []
  const prefix: CbdIndexRow[] = [], aliasPrefix: CbdIndexRow[] = [], contains: CbdIndexRow[] = []
  index.rows.forEach((r, i) => {
    if (prefix.length >= limit) return
    const [h, ...aliases] = index.keys[i]
    if (h.startsWith(k)) prefix.push(r)
    else if (aliases.some(a => a.startsWith(k))) aliasPrefix.push(r)
    else if (h.includes(k) || aliases.some(a => a.includes(k))) contains.push(r)
  })
  return [...prefix, ...aliasPrefix, ...contains].slice(0, limit)
}

/** The index letter of a headword ("Abel-beth-maachah" -> "A"). */
export const letterOf = (headword: string) => (nameKey(headword)[0] ?? '#').toUpperCase()

export interface CbdMatch { id: string; headword: string; /** the stub that pointed here ("Spirit" for Soul) */ via?: string; why: 'word' | 'stem' | 'phrase' }

/** Best tier first, then index order; a "See X." stub becomes X (once), carrying the stub's headword as `via`. */
function resolve(index: CbdIndex, scored: { i: number; tier: number; why: CbdMatch['why'] }[], limit: number): CbdMatch[] {
  scored.sort((a, b) => a.tier - b.tier || a.i - b.i)
  const out: CbdMatch[] = []
  for (const s of scored) {
    const r = index.rows[s.i]
    const target = r[5] ? index.byId.get(r[5]) : undefined
    const m: CbdMatch = target ? { id: target[0], headword: target[1], via: r[1], why: s.why } : { id: r[0], headword: r[1], why: s.why }
    if (!out.some(o => o.id === m.id)) out.push(m)
    if (out.length >= limit) break
  }
  return out
}

/** Irregular plurals of the text ("men", "brethren"); `wordForms` makes the regular ones. */
const IRREGULAR: Record<string, string> = { men: 'man', women: 'woman', children: 'child', brethren: 'brother', feet: 'foot', teeth: 'tooth', oxen: 'ox', mice: 'mouse', geese: 'goose', lice: 'louse', kine: 'cow' }
/** More words that never select an article when tapped alone: pronouns, auxiliaries, the archaic verb forms. */
const WORD_STOP = new Set([...STOP, 'am', 'are', 'been', 'being', 'did', 'doth', 'hath', 'had', 'have', 'shall', 'should', 'will', 'would', 'may', 'might', 'can', 'could', 'must', 'art', 'wast', 'were', 'if', 'me', 'my', 'mine', 'him', 'her', 'hers', 'its', 'our', 'ours', 'us', 'you', 'your', 'thee', 'thou', 'thy', 'thine', 'they', 'them', 'their', 'this', 'that', 'these', 'those', 'who', 'whom', 'whose', 'which', 'what', 'from', 'into', 'unto', 'upon', 'than', 'then', 'there', 'when', 'where', 'also', 'even', 'yet', 'nor', 'all', 'any', 'every', 'some', 'one'])

/**
 * Whether a word of the text can select an article on its own: not a function word, not a single letter or a number.
 * Cheap enough to ask per word per render (the reader's tokens are ASCII letters, digits and apostrophes).
 */
export function isLookupWord(tok: string): boolean {
  const w = tok.toLowerCase().replace(/['’]s$/, '').replace(/['’]/g, '')
  return w.length > 1 && !/^\d+$/.test(w) && !WORD_STOP.has(w)
}

/**
 * Stems of an inflected verb, for a tapped word no headword spells: "sinned" -> sin, "believeth" -> believe,
 * "judging" -> judge. Only words of five letters or more, only stems of three or more, so "king" stays "king".
 */
export function stemForms(word: string): string[] {
  const w = nameKey(word.replace(/['’]s$/i, ''))
  const out: string[] = []
  if (w.length < 5) return out
  const push = (s: string) => { if (s.length >= 3 && s !== w && !out.includes(s)) out.push(s) }
  for (const suf of ['eth', 'est', 'ed', 'ing']) {
    if (!w.endsWith(suf) || w.length - suf.length < 3) continue
    const stem = w.slice(0, -suf.length)
    if (stem.endsWith('i')) push(stem.slice(0, -1) + 'y')           // sanctifieth -> sanctify, tried -> try
    if (/([bdfgklmnprt])\1$/.test(stem)) push(stem.slice(0, -1))    // sinned -> sin
    push(stem); push(stem + 'e')                                      // judged -> judg, judge
  }
  return out
}

/** Word lookup keys built once per index: headwords without an inverted article ("Son, The" and "Christ, the Christ"
 * under son and christ), and multi-word headwords by their first word ("Son of Man, The" under son). */
interface WordKeys { bare: Map<string, number[]>; lead: Map<string, number[]>; proper: Set<number> }
const wordKeysCache = new WeakMap<CbdIndex, WordKeys>()
function wordKeys(index: CbdIndex): WordKeys {
  let k = wordKeysCache.get(index)
  if (k) return k
  const bare = new Map<string, number[]>(), lead = new Map<string, number[]>(), proper = new Set<number>()
  const at = new Map(index.rows.map((r, i) => [r[0], i]))
  const add = (m: Map<string, number[]>, key: string, i: number) => { if (!key) return; const l = m.get(key); if (!l) m.set(key, [i]); else if (!l.includes(i)) l.push(i) }
  index.rows.forEach((r, i) => {
    // a name's stub marks its target too: Put is flagged, Phut (alias Put) is not
    if (r[6]) { proper.add(i); const t = r[5] ? at.get(r[5]) : undefined; if (t !== undefined) proper.add(t) }
    for (const name of [r[1], ...r[2]]) {
      const stripped = name.replace(/,\s*the\b.*$/i, '')
      if (stripped !== name) add(bare, nameKey(stripped), i)
      const words = stripped.split(/[\s,]+/).filter(Boolean)
      if (words.length > 1) add(lead, nameKey(words[0]), i)
    }
  })
  k = { bare, lead, proper }
  wordKeysCache.set(index, k)
  return k
}

/** Builds `matchWord`'s keys ahead of the first tap (about 20 ms of work on the full index). */
export function warmWordLookup(index: CbdIndex): void { wordKeys(index) }

/**
 * Articles for a word tapped in the text with no Strong's entry to go on, best first:
 *   1. a headword or alias is the word, singular or plural ("teachers" -> Teacher; "Son" -> "Son, The" too);
 *   2. only when nothing matched: a headword is the stem of an inflected verb ("sinned" -> Sin);
 *   3. only beside a match from 1: headwords that begin with the word ("Son of Man, The", "John the Baptist").
 * A word in lower case never selects a person or place ("put" is not Put); a capitalised one may ("Nicodemus").
 * Function words select nothing. An article that only says "See X." is replaced by X, carrying its headword as `via`.
 */
export function matchWord(index: CbdIndex, tapped: string, limit = 6): CbdMatch[] {
  // the text spells Ænon and Judæa; the headwords Aenon and Judaea
  const word = tapped.replace(/æ/g, 'ae').replace(/Æ/g, 'Ae').replace(/œ/g, 'oe').replace(/Œ/g, 'Oe')
  const w = nameKey(word.replace(/['’]s$/i, ''))
  if (!w || WORD_STOP.has(w)) return []
  const common = /^[a-z]/.test(word.trim())
  const keys = wordKeys(index)
  const scored: { i: number; tier: number; why: CbdMatch['why'] }[] = []
  const take = (list: number[] | undefined, tier: number, why: CbdMatch['why']) => {
    for (const i of list ?? []) if (!(common && keys.proper.has(i)) && !scored.some(s => s.i === i)) scored.push({ i, tier, why })
  }
  const forms = wordForms(word)
  if (IRREGULAR[w]) forms.push(IRREGULAR[w])
  for (const f of forms) { take(index.names.get(f), 0, 'word'); take(keys.bare.get(f), 0, 'word') }
  if (!scored.length) for (const f of stemForms(word)) { if (WORD_STOP.has(f)) continue; take(index.names.get(f), 1, 'stem'); take(keys.bare.get(f), 1, 'stem') }
  else for (const f of forms) take(keys.lead.get(f), 2, 'phrase')
  return resolve(index, scored, limit)
}

/**
 * The whole word around token `i` of a tokenized verse. The reader's tokenizer splits on anything outside A-Z, so
 * "in Ænon" arrives as a word "in", a separator " Æ" and a word "non", and "Judæa" as "Jud", "æ", "a": the letters a
 * separator carries next to the word join it.
 */
export function wholeWord(toks: readonly { tok: string; word: boolean }[], i: number): string {
  let word = toks[i]?.tok ?? ''
  for (let a = i - 1; a >= 0; a--) {
    const t = toks[a]
    if (t.word) { word = t.tok + word; continue }
    const m = /[\p{L}\p{M}]+$/u.exec(t.tok)
    if (!m) break
    word = m[0] + word
    if (m[0].length < t.tok.length) break
  }
  for (let b = i + 1; b < toks.length; b++) {
    const t = toks[b]
    if (t.word) { word += t.tok; continue }
    const m = /^[\p{L}\p{M}]+/u.exec(t.tok)
    if (!m) break
    word += m[0]
    if (m[0].length < t.tok.length) break
  }
  return word
}

/** The two-letter group of a headword ("Abel-beth-maachah" -> "Ab"); a one-letter headword is its own group ("A"). */
export const groupOf = (headword: string) => { const k = nameKey(headword); return k ? k[0].toUpperCase() + k.slice(1, 2) : '#' }

/** The groups of one letter's headwords with their counts, in alphabetical order ("A", "Aa", "Ab", ...). */
export function twoLetterGroups(rows: readonly CbdIndexRow[]): { group: string; count: number }[] {
  const m = new Map<string, number>()
  for (const r of rows) { const g = groupOf(r[1]); m.set(g, (m.get(g) ?? 0) + 1) }
  return [...m].map(([group, count]) => ({ group, count })).sort((a, b) => a.group < b.group ? -1 : a.group > b.group ? 1 : 0)
}

export interface Page<T> { items: T[]; page: number; pages: number; total: number; /** 1-based positions of the first and last item shown */ first: number; last: number }
/** One page of a list, 1-based; the page is clamped into range, and an empty list is one empty page. */
export function paginate<T>(list: readonly T[], page: number, size: number): Page<T> {
  const total = list.length, pages = Math.max(1, Math.ceil(total / size))
  const p = Math.min(pages, Math.max(1, Math.floor(page) || 1))
  const items = list.slice((p - 1) * size, p * size)
  return { items, page: p, pages, total, first: items.length ? (p - 1) * size + 1 : 0, last: (p - 1) * size + items.length }
}

/** Article text -> paragraphs; each keeps its "\n" line breaks (lists, tables). */
export const paragraphs = (text: string) => text.split(/\n{2,}/).filter(p => p.trim())

/** An article's Strong's numbers: the Greek and Hebrew words it discusses, each opening that number's word study. */
export const articleWords = (row: CbdIndexRow | undefined): [code: string, lemma: string][] => row?.[7] ?? []

/**
 * A Strong's number's articles: those that discuss the word, in index order. "See X." stubs never discuss anything,
 * so each article appears once, under its own headword.
 */
export function articlesFor(index: CbdIndex, code: string): { id: string; headword: string }[] {
  const out: { id: string; headword: string }[] = []
  for (const r of index.rows) if (r[7]?.some(w => w[0] === code)) out.push({ id: r[0], headword: r[1] })
  return out
}

export type SheetPart = 'word' | 'subject'
/**
 * The word sheet's two parts in order, the first open and the rest folded beneath it. A word carrying a Strong's
 * number opens on the word (the Hebrew or Greek behind it and where it occurs); any other word has only the subject
 * (its dictionary article by headword). A number with no tapped word (a chip in an article) is the word alone.
 */
export function sheetParts(code: string, word: string): SheetPart[] {
  if (!code) return word ? ['subject'] : []
  return word ? ['word', 'subject'] : ['word']
}
