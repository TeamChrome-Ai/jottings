/**
 * Whether Ask's conversation follows its newest words (app/ask.tsx): it does while the reader is at its end, and
 * leaves a reader alone who has scrolled up to read. Pure; the screen keeps the answer and moves the scroll.
 */

/** How near its end a conversation is still "at the end", in px: a line or two. */
export const NEAR_END = 48

/** Where a scroll stands: its offset, the height that shows and the height of what it holds. */
export interface ScrollAt { y: number; view: number; content: number }

/**
 * Whether the conversation follows after a scroll event. `was`: whether it did before; `before`: the offset at the
 * last event. At the end, or within NEAR_END of it, it follows. Away from the end it stops only when the offset went
 * down, which is the reader moving up: an answer growing under a reader who has not moved leaves the end further off
 * with the offset where it was, and the screen's own move to the new end only raises it.
 */
export function follows(was: boolean, before: number, now: ScrollAt): boolean {
  if (now.content - now.view - now.y <= NEAR_END) return true
  if (now.y < before - 1) return false
  return was
}
