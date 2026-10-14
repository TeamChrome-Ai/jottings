import { createContext, useContext, useDeferredValue, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react'
import { Appearance, Platform } from 'react-native'
import { usePrefsStore, type PrefsStore } from '../store/prefs'
import { THEME_MAP, resolveThemeId, type Colors, type ThemeDef, type ThemeId } from '../theme'
import { HL_ALL } from '../lib/hlColours'

/** Kept for callers that only need light-vs-dark (status bar, print styles). */
export type ResolvedTheme = 'light' | 'dark'

/**
 * The resolved theme as one store over the preferences and the system's light or dark: a component subscribes once
 * (not once to the prefs and once more to the system, as each did), and hears only a change of theme, not every
 * preference. Theme objects are module constants, so a subscriber compares by identity.
 */
interface ThemeStore { get: () => ThemeDef; subscribe: (fn: () => void) => () => void }
const themeStores = new WeakMap<PrefsStore, ThemeStore>()
function themeStore(prefs: PrefsStore): ThemeStore {
  let store = themeStores.get(prefs)
  if (store) return store
  let sys = Appearance.getColorScheme()
  const resolve = () => { const p = prefs.get(); return THEME_MAP[resolveThemeId(p.theme, p.themeLight, p.themeDark, sys)] }
  let current = resolve()
  const listeners = new Set<() => void>()
  const update = () => { const next = resolve(); if (next !== current) { current = next; listeners.forEach(fn => fn()) } }
  // for the app's lifetime, like the prefs store they follow
  prefs.subscribe(update)
  Appearance.addChangeListener(({ colorScheme }) => { sys = colorScheme; update() })
  store = { get: () => current, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn) } } }
  themeStores.set(prefs, store)
  return store
}

export function useThemeDef(): ThemeDef {
  const store = themeStore(usePrefsStore())
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
export function useThemeId(): ThemeId { return useThemeDef().id }
export function useResolvedTheme(): ResolvedTheme { return useThemeDef().dark ? 'dark' : 'light' }
export function useColors(): Colors { return useThemeDef() }
/** One value from the current theme, re-rendering only when that value changes (a verse's tint, not its words). */
export function useThemeSelect<T>(select: (t: ThemeDef) => T): T {
  const store = themeStore(usePrefsStore())
  const snap = () => select(store.get())
  return useSyncExternalStore(store.subscribe, snap, snap)
}

/**
 * Paint-level colour for leaves that only put a colour on screen (text, fills, icons): the web gets CSS custom
 * properties set on the document root (`useInkRoot`), so a theme change re-renders none of them and the browser only
 * restyles; native gets the theme's own values. Never do arithmetic on an ink (mix, alpha, a colour tween, a string
 * compare against a `useColors()` value): those need `useColors()` or `useThemeSelect()`.
 */
export type InkRole = Exclude<keyof Colors, 'hl'>
const ROLES: InkRole[] = ['bg', 'card', 'text', 'muted', 'border', 'accent', 'accentText', 'selected', 'danger', 'bar', 'accentSoft']
const INK_VARS: Colors = {
  ...Object.fromEntries(ROLES.map(k => [k, `var(--c-${k})`])) as Record<InkRole, string>,
  hl: Object.fromEntries(HL_ALL.map(k => [k, `var(--c-hl-${k})`])) as Colors['hl'],
}
const webInks = () => INK_VARS
export const useInks: () => Colors = Platform.OS === 'web' ? webInks : useColors

/**
 * Native: the colours a long text's leaves paint with (a chapter's verse numbers, a section's links), from one
 * subscription per page instead of one per leaf: `InkPage` reads the theme and hands it down. A page offscreen (a
 * neighbour in the pager) takes a new theme in a deferred render after the visible page has painted, so a theme tap
 * repaints one chapter at once, not three. Without an InkPage above (a dictionary article), the leaf subscribes itself.
 */
const PageInks = createContext<Colors | null>(null)
const noSubscription = () => () => {}
function nativePageInks(): Colors {
  const page = useContext(PageInks)
  const store = themeStore(usePrefsStore())
  const snap = page ? () => page : store.get
  return useSyncExternalStore(page ? noSubscription : store.subscribe, snap, snap)
}
export const usePageInks: () => Colors = Platform.OS === 'web' ? webInks : nativePageInks
function NativeInkPage({ offscreen = false, children }: { offscreen?: boolean; children: ReactNode }) {
  const t = useThemeDef()
  const later = useDeferredValue(t)
  return <PageInks.Provider value={offscreen ? later : t}>{children}</PageInks.Provider>
}
const WebInkPage = ({ children }: { offscreen?: boolean; children: ReactNode }) => children
export const InkPage = Platform.OS === 'web' ? WebInkPage : NativeInkPage
/** Web: writes the current theme into the root's custom properties, in the commit that changes it (before paint). */
export function useInkRoot(t: ThemeDef) {
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    const st = document.documentElement.style
    for (const k of ROLES) st.setProperty(`--c-${k}`, t[k])
    for (const k of HL_ALL) st.setProperty(`--c-hl-${k}`, t.hl[k])
  }, [t])
}

/**
 * Which flat surface a control sits on. Surfaces alternate (page → card → page), so a control fills itself with the
 * opposite tone and stays visible without outlines. Card and Sheet provide it; the default is the page.
 */
export type Surface = 'bg' | 'card'
export const SurfaceContext = createContext<Surface>('bg')
export function useSurface(): Surface { return useContext(SurfaceContext) }
/** Fill colour for a control on the current surface. */
export function useFill(): string {
  const c = useColors()
  return useSurface() === 'card' ? c.bg : c.card
}
/** `useFill` as an ink (see `useInks`). */
export function useInkFill(): string {
  const c = useInks()
  return useSurface() === 'card' ? c.bg : c.card
}
