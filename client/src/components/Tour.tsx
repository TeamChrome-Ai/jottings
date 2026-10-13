import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Animated, BackHandler, Easing, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Group } from '@shared/types'
import { get } from '../lib/api'
import { fetchChapter } from '../lib/bible'
import { planBlob } from '../lib/blob'
import { createOutline, deleteOutline, saveOutlineItems } from '../lib/library'
import { loadCompanionIndex } from '../lib/companion'
import { holdPositions } from '../lib/libraryPosition'
import { loadFriendsCached } from '../lib/friends'
import { sectionsFor } from '@shared/companion'
import {
  CHOICE, EMPTY_SCENE, FINAL_TEXT, STEPS, TOOLBAR_WIDE, comfortable, demoNoteOf, pickOnScreen, placeLabel, progressText, sameRect, sceneActions, spotlight, stepsFor, union, visibleShare,
  type Hole, type Rect, type Route, type Scene, type SceneAction, type Step, type TourMode,
} from '../lib/tour'
import { loadPosition } from '../hooks/usePosition'
import { useColors } from '../hooks/useTheme'
import { useAuth } from '../store/auth'
import { publishOverlay } from '../store/overlay'
import { usePlayer } from '../store/player'
import { usePref, usePrefsStore, useReduceMotion } from '../store/prefs'
import { setThemePick, setTourNote, setTourSample, tourControls, tourScrollers, tourTargets, type Measurable } from '../store/tour'
import { useToast } from '../store/toast'
import { THEME_MAP } from '../theme'
import SkipPill from './SkipPill'
import ThemeBlob from './ThemeBlob'
import { skipThemeVeil } from './ThemeVeil'
// the tour keeps the tempo it was written at (Animation speed still applies)
import { atTempo } from './motion/speed'
import { AUTHORED_TEMPO } from '../lib/motionSpeed'
import TourVeil from './TourVeil'
import { Button, RADIUS, TYPE } from './ui'
import { useEdition } from '../lib/edition'
import { NOUN } from '@shared/brand'

/*
 * The guided tour: coach marks over the live interface. A veil in the sheet scrim with a rounded spotlight cut round
 * the real element, measured when the step comes up and again every so often (layout, rotation, a note opening); a
 * short label beside it. The spotlight glides from one element to the next with the pager's easing and the label
 * crossfades; both are instant under Reduce animation.
 *
 * The short tour (lib/tour.ts STEPS), in the reader (the chapter the hand-off chose, else where the reader is): the book
 * and chapter button, a footnote the tour opens, a verse it selects, word lookup, Read aloud, then the tab bar under it.
 * At its end a quiet choice: the full tour (EXTENDED: the reader's other controls and sheets, the chapter's end, the
 * read-aloud bar, a word's sheet, Ministry on a verse and the library work it opens, Home, Outlines on a sample it makes
 * and removes, Friends, Groups, Search, Stats, Settings), or "That's enough". Settings can start either.
 *
 * Each step names the scene it needs (screen, sheet, selection, read aloud cued up, note, sample); the tour opens and
 * closes things through controls the screens offer (store/tour.ts), so Back works the same way as Next. It ends by
 * closing everything it opened: the veil opens out and "That's it. Read well." comes up as the app's own toast. It is
 * drawn in the top layer (store/overlay.tsx), over an open sheet when there is one. Once per device (`toured`).
 */

const SCRIM = 'rgba(0,0,0,0.45)'
/** How long a step waits for its element (a screen loading, a note opening) before the tour moves past it. */
const FIND_MS = 4000
/** While a step is up its element is measured again this often, so the spotlight follows layout and rotation. */
const REMEASURE_MS = 300
/** The last line's time on screen, and the veil's opening out before it. */
const FINAL_REST_MS = 2400, OPEN_MS = 480
const LABEL_W = 340
/** A sheet's spring in, or its slide out, before what is in it is measured. */
const SHEET_IN_MS = 380, SHEET_OUT_MS = 240

type Chapter = { book: number; chapter: number }

const measure = (m: Measurable) => new Promise<Rect | null>(resolve => {
  try { m.measureInWindow((x, y, w, h) => resolve(Number.isFinite(x) && w > 0 && h > 0 ? { x, y, w, h } : null)) } catch { resolve(null) }
})
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function waitFor<T>(get: () => T | null | undefined | false, ms = 3000): Promise<T | null> {
  const end = Date.now() + ms
  for (;;) {
    const v = get()
    if (v) return v
    if (Date.now() > end) return null
    await sleep(60)
  }
}

/** The on-screen copy of each of the step's elements, joined; null until every one is there and mostly in view. */
async function locate(step: Step, view: Rect): Promise<Rect | null> {
  let box: Rect | null = null
  for (const id of step.targets) {
    // a tab nothing registers is left out of the union (the tab bar draws only some with a ref); anything else not yet
    // registered (a note still opening) holds the step back
    if (id.startsWith('tab-') && !tourTargets(id).length) continue
    const rects = (await Promise.all(tourTargets(id).map(measure))).filter((r): r is Rect => !!r)
    const i = pickOnScreen(rects, view)
    if (i < 0) return null
    box = box ? union(box, rects[i]) : rects[i]
  }
  return box && visibleShare(box, view) >= 0.5 ? box : null
}

/**
 * Brings a step's first element into view when it is registered but scrolled away: the web scrolls the element itself,
 * native the screen's ScrollView that holds it.
 */
async function reveal(step: Step, reduce: boolean, viewH: number) {
  const els = tourTargets(step.targets[0])
  if (!els.length) return
  if (Platform.OS === 'web') {
    const sized = els.map(e => e as unknown as HTMLElement).filter(e => typeof e.getBoundingClientRect === 'function' && e.getBoundingClientRect().height > 0)
    const el = sized[0]
    if (!el) return
    let box: HTMLElement | null = el.parentElement
    while (box && !(box.scrollHeight > box.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement
    if (!box) return
    // a tall block is brought in by its top, with room for the spotlight's edge above it; anything else to the middle
    const r = el.getBoundingClientRect(), p = box.getBoundingClientRect()
    const off = r.height > viewH * 0.45 ? 24 : (p.height - r.height) / 2
    // the DOM's own scrollTo: react-native-web puts its ScrollView method ({ x, y }) on the node under the same name
    ;(Element.prototype.scrollTo as (this: Element, o: ScrollToOptions) => void).call(box, { top: box.scrollTop + (r.top - p.top) - off, behavior: reduce ? 'auto' : 'smooth' })
    return
  }
  for (const s of tourScrollers()) {
    const inner = (s.getInnerViewRef?.() ?? s.getInnerViewNode?.()) as never
    if (!inner) continue
    for (const el of els) {
      const node = el as unknown as { measureLayout?: (rel: never, ok: (x: number, y: number, w: number, h: number) => void, fail: () => void) => void }
      node.measureLayout?.(inner, (_x, y, _w, h) => s.scrollTo({ y: Math.max(0, y - (h > viewH * 0.45 ? 24 : viewH * 0.3)), animated: !reduce }), () => {})
    }
  }
}

const routeOf = (path: string): Route =>
  path === '/' ? 'home' : path === '/search' ? 'search' : path === '/stats' ? 'stats' : path === '/settings' ? 'settings'
    : path.startsWith('/read/') ? 'reader' : path === '/outlines' ? 'outlines' : /^\/outlines\/[^/]+\/edit$/.test(path) ? 'outline-edit'
      : path === '/friends' ? 'friends' : path === '/groups' ? 'groups' : path.startsWith('/groups/') ? 'group' : 'any'
/** The pushed screens the tour walks through; a tab is reached from them by dismissing the stack first. */
const STACKS = ['/outlines', '/groups', '/friends', '/companion']

type Shown = { step: number; text: string; hole: Hole }
type Phase = 'steps' | 'choice' | 'final'

/** The tour itself, loaded only when it runs (components/TourHost.tsx). */
export default function TourRun({ chapter, full, onClose }: { chapter: Chapter | null; full: boolean; onClose: () => void }) {
  const c = useColors()
  const reduce = useReduceMotion()
  const router = useRouter()
  const store = usePrefsStore()
  const player = usePlayer()
  const playerRef = useRef(player)
  playerRef.current = player
  const showNotes = usePref('showNotes')
  const { user } = useAuth()
  const toast = useToast()
  const insets = useSafeAreaInsets()
  const { width: W, height: H } = useWindowDimensions()
  const view = useRef<Rect>({ x: 0, y: 0, w: W, h: H })
  view.current = { x: 0, y: 0, w: W, h: H }
  const path = usePathname()
  const pathRef = useRef(path)
  pathRef.current = path

  // who and where, fixed for the run: the steps a phone and a signed-out reader get differ from a tablet's
  const [wide] = useState(() => W >= TOOLBAR_WIDE)
  const signedIn = !!user
  const [inGroup, setInGroup] = useState(false)
  const [hasFriends, setHasFriends] = useState(false)
  const groupSlug = useRef<string | null>(null)
  useEffect(() => {
    if (!signedIn) return
    get<Group[]>('/groups').then(gs => { if (gs[0]) { groupSlug.current = gs[0].slug; setInGroup(true) } }).catch(() => {})
    loadFriendsCached().then(f => { if (f.friends.length) setHasFriends(true) }).catch(() => {})
  }, [signedIn])
  const [mode, setMode] = useState<TourMode>(full ? 'full' : 'short')
  const edition = useEdition()
  const steps = stepsFor(mode, { wide, signedIn, inGroup, hasFriends, edition })
  const stepsRef = useRef(steps)
  stepsRef.current = steps

  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('steps')
  const [hole, setHole] = useState<Hole | null>(null)
  const [label, setLabel] = useState<Shown | null>(null)
  const fade = useRef(new Animated.Value(0)).current        // the whole tour
  const labelFade = useRef(new Animated.Value(0)).current
  const ended = useRef(false)
  const target = useRef<Chapter | null>(chapter)
  const scene = useRef<Scene>({ route: routeOf(path) })
  const sample = useRef<number | null>(null)
  const dir = useRef<1 | -1>(1)

  // the library work the full tour opens is not left as the one last read
  useEffect(() => { holdPositions(true); return () => holdPositions(false) }, [])

  // ---- the scene: open and close what a step needs, through the controls the screens offer ----
  const readerTarget = async (): Promise<Chapter> => {
    if (target.current) return target.current
    const p = await loadPosition(signedIn, { waitMs: 1500 })
    target.current = { book: p.book, chapter: p.chapter }
    return target.current
  }
  /** Moves to a screen; false when there is none to move to (no library work goes through this chapter). */
  const go = async (to: Exclude<Route, 'any'>): Promise<boolean> => {
    const p = pathRef.current
    const inStack = STACKS.some(s => p.startsWith(s))
    const tab = (href: '/' | '/search' | '/stats' | '/settings') => { if (inStack && router.canDismiss()) router.dismissAll(); router.navigate(href) }
    let want = ''
    switch (to) {
      case 'home': tab('/'); want = '/'; break
      case 'search': tab('/search'); want = '/search'; break
      case 'stats': tab('/stats'); want = '/stats'; break
      case 'settings': tab('/settings'); want = '/settings'; break
      case 'reader': {
        const t = await readerTarget()
        want = `/read/${t.book}/${t.chapter}`
        if (p !== want) { if (inStack && router.canDismiss()) router.dismissAll(); router.navigate({ pathname: '/read/[book]/[chapter]', params: { book: String(t.book), chapter: String(t.chapter), v: '' } }) }
        break
      }
      // the stack pages stand on their list, as a reader who tapped through would have them: back to the list is a
      // dismiss to it, and a page is only pushed from its list
      case 'outlines':
        want = '/outlines'
        if (p.startsWith('/outlines/')) router.dismissTo('/outlines')
        else if (p !== want) { if (inStack && router.canDismiss()) router.dismissAll(); router.push('/outlines') }
        break
      case 'outline-edit':
        want = `/outlines/${sample.current}/edit`
        if (p === want || sample.current === null) break
        if (p !== '/outlines') await go('outlines')
        router.push({ pathname: '/outlines/[id]/edit', params: { id: String(sample.current) } })
        break
      // a work of the ministry library, as the Ministry sheet opens one: the section going through the chapter, with the
      // way back to its first verse
      case 'library': {
        const t = await readerTarget()
        const idx = await loadCompanionIndex('darby').catch(() => null)
        const at = idx ? sectionsFor(idx, t.book, t.chapter)[0] : undefined
        if (!at) return false
        want = '/companion'
        if (p === want) break
        router.push({ pathname: '/companion', params: { author: 'darby', work: at.work.id, n: String(at.n), from: `${t.book}.${t.chapter}.1` } })
        break
      }
      case 'friends':
        want = '/friends'
        if (p !== want) { if (inStack && router.canDismiss()) router.dismissAll(); router.push('/friends') }
        break
      case 'groups':
        want = '/groups'
        if (p.startsWith('/groups/')) router.dismissTo('/groups')
        else if (p !== want) { if (inStack && router.canDismiss()) router.dismissAll(); router.push('/groups') }
        break
      case 'group':
        want = `/groups/${groupSlug.current}`
        if (p === want || !groupSlug.current) break
        if (p !== '/groups') await go('groups')
        router.push(`/groups/${groupSlug.current}`)
        break
    }
    await waitFor(() => pathRef.current === want, 3000)
    return true
  }
  /** One step of a scene change; false when it cannot be done (no note in this chapter), so the step is passed. */
  const act = async (a: SceneAction): Promise<boolean> => {
    const ctl = tourControls
    switch (a.kind) {
      case 'route': return go(a.to)
      case 'sheet': {
        const which = a.open ?? scene.current.sheet
        const open = !!a.open
        if (which === 'more' || which === 'themes' || which === 'word' || which === 'ministry') {
          const r = await waitFor(() => ctl().reader)
          if (r && !(await r.sheet(open ? which : null))) return false
        }
        else if (which === 'listening') { const r = await waitFor(() => ctl().player); r?.settings(open) }
        else if (which === 'print') { const r = await waitFor(() => ctl().editor); r?.print(open) }
        await sleep(reduce ? 60 : open ? SHEET_IN_MS : SHEET_OUT_MS)
        return true
      }
      case 'select': { const r = await waitFor(() => ctl().reader); await r?.select(a.on); await sleep(a.on && !reduce ? 320 : 60); return true }
      case 'player': {
        const t = await readerTarget()
        if (a.on) {
          playerRef.current.start(t.book, t.chapter, 1, { cue: true })
          await waitFor(() => playerRef.current.status === 'paused' || playerRef.current.status === 'error', 5000)
        } else playerRef.current.stop()
        return true
      }
      case 'end': {
        const r = await waitFor(() => ctl().reader)
        r?.end(a.on)
        await sleep(a.on && !reduce ? 420 : 60)
        return true
      }
      case 'note': {
        if (!a.on) { setTourNote(null); return true }
        const t = await readerTarget()
        const id = showNotes ? await fetchChapter(t.book, t.chapter).then(ch => demoNoteOf(ch.verses), () => null) : null
        if (id == null) return false
        setTourNote(id)
        return true
      }
      case 'sample': {
        if (a.on) {
          const o = await createOutline({ title: `Sample ${NOUN.one}`, description: 'Made by the tour to show the editor; it goes when the tour moves on.' })
          await saveOutlineItems(o.id, [
            { kind: 'heading', text: 'In the beginning', depth: 0 },
            { kind: 'verse', book: 43, chapter: 1, v1: 1, v2: 1, depth: 0 },
            { kind: 'note', text: 'A note of your own sits under the passage it belongs to.', depth: 1 },
          ])
          sample.current = o.id
          setTourSample(o.id)
        } else if (sample.current !== null) {
          const id = sample.current
          sample.current = null
          setTourSample(null)
          await deleteOutline(id).catch(() => {})
        }
        return true
      }
    }
  }
  const setScene = async (to: Scene, isLive: () => boolean): Promise<boolean> => {
    for (const a of sceneActions(scene.current, to)) {
      if (!isLive()) return false
      const ok = await act(a)
      const cur = scene.current
      // keep the record true to what is showing, action by action, so a skip mid-change closes the right things
      // a new screen starts with nothing open on it; the sample outline is not the screen's and stays
      if (a.kind === 'route') { if (ok) scene.current = { route: a.to, sample: cur.sample } }
      else if (a.kind === 'sheet') scene.current = { ...cur, sheet: a.open ?? undefined }
      else scene.current = { ...cur, [a.kind]: a.on && ok ? true : undefined }
      if (!ok) return false
    }
    return true
  }

  // ---- ending: close everything the tour opened, then open the veil out (or just fade on Skip) ----
  const finish = useCallback((skipped: boolean) => {
    if (ended.current) return
    ended.current = true
    setThemePick(null)
    const close = () => { store.set({ toured: true }); onClose() }
    const out = () => { if (reduce) { close(); return } Animated.timing(fade, atTempo(AUTHORED_TEMPO, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true })).start(() => close()) }
    void setScene(EMPTY_SCENE, () => true).then(() => {
      if (skipped) { out(); return }
      setPhase('final')
      const v = view.current
      setHole({ x: 0, y: 0, w: v.w, h: v.h, r: 0 })
      const bye = () => { close(); toast.show(FINAL_TEXT, FINAL_REST_MS) }
      if (reduce) bye(); else setTimeout(bye, OPEN_MS)
    })
    // setScene reads refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, reduce, fade, onClose, toast])
  const skip = useCallback(() => finish(true), [finish])
  const at = useRef(index)
  at.current = index
  const modeRef = useRef(mode)
  modeRef.current = mode
  const next = useCallback(() => {
    if (ended.current) return
    dir.current = 1
    if (at.current + 1 < stepsRef.current.length) { setIndex(at.current + 1); return }
    if (modeRef.current === 'short') {
      // the short tour's end: close what it opened, draw the veil in to a point, and ask
      setThemePick(null)
      void setScene({ route: 'any' }, () => !ended.current)
      setPhase('choice')
      const v = view.current
      setHole({ x: v.w / 2, y: v.h / 2, w: 0, h: 0, r: 0 })
      return
    }
    finish(false)
  }, [finish])
  const back = useCallback(() => {
    if (ended.current || at.current === 0) return
    dir.current = -1
    setIndex(at.current - 1)
  }, [])
  const keepGoing = useCallback(() => {
    dir.current = 1
    setMode('full')
    // on from the first step after the short tour's, as many as this screen had (STEPS lists both word lookups)
    setIndex(stepsRef.current.length)
    setPhase('steps')
  }, [])

  // ---- one step: set its scene, find its element, spotlight it; then keep it measured ----
  useEffect(() => {
    if (phase !== 'steps') return
    const step = stepsRef.current[index]
    if (!step) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const live = () => !cancelled && !ended.current
    const pass = () => {
      if (!live()) return
      const n = index + dir.current
      if (n < 0) { dir.current = 1; setIndex(index + 1) }
      else if (n >= stepsRef.current.length) next()
      else setIndex(n)
    }
    const run = async () => {
      const ok = await setScene(step.scene, live)
      if (!live()) return
      if (!ok) { pass(); return }
      // found, and in the same place twice running: a screen still mounting or a sheet still opening is let settle,
      // so the spotlight makes one glide to where the element comes to rest
      const began = Date.now()
      let found: Rect | null = null, prev: Rect | null = null, reveals = 0
      while (live()) {
        found = await locate(step, view.current)
        // scrolled away, or tucked under a bar: brought into view, then let settle
        const tucked = !step.fixed && !step.scene.sheet && (found ? !comfortable(found, view.current, { top: insets.top + 8, bottom: insets.bottom + 90 }) : tourTargets(step.targets[0]).length > 0)
        // (again, a few times: a screen still loading its content can push the element further down after a scroll)
        if (tucked && reveals < 4) { reveals++; await reveal(step, reduce, view.current.h); prev = null; await sleep(reduce ? 60 : 420); continue }
        if (found && sameRect(found, prev)) break
        prev = found
        if (Date.now() - began > FIND_MS) { if (found) break; pass(); return }
        await sleep(120)
      }
      if (!live() || !found) return
      let last = found
      const show = (box: Rect) => setHole(spotlight(box, step, view.current))
      show(found)
      setLabel({ step: index, text: step.text, hole: spotlight(found, step, view.current) })
      const again = async () => {
        if (!live()) return
        const box = await locate(step, view.current)
        if (!live()) return
        if (box && !sameRect(box, last)) { last = box; show(box); setLabel(l => (l && l.step === index ? { ...l, hole: spotlight(box, step, view.current) } : l)) }
        timer = setTimeout(again, REMEASURE_MS)
      }
      timer = setTimeout(again, REMEASURE_MS)
    }
    void run()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
    // one run per step; the rest is read through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, phase, mode])

  // ---- the theme step: a swatch tap lifts off as a blob of the new page, lands and spreads, then the theme applies ----
  const stepId = phase === 'steps' ? steps[index]?.id : undefined
  const blobBusy = useRef(false)
  useEffect(() => {
    if (stepId !== 'theme-pick') return
    setThemePick((id, from) => {
      const t = THEME_MAP[id]
      if (!t || blobBusy.current) return
      const apply = () => { skipThemeVeil(t.id); store.set({ theme: t.id, ...(t.dark ? { themeDark: t.id } : { themeLight: t.id }) }) }
      if (reduce) { apply(); return }
      blobBusy.current = true
      from.measureInWindow((x, y, w, h) => {
        const done = () => { publishOverlay('z-blob', null); blobBusy.current = false }
        publishOverlay('z-blob', <ThemeBlob plan={planBlob({ x, y, w, h }, view.current)} bg={t.bg} border={t.border} accent={t.accent} onCovered={apply} onDone={done} />)
      })
    })
    return () => setThemePick(null)
  }, [stepId, reduce, store])

  // the first spotlight fades the whole tour in; after that the veil only glides
  const visible = !!hole
  useEffect(() => {
    if (!visible) return
    if (reduce) fade.setValue(1)
    else Animated.timing(fade, atTempo(AUTHORED_TEMPO, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true })).start()
  }, [visible, reduce, fade])

  // ---- the label: out, moved, in, as the spotlight arrives ----
  const [shown, setShown] = useState<Shown | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const labelNow = useRef(label)
  labelNow.current = label
  useEffect(() => { if (label && shown && label.step === shown.step) setShown(label) }, [label])   // eslint-disable-line react-hooks/exhaustive-deps
  const labelKey = phase === 'choice' ? 'choice' : label?.step
  useEffect(() => {
    if (labelKey === undefined) return
    if (reduce) { if (labelKey !== 'choice') setShown(labelNow.current); labelFade.setValue(1); return }
    let alive = true
    const out = Animated.timing(labelFade, atTempo(AUTHORED_TEMPO, { toValue: 0, duration: 110, easing: Easing.in(Easing.quad), useNativeDriver: true }))
    out.start(() => {
      if (!alive) return
      if (labelKey !== 'choice') setShown(labelNow.current)
      Animated.timing(labelFade, atTempo(AUTHORED_TEMPO, { toValue: 1, duration: 220, delay: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true })).start()
    })
    return () => { alive = false }
  }, [labelKey, reduce, labelFade])
  const choice = phase === 'choice'
  const placed = choice && size
    ? { x: (W - size.w) / 2, y: (H - size.h) / 2, below: true }
    : shown && size ? placeLabel(shown.hole, view.current, size, { gap: 14, margin: 16, insets }) : null
  const onLabelLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setSize(s => (s && Math.abs(s.w - width) < 1 && Math.abs(s.h - height) < 1 ? s : { w: width, h: height }))
  }

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { skip(); return true })
    if (Platform.OS !== 'web' || typeof window === 'undefined') return () => sub.remove()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') skip() }
    window.addEventListener('keydown', key)
    return () => { sub.remove(); window.removeEventListener('keydown', key) }
  }, [skip])

  // a tap inside the spotlight moves on, as Next does, unless the step wants taps to reach the app (the theme swatches);
  // the rest of the screen is held still until the tour ends
  const step = steps[index]
  const interactive = phase === 'steps' && !!step?.interactive && !!hole
  const onVeil = (x: number, y: number) => {
    if (phase !== 'steps') return
    if (hole && x >= hole.x && x <= hole.x + hole.w && y >= hole.y && y <= hole.y + hole.h) next()
  }
  const n = steps.length, i = shown?.step ?? 0
  const lastStep = index === n - 1
  const labelOpacity = useMemo(() => Animated.multiply(fade, labelFade), [fade, labelFade])
  const lift = labelFade.interpolate({ inputRange: [0, 1], outputRange: [placed && !placed.below ? 6 : -6, 0] })

  // siblings, not one wrapper: the spotlight of an interactive step has to leave the app beneath it tappable
  const layer = (
    <>
      {interactive && hole ? <Blockers hole={hole} W={W} H={H} /> : <Pressable style={StyleSheet.absoluteFill} accessible={false} onPress={e => onVeil(e.nativeEvent.pageX, e.nativeEvent.pageY)} />}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade, pointerEvents: 'none' }]}>
        {hole ? <TourVeil hole={hole} W={W} H={H} color={SCRIM} reduce={reduce} /> : null}
      </Animated.View>
      {phase !== 'final' ? (
        <Animated.View onLayout={onLabelLayout} accessibilityLiveRegion="polite" accessibilityViewIsModal
          style={[styles.label, { width: Math.min(LABEL_W, W - 32), backgroundColor: c.bg, left: placed?.x ?? 16, top: placed?.y ?? -9999, opacity: labelOpacity, transform: [{ translateY: lift }] }]}>
          {choice ? (
            <>
              <Text style={{ color: c.text, fontSize: TYPE.body, lineHeight: 23 }}>{CHOICE.text}</Text>
              <View style={{ gap: 10 }}>
                <Button soft title={CHOICE.more} onPress={keepGoing} />
                <Button title={CHOICE.enough} onPress={() => finish(false)} />
              </View>
            </>
          ) : (
            <>
              <Text style={{ color: c.text, fontSize: TYPE.body, lineHeight: 23 }}>{shown?.text ?? STEPS[0].text}</Text>
              <View style={styles.footer}>
                <SkipPill onPress={skip} label="Skip the tour" />
                {mode === 'short'
                  ? <Dots at={i} n={n} />
                  : <Text accessibilityLabel={`Step ${i + 1} of ${n}`} style={{ color: c.muted, fontSize: TYPE.caption, fontVariant: ['tabular-nums'] }}>{progressText(i, n)}</Text>}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {mode === 'full' ? <Button small title="Back" disabled={index === 0} onPress={back} /> : null}
                  <Button small primary title={lastStep ? 'Done' : 'Next'} onPress={next} />
                </View>
              </View>
            </>
          )}
        </Animated.View>
      ) : null}
    </>
  )
  // drawn in the top layer, so it stands over a sheet the tour opens
  useLayoutEffect(() => { publishOverlay('tour', layer) })
  useEffect(() => () => publishOverlay('tour', null), [])
  return null
}

/**
 * Four blocks round the spotlight, for a step whose element takes taps (the theme swatches): the hole itself is left
 * open to the app, the rest of the screen stays held.
 */
function Blockers({ hole, W, H }: { hole: Hole; W: number; H: number }) {
  const r = (x: number, y: number, w: number, h: number) => ({ position: 'absolute' as const, left: x, top: y, width: Math.max(0, w), height: Math.max(0, h) })
  return (
    <>
      <Pressable accessible={false} style={r(0, 0, W, hole.y)} />
      <Pressable accessible={false} style={r(0, hole.y + hole.h, W, H - hole.y - hole.h)} />
      <Pressable accessible={false} style={r(0, hole.y, hole.x, hole.h)} />
      <Pressable accessible={false} style={r(hole.x + hole.w, hole.y, W - hole.x - hole.w, hole.h)} />
    </>
  )
}

/** Where the short tour is: one dot per step, the current one a short accent pill. */
function Dots({ at, n }: { at: number; n: number }) {
  const c = useColors()
  return (
    <View accessibilityLabel={`Step ${at + 1} of ${n}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      {Array.from({ length: n }, (_, k) => <View key={k} style={{ width: k === at ? 14 : 6, height: 6, borderRadius: 3, backgroundColor: k === at ? c.accent : c.border }} />)}
    </View>
  )
}

const styles = StyleSheet.create({
  label: { position: 'absolute', borderRadius: RADIUS.card, padding: 18, gap: 14 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
})
