import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Animated, ScrollView, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native'
import { t } from '@shared/i18n'
import { useThemeId, useInks } from '../hooks/useTheme'
import { usePrefsStore, useReduceMotion } from '../store/prefs'
import { GROUPS, THEMES, face, type ThemeDef } from '../theme'
import Icon from './Icon'
import { tourRef, tourThemePick, type Measurable } from '../store/tour'
import { Grow, H2, T, Tap } from './ui'
import { preloadThemeReveal, revealThemeFrom, type VeilHost } from './ThemeVeil'
import type { Pt } from '../lib/themeReveal'
import { RING, RING_HOLE, RING_OUTER, RING_SPRING, RING_STROKE } from '../lib/themeFade'
import { RING_LEAD_SPRING, RING_TRAIL_SPRING } from '../lib/springs'
// the ring opens and closes at half the written speed: slow enough to watch the colour flow out
import { SLOW_TEMPO } from '../lib/motionSpeed'
import { atTempo } from './motion/speed'

/**
 * Applies a theme at once and remembers it as the light or dark choice for Follow-system mode. Stable across renders.
 * During the guided tour's theme step a tap goes to the tour instead (`from`: the tapped tile, where its blob lifts off).
 */
export function useChooseTheme() {
  const { set } = usePrefsStore()
  return useCallback((t: ThemeDef, from?: Measurable | null, bloom?: { at: Pt; host: VeilHost }) => {
    const pick = tourThemePick()
    if (pick && from) { pick(t.id, from); return }
    if (bloom) revealThemeFrom(t.id, bloom.at, bloom.host)
    set({ theme: t.id, ...(t.dark ? { themeDark: t.id } : { themeLight: t.id }) })
  }, [set])
}
const BY_GROUP = Object.fromEntries(GROUPS.map(g => [g.group, THEMES.filter(t => t.group === g.group)]))
const NUMERAL_FACE = face('serif', { bold: true })
// out here because the tiles below call their theme `t`
const themeLabel = (name: string) => t('{name} theme', { name: t(name) })

/** Tight spring 0 → 1 while `on` (RING_SPRING, ~200 ms); instant under Reduce animation. Drives the selection marks. */
function useOn(on: boolean) {
  const reduce = useReduceMotion()
  const v = useRef(new Animated.Value(on ? 1 : 0)).current
  useEffect(() => {
    if (reduce) { v.stopAnimation(); v.setValue(on ? 1 : 0); return }
    const a = Animated.spring(v, { toValue: on ? 1 : 0, ...RING_SPRING, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [on, v, reduce])
  return v
}

/**
 * The theme picker: every theme as a miniature page of itself (its ink on its paper, opening at a rubric "1").
 * Tapping applies it at once, and the new theme blooms out from the tapped swatch across the screen (the Themes
 * screen) or the sheet (the reader's). Used full-size on the Themes screen and compact inside the reader sheets.
 */
export default function ThemeGallery({ compact = false }: { compact?: boolean }) {
  useEffect(preloadThemeReveal, [])
  const current = useThemeId()
  const choose = useChooseTheme()
  const { width } = useWindowDimensions()
  const cols = compact ? 4 : Math.max(3, Math.min(6, Math.floor((Math.min(width, 720) - 40) / 112)))
  const w = `${Math.floor(1000 / cols) / 10 - 3}%` as `${number}%`
  return (
    // the reader's theme sheet is where the full tour lets the reader try one
    <View ref={compact ? tourRef('theme-first') : undefined} style={{ gap: compact ? 12 : 24 }}>
      {GROUPS.map(g => (
        <View key={g.group} style={{ gap: 12 }}>
          <H2 hint={compact ? undefined : t(g.hint)}>{t(g.title)}</H2>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 14 }}>
            {BY_GROUP[g.group].map((t, i) => (
              <Swatch key={t.id} theme={t} selected={t.id === current} onChoose={choose} width={w} compact={compact} delay={i * 25} />
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

/**
 * One gallery tile. Only the label uses the current theme's ink, so only it subscribes to the theme: a theme tap
 * re-renders the two tiles whose selection changed and the labels of the rest.
 */
const Swatch = memo(function Swatch({ theme: t, selected, onChoose, width, compact, delay }: { theme: ThemeDef; selected: boolean; onChoose: (t: ThemeDef, from?: Measurable | null, bloom?: { at: Pt; host: VeilHost }) => void; width: `${number}%`; compact: boolean; delay: number }) {
  const ring = useOn(selected)
  const ringScale = useMemo(() => ring.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }), [ring])
  const page = useRef<View>(null)
  // the new theme blooms from under the finger: across the reader's sheet (compact), or the whole Themes screen
  const onPress = useCallback((e: GestureResponderEvent) => onChoose(t, page.current, { at: { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, host: compact ? 'sheet' : 'root' }), [onChoose, t, compact])
  return (
    <Grow delay={delay} style={{ width }}>
      <Tap onPress={onPress} scaleTo={0.92} accessibilityRole="radio" accessibilityLabel={themeLabel(t.name)} accessibilityState={{ selected }} style={{ gap: 6 }}>
        <View ref={page}>
          <Ring color={t.accent} opacity={ring} scale={ringScale} radius={22} />
          <MiniPage t={t} compact={compact} ring={ring} />
        </View>
        <Label name={t.name} selected={selected} />
      </Tap>
    </Grow>
  )
})
/**
 * Selection ring in the tile's own accent, which is the page's accent while it is selected and stays its own while the
 * old one fades on a change; `opacity` and `scale` must be stable Animated nodes.
 */
const Ring = memo(function Ring({ color, opacity, scale, radius }: { color: string; opacity: Animated.Value; scale?: Animated.AnimatedInterpolation<number>; radius: number }) {
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: radius, borderWidth: 2.5, borderColor: color, opacity, transform: scale ? [{ scale }] : undefined }} />
})
const Label = memo(function Label({ name, selected }: { name: string; selected: boolean }) {
  const c = useInks()
  // one word under a swatch a quarter of the sheet wide: past 1.2× system text "Lavender" would be cut
  return <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ color: selected ? c.accent : c.text, fontSize: 13, fontWeight: selected ? '700' : '500', textAlign: 'center' }}>{t(name)}</Text>
})
const Line = ({ w, color }: { w: `${number}%`; color: string }) => <View style={{ width: w, height: 4, borderRadius: 2, backgroundColor: color }} />
const MiniPage = memo(function MiniPage({ t, compact, ring }: { t: ThemeDef; compact: boolean; ring: Animated.Value }) {
  return (
    <View style={{ height: compact ? 58 : 76, borderRadius: 18, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, overflow: 'hidden', paddingHorizontal: 10, paddingTop: compact ? 7 : 10, flexDirection: 'row', gap: 7 }}>
      <Text style={{ color: t.accent, fontSize: compact ? 20 : 26, lineHeight: compact ? 22 : 28, ...NUMERAL_FACE }}>1</Text>
      <View style={{ flex: 1, gap: 5, paddingTop: compact ? 5 : 7 }}>
        <Line w="100%" color={t.text} />
        <Line w="80%" color={t.text} />
        {!compact && <Line w="55%" color={t.muted} />}
      </View>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: compact ? 14 : 18, backgroundColor: t.card }} />
      <Animated.View style={{ position: 'absolute', right: 6, bottom: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', opacity: ring, transform: [{ scale: ring }] }}>
        <Icon name="check" size={12} color={t.accentText} />
      </Animated.View>
    </View>
  )
})

/** One-row quick switcher (Home): every theme as a dot of its accent on its page, scrolling sideways, then "All themes". */
export function ThemeStrip({ onMore }: { onMore: () => void }) {
  const c = useInks()
  const current = useThemeId()
  const choose = useChooseTheme()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 6, paddingHorizontal: 6 }} style={{ marginHorizontal: -6 }}>
      {THEMES.map((t, i) => <StripChip key={t.id} theme={t} selected={t.id === current} onChoose={choose} delay={i * 18} />)}
      <Tap onPress={onMore} accessibilityRole="button" accessibilityLabel={t('All themes')} style={{ height: 48, paddingHorizontal: 16, borderRadius: 24, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
        <T small bold>{t('All themes')}</T>
      </Tap>
    </ScrollView>
  )
}
const StripChip = memo(function StripChip({ theme: t, selected, onChoose, delay }: { theme: ThemeDef; selected: boolean; onChoose: (t: ThemeDef) => void; delay: number }) {
  const { outer, hole } = useRing(selected)
  const onPress = useCallback(() => onChoose(t), [onChoose, t])
  return (
    <Grow delay={delay}>
      <Tap onPress={onPress} scaleTo={0.88} crisp accessibilityRole="radio" accessibilityLabel={themeLabel(t.name)} accessibilityState={{ selected }}>
        <ChipFace t={t} outer={outer} hole={hole} />
      </Tap>
    </Grow>
  )
})
/**
 * The ring's two edges, 0 (the dot) to 1 (the ring): opening, the outer edge leads and the hole trails; closing, the
 * hole leads (the centre fills) and the outer edge trails, so the hole is never wider than the accent around it.
 */
function useRing(on: boolean) {
  const reduce = useReduceMotion()
  const outer = useRef(new Animated.Value(on ? 1 : 0)).current
  const hole = useRef(new Animated.Value(on ? 1 : 0)).current
  useEffect(() => {
    const to = on ? 1 : 0
    if (reduce) { outer.stopAnimation(); hole.stopAnimation(); outer.setValue(to); hole.setValue(to); return }
    const a = Animated.parallel([
      Animated.spring(outer, atTempo(SLOW_TEMPO, { toValue: to, ...(on ? RING_LEAD_SPRING : RING_TRAIL_SPRING), useNativeDriver: true })),
      Animated.spring(hole, atTempo(SLOW_TEMPO, { toValue: to, ...(on ? RING_TRAIL_SPRING : RING_LEAD_SPRING), useNativeDriver: true })),
    ])
    a.start()
    return () => a.stop()
  }, [on, outer, hole, reduce])
  return { outer, hole }
}
const CHIP = 48
/** Offsets from the chip's padding box (inside its 1 px border) that centre the two discs on it. */
const RING_AT = (CHIP - 2 - RING) / 2, HOLE = RING - 2 * RING_STROKE, HOLE_AT = (CHIP - 2 - HOLE) / 2
/**
 * The chip: its page, and on it the accent dot that opens into the selection ring (lib/themeFade.ts `ringAt`). The ring
 * overhangs the chip by 4 px and hides its outline; the hole is the chip's own page colour, which is the page itself
 * once the theme is chosen, so the centre reads hollow.
 */
const ChipFace = memo(function ChipFace({ t, outer: o, hole: h }: { t: ThemeDef; outer: Animated.Value; hole: Animated.Value }) {
  const outer = useMemo(() => ({ transform: [{ scale: o.interpolate(RING_OUTER) }] }), [o])
  const hole = useMemo(() => ({ transform: [{ scale: h.interpolate(RING_HOLE) }] }), [h])
  return (
    <View style={{ width: CHIP, height: CHIP, borderRadius: CHIP / 2, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border }}>
      <Animated.View style={[{ position: 'absolute', left: RING_AT, top: RING_AT, width: RING, height: RING, borderRadius: RING / 2, backgroundColor: t.accent }, outer]} />
      <Animated.View style={[{ position: 'absolute', left: HOLE_AT, top: HOLE_AT, width: HOLE, height: HOLE, borderRadius: HOLE / 2, backgroundColor: t.bg }, hole]} />
    </View>
  )
})
