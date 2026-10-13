import { useMemo } from 'react'
import type { TextStyle } from 'react-native'
import { usePref } from '../store/prefs'
import { face, proseStyle } from '../theme'
import type { Font } from '../store/prefs'

export interface ReadingFaces { font: Font; body: TextStyle; italic: TextStyle; bold: TextStyle }
/**
 * The reader's chosen font (Settings → Text) for prose outside the chapter, re-rendering only when the font changes.
 * `body` carries size and line height (see `proseStyle`); `italic` and `bold` are faces to nest inside it.
 */
export function useReadingFont(size: number, line = 1.55): ReadingFaces {
  const font = usePref('font')
  return useMemo(() => ({ font, body: proseStyle(font, size, line), italic: face(font, { italic: true }), bold: face(font, { bold: true }) }), [font, size, line])
}
