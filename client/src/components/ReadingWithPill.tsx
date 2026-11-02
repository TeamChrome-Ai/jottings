import { Text, View } from 'react-native'
import type { Group } from '@shared/types'
import { t } from '@shared/i18n'
import { useInks } from '../hooks/useTheme'
import { setReadingWith, useReadingWith } from '../store/readingWith'
import Icon from './Icon'
import { ListRow, Sheet, T, Tap, TYPE } from './ui'

/**
 * "Reading with Luca ×": the reader's standing notice that chapters go to a group's shared log (store/readingWith.ts),
 * in SkipPill's quiet form, on its own row under the toolbar so it covers no text and leaves the verse index's edge
 * alone. One tap on the whole pill turns it off; the More sheet's "Read with…" turns it on again.
 */
export default function ReadingWithPill() {
  const c = useInks()
  const with_ = useReadingWith()
  if (!with_) return null
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, alignItems: 'flex-start' }}>
      <Tap onPress={() => setReadingWith(null)} hitSlop={10} scaleTo={0.94} accessibilityRole="button" accessibilityLabel={t('Stop reading with {group}', { group: with_.name })}
        style={{ height: 28, paddingLeft: 12, paddingRight: 8, borderRadius: 14, backgroundColor: c.card, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ color: c.muted, fontSize: TYPE.caption, fontWeight: '600' }}>{t('Reading with {group}', { group: with_.name })}</Text>
        <Icon name="x" size={14} color={c.muted} />
      </Tap>
    </View>
  )
}

/** The reader's groups to read with; the one on is ticked, and choosing it again leaves it on. */
export function ReadWithSheet({ open, groups, onClose }: { open: boolean; groups: readonly Group[]; onClose: () => void }) {
  const with_ = useReadingWith()
  return (
    <Sheet open={open} onClose={onClose} title={t('Read with…')}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <T small muted style={{ paddingBottom: 6 }}>{t('Chapters go to the group’s log; your minutes still count for you.')}</T>
        {groups.map(g => <ListRow key={g.id} label={g.name} icon={with_?.groupId === g.id ? 'check' : 'users'} onPress={() => { setReadingWith({ groupId: g.id, name: g.name, slug: g.slug }); onClose() }} />)}
      </View>
    </Sheet>
  )
}
