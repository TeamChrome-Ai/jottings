import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Animated, Easing, Platform, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import { useReduceMotion } from '../../store/prefs'
import { scaleMs } from '../../lib/motionSpeed'

/** Ease-out cubic, sampled: the native path plays it as a piecewise-linear interpolation of one linear clock. */
const K = [0, 0.12, 0.25, 0.4, 0.6, 0.8, 1]
const OUT = K.map(k => 1 - (1 - k) ** 3)
const CSS_OUT = 'cubic-bezier(0.33, 1, 0.68, 1)'

interface Props {
  /** Wait before it starts (ms as written; Animation speed and the house tempo apply). */
  delay?: number
  duration: number
  /** Rise from this far below (px). */
  rise?: number
  /** Or grow from this scale. */
  from?: number
  style?: StyleProp<ViewStyle>
  onLayout?: (e: LayoutChangeEvent) => void
  /** Web: a `data-entrance` attribute naming what enters (a list `row`), for scripts/polish-check.mjs to sample. */
  mark?: string
  children: ReactNode
}

/**
 * The house mount entrance (a fade with a short rise, or a small grow), started once at mount and never replayed by a
 * later render. The whole of it, the wait included, runs off the JS thread from its first frame: on the phone one
 * native-driver clock covers wait and motion (no JS timer per row that a busy moment could bunch or skip, which left
 * rows below the first appearing at once), on the web one Web Animation per element on the compositor (a busy main
 * thread cannot drop its frames, and core Animated's per-frame restyles are gone). Reduce animation: a plain view.
 */
export default function RiseIn({ delay = 0, duration, rise = 0, from, style, onLayout, mark, children }: Props) {
  const reduce = useReduceMotion()
  // read once: a row that re-renders mid-entrance, or whose index moves, keeps the entrance it started with
  const plan = useRef({ delay, duration, rise, from, still: reduce }).current
  if (plan.still) return <View style={style} onLayout={onLayout}>{children}</View>
  return Platform.OS === 'web'
    ? <WebRise plan={plan} style={style} onLayout={onLayout} mark={mark}>{children}</WebRise>
    : <NativeRise plan={plan} style={style} onLayout={onLayout}>{children}</NativeRise>
}

type Plan = { delay: number; duration: number; rise: number; from?: number }
type Inner = { plan: Plan; style?: StyleProp<ViewStyle>; onLayout?: (e: LayoutChangeEvent) => void; mark?: string; children: ReactNode }

function NativeRise({ plan, style, onLayout, children }: Inner) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const a = Animated.timing(v, { toValue: 1, duration: plan.delay + plan.duration, easing: Easing.linear, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [v, plan])
  const motion = useMemo(() => {
    const d = plan.delay / (plan.delay + plan.duration)
    const input = d > 0 ? [0, ...K.map(k => d + (1 - d) * k)] : K
    const at = (rest: number) => v.interpolate({ inputRange: input, outputRange: d > 0 ? [0, ...OUT].map((o, i) => i === 0 ? rest : rest + (1 - rest) * o) : OUT.map(o => rest + (1 - rest) * o), extrapolate: 'clamp' })
    const transform = plan.from !== undefined ? [{ scale: at(plan.from) }] : plan.rise ? [{ translateY: v.interpolate({ inputRange: input, outputRange: (d > 0 ? [0, ...OUT] : OUT).map(o => plan.rise * (1 - o)), extrapolate: 'clamp' }) }] : undefined
    return { opacity: at(0), transform }
  }, [v, plan])
  return <Animated.View style={[motion, style]} onLayout={onLayout}><>{children}</></Animated.View>
}

function WebRise({ plan, style, onLayout, mark, children }: Inner) {
  const ref = useRef<View>(null)
  // before the first paint: the element is never seen at rest before its entrance holds it at the start
  useLayoutEffect(() => {
    const el = ref.current as unknown as HTMLElement | null
    if (!el?.animate) return
    const start = plan.from !== undefined ? `scale(${plan.from})` : plan.rise ? `translateY(${plan.rise}px)` : 'none'
    const a = el.animate([{ opacity: 0, transform: start }, { opacity: 1, transform: 'none' }], { duration: scaleMs(plan.duration), delay: scaleMs(plan.delay), easing: CSS_OUT, fill: 'backwards' })
    return () => a.cancel()
  }, [plan])
  // react-native-web writes dataSet as data-* attributes
  const data = mark ? { dataSet: { entrance: mark } } as object : null
  return <View ref={ref} style={style} onLayout={onLayout} {...data}>{children}</View>
}
