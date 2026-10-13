/**
 * The reader's name for what the code calls outlines is the brand's noun (shared/brand.json `noun`; routes, API and
 * storage keep `outline`). The two rules here are pure so tests/jot.test.ts can hold them: what a jotting made from
 * the verse bar is called, and where Home puts its sign-in prompt.
 */
import { formatVerseRuns } from '@shared/ref'

/** The title a new jotting takes from the passage it starts with: "Psalms 23:1", "Genesis 1:1-2, 4". */
export const jottingTitle = (book: number, chapter: number, verses: readonly number[]): string => formatVerseRuns(book, chapter, verses)

/**
 * Home sells the streak only after trust: a reader who has never finished a chapter on this device and is not
 * signed in sees "Keep a daily reading streak · Sign in" below the library, not above it. Signed in, or once any
 * chapter has been credited here, the card keeps its place above.
 */
export const signInPromptBelowLibrary = (signedIn: boolean, readAny: boolean): boolean => !signedIn && !readAny
