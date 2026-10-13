import { Stack } from 'expo-router'
import { useInks } from '../../../src/hooks/useTheme'

/** The reader's own stack: its cards are the page colour, so nothing lighter shows while a chapter screen loads. */
export default function ReadLayout() {
  const c = useInks()
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }} />
}
