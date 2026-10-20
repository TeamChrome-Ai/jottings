import { ScrollView, Text, View } from 'react-native'
import { LANGS, LANG_NAMES, t, tc, type Lang } from '@shared/i18n'
import { TEXTS, TEXT_NAMES, textOf, type BibleText, type BiblePref } from '@shared/texts'
import { deviceLang, type LangPref } from '../i18n'
import { usePrefs } from '../store/prefs'
import { useInks } from '../hooks/useTheme'
import { TYPE, Sheet, T, Tap } from './ui'
import Icon from './Icon'

/**
 * The app's language, the Bible it shows, and a second Bible beside it (docs/LANGUAGES.md), from Settings. Each language
 * and each Bible is named in its own language, so a reader can find theirs whatever the app is in.
 */
export default function LanguageSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, set } = usePrefs()
  const device = deviceLang()
  const lang: Lang = prefs.lang === 'auto' ? device : prefs.lang
  const main = textOf(prefs.bible, lang)
  return (
    <Sheet open={open} onClose={onClose} title={t('Language')}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
        <T small muted>{t('The app’s language')}</T>
        <Pick label={t('As the device ({language})', { language: LANG_NAMES[device] })} on={prefs.lang === 'auto'} onPress={() => set({ lang: 'auto' as LangPref })} />
        {LANGS.map(l => <Pick key={l} label={LANG_NAMES[l]} on={prefs.lang === l} onPress={() => set({ lang: l })} />)}
        <T small muted style={{ marginTop: 14 }}>{t('The Bible')}</T>
        <Pick label={t('With the language ({bible})', { bible: TEXT_NAMES[textOf('auto', lang)] })} on={prefs.bible === 'auto'} onPress={() => set({ bible: 'auto' as BiblePref })} />
        {TEXTS.map(x => <Pick key={x} label={TEXT_NAMES[x]} on={prefs.bible === x} onPress={() => set({ bible: x, bible2: prefs.bible2 === x ? '' : prefs.bible2 })} />)}
        <T small muted style={{ marginTop: 14 }}>{t('Side by side')}</T>
        <Pick label={tc('state', 'Off')} on={!prefs.bible2} onPress={() => set({ bible2: '' })} />
        {TEXTS.filter(x => x !== main).map(x => <Pick key={x} label={TEXT_NAMES[x]} on={prefs.bible2 === x} onPress={() => set({ bible2: x as BibleText })} />)}
        <T small muted style={{ marginTop: 14 }}>{t('Your highlights, notes and reading stay with their verses whichever Bible you read. The ministry is in English.')}</T>
      </ScrollView>
    </Sheet>
  )
}

/** One choice: its name, and a tick when it is the one chosen. */
function Pick({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const c = useInks()
  return (
    <Tap onPress={onPress} scaleTo={0.985} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingVertical: 6, gap: 12 }}>
      <Text style={{ flex: 1, color: c.text, fontSize: TYPE.body, fontWeight: on ? '600' : '400' }}>{label}</Text>
      <View style={{ width: 22 }}>{on ? <Icon name="check" size={20} color={c.accent} /> : null}</View>
    </Tap>
  )
}
