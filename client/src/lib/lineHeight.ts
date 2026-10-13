import { customIdOf, getCustomFont } from './customFonts'
import type { Font } from '../store/prefs'

/**
 * The tightest line a font can be set on without its descenders leaving the line box. Android (RN 0.77+) and the web
 * both centre the font's content area (ascent + descent) in the line box, so the room under the baseline is
 * (line + descent − ascent) / 2 and must hold the deepest text glyph: line ≥ 2·d + ascent − descent, in em. Android
 * clips at the bottom of each Text (every verse, with paragraphs off); the web lets the glyph overlap the next line.
 *
 * Literata: ascent 1.177, descent 0.308, g/j/y/{ reach 0.23 below the baseline (0.26 with the antialiased edge the
 * browser measures) → 1.33 to 1.39, called 1.45 because Android rounds the metrics to whole pixels and a 19 px face
 * has exactly the descent it needs at 1.4. The system sans faces (Roboto
 * 0.927/0.244/0.21 → 1.10; SF is close) are safe at the slider's own minimum. OpenDyslexic (1.25/0.5/0.26 → 1.27)
 * is read at 1.8 or looser anyway. An added font measures its own from the file when it is added
 * (`lineFloorOf`); one that could not be measured (a WOFF2 on the web) takes DEFAULT_MIN_LINE.
 */
export const MIN_LINE: Record<'serif' | 'sans' | 'dyslexic', number> = { serif: 1.45, sans: 1.15, dyslexic: 1.3 }
export const DEFAULT_MIN_LINE = 1.15
/** OpenDyslexic is never set tighter than this, for the readers it is for (letter and word spacing have floors too). */
export const DYSLEXIC_LINE = 1.8

export function minLine(font: Font): number {
  const id = customIdOf(font)
  if (id) return getCustomFont(id)?.minLine ?? DEFAULT_MIN_LINE
  return MIN_LINE[font as keyof typeof MIN_LINE] ?? DEFAULT_MIN_LINE
}
/** The line height factor the text is laid out at for the reader's setting `line`: the setting, or the font's floor. */
export function lineFactor(font: Font, line: number): number {
  return Math.max(line, minLine(font), font === 'dyslexic' ? DYSLEXIC_LINE : 0)
}
/** Whether the setting is tighter than the font allows (Settings says so beside the slider). */
export const lineTight = (font: Font, line: number): boolean => lineFactor(font, line) > line + 1e-9
