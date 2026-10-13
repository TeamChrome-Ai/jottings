import { Text, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { formatRef } from '@shared/ref'
import { BUILT_BY, PLAYTESTERS, TEMPLE_REF, WITH_HELP_FROM } from '../src/lib/acknowledgments'
import { useColors } from '../src/hooks/useTheme'
import { face } from '../src/theme'
import { PopIn } from '../src/components/motion/nav'
import { Card, Enter, H, H2, Screen, T, TYPE } from '../src/components/ui'
import { BRAND } from '@shared/brand'

/** The people behind the app, a word that nothing is for sale, and a one-line thank-you. Send feedback sits beside this
 * screen's row under Settings → About. */
export default function AcknowledgmentsScreen() {
  const c = useColors()
  const name = { color: c.text, fontSize: TYPE.hero, ...face('serif', { bold: true }) }
  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title: 'Acknowledgments' }} />
      <Enter><H>Acknowledgments</H></Enter>
      <Enter delay={60}>
        <Text style={{ color: c.text, fontSize: TYPE.heading, lineHeight: 28, ...face('serif') }}>
          {BRAND.name} was made for readers of J. N. Darby’s New Translation, to keep his text and every one of his notes close at hand.
        </Text>
      </Enter>

      <Enter delay={120}>
        <Card style={{ gap: 16 }}>
          <View style={{ gap: 2 }}>
            <T small muted>Built by</T>
            <Text style={name}>{BUILT_BY}</Text>
          </View>
          <View style={{ gap: 2 }}>
            <T small muted>With help from</T>
            {WITH_HELP_FROM.map(n => <Text key={n} style={name}>{n}</Text>)}
          </View>
        </Card>
      </Enter>

      <Enter delay={180} style={{ gap: 12 }}>
        <H2 hint="They read the early builds and said what was wrong, kindly.">Playtesters</H2>
        <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 0, rowGap: 10 }}>
          {PLAYTESTERS.map((n, i) => (
            // the names follow their card in: timed from its entrance (180), not from mount behind it
            <PopIn key={n} index={i} cap={PLAYTESTERS.length} step={24} base={180} style={{ width: '50%', paddingRight: 8 }}>
              <Text style={{ color: c.text, fontSize: 17, lineHeight: 24, ...face('serif') }}>{n}</Text>
            </PopIn>
          ))}
        </Card>
      </Enter>

      <Enter delay={240}>
        <SupportNote />
      </Enter>

      <Enter delay={300}>
        <Text style={{ color: c.text, fontSize: TYPE.heading, lineHeight: 28, marginTop: 8, ...face('serif') }}>
          Thank you for reading with {BRAND.name}.
        </Text>
      </Enter>
    </Screen>
  )
}

/**
 * One muted sentence: no ads, nothing for sale, nothing to give. "never will" quietly opens Mark 11:15-17 (the money
 * changers); the reference itself is not printed. There is no way to pay anywhere in the app.
 */
function SupportNote() {
  const c = useColors()
  const router = useRouter()
  const r = TEMPLE_REF
  const label = formatRef(r)
  const read = () => router.push({ pathname: '/read/[book]/[chapter]', params: { book: String(r.book), chapter: String(r.chapter), v: String(r.v1), v2: String(r.v2) } })
  return (
    <Text style={{ color: c.muted, fontSize: TYPE.small, lineHeight: 21, marginTop: 8 }}>
      {BRAND.name} has no ads and <Text accessibilityRole="link" accessibilityLabel={`Read ${label}`} onPress={read} style={{ textDecorationLine: 'underline' }}>never will</Text>, and nothing in it is for sale. There is nothing you need to give.
    </Text>
  )
}
