import { useRouter } from 'expo-router'
import { t } from '@shared/i18n'
import { useAssistantOn } from '../lib/assistant'
import { useAuth } from '../store/auth'
import { Card, ListRow } from './ui'

/** Ask's row on Home and in the ministry library, while the server has Ask on; signed out, it says Ask needs an
 *  account and opens sign-in. `alone`: in a card of its own. */
export default function AskRow({ alone = false }: { alone?: boolean }) {
  const router = useRouter()
  const on = useAssistantOn()
  const { user } = useAuth()
  if (!on) return null
  const row = user
    ? <ListRow icon="info" label={t('Ask')} detail={t('Questions on the Bible and the app, answered from the library')} onPress={() => router.push('/ask')} />
    : <ListRow icon="info" label={t('Ask')} detail={t('Needs an account. Sign in to ask')} onPress={() => router.push('/login')} />
  return alone ? <Card style={{ gap: 0, paddingVertical: 8 }}>{row}</Card> : row
}
