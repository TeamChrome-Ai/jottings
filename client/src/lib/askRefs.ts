/**
 * The Bible references in Ask's answers (app/ask.tsx): which words of a sentence are a link to a verse, and which
 * sentences rest on a verse a tool gave. All of it is read in the app from the answer's own text with the scanner the
 * notes use (shared/ref.ts `scanRefs`): no tool is called for it, no model, and nothing is sent anywhere. Pure.
 *
 * Ask's references are numbered as the English Bible is, whatever Bible the reader has open: every source it is given
 * is (its tools search and read J. N. Darby's English, the library cites it), and the app's own tools read the model's
 * references the same way (assistantActions.ts `place`). The book's name and a German comma are the reader's.
 */
import { toolRow, type ChatMessage, type Sentence } from '@shared/assistantTools'
import { scanRefs, type Ref } from '@shared/ref'
import { isPlace } from './backupFile'

/** A stretch of an answer's sentence: plain words, or a reference that opens `ref`. */
export interface AnswerRun { text: string; ref?: Ref }

/** A reference the Bible has: the book has that chapter and the chapter those verses. */
const exists = (r: Ref): boolean => isPlace(r.book, r.chapter, r.v1 ?? null) && isPlace(r.book, r.chapter, r.v2 ?? null) && (r.v1 === undefined || r.v2 === undefined || r.v2 >= r.v1)

/** The book's name as it stands in a reference ("Rom." of "Rom. 8:1-4"). */
const nameOf = (written: string): string => /^(?:[1-3]\.?\s?)?(\p{L}+\.?)/u.exec(written)?.[1] ?? ''

/**
 * The references in `text` that are links, each with where it stands. One that does not exist ("John 3:99", "Jude 40")
 * is left as words. So is a chapter under a name of two letters with no stop ("Is 5", "Am 3", "He 2"): in an answer
 * those are more often words than Isaiah, Amos or Hebrews; with a verse or a stop ("Is 53:5", "Ps. 23") they are read.
 */
export function answerRefs(text: string): { start: number; end: number; ref: Ref }[] {
  return scanRefs(text, undefined, { englishNumbers: true }).filter(s => {
    if (!exists(s.ref)) return false
    const name = nameOf(text.slice(s.start, s.end))
    return s.ref.v1 !== undefined || name.length !== 2
  })
}

/** A sentence's words as runs, in order: the references that are links, and the words between them. */
export function answerRuns(text: string): AnswerRun[] {
  const out: AnswerRun[] = []
  let at = 0
  for (const s of answerRefs(text)) {
    if (s.start < at) continue
    if (s.start > at) out.push({ text: text.slice(at, s.start) })
    out.push({ text: text.slice(s.start, s.end), ref: s.ref })
    at = s.end
  }
  if (at < text.length) out.push({ text: text.slice(at) })
  return out
}

/** A part of a sentence as the screen draws it: words, a reference that opens its verse, or the number of a library
 *  paragraph the sentence rests on (`cite`: its id; `text`: its number among the answer's sources, as a superior
 *  figure). */
export type SentencePart = AnswerRun | { text: string; cite: number }

const SUPERIOR = '⁰¹²³⁴⁵⁶⁷⁸⁹'
/** A space of plain words that does not break: a number is never left alone at the start of a line. A whole space,
 *  not a narrow one: with less between them the numbers 1 and 3 read as 13. */
const GAP = '\u00A0'

/**
 * A sentence with the numbers of its sources, in order: its words with their references, whole and as the model wrote
 * them, then the number of each paragraph it rests on that `number` knows (lib/askSources.ts: the conversation can
 * place it), once each. A number is a superior figure of the reading face, as a footnote's caller is in the library
 * (lib/intro.ts `superscript`), and stands on the sentence it follows. Nothing of a work's title is among the
 * sentences, so none is read for references ("Notes on Romans 8" is a title): the author and the work are in the list
 * under the answer. A space of plain words that does not break stands between two numbers, and between a reference that ends the
 * sentence and the number after it, so they are two links, never one run of accent.
 */
export function sentenceParts(s: Pick<Sentence, 'text' | 'ids'>, number: (id: number) => number | null): SentencePart[] {
  const out: SentencePart[] = answerRuns(s.text)
  const seen = new Set<number>()
  for (const id of s.ids) {
    const n = seen.has(id) ? null : number(id)
    if (n === null) continue
    seen.add(id)
    const before = out[out.length - 1]
    if (before && ('cite' in before || before.ref)) out.push({ text: GAP })
    out.push({ text: String(n).replace(/\d/g, d => SUPERIOR[+d]), cite: id })
  }
  return out
}

/** The tools whose results are verses of the Bible. */
const BIBLE_TOOLS = new Set(['search_bible', 'read_verses'])
const key = (book: number, chapter: number, verse: number) => `${book}.${chapter}.${verse}`
const whole = (v: unknown): v is number => Number.isInteger(v)

/**
 * The verses the Bible tools gave for the reader's latest message, as "book.chapter.verse": search_bible's verses, and
 * read_verses' verses of the book and chapter it names. A result of any other tool, or of an earlier message, gives none.
 */
export function suppliedVerses(messages: readonly ChatMessage[]): Set<string> {
  const names = new Map(messages.flatMap(m => (m.role === 'assistant' ? m.tool_calls ?? [] : [])).map(c => [c.id, c.function.name]))
  const latest = messages.map(m => m.role).lastIndexOf('user')
  const out = new Set<string>()
  for (const m of messages.slice(latest + 1)) {
    if (m.role !== 'tool') continue
    const name = names.get(m.tool_call_id)
    if (!name || !BIBLE_TOOLS.has(name) || toolRow(name)?.runs !== 'server') continue
    let v: { book?: unknown; chapter?: unknown; verses?: { book?: unknown; chapter?: unknown; verse?: unknown }[] }
    try { v = JSON.parse(m.content) } catch { continue }
    if (!v || !Array.isArray(v.verses)) continue
    for (const x of v.verses) {
      if (!x) continue
      const book = x.book ?? v.book, chapter = x.chapter ?? v.chapter, verse = x.verse
      if (whole(book) && whole(chapter) && whole(verse)) out.add(key(book, chapter, verse))
    }
  }
  return out
}

/** Whether a sentence gives one of the `supplied` verses: a verse or a range that holds one, or a chapter that does. */
function givesOne(text: string, supplied: ReadonlySet<string>): boolean {
  return answerRefs(text).some(({ ref }) => {
    if (ref.v1 === undefined) { const chapter = `${ref.book}.${ref.chapter}.`; for (const k of supplied) if (k.startsWith(chapter)) return true; return false }
    for (let v = ref.v1; v <= (ref.v2 ?? ref.v1); v++) if (supplied.has(key(ref.book, ref.chapter, v))) return true
    return false
  })
}

/**
 * An answer's sentences as the screen keeps them. The server marks a sentence of an answer from the library that names
 * no paragraph as resting on nothing (`supported: false`, shown with "no source" after it); it reads no references out of prose. A sentence
 * that gives a verse the Bible tools supplied for this message rests on that verse, so here it is supported. Settled
 * when the answer arrives, while `messages` still hold the tools' results: after the reader's next message only their
 * stand-ins are kept.
 */
export function withVerses(sentences: readonly Sentence[], messages: readonly ChatMessage[]): Sentence[] {
  if (sentences.every(s => s.supported)) return [...sentences]
  const supplied = suppliedVerses(messages)
  if (!supplied.size) return [...sentences]
  return sentences.map(s => (s.supported || !givesOne(s.text, supplied) ? s : { ...s, supported: true }))
}
