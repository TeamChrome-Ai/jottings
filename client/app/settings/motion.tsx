import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, Easing } from 'react-native'
import { SPEED_MAX, SPEED_MIN, SPEED_STEP } from '../../src/lib/motionSpeed'
import { usePref, usePrefs } from '../../src/store/prefs'
import Slider from '../../src/components/Slider'
import { Card, Screen, SwitchRow, T } from '../../src/components/ui'
import { t } from '@shared/i18n'

/** Settings → Motion: Reduce animation, and the speed of every motion while it is off. */
export default function MotionSettings() {
  const { prefs, set } = usePrefs()
  return (
    <Screen>
      <Card style={{ gap: 0, paddingVertical: 8 }}>
        <SwitchRow label={t('Reduce animation')} hint={t('Switch chapters and screens instantly')} value={prefs.reduceMotion} onChange={reduceMotion => set({ reduceMotion })} />
        <Dimmed off={prefs.reduceMotion}>
          <Slider label={t('Animation speed')} value={prefs.motionSpeed} min={SPEED_MIN} max={SPEED_MAX} step={SPEED_STEP} onChange={motionSpeed => set({ motionSpeed })} format={v => `${v.toFixed(1)}×`} />
          <T small muted>{prefs.reduceMotion ? t('Off while Reduce animation is on') : t('For every motion in the app')}</T>
        </Dimmed>
      </Card>
    </Screen>
  )
}

/** A block that fades to a hint of itself and takes no touches while `off`. */
function Dimmed({ off, children }: { off: boolean; children: ReactNode }) {
  const reduce = usePref('reduceMotion')
  const v = useRef(new Animated.Value(off ? 0.4 : 1)).current
  useEffect(() => {
    const a = Animated.timing(v, { toValue: off ? 0.4 : 1, duration: reduce ? 0 : 200, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [off, reduce, v])
  return <Animated.View pointerEvents={off ? 'none' : 'auto'} style={{ opacity: v, paddingBottom: 8 }}>{children}</Animated.View>
}
