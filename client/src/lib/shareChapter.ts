import { book as bookMeta } from './bible'
import { getApiBase } from './api'
import { siteOrigin } from './outlines'
import { shareText } from './share'

/** The link to a chapter: it opens the reader there, and a shared link shows the chapter's name and opening words. */
export const chapterUrl = (book: number, chapter: number) => `${getApiBase() || siteOrigin()}/read/${book}/${chapter}`

/** Shares a chapter by its link (the share sheet, or the clipboard where there is none). */
export function shareChapter(book: number, chapter: number) {
  const label = `${bookMeta(book).name} ${chapter}`
  return shareText({ title: label, message: `${label} (Darby)`, url: chapterUrl(book, chapter) })
}
