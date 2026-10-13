import { useEffect } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { registerWidgetTaskHandler, requestWidgetUpdate, type WidgetInfo, type WidgetRepresentation } from 'react-native-android-widget'
import type { StreakInfo } from '@shared/types'
import { bundledChapter } from '../lib/bundledBible'
import { useAuth } from '../store/auth'
import { usePrefSelect } from '../store/prefs'
import { THEME_MAP, type ThemeId } from '../theme'
import { StreakWidget, VerseWidget } from './layouts'
import { streakCard, verseCard, widgetThemes } from './model'

/**
 * Android home-screen widgets: Verse of the day and Reading streak (`index.ts` is the inert copy for iOS and the web).
 *
 * Android asks for a drawing when a widget is added, resized or updated: after a reboot or an app update, and at each
 * local midnight or clock change (`plugins/withWidgets.js` sets that alarm). That runs the headless task below, which
 * reads what the app left on the device: the streak as of the last stats sync and the theme picks. Nothing here
 * touches the network or the sign-in token. The app itself redraws both when it opens or comes forward, when the
 * themes change, when a stats read or a heartbeat changes what the streak widget shows, and on sign-out.
 */

/** The provider class names app.json's widget config generates. */
const VERSE = 'VerseOfTheDay'
const STREAK = 'ReadingStreak'
/** The last synced streak, kept for the widget; removed on sign-out. */
const STREAK_KEY = 'berean_widget_streak'
/** The app's own prefs record (`store/prefs.tsx`). */
const PREFS_KEY = 'berean_prefs'

type Themes = { light: ThemeId; dark: ThemeId }
type Data = { streak: StreakInfo | null; themes: Themes }
type ThemePrefs = { theme: string; themeLight: string; themeDark: string }

// The app's own values once it has set them; a headless start reads the stored copies instead
let streak: StreakInfo | null | undefined
let themes: Themes | undefined
/** What the streak widget shows now, so a heartbeat that changes nothing on it is not a redraw. */
let shown = ''

const parse = (raw: string | null): unknown => { try { return raw ? JSON.parse(raw) : null } catch { return null } }

async function load(): Promise<Data> {
  if (streak === undefined || !themes) {
    const [[, s], [, p]] = await AsyncStorage.multiGet([STREAK_KEY, PREFS_KEY])
    if (streak === undefined) streak = parse(s) as StreakInfo | null
    themes ??= widgetThemes(parse(p) as Partial<ThemePrefs> | null)
  }
  return { streak, themes }
}

function draw(info: WidgetInfo, { streak: s, themes: t }: Data): WidgetRepresentation {
  const now = new Date()
  const size = { width: info.width, height: info.height }
  if (info.widgetName === VERSE) {
    const card = verseCard(now, bundledChapter)
    return { light: <VerseWidget card={card} c={THEME_MAP[t.light]} {...size} />, dark: <VerseWidget card={card} c={THEME_MAP[t.dark]} {...size} /> }
  }
  const card = streakCard(s, now)
  return { light: <StreakWidget card={card} c={THEME_MAP[t.light]} {...size} />, dark: <StreakWidget card={card} c={THEME_MAP[t.dark]} {...size} /> }
}

async function update(name: string) {
  try {
    const data = await load()
    await requestWidgetUpdate({ widgetName: name, renderWidget: info => draw(info, data) })
  } catch { /* a widget that cannot be drawn keeps its last picture */ }
}

/** From the app entry, so Android can start the task without the app on screen. */
export function registerWidgets() {
  registerWidgetTaskHandler(async ({ widgetInfo, widgetAction, renderWidget }) => {
    // taps open the app through their links; a removed widget has nothing to draw
    if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return
    renderWidget(draw(widgetInfo, await load()))
  })
}

/** Every /stats read and heartbeat (`publishStreak`): kept for the widget and drawn when what it shows changes. */
export function noteWidgetStreak(s: StreakInfo) {
  streak = s
  const sig = JSON.stringify(streakCard(s, new Date()))
  if (sig === shown) return
  shown = sig
  AsyncStorage.setItem(STREAK_KEY, JSON.stringify(s)).catch(() => {})
  void update(STREAK)
}

function clearStreak() {
  if (streak === null) return
  streak = null
  shown = ''
  AsyncStorage.removeItem(STREAK_KEY).catch(() => {})
  void update(STREAK)
}

/** Mounted once under the navigator: redraws on open, on coming forward and on a theme change; clears on sign-out. */
export function useWidgets() {
  const { user, ready } = useAuth()
  const light = usePrefSelect(p => widgetThemes(p).light)
  const dark = usePrefSelect(p => widgetThemes(p).dark)
  useEffect(() => { if (ready && !user) clearStreak() }, [ready, user])
  useEffect(() => {
    themes = { light, dark }
    void update(VERSE); void update(STREAK)
  }, [light, dark])
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') { void update(VERSE); void update(STREAK) } })
    return () => sub.remove()
  }, [])
}
