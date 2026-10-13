import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Pressable, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import { BOOKS } from '@shared/books'
import { useInks } from '../hooks/useTheme'
import { useReduceMotion } from '../store/prefs'
import { FILL_MS } from '../lib/motionTiming'
import { plural } from '../lib/community'
import { chapterX, layoutStrip, spreadDots, stripLabels, type StripLayout } from '../lib/pathStrip'
import { Grow, TYPE, useSurface } from './ui'

/**
 * The Bible as the map (docs/PATHS.md rule 4): the 66 books in one strip, each as wide as its chapters, the route's
 * books tinted, what is read filled in the accent, the reader's place a dot, a group's members their own dots. The one
 * visual of the feature, drawn with Views in the theme's inks. Two sizes: `compact` (Home's card, 8 px) and full (the
 * Paths screen and a group's page, 18 px, the route's books named beneath where the names fit). Each book's fill is
 * one Animated.Value scaled from the left on the native driver: on mount the fills sweep in left to right after
 * `delay`, on a change each eases to its new share; nothing runs per frame in JS. Under Reduce animation it is still.
 */

export interface StripMember { key: string | number; book: number; chapter: number; /** one letter over the dot */ initial: string; name: string; me?: boolean }
interface Props {
  /** The route's books in path order; null shows the whole Bible (every book plain, what is read filled). */
  route: readonly number[] | null
  /** The path's chapters: a book's fill then counts its chapters on the route only. */
  routeChapters?: readonly (readonly [number, number])[] | null
  readSet?: ReadonlySet<string> | null
  /** Or the first `doneUpTo` portions count as read (a group's view, where a member's place is a count). */
  doneUpTo?: number | null
  /** The reader's place: a dot on the chapter. */
  place?: { book: number; chapter: number } | null
  members?: StripMember[]
  compact?: boolean
  /** Names under the route's books (full size only). */
  labels?: boolean
  /** Full size: a tap on a route book. */
  onBook?: (book: number) => void
  /** The entrance delay (ms as written), matched to the block the strip sits in. */
  delay?: number
  accessibilityLabel?: string
  style?: StyleProp<ViewStyle>
}

const EMPTY: StripMember[] = []
const SWEEP_MS = 240

export default function PathStrip({ route, routeChapters, readSet, doneUpTo, place, members = EMPTY, compact = false, labels = !compact, onBook, delay = 0, accessibilityLabel, style }: Props) {
  const c = useInks()
  const surface = useSurface()
  const reduce = useReduceMotion()
  const [w, setW] = useState(0)
  const onLayout = (e: LayoutChangeEvent) => { const x = Math.round(e.nativeEvent.layout.width); if (x !== w) setW(x) }
  const H = compact ? 8 : 18
  const offH = compact ? H : 6
  const radius = compact ? 2 : 4
  const layout = useMemo<StripLayout | null>(() => w > 0 ? layoutStrip({ width: w, route, routeChapters, readSet, doneUpTo, gap: compact ? 1 : 1.5, testamentGap: compact ? 4 : 8, minWidth: compact ? 1.5 : 3 }) : null, [w, route, routeChapters, readSet, doneUpTo, compact])

  // one value per book, kept for the strip's life; the first fill sweeps left to right, later ones ease in place
  const values = useRef(new Map<number, Animated.Value>()).current
  const valueOf = (book: number) => { let v = values.get(book); if (!v) { v = new Animated.Value(0); values.set(book, v) } return v }
  const first = useRef(true)
  useEffect(() => {
    if (!layout) return
    const sweep = first.current
    first.current = false
    const anims: Animated.CompositeAnimation[] = []
    for (const seg of layout.segments) {
      const v = valueOf(seg.book)
      if (reduce) { v.setValue(seg.fill); continue }
      anims.push(Animated.timing(v, { toValue: seg.fill, duration: FILL_MS, delay: sweep ? delay + (seg.x / layout.width) * SWEEP_MS : 0, easing: Easing.out(Easing.cubic), useNativeDriver: true }))
    }
    if (!anims.length) return
    const a = Animated.parallel(anims)
    a.start()
    return () => a.stop()
    // the sweep's delay is for the first fill only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, reduce])

  const named = useMemo(() => layout && labels && !compact ? stripLabels(layout) : [], [layout, labels, compact])
  const dots = useMemo(() => {
    if (!layout) return []
    const xs = members.map(m => chapterX(layout, m.book, m.chapter) ?? 0)
    const spread = spreadDots(xs, compact ? 5 : 7, compact ? 4 : 6)
    return members.map((m, i) => ({ m, x: spread[i], raw: xs[i] }))
  }, [layout, members, compact])
  const initials = useMemo(() => {
    if (!layout || compact || !dots.length) return []
    const xs = spreadDots(dots.map(d => d.raw), 11, 11)
    return dots.map((d, i) => ({ key: d.m.key, initial: d.m.initial, x: xs[i], me: d.m.me }))
  }, [layout, dots, compact])
  const placeX = layout && place ? chapterX(layout, place.book, place.chapter) : null
  const ring = surface === 'card' ? c.card : c.bg
  const DOT = compact ? 10 : 14
  const MDOT = compact ? 7 : 10
  const landed = reduce ? 0 : delay + SWEEP_MS + FILL_MS * 0.6

  return (
    <View style={[{ gap: 4 }, style]} accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel} accessibilityRole={accessibilityLabel ? 'image' : undefined}>
      {initials.length ? (
        <View style={{ height: 13 }} pointerEvents="none">
          {initials.map(i => (
            <View key={i.key} style={{ position: 'absolute', left: i.x - 10, width: 20, alignItems: 'center' }}>
              <Text numberOfLines={1} style={{ fontSize: 10, lineHeight: 13, fontWeight: i.me ? '700' : '500', color: i.me ? c.accent : c.muted }}>{i.initial}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View onLayout={onLayout} style={{ height: H, justifyContent: 'center' }}>
        {layout ? layout.segments.map(seg => (
          <Seg key={seg.book} testID="path-strip-segment" x={seg.x} width={seg.width} height={seg.onRoute ? H : offH} top={seg.onRoute ? 0 : (H - offH) / 2} radius={seg.onRoute ? radius : Math.min(radius, offH / 2)}
            track={seg.onRoute ? c.accentSoft : c.border} fill={c.accent} v={valueOf(seg.book)}
            onPress={onBook && seg.onRoute && !compact ? () => onBook(seg.book) : undefined}
            label={`${BOOKS[seg.book - 1].name}, ${seg.read} of ${plural(seg.chapters, 'chapter')} read`} />
        )) : null}
        {dots.map(({ m, x }) => (
          <Grow key={m.key} delay={landed} style={{ position: 'absolute', left: x - MDOT / 2 - 1, top: (H - MDOT) / 2 - 1 }}>
            <View accessibilityLabel={m.name} style={{ width: MDOT + 2, height: MDOT + 2, borderRadius: (MDOT + 2) / 2, backgroundColor: ring, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: MDOT, height: MDOT, borderRadius: MDOT / 2, backgroundColor: m.me ? c.accent : c.muted }} />
            </View>
          </Grow>
        ))}
        {placeX != null ? (
          <Grow delay={landed} style={{ position: 'absolute', left: placeX - DOT / 2 - 2, top: (H - DOT) / 2 - 2 }}>
            <View testID="path-strip-place" style={{ width: DOT + 4, height: DOT + 4, borderRadius: (DOT + 4) / 2, backgroundColor: ring, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: c.accent }} />
            </View>
          </Grow>
        ) : null}
      </View>
      {labels && !compact ? (
        <View style={{ height: 14 }} pointerEvents="none">
          {named.map(l => (
            <View key={l.book} style={{ position: 'absolute', left: l.x - 24, width: 48, alignItems: 'center' }}>
              <Text numberOfLines={1} style={{ fontSize: 10, lineHeight: 14, color: c.muted }}>{l.text}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

/**
 * One book: its track, and the fill scaled from the left edge (translate to the left edge, scale, translate back, so
 * the scale runs on the native driver without a layout pass). Memoised: a re-render of the strip touches no segment
 * whose geometry and inks are unchanged.
 */
const Seg = memo(function Seg({ x, width, height, top, radius, track, fill, v, onPress, label, testID }: { x: number; width: number; height: number; top: number; radius: number; track: string; fill: string; v: Animated.Value; onPress?: () => void; label: string; testID: string }) {
  const grow = useMemo(() => ({ transform: [{ translateX: -width / 2 }, { scaleX: v }, { translateX: width / 2 }] }), [v, width])
  const box: ViewStyle = { position: 'absolute', left: x, top, width, height, borderRadius: radius, backgroundColor: track, overflow: 'hidden' }
  const inner = <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width, height, backgroundColor: fill }, grow]} />
  if (onPress) return <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={{ top: 6, bottom: 6 }} style={box}>{inner}</Pressable>
  return <View testID={testID} style={box} accessibilityLabel={label}>{inner}</View>
})
