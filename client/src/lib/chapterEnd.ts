/**
 * What the one quiet line at a chapter's end says (docs/PATHS.md rule 1): whether the chapter counts as read, any part
 * still to read, and the reader's own mark. No clock: the owner did not want a timer at the end (2026-10-14). Pure;
 * `components/ChapterEndLine.tsx` draws it.
 */

export interface EndFacts {
  /** The account has the chapter credited; signed out, this device judged it read. */
  credited: boolean
  /** The reader's own mark is on it. */
  marked: boolean
  /** How the active path counts the chapter (paths.ts `usePathCounts`); all false off the path or without one. */
  path: { onPath: boolean; byCredit: boolean; byMark: boolean }
  /** Parts of the chapter away from the screen not yet read (they went by too quickly, or never came on screen). */
  gaps?: readonly (readonly [number, number])[]
}
export type EndLine =
  /** Credited: the tick's word, nothing to do. */
  | { kind: 'read' }
  /** The reader's own mark stands (and, on a path, is what the path counts): it can be undone. */
  | { kind: 'marked' }
  /** On the path, read or marked before it began: the path does not count it, and a mark now would. */
  | { kind: 'before-path'; by: 'credit' | 'mark' }
  /** Neither: the mark is offered, with what is still to read (`toRead`, verse numbers) when parts went by unread. */
  | { kind: 'open'; toRead: string | null; firstGap: number | null }

export function endLine(f: EndFacts): EndLine {
  if (f.path.onPath) {
    if (f.path.byCredit) return { kind: 'read' }
    if (f.path.byMark) return { kind: 'marked' }
    if (f.credited || f.marked) return { kind: 'before-path', by: f.credited ? 'credit' : 'mark' }
  } else {
    if (f.credited) return { kind: 'read' }
    if (f.marked) return { kind: 'marked' }
  }
  if (f.gaps?.length) return { kind: 'open', toRead: verseList(f.gaps), firstGap: f.gaps[0][0] }
  return { kind: 'open', toRead: null, firstGap: null }
}

/** "Verse 9", "Verses 9–14", "Verses 3, 9–14 and 20", "Verses 3, 9–14, 20 and others". */
export function verseList(gaps: readonly (readonly [number, number])[]): string {
  const parts = gaps.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`))
  const one = gaps.length === 1 && gaps[0][0] === gaps[0][1]
  const shown = parts.length > 3 ? `${parts.slice(0, 3).join(', ')} and others` : parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `${one ? 'Verse' : 'Verses'} ${shown}`
}

export const END_WORDS = {
  read: 'Read',
  marked: 'Marked as read',
  undo: 'Undo',
  mark: 'Mark as read',
  beforePath: { credit: 'Read before this path began', mark: 'Marked before this path began' },
  /** Parts that went by too quickly to count (or never came on screen): tapping goes to the first. */
  toRead: (verses: string) => `${verses} still to read`,
  /** Said once, the first time a reader marks a chapter. */
  explained: 'This is your own mark: it moves your path on, and streaks, reading time and badges still come from time spent reading.',
} as const
