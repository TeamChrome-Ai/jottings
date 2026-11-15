import { Suspense, lazy, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { usePathname } from 'expo-router'
import { useInks } from '../hooks/useTheme'
import { usePref, usePrefsStore } from '../store/prefs'
import { closeWelcome, startWelcome, useWelcomeRun } from '../store/welcome'
import { useTourRequest } from '../store/tour'
import { closeNews, markNewsAsked, newsAsked, playNews, useNewsRun } from '../store/whatsNew'
import { WHATS_NEW, newsDue } from '@shared/whatsNew'

/*
 * The welcome, the guided tour and the news of an update, mounted by the root layout. Each decides here whether it is
 * due; their code (the choreography, the coach marks, and Reanimated with them on the phone) loads only then, so a
 * reader who has seen them never parses them. The welcome and the news come as one chunk (components/Openings.ts).
 */
const openings = () => import('./Openings')
const Overture = lazy(() => openings().then(m => ({ default: m.Overture })))
const TourRun = lazy(() => import('./Tour'))
const WhatsNew = lazy<ComponentType<{ replay: boolean; onClose: () => void }>>(() => openings().then(m => ({ default: m.WhatsNew })).catch(() => ({ default: Unfetched })))

const isAuthPopup = () => Platform.OS === 'web' && typeof window !== 'undefined' && !!window.opener && !!(window.location.search || window.location.hash)

/**
 * Shows the welcome on a device's first launch (when the app opens on Home, not on a shared link) once the fonts are
 * in, and again whenever Settings asks.
 */
export function Welcome({ ready }: { ready: boolean }) {
  const store = usePrefsStore()
  const loaded = useSyncExternalStore(store.subscribe, store.isLoaded, store.isLoaded)
  const onboarded = usePref('onboarded')
  // the run is kept outside React (store/welcome.ts): this component is remounted while it plays
  const run = useWelcomeRun()
  const launchPath = useRef(usePathname()).current
  const due = loaded && !onboarded && launchPath === '/' && !isAuthPopup()
  useEffect(() => {
    if (!due || !ready) return
    // persist before the animation runs: Home or a kill mid-welcome used to show it again every launch.
    // A new install has the version it installed, so its news is marked seen in the same write.
    store.set({ onboarded: true, seenNew: WHATS_NEW.version })
    startWelcome()
  }, [due, ready, store])
  // until Literata and the welcome's code are in, a blank page rather than a glimpse of Home
  if (run) return <Suspense fallback={<Blank />}><Overture key={run.key} replay={run.replay} onClose={closeWelcome} /></Suspense>
  return due ? <Blank /> : null
}

function Blank() {
  const c = useInks()
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]} />
}

/**
 * Shows the news of an update (shared/whatsNew.ts) over Home on the first launch after it, once the fonts are in, and
 * again whenever Settings asks. The launch settles it once (store/whatsNew.ts): a launch on a shared link leaves the
 * news for the next one on Home.
 */
export function News({ ready }: { ready: boolean }) {
  const store = usePrefsStore()
  const loaded = useSyncExternalStore(store.subscribe, store.isLoaded, store.isLoaded)
  const onboarded = usePref('onboarded'), seenNew = usePref('seenNew')
  const run = useNewsRun()
  const welcome = !!useWelcomeRun()
  const path = useRef(usePathname()).current
  const due = !newsAsked() && newsDue({ loaded, onboarded, seenNew, path, popup: isAuthPopup(), welcome })
  useEffect(() => {
    if (!loaded || !ready || newsAsked()) return
    markNewsAsked()
    if (!due) return
    // persisted before the scenes run, as the welcome is: a kill mid-run must not show them again at every launch
    store.set({ seenNew: WHATS_NEW.version })
    playNews(false)
  }, [loaded, ready, due, store])
  if (run) return <Suspense fallback={<Blank />}><WhatsNew key={run.key} replay={run.replay} onClose={closeNews} /></Suspense>
  return due ? <Blank /> : null
}

/**
 * Stands in for the scenes when their code cannot be fetched (the web, offline with nothing cached): Home is not taken
 * down with it, and a launch's own run is left unseen, to be told at the next.
 */
function Unfetched({ replay, onClose }: { replay: boolean; onClose: () => void }) {
  const store = usePrefsStore()
  useEffect(() => { if (!replay) store.set({ seenNew: '' }); onClose() }, [replay, store, onClose])
  return null
}

type Chapter = { book: number; chapter: number }
/** Runs the tour when the welcome hands over, or when Settings asks. Does not resume on the next launch. */
export function Tour() {
  const req = useTourRequest()
  const [run, setRun] = useState<{ key: number; chapter: Chapter | null; full: boolean } | null>(null)
  useEffect(() => { if (req.n) setRun({ key: req.n, chapter: req.chapter, full: req.full }) }, [req])
  const close = useCallback(() => setRun(null), [])
  return run ? <Suspense fallback={null}><TourRun key={run.key} chapter={run.chapter} full={run.full} onClose={close} /></Suspense> : null
}
