import { Platform } from 'react-native'
import { Redirect } from 'expo-router'
import OfflineSection from '../../src/components/OfflineSection'
import { Screen } from '../../src/components/ui'

/** Settings → Offline: what is on the phone. The web keeps its HTTP cache and has no such page. */
export default function OfflineSettings() {
  if (Platform.OS === 'web') return <Redirect href="/settings" />
  return <Screen><OfflineSection /></Screen>
}
