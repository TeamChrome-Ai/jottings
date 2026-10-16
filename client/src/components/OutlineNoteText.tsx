import { useEffect, useMemo, useState } from 'react'
import { Linking, Text, type StyleProp, type TextStyle } from 'react-native'
import { formatRef, type Ref } from '@shared/ref'
import { openRef, segmentNote, type NoteSegment } from '../lib/outlines'
import { quoteCandidates } from '../lib/noteLinks'
import { findQuote, openMinistry } from '../lib/noteLookup'
import { authorShown } from '../lib/editionCore'
import { useEdition } from '../lib/edition'
import { useReadingFont } from '../hooks/useReadingFont'
import { useColors } from '../hooks/useTheme'

type Found = { start: number; end: number; ref: Ref }

/**
 * Note text in the reader's font, line breaks preserved. Linked as the reader wrote it: scripture references (in lower
 * case too) open the reader, ministry named ("JND on John 3", "Mr. Coates") opens that ministry, bare URLs the browser,
 * and a line of scripture written out, once found in the text, opens its verse, with the reference beside it.
 */
export default function OutlineNoteText({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const c = useColors()
  const edition = useEdition()
  const segs = useMemo(() => segmentNote(text, a => authorShown(a, edition)), [text, edition])
  const f = useReadingFont(16, 1.5)
  // where each segment sits in the text, so quotations are looked for only in the plain runs
  const placed = useMemo(() => { let at = 0; return segs.map(s => { const start = at; at += s.text.length; return { s, start } }) }, [segs])
  const [found, setFound] = useState<{ text: string; spans: Found[] } | null>(null)
  useEffect(() => {
    let live = true
    const taken = placed.filter(p => p.s.kind !== 'text').map(p => ({ start: p.start, end: p.start + p.s.text.length }))
    const cands = quoteCandidates(text, taken)
    if (!cands.length) { setFound(null); return }
    void Promise.all(cands.map(q => findQuote(q.text).then(ref => (ref ? { start: q.start, end: q.end, ref } : null)))).then(r => {
      if (live) setFound({ text, spans: r.filter((x): x is Found => x !== null) })
    })
    return () => { live = false }
  }, [text, placed])
  const quotes = found && found.text === text ? found.spans : []
  const link = { color: c.accent, ...f.bold }

  const plain = (s: string, start: number, key: string) => {
    const inside = quotes.filter(q => q.start >= start && q.end <= start + s.length)
    if (!inside.length) return <Text key={key}>{s}</Text>
    const parts: React.ReactNode[] = []
    let at = start
    inside.forEach((q, i) => {
      if (q.start > at) parts.push(<Text key={`${key}t${i}`}>{text.slice(at, q.start)}</Text>)
      parts.push(<Text key={`${key}q${i}`} style={{ color: c.accent }} onPress={() => openRef(q.ref)} accessibilityRole="link" accessibilityHint={formatRef(q.ref)}>{text.slice(q.start, q.end)}</Text>)
      parts.push(<Text key={`${key}r${i}`} style={{ color: c.muted, fontSize: 13 }} onPress={() => openRef(q.ref)}>{` (${formatRef(q.ref)})`}</Text>)
      at = q.end
    })
    if (at < start + s.length) parts.push(<Text key={`${key}e`}>{text.slice(at, start + s.length)}</Text>)
    return <Text key={key}>{parts}</Text>
  }
  const one = (s: NoteSegment, start: number, i: number) => {
    switch (s.kind) {
      case 'text': return plain(s.text, start, String(i))
      case 'ref': return <Text key={i} style={link} onPress={() => openRef(s.ref)} accessibilityRole="link">{s.text}</Text>
      case 'ministry': return <Text key={i} style={link} onPress={() => { void openMinistry(s.target) }} accessibilityRole="link">{s.text}</Text>
      case 'url': return <Text key={i} style={{ color: c.accent, textDecorationLine: 'underline' }} onPress={() => { Linking.openURL(s.href).catch(() => {}) }} accessibilityRole="link">{s.text}</Text>
      default: { const _exhaustive: never = s; return _exhaustive }
    }
  }
  return <Text style={[{ color: c.text, ...f.body }, style]}>{placed.map(({ s, start }, i) => one(s, start, i))}</Text>
}
