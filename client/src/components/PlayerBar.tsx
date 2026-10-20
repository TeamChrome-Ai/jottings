import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { t, tc } from '@shared/i18n'
import { useBottomInset } from '../hooks/useBottomInset'
import { useInks } from '../hooks/useTheme'
import { formatRef } from '@shared/ref'
import { VOICES } from '../lib/tts'
import { usePlayer } from '../store/player'
import { usePref } from '../store/prefs'
import Icon from './Icon'
import ListeningSheet from './ListeningSheet'
import { Tap } from './ui'
import { DockedBar } from './motion/reader'
import { offerTourControls, tourRef } from '../store/tour'

/**
 * The read-aloud bar under the chapter: what is being read, transport, and the listening settings sheet. Docks when
 * read-aloud starts; slides away when it stops, still showing what it last read while it goes.
 */
export default function PlayerBar({ flatTop = false }: { /** the selection bar is docked on top: square the corners so no page shows through the curve */ flatTop?: boolean }) {
  const c = useInks()
  const bottom = useBottomInset()
  const p = usePlayer()
  return (
    <DockedBar open={p.status !== 'idle'} edge="bottom" onHeight={p.setBarHeight}
      style={[styles.bar, { backgroundColor: c.card, paddingBottom: Math.max(bottom, 10) }, flatTop && styles.flat]}>
      <PlayerBarBody />
    </DockedBar>
  )
}

function PlayerBarBody() {
  const c = useInks()
  const p = usePlayer()
  const ttsVoice = usePref('ttsVoice'), ttsSpeed = usePref('ttsSpeed')
  const [settings, setSettings] = useState(false)
  const setBarHeight = p.setBarHeight
  useEffect(() => () => setBarHeight(0), [setBarHeight])
  // the full tour opens the listening settings to show them
  useEffect(() => offerTourControls('player', { settings: setSettings }), [])
  const voice = VOICES.find(v => v.id === ttsVoice)?.name ?? ttsVoice
  const live = {
    where: p.spoken ? (p.spoken.v === 0 ? formatRef({ book: p.book, chapter: p.chapter }) : formatRef({ book: p.book, chapter: p.chapter, v1: p.spoken.v }, 'abbr')) : formatRef({ book: p.book, chapter: p.chapter }, 'abbr'),
    sub: p.status === 'loading' ? t('Loading…') : p.status === 'error' ? p.error ?? t('Could not play') : p.source === 'device' ? t('Device voice') : `${voice} · ${ttsSpeed}×`,
    error: p.status === 'error', playing: p.status === 'playing',
  }
  // stopped: the bar is on its way out; it keeps the verse and the pause glyph it had rather than flicking to idle
  const last = useRef(live)
  if (p.status !== 'idle') last.current = live
  const { where, sub, error, playing } = last.current
  return (
    <>
      <View ref={tourRef('player-transport')} style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>{where}</Text>
          <Text style={{ color: error ? c.danger : c.muted, fontSize: 12 }} numberOfLines={1}>{sub}</Text>
        </View>
        <Tap onPress={p.prev} accessibilityRole="button" accessibilityLabel={t('Previous verse')} style={styles.ctl}><Icon name="prev" size={26} color={c.text} /></Tap>
        <Tap onPress={p.toggle} accessibilityRole="button" accessibilityLabel={playing ? tc('verb', 'Pause') : tc('verb', 'Play')} style={[styles.main, { backgroundColor: c.accent }]}>
          <Icon name={playing ? 'pause' : 'play'} size={30} color={c.accentText} fill />
        </Tap>
        <Tap onPress={p.next} accessibilityRole="button" accessibilityLabel={t('Next verse')} style={styles.ctl}><Icon name="next" size={26} color={c.text} /></Tap>
        <Tap onPress={() => setSettings(true)} accessibilityRole="button" accessibilityLabel={t('Listening settings')} style={styles.ctl}><Icon name="voice" size={22} color={c.muted} /></Tap>
        <Tap onPress={p.stop} accessibilityRole="button" accessibilityLabel={t('Stop reading')} style={styles.ctl}><Icon name="x" size={22} color={c.muted} /></Tap>
      </View>
      <ListeningSheet open={settings} onClose={() => setSettings(false)} />
    </>
  )
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 14, paddingTop: 10, gap: 8 },
  flat: { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ctl: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  main: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
})
