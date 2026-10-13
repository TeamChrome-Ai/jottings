import { useEffect, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { createAudioPlayer, type AudioPlayer } from 'expo-audio'
import { previewAudioUrl, SPEEDS, VOICES, type Pause } from '../lib/tts'
import { usePlayer } from '../store/player'
import { usePrefs } from '../store/prefs'
import { tourRef } from '../store/tour'
import { Button, Segmented, Sheet, SwitchRow, T } from './ui'

/** How read aloud sounds, in one sheet: opened from the player bar and from Settings → Listening. */
export default function ListeningSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, set } = usePrefs()
  const preview = usePreview(open, prefs.ttsVoice)
  const name = VOICES.find(v => v.id === prefs.ttsVoice)?.name ?? prefs.ttsVoice
  return (
    <Sheet open={open} onClose={onClose} title="Listening">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View ref={tourRef('listening-sheet')} style={{ gap: 14 }}>
          <T small muted>Voice</T>
          <Segmented value={prefs.ttsVoice} onChange={ttsVoice => set({ ttsVoice })} options={VOICES.map(v => ({ value: v.id, label: v.name }))} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <T small muted style={{ flexShrink: 1 }}>{VOICES.find(v => v.id === prefs.ttsVoice)?.blurb}</T>
            <Button small lead={preview.playing ? 'pause' : 'play'} title={preview.playing ? 'Stop' : `Hear ${name}`} accessibilityLabel={preview.playing ? `Stop the sample of ${name}` : `Hear a sample of ${name}, Psalm 23`} onPress={preview.toggle} />
          </View>
          <T small muted>AI voices, powered by Speechify</T>
          <T small muted>Speed</T>
          <Segmented value={String(prefs.ttsSpeed)} onChange={s => set({ ttsSpeed: Number(s) })} options={SPEEDS.map(s => ({ value: String(s), label: `${s}×` }))} />
          <T small muted>Pause between verses</T>
          <Segmented<Pause> value={prefs.ttsPause} onChange={ttsPause => set({ ttsPause })} options={[{ value: 'none', label: 'None' }, { value: 'short', label: 'Short' }, { value: 'long', label: 'Long' }]} />
        </View>
        <View>
          <SwitchRow label="Say verse numbers" value={prefs.ttsNumbers} onChange={ttsNumbers => set({ ttsNumbers })} />
          <SwitchRow label="Say the book and chapter" value={prefs.ttsHeading} onChange={ttsHeading => set({ ttsHeading })} />
          <SwitchRow label="Highlight each word" value={prefs.ttsWord} onChange={ttsWord => set({ ttsWord })} />
          <SwitchRow label="Continue into the next chapter" hint="Follows your path while one is on" value={prefs.ttsAutoNext} onChange={ttsAutoNext => set({ ttsAutoNext })} />
          <SwitchRow label="Stop after the selected verse" value={prefs.ttsStopAtSelection} onChange={ttsStopAtSelection => set({ ttsStopAtSelection })} />
          <SwitchRow label="Use the device voice" hint="Reads offline; no word timings" value={prefs.ttsDevice} onChange={ttsDevice => set({ ttsDevice })} />
        </View>
        <T small muted>Voice, speed, numbers and heading apply from the next verse; the rest at once.</T>
        <Button title="Done" primary onPress={onClose} />
      </ScrollView>
    </Sheet>
  )
}

/**
 * The voice sample (Psalm 23:1-3 from the voice's own recording): one small player of its own, so the chapter
 * player's place is untouched. Read aloud pauses where it is; a voice change, the sheet closing or the clip ending
 * stops it. The clip is short, so a stop is a plain pause and the next press starts from the top.
 */
function usePreview(open: boolean, voice: string) {
  const player = useRef<AudioPlayer | null>(null)
  const [playing, setPlaying] = useState(false)
  const reader = usePlayer()
  const stop = () => { player.current?.pause(); setPlaying(false) }
  useEffect(() => { stop() }, [voice, open])
  useEffect(() => () => { player.current?.remove(); player.current = null }, [])
  const toggle = () => {
    if (playing) return stop()
    if (reader.status === 'playing') reader.toggle()   // read aloud pauses where it is; the bar's Play resumes
    player.current?.remove()
    const p = createAudioPlayer({ uri: previewAudioUrl(voice) }, { updateInterval: 250 })
    player.current = p
    const sub = p.addListener('playbackStatusUpdate', st => { if (st.didJustFinish || (!st.playing && st.currentTime > 0 && st.duration > 0 && st.currentTime >= st.duration - 0.1)) { sub.remove(); setPlaying(false) } })
    p.play()
    setPlaying(true)
  }
  return { playing, toggle }
}
