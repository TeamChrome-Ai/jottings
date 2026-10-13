import { findBook } from '@shared/books'
import { scanPrefaceRefs, type Ref, type RefHome } from '@shared/ref'

/**
 * The 1961 edition's introductory notices (CCEL HTML in data/ccel/intro.json) as a typeset document: headings,
 * paragraphs with italics, scripture links and footnote callers, and the three `<pre>` blocks read for what they are
 * (the names of God as a definition list, the Kurios passages as a reference list, the year summary as a table).
 * Pure: no React, so the tests read it directly.
 */

/** A piece of inline text: `ref` makes it a link into the reader, `note` a footnote caller (its text the number in superior figures). */
export interface Span { text: string; italic?: boolean; ref?: Ref; note?: string }
export type Row = { kind: 'row'; label: Span[]; value: string; total?: boolean } | { kind: 'rule'; double?: boolean }
export type Block =
  | { kind: 'p'; spans: Span[]; muted?: boolean }
  | { kind: 'h'; text: string }
  | { kind: 'chronology'; title: string; hint: string }
  | { kind: 'defs'; items: { term: Span[]; def: Span[] }[] }
  | { kind: 'refs'; entries: { book: string; spans: Span[] }[] }
  | { kind: 'table'; head: string; rows: Row[] }
export interface Note { id: string; spans: Span[] }
export interface IntroSection { title: string; blocks: Block[]; notes: Note[] }

interface Run { text: string; italic: boolean }

const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' }
// CCEL spells the manuscript sigla it could not set: Sinaiticus is aleph, the uncials Gamma and Delta are capitals
const SIGLA: Record<string, string> = { aleph: 'ℵ', gamma: 'Γ', delta: 'Δ' }
const plainOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, m => ENT[m] ?? m).replace(/\{([a-z]+)\}/g, (m, k: string) => SIGLA[k] ?? m)

/** `<em>` carries italics; every other tag is dropped. */
function runsOf(html: string): Run[] {
  const out: Run[] = []
  let italic = false
  for (const part of html.split(/(<\/?(?:i|em)\b[^>]*>)/)) {
    if (/^<(i|em)\b/.test(part)) { italic = true; continue }
    if (/^<\/(i|em)\b/.test(part)) { italic = false; continue }
    const text = plainOf(part)
    if (text) out.push({ text, italic })
  }
  return out
}

/**
 * Whitespace collapsed across runs and trimmed, "--" set as a dash (an en dash between figures), straight quotes
 * turned typographic. Every change inside a run keeps run boundaries, so italics survive.
 */
function typeset(runs: Run[]): Run[] {
  const out: Run[] = []
  let space = true
  for (const r of runs) {
    // the scan printed a capital I for the figure 1 beside other figures: "xv. I2, I3", "ix. 3I"
    let t = r.text.replace(/(\d)I\b/g, (_, d: string) => d + '1').replace(/\bI(\d)/g, (_, d: string) => '1' + d)
      .replace(/(\d)\s*--\s*(?=\d)/g, '$1–').replace(/(\d)-(?=\d)/g, '$1–').replace(/\s*--\s*/g, ' — ').replace(/\s+/g, ' ')
    if (space) t = t.replace(/^ /, '')
    if (!t) continue
    space = t.endsWith(' ')
    out.push({ text: t, italic: r.italic })
  }
  while (out.length) {
    const last = out[out.length - 1]
    last.text = last.text.replace(/ $/, '')
    if (last.text) break
    out.pop()
  }
  // quotes read their neighbour across run boundaries; each is one character either way
  let prev = ''
  for (const r of out) {
    let t = ''
    for (const ch of r.text) {
      const opens = !prev || /[\s(\[—–‘“]/.test(prev)
      t += ch === "'" ? (opens ? '‘' : '’') : ch === '"' ? (opens ? '“' : '”') : ch
      prev = ch
    }
    r.text = t
  }
  return out
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
/** "12" -> "¹²": the face's own superior figures sit on the line without disturbing its spacing. */
export const superscript = (n: string) => n.replace(/\d/g, d => SUP[+d])

/** Runs to spans: scripture references become links, "[2]" becomes a footnote caller (unless `notes` is false). */
function spansOf(runs: Run[], notes = true, home?: RefHome): Span[] {
  const plain = runs.map(r => r.text).join('')
  const cuts: { start: number; end: number; ref?: Ref; note?: string }[] = []
  if (notes) for (const m of plain.matchAll(/\[(\d{1,2})\]/g)) cuts.push({ start: m.index!, end: m.index! + m[0].length, note: m[1] })
  for (const r of scanPrefaceRefs(plain, home)) if (!cuts.some(c => c.start < r.end && r.start < c.end)) cuts.push({ start: r.start, end: r.end, ref: r.ref })
  cuts.sort((a, b) => a.start - b.start)
  const out: Span[] = []
  const text = (t: string, italic: boolean): Span => italic ? { text: t, italic } : { text: t }
  let offset = 0
  for (const run of runs) {
    const start = offset, end = offset + run.text.length
    offset = end
    let at = start
    for (const c of cuts) {
      const s = Math.max(c.start, start), e = Math.min(c.end, end)
      if (e <= s) continue
      if (s > at) out.push(text(plain.slice(at, s), run.italic))
      if (c.note !== undefined) {
        // the caller sits on the word before it, as printed: "act.²"
        const before = out[out.length - 1]
        if (before && !before.note) before.text = before.text.replace(/ $/, '')
        out.push({ text: superscript(c.note), note: c.note })
      } else out.push({ ...text(plain.slice(s, e), run.italic), ref: c.ref })
      at = e
    }
    if (at < end) out.push(text(plain.slice(at, end), run.italic))
  }
  return out.filter(s => s.text)
}

/**
 * One line of other typeset prose (the companion's readings) as spans, the way the notices are set: `<i>` italics,
 * references linked by scanPrefaceRefs (with `home`, the book a commentary is on), "[2]" a footnote caller when `notes`.
 */
export const inlineSpans = (html: string, notes = false, home?: RefHome): Span[] => spansOf(typeset(runsOf(html)), notes, home)

/** The runs covering characters [a, b) of their joined text. */
function cut(runs: Run[], a: number, b: number): Run[] {
  const out: Run[] = []
  let offset = 0
  for (const r of runs) {
    const s = Math.max(a, offset), e = Math.min(b, offset + r.text.length)
    if (e > s) out.push({ text: r.text.slice(s - offset, e - offset), italic: r.italic })
    offset += r.text.length
  }
  return out
}

const PROPER = new Set(['judah', 'israel', 'saul', 'david', 'solomon', 'god', 'jehovah'])
/** "NOTE ON THE CHRONOLOGICAL DATES" -> "Note on the chronological dates"; names, "Old/New Testament" and "B.C." keep their capitals. */
export function sentenceCase(s: string): string {
  const out = s.replace(/[A-Za-z][A-Za-z.]*/g, (w, i: number) => {
    if (/^(?:[A-Z]\.){2,}$/.test(w)) return w
    const l = w.toLowerCase()
    if (PROPER.has(l) || l === 'testament' || ((l === 'old' || l === 'new') && /^\s+testament/i.test(s.slice(i + w.length)))) return l[0].toUpperCase() + l.slice(1)
    return l
  })
  return out.replace(/[a-z]/, ch => ch.toUpperCase())
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
/** The heading CCEL opens a notice with repeats the card's title in capitals: most of the title's words are in it. */
const repeatsTitle = (title: string, heading: string) => {
  const t = [...words(title)], h = words(heading)
  return t.length > 0 && t.filter(w => h.has(w)).length / t.length >= 0.75
}

/** `<em>Elohim</em> is 'God.'` on every line. */
function defsOf(lines: string[]): Block {
  return {
    kind: 'defs',
    items: lines.map(l => {
      const m = /^\s*(<em>[\s\S]*?<\/em>)\s+is\s+(.*)$/.exec(l)!
      const def = typeset(runsOf(m[2]))
      // 'God.' closes a sentence in the prose; in the list the rendering stands alone
      for (const r of def) r.text = r.text.replace(/\.(’?)$/, '$1')
      return { term: spansOf(typeset(runsOf(m[1]))), def: spansOf(def) }
    }),
  }
}

/** One entry per book ("Matt. i. 20, 22, 24; ii. 13 ..."), wrapped lines rejoined; the book is dropped from the text and named in full above it. */
function refsOf(html: string): Block {
  const runs = typeset(runsOf(html))
  const plain = runs.map(r => r.text).join('')
  const starts: { at: number; book: string; len: number }[] = []
  for (const m of plain.matchAll(/(^|\. )((?:[1-3] )?[A-Z][a-z]+\.?) (?=[ivxlc]+\.|\d)/g)) {
    const book = findBook(m[2])
    if (book) starts.push({ at: m.index! + m[1].length, book: book.name, len: m[2].length + 1 })
  }
  const entries = starts.map((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : plain.length
    const text = plain.slice(s.at, end).replace(/\.?\s*$/, '')
    // scan with the book in place so the first reference resolves, then drop the book from the text
    const spans = spansOf(cut(runs, s.at, s.at + text.length))
    let skip = s.len
    while (skip > 0 && spans.length) {
      const first = spans[0]
      if (first.text.length <= skip) { skip -= first.text.length; spans.shift() }
      else { spans[0] = { ...first, text: first.text.slice(skip) }; skip = 0 }
    }
    return { book: s.book, spans }
  })
  return { kind: 'refs', entries }
}

/**
 * The year summary: a label and a figure per row, a label wrapped onto an indented line (or, once, a line starting
 * with a figure) joined to the row above, "-----" a sum rule and "=====" the closing double rule.
 */
function tableOf(lines: string[]): Block {
  let head = ''
  const items: ({ text: string } | { rule: true; double: boolean })[] = []
  for (const raw of lines) {
    const line = plainOf(raw)
    if (/^\s*-{3,}\s*$/.test(line)) { items.push({ rule: true, double: false }); continue }
    if (/^\s*={3,}\s*$/.test(line)) { items.push({ rule: true, double: true }); continue }
    if (!head && !items.length && !/\d/.test(line)) { head = line.trim(); continue }
    const last = items[items.length - 1]
    if (last && 'text' in last && /^(?:\s|\d|\()/.test(line)) last.text += ' ' + line
    else items.push({ text: line })
  }
  const rows: Row[] = items.map((it, i) => {
    if ('rule' in it) return { kind: 'rule', double: it.double }
    const m = /^([\s\S]*?\S)\s+(\d{1,3}(?:,\d{3})*)\s*$/.exec(it.text)
    const label = spansOf(typeset([{ text: m ? m[1] : it.text, italic: false }]))
    const prev = items[i - 1]
    return { kind: 'row', label, value: m ? m[2] : '', ...(prev && 'rule' in prev ? { total: true } : {}) }
  })
  return { kind: 'table', head, rows }
}

function preOf(html: string): Block {
  const lines = html.split('\n').filter(l => l.trim())
  if (lines.every(l => /^\s*<em>[^<]+<\/em>\s+is\s+/.test(l))) return defsOf(lines)
  if (lines.some(l => /^\s*[-=]{3,}\s*$/.test(l))) return tableOf(lines)
  return refsOf(html)
}

/** One notice: its HTML fragment to blocks, plus the footnotes it carries (`<p class="note">[1] ...</p>`). */
export function parseSection(title: string, html: string): IntroSection {
  const blocks: Block[] = [], notes: Note[] = []
  let buf = '', cls = ''
  const flush = () => {
    const runs = typeset(runsOf(buf))
    buf = ''
    if (!runs.length) return
    if (cls === 'note') {
      const m = /^\[(\d+)\]\s*/.exec(runs[0].text)
      if (m) {
        runs[0] = { ...runs[0], text: runs[0].text.slice(m[0].length) }
        notes.push({ id: m[1], spans: spansOf(runs).filter(s => s.text) })
        return
      }
    }
    blocks.push(cls === 'muted' ? { kind: 'p', spans: spansOf(runs), muted: true } : { kind: 'p', spans: spansOf(runs) })
  }
  for (const part of html.split(/(<h3>[\s\S]*?<\/h3>|<pre>[\s\S]*?<\/pre>|<\/?p\b[^>]*>|<\/?h3>)/i)) {
    if (!part) continue
    const tag = /^<(\/?)(h3|pre|p)\b([^>]*)>/i.exec(part)
    if (!tag) { buf += part; continue }
    const name = tag[2].toLowerCase()
    // the notices are cut from one page: a heading can open at the end of one fragment and close in the next,
    // so a lone </h3> makes a heading of the text before it, and a lone <h3> opens nothing
    const lone = name === 'h3' && !/^<h3>[\s\S]*<\/h3>$/i.test(part)
    const headingHtml = lone ? (tag[1] ? buf : '') : part
    if (lone) buf = ''
    flush()
    if (name === 'p') { cls = tag[1] ? '' : (/class="([^"]*)"/.exec(tag[3])?.[1] ?? ''); continue }
    cls = ''
    if (name === 'pre') { if (!tag[1]) blocks.push(preOf(part.replace(/^<pre>|<\/pre>$/gi, ''))); continue }
    const text = typeset(runsOf(headingHtml)).map(r => r.text).join('').replace(/\s*\[\d+\]/g, '')
    if (!text || (!blocks.length && repeatsTitle(title, text))) continue
    const heading = sentenceCase(text)
    if (/^chronological table\b/i.test(heading)) {
      // the table itself is its own page: the heading becomes the way there
      const i = heading.indexOf(', ')
      blocks.push({ kind: 'chronology', title: i > 0 ? heading.slice(0, i) : heading, hint: i > 0 ? heading.slice(i + 2).replace(/^[a-z]/, ch => ch.toUpperCase()) : '' })
    } else blocks.push({ kind: 'h', text: heading })
  }
  flush()
  return { title, blocks, notes }
}
