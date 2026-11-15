import { BOOKS } from '@shared/books'
import { ownChapters } from '@shared/texts'

export interface BookPaneChapter {
  /** The number printed on the cell. */
  label: string
  /** The English chapter the cell opens. */
  chapter: number
  /** Where that printed chapter begins, when it is not verse 1 (French Joel's 3 begins at English 2:28). */
  verse?: number
}

/** The open book's chapter cells, as the Bible shown prints them. Each opens at the English verse that chapter begins at. */
export function bookPaneChapters(book: number): BookPaneChapter[] {
  if (!BOOKS[book - 1]) return []
  return ownChapters(book).map(({ n, c, v }) => ({ label: String(n), chapter: c, ...(v > 1 ? { verse: v } : {}) }))
}
