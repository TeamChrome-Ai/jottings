import type { Chapter, Note } from './types.js'
import { inScopeRanges } from './bookGroups.js'
import { AS_WRITTEN, IRREGULAR, isLookupWord, nameKey, spellLigatures, wordForms } from './cbd.js'

export type FootnoteIndexFile = Readonly<Record<string, readonly (readonly number[])[]>>

export interface FootnotePlace { readonly book: number; readonly chapter: number; readonly verse: number; readonly note: number }
export interface FootnoteEntry extends FootnotePlace { readonly textId: number }
export type FootnoteIndex = ReadonlyMap<string, readonly FootnoteEntry[]>
export interface FootnoteGroup { readonly places: readonly FootnotePlace[] }

export const isLettered = (n: Pick<Note, 'marker'>) => /^[a-z]+$/.test(n.marker)

export const wordKey = (word: string): string => nameKey(spellLigatures(word).replace(/['’]s$/i, ''))

const PLURAL_OF: Record<string, string> = Object.fromEntries(Object.entries(IRREGULAR).map(([plural, one]) => [one, plural]))

export function footnoteKeys(word: string): string[] {
  const k = wordKey(word)
  if (!k) return []
  const out = new Set([k, ...wordForms(spellLigatures(word))])
  if (k.length <= AS_WRITTEN) out.add(k + 's')
  const other = IRREGULAR[k] ?? PLURAL_OF[k]
  if (other) out.add(other)
  return [...out]
}

export function footnoteWord(q: string): string | null {
  const w = q.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
  return /^\p{L}+(?:[-'’]\p{L}+)*$/u.test(w) && isLookupWord(w) ? w : null
}

export function buildFootnoteIndex(file: FootnoteIndexFile): FootnoteIndex {
  const index = new Map<string, FootnoteEntry[]>()
  for (const [word, notes] of Object.entries(file)) {
    const k = wordKey(word)
    let list = index.get(k)
    if (!list) index.set(k, list = [])
    for (const [book, chapter, verse, note, textId] of notes) list.push({ book, chapter, verse, note, textId })
  }
  return index
}

const bibleOrder = (a: FootnotePlace, b: FootnotePlace) => a.book - b.book || a.chapter - b.chapter || a.verse - b.verse || a.note - b.note

export function footnotesOn(index: FootnoteIndex, word: string, scope = 'all'): { notes: number; groups: FootnoteGroup[] } | null {
  const w = footnoteWord(word)
  if (!w) return null
  const seen = new Set<string>()
  const byText = new Map<number, FootnotePlace[]>()
  for (const k of footnoteKeys(w)) {
    for (const e of index.get(k) ?? []) {
      const id = `${e.book}.${e.chapter}.${e.verse}.${e.note}`
      if (seen.has(id) || !inScopeRanges(e.book, scope)) continue
      seen.add(id)
      const place = { book: e.book, chapter: e.chapter, verse: e.verse, note: e.note }
      const group = byText.get(e.textId)
      if (group) group.push(place)
      else byText.set(e.textId, [place])
    }
  }
  if (!seen.size) return null
  const groups = [...byText.values()].map(places => ({ places: places.sort(bibleOrder) }))
  groups.sort((a, b) => b.places.length - a.places.length || bibleOrder(a.places[0], b.places[0]))
  return { notes: seen.size, groups }
}

export function noteAt(chapter: Pick<Chapter, 'verses'>, p: FootnotePlace): string | null {
  const n = chapter.verses.find(v => v.v === p.verse)?.notes?.[p.note]
  return n && isLettered(n) ? n.text : null
}
