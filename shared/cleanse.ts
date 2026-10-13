/**
 * The cleanse (docs/EDITION.md, "Cleanse"): what `berean cleanse` takes out of the ministry while it is on, as the
 * app's offline layer applies it to a stored pack. rs/src/cleanse.rs is the same rule for what the server serves;
 * the two are kept in step by hand (tests/cleanse.test.ts pins this side). Nothing here rewrites what is stored:
 * every function returns a filtered copy, so `cleanse undo` shows the stored files whole again.
 *
 * - collections `other` (STEM's magazine transcriptions) and `misc` (BTP's Miscellaneous 4 and 5) are hidden whole;
 * - the footnotes of `cw`, `notes-comments` and `notes-jottings` go, with their "[n]" callers;
 * - a letter keeps its text, date, recipient and title: only the topics (`subtitle`, Bible Truth Publishers' lines) go
 *   (the recipients are L. J. L. Hodgett's list, used with his permission and credited);
 * - the Synopsis's italic-only paragraphs (a later editor's sub-headings) go; its own notes stay;
 * - "{…}" editorial notes in the text go (STEM's, in the other writings).
 */
import type { CollectionSummary, LibraryAuthor, MinistrySection, MinistrySectionMeta, WorkContents } from './ministry.js'

export const HIDDEN_COLLECTIONS: readonly string[] = ['other', 'misc']
export const NOTELESS_COLLECTIONS: readonly string[] = ['cw', 'notes-comments', 'notes-jottings']

export const collectionHidden = (collection: string) => HIDDEN_COLLECTIONS.includes(collection)
export const notesHidden = (collection: string) => NOTELESS_COLLECTIONS.includes(collection)

/** A paragraph that is a sub-heading: wholly one italic run (tools/synopsis_convert.py sets them so). */
export const SUBHEADING = /^<i>[^<]*<\/i>$/
export const isSubheading = (para: string) => SUBHEADING.test(para)
/** A section's text split as paragraphsOf splits it (shared/companion.ts). */
export const splitParas = (text: string) => text.split(/\n{2,}/).filter(p => p.trim())
/** Indices of the sub-heading paragraphs of a section's text, ascending. */
export function subheadingIndices(text: string): number[] {
  const out: number[] = []
  splitParas(text).forEach((p, i) => { if (isSubheading(p)) out.push(i) })
  return out
}
/** The paragraph index after the sub-headings before it are gone; null for a sub-heading itself. */
export function remapPara(i: number, heads: readonly number[]): number | null {
  let before = 0
  for (const h of heads) { if (h === i) return null; if (h < i) before++ }
  return i - before
}

const CALLER = /\[\d+\]/g
const BRACES = /\{[^}]*\}/g
/** "[n]" footnote callers out of a text, with the shift of a [start, end) span of the plain text that had them. */
export function stripCallers(s: string): string { return s.replace(CALLER, '') }
export function stripCallersAt(plain: string, start: number, end: number): { text: string; start: number; end: number } {
  let shift = 0
  for (const m of plain.matchAll(CALLER)) { if (m.index! + m[0].length <= start) shift += m[0].length }
  return { text: stripCallers(plain), start: start - shift, end: end - shift }
}
/** "{…}" editorial notes out, double spaces tidied. */
export const stripBraces = (s: string) => s.replace(BRACES, '').replace(/ {2,}/g, ' ').replace(/\n /g, '\n').trim()

/** A letter's listing without the topics; its recipient and title stay. */
export function cleanseLetterMeta<M extends MinistrySectionMeta>(m: M): M {
  const { subtitle: _s, ...rest } = m
  return rest as M
}

/** A section's text and notes as the cleanse shows them in `collection`. */
export function cleanseSection<S extends MinistrySection>(s: S, collection: string, n: number): S {
  let out: S = collection === 'letters' ? cleanseLetterMeta(s) : s
  let text = out.text
  if (collection === 'synopsis') text = splitParas(text).filter(p => !isSubheading(p)).join('\n\n')
  if (notesHidden(collection)) { text = stripCallers(text).replace(/^ +/, ''); if (out.notes) { const { notes: _n, ...rest } = out; out = rest as S } }
  text = stripBraces(text)
  return text === out.text ? out : { ...out, text }
}
export const cleanseMetas = <M extends MinistrySectionMeta>(metas: readonly M[], collection: string): M[] =>
  (collection === 'letters' ? metas.map(m => cleanseLetterMeta(m)) : [...metas])
export function cleanseContents(c: WorkContents): WorkContents {
  return c.work.collection === 'letters' ? { ...c, sections: cleanseMetas(c.sections, 'letters') } : c
}

/** An author's library entry without the hidden collections. */
export function cleanseAuthor(a: LibraryAuthor): LibraryAuthor {
  const collections: CollectionSummary[] = a.collections.filter(c => !collectionHidden(c.id))
  return collections.length === a.collections.length ? a : { ...a, collections }
}
/** The collection each work of an author is in. */
export function collectionsByWork(a: LibraryAuthor): Map<string, string> {
  const m = new Map<string, string>()
  for (const c of a.collections) for (const w of c.works) m.set(w.id, c.id)
  return m
}
