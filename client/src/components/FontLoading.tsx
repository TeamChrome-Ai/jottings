import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { useColors } from '../hooks/useTheme'
import { useReduceMotion } from '../store/prefs'
import type { LazyFontState } from '../lib/fonts'

/**
 * Shown over text while a lazily fetched font (OpenDyslexic, an added font) is on its way: the surface dims to a veil
 * and one accent arc turns on a hairline ring, easing in and out of each turn. Nothing to read, nothing to tap;
 * it fades away the moment the faces land. Under Reduce motion the arc stands still.
 */
export default function FontLoading({ state, size = 44 }: { state: LazyFontState; size?: number }) {
  const c = useColors()
  const reduce = useReduceMotion()
  const spin = useRef(new Animated.Value(0)).current
  const veil = useRef(new Animated.Value(0)).current
  const visible = state === 'loading'
  const [shown, setShown] = useState(visible)   // stays mounted through the fade-out
  useEffect(() => {
    if (visible) setShown(true)
    Animated.timing(veil, { toValue: visible ? 1 : 0, duration: visible ? 220 : 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished && !visible) setShown(false) })
    if (!visible || reduce) return
    const turn = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }))
    turn.start()
    return () => { turn.stop(); spin.setValue(0) }
  }, [visible, reduce, spin, veil])
  if (!shown) return null
  const r = (size - 4) / 2, circ = 2 * Math.PI * r
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: c.bg, opacity: veil.interpolate({ inputRange: [0, 1], outputRange: [0, 0.82] }) }]}>
      <Animated.View style={{ width: size, height: size, transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.border} strokeWidth={1.5} fill="none" />
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.accent} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeDasharray={`${circ * 0.28} ${circ}`} />
        </Svg>
      </Animated.View>
    </Animated.View>
  )
}
const styles = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } })
