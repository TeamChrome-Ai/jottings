import { Stack } from 'expo-router'
import ThemeGallery from '../src/components/ThemeGallery'
import { Card, Screen, SwitchRow, T } from '../src/components/ui'
import { useThemeDef } from '../src/hooks/useTheme'
import { usePref, usePrefsStore } from '../src/store/prefs'
import { THEME_MAP } from '../src/theme'
import { t } from '@shared/i18n'

export default function ThemesScreen() {
  const { set } = usePrefsStore()
  const following = usePref('theme') === 'system', light = usePref('themeLight'), dark = usePref('themeDark')
  const theme = useThemeDef()
  const day = THEME_MAP[light]?.name ?? light
  const night = THEME_MAP[dark]?.name ?? dark
  return (
    <Screen>
      <Stack.Screen options={{ title: t('Themes') }} />
      <T muted>{t('Tap a theme and every screen changes at once. You are reading in {name}.', { name: theme.name })}</T>
      <Card style={{ gap: 0, paddingVertical: 6 }}>
        <SwitchRow label={t('Follow the system')} hint={t('{day} by day, {night} at night. Tapping a theme sets the pick for its side.', { day, night })} value={following} onChange={v => set({ theme: v ? 'system' : theme.id })} />
      </Card>
      <ThemeGallery />
    </Screen>
  )
}
