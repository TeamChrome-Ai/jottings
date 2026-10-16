import { BOOKS } from '@shared/books'
import type { Outline } from '@shared/types'

/** A jotting of the reader's own holding every word searched for. */
export interface OutlineMatch { id: number; title: string; snippet: string; updated_at: string }

/** The words a search asks for, as rs/src/outlines.rs `search_mine` splits them: lower case, at most eight. */
export const searchWords = (q: string): string[] => q.toLowerCase().split(/[^\p{L}\p{N}':]+/u).filter(Boolean).slice(0, 8)

/** What a jotting says, a line each: its title, description, notes and links, and its passages by book name. */
export function outlineLines(o: Pick<Outline, 'title' | 'description' | 'items'>): string[] {
  const lines = [o.title, o.description ?? '']
  for (const i of o.items ?? []) {
    if (i.kind === 'verse') { const b = i.book ? BOOKS[i.book - 1] : undefined; if (b && i.chapter) lines.push(i.v1 ? `${b.name} ${i.chapter}:${i.v1}` : `${b.name} ${i.chapter}`) }
    else if (i.text?.trim()) lines.push(i.text)
  }
  return lines
}

/** About 120 characters of `line` around the first `word`. */
export function clip(line: string, word: string): string {
  const flat = line.split(/\s+/).filter(Boolean).join(' ')
  const chars = [...flat]
  const at = flat.toLowerCase().indexOf(word)
  const before = at < 0 ? 0 : [...flat.slice(0, at)].length
  // start on a word: back from 50 characters before the word to the space before it
  let a = Math.max(0, before - 50)
  while (a > 0 && chars[a - 1] !== ' ') a--
  const b = Math.min(chars.length, a + 120)
  return `${a > 0 ? '…' : ''}${chars.slice(a, b).join('')}${b < chars.length ? '…' : ''}`
}

/** The match for one jotting, or null when a word is missing from it. */
export function matchOutline(o: Pick<Outline, 'id' | 'title' | 'description' | 'items' | 'updated_at'>, words: readonly string[]): OutlineMatch | null {
  if (!words.length) return null
  const lines = outlineLines(o)
  const all = lines.join('\n').toLowerCase()
  if (!words.every(w => all.includes(w))) return null
  const line = lines.slice(1).find(l => l.toLowerCase().includes(words[0]))
  return { id: o.id, title: o.title, snippet: line ? clip(line, words[0]) : '', updated_at: o.updated_at }
}
