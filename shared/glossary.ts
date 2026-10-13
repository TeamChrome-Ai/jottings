/**
 * Darby's own terms: a small glossary (data/glossary/darby.json) of words he uses in his own sense, each with one
 * sentence of his where he defines or uses it. The word sheet shows the matching entry first when a tapped word (or
 * a two-word phrase around it) is a term or an alias; the dictionary lists the entries as "Darby's terms".
 */
import type { WordTap } from './wordTap.js'

export interface GlossarySource { author: string; work: string; n: number; quote: string }
export interface GlossaryEntry {
  /** As listed: "the assembly", "position and state". */
  term: string
  /** Other spellings and the single words a reader taps ("assemblies", "old man"). */
  aliases: string[]
  /** One sentence, his usage, in our words. */
  short: string
  source: GlossarySource
}

/** Letters and digits only, lower case: "the Lord’s table", "Lords table" and "lord's-table" are one key. */
export const termKey = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** A term without its leading article: "the assembly" is keyed as "assembly" too, and the sheet's title says "assembly". */
export const bareTerm = (s: string) => s.replace(/^(the|a|an)\s+/i, '')
const bare = bareTerm

/** Singular and plural of a key, so "assemblies" finds "assembly" and "gift" finds "gifts". */
function forms(key: string): string[] {
  const out = [key]
  const push = (s: string) => { if (s.length >= 3 && !out.includes(s)) out.push(s) }
  if (key.endsWith('ies')) push(key.slice(0, -3) + 'y')
  if (/(?:s|x|z|ch|sh)es$/.test(key)) push(key.slice(0, -2))
  if (key.endsWith('s') && !key.endsWith('ss')) push(key.slice(0, -1))
  if (key.endsWith('y')) push(key.slice(0, -1) + 'ies')
  push(key + 's')
  return out
}

export interface Glossary { entries: GlossaryEntry[]; byKey: Map<string, GlossaryEntry> }

/** The lookup table: every term and alias, with and without its article, singular and plural. The first entry to claim a key keeps it. */
export function buildGlossary(entries: GlossaryEntry[]): Glossary {
  const byKey = new Map<string, GlossaryEntry>()
  for (const e of entries) {
    for (const name of [e.term, ...e.aliases]) {
      for (const k of new Set([termKey(name), termKey(bare(name))])) for (const f of forms(k)) if (f && !byKey.has(f)) byKey.set(f, e)
    }
  }
  return { entries, byKey }
}

/** The possessive off a tapped word: "Lord’s" stays (it opens "the Lord’s table" with its neighbour), "assembly’s" is "assembly". */
const unpossess = (w: string) => w.replace(/[’']s$/i, '')

/**
 * The entry for a tap: the two-word phrases around the word first ("old man", "Lord’s table", "heavenly calling"),
 * then the word itself, singular or plural, possessive off. Null when Darby has no term here.
 */
export function lookupGlossary(g: Glossary, tap: WordTap): GlossaryEntry | null {
  const tries = [tap.prev && `${tap.prev} ${tap.word}`, tap.next && `${tap.word} ${tap.next}`, tap.word, unpossess(tap.word)].filter((s): s is string => !!s)
  for (const t of tries) { const e = g.byKey.get(termKey(t)); if (e) return e }
  return null
}

/** The entry listed under `term` (the dictionary's list opens by term). */
export const glossaryTerm = (g: Glossary, term: string) => g.entries.find(e => e.term === term) ?? null

/** Entries in the order the dictionary lists them: alphabetical by the term without its article. */
export const glossaryList = (g: Glossary) => [...g.entries].sort((a, b) => bare(a.term).localeCompare(bare(b.term), 'en'))

/**
 * A section's text as the glossary quotes it: markup and footnote markers out, whitespace folded. The corpus files
 * carry `<i>` and `[n]`; a quote is a plain sentence.
 */
export const plainText = (text: string) => text.replace(/<[^>]+>/g, '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim()
