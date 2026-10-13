import { useState } from 'react'
import { Linking, View, useWindowDimensions } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useColors } from '../src/hooks/useTheme'
import { GovernorsTable, KingdomCards, KingdomsTable, LinkRow, PersiaTimeline, type Chron } from '../src/components/ChronologyTable'
import { Button, Card, Enter, H, H2, Screen, T } from '../src/components/ui'
import { useEdition } from '../src/lib/edition'
import { hasChronology } from '../src/lib/editionCore'

// shipped in this route's chunk (no network); the server's /api/chronology serves the same file
import chronology from '../../data/ccel/chronology.json'

const d = chronology as Chron
const WIDE = 760

/** The table where the edition has it; a link kept from before (the 1890 edition has none) reads one calm line. */
export default function Chronology() {
  return hasChronology(useEdition()) ? <ChronologyTables /> : <NotInThisEdition />
}

function NotInThisEdition() {
  const router = useRouter()
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Chronology' }} />
      <T muted>The chronological table is not part of this edition of the app.</T>
      <Button title="Back" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/') }} />
    </Screen>
  )
}

/** The 1961 edition's chronological table: two kingdoms side by side, then the governors and the Persian kings. */
function ChronologyTables() {
  const router = useRouter()
  const c = useColors()
  const { width } = useWindowDimensions()
  const [tableW, setTableW] = useState(0)
  const wide = width >= WIDE
  return (
    // one orchestrated moment: the heading rises in; the long table itself is instant
    <Screen animate={false}>
      <Stack.Screen options={{ title: 'Chronology' }} />
      <Enter><H style={{ fontSize: 24, lineHeight: 30 }}>{d.title}</H></Enter>
      <Enter delay={70}><T muted>{d.subtitle}</T></Enter>

      <H2>Kings and prophets</H2>
      {wide ? (
        <View onLayout={e => setTableW(e.nativeEvent.layout.width)}>{tableW > 0 ? <KingdomsTable rows={d.kingdoms.rows} width={tableW} /> : null}</View>
      ) : <KingdomCards rows={d.kingdoms.rows} />}

      <View style={{ flexDirection: wide ? 'row' : 'column', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: wide ? 1 : undefined, alignSelf: 'stretch', gap: 6 }}>
          <T bold serif style={{ fontSize: 17 }}>{d.governors.title}</T>
          <GovernorsTable rows={d.governors.rows} />
        </View>
        <View style={{ flex: wide ? 1 : undefined, alignSelf: 'stretch', gap: 6 }}>
          <T bold serif style={{ fontSize: 17 }}>{d.persia.title}</T>
          <PersiaTimeline rows={d.persia.rows} />
        </View>
      </View>

      <Card>
        <LinkRow title="About this translation" hint="Introductory notices and the note on the chronological dates" onPress={() => router.push('/about')} />
      </Card>
      <T small muted>
        Source: {d.source.replace(/,? via .*$/, '')}, via <T small style={{ color: c.accent, textDecorationLine: 'underline' }} accessibilityRole="link" onPress={() => { Linking.openURL('https://www.ccel.org/bible/jnd/darby.htm').catch(() => {}) }}>ccel.org</T>
      </T>
      <Button title="Back" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/') }} />
      <View style={{ height: 24 }} />
    </Screen>
  )
}
