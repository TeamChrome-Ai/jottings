import { useEffect, useMemo, useRef, type Ref } from 'react'
import { Animated, Easing, Platform, View, type GestureResponderEvent } from 'react-native'
import { REACTION_KINDS, REACTION_WORDS, summariseReactions, type ReactionKind } from '@shared/friends'
import type { Person } from '../../lib/friends'
import { useColors, useFill, useSurface } from '../../hooks/useTheme'
import { usePrefsStore, useReduceMotion } from '../../store/prefs'
import { publishOverlay } from '../../store/overlay'
import { POP_SPRING } from '../../lib/motion'
import BadgeGlyph from '../BadgeGlyph'
import { FadeSwap } from '../motion/nav'
import { T, Tap, tick } from '../ui'

export function ReactionGlyph({ kind, size = 16, color }: { kind: ReactionKind; size?: number; color: string }) {
  return <BadgeGlyph name={`react_${kind}`} size={size} color={color} />
}

export interface StackItem { key: string; kind: ReactionKind; from: Pick<Person, 'handle' | 'display_name'> }
const DISC = 24
const SHOWN = 5

/**
 * Reactions left on one thing: small overlapping discs and one line ("3 hearts from Anna and 2 others"). A reaction
 * that has just arrived (`arriving`) drops in from above on the pop spring, one after another, and the line crossfades.
 * `anchorRef` marks where the next disc lands, for a reaction flying in from the sender's finger.
 */
export function ReactionStack({ items, arriving, anchorRef, delay = 0 }: { items: StackItem[]; arriving?: ReadonlySet<string>; anchorRef?: Ref<View>; delay?: number }) {
  const c = useColors()
  const fill = useFill()
  const surface = useSurface()
  const edge = surface === 'card' ? c.card : c.bg
  const line = summariseReactions(items)
  const shown = items.slice(0, SHOWN)
  let k = 0
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: DISC }} accessible accessibilityLabel={line || undefined}>
      <View ref={anchorRef} style={{ flexDirection: 'row', minWidth: items.length ? undefined : DISC }}>
        {shown.map((r, i) => {
          const fresh = arriving?.has(r.key) ?? false
          const disc = (
            <View style={{ width: DISC, height: DISC, borderRadius: DISC / 2, borderWidth: 2, borderColor: edge, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }}>
              <ReactionGlyph kind={r.kind} size={13} color={c.accent} />
            </View>
          )
          return (
            <View key={r.key} style={{ marginLeft: i ? -7 : 0, zIndex: SHOWN - i }}>
              {fresh ? <Arrive delay={delay + 70 * k++}>{disc}</Arrive> : disc}
            </View>
          )
        })}
      </View>
      {line ? <FadeSwap k={line} style={{ flex: 1 }}><T small muted>{line}</T></FadeSwap> : null}
    </View>
  )
}

/** A disc settling into the stack: down from 12 px above and up from 0.4 on the pop spring, fading in first. */
function Arrive({ delay, children }: { delay: number; children: React.ReactNode }) {
  const reduce = useReduceMotion()
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current
  useEffect(() => {
    if (reduce) { v.setValue(1); return }
    const a = Animated.sequence([Animated.delay(delay), Animated.spring(v, { toValue: 1, ...POP_SPRING, useNativeDriver: true })])
    a.start()
    return () => a.stop()
  }, [v, delay, reduce])
  const style = useMemo(() => ({
    opacity: v.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
  }), [v])
  return <Animated.View style={style}><>{children}</></Animated.View>
}

type Point = { x: number; y: number }
/** Where a press happened, in window coordinates (the overlay's). */
export const pressPoint = (e: GestureResponderEvent): Point => ({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })
/** The centre of `view` in window coordinates. */
export function centreOf(view: View | null): Promise<Point | null> {
  return new Promise(resolve => {
    if (!view) { resolve(null); return }
    view.measureInWindow((x, y, w, h) => resolve(Number.isFinite(x) && w ? { x: x + w / 2, y: y + h / 2 } : null))
  })
}

/**
 * Four ways to say "well done" to a friend, no words. Before sending: four small round buttons. Once one is sent it
 * stays and the others shrink away (180 ms), leaving "Sent" beside it; there is no second reaction. `onPick` gets the
 * press point, for the flight.
 */
export function ReactionPicker({ sent, onPick, busy, label }: { sent: ReactionKind | null; onPick: (kind: ReactionKind, at: Point) => void; busy?: boolean; label: string }) {
  const c = useColors()
  const fill = useFill()
  const reduce = useReduceMotion()
  const vals = useRef(Object.fromEntries(REACTION_KINDS.map(k => [k, new Animated.Value(sent && sent !== k ? 0 : 1)])) as Record<ReactionKind, Animated.Value>).current
  useEffect(() => {
    for (const k of REACTION_KINDS) {
      const to = sent && sent !== k ? 0 : 1
      if (reduce) vals[k].setValue(to)
      else Animated.timing(vals[k], { toValue: to, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start()
    }
  }, [sent, reduce, vals])
  // each slot is its button and the gap after it, so a slot shrinking away takes its gap with it
  const styles = useMemo(() => Object.fromEntries(REACTION_KINDS.map(k => [k, {
    opacity: vals[k], width: vals[k].interpolate({ inputRange: [0, 1], outputRange: [0, 36] }),
    transform: [{ scale: vals[k].interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
  }])) as Record<ReactionKind, object>, [vals])
  return (
    // wraps in a narrow badge cell (a half-width card on a small phone) rather than cutting the last choice off
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: 4 }} accessibilityLabel={sent ? `You sent a ${REACTION_WORDS[sent].one}` : undefined}>
      {REACTION_KINDS.map(k => (
        <Animated.View key={k} style={[{ overflow: 'hidden', alignItems: 'flex-start' }, styles[k]]}>
          <Tap disabled={!!sent || busy} onPress={e => onPick(k, pressPoint(e))} scaleTo={0.86} accessibilityRole="button"
            accessibilityLabel={`${REACTION_WORDS[k].label} for ${label}`} hitSlop={4}
            style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: sent === k ? c.accent : fill }}>
            <ReactionGlyph kind={k} size={16} color={sent === k ? c.accentText : c.accent} />
          </Tap>
        </Animated.View>
      ))}
      {sent ? <FadeSwap k="sent"><T small muted>Sent</T></FadeSwap> : null}
    </View>
  )
}

let flights = 0
/**
 * A reaction flying from the sender's finger to where it lands: a small accent disc on an arc (up to 120 px high),
 * swelling as it lifts and settling smaller as it arrives, gone as `onLand` hands over to the stack's own arrival.
 * Drawn in the top overlay (over a sheet when one is open). Under Reduce animation it lands at once.
 */
export function flyReaction(kind: ReactionKind, from: Point, to: Point | null, colors: { accent: string; accentText: string }, reduce: boolean, onLand: () => void) {
  if (reduce || !to) { onLand(); return }
  const key = `reaction-flight-${++flights}`
  const done = () => { publishOverlay(key, null); onLand() }
  publishOverlay(key, <Flight key={key} kind={kind} from={from} to={to} colors={colors} onDone={done} />)
}
const R = 18
function Flight({ kind, from, to, colors, onDone }: { kind: ReactionKind; from: Point; to: Point; colors: { accent: string; accentText: string }; onDone: () => void }) {
  const p = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (Platform.OS !== 'web') tick()
    const a = Animated.timing(p, { toValue: 1, duration: 320, easing: Easing.inOut(Easing.cubic), useNativeDriver: true })
    a.start(({ finished }) => { if (finished) onDone() })
    return () => a.stop()
    // one flight per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const style = useMemo(() => {
    const dx = to.x - from.x, dy = to.y - from.y
    const arc = Math.min(120, Math.max(40, Math.hypot(dx, dy) * 0.35))
    const ts = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]
    return {
      opacity: p.interpolate({ inputRange: [0, 0.08, 0.86, 1], outputRange: [0, 1, 1, 0] }),
      transform: [
        { translateX: p.interpolate({ inputRange: ts, outputRange: ts.map(t => from.x - R + dx * t) }) },
        { translateY: p.interpolate({ inputRange: ts, outputRange: ts.map(t => from.y - R + dy * t - arc * Math.sin(Math.PI * t)) }) },
        { scale: p.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.8, 1.15, 0.6] }) },
      ],
    }
  }, [p, from, to])
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 2 * R, height: 2 * R, borderRadius: R, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 1000 }, style]}>
      <ReactionGlyph kind={kind} size={20} color={colors.accentText} />
    </Animated.View>
  )
}

/** Reads Reduce animation at call time, for flights started from event handlers. */
export function useReduceNow(): () => boolean {
  const store = usePrefsStore()
  return () => store.get().reduceMotion
}
