import { useRouter } from 'expo-router'
import { t } from '@shared/i18n'
import { useAssistantOn } from '../lib/assistant'
import { useAuth } from '../store/auth'
import { ListRow } from './ui'

/** Ask's row on Home, while the server has Ask on; signed out, it says Ask needs an account and opens sign-in. */
export default function AskRow() {
  const router = useRouter()
  const on = useAssistantOn()
  const { user } = useAuth()
  if (!on) return null
  return user
    ? <ListRow icon="info" label={t('Ask')} detail={t('Questions on the Bible and the app, answered from the library')} onPress={() => router.push('/ask')} />
    : <ListRow icon="info" label={t('Ask')} detail={t('Needs an account. Sign in to ask')} onPress={() => router.push('/login')} />
}
