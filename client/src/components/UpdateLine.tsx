import { Text, View } from 'react-native'
import { t } from '@shared/i18n'
import { tr } from '../i18n'
import { useInks } from '../hooks/useTheme'
import { dismissStoreUpdate, openStore, useStoreUpdate } from '../lib/storeUpdate'
import Icon from './Icon'
import { Tap, TYPE } from './ui'

/**
 * Home's last line, once Google Play offers this phone a newer version (lib/storeUpdateCore.ts): in the text's ink
 * with Update in the accent, at the foot of the page, and closed for that version by its ×. Nothing pops up and
 * nothing notifies.
 */
export default function UpdateLine() {
  const c = useInks()
  const code = useStoreUpdate()
  if (!code) return null
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4 }}>
      <Text style={{ flex: 1, color: c.text, fontSize: TYPE.small }}>
        {tr('A newer version is on Google Play. <a>Update</a>', { a: s => <Text accessibilityRole="link" style={{ color: c.accent, fontWeight: '600', textDecorationLine: 'underline' }} onPress={openStore}>{s}</Text> })}
      </Text>
      <Tap onPress={() => dismissStoreUpdate(code)} accessibilityRole="button" aria-label={t('Hide until the next version')} hitSlop={12}>
        <Icon name="x" size={16} color={c.muted} />
      </Tap>
    </View>
  )
}

/** The Settings footer's name and version, with "update available" after it on the same terms as Home's line (and
 *  still there when that line was closed). */
export function VersionLine({ text }: { text: string }) {
  const c = useInks()
  const code = useStoreUpdate(true)
  return (
    <Text style={{ color: c.muted, fontSize: TYPE.small, textAlign: 'center' }}>
      {text}
      {code ? <>{' · '}<Text accessibilityRole="link" style={{ color: c.accent, textDecorationLine: 'underline' }} onPress={openStore}>{t('update available')}</Text></> : null}
    </Text>
  )
}
