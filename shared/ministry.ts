/**
 * Ministry on a verse: the written ministry of the authors in the registry below, indexed by the verses it refers to
 * (tools/ministry_index.ts builds data/ministry.db; rs/src/ministry.rs serves it). The registry is the one list of
 * authors: the index is built only from `enabled` ones, the server answers only for those, and the app shows only what
 * the server sends, so an author is switched on by a data rebuild alone.
 */
import type { Passage, Section, SectionMeta, WorkKind } from './companion.js'
import type { Figure } from './figures.js'
import { N_, t } from './i18n.js'

export interface MinistryAuthor {
  id: string
  /** As a heading: "J. N. Darby". */
  name: string
  /** In a segment or a label: "Darby". */
  short: string
  born: number
  died: number
  /** Shipped and served. Disabled authors have no data and never reach the app. */
  enabled: boolean
  /** Why the text may be shown: the licence reasoning in one line (data/ministry/SOURCE.md has the rest). */
  licence: string
  /** The credit under every reading. */
  source: string
  /**
   * Where the author's corpus is converted and which works of it ship.
   */
  corpus: string
}

/** The order the library, the ministry sheet and the Home line give them (the owner's, 2026-10-16): Mr. Darby, then
 *  Mr. Raven, then the rest by when their ministry was published: Bellett, Wigram, Stoney, Coates. */
export const MINISTRY_AUTHORS: readonly MinistryAuthor[] = [
  {
    id: 'darby', name: 'J. N. Darby', short: 'Darby', born: 1800, died: 1882, enabled: true,
    licence: 'Died 1882: public domain everywhere.',
    source: N_('J. N. Darby (1800–1882). Text from Bible Truth Publishers’ online library; public domain.'),
    corpus: 'tools/ministry_convert.py (Collected Writings, Notes and Comments, Notes and Jottings, Letters, Miscellaneous Writings, other writings) and tools/synopsis_convert.py (the Synopsis)',
  },
  {
    id: 'raven', name: 'F. E. Raven', short: 'Raven', born: 1837, died: 1903, enabled: true,
    licence: 'Died 1903; addresses of 1895–1903, printed in or soon after his lifetime: public domain (data/ministry/raven/SOURCE.md).',
    source: N_('F. E. Raven (1837–1903); public domain.'),
    corpus: 'tools/mse_authors.py raven (the 20 volumes of his ministry)',
  },
  {
    id: 'bellett', name: 'J. G. Bellett', short: 'Bellett', born: 1795, died: 1864, enabled: true,
    licence: 'Died 1864: public domain everywhere.',
    source: N_('J. G. Bellett (1795–1864). Text from Bible Truth Publishers’ online library; public domain.'),
    corpus: 'tools/btp_authors.py (his books on Bible Truth Publishers’ library)',
  },
  {
    id: 'wigram', name: 'G. V. Wigram', short: 'Wigram', born: 1805, died: 1879, enabled: true,
    licence: 'Died 1879: public domain everywhere.',
    source: N_('G. V. Wigram (1805–1879). Text from Bible Truth Publishers’ online library; public domain.'),
    corpus: 'tools/btp_authors.py (his books on Bible Truth Publishers’ library)',
  },
  {
    id: 'stoney', name: 'J. B. Stoney', short: 'Stoney', born: 1814, died: 1897, enabled: true,
    licence: 'Died 1897; addresses of 1859–1896, printed in or soon after his lifetime: public domain (data/ministry/stoney/SOURCE.md).',
    source: N_('J. B. Stoney (1814–1897); public domain.'),
    corpus: 'tools/mse_authors.py stoney (the 13 volumes of his ministry)',
  },
  {
    id: 'coates', name: 'C. A. Coates', short: 'Coates', born: 1862, died: 1945, enabled: true,
    licence: 'Died 1945. The edition’s publisher claims no copyright in it (data/coates/SOURCE.md).',
    source: N_('C. A. Coates (1862–1945); public domain.'),
    corpus: 'tools/coates_convert.py --all (the whole collected edition, 40 works)',
  },
  // placeholders: the structure is ready, nothing is converted and nothing reaches the app
  { id: 'kelly', name: 'W. Kelly', short: 'Kelly', born: 1821, died: 1906, enabled: false, licence: 'Died 1906: public domain everywhere.', source: '', corpus: '' },
  { id: 'mackintosh', name: 'C. H. Mackintosh', short: 'Mackintosh', born: 1820, died: 1896, enabled: false, licence: 'Died 1896: public domain everywhere.', source: '', corpus: '' },
  { id: 'taylor', name: 'J. Taylor Sr.', short: 'Taylor', born: 1870, died: 1953, enabled: false, licence: 'Died 1953: in copyright in the UK until 2024, and in the US by publication date; needs the publisher’s permission.', source: '', corpus: '' },
]
export const enabledAuthors = () => MINISTRY_AUTHORS.filter(a => a.enabled)
/** The enabled authors by surname, in order, but those `hidden`: "Darby, Raven, Bellett, Wigram, Stoney and Coates". */
export function authorNames(hidden: readonly string[] = []): string {
  const n = enabledAuthors().filter(a => !hidden.includes(a.id)).map(a => a.short)
  return n.length > 1 ? t('{list} and {last}', { list: n.slice(0, -1).join(', '), last: n[n.length - 1] }) : n.join('')
}
export const ministryAuthor = (id: string) => MINISTRY_AUTHORS.find(a => a.id === id && a.enabled)

// ---------- the library: what the server lists (GET /api/ministry) ----------

/** A group of an author's works: "Synopsis", "Collected Writings", "Letters". */
export interface CollectionSummary { id: string; title: string; works: WorkSummary[] }
export interface WorkSummary { id: string; title: string; kind: WorkKind; /** sections in the work */ count: number }
export interface LibraryAuthor { id: string; name: string; short: string; born: number; died: number; source: string; collections: CollectionSummary[] }
export interface Library { authors: LibraryAuthor[] }

/**
 * A section as the library lists it: the companion's, with what a letter or a paper adds. `subtitle`: the edition's
 * heading when the title is something else (a letter's topics); `date`, `to`: a letter's date line and recipient.
 * With its text, `figures`: the tables its page prints beside the text (shared/figures.ts).
 */
export interface MinistrySectionMeta extends SectionMeta { subtitle?: string; date?: string; to?: string }
export interface MinistrySection extends Section { subtitle?: string; date?: string; to?: string; figures?: Figure[] }
/** GET /api/ministry/:author/:work: a work's contents. */
export interface WorkContents { author: string; work: { id: string; title: string; kind: WorkKind; collection: string }; sections: MinistrySectionMeta[] }
/**
 * GET /api/ministry/search?q=: a section found by its title (subtitle, or a letter's recipient), placed: the section as
 * its work's contents list it, with its author, work and number, so it reads and opens like a companion Place.
 */
export interface SectionHit extends MinistrySectionMeta { author: string; work: { id: string; title: string; kind: WorkKind; collection: string }; n: number }
export interface SectionSearch { hits: SectionHit[] }
/** GET /api/ministry/:author/:work/:n: one section with its text (the companion's shape). */
export interface MinistryReading { author: string; work: { id: string; title: string; kind: WorkKind; collection: string }; n: number; count: number; section: MinistrySection }

// ---------- ministry on a verse (GET /api/ministry/refs/...) ----------

/**
 * How a paragraph refers to the verse, best first: it quotes the verse's words; it names the verse alone; the verse is
 * inside a range it names; it names the verse among many others (a list).
 */
export type Mention = 'quote' | 'verse' | 'range' | 'list'
export const MENTIONS: readonly Mention[] = ['quote', 'verse', 'range', 'list']

export interface MinistryItem {
  work: { id: string; title: string; collection: string }
  /** 1-based section number in the work (the reading's `n`). */
  n: number
  /** The section's title, and a letter's date line when it has one. */
  section: string
  /** The paragraph (index into paragraphsOf(section.text)); for a footnote, the paragraph with its caller. */
  para: number
  /** The footnote's number when the reference is in a note. */
  note?: number
  /** The reference is a row of one of the section's figures (a table, a harmony, a chart); `para` is its slot after the
   *  section's paragraphs (shared/figures.ts `rowSlot`), where the reader lands and washes it. */
  row?: true
  mention: Mention
  /** About 200 characters around the reference, plain text, "…" where cut. */
  snippet: string
  /** The reference inside `snippet`, [start, end) in UTF-16 units. */
  hl: [number, number]
}
export interface MinistryGroup { author: string; name: string; short: string; source: string; total: number; page: number; pages: number; items: MinistryItem[] }
export interface MinistryRefs { book: number; chapter: number; verses: number[]; groups: MinistryGroup[] }

export type { Passage }
