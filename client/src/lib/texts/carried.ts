import type { VerseMap } from '@shared/texts'

/**
 * A Bible read beside Darby's as a build carries it (docs/LANGUAGES.md): where its numbers differ (map.json), the
 * version of its data (meta.json: in its URLs, and a change sweeps its stored chapters) and, in the apps, its
 * chapters, each a module read when first opened; the web fetches them and carries none.
 */
export interface CarriedText { map: VerseMap; v: string; chapters: ((file: string) => unknown) | null }
