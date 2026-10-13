import { Text, View } from 'react-native'
import { isAvatarId } from '@shared/avatars'
import { useColors } from '../hooks/useTheme'
import { face } from '../theme'
import AvatarArt from './AvatarArt'

/**
 * A person's mark: their preset picture (`avatar`, which the server always sends: their choice or the default for
 * their id). The initial on an accent-soft disc stands in only where no picture came with the name (an older server).
 */
export default function Avatar({ name, avatar, size = 40 }: { name: string; avatar?: string | null; size?: number }) {
  const c = useColors()
  if (isAvatarId(avatar)) return <AvatarArt id={avatar} size={size} />
  const initial = (name.trim()[0] ?? '?').toUpperCase()
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c.accent, fontSize: Math.round(size * 0.46), lineHeight: Math.round(size * 0.6), ...face('serif', { bold: true }) }}>{initial}</Text>
    </View>
  )
}
