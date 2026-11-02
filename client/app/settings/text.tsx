import { useCallback, useState } from 'react'
import { Text, View, useWindowDimensions } from 'react-native'
import { TEXT_FIT, face } from '../../src/theme'
import { lineFactor, lineTight } from '../../src/lib/lineHeight'
import { useLazyFontState } from '../../src/lib/fonts'
import FontLoading from '../../src/components/FontLoading'
import AddFontSheet from '../../src/components/AddFontSheet'
import { TEXT_SAMPLE } from '@shared/texts'
import { peekText } from '../../src/lib/text'
import { customKey, type CustomFont } from '../../src/lib/customFonts'
import { BUILT_IN_FONTS } from '../../src/lib/settingsIndex'
import { FONT_MAX, FONT_MIN, usePrefs, usePrefsStore, type Font } from '../../src/store/prefs'
import { useToast } from '../../src/store/toast'
import { removeCustomFont } from '../../src/lib/addFont'
import { useInks } from '../../src/hooks/useTheme'
import Slider from '../../src/components/Slider'
import { Button, Card, Screen, Segmented, T, Tap, TYPE } from '../../src/components/ui'
import Disclosure from '../../src/components/Disclosure'
import Icon from '../../src/components/Icon'
import { t } from '@shared/i18n'

const LINE_MIN = 1.2, LINE_MAX = 2.4
const PREVIEW_PAD = 16
/** Two lines at the largest size and loosest leading; smaller settings show more lines in the same box. */
const PREVIEW_H = Math.ceil(2 * FONT_MAX * LINE_MAX) + 2 * PREVIEW_PAD

/** Settings → Text: the preview, the font, size, line height and spacing. */
export default function TextSettings() {
  const { fontScale } = useWindowDimensions()
  const { prefs, set } = usePrefs()
  const store = usePrefsStore()
  const fontState = useLazyFontState(prefs.font)
  const toast = useToast()
  const c = useInks()
  const [adding, setAdding] = useState(false)
  const close = useCallback(() => setAdding(false), [])
  const fs = prefs.fontSize
  // up to two added fonts join the built-in choices; more than that get a list of their own under them
  const listFonts = prefs.customFonts.length > 2
  const fontOptions: { value: Font; label: string }[] = [...BUILT_IN_FONTS.map(f => ({ ...f, label: t(f.label) })), ...(listFonts ? [] : prefs.customFonts.map(f => ({ value: customKey(f.id), label: f.name })))]
  // the system's text size scales the preview's lines too: count whole lines at the size they are drawn
  const previewLine = fs * lineFactor(prefs.font, prefs.lineHeight)
  // the slider keeps its range (the sans goes to 1.2 whole); a font with deeper descenders is laid out at its floor and says so
  const lineHeld = lineTight(prefs.font, prefs.lineHeight)
  const spacing = prefs.letterSpacing || prefs.wordSpacing ? t('{letters} em letters, {words} em words', { letters: prefs.letterSpacing.toFixed(2), words: prefs.wordSpacing.toFixed(2) }) : t('As set by the font')
  return (
    <Screen>
      <Card style={{ gap: 14 }}>
        {/* one height for every setting, so the sliders below never move under the finger */}
        <View accessibilityLabel={t('Preview of the reading text')} accessibilityState={{ busy: fontState === 'loading' }} style={{ backgroundColor: c.bg, borderRadius: 14, padding: PREVIEW_PAD, height: PREVIEW_H, overflow: 'hidden' }}>
          <Text numberOfLines={Math.max(1, Math.floor((PREVIEW_H - 2 * PREVIEW_PAD) / (previewLine * fontScale)))}
            style={{ color: c.text, fontSize: fs, lineHeight: previewLine, letterSpacing: fs * prefs.letterSpacing, ...face(prefs.font), ...TEXT_FIT }}>
            {TEXT_SAMPLE[peekText()].map((verse, i) => (
              <Text key={i}><Text style={{ color: c.accent, fontSize: fs * 0.6, ...face('sans', { bold: true }) }}>{i + 1} </Text>{verse}{i < 2 ? ' ' : ''}</Text>
            ))}
          </Text>
          <FontLoading state={fontState} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Segmented<Font> value={prefs.font} onChange={font => set({ font })} options={fontOptions} />
          </View>
          <Button small iconName="add" title={prefs.customFonts.length ? t('Fonts') : t('Add a font')} accessibilityLabel={prefs.customFonts.length ? t('Your fonts: add or remove') : t('Add a font')} onPress={() => setAdding(true)} style={{ marginTop: 4 }} />
        </View>
        {listFonts ? <CustomFontList value={prefs.font} fonts={prefs.customFonts} onChange={font => set({ font })} onRemove={f => { removeCustomFont(store, f); toast.show(t('{name} removed', { name: f.name })) }} /> : null}
        {prefs.customFonts.length && !listFonts ? <T small muted>{t('Added fonts can be removed under Fonts.')}</T> : null}
        <Slider label={t('Text size')} value={prefs.fontSize} min={FONT_MIN} max={FONT_MAX} step={1} onChange={v => set({ fontSize: v })} format={v => `${v} px`} />
        <Slider label={t('Line height')} value={prefs.lineHeight} min={LINE_MIN} max={LINE_MAX} step={0.05} onChange={v => set({ lineHeight: v })} format={v => v.toFixed(2)} />
        {lineHeld ? <T small muted style={{ marginTop: -8 }}>{t('Tighter than the font allows: shown at {n}, the least that keeps its letters whole.', { n: lineFactor(prefs.font, prefs.lineHeight).toFixed(2) })}</T> : null}
        <Disclosure label={t('Letter and word spacing')} detail={spacing}>
          <Slider label={t('Letter spacing')} value={prefs.letterSpacing} min={0} max={0.15} step={0.01} onChange={v => set({ letterSpacing: v })} format={v => `${v.toFixed(2)} em`} />
          <Slider label={t('Word spacing')} value={prefs.wordSpacing} min={0} max={0.5} step={0.02} onChange={v => set({ wordSpacing: v })} format={v => `${v.toFixed(2)} em`} />
        </Disclosure>
      </Card>
      <AddFontSheet open={adding} onClose={close} />
    </Screen>
  )
}

/** Added fonts past the second: one compact radio row each, under the font choice. */
function CustomFontList({ value, fonts, onChange, onRemove }: { value: Font; fonts: CustomFont[]; onChange: (f: Font) => void; onRemove: (f: CustomFont) => void }) {
  const c = useInks()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('Your fonts')} style={{ gap: 2 }}>
      {fonts.map(f => {
        const key = customKey(f.id), on = value === key
        return (
          <Tap key={f.id} onPress={() => onChange(key)} scaleTo={0.985} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={f.name}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: on ? c.accentSoft : 'transparent' }}>
            <Text numberOfLines={1} style={{ flex: 1, color: c.text, fontSize: TYPE.small, fontWeight: '600' }}>{f.name}</Text>
            {on ? <Icon name="check" size={16} color={c.accent} /> : null}
            <Tap onPress={() => onRemove(f)} accessibilityRole="button" accessibilityLabel={t('Remove {name}', { name: f.name })} hitSlop={8} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="x" size={16} color={c.muted} />
            </Tap>
          </Tap>
        )
      })}
    </View>
  )
}
