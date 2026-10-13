import type { Note } from '@shared/types'

/**
 * Footnote letters (tests/noteLetters.test.ts). The printed edition letters its notes a, b, c … afresh on every page,
 * so a chapter that ran over two pages reads a–i and then a–e again in the app, which has no pages (Leviticus 1).
 * `chapter` letters the notes once through the chapter instead, a note printed at several words keeping its one
 * letter; `printed` shows the letters as the 1961 edition prints them, for reading beside the book.
 */
export type NoteLetters = 'chapter' | 'printed'
export const NOTE_LETTERS: readonly NoteLetters[] = ['chapter', 'printed']

/** 0 → a … 25 → z, 26 → aa, 27 → ab … */
export function letterAt(i: number): string {
  let s = ''
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(97 + (n % 26)) + s
  return s
}

/** The printed letters, a–z only (the divine-name marks · † and the like are not letters). */
export const isLettered = (n: Pick<Note, 'marker'>) => /^[a-z]+$/.test(n.marker)

/**
 * The chapter's verses with every lettered note's marker replaced by its place in the chapter: the first distinct
 * note is a, the next b … The same note at several words (one text, placed more than once) is the same letter.
 * `printed` returns the verses as they are.
 */
export function relabel<V extends { notes?: Note[] }>(verses: V[], mode: NoteLetters): V[] {
  if (mode === 'printed') return verses
  const letters = new Map<string, string>()
  let changed = false
  const out = verses.map(v => {
    if (!v.notes?.length) return v
    const notes = v.notes.map(n => {
      if (!isLettered(n)) return n
      const key = n.text ?? ''
      let l = letters.get(key)
      if (l === undefined) { l = letterAt(letters.size); letters.set(key, l) }
      if (l === n.marker) return n
      changed = true
      return { ...n, marker: l }
    })
    return notes.some((n, i) => n !== v.notes![i]) ? { ...v, notes } : v
  })
  return changed ? out : verses
}
