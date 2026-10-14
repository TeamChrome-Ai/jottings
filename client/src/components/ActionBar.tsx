import { useRef } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useBottomInset } from '../hooks/useBottomInset'
import { useInks } from '../hooks/useTheme'
import { HL_CORE, hlPicker, type HlColor } from '../lib/hlColours'
import { usePref } from '../store/prefs'
import Icon from './Icon'
import { Button, Grow, Tap } from './ui'
import { DockedBar } from './motion/reader'
import { tourRef } from '../store/tour'
import { NOUN } from '@shared/brand'

/** From this width (in the system's text scale) the eight extra colours sit on the first row with the core four;
 *  under it they have a row of their own. All twelve, Clear and the close need ~620 pt beside the shortest reference. */
const EXTRA_INLINE = 640
const EXTRA_ROW = 36
/** How much taller the bar stands for the extra colours' own row: the reading screen pads the chapter's end by it. */
export const extraColoursHeight = (more: boolean, width: number, fontScale: number) => (more && width / fontScale < EXTRA_INLINE ? EXTRA_ROW : 0)

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
  // "More highlight colours": the core four stay where the hand knows them; the eight after them are all in view at
  // once, on a row of their own on a phone (a strip that scrolls would hide some, in a screen whose sideways swipe
  // turns the chapter)
  const more = usePref('moreColours')
  const offered = hlPicker(more), own = extraColoursHeight(more, width, fontScale) > 0
  const first = own ? offered.slice(0, HL_CORE.length) : offered, second = own ? offered.slice(HL_CORE.length) : []
  const swatch = (h: HlColor) => <Tap key={h} accessibilityRole="button" accessibilityLabel={`Highlight ${h}`} onPress={() => onHighlight(h)} scaleTo={0.86} hitSlop={6} style={[styles.swatch, { backgroundColor: c.hl[h], borderColor: c.border }]} />
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
          {first.map(swatch)}
          <Button small title="Clear" onPress={() => onHighlight(null)} />
          <Tap onPress={onClose} hitSlop={10} scaleTo={0.86} accessibilityRole="button" accessibilityLabel="Deselect" style={styles.close}><Icon name="x" size={20} color={c.muted} /></Tap>
        </View>
      </View>
      {second.length ? <View style={styles.extra}>{second.map(swatch)}</View> : null}
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
  // eight across the bar, edge to edge: 16 px apart at 360 px, 10 at 320
  extra: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
})
