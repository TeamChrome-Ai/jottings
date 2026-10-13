// What it takes for a chapter to count as read. The server holds the same rule (rs/src/bible.rs
// `chapter_required_seconds`, rs/src/activity.rs) and decides; the client uses it to report the moment it is met.

/** An unhurried reader's pace: 400 credited chapters read halfway (build 31). */
export const READ_WPM = 250
/** No chapter counts in less time than this, however short. */
export const READ_MIN_SECONDS = 45
/** Nor needs more than this, however long. */
export const READ_MAX_SECONDS = 600

/** Words as the scripture build counts them (`word_count` in rs/src/bin/build_data.rs): runs of letters, digits and apostrophes. */
export function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}'’]+/gu)?.length ?? 0
}

export const chapterWords = (verses: readonly { t: string }[]) => verses.reduce((n, v) => n + wordCount(v.t), 0)

/** Active seconds a chapter of `words` needs before it counts: its length at `READ_WPM`, held to 45 s … 10 min. The
 *  beat that credits must also find the reader AT the end (not merely having touched it once): see rs/src/activity.rs. */
export function requiredSeconds(words: number): number {
  return Math.min(READ_MAX_SECONDS, Math.max(READ_MIN_SECONDS, Math.round(words / READ_WPM * 60)))
}

/** The scroll has reached the chapter's end, or the chapter fits without scrolling. `slack` absorbs sub-pixel rounding. */
export function atEnd(scrollY: number, viewportH: number, contentH: number, slack = 4): boolean {
  return contentH <= viewportH + slack || scrollY + viewportH >= contentH - slack
}
