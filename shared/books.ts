// Canonical book table. `n` is 1-based canonical order, used everywhere as the book id.
import { BOOK_ALIASES, BOOK_NAMES, type NamesLang } from './bookNames.js'

export type Testament = 'OT' | 'NT'
/**
 * `name` and `abbr` are in the language the app writes book names in (setNamesLang, docs/LANGUAGES.md), `refName` is the
 * name a reference uses ("Psaume 23" of "Psaumes"); `nameEn` and `abbrEn` are always the English, and `chapters` is the
 * English Darby's count, which every Bible here is kept in.
 */
export interface BookMeta { n: number; readonly name: string; readonly abbr: string; readonly refName: string; nameEn: string; abbrEn: string; osis: string; testament: Testament; chapters: number; aliases: string[] }

let namesLang: NamesLang = 'en'
/** The language book names are written in: the app's (Canadian French writes them as French). */
export function setNamesLang(l: NamesLang): void { namesLang = l }
export const peekNamesLang = (): NamesLang => namesLang

const raw: [string, string, string, Testament, number, string[]][] = [
  ['Genesis','Gen','Gen','OT',50,['ge','gn']],['Exodus','Ex','Exod','OT',40,['exo','exod']],['Leviticus','Lev','Lev','OT',27,['le','lv']],
  ['Numbers','Num','Num','OT',36,['nu','nm','nb']],['Deuteronomy','Deut','Deut','OT',34,['dt','de']],['Joshua','Josh','Josh','OT',24,['jos','jsh']],
  ['Judges','Judg','Judg','OT',21,['jdg','jg','jdgs']],['Ruth','Ruth','Ruth','OT',4,['ru','rth']],['1 Samuel','1 Sam','1Sam','OT',31,['1sa','1sm','1s']],
  ['2 Samuel','2 Sam','2Sam','OT',24,['2sa','2sm','2s']],['1 Kings','1 Kgs','1Kgs','OT',22,['1ki','1kg','1k']],['2 Kings','2 Kgs','2Kgs','OT',25,['2ki','2kg','2k']],
  ['1 Chronicles','1 Chr','1Chr','OT',29,['1ch','1chron']],['2 Chronicles','2 Chr','2Chr','OT',36,['2ch','2chron']],['Ezra','Ezra','Ezra','OT',10,['ezr']],
  ['Nehemiah','Neh','Neh','OT',13,['ne']],['Esther','Esth','Esth','OT',10,['es','est']],['Job','Job','Job','OT',42,['jb']],
  ['Psalms','Ps','Ps','OT',150,['psa','psalm','pss','psm']],['Proverbs','Prov','Prov','OT',31,['pr','prv','pro']],['Ecclesiastes','Eccl','Eccl','OT',12,['ec','ecc','qoh']],
  ['Song of Songs','Song','Song','OT',8,['sos','ss','canticles','song of solomon','cant']],['Isaiah','Isa','Isa','OT',66,['is']],['Jeremiah','Jer','Jer','OT',52,['je','jr']],
  ['Lamentations','Lam','Lam','OT',5,['la']],['Ezekiel','Ezek','Ezek','OT',48,['eze','ezk']],['Daniel','Dan','Dan','OT',12,['da','dn']],
  ['Hosea','Hos','Hos','OT',14,['ho']],['Joel','Joel','Joel','OT',3,['jl']],['Amos','Amos','Amos','OT',9,['am']],
  ['Obadiah','Obad','Obad','OT',1,['ob']],['Jonah','Jonah','Jonah','OT',4,['jnh','jon']],['Micah','Mic','Mic','OT',7,['mc']],
  ['Nahum','Nah','Nah','OT',3,['na']],['Habakkuk','Hab','Hab','OT',3,['hb']],['Zephaniah','Zeph','Zeph','OT',3,['zep','zp']],
  ['Haggai','Hag','Hag','OT',2,['hg']],['Zechariah','Zech','Zech','OT',14,['zec','zc']],['Malachi','Mal','Mal','OT',4,['ml']],
  ['Matthew','Matt','Matt','NT',28,['mt','mat']],['Mark','Mark','Mark','NT',16,['mk','mr','mrk']],['Luke','Luke','Luke','NT',24,['lk','lu']],
  ['John','John','John','NT',21,['jn','jhn','joh']],['Acts','Acts','Acts','NT',28,['ac','act']],['Romans','Rom','Rom','NT',16,['ro','rm']],
  ['1 Corinthians','1 Cor','1Cor','NT',16,['1co','1cor']],['2 Corinthians','2 Cor','2Cor','NT',13,['2co','2cor']],['Galatians','Gal','Gal','NT',6,['ga']],
  ['Ephesians','Eph','Eph','NT',6,['ep']],['Philippians','Phil','Phil','NT',4,['php','pp','phil']],['Colossians','Col','Col','NT',4,['co']],
  ['1 Thessalonians','1 Thess','1Thess','NT',5,['1th','1thes']],['2 Thessalonians','2 Thess','2Thess','NT',3,['2th','2thes']],
  ['1 Timothy','1 Tim','1Tim','NT',6,['1ti','1tm']],['2 Timothy','2 Tim','2Tim','NT',4,['2ti','2tm']],['Titus','Titus','Titus','NT',3,['ti','tit']],
  ['Philemon','Phlm','Phlm','NT',1,['phm','pm','philem']],['Hebrews','Heb','Heb','NT',13,['he']],['James','Jas','Jas','NT',5,['jm','jam']],
  ['1 Peter','1 Pet','1Pet','NT',5,['1pe','1pt','1p']],['2 Peter','2 Pet','2Pet','NT',3,['2pe','2pt','2p']],['1 John','1 John','1John','NT',5,['1jn','1jo','1j']],
  ['2 John','2 John','2John','NT',1,['2jn','2jo','2j']],['3 John','3 John','3John','NT',1,['3jn','3jo','3j']],['Jude','Jude','Jude','NT',1,['jd','jud']],
  ['Revelation','Rev','Rev','NT',22,['re','rv','apocalypse','revelations']],
]

const own = (n: number) => (namesLang === 'en' ? undefined : BOOK_NAMES[namesLang][n - 1])
export const BOOKS: BookMeta[] = raw.map(([name, abbr, osis, testament, chapters, aliases], i) => ({
  n: i + 1, nameEn: name, abbrEn: abbr, osis, testament, chapters, aliases,
  get name() { return own(i + 1)?.[0] ?? name },
  get abbr() { return own(i + 1)?.[1] ?? abbr },
  get refName() { const o = own(i + 1); return o ? o[2] ?? o[0] : name },
}))
export const bookByN = (n: number): BookMeta | undefined => BOOKS[n - 1]

/** A name as lookups compare it: lower case, no accents, no dots or spaces, "I/first" → 1. */
const norm = (s: string) => (typeof s.normalize === 'function' ? s.normalize('NFD') : s).replace(/\p{M}/gu, '').toLowerCase().replace(/[.\s]+/g, '').replace(/^(i{1,3})(?=[a-z])/, m => String(m.length)).replace(/^(first|1st)/, '1').replace(/^(second|2nd)/, '2').replace(/^(third|3rd)/, '3')

const lookup = new Map<string, BookMeta>()
for (const b of BOOKS) {
  for (const key of [b.nameEn, b.abbrEn, b.osis, ...b.aliases]) lookup.set(norm(key), b)
}
/** Each other language's names, short forms and aliases; read before the English, so "Mc" is Marc in French. */
const lookupIn = Object.fromEntries((Object.keys(BOOK_NAMES) as Exclude<NamesLang, 'en'>[]).map(l => {
  const m = new Map<string, BookMeta>()
  BOOK_NAMES[l].forEach(([name, abbr, ref], i) => {
    for (const key of [name, abbr, ...(ref ? [ref] : []), ...(BOOK_ALIASES[l]?.[i + 1] ?? [])]) m.set(norm(key), BOOKS[i])
  })
  return [l, m]
})) as Record<Exclude<NamesLang, 'en'>, Map<string, BookMeta>>
const ownNames = (l: NamesLang): string[] => (l === 'en' ? [] : BOOK_NAMES[l].map(([name]) => norm(name)))

// prefix index for partial names ("gene", "1 co")
export function findBook(text: string): BookMeta | undefined {
  const k = norm(text)
  if (!k) return undefined
  const exact = (namesLang !== 'en' ? lookupIn[namesLang].get(k) : undefined) ?? lookup.get(k)
  if (exact) return exact
  if (k.length < 2) return undefined
  const mine = ownNames(namesLang).findIndex(n => n.startsWith(k))
  if (mine >= 0) return BOOKS[mine]
  return BOOKS.find(b => norm(b.nameEn).startsWith(k))
}

/** Optimal-string-alignment distance: insert, delete, substitute, or swap two neighbours ("jhon" → "john" = 1). */
export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
  }
  return d[m][n]
}

const KEYS_EN: { key: string; book: BookMeta; primary: boolean }[] = BOOKS.flatMap(b => [{ key: norm(b.nameEn), book: b, primary: true }, ...[b.abbrEn, b.osis, ...b.aliases].map(a => ({ key: norm(a), book: b, primary: false }))])
/** The keys a misspelling is measured against: the app's language's names first, then the English. */
const keysOf = (l: NamesLang) => (l === 'en' ? KEYS_EN : [...BOOK_NAMES[l].map(([name], i) => ({ key: norm(name), book: BOOKS[i], primary: true })), ...KEYS_EN])

/**
 * A misspelt book name ("Jhon", "Pslams", "Galations", "Revalation"): the closest name, abbreviation or alias within
 * one edit for short inputs and two for longer ones. Never used for the strict lookup that turns footnote text into
 * links, only where a person is typing. Returns undefined when nothing is close or two books tie.
 */
export function findBookFuzzy(text: string): BookMeta | undefined {
  const strict = findBook(text)
  if (strict) return strict
  const k = norm(text)
  if (k.length < 4) return undefined
  const max = k.length <= 5 ? 1 : 2
  let best: { d: number; book: BookMeta; primary: boolean }[] = []
  for (const { key, book, primary } of keysOf(namesLang)) {
    if (Math.abs(key.length - k.length) > max) continue
    const d = editDistance(k, key)
    if (d > max) continue
    best.push({ d, book, primary })
  }
  if (!best.length) return undefined
  // closest first; a full name beats an abbreviation at the same distance ("jhon": John's name over Jonah's "jon")
  best.sort((x, y) => x.d - y.d || Number(y.primary) - Number(x.primary))
  const top = best[0]
  const rival = best.find(x => x.book.n !== top.book.n && x.d === top.d && x.primary === top.primary)
  return rival ? undefined : top.book
}
