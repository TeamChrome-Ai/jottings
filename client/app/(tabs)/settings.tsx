import { VOICES } from '../../src/lib/tts'
import { useCallback, useState } from 'react'
import { Platform, Text, View } from 'react-native'
import { face } from '../../src/theme'
import { useRouter } from 'expo-router'
import { getApiBase } from '../../src/lib/api'
import * as Linking from 'expo-linking'
import Constants from 'expo-constants'
import { VersionLine } from '../../src/components/UpdateLine'
import ListeningSheet from '../../src/components/ListeningSheet'
import LanguageSheet from '../../src/components/LanguageSheet'
import { peekText } from '../../src/lib/text'
import AvatarArt from '../../src/components/AvatarArt'
import { useAuth } from '../../src/store/auth'
import { adminMode } from '../../src/lib/community'
import { policyPath } from '../../src/lib/credits'
import { AdminBadge } from '../../src/components/CommunityBits'
import { usePref, usePrefs } from '../../src/store/prefs'
import { useToast } from '../../src/store/toast'
import { tourRef } from '../../src/store/tour'
import { useThemeDef, useInkFill, useInks } from '../../src/hooks/useTheme'
import { Button, Card, H, H2, ListRow, Row, Screen, T } from '../../src/components/ui'
import Icon from '../../src/components/Icon'
import SignInCard from '../../src/components/SignInCard'
import { PAGE_TITLE, RESET_HINT, cards, type Facts, type IndexSheet, type Open } from '../../src/lib/settingsIndex'
import { BRAND } from '@shared/brand'
import { peekLang, t } from '@shared/i18n'

/** Letters, not a word: the Text row's sample of the reader's font. */
const FONT_SAMPLE = 'Aa'

/** Settings: the account, then every group of settings as a row saying how it is set; each opens its page, the themes or a sheet. */
export default function Settings() {
  const router = useRouter()
  const { user } = useAuth()
  const { prefs, reset } = usePrefs()
  const toast = useToast()
  const c = useInks()
  const theme = useThemeDef()
  const [sheet, setSheet] = useState<IndexSheet | null>(null)
  const close = useCallback(() => setSheet(null), [])

  const siteBase = () => getApiBase() || (Platform.OS === 'web' && typeof location !== 'undefined' ? location.origin : '')
  // a new language or Bible remounts every screen (app/_layout.tsx), so the ones this one was mounted with are current
  const facts: Facts = { prefs, signedIn: !!user, native: Platform.OS !== 'web', themeName: theme.name, voiceName: VOICES.find(v => v.id === prefs.ttsVoice)?.name ?? prefs.ttsVoice, lang: peekLang(), text: peekText() }
  const open = (o: Open) => o.kind === 'sheet' ? setSheet(o.sheet) : router.push(o.kind === 'themes' ? '/themes' : `/settings/${o.page}`)
  return (
    <Screen safeTop>
      <H>{t('Settings')}</H>

      {user ? (
        <Card ref={tourRef('settings-account')} onPress={() => router.push('/settings/account')} accessibilityLabel={`${user.display_name}, ${t(PAGE_TITLE.account)}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <AvatarArt id={user.avatar} userId={user.id} size={48} />
          <View style={{ flex: 1, minWidth: 0 }}><T bold numberOfLines={1}>{user.display_name}</T><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><T small muted numberOfLines={1} style={{ flexShrink: 1 }}>@{user.handle}</T>{adminMode(user) ? <AdminBadge /> : null}</View></View>
          <Icon name="chevron" color={c.muted} size={20} />
        </Card>
      ) : (
        <SignInCard ref={tourRef('settings-account')} title={t('Not signed in')} text={t('Sign in to sync bookmarks, keep a streak and join groups.')} />
      )}

      {cards(facts).map(rows => (
        <Card key={rows[0].id} style={{ gap: 0, paddingVertical: 8 }}>
          {rows.map(g => <ListRow key={g.id} ref={g.target ? tourRef(g.target) : undefined} label={t(g.title)} detail={g.summary(facts)} onPress={() => open(g.open)}
            icon={'icon' in g.mark ? g.mark.icon : undefined} lead={'sample' in g.mark ? <Sample of={g.mark.sample} /> : undefined} />)}
        </Card>
      ))}

      <H2 hint={t(RESET_HINT)}>{t('Reset')}</H2>
      <Card ref={tourRef('settings-reset')}>
        <Button title={t('Reset all settings')} onPress={() => { reset(); toast.show(t('Settings reset')) }} style={{ alignSelf: 'flex-start' }} small />
      </Card>

      <View style={{ alignItems: 'center', gap: 10, marginTop: 8 }}>
        <VersionLine text={`${BRAND.fullName} ${Constants.expoConfig?.version ?? ''}`} />
        <Row style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button small title={t('Privacy policy')} onPress={() => Linking.openURL(`${siteBase()}${policyPath('/privacy')}`)} />
          <Button small title={t('Terms')} onPress={() => Linking.openURL(`${siteBase()}/terms`)} />
          <Button small title={t('Copyright')} onPress={() => Linking.openURL(`${siteBase()}/copyright`)} />
        </Row>
      </View>
      <ListeningSheet open={sheet === 'listening'} onClose={close} />
      <LanguageSheet open={sheet === 'language'} onClose={close} />
    </Screen>
  )
}

/** In place of a row's icon: "Aa" in the reader's font, or the theme's page with its accent "1" (the gallery's tile, small). */
function Sample({ of }: { of: 'font' | 'theme' }) {
  const c = useInks()
  const fill = useInkFill()
  const theme = useThemeDef()
  const font = usePref('font')
  if (of === 'font') return (
    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c.accent, fontSize: 17, ...face(font, { bold: true }) }}>{FONT_SAMPLE}</Text>
    </View>
  )
  return (
    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: theme.accent, fontSize: 20, lineHeight: 24, ...face('serif', { bold: true }) }}>1</Text>
    </View>
  )
}
