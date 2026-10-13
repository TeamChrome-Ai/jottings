/**
 * Ministry on a verse: the written ministry of the authors in the registry below, indexed by the verses it refers to
 * (tools/ministry_index.ts builds data/ministry.db; rs/src/ministry.rs serves it). The registry is the one list of
 * authors: the index is built only from `enabled` ones, the server answers only for those, and the app shows only what
 * the server sends, so an author is switched on by a data rebuild alone.
 */
import type { Passage, Section, SectionMeta, WorkKind } from './companion.js'
import type { Figure } from './figures.js'

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

/** Darby first: the sheet's first group, the library's first author. */
export const MINISTRY_AUTHORS: readonly MinistryAuthor[] = [
  {
    id: 'darby', name: 'J. N. Darby', short: 'Darby', born: 1800, died: 1882, enabled: true,
    licence: 'Died 1882: public domain everywhere.',
    source: 'J. N. Darby (1800–1882). Text from Bible Truth Publishers’ online library; public domain.',
    corpus: 'tools/ministry_convert.py (Collected Writings, Notes and Comments, Notes and Jottings, Letters, Miscellaneous Writings, other writings) and tools/synopsis_convert.py (the Synopsis)',
  },
  {
    id: 'coates', name: 'C. A. Coates', short: 'Coates', born: 1862, died: 1945, enabled: true,
    licence: 'Died 1945. Kingston Bible Trust edition; the Trust claims no copyright in it (data/coates/SOURCE.md).',
    source: 'C. A. Coates (1862–1945). Text of the Kingston Bible Trust edition; public domain.',
    corpus: 'tools/coates_convert.py --all (the whole Kingston Bible Trust edition, 40 works)',
  },
  // placeholders: the structure is ready, nothing is converted and nothing reaches the app
  { id: 'kelly', name: 'W. Kelly', short: 'Kelly', born: 1821, died: 1906, enabled: false, licence: 'Died 1906: public domain everywhere.', source: '', corpus: '' },
  { id: 'bellett', name: 'J. G. Bellett', short: 'Bellett', born: 1795, died: 1864, enabled: false, licence: 'Died 1864: public domain everywhere.', source: '', corpus: '' },
  { id: 'mackintosh', name: 'C. H. Mackintosh', short: 'Mackintosh', born: 1820, died: 1896, enabled: false, licence: 'Died 1896: public domain everywhere.', source: '', corpus: '' },
  { id: 'raven', name: 'F. E. Raven', short: 'Raven', born: 1837, died: 1903, enabled: false, licence: 'Died 1903: public domain everywhere; later printings of his readings need checking.', source: '', corpus: '' },
  { id: 'taylor', name: 'J. Taylor Sr.', short: 'Taylor', born: 1870, died: 1953, enabled: false, licence: 'Died 1953: in copyright in the UK until 2024, and in the US by publication date; needs the publisher’s permission.', source: '', corpus: '' },
]
export const enabledAuthors = () => MINISTRY_AUTHORS.filter(a => a.enabled)
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
