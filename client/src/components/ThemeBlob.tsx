import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { BLOB_FADE_MS, BLOB_MS, blobAt, type BlobPlan } from '../lib/blob'

export interface BlobProps { plan: BlobPlan; bg: string; border: string; accent: string; onCovered: () => void; onDone: () => void }

/**
 * The tour's theme change (lib/blob.ts): the new page colour flies from the swatch to the middle of the screen and
 * spreads over it; `onCovered` applies the theme underneath, then it fades. Native: every frame on the UI thread.
 */
export default function ThemeBlob({ plan, bg, border, accent, onCovered, onDone }: BlobProps) {
  const t = useSharedValue(0), fade = useSharedValue(1)
  useEffect(() => {
    const uncover = () => {
      // two frames for the new theme's first render to land under the cover, then let it show
      requestAnimationFrame(() => requestAnimationFrame(() => {
        fade.value = withTiming(0, { duration: BLOB_FADE_MS, easing: Easing.out(Easing.cubic) }, done => { if (done) runOnJS(onDone)() })
      }))
    }
    const covered = () => { onCovered(); uncover() }
    t.value = withTiming(BLOB_MS.spread, { duration: BLOB_MS.spread, easing: Easing.linear }, done => { if (done) runOnJS(covered)() })
    // once per blob
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const s = plan.size, c = plan.cover
  const blob = useAnimatedStyle(() => {
    const f = blobAt(plan, t.value)
    return { opacity: f.blob, transform: [{ translateX: f.x - s / 2 }, { translateY: f.y - s / 2 }, { rotate: `${f.angle}rad` }, { scaleX: f.along }, { scaleY: f.across }] }
  })
  const core = useAnimatedStyle(() => ({ opacity: blobAt(plan, t.value).core }))
  const disc = useAnimatedStyle(() => {
    const r = blobAt(plan, t.value).spread
    return { opacity: r > 0 ? fade.value : 0, transform: [{ scale: r / c }] }
  })
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <Animated.View style={[{ position: 'absolute', left: plan.to.x - c, top: plan.to.y - c, width: 2 * c, height: 2 * c, borderRadius: c, backgroundColor: bg }, disc]} />
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: s, height: s, borderRadius: s / 2, backgroundColor: bg, borderWidth: 1, borderColor: border, alignItems: 'center', justifyContent: 'center' }, blob]}>
        <Animated.View style={[{ width: s * 0.36, height: s * 0.36, borderRadius: s * 0.18, backgroundColor: accent }, core]} />
      </Animated.View>
    </View>
  )
}
