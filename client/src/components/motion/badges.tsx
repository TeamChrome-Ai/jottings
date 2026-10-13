import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, View, type ViewStyle } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Badge } from '@shared/types'
import { useColors } from '../../hooks/useTheme'
import { useReduceMotion } from '../../store/prefs'
import { badgeLook, medallion, type BadgeLook, type BadgeMotion } from '../../lib/badgeLooks'
import BadgeGlyph from '../BadgeGlyph'
import { Card, T } from '../ui'
import { LIVELY_SPRING, SNAP_SPRING, STAGGER_CAP, STAGGER_STEP, type SpringConfig } from '../../lib/motionTiming'
import { PulseRing } from './home'
import { PopIn } from './nav'

/**
 * Codes of badges earned since this device last showed the badge grid for `scope` (a user id).
 * The first ever view seeds the record and reports nothing, so an existing collection never flashes.
 */
export function useFreshBadges(scope: number | null | undefined, badges: Badge[] | undefined): ReadonlySet<string> {
  const [fresh, setFresh] = useState<ReadonlySet<string>>(EMPTY)
  const sig = badges ? badges.filter(b => b.earned_at).map(b => b.code).join(',') : null
  useEffect(() => {
    if (scope == null || sig == null) return
    const key = `berean_badges_seen_${scope}`
    const earned = sig ? sig.split(',') : []
    let cancelled = false
    AsyncStorage.getItem(key).then(raw => {
      if (cancelled) return
      let seen: string[] | null = null
      try { seen = raw ? JSON.parse(raw) as string[] : null } catch { /* corrupt: reseed */ }
      if (seen) {
        const had = new Set(seen)
        const f = earned.filter(code => !had.has(code))
        if (f.length) setFresh(new Set(f))
      }
      AsyncStorage.setItem(key, JSON.stringify(earned)).catch(() => {})
    }).catch(() => {})
    return () => { cancelled = true }
  }, [scope, sig])
  return fresh
}
const EMPTY: ReadonlySet<string> = new Set()

/** A mark's own motion starts once its card's pop-in (CELL_MS) has mostly landed. */
const LAND_MS = 120
/** A fresh badge's ring goes out as its mark lands. */
const RING_AT = LAND_MS + 180

/**
 * Badge cards two to a row. Earned badges fade and scale in from 0.94 with the list stagger (every one past the cap with
 * the last step), then each milestone mark plays its own entrance once (see BadgeMotion, all settled by ~320 ms); a
 * `fresh` one also gets one ring pulse. Locked badges are static and muted, so the earned ones arrive. Nothing loops.
 */
export function BadgeGrid({ badges, fresh = EMPTY, footer, markRef }: { badges: Badge[]; fresh?: ReadonlySet<string>; footer?: (b: Badge) => ReactNode; /** each earned mark's view, for a reaction flying to it */ markRef?: (code: string, v: View | null) => void }) {
  let k = 0
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {badges.map(b => {
        const earned = !!b.earned_at
        const slot = earned ? Math.min(k++, STAGGER_CAP) : 0
        const delay = slot * STAGGER_STEP
        const body = (
          <>
            <Mark look={badgeLook(b.code)} earned={earned} delay={delay + LAND_MS} viewRef={earned && markRef ? v => markRef(b.code, v) : undefined} />
            <T bold>{b.name}</T>
            <T small muted>{b.description}</T>
            {footer?.(b)}
          </>
        )
        if (!earned) return <View key={b.code} style={CELL}><Card style={[CARD, { opacity: 0.45 }]}>{body}</Card></View>
        return (
          <PopIn key={b.code} index={slot} cap={STAGGER_CAP + 1} step={STAGGER_STEP} from={0.94} style={CELL}>
            <PulseRing trigger={fresh.has(b.code) ? b.code : null} delay={delay + RING_AT} style={{ flex: 1 }}>
              <Card style={CARD}>{body}</Card>
            </PulseRing>
          </PopIn>
        )
      })}
    </View>
  )
}
const CELL: ViewStyle = { width: '47%', flexGrow: 1 }
const CARD: ViewStyle = { flex: 1, gap: 2 }

const MED = 44
const GLYPH = 26
const ABS = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const

type Run = (v: Animated.Value) => Animated.CompositeAnimation
const spring = (cfg: SpringConfig): Run => v => Animated.spring(v, { toValue: 1, ...cfg, useNativeDriver: true })
const timing = (duration: number, easing: (t: number) => number): Run => v => Animated.timing(v, { toValue: 1, duration, easing, useNativeDriver: true })
const lerp = (v: Animated.Value, from: number | string, to: number | string) => v.interpolate({ inputRange: [0, 1], outputRange: [from, to] as number[] | string[] })
const appear = (v: Animated.Value) => v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' })

/**
 * One value 0 → 1 per mark, all on the native driver, each settled by ~320 ms. The lively spring swings past 1 once (about
 * 15%) for the flame's leap, the drop's bounce, the gem's swell and the crown settling; the rest land on the snap spring
 * or a 300 ms curve. The timer's hand turns half round: a full turn in that time reads as a blur.
 */
const MOTIONS: Record<Exclude<BadgeMotion, 'grow'>, { run: Run; style: (v: Animated.Value) => object }> = {
  kindle: { run: spring(LIVELY_SPRING), style: v => ({ transformOrigin: '50% 100%', transform: [{ scaleX: lerp(v, 0.7, 1) }, { scaleY: lerp(v, 0.2, 1) }] }) },
  drop: { run: spring(LIVELY_SPRING), style: v => ({ opacity: appear(v), transform: [{ translateY: lerp(v, -18, 0) }] }) },
  rise: { run: spring(SNAP_SPRING), style: v => ({ opacity: appear(v), transform: [{ translateY: lerp(v, 16, 0) }, { scale: lerp(v, 0.7, 1) }] }) },
  glint: { run: spring(LIVELY_SPRING), style: v => ({ transform: [{ rotate: lerp(v, '-90deg', '0deg') }, { scale: lerp(v, 0.3, 1) }] }) },
  tilt: { run: spring(LIVELY_SPRING), style: v => ({ opacity: appear(v), transformOrigin: '50% 100%', transform: [{ translateY: lerp(v, -14, 0) }, { rotate: lerp(v, '-22deg', '0deg') }] }) },
  flip: { run: timing(300, Easing.inOut(Easing.cubic)), style: v => ({ transform: [{ rotate: lerp(v, '180deg', '0deg') }] }) },
  sweep: { run: timing(300, Easing.out(Easing.cubic)), style: v => ({ transform: [{ rotate: lerp(v, '-180deg', '0deg') }] }) },
  turn: { run: spring(SNAP_SPRING), style: v => ({ transform: [{ perspective: 300 }, { rotateY: lerp(v, '-100deg', '0deg') }] }) },
}

/** A badge's glyph on its medallion. Only an earned mark moves, once, after `delay`; Reduce animation shows it at rest. */
function Mark({ look, earned, delay, viewRef }: { look: BadgeLook; earned: boolean; delay: number; viewRef?: (v: View | null) => void }) {
  const c = useColors()
  const reduce = useReduceMotion()
  const motion = earned && !reduce && look.motion !== 'grow' ? MOTIONS[look.motion] : null
  const v = useRef(new Animated.Value(motion ? 0 : 1)).current
  useEffect(() => {
    if (!motion) { v.setValue(1); return }
    v.setValue(0)
    const a = Animated.sequence([Animated.delay(delay), motion.run(v)])
    a.start()
    return () => a.stop()
  }, [motion, delay, v])
  const style = useMemo(() => motion?.style(v), [motion, v])
  const m = medallion(look.tint, c, earned)
  return (
    <View ref={viewRef} collapsable={false} style={{ width: MED, height: MED, marginBottom: 4, alignItems: 'center', justifyContent: 'center' }}>
      {m.outer ? <View style={{ position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: MED / 2 + 4, borderWidth: 3, borderColor: m.outer }} /> : null}
      {m.fill || m.ring ? <View style={[ABS, { borderRadius: MED / 2, backgroundColor: m.fill, borderWidth: m.ring ? 2 : 0, borderColor: m.ring }]} /> : null}
      {m.inner ? <View style={{ position: 'absolute', top: 5, left: 5, right: 5, bottom: 5, borderRadius: MED / 2 - 5, borderWidth: 1.5, borderColor: m.inner }} /> : null}
      <Animated.View style={style}><BadgeGlyph name={look.glyph} size={look.tint === 'bare' ? 30 : GLYPH} color={m.glyph} /></Animated.View>
    </View>
  )
}
