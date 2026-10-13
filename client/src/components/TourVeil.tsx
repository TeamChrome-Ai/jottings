import { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import { easeOut, glideMs, lerpHole, veilPath, type Hole } from '../lib/tour'

const APath = Animated.createAnimatedComponent(Path)

/**
 * The tour's veil: the sheet scrim over the whole screen with a rounded spotlight cut out. When the spotlight moves it
 * glides there with the pager's easing; the path is rebuilt on the UI thread each frame. Instant under Reduce
 * animation. Draws only; touches are the tour's to handle.
 */
export default function TourVeil({ hole, W, H, color, reduce }: { hole: Hole; W: number; H: number; color: string; reduce: boolean }) {
  const from = useSharedValue<Hole>(hole), to = useSharedValue<Hole>(hole), t = useSharedValue(1)
  useEffect(() => {
    const cur = lerpHole(from.value, to.value, easeOut(t.value))
    from.value = cur
    to.value = hole
    t.value = 0
    t.value = reduce ? 1 : withTiming(1, { duration: glideMs(cur, hole, { x: 0, y: 0, w: W, h: H }), easing: Easing.linear })
  }, [hole, reduce, W, H, from, to, t])
  const props = useAnimatedProps(() => ({ d: veilPath(W, H, lerpHole(from.value, to.value, easeOut(t.value))) }))
  return (
    <Svg width={W} height={H} style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <APath animatedProps={props} fill={color} fillRule="evenodd" />
    </Svg>
  )
}
