import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
// first: every Animated timing and spring from here on runs at the chosen animation speed
import '../src/components/motion/speed'
import { Platform } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router'
import { useFonts } from 'expo-font'
import * as SplashScreen from 'expo-splash-screen'
import * as WebBrowser from 'expo-web-browser'
import RootGesture from '../src/components/RootGesture'
import ThemeVeil from '../src/components/ThemeVeil'
import { Tour, Welcome } from '../src/components/FirstRun'
import { OverlayHost } from '../src/store/overlay'
import CrashScreen from '../src/components/CrashScreen'
import { reloadForNewVersion } from '../src/lib/staleBuild'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { loadApiBase } from '../src/lib/api'
import { loadEdition, useEditionLoaded, watchEdition } from '../src/lib/edition'
import { APP_FONTS, loadLazyFaces, useLazyFontState } from '../src/lib/fonts'
import { face } from '../src/theme'
import { isCustomKey } from '../src/lib/customFonts'
import { AuthProvider } from '../src/store/auth'
import { PrefsProvider, usePref, usePrefsStore } from '../src/store/prefs'
import { PlayerProvider } from '../src/store/player'
import { ToastProvider } from '../src/store/toast'
import { useInkRoot, useInks, useResolvedTheme, useThemeDef } from '../src/hooks/useTheme'
import { useStreakReminder } from '../src/hooks/useStreakReminder'
import { useVerseNotify } from '../src/hooks/useVerseNotify'
import { useInviteNotice } from '../src/hooks/useInviteNotice'
import FeedbackReplies from '../src/components/FeedbackReplies'
import ReadAloudReport from '../src/components/ReadAloudReport'
import ForcedRename from '../src/components/ForcedRename'
import { THEME_FADE_MS } from '../src/lib/themeFade'
import { setMotionSpeed } from '../src/lib/motionSpeed'
import { useLocalLibraryMerge } from '../src/hooks/useLocalLibraryMerge'
import { useWidgets } from '../src/widgets'
import { NOUN } from '@shared/brand'

SplashScreen.preventAutoHideAsync().catch(() => {})
// The Google sign-in popup returns to the site root with the token in the URL; whichever page loads there must
// hand it back to the opener and close, so this runs from the root, not only from the login screen.
WebBrowser.maybeCompleteAuthSession()

/** Stack titles share the screen-title face (Literata bold); react-navigation takes only family and weight. */
const { fontFamily: titleFamily, fontWeight: titleWeight } = face('serif', { bold: true })
const titleFace = { fontFamily: titleFamily, fontWeight: titleWeight }
const ALIAS = { headerShown: false, animation: 'none' } as const

/** expo-router's root boundary: a render error anywhere below shows a calm screen with retry and a report,
 *  instead of closing the app (a release build treats an uncaught render error as fatal). On the web, a screen whose
 *  code cannot be loaded because the site has moved on to a new version (the old page's files are gone from the server
 *  and the offline cache: lib/staleBuild.ts) reloads into the new version instead, at most once a minute. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const [reloading] = useState(() => reloadForNewVersion(error))
  if (reloading) return null
  return <CrashScreen error={error} retry={retry} />
}

export default function RootLayout() {
  return (
    <RootGesture>
      <SafeAreaProvider>
        <PrefsProvider>
          <AuthProvider>
            <ToastProvider>
              <PlayerProvider>
                <Shell />
              </PlayerProvider>
            </ToastProvider>
          </AuthProvider>
        </PrefsProvider>
      </SafeAreaProvider>
    </RootGesture>
  )
}

/** The shell reads single preferences, never the whole record: a theme tap must not re-render the navigator. */
function Shell() {
  const store = usePrefsStore()
  const loaded = useSyncExternalStore(store.subscribe, store.isLoaded, store.isLoaded)
  const font = usePref('font'), motionSpeed = usePref('motionSpeed')
  const set = store.set
  const lazyFont = useLazyFontState(font)
  // an added font whose files are gone (or will not register) must not leave the reader on an unknown family
  useEffect(() => { if (lazyFont === 'failed' && isCustomKey(font)) set({ font: 'serif' }) }, [lazyFont, font, set])
  // Literata (three faces) is for everyone; on the web the page's head has it already (lib/appFonts.web.ts) and this
  // map is empty. useFonts reads its map once, at mount, before the stored prefs
  // are in, so OpenDyslexic and added fonts are fetched separately when chosen: they never delay first paint for
  // everyone else, and the splash waits for them only in that case.
  const [fontsLoaded, fontError] = useFonts(APP_FONTS)
  useEffect(() => { void loadLazyFaces(font) }, [font])
  const facesReady = (fontsLoaded || !!fontError) && lazyFont !== 'loading'
  // Native renders nothing until the prefs and the faces they name are in (an unregistered family falls back and can
  // stick; a render on default prefs is thrown away). Later loads must not unmount the navigator: this gates once.
  // the edition (lib/edition.ts) is read before the first render as well, so a chapter never shows the other's notes first
  const editionLoaded = useEditionLoaded()
  useEffect(() => { void loadEdition(); return watchEdition() }, [])
  const [shellReady, setShellReady] = useState(Platform.OS === 'web')
  useEffect(() => { if (loaded && facesReady && editionLoaded) setShellReady(true) }, [loaded, facesReady, editionLoaded])
  // after the commit that mounts the navigator, so the splash never lifts onto an empty frame
  useEffect(() => { if (shellReady && loaded && facesReady) SplashScreen.hideAsync().catch(() => {}) }, [shellReady, loaded, facesReady])
  // read by every motion as it starts; a plain assignment, so it is in force before this render's children animate
  setMotionSpeed(motionSpeed)
  useEffect(() => { loadApiBase().catch(() => {}) }, [])
  // web: code loaded later (the tour, print, a sheet) that fails because the site has moved on reloads the page too
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return
    const on = (e: PromiseRejectionEvent) => { if (reloadForNewVersion(e.reason)) e.preventDefault() }
    window.addEventListener('unhandledrejection', on)
    return () => window.removeEventListener('unhandledrejection', on)
  }, [])
  // web: register the offline service worker only once the page is idle, so its precache never competes with the first chapter
  useEffect(() => {
    if (Platform.OS !== 'web' || __DEV__ || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const go = () => navigator.serviceWorker.register('/sw.js').catch(() => {})
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }
    if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 8000 }); else setTimeout(go, 4000)
  }, [])
  if (!shellReady) return null
  return (
    <>
      <ThemeChrome />
      <Navigator />
      <Tour />
      <Welcome ready={facesReady} />
      {/* the tour (and its theme blob) draw here, or inside an open sheet when there is one */}
      <OverlayHost />
      <ThemeVeil />
      <StreakReminder />
      <InviteNotice />
      <FeedbackReplies />
      <ReadAloudReport />
      <ForcedRename />
      <LibraryMerge />
      <Widgets />
    </>
  )
}

/**
 * The status bar, the browser's toolbar colour and (web) the root's ink properties: the only parts of the shell that
 * follow the theme.
 */
function ThemeChrome() {
  const t = useThemeDef()
  useInkRoot(t)
  // web: the browser's own bar (Android Chrome's toolbar) takes the page colour once the crossfade is half way
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    const h = setTimeout(() => {
      let m = document.querySelector('meta[name="theme-color"]')
      if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'theme-color'); document.head.appendChild(m) }
      m.setAttribute('content', t.bg)
      // public/index.html paints this before any script loads, next time
      try { localStorage.setItem('berean_bg', t.bg) } catch { /* private mode: the default page colour then */ }
    }, THEME_FADE_MS / 5)
    return () => clearTimeout(h)
  }, [t.bg])
  return <StatusBar style={t.dark ? 'light' : 'dark'} />
}

/**
 * The root stack. Its colours are inks, so on the web they are CSS properties and a theme change leaves the navigator
 * and every screen's container untouched (a new navigation theme would walk the whole tree for context consumers).
 */
function Navigator() {
  const c = useInks()
  // native: light or dark decides react-navigation's own defaults; the web gives it only inks, which never change
  const dark = useResolvedTheme() === 'dark' && Platform.OS !== 'web'
  const reduce = usePref('reduceMotion')
  // Every navigator's own surfaces (a tab scene before its screen has painted, a nested stack's card, a header) take
  // the app's page colour: left to react-navigation's default theme they were #f2f2f2, which flashed on the first
  // switch to a tab (the Read tab most, while its stack loaded) in every theme, and glared in Black.
  const navTheme = useMemo(() => {
    const base = dark ? DarkTheme : DefaultTheme
    return { ...base, dark, colors: { ...base.colors, background: c.bg, card: c.bar, text: c.text, border: c.border, primary: c.accent } }
  }, [dark, c])
  const screenOptions = useMemo(() => ({ freezeOnBlur: true, headerStyle: { backgroundColor: c.bg }, headerTintColor: c.accent, headerTitleStyle: { color: c.text, fontSize: 20, ...titleFace }, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' as const, contentStyle: { backgroundColor: c.bg }, animation: reduce ? 'none' as const : 'slide_from_right' as const, animationDuration: 320 }), [c, reduce])
  return (
    <ThemeProvider value={navTheme}>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: 'Sign in', presentation: 'modal' }} />
        <Stack.Screen name="bookmarks" options={{ title: 'Bookmarks' }} />
        <Stack.Screen name="outlines/index" options={{ title: NOUN.Many }} />
        <Stack.Screen name="outlines/[id]" options={{ title: NOUN.One }} />
        {/* named before the screen sets its own title, so a push never shows the route's file name for a frame */}
        <Stack.Screen name="friends/index" options={{ title: 'Friends' }} />
        <Stack.Screen name="groups/index" options={{ title: 'Groups' }} />
        <Stack.Screen name="companion" options={{ title: 'Ministry' }} />
        <Stack.Screen name="paths" options={{ title: 'Paths' }} />
        <Stack.Screen name="themes" options={{ title: 'Themes' }} />
        <Stack.Screen name="credits" options={{ title: 'Credits' }} />
        {/* second addresses (src/components/Alias): each replaces itself with the real route at once, so no header */}
        <Stack.Screen name="ministry" options={ALIAS} />
        <Stack.Screen name="chronological" options={ALIAS} />
        <Stack.Screen name="plans" options={ALIAS} />
        <Stack.Screen name="jottings/index" options={ALIAS} />
        <Stack.Screen name="jottings/[id]" options={ALIAS} />
        <Stack.Screen name="+not-found" options={{ title: 'Not found' }} />
      </Stack>
    </ThemeProvider>
  )
}

/** Carries what was bookmarked, highlighted and outlined signed out into the account at sign-in. */
function LibraryMerge() {
  useLocalLibraryMerge()
  return null
}

/** Rendered with the navigator so a tapped notification has somewhere to go. */
function StreakReminder() {
  useStreakReminder()
  useVerseNotify()
  return null
}

/** Friend invites while the app is open (a toast, or a notification when it is in the background) and the background check. */
function InviteNotice() {
  useInviteNotice()
  return null
}

/** Keeps the Android home-screen widgets in step with the app: opened, brought forward, re-themed, signed out. */
function Widgets() {
  useWidgets()
  return null
}
