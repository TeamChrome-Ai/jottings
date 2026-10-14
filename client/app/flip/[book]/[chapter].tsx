import ThemeGallery from '../../../src/components/ThemeGallery'
import { useEdition } from '../../../src/lib/edition'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent, type TextLayoutEvent, type ViewStyle } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated'
import type { Verse } from '@shared/types'
import { book as bookMeta, fetchChapter, nextChapter, prevChapter, tokenize, validRef, warmChapter, type ChapterData } from '../../../src/lib/bible'
import { geomFromLines, geomFromTops, geomUniform, landingPage, pageOfVerse, paginate, splitParas, type Landing, type Layout, type Metrics, type Page, type Para } from '../../../src/lib/pages'
import { chapterShape } from '../../../src/lib/screenVerses'
import type { ChapterMarks } from '../../../src/lib/tts'
import { loadPosition, savePosition } from '../../../src/hooks/usePosition'
import { useActivity } from '../../../src/hooks/useActivity'
import { useCredited } from '../../../src/hooks/useReadTicks'
import ChapterEndLine from '../../../src/components/ChapterEndLine'
import { useColors } from '../../../src/hooks/useTheme'
import { useAuth } from '../../../src/store/auth'
import { usePlayer } from '../../../src/store/player'
import { FONT_MAX, FONT_MIN, usePrefs, type Font, type Prefs } from '../../../src/store/prefs'
import { motionSpeed, scaleMs, scaleSpringParams } from '../../../src/lib/motionSpeed'
import { face, type Colors } from '../../../src/theme'
import { lineFactor } from '../../../src/lib/lineHeight'
import Slider from '../../../src/components/Slider'
import { Button, ErrorText, Segmented, Sheet, Spinner, SwitchRow, T } from '../../../src/components/ui'
import { DockedBar, SETTLE_SPRING, TURN_MIN_MS } from '../../../src/components/motion/reader'
import { slideMs } from '../../../src/lib/springs'

type Dir = 1 | -1
interface Turning { dir: Dir; from: number; to: number | null }
/** Everything that moves text on a page. Colours are not in it: a theme change restyles the page and never re-measures. */
interface TextMetrics { fs: number; lineHeight: number; letterSpacing: number; sep: number; font: Font; verseNumbers: boolean; paragraphs: boolean }
/** The shared values a page layer reads to place itself; see Layer. */
interface TurnValues { ox: SharedValue<number>; enterX: SharedValue<number>; pg: SharedValue<number>; tDir: SharedValue<number>; gen: SharedValue<number> }

const PAD_X = 20
const HUD_MS = 3000
const MIN_BOX_H = 200
const TURN_MS = 240
const ENTER_MS = 260
/** Turns and the chapter entrance ease out: a released page keeps the finger's speed and settles (Reanimated's
 *  default in-out started it from rest, so a flick stalled the moment it was let go). */
const OUT = Easing.out(Easing.cubic)
const OMITTED = '[omitted]'
const SANS_BOLD = face('sans', { bold: true })
/** Web only: a small sans span inside serif text keeps its own line box tight, or its different ascent pushes the line open. */
const inlineMark = (size: number) => Platform.OS === 'web' ? { lineHeight: Math.round(size) } : null

/** Paginations by layout key (chapter, page box, text metrics): theme changes, re-opens and return visits skip measuring. */
const layouts = new Map<string, Layout>()
const layoutIds = new WeakMap<Layout, number>()
/**
 * What each layout was packed from, so a page that turns out taller on screen than measured can be packed again.
 * Android measured the chapter heading short, so the first page of a chapter took one line too many and its last
 * line ran under the edge (Romans 11, 2026-10-12). `fixed`: corrected once already; never twice, so it cannot loop.
 */
interface PackInput { titleH: number; paras: Para[]; metrics: Metrics[]; H: number; gap: number; fixed: boolean
  /** Paragraphs whose line geometry was taken from the page as drawn (Android: the hidden measurer's line boxes can
   *  differ from the visible text's, so a page showed part of a line at its foot); each is replaced once. */
  redrawn?: ReadonlySet<number> }
const packInputs = new WeakMap<Layout, PackInput>()
let nextLayoutId = 1
function remember(key: string, l: Layout) {
  layoutIds.set(l, nextLayoutId++)
  layouts.delete(key)
  layouts.set(key, l)
  if (layouts.size > 12) layouts.delete(layouts.keys().next().value as string)
}

// Web: text measured in a fallback face must be laid out again once the real face arrives; the count is part of the layout key.
let fontEpoch = 0
const fontListeners = new Set<() => void>()
if (Platform.OS === 'web' && typeof document !== 'undefined' && document.fonts) {
  document.fonts.addEventListener('loadingdone', () => { fontEpoch++; fontListeners.forEach(f => f()) })
}
const subscribeFonts = (f: () => void) => { fontListeners.add(f); return () => { fontListeners.delete(f) } }
const getFontEpoch = () => fontEpoch

/** Another edition (docs/EDITION.md) remounts the screen on the same chapter, read again in that edition. */
export default function FlipScreen() {
  const edition = useEdition()
  return <FlipScreenPage key={edition} />
}

function FlipScreenPage() {
  const params = useLocalSearchParams<{ book: string; chapter: string; v?: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const { prefs, set } = usePrefs()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const bookN = parseInt(params.book ?? '0', 10)
  const chapterN = parseInt(params.chapter ?? '0', 10)
  const valid = validRef(bookN, chapterN)
  const chapterKey = `${bookN}.${chapterN}`
  const next = valid ? nextChapter(bookN, chapterN) : null
  const prev = valid ? prevChapter(bookN, chapterN) : null

  const [data, setData] = useState<ChapterData | null>(null)
  const [err, setErr] = useState('')
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [, measured] = useReducer((n: number) => n + 1, 0)
  // the last layout shown for a chapter stays up while its replacement is measured (text size, rotation)
  const [shown, setShown] = useState<{ chapter: string; layout: Layout } | null>(null)
  const [pos, setPos] = useState<{ layout: Layout | null; page: number }>({ layout: null, page: 0 })
  const [hud, setHud] = useState(true)
  const [settings, setSettings] = useState(false)
  const [spokenV, setSpokenV] = useState(0)

  const landingRef = useRef<Landing | null>(null)
  const enterDir = useRef<Dir | null>(null)
  const anchorVerse = useRef(1)
  const turningRef = useRef<Turning | null>(null)
  const hudTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---- geometry and text metrics ----
  const padTop = insets.top + 14, padBottom = insets.bottom + 22
  const win = useWindowDimensions()
  // a cold web load reports a 1 px root before hydration settles; nothing is laid out until a plausible box arrives
  const boxH = Math.min(box.h, win.height || box.h)
  const pageW = Math.max(0, Math.floor(box.w - PAD_X * 2))
  const pageH = boxH >= MIN_BOX_H ? Math.max(0, Math.floor(boxH - padTop - padBottom)) : 0
  const tm = useMemo<TextMetrics>(() => {
    const fs = prefs.fontSize, dys = prefs.font === 'dyslexic'
    const letterSpacing = fs * (dys ? Math.max(prefs.letterSpacing, 0.03) : prefs.letterSpacing)
    return {
      fs, lineHeight: Math.round(fs * lineFactor(prefs.font, prefs.lineHeight)), letterSpacing,
      sep: letterSpacing + fs * (dys ? Math.max(prefs.wordSpacing, 0.12) : prefs.wordSpacing),
      font: prefs.font, verseNumbers: prefs.verseNumbers, paragraphs: prefs.paragraphs,
    }
  }, [prefs.fontSize, prefs.font, prefs.letterSpacing, prefs.lineHeight, prefs.wordSpacing, prefs.verseNumbers, prefs.paragraphs])
  const epoch = useSyncExternalStore(subscribeFonts, getFontEpoch, getFontEpoch)
  const layoutKey = `${chapterKey}|${pageW}x${pageH}|${tm.fs}|${tm.lineHeight}|${tm.letterSpacing}|${tm.sep}|${tm.font}|${tm.verseNumbers ? 1 : 0}${tm.paragraphs ? 1 : 0}|${epoch}`
  const layoutKeyRef = useRef(layoutKey); layoutKeyRef.current = layoutKey
  const current = data && data.book === bookN && data.c === chapterN ? data : null
  const paras = useMemo(() => current ? splitParas(current.verses, tm.paragraphs) : [], [current, tm.paragraphs])
  const tmRef = useRef(tm); tmRef.current = tm
  const measurable = !!current && pageW > 0 && pageH > 0
  const cached = measurable ? layouts.get(layoutKey) ?? null : null
  const layout = cached ?? (shown && shown.chapter === chapterKey ? shown.layout : null)
  const layoutRef = useRef(layout); layoutRef.current = layout
  const pages = layout?.pages ?? null
  const count = pages?.length ?? 1
  const countRef = useRef(1); countRef.current = count
  // where a newly arrived layout opens; read once per layout, the landing request is consumed by the effect below
  const landed = useMemo(() => layout ? landingPage(layout, landingRef.current, anchorVerse.current) : 0, [layout])
  const page = pos.layout === layout ? pos.page : landed
  const pageRef = useRef(page); pageRef.current = page
  const setPage = useCallback((n: number) => { pageRef.current = n; setPos({ layout: layoutRef.current, page: n }) }, [])

  // ---- load the chapter; a pending turn has already said how to land ----
  useEffect(() => {
    if (!valid) return
    let alive = true
    setErr('')
    fetchChapter(bookN, chapterN).then(async d => {
      if (!alive) return
      if (!landingRef.current) {
        const pv = params.v ? parseInt(params.v, 10) : 0
        if (pv > 1) landingRef.current = { verse: pv }
        else {
          const p = await loadPosition(!!user)
          if (alive && p.book === bookN && p.chapter === chapterN && p.verse > 1) landingRef.current = { verse: p.verse }
        }
      }
      if (!alive) return
      setData(d)
      const n = nextChapter(bookN, chapterN); if (n) warmChapter(n.book, n.chapter)
      const p = prevChapter(bookN, chapterN); if (p) warmChapter(p.book, p.chapter)
    }).catch(e => { if (alive) setErr((e as Error).message) })
    return () => { alive = false }
    // params.v is consumed once per chapter, on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookN, chapterN, valid])

  const onMeasured = useCallback((key: string, l: Layout) => {
    remember(key, l)
    if (key === layoutKeyRef.current) measured()
  }, [])
  // a paragraph drawn with other line positions than measured (native): pack again from the drawn ones, once each
  const onDrawnLines = useCallback((p: number, lines: readonly { y: number; height: number; text: string }[]) => {
    const l = layoutRef.current, inp = l ? packInputs.get(l) : undefined
    if (!l || !inp || inp.redrawn?.has(p) || !inp.paras[p]) return
    const o = verseOffsets(inp.paras[p].verses, tmRef.current)
    const g = geomFromLines(lines, o.starts, o.total), m = inp.metrics[p]
    if (!g || !m) return
    const drift = g.tops.length !== m.tops.length || g.tops.some((t, k) => Math.abs(t - m.tops[k]) > 1)
    if (!drift) return
    const metrics = inp.metrics.map((x, i) => (i === p ? { head: x.head, ...g } : x))
    const next = { ...inp, metrics, redrawn: new Set([...(inp.redrawn ?? []), p]) }
    const nl = paginate(next.titleH, next.paras, metrics, next.H, next.gap)
    packInputs.set(nl, next)
    onMeasured(layoutKeyRef.current, nl)
  }, [onMeasured])
  // a title drawn at another height than measured: pack again with the drawn one (an exact value, so it settles in one go)
  const onDrawnTitle = useCallback((h: number) => {
    const l = layoutRef.current, inp = l ? packInputs.get(l) : undefined
    if (!l || !inp || h <= 0 || Math.abs(Math.ceil(h) - inp.titleH) <= 1) return
    const next = { ...inp, titleH: Math.ceil(h) }
    const nl = paginate(next.titleH, next.paras, next.metrics, next.H, next.gap)
    packInputs.set(nl, next)
    onMeasured(layoutKeyRef.current, nl)
  }, [onMeasured])
  // a page drawn taller than its frame: pack the chapter again with the room it really took, once (PackInput)
  const onOverflow = useCallback((idx: number, over: number) => {
    const l = layoutRef.current, inp = l ? packInputs.get(l) : undefined
    if (!l || !inp || inp.fixed || over <= 1) return
    const titled = l.pages[idx]?.slices.some(x => x.kind === 'title')
    const fixed = { ...inp, titleH: titled ? inp.titleH + Math.ceil(over) : inp.titleH, H: titled ? inp.H : inp.H - Math.ceil(over), fixed: true }
    const nl = paginate(fixed.titleH, fixed.paras, fixed.metrics, fixed.H, fixed.gap)
    packInputs.set(nl, fixed)
    onMeasured(layoutKeyRef.current, nl)
  }, [onMeasured])

  // ---- turning state on the UI thread: which page is current, which way a turn goes, how far the sheet has moved ----
  const ox = useSharedValue(0)
  const enterX = useSharedValue(0)
  const pg = useSharedValue(0)
  const tDir = useSharedValue(0)
  const gen = useSharedValue(0)
  const busy = useSharedValue(0)
  const dragDir = useSharedValue(0)
  const sv = useMemo<TurnValues>(() => ({ ox, enterX, pg, tDir, gen }), [ox, enterX, pg, tDir, gen])
  const reduce = prefs.reduceMotion
  const layoutId = layout ? layoutIds.get(layout) ?? 0 : 0

  // a layout arrives: open it at the landing page, the chapter entrance slides it in
  useLayoutEffect(() => {
    if (!layout) return
    landingRef.current = null
    turningRef.current = null
    setPos({ layout, page: landed })
    setShown(s => s && s.layout === layout ? s : { chapter: chapterKey, layout })
    gen.value = layoutId
    pg.value = landed
    tDir.value = 0
    busy.value = 0
    ox.value = 0
    const d = enterDir.current
    enterDir.current = null
    if (d && !reduce) enterX.value = withTiming(0, { duration: scaleMs(ENTER_MS, motionSpeed()), easing: OUT })
    else enterX.value = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout])

  // ---- position: the first verse that starts on the shown page ----
  useEffect(() => {
    if (!pages || !valid) return
    const p = pages[page]
    if (!p) return
    anchorVerse.current = p.anchor
    const t = setTimeout(() => savePosition({ book: bookN, chapter: chapterN, verse: p.anchor }, !!user), 800)
    return () => clearTimeout(t)
  }, [pages, page, bookN, chapterN, user, valid])

  // ---- streak heartbeat: progress = pages shown / pages in the chapter ----
  const getProgress = useCallback(() => (pageRef.current + 1) / Math.max(1, countRef.current), [])
  const shownKey = useRef(chapterKey); shownKey.current = chapterKey
  // the last page of a laid-out chapter: before its layout the one placeholder page would count as the last
  const atLastPage = useCallback((b: number, c: number) => `${b}.${c}` === shownKey.current && !!layoutRef.current && pageRef.current >= countRef.current - 1, [])
  /** The verses of the page showing, once the chapter is laid out. */
  const pageVerses = useCallback((): [number, number] | null => {
    const p = shownKey.current === `${bookN}.${chapterN}` ? layoutRef.current?.pages[pageRef.current] : undefined
    return p && p.first > 0 ? [p.first, Math.max(p.first, p.last)] : null
  }, [bookN, chapterN])
  // the recording playing times the verses heard (`VoiceState` below reports it)
  const [voice, setVoice] = useState<VoiceNow>(NO_VOICE)
  const listening = useRef(false)
  listening.current = voice.playing
  const shape = useMemo(() => current ? chapterShape(current.verses, voice.marks) : undefined, [current, voice.marks])
  const { mark, hear, toCredit } = useActivity(valid ? bookN : undefined, valid ? chapterN : undefined, { getProgress, atEnd: atLastPage, seen: pageVerses, listening: () => listening.current, shape })
  const hearRef = useRef(hear)
  hearRef.current = hear
  const onHeard = useCallback((b: number, c: number, v: number) => hearRef.current(b, c, v), [])
  /** The end line's "still to read" opens the page that verse is on. */
  const goToVerse = useCallback((v: number) => {
    const l = layoutRef.current
    if (!l) return
    const p = pageOfVerse(l, v)
    pg.value = p
    setPage(p)
  }, [pg, setPage])
  const credited = useCredited(bookN, chapterN)
  // a page turn that lands on the last page counts at once, not at the next beat or touch
  useEffect(() => { if (layout && page >= count - 1) mark() }, [layout, page, count, mark])

  // ---- HUD: visible on entry so the controls are discoverable, then out of the way ----
  const showHud = useCallback((on: boolean) => {
    if (hudTimer.current) clearTimeout(hudTimer.current)
    setHud(on)
    if (on) hudTimer.current = setTimeout(() => setHud(false), HUD_MS)
  }, [])
  useEffect(() => { showHud(true); return () => { if (hudTimer.current) clearTimeout(hudTimer.current) } }, [showHud])

  // ---- turning ----
  // Pages are drawn lowest index on top. Forward, the current page slides off to reveal the next; backward, the
  // previous page slides in over the current one. At a chapter edge the current page slides away and the neighbour
  // chapter enters once it is laid out. "Reduce animation" swaps instantly, no drag preview.
  const W = box.w || 1
  const hasNextPage = page + 1 < count, hasPrevPage = page > 0
  const canFwd = hasNextPage || !!next, canBack = hasPrevPage || !!prev

  const switchChapter = useCallback((dir: Dir) => {
    const target = dir > 0 ? next : prev
    if (!target) return
    landingRef.current = dir > 0 ? { page: 0 } : { last: true }
    enterDir.current = dir
    if (!reduce) enterX.value = dir * W
    router.setParams({ book: String(target.book), chapter: String(target.chapter), v: '' })
  }, [next, prev, router, reduce, enterX, W])
  const finishTurn = useCallback(() => {
    const t = turningRef.current
    if (!t) return
    turningRef.current = null
    if (t.to !== null) setPage(t.to)
    else switchChapter(t.dir)
  }, [setPage, switchChapter])
  const clearTurn = useCallback(() => { turningRef.current = null }, [])
  const beginTurn = useCallback((dir: Dir) => {
    if (turningRef.current || !layoutRef.current) return
    const from = pageRef.current, np = from + dir
    turningRef.current = { dir, from, to: np >= 0 && np < countRef.current ? np : null }
  }, [])
  const endTurn = useCallback((dir: Dir, commit: boolean) => {
    const t = turningRef.current
    if (!t) { tDir.value = 0; busy.value = 0; return }
    if (t.dir !== dir) return
    const edge = t.to === null
    if (edge && !(dir > 0 ? next : prev)) commit = false
    if (!commit) {
      if (reduce) { tDir.value = 0; busy.value = 0; clearTurn(); return }
      const rest = dir < 0 && !edge ? -W : 0
      ox.value = withSpring(rest, scaleSpringParams(SETTLE_SPRING, motionSpeed()), fin => { if (fin) { tDir.value = 0; busy.value = 0; runOnJS(clearTurn)() } })
      return
    }
    const to = t.to ?? -1
    if (reduce) { if (to >= 0) pg.value = to; tDir.value = 0; busy.value = 0; finishTurn(); return }
    const dest = dir < 0 && !edge ? 0 : -dir * W
    // a released drag travels the rest of the way in proportion (a tap or key: the whole width, TURN_MS)
    const ms = slideMs(Math.abs(dest - ox.value) / W, TURN_MS, TURN_MIN_MS)
    // the page swap happens here on the UI thread, in the same frame the slide ends; React catches up after
    ox.value = withTiming(dest, { duration: scaleMs(ms, motionSpeed()), easing: OUT }, fin => {
      if (!fin) return
      if (to >= 0) { pg.value = to; tDir.value = 0 }
      busy.value = 0
      runOnJS(finishTurn)()
    })
  }, [next, prev, W, reduce, ox, pg, tDir, busy, clearTurn, finishTurn])
  const turn = useCallback((dir: Dir, byUser = true) => {
    if (turningRef.current || !pages) return
    if (byUser) mark()
    const np = pageRef.current + dir
    const within = np >= 0 && np < countRef.current
    if (!within && !(dir > 0 ? next : prev)) return
    if (reduce) { if (within) { pg.value = np; setPage(np) } else switchChapter(dir); return }
    ox.value = dir < 0 && within ? -W : 0
    tDir.value = dir
    busy.value = 1
    beginTurn(dir)
    endTurn(dir, true)
  }, [pages, mark, next, prev, reduce, pg, setPage, switchChapter, ox, tDir, busy, W, beginTurn, endTurn])

  const turnRefJS = useCallback((d: Dir) => turn(d), [turn])
  const onTap = useCallback((x: number) => {
    mark()
    const third = x / W
    if (third < 1 / 3) turn(-1)
    else if (third > 2 / 3) turn(1)
    else showHud(!hud)
  }, [mark, W, turn, showHud, hud])

  const gesture = useMemo(() => {
    const pan = Gesture.Pan().activeOffsetX([-16, 16]).failOffsetY([-14, 14])
      .onUpdate(e => {
        let tx = e.translationX
        if (dragDir.value === 0) {
          if (Math.abs(tx) < 1 || busy.value) return
          const d: Dir = tx < 0 ? 1 : -1
          dragDir.value = d
          busy.value = 1
          const within = d > 0 ? hasNextPage : hasPrevPage
          ox.value = d < 0 && within ? -W : 0
          if (!reduce) tDir.value = d
          runOnJS(beginTurn)(d)
        }
        if (reduce) return
        const d = dragDir.value
        const edge = d > 0 ? !hasNextPage : !hasPrevPage
        if (!(d > 0 ? canFwd : canBack)) tx *= 0.2
        if (d > 0) ox.value = Math.min(0, tx)
        else if (!edge) ox.value = -W + Math.max(0, tx)
        else ox.value = Math.max(0, tx)
      })
      .onEnd(e => {
        const d = dragDir.value
        dragDir.value = 0
        if (d === 0) return
        const flick = Math.abs(e.velocityX) > 600, far = Math.abs(e.translationX) > W * 0.25
        const commit = (flick || far) && (e.translationX < 0 ? 1 : -1) === d
        runOnJS(endTurn)(d as Dir, commit)
      })
      .onFinalize((_e, success) => { if (!success && dragDir.value !== 0) { const d = dragDir.value; dragDir.value = 0; runOnJS(endTurn)(d as Dir, false) } })
    // a vertical swipe turns too: scrolling down (the finger moving up) is the next page, up the one before
    const vpan = Gesture.Pan().activeOffsetY([-24, 24]).failOffsetX([-20, 20])
      .onEnd(e => {
        const far = Math.abs(e.translationY) > 50, flick = Math.abs(e.velocityY) > 500
        if (far || flick) runOnJS(turnRefJS)(e.translationY < 0 ? 1 : -1)
      })
    const tap = Gesture.Tap().maxDuration(400).maxDistance(12).onEnd((e, success) => { if (success) runOnJS(onTap)(e.x) })
    return Gesture.Exclusive(pan, vpan, tap)
  }, [dragDir, busy, ox, tDir, W, hasNextPage, hasPrevPage, canFwd, canBack, reduce, beginTurn, endTurn, onTap, turnRefJS])

  // ---- keyboard (web) ----
  const turnRef = useRef(turn); turnRef.current = turn
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as { tagName?: string } | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Escape') { if (settings) setSettings(false); else showHud(!hud); return }
      if (settings) return
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); turnRef.current(1) }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); turnRef.current(-1) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [settings, hud, showHud])

  // ---- read-aloud: the spoken verse is tinted; a reader on the page being read is carried to the next one ----
  const follow = useRef<{ layout: Layout | null; page: number }>({ layout: null, page: -1 })
  useEffect(() => {
    if (!layout || spokenV <= 0) return
    // listening is reading: it keeps the time counting without a touch, and the voice reaching the last verse is the end
    mark()
    const sp = layout.startPage.get(spokenV)
    if (sp === undefined) return
    const was = follow.current.layout === layout ? follow.current.page : -1
    follow.current = { layout, page: sp }
    if (was === pageRef.current && sp === was + 1) turnRef.current(1, false)
  }, [spokenV, layout])  // eslint-disable-line react-hooks/exhaustive-deps

  const leave = () => {
    if (Platform.OS === 'web' && typeof document !== 'undefined' && document.fullscreenElement) document.exitFullscreen().catch(() => {})
    router.replace({ pathname: '/read/[book]/[chapter]', params: { book: String(bookN), chapter: String(chapterN), v: String(anchorVerse.current) } })
  }
  const toggleFullscreen = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }

  const layerPad = useMemo<ViewStyle>(() => ({ paddingTop: padTop, paddingBottom: padBottom, paddingHorizontal: PAD_X, backgroundColor: colors.bg }), [padTop, padBottom, colors.bg])

  if (!valid) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ErrorText>That reference does not exist.</ErrorText>
        <Button title="Back to reading" onPress={() => router.replace('/read')} style={{ marginTop: 12 }} />
      </View>
    )
  }
  const meta = bookMeta(bookN)
  const progress = pages ? (page + 1) / count : 0
  // the current page and both neighbours stay mounted, so a turn only moves layers that are already laid out
  const layerIdx = pages && current ? [page + 1, page, page - 1].filter(i => i >= 0 && i < count) : []

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]} onLayout={e => { const { width, height } = e.nativeEvent.layout; setBox(b => (b.w === width && b.h === height) ? b : { w: width, h: height }) }} onTouchStart={mark}>
      <Stack.Screen options={{ headerShown: false, title: `${meta.name} ${chapterN}` }} />
      <SpokenVerse book={bookN} chapter={chapterN} onVerse={setSpokenV} />
      <VoiceState book={bookN} chapter={chapterN} onState={setVoice} onHeard={onHeard} />
      <GestureDetector gesture={gesture}>
        <View style={styles.fill}>
          {layerIdx.map(i => (
            <Layer key={`${layoutId}:${i}`} idx={i} gen={layoutId} current={i === page} sv={sv} pad={layerPad} onOverflow={onOverflow} onDrawnLines={onDrawnLines} onDrawnTitle={onDrawnTitle}
              page={pages![i]} paras={paras} tm={tm} colors={colors} data={current!} spokenV={spokenV} width={pageW} height={pageH} />
          ))}
          {err ? <View style={[StyleSheet.absoluteFill, styles.center]}><ErrorText>{err}</ErrorText><Button title="Back to reading" onPress={leave} style={{ marginTop: 12 }} /></View> : null}
          {!err && !pages ? <View style={[StyleSheet.absoluteFill, styles.center, { pointerEvents: 'none' }]}><Spinner /></View> : null}
        </View>
      </GestureDetector>

      {/* offscreen: every paragraph once at page width, so the packer works from real line boxes */}
      {measurable && !cached ? (
        <Measurer key={layoutKey} layoutKey={layoutKey} paras={paras} tm={tm} colors={colors} data={current!} width={pageW} height={pageH} onDone={onMeasured} />
      ) : null}

      {/* the last page: whether the chapter counts as read, and the reader's own mark, in the margin under the text
          (22 px, which the line's capped text size keeps to) */}
      {layout && !err && page >= count - 1 ? (
        <View style={[styles.end, { pointerEvents: 'box-none' }, { bottom: Math.max(insets.bottom - 4, 0) + 3 }]}>
          <ChapterEndLine bare book={bookN} chapter={chapterN} credited={credited} toCredit={toCredit} goToVerse={goToVerse} />
        </View>
      ) : null}

      <View style={[styles.progress, { pointerEvents: 'none' }, { backgroundColor: colors.border, bottom: Math.max(insets.bottom - 4, 0) }]}>
        <View style={{ width: `${progress * 100}%`, height: 3, backgroundColor: colors.accent }} />
      </View>

      {/* HUD: slides down + fades in on a centre tap, slides back up when it times out */}
      <DockedBar open={hud} edge="top" fade style={[styles.hud, { paddingTop: insets.top + 6, backgroundColor: colors.bar, borderBottomColor: colors.border }]}>
        <Button iconName="back" title="Back to reading" onPress={leave} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>{meta.name} {chapterN} · {pages ? `page ${page + 1} of ${count}` : 'laying out…'}</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Tap the edges or swipe to turn</Text>
        </View>
        {Platform.OS === 'web' ? <Button iconName="expand" title="Toggle fullscreen" onPress={toggleFullscreen} /> : null}
        <Button iconName="sliders" title="Reading settings" onPress={() => { showHud(false); setSettings(true) }} />
      </DockedBar>

      <FlipSettings open={settings} prefs={prefs} set={set} onClose={() => setSettings(false)} />
    </View>
  )
}

/** Read-aloud publishes every spoken word; the page needs only the verse, so the subscription lives apart from the screen. */
interface VoiceNow { playing: boolean; marks: ChapterMarks | null }
const NO_VOICE: VoiceNow = { playing: false, marks: null }
/** Whether the voice is reading this chapter and the recording it reads from, and each verse it finishes; kept out of the
 *  page's own renders, as `SpokenVerse` is (the player's state changes on every word). */
function VoiceState({ book, chapter, onState, onHeard }: { book: number; chapter: number; onState: (s: VoiceNow) => void; onHeard: (b: number, c: number, v: number) => void }) {
  const { status, book: pb, chapter: pc, marksOf, onVerseHeard } = usePlayer()
  const here = status !== 'idle' && pb === book && pc === chapter
  const playing = here && status === 'playing'
  // kept once the voice stops: the verses it read are timed by the recording it read them from
  const marks = marksOf(book, chapter)
  useEffect(() => { onState(playing || marks ? { playing, marks } : NO_VOICE) }, [playing, marks, here, onState])
  useEffect(() => onVerseHeard(onHeard), [onVerseHeard, onHeard])
  return null
}

function SpokenVerse({ book, chapter, onVerse }: { book: number; chapter: number; onVerse: (v: number) => void }) {
  const { spoken } = usePlayer()
  const v = spoken && spoken.book === book && spoken.chapter === chapter ? spoken.v : 0
  useEffect(() => { onVerse(v) }, [v, onVerse])
  return null
}

// ---------------------------------------------------------------------------------------------

interface LayerProps {
  idx: number; gen: number; current: boolean; sv: TurnValues; pad: ViewStyle
  page: Page; paras: Para[]; tm: TextMetrics; colors: Colors; data: ChapterData; spokenV: number; width: number; height: number
  onOverflow?: (idx: number, over: number) => void
  onDrawnLines?: (p: number, lines: readonly { y: number; height: number; text: string }[]) => void
  onDrawnTitle?: (h: number) => void
}
/**
 * One mounted page. Whether it shows and where is decided on the UI thread from the turn values, so a turn commits
 * in the frame its slide ends; a layer of an older layout (gen) stays hidden until the new one takes over.
 */
const Layer = memo(function Layer({ idx, gen, current, sv, pad, onOverflow, onDrawnLines, onDrawnTitle, ...body }: LayerProps) {
  const style = useAnimatedStyle(() => {
    if (sv.gen.value !== gen) return { opacity: 0, transform: [{ translateX: 0 }] }
    const p = sv.pg.value, d = sv.tDir.value
    let on = false, x = 0
    if (d === 0) { on = idx === p; x = sv.enterX.value }
    else if (d > 0) { if (idx === p) { on = true; x = sv.ox.value } else on = idx === p + 1 }
    else if (p === 0) { if (idx === 0) { on = true; x = sv.ox.value } }
    else if (idx === p - 1) { on = true; x = sv.ox.value }
    else on = idx === p
    return { opacity: on ? 1 : 0, transform: [{ translateX: x }] }
  }, [idx, gen])
  return (
    <Animated.View style={[StyleSheet.absoluteFill, pad, styles.sheet, styles.layer, style]} accessibilityElementsHidden={!current} importantForAccessibility={current ? 'auto' : 'no-hide-descendants'} aria-hidden={!current}>
      <PageView {...body} onLines={Platform.OS === 'web' ? undefined : onDrawnLines} onTitle={onDrawnTitle} onContent={h => {
        // the space after a page's last paragraph is not part of what must fit
        const last = body.page.slices[body.page.slices.length - 1], tail = last?.kind === 'lines' ? last.gap : 0
        if (h - tail > body.height + 1) onOverflow?.(idx, h - tail - body.height)
      }} />
    </Animated.View>
  )
})

const PageView = memo(function PageView({ page, paras, tm, colors, data, spokenV, width, height, onContent, onLines, onTitle }: Omit<LayerProps, 'idx' | 'gen' | 'current' | 'sv' | 'pad' | 'onOverflow' | 'onDrawnLines' | 'onDrawnTitle'> & { onContent?: (h: number) => void; onLines?: LayerProps['onDrawnLines']; onTitle?: (h: number) => void }) {
  return (
    <View style={{ width, height, overflow: 'hidden' }}>
     <View onLayout={onContent ? e => onContent(e.nativeEvent.layout.height) : undefined}>
      {page.slices.map(s => {
        if (s.kind === 'title') return <View key="title" onLayout={onTitle ? e => onTitle(e.nativeEvent.layout.height) : undefined}><Title data={data} tm={tm} colors={colors} /></View>
        const para = paras[s.p]
        if (s.kind === 'head') return <View key={`h${s.p}`}><Heading text={para.hd ?? ''} tm={tm} colors={colors} /></View>
        const vs = para.verses
        const tint = spokenV >= vs[0].v && spokenV <= vs[vs.length - 1].v ? spokenV : 0
        return (
          <View key={`l${s.p}`} style={{ height: s.h, marginBottom: s.gap, overflow: 'hidden' }}>
            <View style={{ marginTop: -s.y }}>
              <ParaText para={para} tm={tm} colors={colors} tint={tint} onTextLayout={onLines ? e => onLines(s.p, e.nativeEvent.lines) : undefined} />
            </View>
          </View>
        )
      })}
     </View>
    </View>
  )
})

// ---------------------------------------------------------------------------------------------

/** Each verse's first character in its paragraph's string, as ParaText renders it, and the string's length. */
function verseOffsets(verses: Verse[], tm: TextMetrics): { starts: number[]; total: number } {
  const starts: number[] = []
  let n = 0
  for (const v of verses) {
    starts.push(n)
    if (v.s) n += 2
    if (tm.verseNumbers) n += String(v.v).length + 1
    n += v.t === '' ? OMITTED.length : tokenize(v).reduce((a, t) => a + t.tok.length, 0)
    n += 1
  }
  return { starts, total: n }
}

/** Web: line geometry from the verse spans' client rects (react-native-web has no onTextLayout). */
function domGeom(el: unknown, verses: number, height: number, lineHeight: number): Omit<Metrics, 'head'> | null {
  if (typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement) || el.children.length !== verses) return null
  const top = el.getBoundingClientRect().top
  const frag: number[] = [], first: number[] = []
  for (const span of Array.from(el.children)) {
    const rects = Array.from(span.getClientRects()).filter(r => r.width > 0)
    if (!rects.length) return null
    first.push(rects[0].top - top)
    for (const r of rects) frag.push(r.top - top)
  }
  return geomFromTops(frag, first, height, lineHeight)
}

interface MeasurerProps { layoutKey: string; paras: Para[]; tm: TextMetrics; colors: Colors; data: ChapterData; width: number; height: number; onDone: (key: string, l: Layout) => void }
/** Renders the chapter once, invisibly, at page width: title and heading heights plus every paragraph's line boxes. */
function Measurer({ layoutKey, paras, tm, colors, data, width, height, onDone }: MeasurerProps) {
  const st = useRef({ title: 0, heads: new Map<number, number>(), geom: new Map<number, Omit<Metrics, 'head'>>(), boxes: new Map<number, number>(), els: new Map<number, unknown>(), done: false, timer: null as ReturnType<typeof setTimeout> | null }).current
  const offsets = useMemo(() => paras.map(p => verseOffsets(p.verses, tm)), [paras, tm])
  const headCount = useMemo(() => paras.filter(p => p.hd).length, [paras])
  useEffect(() => () => { if (st.timer) clearTimeout(st.timer) }, [st])
  const finish = () => {
    if (st.done) return
    st.done = true
    const metrics = paras.map((p, i) => ({ head: p.hd ? st.heads.get(i) ?? 0 : 0, ...st.geom.get(i)! }))
    const gap = tm.paragraphs ? 14 : 6
    const l = paginate(st.title, paras, metrics, height, gap)
    packInputs.set(l, { titleH: st.title, paras, metrics, H: height, gap, fixed: false })
    onDone(layoutKey, l)
  }
  const check = () => {
    if (st.done || !st.title || st.heads.size < headCount) return
    if (st.geom.size === paras.length) { finish(); return }
    // native: a paragraph whose line boxes never arrive is split into equal lines once every box is in
    if (st.boxes.size === paras.length && !st.timer) {
      st.timer = setTimeout(() => {
        paras.forEach((_, i) => { if (!st.geom.has(i)) st.geom.set(i, geomUniform(st.boxes.get(i) ?? 0, tm.lineHeight, offsets[i].starts, offsets[i].total)) })
        finish()
      }, 1000)
    }
  }
  // a cold web load can report 0 before the first paint; the observer fires again with the real size
  const onTitle = (e: LayoutChangeEvent) => { const h = e.nativeEvent.layout.height; if (h > 0) { st.title = Math.ceil(h); check() } }
  const onHead = (i: number) => (e: LayoutChangeEvent) => { const h = e.nativeEvent.layout.height; if (h > 0) { st.heads.set(i, Math.ceil(h)); check() } }
  const onBox = (i: number) => (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height
    if (h <= 0) return
    st.boxes.set(i, h)
    if (Platform.OS === 'web') st.geom.set(i, domGeom(st.els.get(i), paras[i].verses.length, h, tm.lineHeight) ?? geomUniform(h, tm.lineHeight, offsets[i].starts, offsets[i].total))
    check()
  }
  const onLines = (i: number) => (e: TextLayoutEvent) => {
    const g = geomFromLines(e.nativeEvent.lines, offsets[i].starts, offsets[i].total)
    if (g) { st.geom.set(i, g); check() }
  }
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={{ position: 'absolute', left: 0, top: 0, width, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}>
     {/* own box with no height: inside the 1 px clip, Android squeezed the title's text to nothing (Romans 11) */}
     <View style={{ position: 'absolute', left: 0, top: 0, width }}>
      <View onLayout={onTitle}><Title data={data} tm={tm} colors={colors} /></View>
      {paras.map((p, i) => (
        <View key={i}>
          {p.hd ? <View onLayout={onHead(i)}><Heading text={p.hd} tm={tm} colors={colors} /></View> : null}
          <ParaText para={p} tm={tm} colors={colors} tint={0} textRef={el => { st.els.set(i, el) }} onLayout={onBox(i)} onTextLayout={Platform.OS === 'web' ? undefined : onLines(i)} />
        </View>
      ))}
     </View>
    </View>
  )
}

// ---------------------------------------------------------------------------------------------
// The same markup in the measurer and on the page, so measured lines are displayed lines.

function Title({ data, tm, colors }: { data: ChapterData; tm: TextMetrics; colors: Colors }) {
  return (
    <View style={styles.title}>
      <Text style={{ color: colors.muted, fontSize: 17, ...face(tm.font, { italic: true }) }}>{bookMeta(data.book).name}</Text>
      <Text style={{ color: colors.accent, fontSize: 44, ...face(tm.font === 'dyslexic' ? 'dyslexic' : 'serif', { bold: true }) }}>{data.c}</Text>
      {data.title ? <Text style={{ color: colors.muted, textAlign: 'center', fontSize: tm.fs * 0.9, marginTop: 10, ...face(tm.font, { italic: true }) }}>{data.title}</Text> : null}
    </View>
  )
}

function Heading({ text, tm, colors }: { text: string; tm: TextMetrics; colors: Colors }) {
  return <Text style={{ color: colors.muted, textAlign: 'center', fontSize: Math.round(tm.fs * 0.85), marginTop: 18, marginBottom: 8, ...face(tm.font, { italic: true }) }}>{text}</Text>
}

/** Verse text per (verse, face, word spacing): plain words share one string, italic words and wide separators get a span. */
const bodies = new WeakMap<Verse, Map<string, ReactNode[]>>()
function verseBody(v: Verse, font: Font, sep: number, plainSeps: boolean): ReactNode[] {
  const key = plainSeps ? font : `${font}|${sep}`
  let m = bodies.get(v)
  if (!m) { m = new Map(); bodies.set(v, m) }
  const hit = m.get(key)
  if (hit) return hit
  const italicFace = face(font, { italic: true }), sepStyle = { letterSpacing: sep }
  const out: ReactNode[] = []
  let run = '', cls: 'plain' | 'italic' | 'sep' | null = null, runKey = 0
  const flush = () => {
    if (run) out.push(cls === 'plain' ? run : <Text key={`${cls}${runKey}`} style={cls === 'italic' ? italicFace : sepStyle}>{run}</Text>)
    run = ''
  }
  // separators were never italic, so an italic run is one word and the spaces around it stay upright
  tokenize(v).forEach((t, i) => {
    const c = !t.word ? (plainSeps ? 'plain' : 'sep') : t.italic ? 'italic' : 'plain'
    if (c !== cls) { flush(); cls = c; runKey = i }
    run += t.tok
  })
  flush()
  m.set(key, out)
  return out
}

interface ParaTextProps {
  para: Para; tm: TextMetrics; colors: Colors
  /** The spoken verse when it is in this paragraph, else 0. A background changes no line box. */
  tint: number
  textRef?: (el: unknown) => void; onLayout?: (e: LayoutChangeEvent) => void; onTextLayout?: (e: TextLayoutEvent) => void
}
/** One paragraph = one Text; each verse is a span, and its string layout is what verseOffsets counts. */
const ParaText = memo(function ParaText({ para, tm, colors, tint, textRef, onLayout, onTextLayout }: ParaTextProps) {
  const plainSeps = tm.sep === tm.letterSpacing
  return (
    <Text ref={textRef as ((el: Text | null) => void) | undefined} onLayout={onLayout} onTextLayout={onTextLayout}
      style={{ color: colors.text, fontSize: tm.fs, lineHeight: tm.lineHeight, letterSpacing: tm.letterSpacing, textAlign: 'left', ...face(tm.font) }}>
      {para.verses.map(v => (
        <Text key={v.v} style={v.v === tint ? { backgroundColor: colors.selected } : undefined}>
          {v.s ? <Text style={{ color: colors.muted, fontSize: tm.fs * 0.7, ...inlineMark(tm.fs * 0.7) }}>✦ </Text> : null}
          {tm.verseNumbers ? <Text style={{ color: colors.accent, fontSize: tm.fs * 0.6, ...SANS_BOLD, ...inlineMark(tm.fs * 0.6) }}>{`${v.v}\u00a0`}</Text> : null}
          {v.t === '' ? <Text style={{ color: colors.muted, ...face(tm.font, { italic: true }) }}>{OMITTED}</Text> : verseBody(v, tm.font, tm.sep, plainSeps)}
          {' '}
        </Text>
      ))}
    </Text>
  )
})

/** The reading controls that matter mid-chapter; the full set lives on the Settings tab. */
function FlipSettings({ open, prefs, set, onClose }: { open: boolean; prefs: Prefs; set: (p: Partial<Prefs>) => void; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Reading settings">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        <Slider label="Text size" value={prefs.fontSize} min={FONT_MIN} max={FONT_MAX} step={1} onChange={v => set({ fontSize: v })} format={v => `${v} px`} />
        <Slider label="Line height" value={prefs.lineHeight} min={1.2} max={2.4} step={0.05} onChange={v => set({ lineHeight: v })} format={v => v.toFixed(2)} />
        <T small muted>Font</T>
        <Segmented<Font> value={prefs.font} onChange={font => set({ font })} options={[{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }, { value: 'dyslexic', label: 'Dyslexic' }]} />
        <T small muted>Theme</T>
        <ThemeGallery compact />
        <SwitchRow label="Reduce animation" hint="Turn pages instantly" value={prefs.reduceMotion} onChange={reduceMotion => set({ reduceMotion })} />
        <SwitchRow label="Paragraphs" hint="Off: one verse per line" value={prefs.paragraphs} onChange={paragraphs => set({ paragraphs })} />
        <SwitchRow label="Verse numbers" value={prefs.verseNumbers} onChange={verseNumbers => set({ verseNumbers })} />
        <Button title="Done" onPress={onClose} style={{ marginTop: 8 }} />
      </ScrollView>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 16 },
  // on every layer: only a moving sheet is ever off its resting place, so only its edge shows the shadow
  sheet: Platform.select<ViewStyle>({ web: { boxShadow: '0 0 28px rgba(0,0,0,0.28)' }, default: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 8 } }) ?? {},
  layer: { pointerEvents: 'none' },
  title: { alignItems: 'center', paddingTop: 6, paddingBottom: 18 },
  progress: { position: 'absolute', left: 0, right: 0, height: 3 },
  end: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  hud: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
})
