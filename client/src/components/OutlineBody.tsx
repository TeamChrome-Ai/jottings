import { useEffect, useRef, useState } from 'react'
import { Linking, Pressable, Text, View } from 'react-native'
import type { Outline, OutlineItem } from '@shared/types'
import { formatRef, refKey, type Ref } from '@shared/ref'
import { MAX_DEPTH, itemRef, openRef, type VerseRow } from '../lib/outlines'
import { loadLinkPreview, type LinkPreview } from '../lib/linkPreview'
import { usePlayer } from '../store/player'
import { useToast } from '../store/toast'
import { useColors } from '../hooks/useTheme'
import { T } from './ui'
import Icon from './Icon'
import OutlineVerseText from './OutlineVerseText'
import OutlineNoteText from './OutlineNoteText'
import { Stagger } from './motion/nav'

interface Props { items: OutlineItem[]; style: Outline['print_style']; verses: Map<string, VerseRow[]>; loading: boolean }

/** Items that draw something; a wrapper around an empty one would still take a gap. */
const renders = (it: OutlineItem) => it.kind === 'verse' ? itemRef(it) !== null : it.kind === 'link' ? !!it.url : true

/**
 * Read-only rendering of an item list, honouring the print style. Shared by the id and share-code views.
 * The first items rise in turn after `revealAfter` ms (the title block's entrance), with the list stagger every screen
 * uses; the rest render still.
 */
export default function OutlineBody({ items, style, verses, loading, revealAfter = 0 }: Props & { revealAfter?: number }) {
  return (
    <View style={{ gap: 4 }}>
      {items.filter(renders).map((it, i) => (
        <Stagger key={it.id} index={i} base={revealAfter}><ItemView item={it} style={style} verses={verses} loading={loading} /></Stagger>
      ))}
    </View>
  )
}

function ItemView({ item, style, verses, loading }: { item: OutlineItem } & Omit<Props, 'items'>) {
  const c = useColors()
  const indent = { marginLeft: 16 * Math.min(item.depth, MAX_DEPTH) }
  switch (item.kind) {
    case 'verse': {
      const ref = itemRef(item)
      if (!ref) return null
      const label = formatRef(ref)
      const rows = verses.get(refKey(ref))
      if (style === 'refs-only') return (
        <View style={[indent, ROW, { paddingVertical: 3 }]}>
          <Pressable onPress={() => openRef(ref)} accessibilityRole="link">
            <T style={{ color: c.accent, fontWeight: '600' }}>{label}</T>
          </Pressable>
          <Listen passage={ref} label={label} />
        </View>
      )
      if (style === 'inline') return (
        <View style={[indent, { paddingVertical: 3, flexDirection: 'row', alignItems: 'flex-start', gap: 6 }]}>
          <Text style={{ color: c.text, fontSize: 16, lineHeight: 25, flex: 1 }}>
            <Text style={{ color: c.accent, fontWeight: '600' }} onPress={() => openRef(ref)} accessibilityRole="link">{label}</Text>
            <Text style={{ color: c.muted }}> — </Text>
            <OutlineVerseText rows={rows} loading={loading} />
          </Text>
          <Listen passage={ref} label={label} />
        </View>
      )
      return (
        <View style={[indent, { gap: 3, paddingVertical: 5 }]}>
          <View style={ROW}>
            <Pressable onPress={() => openRef(ref)} accessibilityRole="link">
              <T small style={{ color: c.accent, fontWeight: '600' }}>{label}</T>
            </Pressable>
            <Listen passage={ref} label={label} />
          </View>
          <OutlineVerseText rows={rows} loading={loading} />
        </View>
      )
    }
    case 'note':
      return <View style={[indent, { paddingVertical: 3 }]}><OutlineNoteText text={item.text ?? ''} /></View>
    case 'link': {
      const url = item.url
      if (!url) return null
      return <View style={indent}><LinkItem url={url} text={item.text ?? ''} /></View>
    }
    case 'heading':
      return <T bold style={[indent, { fontSize: 18, marginTop: 10, marginBottom: 2 }]}>{item.text ?? ''}</T>
    default: { const _exhaustive: never = item.kind; return _exhaustive }
  }
}

const ROW = { flexDirection: 'row', alignItems: 'center', gap: 6 } as const

/**
 * The speaker beside a passage: reads those verses aloud and stops (the reader's own voice and speed, no spoken
 * chapter heading), and stops them when tapped again. It is lit while its own passage is being read; another
 * passage started from the same jotting, or the reader, takes the player over and puts it out.
 */
function Listen({ passage, label }: { passage: Ref; label: string }) {
  const c = useColors()
  const player = usePlayer()
  const toast = useToast()
  const [asked, setAsked] = useState(false)
  const v1 = passage.v1 ?? 1, v2 = passage.v2 ?? passage.v1
  const here = player.status !== 'idle' && player.book === passage.book && player.chapter === passage.chapter
  const spoken = player.spoken?.v ?? 0
  // 0 is the moment before the first verse (and the heading): still this passage's
  const mine = here && (spoken === 0 || (spoken >= v1 && (v2 === undefined || spoken <= v2)))
  const was = useRef(player.status)
  useEffect(() => {
    const before = was.current
    was.current = player.status
    if (!asked) return
    if (player.status === 'error') { toast.show(player.error || 'Could not read this aloud'); setAsked(false) }
    // done, stopped, or taken over by another passage
    else if ((player.status === 'idle' && before !== 'idle') || (player.status !== 'idle' && !mine)) setAsked(false)
  }, [asked, mine, player.status, player.error, toast])
  const on = asked && mine
  const press = () => {
    if (on) { player.stop(); setAsked(false); return }
    player.start(passage.book, passage.chapter, v1, { stopAfter: v2 ?? 999, heading: false })
    setAsked(true)
  }
  return (
    <Pressable onPress={press} hitSlop={10} accessibilityRole="button" accessibilityLabel={on ? `Stop reading ${label}` : `Listen to ${label}`} accessibilityState={{ selected: on }}
      style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.accentSoft : 'transparent' }}>
      <Icon name="speaker" size={17} color={on ? c.accent : c.muted} fill={on} />
    </Pressable>
  )
}

/**
 * A link: its own words, and under them what the page says of itself (lib/linkPreview.ts), in words only. Until that
 * arrives, and when there is none, it is the plain link it always was.
 */
function LinkItem({ url, text }: { url: string; text: string }) {
  const c = useColors()
  const [preview, setPreview] = useState<LinkPreview | null>(null)
  useEffect(() => {
    let live = true
    setPreview(null)
    loadLinkPreview(url).then(p => { if (live) setPreview(p) })
    return () => { live = false }
  }, [url])
  const open = () => { Linking.openURL(url).catch(() => {}) }
  const own = text.trim() && text.trim() !== url ? text.trim() : ''
  if (!preview) return (
    <Pressable onPress={open} style={{ paddingVertical: 3 }} accessibilityRole="link">
      <T style={{ color: c.accent, textDecorationLine: 'underline' }}>{own || url}</T>
    </Pressable>
  )
  return (
    <Pressable onPress={open} accessibilityRole="link" accessibilityLabel={`${own || preview.title}, ${preview.host}`} style={{ marginVertical: 4, gap: 3, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
      {own && own !== preview.title ? <T small style={{ color: c.accent, textDecorationLine: 'underline' }}>{own}</T> : null}
      <T bold numberOfLines={2}>{preview.title}</T>
      {preview.description ? <T small muted numberOfLines={3}>{preview.description}</T> : null}
      <T small muted numberOfLines={1} style={{ fontSize: 12 }}>{preview.host}</T>
    </Pressable>
  )
}
