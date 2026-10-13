import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native'
import { useInks } from '../../hooks/useTheme'
import { useReduceMotion } from '../../store/prefs'
import { COUNT_MS, PULSE, SNAP_SPRING, lateDelay } from '../../lib/motionTiming'

const int = (n: number) => String(Math.round(n))

/**
 * A number that eases to `target`: from 0 on mount (after `delay`), from wherever it is when the target changes.
 * Re-renders only when the formatted text changes, so counting to "3" costs three renders. Instant under Reduce animation.
 */
export function useCountUp(target: number, fmt: (n: number) => string = int, duration = COUNT_MS, delay = 0): string {
  const reduce = useReduceMotion()
  const v = useRef(new Animated.Value(reduce ? target : 0)).current
  const fmtRef = useRef(fmt)
  fmtRef.current = fmt
  const first = useRef(true)
  const [text, setText] = useState(() => fmt(reduce ? target : 0))
  useEffect(() => {
    const id = v.addListener(({ value }) => { const s = fmtRef.current(value); setText(p => (p === s ? p : s)) })
    return () => v.removeListener(id)
  }, [v])
  useEffect(() => {
    const d = first.current ? delay : 0
    first.current = false
    if (reduce) { v.stopAnimation(); v.setValue(target); return }
    const a = Animated.timing(v, { toValue: target, duration, delay: d, easing: Easing.out(Easing.cubic), useNativeDriver: false })
    a.start()
    return () => a.stop()
    // the delay is for the first count only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, target, duration, reduce])
  return reduce ? fmt(target) : text
}

/**
 * The delay a block should enter with when its data may arrive after the screen's own entrance has begun: `planned`
 * while it is on time, only what is left of it when late, 0 once that has passed. Fixed at the render `arrived` turns
 * true, so a re-render never restarts the entrance.
 */
export function useArrivalDelay(planned: number, arrived: boolean): number {
  const t0 = useRef(0)
  if (t0.current === 0) t0.current = Date.now()
  const d = useRef<number | null>(null)
  if (arrived && d.current === null) d.current = lateDelay(planned, Date.now() - t0.current)
  return d.current ?? planned
}

/** Module-level so a remounted card does not celebrate the same day twice in one session. */
let celebratedDay = ''
/** Returns a fresh key the first time `met` is true for `day`; null otherwise. Feeds PulseRing's trigger. */
export function useCelebrateOnce(met: boolean, day: string): string | null {
  const [fire, setFire] = useState<string | null>(null)
  useEffect(() => {
    if (met && celebratedDay !== day) { celebratedDay = day; setFire(day) }
  }, [met, day])
  return fire
}

/**
 * One accent ring that swells out and fades around `children` (300 ms), with a small bump of the children that springs
 * straight back, each time `trigger` changes to a new non-null value. Nothing moves under Reduce animation.
 */
export function PulseRing({ trigger, delay = 0, size, radius, children, style }: { trigger: string | null; delay?: number; size?: number; radius?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useInks()
  const reduceMotion = useReduceMotion()
  const ring = useRef(new Animated.Value(0)).current
  const bump = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (trigger == null || reduceMotion) return
    ring.setValue(0)
    const a = Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(ring, { toValue: 1, duration: PULSE.ringMs, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(bump, { toValue: PULSE.bump, duration: PULSE.bumpMs, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.spring(bump, { toValue: 1, ...SNAP_SPRING, useNativeDriver: true }),
        ]),
      ]),
    ])
    a.start()
    return () => a.stop()
  }, [trigger, delay, reduceMotion, ring, bump])
  const ringStyle = useMemo<Animated.WithAnimatedValue<ViewStyle>>(() => ({
    ...(size != null
      ? { position: 'absolute', width: size, height: size, borderRadius: size / 2, left: '50%', top: '50%', marginLeft: -size / 2, marginTop: -size / 2 }
      : { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius ?? 16 }),
    pointerEvents: 'none',
    borderWidth: 2, borderColor: c.accent,
    opacity: ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.9, 0] }),
    transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: size != null ? [0.7, 1.6] : [1, 1.06] }) }],
  }), [ring, size, radius, c.accent])
  return (
    <Animated.View style={[{ transform: [{ scale: bump }] }, style]}>
      <>
        {children}
        <Animated.View style={ringStyle} />
      </>
    </Animated.View>
  )
}
