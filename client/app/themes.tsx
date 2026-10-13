import { Stack } from 'expo-router'
import ThemeGallery from '../src/components/ThemeGallery'
import { Card, Screen, SwitchRow, T } from '../src/components/ui'
import { useThemeDef } from '../src/hooks/useTheme'
import { usePref, usePrefsStore } from '../src/store/prefs'
import { THEME_MAP } from '../src/theme'

export default function ThemesScreen() {
  const { set } = usePrefsStore()
  const following = usePref('theme') === 'system', light = usePref('themeLight'), dark = usePref('themeDark')
  const t = useThemeDef()
  const day = THEME_MAP[light]?.name ?? light
  const night = THEME_MAP[dark]?.name ?? dark
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Themes' }} />
      <T muted>Tap a theme and every screen changes at once. You are reading in {t.name}.</T>
      <Card style={{ gap: 0, paddingVertical: 6 }}>
        <SwitchRow label="Follow the system" hint={`${day} by day, ${night} at night. Tapping a theme sets the pick for its side.`} value={following} onChange={v => set({ theme: v ? 'system' : t.id })} />
      </Card>
      <ThemeGallery />
    </Screen>
  )
}
