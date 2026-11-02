import { memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Ref } from 'react'
import { Animated, Easing, PanResponder, Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { t } from '@shared/i18n'
import { formatRef } from '@shared/ref'
import type { ChapterData } from '../lib/bible'
import { useInks } from '../hooks/useTheme'
import { usePrefsStore } from '../store/prefs'
import { setHeldVerse, useHeldVerse } from '../store/verseIndex'
import { face } from '../theme'
import { Button, tick } from './ui'
import {
  COL_W, EDGE_CLEAR, EDGE_W, FINE_BOX_W, FINE_STEP, INDEX_IN_MS, INDEX_OUT_MS, LABEL_DIM,
  createVerseIndex, indexVerses, labelStops, nearestLabel, neighbours, stopY,
  type FaceView, type IndexPort, type IndexVerse, type VerseIndexController,
} from '../lib/verseIndex'

/** What the chapter screen calls on its scroll signals. Both are cheap and re-render nothing at rest. */
export interface VerseIndexHandle {
  /** The live page scrolled, whatever moved it (the screen's onScroll, after it has updated its refs). */
  scrolled(): void
  /** The reader began dragging the page (native onScrollBeginDrag; react-native-web never fires it, so on the web the
   *  index finds the reader's wheel, touches and scroll keys itself, through `port.owns`). */
  dragged(): void
}

/** What the index reads and does on the screen's behalf (lib/verseIndex.ts IndexPort), built once by the screen:
 *  every member reads refs at call time, so the port never changes identity. */
export interface VerseIndexPort extends IndexPort {
  /** Web: a DOM event's target is inside the live page's scroll element. */
  owns(target: EventTarget | null): boolean
}

interface Props {
  /** The live chapter; null while it loads. A new value lets go of anything held and hides the index at once. */
  chapter: ChapterData | null
  /** There is a next chapter: a tap turns to it, and assistive tech meets the band as the "Next chapter" button. */
  canTurn: boolean
  /** How far a docked bar (the selection bar, the player) covers the page's bottom, as the page's own bottom padding
   *  has it: the band and the column end above it. */
  dock: number
  port: VerseIndexPort
  ref?: Ref<VerseIndexHandle>
}

const OUT = Easing.out(Easing.cubic)
const ACTIVATE = [{ name: 'activate' as const }]
const SCROLL_KEYS = new Set([' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'])
const INPUT_KINDS = ['pointerdown', 'touchstart', 'touchmove', 'wheel'] as const
/** No browser pan or pull-to-refresh may start on the band (it would cancel the touch at the first vertical move); the
 *  cursor stays the Pressable's; a drag on it must not select the text beside it. */
const WEB_BAND = (Platform.OS === 'web' ? { touchAction: 'none', cursor: 'pointer', userSelect: 'none' } : null) as unknown as ViewStyle

/**
 * The right edge of the scroll reader: one band, in the slot of the old "Next chapter" zone, that turns the chapter on
 * a tap (or a sideways-left drag) and scrubs verses on a vertical drag, and, drawn apart from it and never touched,
 * the column of verse numbers that shows while the page moves. Core react-native only (PanResponder, Animated), as
 * Slider.tsx is, so the web build runs every line the phone runs. The policy lives in lib/verseIndex.ts; this file
 * adapts touches and Animated to its controller. Memoised: its props hold still while the chapter screen re-renders
 * for every spoken word of read-aloud, and none of those may re-render the band.
 */
export default memo(function VerseIndex({ chapter, canTurn, dock, port, ref }: Props) {
  const stops = useMemo(() => chapter ? indexVerses(chapter.verses, chapter.c, chapter.nc) : [], [chapter])
  const [h, setH] = useState(0)
  const labels = useMemo(() => labelStops(stops, h), [stops, h])
  // what the face paints lives outside React state, so this component never re-renders per step or per scroll
  const faceStore = useState(createFaceStore)[0]
  const opacity = useRef(new Animated.Value(0)).current
  const boxAt = useRef(new Animated.ValueXY()).current
  // the face mounts on the first show and stays (FontLoading's way)
  const [drawn, setDrawn] = useState(false)
  const prefs = usePrefsStore()
  const latest = useRef({ canTurn, port })
  latest.current = { canTurn, port }
  const [ctl] = useState<VerseIndexController>(() => {
    const self = createVerseIndex({
      now: Date.now,
      after: (ms, fn) => { const id = setTimeout(fn, ms); return () => clearTimeout(id) },
      tick,
      fade: on => {
        if (on) setDrawn(true)
        if (prefs.get().reduceMotion) { opacity.stopAnimation(); opacity.setValue(on ? 1 : 0); if (!on) self.faded(); return }
        Animated.timing(opacity, { toValue: on ? 1 : 0, duration: on ? INDEX_IN_MS : INDEX_OUT_MS, easing: OUT, useNativeDriver: true }).start(({ finished }) => { if (finished && !on) self.faded() })
      },
      vanish: () => { opacity.stopAnimation(); opacity.setValue(0) },
      view: faceStore.set,
      held: setHeldVerse,
      box: at => boxAt.setValue(at),
    }, {
      page: () => latest.current.port.page(),
      jump: y => latest.current.port.jump(y),
      grab: () => latest.current.port.grab(),
      release: v => latest.current.port.release(v),
      turn: () => { if (latest.current.canTurn) latest.current.port.turn() },
    })
    return self
  })

  // the band is a leaf to touches: on the grant locationX/Y are its own (Slider's lesson), so its page origin is taken
  // from that one event and every move works from pageX/Y, right when the finger wanders off the band
  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: e => {
      const { pageX, pageY, locationX, locationY } = e.nativeEvent
      ctl.down({ x: pageX, y: pageY }, { right: pageX - locationX + EDGE_W, top: pageY - locationY })
    },
    onPanResponderMove: e => ctl.move({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }),
    onPanResponderRelease: () => ctl.up(),
    onPanResponderTerminate: () => ctl.cancel(),
  }))

  useImperativeHandle(ref, () => ({ scrolled: () => ctl.scrolled(), dragged: () => ctl.input() }), [ctl])

  // the web's own input: capture-phase, passive, stamps a time and nothing else
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    const stamp = (e: Event) => { if (latest.current.port.owns(e.target)) ctl.input() }
    const key = (e: KeyboardEvent) => { if (SCROLL_KEYS.has(e.key)) ctl.input() }
    const opts = { capture: true, passive: true } as const
    for (const k of INPUT_KINDS) document.addEventListener(k, stamp, opts)
    document.addEventListener('keydown', key, opts)
    return () => {
      for (const k of INPUT_KINDS) document.removeEventListener(k, stamp, opts)
      document.removeEventListener('keydown', key, opts)
    }
  }, [ctl])

  useLayoutEffect(() => { ctl.chapter(stops) }, [ctl, stops])
  useEffect(() => () => ctl.dispose(), [ctl])

  const bottom = Math.max(EDGE_CLEAR, dock)
  const turn = () => { if (latest.current.canTurn) latest.current.port.turn() }
  const webKeys = Platform.OS === 'web' ? { onKeyDown: (e: { key: string; preventDefault(): void }) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); turn() } } } as object : null
  return (
    <>
      {drawn ? <Face store={faceStore} stops={stops} labels={labels} h={h} bottom={bottom} opacity={opacity} boxAt={boxAt} /> : null}
      <View {...pan.panHandlers} {...webKeys} collapsable={false} style={[styles.band, { bottom }, WEB_BAND]} onLayout={e => { const next = e.nativeEvent.layout.height; ctl.layout(next); setH(next) }}
        accessible={canTurn} focusable={canTurn} accessibilityRole={canTurn ? 'button' : undefined} accessibilityLabel={canTurn ? t('Next chapter') : undefined}
        accessibilityActions={canTurn ? ACTIVATE : undefined} onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'activate') turn() }}
        importantForAccessibility={canTurn ? 'yes' : 'no-hide-descendants'} testID="verse-index-band">
        {/* The band's only child, and the reason it shields the pager on Android. Gesture-handler picks the touch target
            of a view with no handler of its own by `view !is ViewGroup || view.getBackground() != null`
            (GestureHandlerOrchestrator.kt, shouldHandlerlessViewBecomeTouchTarget): a childless RN View is a ViewGroup
            with no background, so it would let a touch on the band through to the pager's pan and edge pull beneath. A
            Text is a TextView, not a ViewGroup, so this empty one is the target and the pager never sees the touch.
            Caveat: under RN's enablePreparedTextLayout flag (off in 0.86) Text renders as PreparedLayoutTextView, a
            ViewGroup, and only the second line holds: PanResponder's default onShouldBlockNativeResponder, through which
            the JS responder grant cancels the handlers that have not activated (RNGestureHandlerRootHelper
            .handleSetJSResponder). Never give the band another child: anything drawn goes in the Face. */}
        <Text style={StyleSheet.absoluteFill} accessible={false} />
      </View>
    </>
  )
})

/** The toolbar's chapter pill: "John 1 ▾", and "John 1:29 ▾" while the index is held. The only thing outside the index
 *  that re-renders per verse step; the screen does not. */
export function VersePill({ book, chapter, onPress, ref }: { book: number; chapter: number; onPress: () => void; ref?: Ref<View> }) {
  const v = useHeldVerse()
  return <Button ref={ref} title={`${formatRef(v === null ? { book, chapter } : { book, chapter, v1: v })} ▾`} onPress={onPress} />
}

// ---- the face: drawn only, never touched, hidden from assistive tech (a gesture affordance, like the pull cue) ----

function createFaceStore() {
  let value: FaceView = { cur: 0, fine: false }
  const ls = new Set<() => void>()
  return {
    get: () => value,
    set: (v: FaceView) => { value = v; ls.forEach(l => l()) },
    subscribe: (l: () => void) => { ls.add(l); return () => { ls.delete(l) } },
  }
}
type FaceStore = ReturnType<typeof createFaceStore>

/** Re-renders per verse step while held, and when the verse at the top changes while shown; its labels only when the
 *  accent label or the dim changes. One useInks() for the whole face: CSS variables on the web, one subscription on native. */
const Face = memo(function Face({ store, stops, labels, h, bottom, opacity, boxAt }: { store: FaceStore; stops: IndexVerse[]; labels: number[]; h: number; bottom: number; opacity: Animated.Value; boxAt: Animated.ValueXY }) {
  const c = useInks()
  const { cur, fine } = useSyncExternalStore(store.subscribe, store.get, store.get)
  const n = stops.length
  const faceStyle = useMemo(() => ({ bottom, opacity }), [bottom, opacity])
  const boxStyle = useMemo(() => ({ transform: boxAt.getTranslateTransform() }), [boxAt])
  return (
    <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={[styles.face, faceStyle]} testID="verse-index">
      <Labels stops={stops} labels={labels} accent={nearestLabel(labels, cur)} h={h} dim={fine} ink={c.muted} accentInk={c.accent} />
      <View style={[styles.dot, { backgroundColor: c.accent, top: stopY(cur, n, h) - 2.5 }]} />
      {fine ? (
        <Animated.View style={[styles.box, { backgroundColor: c.card }, boxStyle]}>
          {neighbours(cur, n).map((k, row) => <Text key={row} maxFontSizeMultiplier={1.2} style={[styles.row, k === cur && styles.rowCur, { color: k === cur ? c.accent : c.muted }]}>{k === null ? '' : stops[k].label}</Text>)}
        </Animated.View>
      ) : null}
    </Animated.View>
  )
})

const Labels = memo(function Labels({ stops, labels, accent, h, dim, ink, accentInk }: { stops: IndexVerse[]; labels: number[]; accent: number; h: number; dim: boolean; ink: string; accentInk: string }) {
  return (
    <View style={[styles.col, dim && styles.dim]}>
      {labels.map(k => <Text key={k} maxFontSizeMultiplier={1.2} style={[styles.label, { top: stopY(k, stops.length, h) - 7, color: k === accent ? accentInk : ink }]}>{stops[k].label}</Text>)}
    </View>
  )
})

const sans = face('sans', { bold: true })
const styles = StyleSheet.create({
  band: { position: 'absolute', right: 0, top: EDGE_CLEAR, width: EDGE_W },
  face: { position: 'absolute', left: 0, right: 0, top: EDGE_CLEAR },
  col: { position: 'absolute', right: 0, top: 0, bottom: 0, width: COL_W },
  dim: { opacity: LABEL_DIM },
  label: { position: 'absolute', left: 0, right: 0, height: 14, lineHeight: 14, textAlign: 'center', fontSize: 11, fontVariant: ['tabular-nums'], ...sans },
  dot: { position: 'absolute', right: COL_W / 2 - 2.5, width: 5, height: 5, borderRadius: 2.5 },
  box: { position: 'absolute', right: 0, top: 0, width: FINE_BOX_W, borderRadius: 12, paddingVertical: 4 },
  row: { height: FINE_STEP, lineHeight: FINE_STEP, textAlign: 'center', fontSize: 11, fontVariant: ['tabular-nums'], ...sans },
  rowCur: { fontSize: 13 },
})
