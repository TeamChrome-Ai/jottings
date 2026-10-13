import { memo, useEffect } from 'react'
import { StyleSheet } from 'react-native'
import Animated, { Easing, runOnJS, useAnimatedProps, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import { REVEAL_BANDS, REVEAL_MS, revealBand, type RevealPlan } from '../lib/themeReveal'

export interface RevealProps { plan: RevealPlan; w: number; h: number; onDone: () => void }

const APath = Animated.createAnimatedComponent(Path)
const BANDS = Array.from({ length: REVEAL_BANDS + 1 }, (_, j) => j)

/**
 * The Themes screen's theme change on native (lib/themeReveal.ts): the veil in the old page colour with a soft hole
 * opening from the tap, drawn as even-odd paths rebuilt on the UI thread each frame. The web draws the same with a
 * CSS mask (ThemeReveal.web.tsx).
 */
export default function ThemeReveal({ plan, w, h, onDone }: RevealProps) {
  const t = useSharedValue(0)
  useEffect(() => {
    t.value = withTiming(REVEAL_MS, { duration: REVEAL_MS / plan.speed, easing: Easing.linear }, fin => { if (fin) runOnJS(onDone)() })
    // once per reveal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <Svg width={w} height={h} style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      {BANDS.map(j => <Band key={j} j={j} t={t} plan={plan} w={w} h={h} />)}
    </Svg>
  )
}
const Band = memo(function Band({ j, t, plan, w, h }: { j: number; t: SharedValue<number>; plan: RevealPlan; w: number; h: number }) {
  const props = useAnimatedProps(() => { const b = revealBand(plan, t.value, w, h, j); return { d: b.d, fillOpacity: b.o } })
  return <APath animatedProps={props} fill={plan.from} fillRule="evenodd" />
})
