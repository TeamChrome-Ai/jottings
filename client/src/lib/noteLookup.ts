// The lookups behind a jotting's links (lib/noteLinks.ts): which verse a line of scripture written out is, and where a
// mention of ministry opens.
import { router } from 'expo-router'
import type { Ref } from '@shared/ref'
import type { SearchResponse } from '@shared/types'
import { get } from './api'
import { loadCompanionIndex } from './companion'
import { searchLocal } from './localSearch'
import { quotePhrases, type MinistryTarget } from './noteLinks'

type Verse = { book: number; chapter: number; verse: number }
/** The one verse a phrase is found in, word for word; null when none, or several (a refrain, a common phrase). */
async function onlyVerse(phrase: string): Promise<Verse | null> {
  const q = `"${phrase}"`
  const r = await searchLocal(q, 'all', 3).catch(() => null) ?? await get<SearchResponse>(`/search?q=${encodeURIComponent(q)}&limit=3`).catch(() => null)
  if (!r || r.kind !== 'text' || !r.hits.length) return null
  const first = r.hits[0]
  return r.hits.every(h => h.book === first.book && h.chapter === first.chapter && h.verse === first.verse) ? { book: first.book, chapter: first.chapter, verse: first.verse } : null
}

const found = new Map<string, Promise<Ref | null>>()
/**
 * The verse (or the run of verses) a line of scripture written out is: the whole line found in one verse; else its
 * opening words and its closing words, each in one verse of the same chapter, a few verses apart; else its opening words
 * alone, for a line quoted from another translation that starts as Darby's does. Kept for the launch.
 */
export function findQuote(text: string): Promise<Ref | null> {
  const key = text.trim().toLowerCase()
  let p = found.get(key)
  if (!p) {
    p = (async () => {
      const phrases = quotePhrases(text)
      if (!phrases.length) return null
      const whole = await onlyVerse(phrases[0])
      if (whole) return { book: whole.book, chapter: whole.chapter, v1: whole.verse }
      if (phrases.length < 3) return null
      const [head, tail] = await Promise.all([onlyVerse(phrases[1]), onlyVerse(phrases[2])])
      if (head && tail && head.book === tail.book && head.chapter === tail.chapter && tail.verse >= head.verse && tail.verse - head.verse <= 10)
        return tail.verse > head.verse ? { book: head.book, chapter: head.chapter, v1: head.verse, v2: tail.verse } : { book: head.book, chapter: head.chapter, v1: head.verse }
      return head ? { book: head.book, chapter: head.chapter, v1: head.verse } : null
    })().catch(() => null)
    found.set(key, p)
  }
  return p
}

/** Opens what a mention of ministry is about: the author on the passage (the reader, with the ministry open at that
 *  author), the author's work that goes through the book most, or the author's shelf. */
export async function openMinistry(t: MinistryTarget) {
  if (t.ref) {
    router.push({ pathname: '/read/[book]/[chapter]', params: { book: String(t.ref.book), chapter: String(t.ref.chapter), v: t.ref.v1 ? String(t.ref.v1) : '', v2: t.ref.v2 ? String(t.ref.v2) : '', ministry: t.author } })
    return
  }
  // the companion holds Darby's Synopsis and Coates; another author opens on his shelf of the library
  if (t.book && (t.author === 'darby' || t.author === 'coates')) {
    const index = await loadCompanionIndex(t.author).catch(() => null)
    let best: { work: string; n: number; count: number } | null = null
    for (const w of index?.works ?? []) {
      const hits = w.sections.map((s, i) => [s, i] as const).filter(([s]) => s.passages.some(p => p[0] === t.book))
      if (hits.length && (!best || hits.length > best.count)) best = { work: w.id, n: hits[0][1] + 1, count: hits.length }
    }
    if (best) { router.push({ pathname: '/companion', params: { author: t.author, work: best.work, n: String(best.n) } }); return }
  }
  router.push({ pathname: '/companion', params: { author: t.author } })
}
