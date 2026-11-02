import { View, useWindowDimensions } from 'react-native'
import { usePrefs, type Align, type Width } from '../../src/store/prefs'
import type { NoteLetters } from '../../src/lib/noteLetters'
import { Card, Screen, Segmented, SwitchRow, T } from '../../src/components/ui'
import { t, tc } from '@shared/i18n'

/** Settings → Page: what the chapter shows besides its words, and on a wide screen where the page sits. */
export default function PageSettings() {
  const { width: windowW } = useWindowDimensions()
  const wideScreen = windowW >= 600   // position and width only bite on tablets and the web
  const { prefs, set } = usePrefs()
  return (
    <Screen>
      <Card style={{ gap: 0, paddingVertical: 8 }}>
        <SwitchRow label={t('Paragraphs')} hint={prefs.paragraphs ? t('On: verses run together in paragraphs') : t('Off: every verse starts on its own line')} value={prefs.paragraphs} onChange={paragraphs => set({ paragraphs })} />
        <SwitchRow label={t('Verse numbers')} value={prefs.verseNumbers} onChange={verseNumbers => set({ verseNumbers })} />
        <SwitchRow label={t('Footnote markers')} value={prefs.showNotes} onChange={showNotes => set({ showNotes })} />
        {prefs.showNotes ? (
          <View style={{ gap: 6, paddingVertical: 10 }}>
            <T>{t('Footnote letters')}</T>
            <T small muted>{prefs.noteLetters === 'chapter' ? t('a, b, c … once through each chapter') : t('As the 1961 edition prints them: they start again on each of its pages, so a chapter can have two a’s')}</T>
            <Segmented<NoteLetters> value={prefs.noteLetters} onChange={noteLetters => set({ noteLetters })} options={[{ value: 'chapter', label: t('Through the chapter') }, { value: 'printed', label: t('As printed') }]} />
          </View>
        ) : null}
        <SwitchRow label={t('More highlight colours')} hint={t('Eight more colours when you tap a verse')} value={prefs.moreColours} onChange={moreColours => set({ moreColours })} />
        {wideScreen ? (
          <View style={{ gap: 6, paddingVertical: 10 }}>
            <T>{t('Width and position')}</T>
            <T small muted>{t('Where the page sits on a wide screen, and how wide it may grow.')}</T>
            <Segmented<Align> value={prefs.align} onChange={align => set({ align })} options={[{ value: 'left', label: tc('align', 'Left') }, { value: 'center', label: tc('align', 'Centre') }, { value: 'right', label: tc('align', 'Right') }]} />
            <Segmented<Width> value={prefs.width} onChange={width => set({ width })} options={[{ value: 'narrow', label: tc('width', 'Narrow') }, { value: 'medium', label: tc('width', 'Medium') }, { value: 'wide', label: tc('width', 'Wide') }, { value: 'full', label: tc('width', 'Full') }]} />
          </View>
        ) : null}
      </Card>
    </Screen>
  )
}
