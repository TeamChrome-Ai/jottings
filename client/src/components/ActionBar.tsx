import { useRef } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useBottomInset } from '../hooks/useBottomInset'
import { useInks } from '../hooks/useTheme'
import type { HlColor } from './ChapterView'
import Icon from './Icon'
import { Button, Grow, Tap } from './ui'
import { DockedBar } from './motion/reader'
import { tourRef } from '../store/tour'
import { NOUN } from '@shared/brand'

const HL: HlColor[] = ['yellow', 'green', 'blue', 'pink']

/** Selection actions docked to the bottom: springs up when a verse is picked, slides away when cleared. */
export default function ActionBar({ open, label, shortLabel, lift = 0, bookmarked = false, onHighlight, onBookmark, onCopy, onShare, onJot, onListen, onMinistry, onClose }: {
  open: boolean; label: string; /** the same with abbreviated book names, for a phone the swatches leave little room on */ shortLabel?: string; lift?: number; /** every selected verse is already bookmarked, so the action removes */ bookmarked?: boolean; onHighlight: (c: HlColor | null) => void; onBookmark: () => void; onCopy: () => void; onShare: () => void; /** the passage into a jotting, with a note: first after the colours */ onJot: () => void; onListen: () => void
  /** given only when some author wrote on a selected verse: the one action that comes and goes */
  onMinistry?: () => void; onClose: () => void
}) {
  const c = useInks()
  const bottom = useBottomInset()
  // the label empties with the selection; keep the last one while the bar slides out
  const shown = useRef({ label, shortLabel })
  if (label) shown.current = { label, shortLabel }
  // the four swatches, Clear and the close leave a small phone (or large system text) ~40-120 px for the reference
  const { width, fontScale } = useWindowDimensions()
  const tight = width / fontScale < 400
  // Ministry known as the bar opens rises with it; found a moment later (the quiet check), it pops in where it goes.
  // It sits last, on the row Listen already wraps to on a phone, so it never changes the bar's height there.
  const ministryAtOpen = useRef(false)
  const wasOpen = useRef(false)
  if (open && !wasOpen.current) ministryAtOpen.current = !!onMinistry
  wasOpen.current = open
  // like the label, Ministry stays on the bar while it slides out: the selection (and with it onMinistry) empties first
  const lastMinistry = useRef(onMinistry)
  if (open) lastMinistry.current = onMinistry
  const ministryFn = open ? onMinistry : lastMinistry.current
  const ministry = ministryFn ? <Button small title="Ministry" accessibilityLabel={`Ministry on ${shown.current.label}`} onPress={ministryFn} /> : null
  return (
    // docked on top of the player bar (`lift`), it rides down with it when read-aloud stops
    <DockedBar open={open} edge="bottom" lift={lift} style={[styles.bar, { backgroundColor: c.card, borderColor: c.border, paddingBottom: lift ? 10 : Math.max(bottom, 8) }]}>
      <View ref={tourRef('action-colours')} style={styles.row}>
        <Text style={[styles.label, { color: c.text }]} numberOfLines={1} accessibilityLabel={shown.current.label}>{tight && shown.current.shortLabel ? shown.current.shortLabel : shown.current.label}</Text>
        {/* one unit: where the reference would be squeezed under its minimum (a 320 px phone, large system text) the
            colours drop to a line of their own instead of cutting it to "Jo…" */}
        <View style={styles.tools}>
          {/* the swatches arrive with the bar, whose rise is their entrance: a pop staggered after it kept them out of reach for 90-225 ms */}
          {HL.map(h => (
            <Tap key={h} accessibilityRole="button" accessibilityLabel={`Highlight ${h}`} onPress={() => onHighlight(h)} scaleTo={0.86} hitSlop={6} style={[styles.swatch, { backgroundColor: c.hl[h], borderColor: c.border }]} />
          ))}
          <Button small title="Clear" onPress={() => onHighlight(null)} />
          <Tap onPress={onClose} hitSlop={10} scaleTo={0.86} accessibilityRole="button" accessibilityLabel="Deselect" style={styles.close}><Icon name="x" size={20} color={c.muted} /></Tap>
        </View>
      </View>
      <View ref={tourRef('action-buttons')} style={styles.row}>
        <Button small lead="jot" title={NOUN.verb} onPress={onJot} />
        <Button small title="Copy" onPress={onCopy} />
        <Button small title={bookmarked ? 'Remove bookmark' : 'Bookmark'} onPress={onBookmark} />
        <Button small title="Share" onPress={onShare} />
        <Button small title="Listen" onPress={onListen} />
        {ministryFn ? ministryAtOpen.current ? ministry : <Grow from={0.86}>{ministry}</Grow> : null}
      </View>
    </DockedBar>
  )
}
const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 10, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  label: { fontWeight: '700', flexGrow: 1, flexShrink: 1, flexBasis: 56 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
})
