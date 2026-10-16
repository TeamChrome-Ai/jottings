/**
 * Builds data/ministry.db: the ministry library (every enabled author's works, sections and paragraphs) and its verse
 * index (shared/ministryIndex.ts), for rs/src/ministry.rs. Node 22.5+ (node:sqlite), no dependencies:
 *
 *   node --import ./tools/ts-resolve.mjs tools/ministry_index.ts [data] [out]     (npm run ministry)
 *
 * Sources, per author in the registry (shared/ministry.ts MINISTRY_AUTHORS, enabled only):
 *   data/ministry/<author>/index.json + <work>.json   the converters' output (tools/ministry_convert.py for Darby), in the
 *                                                     companion's shape with `collection` on each work; a section's
 *                                                     `noteSources` and `filled` (where its notes and filled paragraphs
 *                                                     came from) go into sections.meta, not into the work's contents
 *   data/synopsis/                                     Darby's Synopsis, the companion's (collection "synopsis", first)
 *   data/coates/                                       Coates, the companion's (collections by kind: Outlines, Addresses; a work's
 *                                                     own `collection`: Miscellaneous Ministry)
 * Work ids are the companion's for the Synopsis and Coates, so a companion place is a library place.
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homeOf, paragraphsOf, type Passage, type WorkKind } from '../shared/companion.ts'
import { MINISTRY_AUTHORS, type MinistryAuthor, type MinistrySection } from '../shared/ministry.ts'
import { bibleWords, onPassage, paragraphHits, plainOf, rankOf, rowHits, sectionHits, verseOf, type BibleWords } from '../shared/ministryIndex.ts'
import { figureRows, rowSlot } from '../shared/figures.ts'
import type { Mention } from '../shared/ministry.ts'

const root = resolve(import.meta.dirname, '..')
const data = resolve(process.argv[2] ?? join(root, 'data'))
const out = resolve(process.argv[3] ?? join(data, 'ministry.db'))

/** What the converter records of a section's sources (data/ministry/SOURCE.md): kept in sections.meta, off the contents list. */
interface SourceMarks { noteSources?: ('mse' | 'btp')[]; filled?: [number, number][] }
interface Work { id: string; title: string; kind: WorkKind; collection: string; sections: (MinistrySection & SourceMarks)[] }
interface Collection { id: string; title: string; works: Work[] }

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T
const worksIn = (dir: string, ids: readonly string[], collection: (w: { id: string; kind: WorkKind }) => string): Work[] =>
  ids.map(id => { const w = readJson<Omit<Work, 'collection'> & { collection?: string }>(join(dir, `${id}.json`)); return { ...w, collection: w.collection ?? collection(w) } })

/** An author's library: the legacy companion folders first, then the converters' collections. */
function libraryOf(author: MinistryAuthor): Collection[] {
  const cols: Collection[] = []
  const add = (id: string, title: string, works: Work[]) => { if (works.length) cols.push({ id, title, works }) }
  if (author.id === 'darby') {
    const dir = join(data, 'synopsis')
    const idx = readJson<{ works: { id: string }[] }>(join(dir, 'index.json'))
    add('synopsis', 'Synopsis of the Books of the Bible', worksIn(dir, idx.works.map(w => w.id), () => 'synopsis'))
  }
  if (author.id === 'coates') {
    const dir = join(data, 'coates')
    const idx = readJson<{ works: { id: string; kind: WorkKind }[] }>(join(dir, 'index.json'))
    const all = worksIn(dir, idx.works.map(w => w.id), w => w.kind === 'outline' ? 'outlines' : 'addresses')
    add('outlines', 'Outlines', all.filter(w => w.collection === 'outlines'))
    add('addresses', 'Addresses', all.filter(w => w.collection === 'addresses'))
    add('miscellaneous', 'Miscellaneous Ministry', all.filter(w => w.collection === 'miscellaneous'))
  }
  const dir = join(data, 'ministry', author.id)
  if (existsSync(join(dir, 'index.json'))) {
    const idx = readJson<{ collections: { id: string; title: string; works: string[] }[] }>(join(dir, 'index.json'))
    for (const c of idx.collections) add(c.id, c.title, worksIn(dir, c.works, () => c.id))
  }
  return cols
}

function build() {
  const t0 = Date.now()
  const darby = readJson<{ books: { n: number; chapters: { c: number; verses: { v: number; t: string }[] }[] }[] }>(join(data, 'darby.json'))
  const bible: BibleWords = bibleWords(darby.books)
  for (const suffix of ['', '-wal', '-shm', '.tmp']) rmSync(out + suffix, { force: true })
  const tmp = out + '.tmp'
  const db = new DatabaseSync(tmp)
  db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA page_size = 4096;')
  db.exec(readFileSync(join(root, 'rs/src/ministry.sql'), 'utf8'))
  db.exec('BEGIN')
  const ins = {
    author: db.prepare('INSERT INTO authors (id, ord, name, short, born, died, enabled, licence, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    collection: db.prepare('INSERT INTO collections (author, id, ord, title) VALUES (?, ?, ?, ?)'),
    work: db.prepare('INSERT INTO works (author, id, collection, ord, title, kind, count, contents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    section: db.prepare('INSERT INTO sections (author, work, n, meta, notes, figures) VALUES (?, ?, ?, ?, ?, ?)'),
    para: db.prepare('INSERT INTO paras (id, author, work, n, i, text) VALUES (?, ?, ?, ?, ?, ?)'),
    ref: db.prepare('INSERT OR IGNORE INTO refs (verse, a, rank, para, note, start, end) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    figrow: db.prepare('INSERT INTO figrows (id, author, work, n, slot, text) VALUES (?, ?, ?, ?, ?, ?)'),
    chapter: db.prepare('INSERT INTO chapters (book, chapter, verses) VALUES (?, ?, ?)'),
  }
  for (const [k, n] of bible.counts) ins.chapter.run(Math.floor(k / 1000), k % 1000, n)
  let paraId = 0
  const report: string[] = []
  MINISTRY_AUTHORS.forEach((author, a) => {
    ins.author.run(author.id, a, author.name, author.short, author.born, author.died, author.enabled ? 1 : 0, author.licence, author.source)
    if (!author.enabled) return
    const cols = libraryOf(author)
    const verses = new Set<number>(), byMention: Record<Mention, number> = { quote: 0, verse: 0, range: 0, list: 0 }
    let works = 0, sections = 0, paras = 0, words = 0, rows = 0, reprinted = 0, figrows = 0, rowRefs = 0
    const seen = new Set<string>()
    cols.forEach((col, ci) => {
      ins.collection.run(author.id, col.id, ci, col.title)
      col.works.forEach((w, wi) => {
        works++
        const marked = w.sections.map(({ text: _t, notes: _n, figures: _f, ...meta }) => meta)
        const metas = marked.map(({ noteSources: _s, filled: _p, ...meta }) => meta)
        ins.work.run(author.id, w.id, col.id, ci * 1000 + wi, w.title, w.kind, w.sections.length, JSON.stringify(metas))
        const work = { id: w.id, title: w.title, kind: w.kind }
        w.sections.forEach((s, si) => {
          sections++
          const n = si + 1
          // figures ride with the section and are not indexed (shared/figures.ts)
          ins.section.run(author.id, w.id, n, JSON.stringify(marked[si]), s.notes?.length ? JSON.stringify(s.notes) : null, s.figures?.length ? JSON.stringify(s.figures) : null)
          const home = homeOf({ work, section: s }, w)
          const first = paraId + 1
          const hits = sectionHits(s.text, bible, home, s.passages as Passage[])
          const texts = paragraphsOf(s.text)
          // the paragraphs as written, which paragraphsOf reads the same way (split at blank lines, empty ones dropped)
          const raw = s.text.split(/\n{2,}/).filter(p => p.trim())
          const put = (id: number, note: number, h: { verse: number; mention: Mention; start: number; end: number }, refs: number) => {
            ins.ref.run(h.verse, a, rankOf(h.mention, onPassage(s.passages as Passage[], h.verse), refs), id, note, h.start, h.end)
            verses.add(h.verse); byMention[h.mention]++; rows++
          }
          texts.forEach((p, i) => {
            ins.para.run(++paraId, author.id, w.id, n, i, raw[i])
            const plain = plainOf(p)
            words += (plain.match(/\S+/g) ?? []).length
            // a paragraph printed twice (a paper reprinted in Miscellaneous Writings 4) is listed once, where it came first
            const key = plain.replace(/\W+/g, ' ').trim().toLowerCase()
            if (key.length >= 80) { if (seen.has(key)) { reprinted++; return } seen.add(key) }
            for (const h of hits[i].hits) put(paraId, 0, h, hits[i].refs)
          })
          paras += texts.length
          // footnotes: read with the section's home, found under the paragraph that carries their caller
          ;(s.notes ?? []).forEach((note, k) => {
            const caller = texts.findIndex(p => p.lines.some(l => l.includes(`[${k + 1}]`)))
            const plain = plainOf({ quote: false, lines: note.split(/\n+/) })
            const r = paragraphHits(plain, bible, home)
            for (const h of r.hits) put(first + Math.max(0, caller), k + 1, h, r.refs)
          })
          // the rows of its figures, each after the paragraphs (shared/figures.ts)
          figureRows(s.figures ?? []).forEach((row, k) => {
            const id = ++paraId
            const hs = rowHits(row, bible, home, s.passages as Passage[])
            if (!hs.length) return
            ins.figrow.run(id, author.id, w.id, n, rowSlot(texts.length, k), row.text)
            figrows++
            for (const h of hs) { ins.ref.run(h.verse, a, h.rank, id, -1, h.start, h.end); verses.add(h.verse); byMention[h.mention]++; rows++; rowRefs++ }
          })
        })
      })
    })
    const perBook = new Map<number, number>()
    for (const v of verses) { const b = verseOf(v).book; perBook.set(b, (perBook.get(b) ?? 0) + 1) }
    report.push(`${author.short}: ${cols.length} collections, ${works} works, ${sections} sections, ${paras} paragraphs, ${words.toLocaleString('en')} words; ` +
      `${reprinted} paragraphs printed twice indexed once; ${rows.toLocaleString('en')} index rows (quote ${byMention.quote}, verse ${byMention.verse}, range ${byMention.range}, list ${byMention.list}; ${rowRefs.toLocaleString('en')} of them from ${figrows} rows of figures); ${verses.size.toLocaleString('en')} verses with at least one`)
  })
  db.exec('COMMIT')
  const total = new Set(db.prepare('SELECT DISTINCT verse FROM refs').all().map(r => r.verse as number)).size
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('built', new Date().toISOString())
  db.exec('ANALYZE; VACUUM;')
  db.close()
  rmSync(out, { force: true })
  // renamed into place whole, so a server reading the old file never sees a half-built one
  renameSync(tmp, out)
  const verses = [...bible.counts.values()].reduce((x, y) => x + y, 0)
  for (const line of report) console.log(line)
  console.log(`all authors: ${total.toLocaleString('en')} of ${verses.toLocaleString('en')} verses (${(100 * total / verses).toFixed(1)}%)`)
  console.log(`${out}: ${(statSync(out).size / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}

build()
