/**
 * Other wordings for a plain question in the ministry search (GET /api/ministry/expand, docs/SEARCH_EXPAND.md): when
 * to ask, and the answer as the screen shows it. Nothing is kept here: the server keeps each question's answer and counts
 * it again, in the edition shown, every time it is asked.
 */
import type { Expansion, SuggestedVerse, Suggestion } from '@shared/ministry'
import { parseRef } from '@shared/ref'
import { get } from './api'

/** Fewer paragraphs than this from the words search, and other wordings are worth asking for. */
export const ASK_BELOW = 5
const MIN_WORDS = 3

/** Runs of letters and digits, an apostrophe inside a word not parting it, as the server counts them (ministry.rs `words`). */
const wordCount = (q: string) => q.replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).length

/**
 * Whether to ask for other wordings of `query`: a plain question of three words or more, not a Bible reference, that
 * the words search found fewer than ASK_BELOW paragraphs for (`found`; null until it has answered).
 */
export function shouldExpand(query: string, found: number | null): boolean {
  return found !== null && found < ASK_BELOW && wordCount(query) >= MIN_WORDS && !parseRef(query, { english: true })
}

const isSuggestion = (s: unknown): s is Suggestion => typeof (s as Suggestion | null)?.text === 'string' && typeof (s as Suggestion).total === 'number'
const isVerse = (v: unknown): v is SuggestedVerse => {
  const x = v as SuggestedVerse | null
  return !!x && [x.book, x.chapter, x.verse, x.total].every(n => typeof n === 'number')
}
const isExpansion = (r: unknown): r is Expansion => {
  const e = r as Expansion | null
  return !!e && e.state === 'ok' && typeof e.q === 'string' && Array.isArray(e.phrases) && Array.isArray(e.verses) && Array.isArray(e.related)
    && e.phrases.every(isSuggestion) && e.verses.every(isVerse) && e.related.every(isSuggestion)
}

/** The other wordings to show for `query`, each finding something; null for none: the server asks no model, is busy,
 *  finds nothing for any of them, answers something else, or cannot be reached. */
export async function loadExpansion(query: string): Promise<Expansion | null> {
  let r: unknown
  try { r = await get<unknown>(`/ministry/expand?q=${encodeURIComponent(query.trim())}`) } catch { return null }
  if (!isExpansion(r)) return null
  const e: Expansion = { ...r, phrases: r.phrases.filter(s => s.total > 0), verses: r.verses.filter(v => v.total > 0), related: r.related.filter(s => s.total > 0) }
  return e.phrases.length || e.verses.length || e.related.length ? e : null
}
