import { useMemo, useRef, useState } from 'react'
import { Animated, Easing, PanResponder, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n'
import { useColors, useFill } from '../hooks/useTheme'
import { usePrefsStore } from '../store/prefs'
import { PRESS_IN_MS, RELEASE_SPRING } from '../lib/motion'
import { Tap } from './ui'

/** How often a drag may change the pref (the thumb itself moves every frame). */
const DRAG_COMMIT_MS = 120

/** Dependency-free slider (core PanResponder, so no gesture library on any platform): a track with a
 *  draggable thumb plus −/+ steppers for precision. The thumb swells while held and settles back on release; it
 *  follows the finger exactly, never eased behind it. */
export default function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const c = useColors()
  const fill = useFill()
  const [width, setWidth] = useState(1)
  const widthRef = useRef(1)
  const latest = useRef({ onChange, min, max, step })
  latest.current = { onChange, min, max, step }
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  // locationX is relative to the deepest view under the finger, so with interactive children a touch on the
  // thumb read as x≈0 and the value jumped to the minimum. The children below are pointerEvents="none", so on
  // grant locationX is track-relative; the track's page offset is kept from that one event and every move
  // works from pageX, which stays right when the finger wanders off the track.
  const originRef = useRef(0)
  const prefs = usePrefsStore()
  const held = useRef(new Animated.Value(0)).current
  const hold = (on: boolean) => {
    if (prefs.get().reduceMotion) { held.setValue(0); return }
    if (on) Animated.timing(held, { toValue: 1, duration: PRESS_IN_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
    else Animated.spring(held, { toValue: 0, ...RELEASE_SPRING, useNativeDriver: true }).start()
  }
  const grow = useMemo(() => ({ transform: [{ scale: held.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }] }), [held])
  const releaseRef = useRef(() => {})
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: e => { originRef.current = e.nativeEvent.pageX - e.nativeEvent.locationX; update(e.nativeEvent.locationX); hold(true) },
    onPanResponderMove: e => update(e.nativeEvent.pageX - originRef.current),
    onPanResponderRelease: () => releaseRef.current(),
    onPanResponderTerminate: () => releaseRef.current(),
  })).current
  // While the finger moves, the thumb and the number follow it at once from local state; the pref itself (which
  // re-lays out the reader's every word for spacing) changes at most every DRAG_COMMIT_MS and on release. Word
  // spacing dragged the whole chapter through a re-layout per pixel (build 31).
  const [live, setLive] = useState<number | null>(null)
  const liveRef = useRef<number | null>(null)
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commit = (v: number, now: boolean) => {
    liveRef.current = v
    if (now) { if (commitTimer.current) { clearTimeout(commitTimer.current); commitTimer.current = null } latest.current.onChange(v); return }
    if (!commitTimer.current) commitTimer.current = setTimeout(() => { commitTimer.current = null; if (liveRef.current !== null) latest.current.onChange(liveRef.current) }, DRAG_COMMIT_MS)
  }
  function update(x: number) {
    const { min, max, step } = latest.current
    const v = Math.min(max, Math.max(min, Math.round((min + (x / widthRef.current) * (max - min)) / step) * step))
    setLive(v); commit(v, false)
  }
  const release = () => { hold(false); if (liveRef.current !== null) commit(liveRef.current, true); liveRef.current = null; setLive(null) }
  releaseRef.current = release
  const showing = live ?? value
  const pct = (showing - min) / (max - min)
  const shown = format ? format(showing) : String(Math.round(showing * 100) / 100)
  return (
    <View style={{ gap: 6, paddingVertical: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: c.text, fontSize: 16 }}>{label}</Text>
        <Text style={{ color: c.muted, fontSize: 14, fontVariant: ['tabular-nums'] }}>{shown}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Tap accessibilityRole="button" accessibilityLabel={t('{label} smaller', { label })} scaleTo={0.9} onPress={() => onChange(clamp(value - step))} style={[styles.step, { backgroundColor: fill }]}><Text style={{ color: c.text, fontSize: 18 }}>−</Text></Tap>
        <View {...pan.panHandlers} accessibilityRole="adjustable" accessibilityValue={{ min, max, now: value }} onLayout={e => { const w = Math.max(1, e.nativeEvent.layout.width); widthRef.current = w; setWidth(w) }} style={{ flex: 1, height: 32, justifyContent: 'center' }}>
          <View pointerEvents="none" style={{ height: 6, borderRadius: 3, backgroundColor: c.border }} />
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, width: `${pct * 100}%`, height: 6, borderRadius: 3, backgroundColor: c.accent }} />
          <View pointerEvents="none" style={{ position: 'absolute', left: `${pct * 100}%`, marginLeft: -11, width: 22, height: 22 }}>
            <Animated.View style={[{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.accent, borderWidth: 3, borderColor: fill === c.bg ? c.card : c.bg }, grow]} />
          </View>
        </View>
        <Tap accessibilityRole="button" accessibilityLabel={t('{label} larger', { label })} scaleTo={0.9} onPress={() => onChange(clamp(value + step))} style={[styles.step, { backgroundColor: fill }]}><Text style={{ color: c.text, fontSize: 18 }}>+</Text></Tap>
      </View>
      {width < 0 && null}
    </View>
  )
}
const styles = StyleSheet.create({ step: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' } })
