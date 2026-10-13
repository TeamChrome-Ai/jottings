import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Animated, Easing, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { useThemeDef } from '../hooks/useTheme'
import { useReduceMotion } from '../store/prefs'
import { blend, planVeil, veilAt, veilMs, type Veil } from '../lib/themeFade'
import { planReveal, revealShown, type Pt, type RevealPlan } from '../lib/themeReveal'
import { motionSpeed, scaleMs } from '../lib/motionSpeed'

/**
 * The theme change: a veil in the old page colour over the already re-drawn screen, dissolving in at most 220 ms
 * (lib/themeFade.ts). It goes up in the same commit as the new colours, so no frame ever shows the new theme bare
 * before the veil, and it starts part-way (`veilStart`), so no frame is a blank page. A change picked on the Themes
 * screen or in the reader's theme sheet instead blooms out from the tapped swatch (`revealThemeFrom`,
 * lib/themeReveal.ts). The root layout mounts one for the app; every open sheet mounts one over its own panel,
 * because a sheet is a Modal (its own window on Android) that the root veil cannot reach. Under Reduce animation the
 * plain change is instant and a revealed one is the calm crossfade.
 */
let skip: { id: string; until: number } | null = null
/**
 * The change to `id` is already covered (the tour's theme blob): no veil for it. A time limit, not a one-shot flag,
 * because the root and every open sheet each see the change.
 */
export function skipThemeVeil(id: string) { skip = { id, until: Date.now() + 1000 } }

export type VeilHost = 'root' | 'sheet'
let reveal: { id: string; at: Pt; host: VeilHost; until: number } | null = null
/** The change to `id` blooms from `at` (window coordinates) in the `host` veil: the root's, or the open sheet's. */
export function revealThemeFrom(id: string, at: Pt, host: VeilHost) { reveal = { id, at, host, until: Date.now() + 1000 } }

type Shown = { kind: 'veil'; veil: Veil; value: Animated.Value } | { kind: 'reveal'; plan: RevealPlan; w: number; h: number }

/** The bloom's code (Reanimated on the phone) loads when a theme picker first shows (ThemeGallery), not at launch; a
 *  change asked for before it is in gets the plain veil. */
let ThemeReveal: typeof import('./ThemeReveal').default | null = null
let revealLoad: Promise<void> | null = null
export function preloadThemeReveal() {
  revealLoad ??= import('./ThemeReveal').then(m => { ThemeReveal = m.default }, () => { revealLoad = null })
}

export default function ThemeVeil({ radius, host = 'root' }: { radius?: number; host?: VeilHost }) {
  const t = useThemeDef()
  const reduce = useReduceMotion()
  const [seen, setSeen] = useState(t)
  const [shown, setShown] = useState<Shown | null>(null)
  // where this veil sits in the window, and its size: a reveal's origin arrives in window coordinates
  const box = useRef({ x: 0, y: 0, w: 0, h: 0 })
  const probe = useRef<View>(null)
  const measure = useCallback(() => {
    probe.current?.measureInWindow((x, y, w, h) => { if (w > 0) box.current = { x, y, w, h } })
  }, [])
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    box.current.w = e.nativeEvent.layout.width; box.current.h = e.nativeEvent.layout.height
    measure()
    // a sheet lays out while it is still rising: measure again once it has come to rest
    if (settle.current) clearTimeout(settle.current)
    settle.current = setTimeout(measure, 900)
  }, [measure])
  useLayoutEffect(() => () => { if (settle.current) clearTimeout(settle.current) }, [])
  // derived during render, so the veil and the new colours land in one commit
  if (seen.id !== t.id) {
    setSeen(t)
    const now = Date.now(), speed = motionSpeed()
    const r = reveal && reveal.id === t.id && now < reveal.until ? reveal : null
    const skipped = skip !== null && skip.id === t.id && now < skip.until
    // what the screen shows at this moment: the old page, or wherever a veil still running has got to
    const from = !shown ? seen.bg
      : shown.kind === 'veil' ? blend(shown.veil.to, shown.veil.from, veilAt(shown.veil.a0, (now - shown.veil.at) * shown.veil.speed))
      : revealShown(shown.plan, now, shown.w, shown.h)
    let next: Shown | null = null
    if (r && !ThemeReveal) preloadThemeReveal()
    if (!skipped && r && r.host === host && !reduce && box.current.w > 0 && ThemeReveal) {
      const { x, y, w, h } = box.current
      next = { kind: 'reveal', plan: planReveal({ x: r.at.x - x, y: r.at.y - y }, w, h, from, t.bg, now, speed), w, h }
    } else if (!skipped && (!reduce || r)) {
      const v = planVeil(from, t.bg, now, null, speed)
      next = v ? { kind: 'veil', veil: v, value: new Animated.Value(v.a0) } : null
    }
    setShown(next)
  }
  const done = useCallback((s: Shown) => setShown(v => (v === s ? null : v)), [])
  const el = useRef<View>(null)
  useLayoutEffect(() => {
    if (!shown || shown.kind !== 'veil') return
    const { veil, value } = shown
    if (Platform.OS === 'web') {
      // the web has no native driver: a Web Animation on opacity runs on the compositor, clear of the re-render
      const node = el.current as unknown as HTMLElement | null
      const a = node?.animate?.([{ opacity: veil.a0 }, { opacity: 0 }], { duration: scaleMs(veilMs(veil.a0), veil.speed), easing: 'cubic-bezier(0.33, 1, 0.68, 1)', fill: 'forwards' })
      if (!a) { done(shown); return }
      a.onfinish = () => done(shown)
      return () => a.cancel()
    }
    const a = Animated.timing(value, { toValue: 0, duration: veilMs(veil.a0), easing: Easing.out(Easing.cubic), useNativeDriver: true })
    a.start(({ finished }) => { if (finished) done(shown) })
    return () => a.stop()
  }, [shown, done])
  const round = radius ? { borderTopLeftRadius: radius, borderTopRightRadius: radius } : null
  let layer = null
  if (shown?.kind === 'reveal' && ThemeReveal) {
    layer = (
      <View key={shown.plan.at} pointerEvents="none" style={[StyleSheet.absoluteFill, round, { overflow: 'hidden' }]}>
        <ThemeReveal plan={shown.plan} w={shown.w} h={shown.h} onDone={() => done(shown)} />
      </View>
    )
  } else if (shown?.kind === 'veil') {
    const { veil } = shown
    layer = Platform.OS === 'web'
      ? <View key={veil.at} ref={el} pointerEvents="none" style={[StyleSheet.absoluteFill, round, { backgroundColor: veil.from, opacity: veil.a0 }]} />
      : <Animated.View key={veil.at} pointerEvents="none" style={[StyleSheet.absoluteFill, round, { backgroundColor: veil.from, opacity: shown.value }]} />
  }
  return (
    <>
      <View ref={probe} onLayout={onLayout} pointerEvents="none" style={StyleSheet.absoluteFill} />
      {layer}
    </>
  )
}
