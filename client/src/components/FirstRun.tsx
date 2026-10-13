import { Suspense, lazy, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { usePathname } from 'expo-router'
import { useInks } from '../hooks/useTheme'
import { usePref, usePrefsStore } from '../store/prefs'
import { useWelcomeReplay } from '../store/welcome'
import { useTourRequest } from '../store/tour'

/*
 * The welcome and the guided tour, mounted by the root layout. Both decide here whether they are due; their code
 * (the choreography, the coach marks, and Reanimated with them on the phone) loads only then, so a reader who has
 * seen them never parses them.
 */
const Overture = lazy(() => import('./Overture'))
const TourRun = lazy(() => import('./Tour'))

const isAuthPopup = () => Platform.OS === 'web' && typeof window !== 'undefined' && !!window.opener && !!(window.location.search || window.location.hash)

/**
 * Shows the welcome on a device's first launch (when the app opens on Home, not on a shared link) once the fonts are
 * in, and again whenever Settings asks.
 */
export function Welcome({ ready }: { ready: boolean }) {
  const store = usePrefsStore()
  const loaded = useSyncExternalStore(store.subscribe, store.isLoaded, store.isLoaded)
  const onboarded = usePref('onboarded')
  const replay = useWelcomeReplay()
  const launchPath = useRef(usePathname()).current
  const [run, setRun] = useState<{ key: number; replay: boolean } | null>(null)
  const started = useRef(false)
  const due = loaded && !onboarded && launchPath === '/' && !isAuthPopup()
  useEffect(() => {
    if (due && ready && !started.current) {
      started.current = true
      // persist before the animation runs: Home or a kill mid-welcome used to show it again every launch
      store.set({ onboarded: true })
      setRun({ key: 0, replay: false })
    }
  }, [due, ready, store])
  useEffect(() => { if (replay) setRun({ key: replay, replay: true }) }, [replay])
  const close = useCallback(() => setRun(null), [])
  // until Literata and the welcome's code are in, a blank page rather than a glimpse of Home
  if (run) return <Suspense fallback={<Blank />}><Overture key={run.key} replay={run.replay} onClose={close} /></Suspense>
  return due && !started.current ? <Blank /> : null
}

function Blank() {
  const c = useInks()
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]} />
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
