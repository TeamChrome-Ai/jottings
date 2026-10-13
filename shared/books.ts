// Canonical book table. `n` is 1-based canonical order, used everywhere as the book id.
export type Testament = 'OT' | 'NT'
export interface BookMeta { n: number; name: string; abbr: string; osis: string; testament: Testament; chapters: number; aliases: string[] }

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

export const BOOKS: BookMeta[] = raw.map(([name, abbr, osis, testament, chapters, aliases], i) => ({ n: i + 1, name, abbr, osis, testament, chapters, aliases }))
export const bookByN = (n: number): BookMeta | undefined => BOOKS[n - 1]

const norm = (s: string) => s.toLowerCase().replace(/[.\s]+/g, '').replace(/^(i{1,3})(?=[a-z])/, m => String(m.length)).replace(/^(first|1st)/, '1').replace(/^(second|2nd)/, '2').replace(/^(third|3rd)/, '3')

const lookup = new Map<string, BookMeta>()
for (const b of BOOKS) {
  for (const key of [b.name, b.abbr, b.osis, ...b.aliases]) lookup.set(norm(key), b)
}
// prefix index for partial names ("gene", "1 co")
export function findBook(text: string): BookMeta | undefined {
  const k = norm(text)
  if (!k) return undefined
  const exact = lookup.get(k)
  if (exact) return exact
  if (k.length < 2) return undefined
  const hits = BOOKS.filter(b => norm(b.name).startsWith(k))
  return hits.length === 1 ? hits[0] : hits[0]
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

const KEYS: { key: string; book: BookMeta; primary: boolean }[] = BOOKS.flatMap(b => [{ key: norm(b.name), book: b, primary: true }, ...[b.abbr, b.osis, ...b.aliases].map(a => ({ key: norm(a), book: b, primary: false }))])

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
  for (const { key, book, primary } of KEYS) {
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
