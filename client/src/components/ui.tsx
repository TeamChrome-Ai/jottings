import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { Animated, Easing, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type LayoutChangeEvent, type LayoutRectangle, type PressableProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useBottomInset } from '../hooks/useBottomInset'
import { useDesktop } from '../hooks/useDesktop'
import { DIALOG_MAX_W, DIALOG_RISE } from '../lib/layout'
import * as Haptics from 'expo-haptics'
import { t, tc } from '@shared/i18n'
import { SurfaceContext, useColors, useInkFill, useInks } from '../hooks/useTheme'
import { ALIGN_SELF, WIDTH_PX, usePref, usePrefsStore, useReduceMotion } from '../store/prefs'
import { face } from '../theme'
import Icon, { type IconName } from './Icon'
import { OverlayHost } from '../store/overlay'
import { tourScroller } from '../store/tour'
import ThemeVeil from './ThemeVeil'
import RiseIn from './motion/rise'
import { CONTROL_SPRING, EXIT_MS, PRESS_IN_MS, RELEASE_SPRING, RISE_SPRING, SCRIM_IN_MS, POP_SPRING } from '../lib/motion'
import { WOBBLE_SPRING, springAt } from '../lib/springs'
import { motionSpeed } from '../lib/motionSpeed'

export { useFill, useSurface } from '../hooks/useTheme'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)
/*
 * An Animated component rebuilds its animated props node (detach, then reconnect the native view) whenever an
 * AnimatedNode in its style, or any array or plain-object prop, changes identity between renders. So in the
 * primitives below interpolations are memoised, children go in as one fragment (several JSX children arrive as a
 * fresh array every render), and Tap's accessibilityState is kept by value.
 */

/** Spacing steps (4-point) and radii by hierarchy: the bigger and more important the block, the rounder. */
export const SPACE = { xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 24, xxxl: 32 } as const
export const RADIUS = { hero: 28, card: 20, control: 14, pill: 999 } as const
/** Type scale (px). Scripture size is the reader's own preference; these are the interface steps. */
export const TYPE = { numeral: 72, title: 32, hero: 22, heading: 18, body: 16, small: 14, caption: 13 } as const
const GUTTER = 20
const MEASURE = 720

/** Light haptic tick on native; no-op on web. Never throws (haptics are unavailable on some devices). */
/** The shortest tick each platform has: Android's own clock tick (the system keyboard's), iOS's selection tap.
 *  expo-haptics' selection waveform on Android runs a touch long. */
export function tick() {
  if (Platform.OS === 'android') Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick).catch(() => {})
  else if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {})
}

/** Mount animation: fade + a short rise, once, off the JS thread (motion/rise.tsx). Off under Reduce animation. */
export function Enter({ children, delay = 0, style, rise = 12, onLayout }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle>; rise?: number; onLayout?: (e: LayoutChangeEvent) => void }) {
  return <RiseIn delay={delay} duration={340} rise={rise} style={style} onLayout={onLayout}>{children}</RiseIn>
}

/** Pop-in for small marks (streak dots, checks) and hero blocks: scale `from` → 1 on POP_SPRING, staggered by `delay`. */
export function Grow({ children, delay = 0, style, from = 0 }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle>; from?: number }) {
  const reduce = useReduceMotion()
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current
  useEffect(() => {
    if (reduce) { v.setValue(1); return }
    Animated.spring(v, { toValue: 1, delay, ...POP_SPRING, useNativeDriver: true }).start()
  }, [v, delay, reduce])
  const { scale, opacity } = useMemo(() => from
    ? { scale: v.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }), opacity: v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }) }
    : { scale: v, opacity: 1 }, [v, from])
  return <Animated.View style={[{ opacity, transform: [{ scale }] }, style]}><>{children}</></Animated.View>
}

/**
 * Pressable with press feedback and a haptic tick; the base for every tappable surface. Pressing eases down in
 * PRESS_IN_MS (a timing, so a quick tap never bounces past the pressed scale); letting go springs back with a quick
 * wobble (lib/springs.ts WOBBLE_SPRING). `crisp` releases without it, for a control whose own motion a wobble would
 * muddy (a segmented choice under its sliding thumb, a theme strip chip opening its ring).
 */
export function Tap({ children, style, scaleTo = 0.96, haptic = true, crisp = false, onPressIn, onPressOut, onPress, accessibilityState: a, ...rest }: PressableProps & { children?: ReactNode; style?: StyleProp<ViewStyle>; scaleTo?: number; haptic?: boolean; crisp?: boolean; ref?: Ref<View> }) {
  // read at press time: a Tap never re-renders because a pref changed
  const prefs = usePrefsStore()
  const s = useRef(new Animated.Value(1)).current
  const press = () => Animated.timing(s, { toValue: scaleTo, duration: PRESS_IN_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
  const release = () => Animated.spring(s, { toValue: 1, ...(crisp ? RELEASE_SPRING : WOBBLE_SPRING), useNativeDriver: true }).start()
  const state = useMemo(() => a, [a?.selected, a?.checked, a?.disabled, a?.busy, a?.expanded])
  return (
    <AnimatedPressable
      {...rest}
      accessibilityState={state}
      onPressIn={e => { if (!prefs.get().reduceMotion) press(); onPressIn?.(e) }}
      onPressOut={e => { release(); onPressOut?.(e) }}
      onPress={e => { if (haptic) tick(); onPress?.(e) }}
      style={[{ transform: [{ scale: s }] }, style]}>
      <>{children}</>
    </AnimatedPressable>
  )
}

/** A page: flat theme background, 20 px gutter, content capped at a readable width on tablets and desktop web. */
export function Screen({ children, scroll = true, style, padded = true, safeTop = false, animate = true, scrollRef }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle>; padded?: boolean; safeTop?: boolean; animate?: boolean; /** the scrolling screen's ScrollView, for screens that move the reader to a block */ scrollRef?: Ref<ScrollView> }) {
  const c = useInks()
  const insets = useSafeAreaInsets()
  const bottom = useBottomInset()
  const pad: ViewStyle | null = padded
    ? { padding: GUTTER, gap: SPACE.l, paddingTop: SPACE.l + (safeTop ? insets.top + SPACE.s : 0), paddingBottom: SPACE.xxxl + bottom }
    : { paddingTop: safeTop ? insets.top : 0, paddingBottom: bottom }
  const width = usePref('width'), align = usePref('align')
  const cap: ViewStyle = { width: '100%', maxWidth: WIDTH_PX[width] ?? undefined, alignSelf: ALIGN_SELF[align] }
  const keyboard = useKeyboardRoom(scroll)
  const body = animate ? <Enter style={[{ gap: pad ? SPACE.l : 0 }, scroll ? null : { flex: 1 }]}>{children}</Enter> : children
  // the screen's own ref, and the guided tour's (it scrolls a target into view)
  const refs = useCallback((el: ScrollView | null) => {
    const put = (v: ScrollView | null) => { if (typeof scrollRef === 'function') scrollRef(v); else if (scrollRef) (scrollRef as { current: ScrollView | null }).current = v }
    put(el)
    keyboard.scroller.current = el
    const off = tourScroller(el)
    return () => { off?.(); put(null) }
  }, [scrollRef])
  return (
    <SurfaceContext.Provider value="bg">
      <KeyboardRevealContext.Provider value={keyboard.reveal}>
      {scroll
        ? <ScrollView ref={refs} style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={[cap, pad, style, keyboard.room ? { paddingBottom: (pad?.paddingBottom as number ?? 0) + keyboard.room } : null]}
            keyboardShouldPersistTaps="handled" onScroll={keyboard.onScroll} scrollEventThrottle={32}>{body}</ScrollView>
        : <View style={{ flex: 1, backgroundColor: c.bg }}><View style={[cap, { flex: 1 }, pad, style]}>{body}</View></View>}
      </KeyboardRevealContext.Provider>
    </SurfaceContext.Provider>
  )
}

/**
 * A screen's room for the keyboard. The app draws edge to edge, so Android no longer shrinks the window when the
 * keyboard opens and a field low on a screen (the editor's "Add a passage") sat under it. While the keyboard is up the
 * screen's scroll gains its height at the bottom, and the focused field is scrolled to just above it.
 */
type Measurable = { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void }
function useKeyboardRoom(scroll: boolean) {
  const scroller = useRef<ScrollView | null>(null)
  const offset = useRef(0)
  const top = useRef(0)  // the keyboard's top on screen while it is up, else 0
  const [room, setRoom] = useState(0)
  // a view brought above the keyboard, with a margin, when the keyboard is up and covers it
  const reveal = useCallback((el: Measurable | null | undefined) => {
    if (!top.current) return
    el?.measureInWindow?.((_x, y, _w, h) => {
      const over = y + h + 16 - top.current
      if (over > 0) scroller.current?.scrollTo({ y: offset.current + over, animated: true })
    })
  }, [])
  useEffect(() => {
    if (Platform.OS === 'web' || !scroll) return
    const shown = Keyboard.addListener('keyboardDidShow', e => {
      top.current = e.endCoordinates.screenY
      setRoom(e.endCoordinates.height)
      // the room is laid out first; then the field, wherever it is, is brought above the keyboard
      setTimeout(() => reveal(TextInput.State.currentlyFocusedInput() as unknown as Measurable | null), 60)
    })
    const hidden = Keyboard.addListener('keyboardDidHide', () => { top.current = 0; setRoom(0) })
    return () => { shown.remove(); hidden.remove() }
  }, [scroll, reveal])
  const onScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => { offset.current = e.nativeEvent.contentOffset.y }, [])
  return { scroller, room, onScroll, reveal }
}
/** Brings a view above the keyboard on the screen it is in, when the keyboard covers it (what a field shows under
 *  itself as the reader types: the editor's verse preview). Does nothing off a scrolling Screen or with no keyboard. */
const KeyboardRevealContext = createContext<(el: Measurable | null | undefined) => void>(() => {})
export const useKeyboardReveal = () => useContext(KeyboardRevealContext)

/** Interface text in the system sans. `serif` switches to the reading face (scripture quotes, display lines). */
export function T({ children, muted, small, bold, serif, accent, style, ...rest }: { children: ReactNode; muted?: boolean; small?: boolean; bold?: boolean; serif?: boolean; accent?: boolean; style?: StyleProp<TextStyle> } & Omit<React.ComponentProps<typeof Text>, 'style'>) {
  const c = useInks()
  const f = serif ? face('serif', { bold }) : { fontWeight: bold ? '600' as const : '400' as const }
  return <Text {...rest} style={[{ color: accent ? c.accent : muted ? c.muted : c.text, fontSize: small ? TYPE.small : TYPE.body }, f, style]}>{children}</Text>
}
/** Screen title: the reading face, bold, 32 px. */
export function H({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = useInks()
  return <Text accessibilityRole="header" style={[{ color: c.text, fontSize: TYPE.title, letterSpacing: -0.3, marginBottom: 2 }, face('serif', { bold: true }), style]}>{children}</Text>
}
/** Section heading: sentence case, sans, 18 px. `hint` adds one muted line under it. */
export function H2({ children, hint, style }: { children: ReactNode; hint?: string; style?: StyleProp<TextStyle> }) {
  const c = useInks()
  const head = <Text accessibilityRole="header" style={[{ color: c.text, fontSize: TYPE.heading, fontWeight: '700', letterSpacing: -0.1, marginTop: SPACE.s }, style]}>{children}</Text>
  if (!hint) return head
  return <View style={{ gap: 2 }}>{head}<Text style={{ color: c.muted, fontSize: TYPE.small }}>{hint}</Text></View>
}

/**
 * A flat tonal block: no border, no shadow, radius 20. Controls inside it fill themselves with the page colour.
 * `tone="soft"` tints it with the accent; `tone="accent"` is the one solid rubric block a screen may have.
 */
export function Card({ children, style, onPress, tone = 'card', accessibilityLabel, ref }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; tone?: 'card' | 'soft' | 'accent'; accessibilityLabel?: string; ref?: Ref<View> }) {
  const c = useInks()
  const bg = tone === 'accent' ? c.accent : tone === 'soft' ? c.accentSoft : c.card
  const base: ViewStyle = { backgroundColor: bg, borderRadius: tone === 'accent' ? RADIUS.hero : RADIUS.card, padding: 18, gap: 10 }
  const inner = <SurfaceContext.Provider value="card">{children}</SurfaceContext.Provider>
  if (onPress) return <Tap ref={ref} onPress={onPress} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={[base, style]}>{inner}</Tap>
  return <View ref={ref} style={[base, style]}>{inner}</View>
}
export const Row = ({ children, style, ref }: { children: ReactNode; style?: StyleProp<ViewStyle>; ref?: Ref<View> }) => <View ref={ref} style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }, style]}>{children}</View>

/**
 * A pill that picks or opens one thing: 36 high, the opposite fill of its surface (`accentSoft` and the accent ink when
 * `on`), the label in the reading face and an optional muted detail after it (a count, a Strong's number).
 */
export function Chip({ label, detail, on = false, onPress, tab = false, accessibilityLabel }: { label: string; detail?: string; on?: boolean; onPress: () => void; /** one of a set of choices (a letter, a book) rather than a link */ tab?: boolean; accessibilityLabel?: string }) {
  const c = useInks()
  const fill = useInkFill()
  return (
    <Tap onPress={onPress} scaleTo={0.94} accessibilityRole={tab ? 'tab' : 'link'} accessibilityState={tab ? { selected: on } : undefined} accessibilityLabel={accessibilityLabel ?? label}
      style={{ height: 36, borderRadius: 18, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: on ? c.accentSoft : fill }}>
      <Text style={{ color: on ? c.accent : c.text, fontSize: TYPE.body, ...face('serif', { bold: on }) }}>{label}</Text>
      {detail ? <Text style={{ color: c.muted, fontSize: TYPE.caption }}>{detail}</Text> : null}
    </Tap>
  )
}

/** One line of a grouped list: optional icon, label, optional detail, chevron. Several go in one Card with `gap: 0`. */
/** A row of a settings card; without `onPress` it only informs (no chevron, no press). */
export function ListRow({ label, detail, icon, onPress, danger, disabled, ref }: { label: string; detail?: string; icon?: IconName; onPress?: () => void; danger?: boolean; disabled?: boolean; ref?: Ref<View> }) {
  const c = useInks()
  const fill = useInkFill()
  return (
    <Tap ref={ref} onPress={onPress} disabled={disabled || !onPress} scaleTo={onPress ? 0.985 : 1} accessibilityRole={onPress ? 'button' : 'text'} accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingVertical: 6, opacity: disabled ? 0.4 : 1 }}>
      {icon ? <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={18} color={danger ? c.danger : c.accent} /></View> : null}
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: danger ? c.danger : c.text, fontSize: TYPE.body, fontWeight: '500' }}>{label}</Text>
        {detail ? <Text style={{ color: c.muted, fontSize: TYPE.small }}>{detail}</Text> : null}
      </View>
      {onPress ? <Icon name="chevron" size={18} color={c.muted} /> : null}
    </Tap>
  )
}

/**
 * Pill button. Default: a tonal fill that is the opposite of the surface it sits on. `primary`: solid accent.
 * `soft`: accent tint. `danger`: tonal with the danger ink. `icon`/`iconName`: a round icon button. `lead`: a glyph before the title;
 * `trail`: one after it, kept whole while a long title truncates (a contents pill's chevron).
 */
export function Button({ title, primary, soft, small, danger, icon, iconName, lead, leadNode, trail, style, textStyle, ...rest }: { title: string; primary?: boolean; soft?: boolean; small?: boolean; danger?: boolean; icon?: boolean; iconName?: IconName; /** a small glyph before the title */ lead?: IconName; /** a mark of its own colours before the title (another company's logo) */ leadNode?: ReactNode; /** a small glyph after the title */ trail?: IconName; textStyle?: StyleProp<TextStyle>; ref?: Ref<View> } & PressableProps & { style?: StyleProp<ViewStyle> }) {
  const c = useInks()
  const fill = useInkFill()
  const bg = primary ? c.accent : soft ? c.accentSoft : fill
  const fg = primary ? c.accentText : danger ? c.danger : c.text
  const round = icon || iconName
  const h = small ? 36 : 44
  const label = <Text allowFontScaling={!round} numberOfLines={1} style={[{ color: fg, fontSize: small ? TYPE.small : TYPE.body, fontWeight: '600' }, trail ? { flexShrink: 1 } : null, textStyle]}>{title}</Text>
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={rest.accessibilityLabel ?? (iconName ? title : undefined)}
      scaleTo={0.94}
      {...rest}
      style={[
        { backgroundColor: bg, borderRadius: h / 2, minHeight: h, paddingHorizontal: round ? 0 : small ? 14 : 20, alignItems: 'center', justifyContent: 'center', opacity: rest.disabled ? 0.4 : 1 },
        round ? { width: h, height: h } : null,
        style,
      ]}>
      {iconName ? <Icon name={iconName} size={small ? 16 : 20} color={fg} />
        : leadNode ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>{leadNode}{label}</View>
        : lead ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name={lead} size={small ? 16 : 18} color={fg} />{label}</View>
        : trail ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' }}>{label}<View style={{ flexShrink: 0 }}><Icon name={trail} size={small ? 14 : 16} color={fg} /></View></View>
        : label}
    </Tap>
  )
}

/** Text field: filled with the opposite tone of its surface; the outline appears in the accent while focused. */
export function Input({ inputRef, ...props }: TextInputProps & { /** the field itself, to focus it from outside */ inputRef?: Ref<TextInput> }) {
  const c = useInks()
  const fill = useInkFill()
  const [focused, setFocused] = useState(false)
  return (
    <TextInput
      ref={inputRef}
      placeholderTextColor={c.muted}
      selectionColor={c.accent}
      {...props}
      onFocus={e => { setFocused(true); props.onFocus?.(e) }}
      onBlur={e => { setFocused(false); props.onBlur?.(e) }}
      style={[{ backgroundColor: fill, color: c.text, borderColor: focused ? c.accent : 'transparent', borderWidth: 2, borderRadius: RADIUS.control, paddingHorizontal: 14, paddingVertical: 11, fontSize: TYPE.body, minHeight: 48 }, Platform.OS === 'web' ? { outlineStyle: 'none' } as unknown as TextStyle : null, props.style]}
    />
  )
}

/**
 * Flat on/off switch: the thumb slides and the track fills with the accent. The fills crossfade (an accent track over
 * the plain one, an accent-ink knob over the muted one) so the whole switch runs on the native driver.
 */
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  const c = useInks()
  const reduce = useReduceMotion()
  const v = useRef(new Animated.Value(value ? 1 : 0)).current
  useEffect(() => {
    if (reduce) { v.stopAnimation(); v.setValue(value ? 1 : 0); return }
    const a = Animated.spring(v, { toValue: value ? 1 : 0, ...CONTROL_SPRING, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [value, v, reduce])
  const slide = useMemo(() => ({ transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }] }), [v])
  const on = useMemo(() => ({ opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }) }), [v])
  return (
    <Pressable onPress={() => { tick(); onChange(!value) }} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} hitSlop={8}>
      <View style={[toggle.track, { backgroundColor: c.border }]}>
        <Animated.View style={[StyleSheet.absoluteFill, toggle.round, { backgroundColor: c.accent }, on]} />
        <Animated.View style={[toggle.knob, slide]}>
          <View style={[toggle.dot, { backgroundColor: c.muted }]} />
          <Animated.View style={[toggle.dot, toggle.over, { backgroundColor: c.accentText }, on]} />
        </Animated.View>
      </View>
    </Pressable>
  )
}
const toggle = StyleSheet.create({
  track: { width: 50, height: 30, borderRadius: 15 },
  round: { borderRadius: 15 },
  knob: { position: 'absolute', left: 3, top: 3, width: 24, height: 24 },
  dot: { width: 24, height: 24, borderRadius: 12 },
  over: { position: 'absolute', left: 0, top: 0 },
})

export function SwitchRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Tap onPress={() => onChange(!value)} scaleTo={0.99} haptic accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12, minHeight: 52 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T>{label}</T>
        {hint ? <T small muted>{hint}</T> : null}
      </View>
      <Toggle value={value} onChange={onChange} label={label} />
    </Tap>
  )
}

/**
 * Choice chips on a tonal track; a solid accent thumb slides to the chosen one. Wraps when the options do not fit.
 * Each label turns to the accent ink as the thumb passes under it, not the moment it is tapped: its colour is a
 * crossfade driven by the thumb's own position.
 */
export function Segmented<V extends string>({ value, options, onChange }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  const c = useColors()
  const fill = useInkFill()
  const prefs = usePrefsStore()
  const boxes = useRef(new Map<V, LayoutRectangle>()).current
  const thumb = useRef({ x: new Animated.Value(0), y: new Animated.Value(0), w: new Animated.Value(0), h: new Animated.Value(0) }).current
  const lit = useRef(new Map<string, Lit>()).current
  const [placed, setPlaced] = useState(false)
  // a value chosen outside the options (an added font listed elsewhere) leaves no thumb behind
  const shown = placed && options.some(o => o.value === value)
  const move = (animate: boolean) => {
    const b = boxes.get(value)
    if (!b) return
    const to = { x: b.x, y: b.y, w: b.width, h: b.height }
    if (!animate || prefs.get().reduceMotion) { thumb.x.setValue(to.x); thumb.y.setValue(to.y); thumb.w.setValue(to.w); thumb.h.setValue(to.h); setPlaced(true); return }
    const spring = (a: Animated.Value, t: number) => Animated.spring(a, { toValue: t, ...CONTROL_SPRING, useNativeDriver: false })
    Animated.parallel([spring(thumb.x, to.x), spring(thumb.y, to.y), spring(thumb.w, to.w), spring(thumb.h, to.h)]).start()
  }
  useEffect(() => { move(placed) }, [value])
  const label: TextStyle = { fontWeight: '600', fontSize: TYPE.small }
  /**
   * The label's two inks: accent ink at 1 while the thumb sits on option `i`, 0 by the time it reaches a neighbour in
   * the same row (or another row). Kept by geometry and colours so the Animated styles keep their identity.
   */
  const litFor = (i: number): Lit | null => {
    const b = boxes.get(options[i].value)
    if (!shown || !b) return null
    const side = (j: number, dir: number) => { const n = j >= 0 && j < options.length ? boxes.get(options[j].value) : undefined; return n && n.y === b.y ? n.x : b.x + dir * (b.width + 2) }
    const lo = side(i - 1, -1), hi = side(i + 1, 1)
    const key = `${options[i].value}|${lo}|${b.x}|${hi}|${b.y}|${b.height}|${c.text}|${c.accentText}`
    let e = lit.get(key)
    if (!e) {
      const across = thumb.x.interpolate({ inputRange: [lo, b.x, hi], outputRange: [0, 1, 0], extrapolate: 'clamp' })
      const down = thumb.y.interpolate({ inputRange: [b.y - b.height, b.y, b.y + b.height], outputRange: [0, 1, 0], extrapolate: 'clamp' })
      const over = Animated.multiply(across, down)
      e = { under: [label, { color: c.text, opacity: Animated.subtract(1, over) }], over: [label, StyleSheet.absoluteFill, { color: c.accentText, opacity: over }] }
      lit.set(key, e)
    }
    return e
  }
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'flex-start', maxWidth: '100%', gap: 2, padding: 4, borderRadius: 22, backgroundColor: fill }}>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: thumb.x, top: thumb.y, width: thumb.w, height: thumb.h, borderRadius: 18, backgroundColor: c.accent, opacity: shown ? 1 : 0 }} />
      {options.map((o, i) => {
        const on = o.value === value
        const l = litFor(i)
        return (
          <Tap key={o.value} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }} aria-checked={on} scaleTo={0.93} crisp
            onLayout={e => { boxes.set(o.value, e.nativeEvent.layout); if (on) move(false) }}
            style={{ paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: 18, backgroundColor: on && !placed ? c.accent : 'transparent' }}>
            {l ? (
              <View>
                <Animated.Text style={l.under}>{o.label}</Animated.Text>
                <Animated.Text aria-hidden style={l.over}>{o.label}</Animated.Text>
              </View>
            ) : <Text style={[label, { color: on ? c.accentText : c.text }]}>{o.label}</Text>}
          </Tap>
        )
      })}
    </View>
  )
}
type Lit = { under: Animated.WithAnimatedValue<StyleProp<TextStyle>>; over: Animated.WithAnimatedValue<StyleProp<TextStyle>> }

/** When the sheet opening now will be (nearly) up: its rise reaching 80% of the way, in real ms at this speed. */
type SheetArrival = { at: number }
const SheetArrivalContext = createContext<{ current: SheetArrival } | null>(null)
const riseMs = () => { let t = 0; while (t < 2000 && springAt(RISE_SPRING, t) < 0.8) t++; return t / motionSpeed() }
/**
 * The delay (as written, before the animation speed applies) that holds an entrance until the sheet it opens in is
 * up: content mounted with a sheet would otherwise play its entrance while the sheet is still below the screen.
 * 0 outside a sheet, or once the sheet has risen. Read once, when the entrance mounts.
 */
export function useSheetArrivalDelay(): number {
  const ctx = useContext(SheetArrivalContext)
  const [ms] = useState(() => ctx ? Math.max(0, ctx.current.at - Date.now()) * motionSpeed() : 0)
  return ms
}
/** The same wait, asked at the moment it is needed: for rows that mount later than their list (data arriving, a page
 *  turn), which should wait for the sheet only while it is still rising. */
export function useSheetWait(): () => number {
  const ctx = useContext(SheetArrivalContext)
  return useCallback(() => ctx ? Math.max(0, ctx.current.at - Date.now()) * motionSpeed() : 0, [ctx])
}

/**
 * Bottom sheet built on Modal: the scrim fades in, the sheet rises its own height on RISE_SPRING (nearly critical, so
 * it never lifts past its rest and shows scrim under its foot); closing, both leave in EXIT_MS. Tap the scrim or drag
 * the grab bar down to close. On the desktop (DESKTOP_MIN up) the same sheet is a dialog: centred, DIALOG_MAX_W wide
 * at most, rounded all round, rising DIALOG_RISE px from just below its rest as it fades in on the same spring; no
 * grab bar and no drag (Escape and the scrim close it, through the Modal's onRequestClose).
 */
export function Sheet({ open, onClose, onBack, title, children, maxHeight = '80%' }: { open: boolean; onClose: () => void; /** the back button, when the sheet has somewhere to go back to inside itself */ onBack?: () => void; title?: string; children: ReactNode; maxHeight?: number | `${number}%` }) {
  const c = useInks()
  const reduce = useReduceMotion()
  const insets = useSafeAreaInsets()
  const desktop = useDesktop()
  const [mounted, setMounted] = useState(open)
  const v = useRef(new Animated.Value(0)).current
  const scrim = useRef(new Animated.Value(0)).current
  // the travel is the sheet's own height, measured on its first layout; until then it waits below the screen
  const dist = useRef(new Animated.Value(2000)).current
  const [measured, setMeasured] = useState(false)
  // drag the grab bar (or the title) down: follows the finger, springs back under the threshold, dismisses past it
  const drag = useRef(new Animated.Value(0)).current
  const closeRef = useRef(onClose); closeRef.current = onClose
  const back = () => Animated.spring(drag, { toValue: 0, ...RISE_SPRING, useNativeDriver: true }).start()
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_, g) => {
      if (g.dy > 90 || g.vy > 0.6) closeRef.current()
      else back()
    },
    onPanResponderTerminate: () => back(),
  })).current
  if (open && !mounted) setMounted(true)
  // when this opening's rise will have the sheet on screen: content that enters as it opens waits for it
  const arrival = useRef<SheetArrival>({ at: 0 })
  if (open && !mounted) arrival.current = { at: Date.now() + riseMs() }
  useEffect(() => {
    if (open) drag.setValue(0)
    if (reduce) { v.setValue(open ? 1 : 0); scrim.setValue(open ? 1 : 0); if (!open) setMounted(false); return }
    if (open && !measured) return
    if (open) arrival.current.at = Date.now() + riseMs()
    const a = open
      ? Animated.parallel([
          Animated.spring(v, { toValue: 1, ...RISE_SPRING, useNativeDriver: true }),
          Animated.timing(scrim, { toValue: 1, duration: SCRIM_IN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ])
      : Animated.parallel([
          Animated.timing(v, { toValue: 0, duration: EXIT_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
          Animated.timing(scrim, { toValue: 0, duration: EXIT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ])
    a.start(({ finished }) => { if (finished && !open) setMounted(false) })
    return () => a.stop()
  }, [open, v, scrim, reduce, measured])
  const onPanel = (e: LayoutChangeEvent) => {
    dist.setValue(desktop ? DIALOG_RISE : e.nativeEvent.layout.height + 24)
    if (!measured) setMeasured(true)
  }
  const rise = useMemo(() => Animated.add(Animated.multiply(v.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' }), dist), drag), [v, dist, drag])
  const panel: ViewStyle = desktop
    ? { borderRadius: RADIUS.hero, maxWidth: DIALOG_MAX_W, paddingBottom: 12 }
    : { borderTopLeftRadius: RADIUS.hero, borderTopRightRadius: RADIUS.hero, maxWidth: MEASURE, paddingBottom: insets.bottom + 12 }
  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onBack ?? onClose} statusBarTranslucent navigationBarTranslucent>
      <SheetArrivalContext.Provider value={arrival}>
      <SurfaceContext.Provider value="bg">
        {/* the translucent-bar Modal window opts out of adjustResize on Android, so the sheet lifts itself above the keyboard */}
        <KeyboardAvoidingView behavior={Platform.OS === 'web' ? undefined : 'padding'} enabled={Platform.OS !== 'web'} style={{ flex: 1, justifyContent: desktop ? 'center' : 'flex-end' }}>
          <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', opacity: scrim }}>
            <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={tc('verb', 'Close')} />
          </Animated.View>
          <Animated.View onLayout={onPanel} testID={desktop ? 'sheet-dialog' : 'sheet-panel'} style={[{ backgroundColor: c.bg, maxHeight, width: '100%', alignSelf: 'center', transform: [{ translateY: rise }] }, panel, desktop ? { opacity: v } : null]}>
            <>
              <View {...(desktop ? null : pan.panHandlers)} accessibilityLabel={desktop ? undefined : t('Drag down to close')} style={{ paddingBottom: title ? 0 : 8 }}>
                {desktop ? null : <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: c.border, marginTop: 10 }} />}
                {title ? <Text accessibilityRole="header" style={{ color: c.text, fontSize: TYPE.heading + 2, fontWeight: '700', paddingHorizontal: GUTTER, paddingTop: desktop ? 20 : 12, paddingBottom: 4 }}>{title}</Text> : null}
              </View>
              {children}
              {/* a Modal is its own window: the root's theme veil cannot reach the panel */}
              <ThemeVeil radius={RADIUS.hero} host="sheet" />
            </>
          </Animated.View>
        </KeyboardAvoidingView>
        {/* the tour and its theme blob draw over an open sheet from here: a Modal is its own window */}
        <OverlayHost />
      </SurfaceContext.Provider>
      </SheetArrivalContext.Provider>
    </Modal>
  )
}

/** Three dots breathing in turn, in the accent (or `color` on an accent block). */
export function Spinner({ label, color }: { label?: string; color?: string }) {
  const c = useInks()
  const reduce = useReduceMotion()
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current
  const scales = useMemo(() => dots.map(d => d.interpolate({ inputRange: [0.3, 1], outputRange: [0.8, 1.15] })), [dots])
  // a wait under ~150 ms never shows the dots at all; a longer one lets them in softly rather than cutting to them
  const shown = useRef(new Animated.Value(reduce ? 1 : 0)).current
  useEffect(() => {
    if (reduce) { shown.setValue(1); return }
    const a = Animated.timing(shown, { toValue: 1, duration: 220, delay: 150, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [reduce, shown])
  useEffect(() => {
    if (reduce) { dots.forEach(d => d.setValue(0.6)); return }
    const loop = Animated.loop(Animated.stagger(140, dots.map(d => Animated.sequence([
      Animated.timing(d, { toValue: 1, duration: 320, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(d, { toValue: 0.3, duration: 320, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]))))
    loop.start()
    return () => loop.stop()
  }, [dots, reduce])
  return (
    <Animated.View style={{ alignItems: 'center', paddingVertical: 20, gap: 8, opacity: shown }} accessibilityRole="progressbar" accessibilityLabel={label ?? t('Loading')}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {dots.map((d, i) => <Animated.View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color ?? c.accent, opacity: d, transform: [{ scale: scales[i] }] }} />)}
      </View>
      {label ? <T small muted>{label}</T> : null}
    </Animated.View>
  )
}
/** An error line: fades up into place rather than appearing (it usually replaces a Spinner or joins a form). */
export function ErrorText({ children }: { children: ReactNode }) {
  const c = useInks()
  return <Enter rise={4}><Text accessibilityRole="alert" style={{ color: c.danger, fontSize: TYPE.small }}>{children}</Text></Enter>
}

/**
 * The rubric numeral: a chapter number set large in the accent, like the red chapter numbers of a printed Bible.
 * The one ornament the app allows itself; used to open a chapter and on the Continue tile.
 */
export function Numeral({ n, size = TYPE.numeral, dyslexic = false, style }: { n: number | string; size?: number; dyslexic?: boolean; style?: StyleProp<TextStyle> }) {
  const c = useInks()
  return <Text style={[{ color: c.accent, fontSize: size, lineHeight: Math.round(size * 1.05), letterSpacing: -size * 0.02, fontVariant: ['lining-nums'] }, face(dyslexic ? 'dyslexic' : 'serif', { bold: true }), style]}>{n}</Text>
}
