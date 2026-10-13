import { memo, useId, useMemo } from 'react'
import { View } from 'react-native'
import Svg, { Circle, ClipPath, Defs, G, Path } from 'react-native-svg'
import { avatarFor, avatarRoleColours } from '@shared/avatars'
import { useColors } from '../hooks/useTheme'

/**
 * A preset profile picture (shared/avatars.ts) in the theme's own roles, clipped to a circle. `id` is the user's
 * choice; without a valid one it falls back to the default for `userId`. Decorative: the name beside it is the label.
 */
function AvatarArt({ id, size, userId }: { id: string | null | undefined; size: number; userId?: number }) {
  const c = useColors()
  const colours = useMemo(() => avatarRoleColours(c), [c])
  // clipPath ids are document-wide on the web, so each instance gets its own
  const clip = 'avatar' + useId().replace(/[^A-Za-z0-9_-]/g, '')
  const art = avatarFor({ id: userId ?? 0, avatar: id })
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Defs>
          <ClipPath id={clip}>
            <Circle cx={32} cy={32} r={32} />
          </ClipPath>
        </Defs>
        <G clipPath={`url(#${clip})`}>
          {art.shapes.map((s, i) => <Path key={i} d={s.d} fill={colours[s.role]} fillOpacity={s.opacity} />)}
        </G>
      </Svg>
    </View>
  )
}

export default memo(AvatarArt)
