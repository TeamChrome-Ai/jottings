import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Animated, Easing, Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import { Tabs, useIsFocused, useNavigation } from 'expo-router'
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Icon, { type IconName } from '../../src/components/Icon'
import { useColors, useInks } from '../../src/hooks/useTheme'
import { useDesktop } from '../../src/hooks/useDesktop'
import { RAIL_W } from '../../src/lib/layout'
import { useStreakAlive } from '../../src/hooks/useStreakAlive'
import { usePref } from '../../src/store/prefs'
import { SLOW_TEMPO, scaleMs, tempoSpeed } from '../../src/lib/motionSpeed'
import { mix } from '../../src/theme'
import { tourRef } from '../../src/store/tour'
import type { TargetId } from '../../src/lib/tour'
import { CONTROL_SPRING, POP_SPRING } from '../../src/lib/motion'

const GLOW = 30

/**
 * Tab glyph on a flat accent-tint pill that grows out from the icon when its tab becomes active, while the outline
 * glyph in the muted ink crossfades into the filled one in the accent, which settles from a hair smaller (CONTROL_SPRING,
 * no bounce). `lit` (the Stats tab while a streak is alive) draws the filled glyph in the accent on a soft glow disc,
 * focused or not; turning lit, the disc blooms and the glyph flares once. Nothing loops; Reduce animation shows the end
 * states at rest.
 */
function TabIcon({ name, focused, lit = false, target }: { name: IconName; focused: boolean; lit?: boolean; target?: TargetId }) {
  const c = useColors()
  const reduce = usePref('reduceMotion')
  const s = useRef(new Animated.Value(focused ? 1 : 0)).current
  const g = useRef(new Animated.Value(lit ? 1 : 0)).current
  const flare = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (reduce) { s.setValue(focused ? 1 : 0); return }
    const a = Animated.spring(s, { toValue: focused ? 1 : 0, ...CONTROL_SPRING, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [focused, s, reduce])
  useEffect(() => {
    if (reduce) { g.setValue(lit ? 1 : 0); flare.setValue(1); return }
    const bloom = Animated.spring(g, { toValue: lit ? 1 : 0, ...POP_SPRING, useNativeDriver: true })
    const a = lit
      ? Animated.parallel([bloom, Animated.sequence([
          Animated.timing(flare, { toValue: 1.22, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.spring(flare, { toValue: 1, ...POP_SPRING, useNativeDriver: true }),
        ])])
      : bloom
    a.start()
    return () => a.stop()
  }, [lit, g, flare, reduce])
  const glowScale = useMemo(() => g.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }), [g])
  const pill = useMemo(() => ({ opacity: s, transform: [{ scaleX: s.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }), [s])
  const off = useMemo(() => ({ opacity: s.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' }) }), [s])
  const on = useMemo(() => ({ opacity: s.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }), transform: [{ scale: s.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }), [s])
  // on the focused pill (itself accentSoft) the disc steps one shade further toward the accent so it still reads
  const glow = focused ? mix(c.accentSoft, c.accent, 0.22) : c.accentSoft
  return (
    // decoration to a screen reader: the tab is named once, by its label (the glyphs read as unnamed images beside it)
    <Animated.View ref={target ? tourRef(target) : undefined} aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ width: 60, height: 32, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: 60, height: 32, borderRadius: 16, backgroundColor: c.accentSoft }, pill]} />
      <Animated.View style={{ position: 'absolute', width: GLOW, height: GLOW, borderRadius: GLOW / 2, backgroundColor: glow, opacity: g, transform: [{ scale: glowScale }] }} />
      {/* wrapped: on web an unpositioned svg would paint under the absolutely positioned pill */}
      <Animated.View style={{ transform: [{ scale: flare }] }}>
        {lit ? <Icon name={name} color={c.accent} size={24} fill /> : (
          <>
            <Animated.View style={off}><Icon name={name} color={c.muted} size={24} /></Animated.View>
            <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, on]}><Icon name={name} color={c.accent} size={24} fill /></Animated.View>
          </>
        )}
      </Animated.View>
    </Animated.View>
  )
}
/**
 * The navigator draws a tab's icon twice (a focused copy and an unfocused one) and snaps between them, and hands each
 * copy a `focused` that never changes; so both copies here follow the route's real focus, and whichever is showing
 * carries the animation. `target`: the guided tour points at this tab (its icon; the spotlight reaches down over the
 * label).
 */
const icon = (name: IconName, focused: boolean, target?: TargetId) => () => <TabIcon name={name} focused={focused} target={target} />

/** The only tab that reads the streak flag, so a flip re-renders this one icon and not the bar. */
function StatsTabIcon({ focused }: { focused: boolean }) {
  const lit = useStreakAlive()
  return <TabIcon name="flame" focused={focused} lit={lit} target="tab-stats" />
}
const statsIcon = (focused: boolean) => () => <StatsTabIcon focused={focused} />

/** The label's muted and accent inks crossfade on the icon's spring, so word and glyph change together. */
function TabLabel({ text, focused }: { text: string; focused: boolean }) {
  const c = useInks()
  const reduce = usePref('reduceMotion')
  const s = useRef(new Animated.Value(focused ? 1 : 0)).current
  useEffect(() => {
    if (reduce) { s.setValue(focused ? 1 : 0); return }
    const a = Animated.spring(s, { toValue: focused ? 1 : 0, ...CONTROL_SPRING, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [focused, s, reduce])
  const off = useMemo(() => [label.text, { color: c.muted, opacity: s.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' }) }], [s, c.muted])
  const on = useMemo(() => [label.text, label.over, { color: c.accent, opacity: s.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }) }], [s, c.accent])
  return (
    <View style={label.box}>
      {/* a fifth of a 320 px phone: past 1.2× system text "Settings" would be cut */}
      <Animated.Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={off}>{text}</Animated.Text>
      <Animated.Text aria-hidden numberOfLines={1} maxFontSizeMultiplier={1.2} style={on}>{text}</Animated.Text>
    </View>
  )
}
const label = StyleSheet.create({
  // the whole fifth of the bar, over the tab's own 5 px padding: "Settings" fits a 320 px phone
  box: { marginTop: 2, alignSelf: 'stretch', marginHorizontal: -5 },
  text: { fontWeight: '600', fontSize: 12, textAlign: 'center' },
  over: { position: 'absolute', left: 0, right: 0, top: 0 },
})
const tab = (title: string, tabBarIcon: (focused: boolean) => () => ReactNode) => ({ navigation }: { navigation: { isFocused: () => boolean } }) => {
  const focused = navigation.isFocused()
  return { title, tabBarIcon: tabBarIcon(focused), tabBarLabel: () => <TabLabel text={title} focused={focused} /> }
}

/** A tab switch's crossfade, as written: at SLOW_TEMPO it plays in 400 ms, one screen giving way to the next. */
const TAB_FADE_MS = 200

/**
 * Web: a tab that is not the open one stays mounted (its state, an instant switch back), and the navigator only fades
 * it to opacity 0; a tab left of the open one is never detached at all. So Home's text was still on the page under
 * Read for a screen reader, find-in-page and anything that reads the page's text. The open tab is the page's `main`;
 * the others are aria-hidden and inert at once, and `visibility: hidden` from the moment their fade-out has played:
 * a CSS transition delay of the crossfade's own length (1 ms under Reduce animation), so no timer, no state and
 * nothing for the navigator's fade to trip on. Coming back, visibility returns at once and the fade-in plays over it.
 * Not `display: none`: that would drop the tab's layout (the reader's measured column, scroll places) on every switch.
 * The role never changes: react-native-web draws `main` as a <main> element, and a role that came and went with focus
 * would swap the element and remount the whole tab under it (the reader fell back to its saved place).
 */
function Scene({ children }: { children: ReactElement }) {
  const focused = useIsFocused()
  const reduce = usePref('reduceMotion')
  usePref('motionSpeed')
  const fadeMs = reduce ? 1 : Math.ceil(scaleMs(TAB_FADE_MS, tempoSpeed(SLOW_TEMPO)))
  const away = { visibility: 'hidden', transitionProperty: 'visibility', transitionDuration: '0s', transitionDelay: `${fadeMs}ms` } as ViewStyle
  return (
    <View role="main" aria-hidden={!focused} {...{ inert: !focused }} style={[scene.fill, focused ? null : away]}>
      {children}
    </View>
  )
}
const scene = StyleSheet.create({ fill: { flex: 1 } })
const sceneLayout = Platform.OS === 'web' ? ({ children }: { children: ReactElement }) => <Scene>{children}</Scene> : undefined

/**
 * The desktop's tab bar (DESKTOP_MIN and up): the same five tabs as a left rail, icons over labels, in the bar colour
 * with a hairline on its right, the way the bottom bar has one on top. Each tab draws the same TabIcon and TabLabel
 * the bottom bar does (the route options carry them), so the pill, the crossfade and the tour's targets are the
 * bottom bar's. Presses go through the navigator's own tabPress event, so a tab tapped again behaves as it does below.
 */
function Rail({ state, descriptors, navigation }: BottomTabBarProps) {
  const c = useInks()
  const insets = useSafeAreaInsets()
  return (
    <View role="tablist" style={[rail.bar, { backgroundColor: c.bar, borderRightColor: c.border, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      {state.routes.map((route, index) => {
        const focused = index === state.index
        const { options } = descriptors[route.key]
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params)
        }
        const title = options.title ?? route.name
        return (
          <Pressable key={route.key} role="tab" aria-label={title} aria-selected={focused} accessibilityState={{ selected: focused }} onPress={onPress}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })} style={rail.tab} testID={options.tabBarButtonTestID}>
            {options.tabBarIcon?.({ focused, color: focused ? c.accent : c.muted, size: 24 })}
            {typeof options.tabBarLabel === 'function' ? options.tabBarLabel({ focused, color: focused ? c.accent : c.muted, position: 'below-icon', children: title }) : <TabLabel text={title} focused={focused} />}
          </Pressable>
        )
      })}
    </View>
  )
}
const rail = StyleSheet.create({
  bar: { width: RAIL_W, borderRightWidth: StyleSheet.hairlineWidth, alignItems: 'stretch', gap: 6 },
  // the icon box is 60 wide; the label runs the tab's width (TabLabel bleeds 5 px over its parent, as on the bar)
  tab: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 5 },
})
const renderRail = (props: BottomTabBarProps) => <Rail {...props} />

export default function TabsLayout() {
  const c = useInks()
  const insets = useSafeAreaInsets()
  const reduce = usePref('reduceMotion')
  const desktop = useDesktop()
  usePref('motionSpeed')
  // A verse opened from a screen outside the tabs (the ministry, Bookmarks, a path) pushes a second set of tabs over
  // that screen. Back there retraces the tabs visited in it and then returns to that screen; the default, the first
  // tab, sent it to Home first. The app's own tabs, at the bottom of the stack, keep Back to Home.
  const navigation = useNavigation()
  const [over] = useState(() => navigation.canGoBack())
  return (
    <Tabs backBehavior={over ? 'history' : 'firstRoute'} tabBar={desktop ? renderRail : undefined} screenLayout={sceneLayout} screenOptions={{
      headerShown: false,
      // from 1024 px the bar stands on the left (Rail); the navigator lays the screens out beside it
      tabBarPosition: desktop ? 'left' : 'bottom',
      freezeOnBlur: true,    // a theme change must not re-render the chapter sitting behind another tab
      tabBarActiveTintColor: c.accent,
      tabBarInactiveTintColor: c.muted,
      // an explicit height: a `height: undefined` here overrode the navigator's computed height with auto, and the
      // bar collapsed to its padding (30 pt on a Pixel) with the icons drawn below the screen edge
      tabBarStyle: { backgroundColor: c.bar, borderTopWidth: 0, elevation: 0, height: Platform.OS === 'web' ? 68 : 60 + insets.bottom, paddingTop: 6 },
      tabBarIconStyle: { width: 60, height: 32 },
      // the label always under the glyph: react-navigation puts it beside the icon on a tablet, where TabLabel lands
      // above it
      tabBarLabelPosition: 'below-icon',
      sceneStyle: { backgroundColor: c.bg },
      // switching tabs crossfades the screens (the navigator's own native-driver fade) instead of cutting. The fade
      // stays on under Reduce animation, at 1 ms: switching `animation` to 'none' while tabs were mounted left a tab
      // that had already faded out at opacity 0 for good (Home and Read showed only the page colour, build 28).
      animation: 'fade',
      // its own tempo (half the written speed), times Animation speed; motion/speed.ts reads `tempo` off the config
      transitionSpec: { animation: 'timing', config: reduce
        ? { duration: 1, easing: Easing.linear, fixedSpeed: true }
        : { duration: TAB_FADE_MS, easing: Easing.out(Easing.cubic), tempo: SLOW_TEMPO } } as never,
    }}>
      <Tabs.Screen name="index" options={tab('Home', f => icon('home', f, 'tab-home'))} />
      <Tabs.Screen name="read" options={tab('Read', f => icon('book', f, 'tab-read'))} />
      <Tabs.Screen name="search" options={tab('Search', f => icon('search', f, 'tab-search'))} />
      <Tabs.Screen name="stats" options={tab('Stats', statsIcon)} />
      <Tabs.Screen name="settings" options={tab('Settings', f => icon('sliders', f, 'tab-settings'))} />
    </Tabs>
  )
}
