import { loadAsync } from 'expo-font'
import { useSyncExternalStore } from 'react'
import type { Font } from '../store/prefs'
import { APP_FONTS } from './appFonts'
import { registerFaces } from './customFontFiles'
import { customIdOf, customKey, getCustomFont, isCustomKey, type CustomFont } from './customFonts'

/** OpenDyslexic (~170 KB) is only fetched when the dyslexic font is selected. */
export const DYSLEXIC_FONTS = {
  OpenDyslexic: require('../../assets/fonts/OpenDyslexic-Regular.otf'),
  'OpenDyslexic-Italic': require('../../assets/fonts/OpenDyslexic-Italic.otf'),
  'OpenDyslexic-Bold': require('../../assets/fonts/OpenDyslexic-Bold.otf'),
}
export { APP_FONTS }

const LAZY: Partial<Record<Font, Record<string, number>>> = { dyslexic: DYSLEXIC_FONTS }
export type LazyFontState = 'none' | 'loading' | 'ready' | 'failed'
const state = new Map<Font, LazyFontState>()
const pending = new Map<Font, Promise<void>>()
const listeners = new Set<() => void>()
const notify = () => { for (const l of listeners) l() }
const isLazy = (font: Font) => !!LAZY[font] || isCustomKey(font)

function track(font: Font, load: () => Promise<void>): Promise<void> {
  const p = pending.get(font)
  if (p) return p
  state.set(font, 'loading'); notify()
  const run = load().then(() => { state.set(font, 'ready') }).catch(() => { state.set(font, 'failed') }).finally(notify)
  pending.set(font, run)
  return run
}
/** Fetch a font's faces once (no-op for the always-loaded ones); resolves when they are usable or have failed. */
export function loadLazyFaces(font: Font): Promise<void> {
  const id = customIdOf(font)
  if (id) {
    const rec = getCustomFont(id)
    if (!rec) { state.set(font, 'failed'); notify(); return Promise.resolve() }
    return loadCustomFont(rec)
  }
  const faces = LAZY[font]
  if (!faces) return Promise.resolve()
  return track(font, () => loadAsync(faces))
}
/** Registers an added font's stored faces. Takes the record because a font is loaded before it goes into prefs. */
export function loadCustomFont(rec: CustomFont): Promise<void> {
  return track(customKey(rec.id), () => registerFaces(rec))
}
export const lazyFontState = (font: Font): LazyFontState => state.get(font) ?? 'none'
/** A removed font's id must never read as ready once its files are gone. */
export function forgetFont(font: Font): void { state.delete(font); pending.delete(font); notify() }
/** 'loading' while a lazily fetched font is on its way; 'none' for fonts that are always present. */
export function useLazyFontState(font: Font): LazyFontState {
  const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
  return useSyncExternalStore(subscribe, () => (isLazy(font) ? state.get(font) ?? 'none' : 'none'), () => 'none')
}
