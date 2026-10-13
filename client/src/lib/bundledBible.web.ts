import type { ChapterData } from './bible'
import type { Edition } from './editionCore'
/** Web: nothing bundled; chapters come from /bible/B/C.json (/bible1890/ for the 1890 edition) on the same origin and the IndexedDB cache. */
export function bundledChapters(_e?: Edition): Map<string, ChapterData> { return new Map() }
export const bundledKeys = (): string[] => []
export const bundledChapter = (_book: number, _chapter: number, _e?: Edition): ChapterData | null => null
export const hasBundledBible = false
