/**
 * What the search field holds, as Search reads it before it searches anything (app/(tabs)/search.tsx `run`): a Strong's
 * number opens the word sheet, a reference opens its chapter, and everything else is words to search. Go and the Ask
 * bubble (lib/askDraft.ts) both read the field through here, so the bubble never carries what Go would open. Pure.
 */
import type { BookMeta } from '@shared/books'
import { strongsCode } from '@shared/concordance'
import { bareBook, parseRef, type Ref } from '@shared/ref'

export type Typed =
  | { kind: 'empty' }
  /** "G1320", "h430": the number in the tags' spelling */
  | { kind: 'strongs'; code: string }
  /** "jn 3:16", "1 cor 13"; `near`: the book was misspelt ("Jhon 3:16") */
  | { kind: 'ref'; ref: Ref; near: boolean }
  /** `book`: the words are also a book's name and nothing more ("song", "mark"), searched as a word with the book offered */
  | { kind: 'words'; book: BookMeta | undefined }

export function readField(text: string): Typed {
  const query = text.trim()
  if (!query) return { kind: 'empty' }
  const code = strongsCode(query)
  if (code) return { kind: 'strongs', code }
  const ref = parseRef(query)
  const book = bareBook(query)
  if (ref && !book) return { kind: 'ref', ref, near: false }
  // a misspelt book still makes a reference when a chapter or verse follows it; a bare misspelt name ("Pslams") is words
  if (!book && /\d/.test(query)) {
    const near = parseRef(query, { fuzzy: true })
    if (near) return { kind: 'ref', ref: near, near: true }
  }
  return { kind: 'words', book }
}
