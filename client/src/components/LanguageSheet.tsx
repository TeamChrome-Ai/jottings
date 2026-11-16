import { Fragment } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { LANGS, LANG_NAMES, t, tc, type Lang } from '@shared/i18n'
import { TEXTS, TEXT_LANG, TEXT_NAMES, secondText, textOf, type BibleText, type BiblePref } from '@shared/texts'
import { deviceLang, type LangPref } from '../i18n'
import { usePrefs } from '../store/prefs'
import { useInks } from '../hooks/useTheme'
import { TYPE, Sheet, T, Tap } from './ui'
import Icon from './Icon'

/** The Bibles of `list` under the language each is in, in the list's order: Darby's English first, then the English
 *  Bibles read beside it, then the other languages' own. */
function byLanguage(list: readonly BibleText[]): { lang: Lang; texts: BibleText[] }[] {
  const out: { lang: Lang; texts: BibleText[] }[] = []
  for (const x of list) {
    const last = out[out.length - 1]
    if (last && last.lang === TEXT_LANG[x]) last.texts.push(x)
    else out.push({ lang: TEXT_LANG[x], texts: [x] })
  }
  return out
}

/**
 * The app's language, the Bible it shows, and a second Bible beside it (docs/LANGUAGES.md), from Settings. Each language
 * is named in its own language, and each Bible stands under its language, so a reader can find theirs whatever the app
 * is in. Only the Bibles of this build are listed (@shared/texts TEXTS).
 */
export default function LanguageSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, set } = usePrefs()
  const device = deviceLang()
  const lang: Lang = prefs.lang === 'auto' ? device : prefs.lang
  const main = textOf(prefs.bible, lang)
  // a Bible chosen and since left out of the build is not read: the language's own is, as with none chosen
  const chosen = prefs.bible !== 'auto' && TEXTS.includes(prefs.bible) ? prefs.bible : 'auto'
  const second = secondText(prefs.bible2)
  return (
    <Sheet open={open} onClose={onClose} title={t('Language')}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
        <T small muted>{t('The app’s language')}</T>
        <Pick label={t('As the device ({language})', { language: LANG_NAMES[device] })} on={prefs.lang === 'auto'} onPress={() => set({ lang: 'auto' as LangPref })} />
        {LANGS.map(l => <Pick key={l} label={LANG_NAMES[l]} on={prefs.lang === l} onPress={() => set({ lang: l })} />)}
        <T small muted style={{ marginTop: 14 }}>{t('The Bible')}</T>
        <Pick label={t('With the language ({bible})', { bible: t(TEXT_NAMES[textOf('auto', lang)]) })} on={chosen === 'auto'} onPress={() => set({ bible: 'auto' as BiblePref })} />
        {byLanguage(TEXTS).map(g => (
          <Fragment key={g.lang}>
            <Under lang={g.lang} />
            {g.texts.map(x => <Pick key={x} label={t(TEXT_NAMES[x])} on={chosen === x} onPress={() => set({ bible: x, bible2: prefs.bible2 === x ? '' : prefs.bible2 })} />)}
          </Fragment>
        ))}
        <T small muted style={{ marginTop: 14 }}>{t('Side by side')}</T>
        <Pick label={tc('state', 'Off')} on={!second} onPress={() => set({ bible2: '' })} />
        {byLanguage(TEXTS.filter(x => x !== main)).map(g => (
          <Fragment key={g.lang}>
            <Under lang={g.lang} />
            {g.texts.map(x => <Pick key={x} label={t(TEXT_NAMES[x])} on={second === x} onPress={() => set({ bible2: x })} />)}
          </Fragment>
        ))}
        <T small muted style={{ marginTop: 14 }}>{t('Your highlights, notes and reading stay with their verses whichever Bible you read. The ministry is in English.')}</T>
      </ScrollView>
    </Sheet>
  )
}

/** The language a run of Bibles is in, over them: in its own name, as the languages above are. */
function Under({ lang }: { lang: Lang }) {
  const c = useInks()
  return <Text accessibilityRole="header" style={{ color: c.muted, fontSize: TYPE.caption, marginTop: 6 }}>{LANG_NAMES[lang]}</Text>
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
