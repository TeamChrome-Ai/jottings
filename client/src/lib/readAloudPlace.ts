import type { Position } from '../hooks/usePosition'
import type { PlayerState } from '../store/player'

/**
 * Where read aloud is, for a reader that opens with no chapter asked for (/read: the app opened, the Read tab's first
 * showing). A reading can be going that no screen started or followed: a car asked for it with the app not open, or
 * it has gone on, chapter after chapter, since the screens were last up. The reader then opens at the chapter being
 * read, at its verse, and from there follows it as it always has. A chapter the reader asks for by name (a link, a
 * search, the chapter picker) is theirs and stays where they put it, whatever is being read.
 */
type Reading = Pick<PlayerState, 'status' | 'book' | 'chapter' | 'spoken'>

/** The chapter and verse being read aloud; null with nothing in hand (never started, stopped, ended, failed). */
export function placeBeingRead(s: Reading): Position | null {
  if (!s.book || s.status === 'idle' || s.status === 'error') return null
  // while the next chapter loads, the verse last spoken is still the chapter before's
  const here = s.spoken && s.spoken.book === s.book && s.spoken.chapter === s.chapter ? s.spoken.v : 0
  return { book: s.book, chapter: s.chapter, verse: Math.max(1, here) }
}

/** Where /read opens: the place being read aloud, else where the reader left off. */
export const openingPlace = (saved: Position, s: Reading): Position => placeBeingRead(s) ?? saved
