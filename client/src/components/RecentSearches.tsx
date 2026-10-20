import { useState } from 'react'
import { View } from 'react-native'
import { t } from '@shared/i18n'
import { useInks } from '../hooks/useTheme'
import Icon from './Icon'
import { T, Tap } from './ui'

/** Under an empty search field: one quiet line that opens to the last searches. A tap on one searches it again; its
 *  ✕ crosses it off. Nothing at all when there are none. */
export default function RecentSearches({ items, onPick, onRemove }: { items: readonly string[]; onPick: (q: string) => void; onRemove: (q: string) => void }) {
  const c = useInks()
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  return (
    <View>
      <Tap onPress={() => setOpen(o => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={open ? t('Hide recent searches') : t('Recent searches')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, alignSelf: 'flex-start' }}>
        <T small muted>{t('Recent searches')}</T>
        <Icon name={open ? 'up' : 'down'} size={16} color={c.muted} />
      </Tap>
      {open ? items.map(q => (
        <View key={q} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Tap onPress={() => onPick(q)} accessibilityRole="link" accessibilityLabel={t('Search {query}', { query: q })} style={{ flex: 1, paddingVertical: 10 }}>
            <T numberOfLines={1}>{q}</T>
          </Tap>
          <Tap onPress={() => onRemove(q)} hitSlop={10} scaleTo={0.86} accessibilityRole="button" accessibilityLabel={t('Remove {query} from recent searches', { query: q })} style={{ padding: 8 }}>
            <Icon name="x" size={18} color={c.muted} />
          </Tap>
        </View>
      )) : null}
    </View>
  )
}
