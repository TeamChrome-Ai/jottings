import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, LayoutAnimation, Platform, StyleSheet, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native'
import * as Haptics from 'expo-haptics'
import { useInks } from '../../hooks/useTheme'
import { usePrefsStore, useReduceMotion } from '../../store/prefs'
import { CELL_FROM, CELL_MS, FOCUS_MS, ROW_MS, ROW_RISE, SNAP_SPRING, STAGGER_CAP, STAGGER_STEP, SWAP_MS, rowDelay } from '../../lib/motionTiming'
import { Input, RADIUS } from '../ui'
import RiseIn from './rise'

export { STAGGER_CAP, STAGGER_STEP }
const OUT = Easing.out(Easing.cubic)

export { useReduceMotion }

/** Native-only: the next layout change (a row leaving, a section opening) eases instead of jumping. No-op on web. */
export function easeNextLayout(reduce: boolean) {
  if (reduce || Platform.OS === 'web') return
  LayoutAnimation.configureNext(LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity))
}

/**
 * Row entrance: fade + a short rise, `step` ms apart after `base` for the first `cap` rows; the rows after the cap
 * arrive with the last of them (8 rows land by ~410 ms). Rows well below any fold (from 3 × cap), every row of a list
 * that is not new (`cap` 0, see useFreshList) and every row under Reduce animation are plain views.
 */
export function Stagger({ index, children, style, cap = STAGGER_CAP, step = STAGGER_STEP, base = 0, rise = ROW_RISE, duration = ROW_MS }: { index: number; children: ReactNode; style?: StyleProp<ViewStyle>; cap?: number; step?: number; base?: number; rise?: number; duration?: number }) {
  const reduce = useReduceMotion()
  if (reduce || cap <= 0 || index >= cap * 3) return <View style={style}>{children}</View>
  return <RiseIn delay={rowDelay(index, base, cap, step)} duration={duration} rise={rise} style={style} mark="row">{children}</RiseIn>
}

/** Small cells (chapter numbers, book chips, badges): opacity + scale `from` → 1, for grids where a rise would look busy. */
export function PopIn({ index, children, style, cap, step = 18, base = 0, from = CELL_FROM }: { index: number; children: ReactNode; style?: StyleProp<ViewStyle>; cap: number; step?: number; base?: number; from?: number }) {
  const reduce = useReduceMotion()
  if (reduce || index >= cap) return <View style={style}>{children}</View>
  return <RiseIn delay={base + index * step} duration={CELL_MS} from={from} style={style} mark="cell">{children}</RiseIn>
}

/**
 * True for the render that shows a new list (its `key` changed, or the first render): rows that mount then stagger in
 * (`cap`), rows that mount later (a live search narrowing, an item added) arrive still. Pass it as Stagger's `cap`
 * via `fresh ? STAGGER_CAP : 0`; a key that includes the data's arrival (a page still loading) starts the entrance
 * when the rows do.
 */
export function useFreshList(key: string | number): boolean {
  const last = useRef<string | number | null>(null)
  const fresh = last.current !== key
  useEffect(() => { last.current = key })
  return fresh
}

/**
 * Replaces its content when `k` changes: the new content is up in the same frame (never behind the old one fading out)
 * and fades in over SWAP_MS, leading in from `dx` px to the side when given (a page turn). While `k` is unchanged,
 * children update live with no motion. Under Reduce animation the swap is a plain cut.
 */
export function FadeSwap({ k, children, style, dx = 0 }: { k: string | number; children: ReactNode; style?: StyleProp<ViewStyle>; dx?: number }) {
  const reduce = useReduceMotion()
  const v = useRef(new Animated.Value(1)).current
  const first = useRef(true)
  // a layout effect: the opacity drops before the browser or the native view paints the new content
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return }
    if (reduce) { v.setValue(1); return }
    v.setValue(0)
    const a = Animated.timing(v, { toValue: 1, duration: SWAP_MS, easing: OUT, useNativeDriver: true })
    a.start()
    return () => a.stop()
    // replays only when the key changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k])
  const x = useMemo(() => v.interpolate({ inputRange: [0, 1], outputRange: [dx, 0] }), [v, dx])
  return <Animated.View style={[style, { opacity: v, transform: [{ translateX: x }] }]}><>{children}</></Animated.View>
}

/**
 * `Input` whose accent ring fades in with focus and out with blur. The field's own instant border is held transparent
 * so only this ring shows, drawn at the field's radius and width.
 */
export function FocusInput({ wrapStyle, onFocus, onBlur, style, ...props }: TextInputProps & { wrapStyle?: StyleProp<ViewStyle> }) {
  const c = useInks()
  const prefs = usePrefsStore()
  const v = useRef(new Animated.Value(0)).current
  const to = (x: number) => { if (prefs.get().reduceMotion) v.setValue(x); else Animated.timing(v, { toValue: x, duration: FOCUS_MS, easing: x ? OUT : Easing.in(Easing.quad), useNativeDriver: true }).start() }
  return (
    <View style={wrapStyle}>
      <Input {...props} style={[{ borderColor: 'transparent' }, style]} onFocus={e => { to(1); onFocus?.(e) }} onBlur={e => { to(0); onBlur?.(e) }} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: RADIUS.control, borderWidth: 2, borderColor: c.accent, opacity: v }]} />
    </View>
  )
}

/** Returns a translateX value and a trigger: two 4 px cycles, ~225 ms. The trigger does nothing under Reduce animation. */
export function useShake(): [Animated.Value, () => void] {
  const reduce = useReduceMotion()
  const x = useRef(new Animated.Value(0)).current
  const shake = () => {
    if (reduce) return
    x.setValue(0)
    const leg = (to: number) => Animated.timing(x, { toValue: to, duration: 45, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
    Animated.sequence([leg(4), leg(-4), leg(4), leg(-4), leg(0)]).start()
  }
  return [x, shake]
}

/**
 * Fades in and gives a small shake each time `k` changes (pass a counter so a repeated message shakes again), with an
 * error haptic on native. The haptic stays under Reduce animation; it is not motion.
 */
export function ShakeIn({ k, children, style }: { k: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion()
  const o = useRef(new Animated.Value(reduce ? 1 : 0)).current
  const [x, shake] = useShake()
  useEffect(() => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
    if (reduce) { o.setValue(1); return }
    o.setValue(0)
    Animated.timing(o, { toValue: 1, duration: 160, easing: OUT, useNativeDriver: true }).start()
    shake()
  }, [k, reduce])
  return <Animated.View style={[style, { opacity: o, transform: [{ translateX: x }] }]}><>{children}</></Animated.View>
}

/**
 * A row on its way out: measures itself, then fades (gone by half way), slides 16 px and closes its height to zero before
 * calling `onDone`. `gap` is the parent's gap, absorbed as it closes so the list does not jump when the row leaves the
 * data. Mount it only for the row being removed; height runs on the JS driver (layout props cannot use the native one).
 */
export function Collapse({ children, onDone, style, gap = 0 }: { children: ReactNode; onDone: () => void; style?: StyleProp<ViewStyle>; gap?: number }) {
  const reduce = useReduceMotion()
  const [h, setH] = useState<number | null>(null)
  const v = useRef(new Animated.Value(1)).current
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => { if (reduce) done.current() }, [reduce])
  useEffect(() => {
    if (h === null || reduce) return
    const a = Animated.timing(v, { toValue: 0, duration: 240, easing: Easing.inOut(Easing.quad), useNativeDriver: false })
    a.start(({ finished }) => { if (finished) done.current() })
    return () => a.stop()
  }, [h, reduce, v])
  const moving = useMemo(() => ({
    opacity: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] }),
    transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
    marginBottom: v.interpolate({ inputRange: [0, 1], outputRange: [-gap, 0] }),
  }), [v, gap])
  const height = useMemo(() => h === null ? null : { height: v.interpolate({ inputRange: [0, 1], outputRange: [0, h] }) }, [v, h])
  return (
    <Animated.View onLayout={e => { if (h === null) setH(e.nativeEvent.layout.height) }} style={[style, { overflow: 'hidden' }, moving, height]}>
      <>{children}</>
    </Animated.View>
  )
}

/**
 * Press feedback for a surface whose tappable part is not the whole of it (a card holding its own buttons): spread
 * `handlers` on the Pressable and put `style` on the surface (an Animated.View); the press itself calls `tick()` like `Tap`.
 */
export function usePressScale(scaleTo = 0.98) {
  const prefs = usePrefsStore()
  const s = useRef(new Animated.Value(1)).current
  return useMemo(() => {
    const to = (x: number) => Animated.spring(s, { toValue: x, ...SNAP_SPRING, useNativeDriver: true }).start()
    return {
      style: { transform: [{ scale: s }] },
      handlers: { onPressIn: () => { if (!prefs.get().reduceMotion) to(scaleTo) }, onPressOut: () => to(1) },
    }
  }, [s, scaleTo, prefs])
}

/** `value` once it has stayed the same for `ms`: a hint about half-typed input waits for the typing to pause. */
export function useSettled<V>(value: V, ms: number): V {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

/** Compact version of `Spinner`'s breathing dots, sized to sit inside a button. Static at 0.7 under Reduce animation. */
export function BusyDots({ color }: { color: string }) {
  const reduce = useReduceMotion()
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.35))).current
  const scales = useMemo(() => dots.map(d => d.interpolate({ inputRange: [0.35, 1], outputRange: [0.8, 1.15] })), [dots])
  useEffect(() => {
    if (reduce) { dots.forEach(d => d.setValue(0.7)); return }
    const loop = Animated.loop(Animated.stagger(120, dots.map(d => Animated.sequence([
      Animated.timing(d, { toValue: 1, duration: 280, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(d, { toValue: 0.35, duration: 280, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]))))
    loop.start()
    return () => loop.stop()
  }, [dots, reduce])
  return (
    <View style={{ flexDirection: 'row', gap: 5 }}>
      {dots.map((d, i) => <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color, opacity: d, transform: [{ scale: scales[i] }] }} />)}
    </View>
  )
}
