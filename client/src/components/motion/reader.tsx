import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, Platform, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { useColors } from '../../hooks/useTheme'
import { CUE_H, type PullDir } from '../../lib/edgePull'
import { DOCK_SPRING } from '../../lib/springs'
import { rowDelay } from '../../lib/motionTiming'
import { useReduceMotion } from '../../store/prefs'
import Icon from '../Icon'
import { TYPE, Tap } from '../ui'

// Motion for the reading screens. Everything here goes instant under reduceMotion.

const OUT = Easing.out(Easing.cubic)

// ---- chapter turns (SwipePager, both platforms; here because SwipePager.web cannot import SwipePager) ----
/** A full turn (button, key): the neighbouring page, already rendered, slides the whole width. */
export const TURN_MS = 300
/** A released drag travels the rest of the way in proportion, never quicker than this. */
export const TURN_MIN_MS = 140
/** Released past this share of the width, or flicked faster than FLICK_PX_S, a drag turns the page. */
export const TURN_FAR = 0.25, FLICK_PX_S = 700
/** Pulled past the first or last chapter, the page follows this fraction of the finger. */
export const EDGE_PULL = 0.2
/** Horizontal travel before a drag is a page turn, and vertical travel that hands it to the scroll instead. */
export const DRAG_SLOP = 24, SCROLL_SLOP = 12
/** Spring back when a drag is released short of a turn: critically damped (lib/springs). */
export { SETTLE_SPRING } from '../../lib/springs'
/** Duration for the `remaining` share of a page (0..1) left after a release. */
export function turnMs(remaining: number) {
  'worklet'
  return Math.round(Math.max(TURN_MIN_MS, Math.min(1, remaining) * TURN_MS))
}

// ---- vertical turns: the cue in the gap an edge pull opens (both pagers animate it, each with its own library) ----

/** The chevron of the cue: points the way the text is being pushed (up past the bottom, down past the top). */
export function CueChevron({ dir, color }: { dir: PullDir; color: string }) {
  return <View style={{ transform: [{ rotate: dir > 0 ? '-90deg' : '90deg' }] }}><Icon name="chevron" size={20} color={color} /></View>
}
/**
 * "Next: Genesis 14" under the last line, "Previous: Genesis 12" above the first, with the chevron on the side of the
 * text. `open` false (first or last chapter): the label says so and there is no chevron. `armed` is the pager's
 * accent chevron laid over the muted one, faded in once a release would turn.
 */
export function PullCueFace({ dir, label, open, armed }: { dir: PullDir; label: string; open: boolean; armed?: ReactNode }) {
  const c = useColors()
  const chevron = open ? <View key="c"><CueChevron dir={dir} color={c.muted} />{armed}</View> : null
  const text = <Text key="t" numberOfLines={1} style={{ color: c.muted, fontSize: TYPE.small }}>{label}</Text>
  return <View style={styles.cue}>{dir > 0 ? [chevron, text] : [text, chevron]}</View>
}

// ---- colour mixing (hex / rgb / rgba strings; undefined = transparent) ----

type RGBA = [number, number, number, number]
function parseColor(c: string | undefined): RGBA | null {
  if (!c) return null
  if (c[0] === '#') {
    let h = c.slice(1)
    if (h.length === 3 || h.length === 4) h = [...h].map(x => x + x).join('')
    const n = parseInt(h.slice(0, 6), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1]
  }
  const m = /rgba?\(([^)]+)\)/.exec(c)
  if (!m) return null
  const p = m[1].split(',').map(s => parseFloat(s))
  return [p[0], p[1], p[2], p[3] ?? 1]
}
/** Mix two colours; a missing end is the other colour at alpha 0, so tints fade rather than flash grey. */
export function mixColor(a: string | undefined, b: string | undefined, t: number): string | undefined {
  const pa = parseColor(a), pb = parseColor(b)
  if (!pa && !pb) return undefined
  const x: RGBA = pa ?? [pb![0], pb![1], pb![2], 0]
  const y: RGBA = pb ?? [x[0], x[1], x[2], 0]
  const m = (i: number) => x[i] + (y[i] - x[i]) * t
  return `rgba(${Math.round(m(0))},${Math.round(m(1))},${Math.round(m(2))},${+m(3).toFixed(3)})`
}
const withAlpha = (c: string | undefined, f: number) => { const p = parseColor(c); return p ? `rgba(${p[0]},${p[1]},${p[2]},${Math.min(1, p[3] * f)})` : c }

/**
 * A background colour that eases to each new `target`. For nested Text (a verse inside a paragraph), where
 * no Animated node can attach: the value is JS-driven and pushed into state, so only this one span re-renders.
 * `pulse` overshoots to a stronger tint and settles, which reads as "this one was just picked". `role` names what the
 * colour stands for (selection, a highlighter): the same role in a new colour is a theme change, which the theme's
 * veil already carries, so it snaps.
 */
export function useColorTransition(target: string | undefined, reduce: boolean, pulse: boolean, role?: string | null): string | undefined {
  const [shown, setShown] = useState(target)
  const [prev, setPrev] = useState({ target, role, snap: false })
  const shownRef = useRef(shown)
  shownRef.current = shown
  if (prev.target !== target || prev.role !== role) {
    const snap = reduce || (role !== undefined && role === prev.role)
    setPrev({ target, role, snap })
    if (snap) setShown(target)
  }
  const snap = reduce || prev.snap
  useEffect(() => {
    const from = shownRef.current
    if (snap || from === target) { if (from !== target) setShown(target); return }
    const v = new Animated.Value(0)
    const peak = pulse ? withAlpha(target, 1.9) : target
    const id = v.addListener(({ value: p }) => {
      if (!pulse) setShown(mixColor(from, target, p))
      else setShown(p < 0.4 ? mixColor(from, peak, OUT(p / 0.4)) : mixColor(peak, target, (p - 0.4) / 0.6))
    })
    const a = Animated.timing(v, { toValue: 1, duration: pulse ? 320 : 180, easing: pulse ? Easing.linear : OUT, useNativeDriver: false })
    a.start(({ finished }) => { if (finished) setShown(target) })
    return () => { a.stop(); v.removeListener(id) }
    // `pulse` is sampled with the target change that started the transition
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduce])
  return reduce ? target : shown
}

// ---- set presence: keeps removed keys mounted until their exit finishes, staggers a batch of arrivals ----

const STAGGER_STEP = 35
/** The last of a batch starts by this, so with a 220 ms reveal even a 60-note chapter settles by ~600 ms. */
const STAGGER_SPAN = 380

interface SetPresenceState<K> { visible: ReadonlySet<K>; resetKey: unknown; leaving: ReadonlySet<K>; delays: ReadonlyMap<K, number> }
/**
 * `leaving`: keys just dropped from `visible` (render them closing, call `exited` when done).
 * `delays`: entrance delay per key of the latest arrival batch, top-to-bottom in `visible` order; keys absent
 * from it (first render, after `resetKey` changes, under reduce) appear without animation.
 */
export function useSetPresence<K>(visible: ReadonlySet<K>, resetKey: unknown, reduce: boolean) {
  // derived in render from the previous render's sets (a ref, not state, so a toggle costs one render, not two)
  const st = useRef<SetPresenceState<K>>({ visible, resetKey, leaving: new Set(), delays: new Map() })
  const [, bump] = useState(0)
  const s = st.current
  if (s.visible !== visible || s.resetKey !== resetKey) {
    const leaving = new Set<K>(), delays = new Map<K, number>()
    if (s.resetKey === resetKey && !reduce) {
      for (const k of s.leaving) if (!visible.has(k)) leaving.add(k)
      for (const k of s.visible) if (!visible.has(k)) leaving.add(k)
      const entering = [...visible].filter(k => !s.visible.has(k))
      const step = entering.length > 1 ? Math.min(STAGGER_STEP, STAGGER_SPAN / (entering.length - 1)) : 0
      entering.forEach((k, i) => delays.set(k, Math.round(i * step)))
    }
    st.current = { visible, resetKey, leaving, delays }
  }
  const exited = useCallback((k: K) => {
    const cur = st.current
    if (!cur.leaving.has(k)) return
    const leaving = new Set(cur.leaving); leaving.delete(k)
    st.current = { ...cur, leaving }
    bump(n => n + 1)
  }, [])
  return { leaving: st.current.leaving, delays: st.current.delays, exited }
}

/**
 * Height + opacity reveal for a block that opens in place (a footnote). Mounted with `delay` it grows from 0
 * after that delay; mounted without one it is simply there. `closing` collapses it, then `onExited` fires.
 * Height is only pinned while animating, so later reflow (text size) is never clipped.
 */
// Android (Fabric): a child measured inside a zero-height clipped parent reported its layout, the slot took the
// height, and the card itself never became visible. There the slot opens at its full height at once and only the
// card fades and slides, on the native driver; web and iOS keep the height slide.
const HEIGHT_SLIDE = Platform.OS !== 'android'
export function Reveal({ delay, closing = false, onExited, reduce, style, children }: { delay?: number; closing?: boolean; onExited?: () => void; reduce: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const animateIn = delay !== undefined && !reduce
  const v = useRef(new Animated.Value(animateIn ? 0 : 1)).current
  const [h, setH] = useState(0)
  const [pinned, setPinned] = useState(animateIn && HEIGHT_SLIDE)
  const pending = useRef(animateIn)
  const run = useRef<Animated.CompositeAnimation | null>(null)
  const exitedRef = useRef(onExited)
  exitedRef.current = onExited
  const go = useCallback((to: 0 | 1, d = 0) => {
    run.current?.stop()
    if (HEIGHT_SLIDE) setPinned(true)
    run.current = Animated.timing(v, { toValue: to, duration: to ? 220 : 170, delay: d, easing: to ? OUT : Easing.in(Easing.quad), useNativeDriver: !HEIGHT_SLIDE })
    run.current.start(({ finished }) => {
      if (!finished) return
      if (to) { if (HEIGHT_SLIDE) setPinned(false) }
      else exitedRef.current?.()
    })
  }, [v])
  useEffect(() => { if (!HEIGHT_SLIDE && pending.current) { pending.current = false; go(1, delay ?? 0) } }, [go, delay])
  const onLayout = (e: LayoutChangeEvent) => {
    if (!HEIGHT_SLIDE) return
    const nh = e.nativeEvent.layout.height
    if (nh > 0) setH(nh)
    if (pending.current && nh > 0) { pending.current = false; go(1, delay ?? 0) }
  }
  const wasClosing = useRef(closing)
  useEffect(() => {
    if (closing === wasClosing.current) return
    wasClosing.current = closing
    if (closing) { if (reduce) { run.current?.stop(); exitedRef.current?.() } else go(0) }
    else if (reduce) { run.current?.stop(); v.setValue(1); setPinned(false) }
    else go(1)
  }, [closing, reduce, go, v])
  useEffect(() => () => run.current?.stop(), [])
  // one set of nodes per value (and height): the chapter re-renders its paragraphs mid-reveal (read-aloud, selection)
  const fade = useMemo(() => v.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0.2, 1] }), [v])
  const drop = useMemo(() => ({ transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }] }), [v])
  const anim = useMemo<Animated.WithAnimatedObject<ViewStyle> | null>(() => pinned
    ? { height: v.interpolate({ inputRange: [0, 1], outputRange: [0, h] }), opacity: fade, overflow: 'hidden' }
    : null, [pinned, v, h, fade])
  const inner = useMemo(() => pinned || !HEIGHT_SLIDE ? (HEIGHT_SLIDE ? drop : { opacity: fade, ...drop }) : null, [pinned, fade, drop])
  return (
    <Animated.View style={[style, anim]}>
      <Animated.View onLayout={onLayout} style={inner}>{children}</Animated.View>
    </Animated.View>
  )
}

// ---- presence for a docked bar: slides in from its edge, slides out before unmounting ----

/**
 * A bar docked to `edge` that springs in when `open` turns true and slides out (then unmounts) when it
 * turns false. Mounted already open it simply appears. `fade` adds an opacity ramp (for overlays like a HUD).
 * `lift` raises it off its edge by that many px (over another docked bar) and springs when it changes, so a bar
 * below leaving or arriving carries this one with it. `onHeight` reports its laid-out height.
 */
export function DockedBar({ open, edge, fade = false, lift = 0, onHeight, style, children }: { open: boolean; edge: 'top' | 'bottom'; fade?: boolean; lift?: number; onHeight?: (h: number) => void; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const reduce = useReduceMotion()
  const v = useRef(new Animated.Value(open ? 1 : 0)).current
  const up = useRef(new Animated.Value(lift)).current
  const [mounted, setMounted] = useState(open)
  const [h, setH] = useState(0)
  if (open && !mounted) setMounted(true)
  useEffect(() => {
    if (reduce) { v.setValue(open ? 1 : 0); if (!open) setMounted(false); return }
    // in on a critically damped spring: an overshoot would lift the bar off its edge and show the page under it
    const a = open
      ? Animated.spring(v, { toValue: 1, ...DOCK_SPRING, useNativeDriver: true })
      : Animated.timing(v, { toValue: 0, duration: 190, easing: Easing.in(Easing.cubic), useNativeDriver: true })
    a.start(({ finished }) => { if (finished && !open) setMounted(false) })
    return () => a.stop()
  }, [open, reduce, v])
  useEffect(() => {
    // a closed bar takes its new place at once; an open one rides with the bar under it
    if (reduce || !open) { up.setValue(lift); return }
    const a = Animated.spring(up, { toValue: lift, ...DOCK_SPRING, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [lift, open, reduce, up])
  const dist = (h || 160) * (edge === 'bottom' ? 1 : -1)
  // stable nodes: the reading screen re-renders on every spoken word, and a new interpolation rebuilds the native node
  const anim = useMemo(() => ({
    transform: [{ translateY: Animated.add(v.interpolate({ inputRange: [0, 1], outputRange: [dist, 0], extrapolate: 'clamp' }), Animated.multiply(up, edge === 'bottom' ? -1 : 1)) }],
    opacity: fade ? v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.85, 1], extrapolate: 'clamp' }) : 1,
  }), [v, up, dist, edge, fade])
  if (!mounted && !open) return null
  return (
    <Animated.View onLayout={e => { const nh = e.nativeEvent.layout.height; setH(nh); onHeight?.(nh) }}
      style={[style, { pointerEvents: open ? 'auto' : 'none' }, anim]}>
      {children}
    </Animated.View>
  )
}

// ---- a toolbar toggle whose on-state tint crossfades ----

/**
 * Icon-box text button (same box as `Button icon`) for an on/off state: the accent fill and its label
 * crossfade over the plain card face, opacity only, so it runs on the native driver.
 */
export function ToggleButton({ on, title, onPress, onLongPress, accessibilityLabel, accessibilityHint, textStyle }: { on: boolean; title: string; onPress: () => void; onLongPress?: () => void; accessibilityLabel: string; accessibilityHint?: string; textStyle?: StyleProp<TextStyle> }) {
  const c = useColors()
  const reduceMotion = useReduceMotion()
  const v = useRef(new Animated.Value(on ? 1 : 0)).current
  useEffect(() => {
    if (reduceMotion) { v.setValue(on ? 1 : 0); return }
    const a = Animated.timing(v, { toValue: on ? 1 : 0, duration: 200, easing: OUT, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [on, reduceMotion, v])
  const label = (color: string) => <Text style={[{ color, fontSize: 16, fontWeight: '600' }, textStyle]}>{title}</Text>
  // stable: the toolbar re-renders on every spoken word
  const grow = useMemo(() => ({ transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }), [v])
  return (
    <Tap accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} accessibilityState={{ selected: on }} scaleTo={0.94} onPress={onPress} onLongPress={onLongPress}
      style={[styles.box, { backgroundColor: c.card, borderColor: c.border }]}>
      {label(c.text)}
      <Animated.View style={[StyleSheet.absoluteFill, styles.fill, { backgroundColor: c.accent, opacity: v, pointerEvents: 'none' }]}>
        <Animated.View style={grow}>{label(c.accentText)}</Animated.View>
      </Animated.View>
    </Tap>
  )
}

/** Stagger for sheet rows: small steps, capped so a long list does not trickle in. */
export { rowDelay }

// ---- one entrance for a chapter heading ----

/** 0 → 1 once on mount (the chapter heading's single orchestrated entrance); already 1 under reduce. */
export function useEntrance(duration = 360) {
  const reduceMotion = useReduceMotion()
  const v = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current
  useEffect(() => {
    if (reduceMotion) { v.setValue(1); return }
    const a = Animated.timing(v, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true })
    a.start()
    return () => a.stop()
    // mount-only on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return v
}
/** A slice of an entrance value, eased: 0 before `from`, 1 after `to`. */
export const phase = (v: Animated.Value, from: number, to: number, out: [number, number] = [0, 1]) => {
  const steps = 6, input: number[] = [], output: number[] = []
  for (let i = 0; i <= steps; i++) { const t = i / steps; input.push(from + (to - from) * t); output.push(out[0] + (out[1] - out[0]) * OUT(t)) }
  return v.interpolate({ inputRange: input, outputRange: output, extrapolate: 'clamp' })
}

const styles = StyleSheet.create({
  cue: { height: CUE_H, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 20 },
  box: { width: 40, height: 40, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fill: { alignItems: 'center', justifyContent: 'center' },
})
