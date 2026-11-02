import { useCallback, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import FeedbackSheet from '../../src/components/FeedbackSheet'
import { playWelcome } from '../../src/store/welcome'
import { startTour } from '../../src/store/tour'
import { useEdition } from '../../src/lib/edition'
import { hasChronology } from '../../src/lib/editionCore'
import { Card, ListRow, Screen, Sheet } from '../../src/components/ui'
import { BRAND } from '@shared/brand'
import { t } from '@shared/i18n'

/** Settings → About: the translation's notices, credits, the people behind the app, feedback, and the welcome and tour. */
export default function AboutSettings() {
  const edition = useEdition()
  const router = useRouter()
  const [sheet, setSheet] = useState<'feedback' | 'again' | null>(null)
  const close = useCallback(() => setSheet(null), [])
  return (
    <Screen>
      <Card style={{ gap: 0, paddingVertical: 8 }}>
        <ListRow icon="info" label={t('About the translation')} detail={hasChronology(edition) ? t('Darby’s introductory notices and note on dates') : t('Darby’s introductory notices')} onPress={() => router.push('/about')} />
        <ListRow icon="list" label={t('Credits and licences')} detail={t('Sources, fonts, icons and open-source software')} onPress={() => router.push('/credits')} />
        <ListRow icon="heart" label={t('Acknowledgments')} detail={t('The people behind {name}', { name: BRAND.name })} onPress={() => router.push('/acknowledgments')} />
        <ListRow icon="feedback" label={t('Send feedback')} detail={t('A fault, a wish or a kind word')} onPress={() => setSheet('feedback')} />
        <ListRow icon="play" label={t('Welcome and tour')} detail={t('Play them again, to show someone')} onPress={() => setSheet('again')} />
      </Card>
      <FeedbackSheet open={sheet === 'feedback'} onClose={close} />
      <AgainSheet open={sheet === 'again'} onClose={close} />
    </Screen>
  )
}

/** Settings → About → Welcome and tour: the welcome or the full tour, each after the sheet has gone and this page with it
 * (the tour moves between tabs, which it does from the tabs, not from a page pushed over them). The short tour runs on a
 * new device from the welcome; the full one starts with its six steps. */
function AgainSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const after = (go: () => void) => { onClose(); setTimeout(() => { if (router.canDismiss()) router.dismissAll(); go() }, 280) }
  return (
    <Sheet open={open} onClose={onClose} title={t('Welcome and tour')}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <ListRow icon="play" label={t('Welcome')} detail={t('The opening page and first steps')} onPress={() => after(playWelcome)} />
        <ListRow icon="info" label={t('Full tour')} detail={t('Every screen and sheet, one step at a time')} onPress={() => after(() => startTour(null, true))} />
      </View>
    </Sheet>
  )
}
