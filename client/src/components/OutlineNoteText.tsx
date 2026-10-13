import { useMemo } from 'react'
import { Linking, Text, type StyleProp, type TextStyle } from 'react-native'
import { openRef, segmentNote } from '../lib/outlines'
import { useReadingFont } from '../hooks/useReadingFont'
import { useColors } from '../hooks/useTheme'

/** Note text in the reader's font, line breaks preserved; scripture references open the reader, bare URLs the browser. */
export default function OutlineNoteText({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const c = useColors()
  const segs = useMemo(() => segmentNote(text), [text])
  const f = useReadingFont(16, 1.5)
  return (
    <Text style={[{ color: c.text, ...f.body }, style]}>
      {segs.map((s, i) => {
        switch (s.kind) {
          case 'text': return <Text key={i}>{s.text}</Text>
          case 'ref': return <Text key={i} style={{ color: c.accent, ...f.bold }} onPress={() => openRef(s.ref)} accessibilityRole="link">{s.text}</Text>
          case 'url': return <Text key={i} style={{ color: c.accent, textDecorationLine: 'underline' }} onPress={() => { Linking.openURL(s.href).catch(() => {}) }} accessibilityRole="link">{s.text}</Text>
          default: { const _exhaustive: never = s; return _exhaustive }
        }
      })}
    </Text>
  )
}
