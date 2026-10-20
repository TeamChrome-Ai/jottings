import { Animated, Text, type StyleProp, type ViewStyle } from 'react-native'
import { t } from '@shared/i18n'
import { useInks } from '../hooks/useTheme'
import { Tap, TYPE } from './ui'

/**
 * The quiet way out of the welcome and the tour: a small muted pill, easy to hit (hit slop 14) but never competing
 * with what is being shown. `style` places it and may carry an animated opacity.
 */
export default function SkipPill({ onPress, label, style }: { onPress: () => void; label: string; style?: StyleProp<Animated.WithAnimatedValue<ViewStyle>> }) {
  const c = useInks()
  return (
    <Animated.View style={style}>
      <Tap onPress={onPress} hitSlop={14} scaleTo={0.94} accessibilityRole="button" accessibilityLabel={label}
        style={{ height: 28, paddingHorizontal: 12, borderRadius: 14, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: c.muted, fontSize: TYPE.caption, fontWeight: '600' }}>{t('Skip')}</Text>
      </Tap>
    </Animated.View>
  )
}
