import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, View } from 'react-native'
import { useReduceMotion } from '../store/prefs'
import type { StreakInfo } from '@shared/types'
import { fmtDuration } from '../lib/format'
import { dayLetter, dayName, weekOf } from '../lib/week'
import { useInks } from '../hooks/useTheme'
import Icon from './Icon'
import { PulseRing, useCelebrateOnce, useCountUp } from './motion/home'
import { localDay, streakToday } from '../lib/localDay'
import { FILL_MS, SNAP_SPRING } from '../lib/motionTiming'
import { Card, Grow, T } from './ui'

/**
 * Current streak, today's progress toward the daily goal, and the last seven days. `delay` is the card's own entrance
 * delay: the numbers, the bar and the week start moving as it appears, not while it is still invisible.
 */
export default function StreakCard({ streak, delay = 0 }: { streak: StreakInfo; delay?: number }) {
  const c = useInks()
  const reduce = useReduceMotion()
  const today = localDay()
  const judged = streakToday(streak, today)
  const secs = judged.todaySeconds
  const pct = streak.today_goal_seconds ? Math.min(1, secs / streak.today_goal_seconds) : 0
  const met = streak.today_goal_seconds > 0 && secs >= streak.today_goal_seconds
  const current = useCountUp(judged.current, undefined, undefined, delay)
  const longest = useCountUp(streak.longest, undefined, undefined, delay)
  const landed = reduce ? 0 : delay + FILL_MS
  // The bar fills first; the ring and the check land as it arrives.
  const celebrate = useCelebrateOnce(met, today)
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <PulseRing trigger={celebrate} delay={landed} size={58}>
          <T style={{ fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{current}</T>
        </PulseRing>
        <T muted style={{ flex: 1 }}>day streak · longest {longest}</T>
        {met ? (
          <Grow delay={landed} style={{ alignSelf: 'center' }}>
            <View accessibilityLabel="today's goal met" style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={16} color={c.accentText} />
            </View>
          </Grow>
        ) : null}
      </View>
      <Progress pct={pct} delay={delay} />
      <T small muted>{fmtDuration(secs)} of {fmtDuration(streak.today_goal_seconds)} today</T>
      <WeekStrip days={streak.days} delay={delay} />
    </Card>
  )
}
/**
 * Goal bar that fills from zero after `delay` on mount and eases to each new value. The fill is a full-width rounded bar
 * slid in from the left (translateX on the native driver, no layout per frame), so its rounded end never squashes.
 */
function Progress({ pct, height = 8, delay = 0 }: { pct: number; height?: number; delay?: number }) {
  const c = useInks()
  const reduce = useReduceMotion()
  const [w, setW] = useState(0)
  const v = useRef(new Animated.Value(reduce ? pct : 0)).current
  const first = useRef(true)
  useEffect(() => {
    const d = first.current ? delay : 0
    first.current = false
    if (reduce) { v.setValue(pct); return }
    const a = Animated.timing(v, { toValue: pct, duration: FILL_MS, delay: d, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    a.start()
    return () => a.stop()
    // the delay is for the first fill only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct, v, reduce])
  const x = useMemo(() => v.interpolate({ inputRange: [0, 1], outputRange: [-w, 0], extrapolate: 'clamp' }), [v, w])
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height, borderRadius: height / 2, backgroundColor: c.border, overflow: 'hidden' }}>
      {w ? <Animated.View style={{ width: w, height, backgroundColor: c.accent, borderRadius: height / 2, transform: [{ translateX: x }] }} /> : null}
    </View>
  )
}

/**
 * This week (the reader's own calendar days), the Lord's day first, today ringed and the days still to come faded.
 * `days` is the server list as sent: newest first and sparse (only days with activity). `today` shows another
 * reader's week (a friend's), judged on their day.
 */
export function WeekStrip({ days, delay = 0, today: day }: { days: Pick<StreakInfo['days'][number], 'date' | 'met'>[]; delay?: number; today?: string }) {
  const c = useInks()
  // a friend's week is theirs: judged on their own day
  const today = day ?? localDay()
  const week = useMemo(() => {
    const met = new Set(days.filter(d => d.met).map(d => d.date))
    return weekOf(today).map(date => ({ date, met: met.has(date), today: date === today, ahead: date > today }))
  }, [days, today])
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
      {week.map((d, i) => (
        <View key={d.date} accessible accessibilityLabel={`${dayName(d.date)}${d.today ? ', today' : ''}${d.met ? ', met' : ''}`}
          style={{ flex: 1, alignItems: 'center', gap: 4, opacity: d.ahead ? 0.45 : 1 }}>
          <Grow delay={delay + i * 30}><DayDot met={d.met} today={d.today} /></Grow>
          <T small muted={!d.today} style={[{ fontSize: 11 }, d.today && { color: c.accent, fontWeight: '700' }]}>{dayLetter(d.date)}</T>
        </View>
      ))}
    </View>
  )
}

const DOT = 22
const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const
/** A day mark. Turning met crossfades grey to accent (an opacity layer, so it stays on the native driver) with one bump, ~300 ms. */
function DayDot({ met, today }: { met: boolean; today: boolean }) {
  const c = useInks()
  const reduce = useReduceMotion()
  const fill = useRef(new Animated.Value(met ? 1 : 0)).current
  const bump = useRef(new Animated.Value(1)).current
  const was = useRef(met)
  useEffect(() => {
    if (was.current === met) return
    was.current = met
    if (reduce) { fill.setValue(met ? 1 : 0); return }
    const fade = Animated.timing(fill, { toValue: met ? 1 : 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    const a = met
      ? Animated.parallel([fade, Animated.sequence([
          Animated.timing(bump, { toValue: 1.18, duration: 100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.spring(bump, { toValue: 1, ...SNAP_SPRING, useNativeDriver: true }),
        ])])
      : fade
    a.start()
    return () => a.stop()
  }, [met, reduce, fill, bump])
  return (
    <Animated.View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: c.border, transform: [{ scale: bump }] }}>
      <Animated.View style={[FILL, { borderRadius: DOT / 2, backgroundColor: c.accent, opacity: fill }]} />
      {today ? <View style={{ pointerEvents: 'none', position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: DOT / 2 + 4, borderWidth: 2, borderColor: c.accent }} /> : null}
    </Animated.View>
  )
}
