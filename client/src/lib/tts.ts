import { Platform } from 'react-native'
import { get, getApiBase } from './api'
import { tokenize } from './bible'
import type { Verse } from '@shared/types'

/** Word timings for one recorded chapter; times in ms into the recording, `off` a char offset into the verse text. */
export interface WordMark { off: number; start: number; end: number }
/** A clause of a partly refused verse: recorded (start/end) or left to the device voice (no times). */
export interface Part { a: number; b: number; start?: number; end?: number }
export interface VerseMark { v: number; start: number; end: number; words: WordMark[]; parts?: Part[] }
export interface ChapterMarks { voice: string; book: number; chapter: number; duration: number; heading: [number, number] | null; verses: VerseMark[] }
export interface NumbersMarks { voice: string; numbers: [number, number, number][] }
export interface VoiceInfo { id: string; name: string; blurb: string; chapters: number; numbers: boolean }

export const VOICES: { id: string; name: string; blurb: string }[] = [
  { id: 'alec', name: 'Alec', blurb: 'British, low and unhurried' },
  { id: 'beatrice_32', name: 'Beatrice', blurb: 'British, warm' },
  { id: 'dominic', name: 'Dominic', blurb: 'American, clear' },
]
export type Pause = 'none' | 'short' | 'long'
export const PAUSE_MS: Record<Pause, number> = { none: 0, short: 500, long: 1200 }
export const SPEEDS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const

const base = () => getApiBase()
/** Opus (a quarter of the MP3, same timeline) wherever it plays natively: Android, and browsers other than Safari.
 *  iOS and Safari keep the MP3 masters. */
const OPUS: boolean = Platform.OS === 'android' || (Platform.OS === 'web' && typeof document !== 'undefined' && document.createElement('audio').canPlayType('audio/ogg; codecs="opus"') !== '')
const ext = OPUS ? '.opus' : ''
export const chapterAudioUrl = (voice: string, book: number, chapter: number) => `${base()}/api/tts/${voice}/${book}/${chapter}/audio${ext}`
export const numbersAudioUrl = (voice: string) => `${base()}/api/tts/${voice}/numbers/audio`
/** Psalm 23:1-3 in that voice, cut from its own recording (MP3 everywhere; it is a few seconds). */
export const previewAudioUrl = (voice: string) => `${base()}/api/tts/${voice}/preview/audio`
export const numberAudioUrl = (voice: string, n: number) => `${base()}/api/tts/${voice}/numbers/${n}/audio${ext}`
export const fetchMarks = (voice: string, book: number, chapter: number) => get<ChapterMarks>(`/tts/${voice}/${book}/${chapter}`)
export const fetchNumbers = (voice: string) => get<NumbersMarks>(`/tts/${voice}/numbers`)
export const fetchVoices = () => get<{ voices: VoiceInfo[]; total_chapters: number }>('/tts/voices')

/** Which word index (as the reader tokenizes the verse) contains character offset `off` of the verse text. */
export function wordIndexAt(verse: Pick<Verse, 't' | 'h'>, off: number): number {
  // an offset that lands on punctuation or a marker between words belongs to the word that follows it, never
  // to the last word of the verse (which made the highlight jump to the end and back)
  let pos = 0, last = 0
  for (const t of tokenize(verse)) {
    if (t.word) { if (off < pos + t.tok.length) return t.wi; last = t.wi }
    pos += t.tok.length
  }
  return last
}

/** The verse (and the word within it) being spoken at time `ms`, or null between verses. */
export function positionAt(marks: ChapterMarks, ms: number): { v: number; off: number | null } | null {
  for (const vm of marks.verses) {
    if (ms >= vm.start && ms < vm.end) {
      let off: number | null = null
      for (const w of vm.words) { if (ms >= w.start && ms < w.end) { off = w.off; break } }
      return { v: vm.v, off }
    }
  }
  return null
}
