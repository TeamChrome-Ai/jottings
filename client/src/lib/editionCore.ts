/**
 * The edition the app shows (docs/EDITION.md): "1961", the default, or "1890", built only from material that needs no
 * one's permission. The server says which (GET /api/edition); lib/edition.ts asks on start and on every return to the
 * app and keeps the answer. The value and its listeners live here, with the rules of what each edition shows, so pure
 * modules can read them: no React Native (tests/edition.test.ts).
 */
import type { Chapter, Note } from '@shared/types'
import { NEUTERED } from './buildFlags'

export type Edition = '1961' | '1890'
/** A build without the 1961 material (buildFlags.ts) is the 1890 edition with the cleanse on until the server says otherwise. */
export const DEFAULT_EDITION: Edition = NEUTERED ? '1890' : '1961'
export const DEFAULT_CLEANSE: boolean = NEUTERED
export const parseEdition = (v: unknown): Edition | null => (v === '1961' || v === '1890' ? v : null)

let current: Edition = DEFAULT_EDITION
/** The cleanse (docs/EDITION.md, shared/cleanse.ts): the server's flag beside the edition; with it on the edition is 1890. */
let cleanse: boolean = DEFAULT_CLEANSE
const listeners = new Set<(e: Edition) => void>()
export const peekEdition = (): Edition => current
export const peekCleanse = (): boolean => cleanse || NEUTERED
/** Sets the edition shown; listeners hear a change only. */
export function setEditionState(e: Edition): boolean {
  if (e === current) return false
  current = e
  listeners.forEach(l => l(e))
  return true
}
/** Sets the cleanse flag; the edition's listeners hear it (what they hold is one state's answer, not the other's). */
export function setCleanseState(on: boolean): boolean {
  if (on === cleanse) return false
  cleanse = on
  if (on && current !== '1890') current = '1890'
  listeners.forEach(l => l(current))
  return true
}
export function onEditionChange(l: (e: Edition) => void): () => void { listeners.add(l); return () => { listeners.delete(l) } }

// ---------- what an edition leaves out ----------

/** Authors the edition leaves out everywhere (the companion, the library, Ministry on a verse, downloads): C. A.
 *  Coates, J. B. Stoney and F. E. Raven are texts of a publisher's edition; the cleanse (and a neutered build) leaves
 *  them out too. rs/src/edition.rs hides_author is the same rule. */
export const EDITION_AUTHORS = ['coates', 'stoney', 'raven'] as const
export const hiddenAuthors = (e: Edition): readonly string[] => (e === '1890' || peekCleanse() ? EDITION_AUTHORS : [])
export const authorShown = (id: string, e: Edition = current): boolean => !hiddenAuthors(e).includes(id)
/** The 1961 edition's chronological table (and the order of the prophets with it); never in a neutered build. */
export const hasChronology = (e: Edition = current): boolean => e === '1961' && !peekCleanse()
/** The path a reader or group on `id` is shown: the Coates path reads as the Synopsis path while Coates is hidden. Only
 *  what is shown changes; the stored path stays, so switching back restores it (rs/src/edition.rs shown_path). */
export function shownPathId<T extends string>(id: T, e: Edition = current): T | 'synopsis' {
  return e === '1890' && id === 'coates' ? 'synopsis' : id
}
/** Whether a path may be started in this edition. */
export const pathOffered = (id: string, e: Edition = current): boolean => shownPathId(id, e) === id

// ---------- the introductory notices ----------

export interface NoticeSection { title: string; html: string }
/** A section of the 1961 file that the 1890 edition keeps: Darby's own notices (1890, 1884) and his 1871 preface, not
 *  the 1961 editors' notice nor the order of the prophets with the chronological table. */
export function sectionIn1890(title: string): boolean {
  const t = title.toLowerCase()
  return !t.includes('1961') && !t.startsWith('chronolog') && ['1890', '1884', '1871'].some(y => t.includes(y))
}
/** The notices the edition shows: the 1961 file whole; for 1890 its own notices when the data has them
 *  (data/notices_1890.json), else the 1961 file's sections that are Darby's (rs/src/edition.rs intro_json). */
export function noticeSections(e: Edition, intro: { sections: NoticeSection[] }, own1890: { sections: NoticeSection[] } | null): NoticeSection[] {
  if (e === '1961' && !peekCleanse()) return intro.sections
  if (own1890 && Array.isArray(own1890.sections)) return own1890.sections
  return intro.sections.filter(s => sectionIn1890(s.title))
}

// ---------- chapters ----------

/** What the 1890 edition's data is, from client/public/bible1890/meta.json (written by the data build): `v` changes with
 *  its chapters and notices, `text` says it has a text of its own (data/darby_1890.json), `notices` notices of its own. */
export interface Meta1890 { v: string; text: boolean; notices: boolean }
/** A stored chapter's key: the 1961 edition keeps the keys it always had, so nothing stored before is lost. */
export const chapterStoreKey = (e: Edition, book: number, chapter: number): string => (e === '1961' ? `${book}.${chapter}` : `${e}:${book}.${chapter}`)
/** The edition and chapter a stored key names; null for anything else. */
export function parseStoreKey(k: string): { edition: Edition; book: number; chapter: number } | null {
  const m = /^(?:(1890):)?(\d+)\.(\d+)$/.exec(k)
  return m ? { edition: m[1] === '1890' ? '1890' : '1961', book: +m[2], chapter: +m[3] } : null
}
/** Where the web reads a chapter (and the archive): the 1890 files sit beside the 1961 ones, named by their version so
 *  no cache keeps an older copy. */
export const chapterPath = (e: Edition, book: number, chapter: number, v: string): string => (e === '1961' ? `/bible/${book}/${chapter}.json` : `/bible1890/${book}/${chapter}.json?v=${v}`)
export const archivePath = (e: Edition, v: string): string => (e === '1961' ? '/bible/all.json' : `/bible1890/all.json?v=${v}`)
/** The edition a chapter is of, as it says itself (the 1890 files carry `ed`). */
export const chapterEdition = (c: { ed?: string }): Edition => (c.ed === '1890' ? '1890' : '1961')

type ChapterLike = Chapter & { ed?: '1890' }
/** One chapter of client/public/bible1890/notes/<book>.json: its notes by verse, or the whole chapter where the 1890
 *  text differs (rs/src/bin/build_data.rs overlay_entry). */
export interface OverlayEntry { notes?: Record<string, Note[]>; chapter?: ChapterLike }
/** The 1890 chapter from the bundled 1961 one: its notes replaced by the edition's (none where it has none). */
export function applyOverlay<C extends ChapterLike>(base: C, entry: OverlayEntry | undefined): C {
  if (entry?.chapter) return { ...base, ...entry.chapter, ed: '1890' }
  const notes = entry?.notes ?? {}
  return {
    ...base, ed: '1890',
    verses: base.verses.map(v => {
      const own = notes[String(v.v)]
      const { notes: _drop, ...rest } = v
      return own ? { ...rest, notes: own } : rest
    }),
  }
}

// ---------- API reads ----------

/** GET paths whose answer depends on the edition (rs/src/edition.rs `depends`): they carry `ed=`, and `cl=1` while the
 *  cleanse is known to be on, so a cache never holds one state's answer under another's name. */
export function withEdition(path: string, e: Edition = current, cl: boolean = cleanse): string {
  const p = path.split('?')[0]
  const depends = p === '/ministry/offline' || (p.startsWith('/bible/') && p !== '/bible/books') || p.startsWith('/search') || p.startsWith('/strongs/')
    || p === '/intro' || p === '/chronology' || p.startsWith('/companion/') || (p.startsWith('/ministry') && !p.startsWith('/ministry/offline/'))
  return depends ? `${path}${path.includes('?') ? '&' : '?'}ed=${e}${cl ? '&cl=1' : ''}` : path
}
