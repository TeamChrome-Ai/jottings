import { Text } from 'react-native'
import type { MinistryItem } from '@shared/ministry'
import { useReadingFont } from '../hooks/useReadingFont'
import { useInks } from '../hooks/useTheme'
import { Tap, TYPE } from './ui'

export default function MinistryItemRow({ item, byline, divided, onPress, testID }: { item: MinistryItem; byline?: string; divided: boolean; onPress: () => void; testID?: string }) {
  const c = useInks()
  const f = useReadingFont(17, 1.3)
  const q = useReadingFont(16, 1.5)
  const [a, b] = item.hl
  const work = item.work.collection === 'synopsis' ? `Synopsis · ${item.work.title}` : item.work.title
  const where = byline ? `${byline} · ${work}` : work
  const label = [where, item.section].filter(Boolean).join(', ')
  return (
    <Tap onPress={onPress} scaleTo={0.985} accessibilityRole="link" accessibilityLabel={`${label}: ${item.snippet}`} testID={testID}
      style={{ paddingVertical: 12, gap: 4, borderTopWidth: divided ? 1 : 0, borderTopColor: c.border }}>
      <Text numberOfLines={1} style={{ color: c.muted, fontSize: TYPE.small }}>{where}</Text>
      {item.section ? <Text numberOfLines={2} style={{ color: c.text, ...f.body, ...f.bold }}>{item.section}</Text> : null}
      <Text style={{ color: c.text, ...q.body }}>
        {item.snippet.slice(0, a)}
        {b > a ? <Text testID={testID ? `${testID}-words` : undefined} style={{ color: c.accent, ...q.bold }}>{item.snippet.slice(a, b)}</Text> : null}
        {item.snippet.slice(b)}
      </Text>
    </Tap>
  )
}
