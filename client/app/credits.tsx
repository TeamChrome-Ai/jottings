import { useState } from 'react'
import { Linking, Platform, ScrollView, Text, View } from 'react-native'
import { Stack } from 'expo-router'
import { OFL_TEXT, OPENDYSLEXIC_OFL_NOTICE, POLICY_LINKS, creditsFootnote, creditsFor } from '../src/lib/credits'
import { getApiBase } from '../src/lib/api'
import { useEdition } from '../src/lib/edition'
import type { Meta1890 } from '../src/lib/editionCore'
import { NEUTERED } from '../src/lib/buildFlags'
import meta1890 from '../public/bible1890/meta.json'
import { useColors } from '../src/hooks/useTheme'
import { Button, Card, Enter, H, H2, Screen, Sheet, T, Tap } from '../src/components/ui'
import { BRAND } from '@shared/brand'

// the policy pages are static files on the site; on the web the site is this origin
const siteBase = () => getApiBase() || (Platform.OS === 'web' && typeof location !== 'undefined' ? location.origin : '')

/** Who made what, and under which licence. The same list is published at /credits.html on the web. */
export default function CreditsScreen() {
  const c = useColors()
  const [ofl, setOfl] = useState(false)
  // a neutered build (docs/EDITION.md, "Production build") carries the 1890 material only, whatever the server serves
  const live = useEdition()
  const edition = NEUTERED ? '1890' : live
  const credits = creditsFor(edition, (meta1890 as Meta1890).text)
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Credits' }} />
      <Enter><H>Credits and licences</H></Enter>
      <T muted>{BRAND.name} is built on the work of others. Everything that is not ours is listed here with its licence.</T>
      {credits.map(section => (
        <View key={section.title} style={{ gap: 10 }}>
          <H2>{section.title}</H2>
          {section.items.map(item => (
            <Card key={item.name} style={{ gap: 4 }}>
              {item.url
                ? <Tap onPress={() => { Linking.openURL(item.url!).catch(() => {}) }} accessibilityRole="link" haptic={false}><Text style={{ color: c.accent, fontSize: 16, fontWeight: '600' }}>{item.name}</Text></Tap>
                : <T bold>{item.name}</T>}
              <T small>{item.what}</T>
              {item.licenceUrl
                ? <Tap onPress={() => { Linking.openURL(item.licenceUrl!).catch(() => {}) }} accessibilityRole="link" haptic={false}><T small muted>Licence: <T small style={{ color: c.accent, textDecorationLine: 'underline' }}>{item.licence}</T></T></Tap>
                : <T small muted>Licence: {item.licence}</T>}
              {item.note ? <T small muted>{item.note}</T> : null}
              {item.licence.startsWith('SIL Open Font') ? <Button small title="Read the Open Font License" onPress={() => setOfl(true)} style={{ alignSelf: 'flex-start', marginTop: 4 }} /> : null}
            </Card>
          ))}
        </View>
      ))}
      <T small muted>{creditsFootnote(edition)}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        {POLICY_LINKS.map(l => <T key={l.path} small style={{ color: c.accent, textDecorationLine: 'underline' }} accessibilityRole="link" onPress={() => { Linking.openURL(`${siteBase()}${l.path}`).catch(() => {}) }}>{l.label}</T>)}
      </View>
      <Sheet open={ofl} onClose={() => setOfl(false)} title="SIL Open Font License 1.1" maxHeight="85%">
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>OpenDyslexic’s notice: {OPENDYSLEXIC_OFL_NOTICE}</Text>
          <Text style={{ color: c.text, fontSize: 13, lineHeight: 19, fontFamily: 'monospace' }}>{OFL_TEXT}</Text>
        </ScrollView>
      </Sheet>
    </Screen>
  )
}
