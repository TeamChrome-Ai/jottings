/**
 * Motion for the community slice: groups, feed, leaderboards, outlines, profiles, moderation.
 * Every piece reads prefs.reduceMotion and settles on its final state at once when it is set.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, LayoutAnimation, Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import { t } from '@shared/i18n'
import { useReduceMotion } from '../../store/prefs'
import RiseIn from './rise'
import { useColors } from '../../hooks/useTheme'
import { FILL_MS, ROW_MS, ROW_RISE, SNAP_SPRING, STAGGER_CAP, STAGGER_STEP, WASH, rowDelay, staggerDelay } from '../../lib/motionTiming'

export { staggerDelay }

export { useReduceMotion }

const OUT = Easing.out(Easing.cubic)

export type EnterMode = 'none' | 'rise' | 'expand'
/** Swap offset for a reordered row: start `from` px away from the new slot; bump `seq` to replay. `lift` keeps it above its neighbour. */
export interface Nudge { from: number; seq: number; lift?: boolean }

interface ItemProps {
  /** Read once at mount, so a row whose index shifts later never replays its entrance. */
  enter?: EnterMode
  delay?: number
  /** Set to collapse the row; `onGone` fires when it has closed (at once under Reduce animation). */
  leaving?: boolean
  onGone?: () => void
  /** The parent's `gap`, absorbed while the row is at zero height so the list closes without a final jump. */
  gap?: number
  nudge?: Nudge | null
  onHeight?: (h: number) => void
  style?: StyleProp<ViewStyle>
  children: ReactNode
}

/**
 * One list row with an entrance (`rise`: fade + short rise; `expand`: opens from zero height while sliding down),
 * a collapse on exit, and a translateY nudge for reorders. Height cannot run on the native driver and one view cannot
 * mix drivers, so the outer view is JS-driven (expand, exit, nudge) and the plain first-load rise runs on the native
 * driver on the inner view. Animated styles are attached only while something is moving.
 */
export function MotionItem({ enter = 'none', delay = 0, leaving = false, onGone, gap = 0, nudge, onHeight, style, children }: ItemProps) {
  const reduce = useReduceMotion()
  const mode = useRef<EnterMode>(reduce ? 'none' : enter).current
  const appear = useRef(new Animated.Value(mode === 'none' ? 1 : 0)).current
  const close = useRef(new Animated.Value(1)).current
  const shift = useRef(new Animated.Value(0)).current
  const measured = useRef(0)
  const [natural, setNatural] = useState<number | null>(null)
  // a rise is RiseIn's own affair from mount on; only an expand, an exit or a nudge moves this row's outer view
  const [phase, setPhase] = useState<'enter' | 'idle' | 'exit'>(mode === 'expand' ? 'enter' : 'idle')
  const [nudging, setNudging] = useState(false)
  const gone = useRef(onGone)
  gone.current = onGone

  useEffect(() => {
    if (mode !== 'expand' || natural == null || phase !== 'enter') return
    const a = Animated.timing(appear, { toValue: 1, duration: 260, delay, easing: OUT, useNativeDriver: false })
    a.start(({ finished }) => { if (finished) setPhase(p => p === 'enter' ? 'idle' : p) })
    return () => a.stop()
  }, [mode, natural, phase, appear, delay])

  useEffect(() => {
    if (!leaving) return
    if (reduce || measured.current === 0) { gone.current?.(); return }
    setNatural(measured.current)
    setPhase('exit')
    const a = Animated.timing(close, { toValue: 0, duration: 220, easing: Easing.inOut(Easing.quad), useNativeDriver: false })
    a.start(({ finished }) => { if (finished) gone.current?.() })
    return () => a.stop()
  }, [leaving, reduce, close])

  const seq = nudge?.seq
  useEffect(() => {
    if (!nudge || reduce || nudge.from === 0) return
    shift.setValue(nudge.from)
    setNudging(true)
    const a = Animated.timing(shift, { toValue: 0, duration: 240, easing: OUT, useNativeDriver: false })
    a.start(({ finished }) => { if (finished) setNudging(false) })
    return () => a.stop()
    // replay only when a new nudge is issued
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq])

  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height
    if (phase === 'exit') return
    measured.current = h
    onHeight?.(h)
    if (mode === 'expand' && natural == null) setNatural(h)
  }

  const expandStyle = useMemo<Animated.WithAnimatedValue<ViewStyle>>(() => ({
    overflow: 'hidden', opacity: appear,
    height: natural == null ? 0 : appear.interpolate({ inputRange: [0, 1], outputRange: [0, natural] }),
    marginBottom: appear.interpolate({ inputRange: [0, 1], outputRange: [-gap, 0] }),
    transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }],
  }), [appear, natural, gap])
  // the content fades in the first half of the close, so the height folds an already empty row
  const exitStyle = useMemo<Animated.WithAnimatedValue<ViewStyle>>(() => ({
    overflow: 'hidden', opacity: close.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] }),
    height: close.interpolate({ inputRange: [0, 1], outputRange: [0, natural ?? 0] }),
    marginBottom: close.interpolate({ inputRange: [0, 1], outputRange: [-gap, 0] }),
    transform: [{ scale: close.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
  }), [close, natural, gap])
  const nudgeStyle = useMemo(() => ({ transform: [{ translateY: shift }], zIndex: nudge?.lift ? 1 : 0 }), [shift, nudge?.lift])

  const motion = phase === 'enter' && mode === 'expand' ? expandStyle : phase === 'exit' && natural != null ? exitStyle : null
  return (
    <Animated.View style={[style, motion, nudging ? nudgeStyle : null, phase === 'exit' ? { pointerEvents: 'none' } : null]}>
      {mode === 'rise'
        ? <RiseIn delay={delay} duration={ROW_MS} rise={ROW_RISE} onLayout={onLayout} mark="row">{children}</RiseIn>
        : <View onLayout={onLayout}>{children}</View>}
    </Animated.View>
  )
}

/**
 * Tracks which ids a list has shown. `modeFor(id, i)` answers `rise` + a stagger delay for the head of the first load,
 * `expand` for an id that arrives later and was announced with `expect` (the user's own action) or, with `arrivalsToo`,
 * for any later arrival; `none` otherwise. Pass the ids on screen (null while loading); they are recorded after commit
 * so a double render never loses the first-load answer.
 */
export function useArrivals<K>(ids: K[] | null, cap = STAGGER_CAP, step = STAGGER_STEP) {
  const seen = useRef<Set<K> | null>(null)
  const expected = useRef(new Set<K>())
  /** Later arrivals of one render, in the order asked: several at once open in turn, like a first load. */
  const batch = useRef(new Map<K, number>())
  useEffect(() => {
    batch.current.clear()
    if (!ids) return
    const s = seen.current ?? new Set<K>()
    ids.forEach(id => { s.add(id); expected.current.delete(id) })
    seen.current = s
  })
  return {
    expect: (id: K) => { expected.current.add(id) },
    modeFor: (id: K, i: number, arrivalsToo = false): { enter: EnterMode; delay: number } => {
      // the house stagger; rows after the cap arrive with the last of it, rows far below the fold plainly
      if (seen.current === null) return i < cap * 3 ? { enter: 'rise', delay: rowDelay(i, 0, cap, step) } : { enter: 'none', delay: 0 }
      if (seen.current.has(id)) return { enter: 'none', delay: 0 }
      if (!expected.current.has(id) && !arrivalsToo) return { enter: 'none', delay: 0 }
      let d = batch.current.get(id)
      if (d === undefined) { d = Math.min(batch.current.size, cap - 1) * step; batch.current.set(id, d) }
      return { enter: 'expand', delay: d }
    },
  }
}

/** A thin progress bar (0..1) that fills from zero on mount after `delay` and glides to each new value. */
export function FillBar({ pct, delay = 0, height = 6, style }: { pct: number; delay?: number; height?: number; style?: StyleProp<ViewStyle> }) {
  const c = useColors()
  const reduce = useReduceMotion()
  const w = Math.max(0, Math.min(1, pct))
  const v = useRef(new Animated.Value(reduce ? w : 0)).current
  const first = useRef(true)
  useEffect(() => {
    const d = first.current ? delay : 0
    first.current = false
    if (reduce) { v.setValue(w); return }
    const a = Animated.timing(v, { toValue: w, duration: FILL_MS, delay: d, easing: OUT, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [w, v, delay, reduce])
  const scaleX = useMemo(() => v.interpolate({ inputRange: [0, 1], outputRange: [0.0001, 1] }), [v])
  return (
    <View style={[{ height, borderRadius: height / 2, backgroundColor: c.border, overflow: 'hidden' }, style]}>
      <Animated.View style={{ width: '100%', height, backgroundColor: c.accent, transformOrigin: 'left', transform: [{ scaleX }] }} />
    </View>
  )
}

/** One accent wash that rises and fades, once, `delay` ms after mount (~320 ms). Sits under the row's content. */
export function PulseOnce({ delay = 0, radius = 10, strength = 0.22 }: { delay?: number; radius?: number; strength?: number }) {
  const c = useColors()
  const reduce = useReduceMotion()
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (reduce) return
    const a = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: WASH.inMs, easing: OUT, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: WASH.outMs, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ])
    a.start()
    return () => a.stop()
  }, [v, delay, reduce])
  const opacity = useMemo(() => v.interpolate({ inputRange: [0, 1], outputRange: [0, strength] }), [v, strength])
  if (reduce) return null
  return <Animated.View style={[StyleSheet.absoluteFill, { pointerEvents: 'none', borderRadius: radius, backgroundColor: c.accent, opacity }]} />
}

/**
 * Background tint that crossfades when `color` changes (null = none). Place first inside a card so content stays on top.
 * Both layers stay mounted: unmounting a view that follows a running value detaches it and stops the animation.
 */
export function TintLayer({ color, radius = 16, strength = 0.1 }: { color: string | null; radius?: number; strength?: number }) {
  const reduce = useReduceMotion()
  const [layers, setLayers] = useState<{ from: string | null; to: string | null }>({ from: null, to: color })
  const v = useRef(new Animated.Value(1)).current
  const fadeOut = useRef(v.interpolate({ inputRange: [0, 1], outputRange: [strength, 0] })).current
  const fadeIn = useRef(v.interpolate({ inputRange: [0, 1], outputRange: [0, strength] })).current
  const prev = useRef(color)
  useEffect(() => {
    if (prev.current === color) return
    const from = prev.current
    prev.current = color
    if (reduce) { setLayers({ from: null, to: color }); v.setValue(1); return }
    setLayers({ from, to: color })
    v.setValue(0)
    const a = Animated.timing(v, { toValue: 1, duration: 240, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [color, reduce, v])
  const fill = [StyleSheet.absoluteFill, { borderRadius: radius, pointerEvents: 'none' as const }]
  return (
    <View style={fill}>
      <Animated.View style={[fill, { backgroundColor: layers.from ?? 'transparent', opacity: fadeOut }]} />
      <Animated.View style={[fill, { backgroundColor: layers.to ?? 'transparent', opacity: fadeIn }]} />
    </View>
  )
}

/** Short fade + scale on a tight spring whenever `k` changes (a rotated invite code, a new status label). Children carry the new value. */
export function Swap({ k, children, style }: { k: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion()
  const v = useRef(new Animated.Value(1)).current
  const prev = useRef(k)
  useEffect(() => {
    if (prev.current === k) return
    prev.current = k
    if (reduce) { v.setValue(1); return }
    v.setValue(0)
    const a = Animated.spring(v, { toValue: 1, ...SNAP_SPRING, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [k, reduce, v])
  const scale = useMemo(() => v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }), [v])
  const opacity = useMemo(() => v.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }), [v])
  return <Animated.View style={[{ opacity, transform: [{ scale }] }, style]}><>{children}</></Animated.View>
}

/**
 * Motion for a list whose order can change under the user (a refreshed leaderboard). Native: LayoutAnimation moves the
 * rows (configured during render so it applies to the commit that reorders them). Web: the list dips and crossfades back.
 * Returns the opacity to put on the list container.
 */
export function useReorderMotion(signature: string): Animated.Value {
  const reduce = useReduceMotion()
  const fade = useRef(new Animated.Value(1)).current
  const prev = useRef<string | null>(null)
  const changed = prev.current !== null && prev.current !== signature
  if (changed && !reduce && Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.create(260, 'easeInEaseOut', 'opacity'))
  useEffect(() => {
    const was = prev.current
    prev.current = signature
    if (was === null || was === signature || reduce || Platform.OS !== 'web') return
    fade.setValue(0.2)
    const a = Animated.timing(fade, { toValue: 1, duration: 280, easing: OUT, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [signature, reduce, fade])
  return fade
}

/** Three small dots breathing in turn, inline next to a busy control. Static under Reduce animation. */
export function BusyDots({ color }: { color?: string }) {
  const c = useColors()
  const reduce = useReduceMotion()
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current
  useEffect(() => {
    if (reduce) { dots.forEach(d => d.setValue(0.7)); return }
    const loop = Animated.loop(Animated.stagger(120, dots.map(d => Animated.sequence([
      Animated.timing(d, { toValue: 1, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(d, { toValue: 0.3, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]))))
    loop.start()
    return () => loop.stop()
  }, [dots, reduce])
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={t('working')} style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
      {dots.map((d, i) => <Animated.View key={i} style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: color ?? c.accent, opacity: d }} />)}
    </View>
  )
}
