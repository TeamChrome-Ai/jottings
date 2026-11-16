/**
 * A paragraph of the library as a line of an outline (docs/ASSISTANT.md, "A paragraph of the library as a line"): what
 * Ask's write tools make of a paragraph given by its id. The line is a link, as the editor keeps one: its words name
 * the writer, the work and the section, as the sources under an answer name them, and its address is the app's own web
 * address of that paragraph. So a note that says what a writer of the library wrote has, on the line after it, the
 * paragraph the reader can check it by: in the app (the address is read back as the place it opens, and no browser is
 * asked), and from an outline that is shared or printed (the address is the site's, which opens the same paragraph).
 */
import { BRAND, siteUrl } from '@shared/brand'
import type { ParagraphRef } from '@shared/assistantTools'
import { MINISTRY_AUTHORS } from '@shared/ministry'

type Place = Pick<ParagraphRef, 'author' | 'work' | 'n' | 'para' | 'section'>
/** The most a link's words may be, as the editor and Ask's tools hold a link's label to. */
const LABEL_CHARS = 200

/** "Darby, Collected Writings 12, On assurance": the writer as the sources under an answer name them, the work, and
 *  the section when it has a name of its own. A writer the app has no name for is given by the library's word. */
export function paragraphLabel(p: Place): string {
  const writer = MINISTRY_AUTHORS.find(a => a.id === p.author)?.short ?? p.author
  const section = (p.section ?? '').trim()
  const words = [writer, p.work.title, ...(section && section !== p.work.title ? [section] : [])].join(', ')
  return words.length > LABEL_CHARS ? `${words.slice(0, LABEL_CHARS - 1).trimEnd()}…` : words
}

/** The app's own web address of a paragraph: the site, the library's screen, and the paragraph's place there (its
 *  writer, its work, the section's number and the paragraph's), as the app's own links into the library carry it. */
export const paragraphAddress = (p: Place): string =>
  siteUrl(`/companion?author=${encodeURIComponent(p.author)}&work=${encodeURIComponent(p.work.id)}&n=${p.n}&p=${p.para}`)

export interface ParagraphRoute { pathname: '/companion'; params: { author: string; work: string; n: string; p: string } }
/** The place in the app an address opens, when it is the app's own address of a paragraph (at the site, or at an
 *  address the site had before); null for any other address, which is the browser's to open. Read by hand: the
 *  address parser of the phone's runtime does not give the parts of a query. */
export function paragraphRoute(url: string): ParagraphRoute | null {
  const m = /^https?:\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?(?:#.*)?$/i.exec(url.trim())
  if (!m) return null
  const host = m[1].toLowerCase().replace(/^www\./, '')
  if (![BRAND.host, ...BRAND.extraHosts].includes(host) || (m[2] ?? '/') !== '/companion') return null
  const q = new Map<string, string>()
  for (const pair of (m[3] ?? '').split('&')) {
    const at = pair.indexOf('=')
    if (at < 1) continue
    try { q.set(decodeURIComponent(pair.slice(0, at)), decodeURIComponent(pair.slice(at + 1).replace(/\+/g, ' '))) } catch { return null }
  }
  const [author, work, n, p] = ['author', 'work', 'n', 'p'].map(k => q.get(k) ?? '')
  if (!author || !work || !/^\d+$/.test(n) || !/^\d+$/.test(p)) return null
  return { pathname: '/companion', params: { author, work, n, p } }
}

/** A link line of an outline, as much of it as this needs. */
type Link = { text?: string | null; url?: string | null }
/**
 * Whether a link line is shown by its words alone, in the app: when its address is the app's own for a paragraph and
 * it has words. The words say where it goes (the writer, the work, the section) and a tap opens it, so the address
 * under them, the same long line for every such link of a jotting, tells the reader nothing more. Not any address of
 * the site (a shared jotting's, a chapter's): only a paragraph's. Any other link, which the reader put in themselves,
 * is shown as it always was.
 */
export const shownByWords = (i: Link): boolean => !!(i.text ?? '').trim() && paragraphRoute(i.url ?? '') !== null

/** A link line on paper: its words (its address, when it has none), and for a paragraph line its address too, which
 *  nobody can tap there. Another link with words is printed by them alone, as it always was. */
export const printedLink = (i: Link): { words: string; address: string | null } =>
  ({ words: (i.text ?? '').trim() ? i.text! : i.url ?? '', address: shownByWords(i) ? i.url! : null })
