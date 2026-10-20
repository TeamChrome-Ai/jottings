import { useEffect, useState } from 'react'
import { useWindowDimensions } from 'react-native'
import { fetchChapter, peekChapter, type ChapterData } from '../lib/bible'
import { sourceOf, useText } from '../lib/text'
import { usePref } from '../store/prefs'

/** Wide enough for two columns of text; narrower, each second verse sits under its own. */
const PAIR_MIN_WIDTH = 900

/**
 * Side by side (docs/LANGUAGES.md): the chapter of the reader's second Bible, null while it loads or when there is none,
 * and whether the screen is wide enough to set it beside the first.
 */
export function useSecondText(book: number, chapter: number): { second: ChapterData | null; wide: boolean } {
  const main = useText()
  const pref = usePref('bible2')
  const other = pref && pref !== main ? sourceOf(pref) : null
  const [second, setSecond] = useState<ChapterData | null>(() => (other ? peekChapter(book, chapter, other) ?? null : null))
  useEffect(() => {
    if (!other) { setSecond(null); return }
    let live = true
    const held = peekChapter(book, chapter, other)
    if (held) setSecond(held)
    else fetchChapter(book, chapter, other).then(c => { if (live) setSecond(c) }, () => { if (live) setSecond(null) })
    return () => { live = false }
  }, [book, chapter, other])
  const { width } = useWindowDimensions()
  return { second: other ? second : null, wide: width >= PAIR_MIN_WIDTH }
}
