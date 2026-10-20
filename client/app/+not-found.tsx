import { Link } from 'expo-router'
import { Screen, T } from '../src/components/ui'
import { t } from '@shared/i18n'
export default function NotFound() {
  return <Screen><T>{t('Nothing here.')}</T><Link href="/"><T style={{ textDecorationLine: 'underline' }}>{t('Go home')}</T></Link></Screen>
}
