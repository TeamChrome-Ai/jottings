import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, ScrollView, StyleSheet, Text, View, type DimensionValue } from 'react-native'
import type { Outline } from '@shared/types'
import { formatRef, refKey } from '@shared/ref'
import { t, tn } from '@shared/i18n'
import { fmtDateLong, itemRef, paperById, type PrintSettings, type VerseRow } from '../lib/outlines'
import { layoutPrintPreview, type BarTone, type PreviewItem, type PreviewPage, type PreviewPiece } from '../lib/printPreview'
import { useColors } from '../hooks/useTheme'
import { useReduceMotion } from '../store/prefs'
import { alpha, face } from '../theme'
import { Enter, Grow, RADIUS, SPACE, TYPE } from './ui'
import { FadeSwap, STAGGER_CAP, STAGGER_STEP } from './motion/nav'
import { SNAP_SPRING } from '../lib/motionTiming'

interface Props { outline: Outline; verses: Map<string, VerseRow[]>; settings: PrintSettings }

/** Tallest a page is drawn; smaller when two facing pages would not fit the sheet. */
const PAGE_MAX_H = 232
/** Gap between facing pages, and between one spread and the next. */
const SPINE = 4
const SPREAD_GAP = SPACE.l
const CAPTION_H = 20
/** Height the preview takes in the sheet, pages and caption, so a placeholder can hold its place. */
export const PREVIEW_H = PAGE_MAX_H + SPACE.m + CAPTION_H
/** Pages drawn; the rest are counted on a closing tile. */
const MAX_PAGES = 12
/** Ink strength of each bar over the page, as an alpha of the theme's text colour. */
const INK: Record<BarTone, number> = { title: 0.5, heading: 0.42, ref: 0.34, verse: 0.2, note: 0.13, meta: 0.13, rule: 0.2 }
/** Entrance timing: the first open waits for the pages to grow in; a re-flow starts at once and runs quicker. */
const OPEN = { base: 160, step: STAGGER_STEP, page: 60 }
const REFLOW = { base: 0, step: 14, page: 30 }

const pct = (n: number): DimensionValue => `${n * 100}%`

/**
 * A layout sketch of the printed outline: pages as tonal cards, lines as grey bars, flowed by the same paper, margin,
 * font size, columns and style the print uses (lib/printPreview.ts). Changing a setting re-flows the bars.
 */
export default function PrintLayoutPreview({ outline, verses, settings }: Props) {
  const c = useColors()
  const reduce = useReduceMotion()
  const [width, setWidth] = useState(0)
  const paper = paperById(settings.paper)

  const items = useMemo<PreviewItem[]>(() => (outline.items ?? []).flatMap((it): PreviewItem[] => {
    switch (it.kind) {
      case 'verse': {
        const ref = itemRef(it)
        if (!ref) return []
        const rows = verses.get(refKey(ref))
        const text = rows ? rows.length ? rows.map(r => rows.length > 1 ? `${r.v} ${r.t}` : r.t).join(' ') : t('No text found for this reference.') : null
        return [{ kind: 'verse', depth: it.depth, label: formatRef(ref), text }]
      }
      case 'link': return it.url ? [{ kind: 'link', depth: it.depth, text: it.text || it.url }] : []
      case 'heading': case 'note': return [{ kind: it.kind, depth: it.depth, text: it.text ?? '' }]
      default: { const _x: never = it.kind; return _x }
    }
  }), [outline.items, verses])

  const layout = useMemo(() => layoutPrintPreview({
    title: outline.title,
    meta: [outline.owner_handle ? `@${outline.owner_handle}` : '', fmtDateLong(outline.updated_at), 'Darby'].filter(Boolean).join(' · '),
    description: outline.description ?? '',
    items,
    style: settings.style || outline.print_style,
    paper,
    margin: settings.margin,
    font: settings.font,
    columns: settings.columns,
  }), [outline.title, outline.owner_handle, outline.updated_at, outline.description, outline.print_style, items, settings, paper])

  // a re-flow remounts the bars (so they animate in again) but keeps the pages, which resize in place
  const flow = `${settings.paper}|${settings.margin}|${settings.font}|${settings.columns}|${settings.style}`
  const flows = useRef(0)
  const lastFlow = useRef(flow)
  if (lastFlow.current !== flow) { lastFlow.current = flow; flows.current++ }
  const timing = flows.current === 0 ? OPEN : REFLOW

  const pageH = width ? Math.min(PAGE_MAX_H, (width - SPINE) / 2 / layout.aspect) : 0
  const pageW = pageH * layout.aspect
  const size = useRef({ w: new Animated.Value(pageW), h: new Animated.Value(pageH) }).current
  const sized = useRef(false)
  useEffect(() => {
    if (!pageH) return
    if (!sized.current || reduce) { size.w.setValue(pageW); size.h.setValue(pageH); sized.current = true; return }
    // layout props on the JS driver: the tight spring settles in ~220 ms, so few JS frames and no wobble in the page edges
    const spring = (v: Animated.Value, to: number) => Animated.spring(v, { toValue: to, ...SNAP_SPRING, useNativeDriver: false })
    const a = Animated.parallel([spring(size.w, pageW), spring(size.h, pageH)])
    a.start()
    return () => a.stop()
  }, [pageW, pageH, reduce, size])

  const count = layout.pages.length
  const shown = layout.pages.slice(0, MAX_PAGES)
  const spreads: PreviewPage[][] = []
  for (let i = 0; i < shown.length; i += 2) spreads.push(shown.slice(i, i + 2))
  const summary = tn(count, '{n} page', 'About {n} pages')

  return (
    <View style={{ gap: SPACE.m }} onLayout={e => setWidth(Math.round(e.nativeEvent.layout.width))}>
      <View accessible accessibilityLabel={tn(count, 'Layout preview: {n} page on {paper}', 'Layout preview: about {n} pages on {paper}', { paper: t(paper.label) })} style={{ height: PAGE_MAX_H }}>
        {pageH ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: SPREAD_GAP }}>
            {spreads.map((spread, s) => (
              <View key={s} style={{ flexDirection: 'row', gap: SPINE }}>
                {spread.map((page, k) => {
                  const n = s * 2 + k
                  const facing = spread.length === 2 ? (k === 0 ? 'left' : 'right') : 'none'
                  return (
                    <Grow key={n} from={0.92} delay={n < 2 ? 0 : 40}>
                      <Animated.View style={[{ width: size.w, height: size.h, backgroundColor: c.card, overflow: 'hidden' }, corners(facing)]}>
                        <PageBars key={flow} page={page} delay={timing.base + Math.min(n, 2) * timing.page} step={timing.step} />
                      </Animated.View>
                    </Grow>
                  )
                })}
              </View>
            ))}
            {count > MAX_PAGES ? (
              <Animated.View style={{ width: size.w, height: size.h, borderRadius: RADIUS.control, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[{ color: c.muted, fontSize: TYPE.small }, face('serif')]}>{tn(count - MAX_PAGES, '{n} more', '{n} more')}</Text>
              </Animated.View>
            ) : null}
          </ScrollView>
        ) : null}
      </View>
      <FadeSwap k={summary} style={{ alignSelf: 'center' }}>
        <Text style={[{ color: c.muted, fontSize: TYPE.small, lineHeight: CAPTION_H }, face('serif', { italic: true })]}>{summary}</Text>
      </FadeSwap>
    </View>
  )
}

/** Facing pages meet at a tight spine; outer corners keep the preview-pane radius. */
function corners(facing: 'left' | 'right' | 'none') {
  const r = RADIUS.control, spine = SPINE
  if (facing === 'left') return { borderTopLeftRadius: r, borderBottomLeftRadius: r, borderTopRightRadius: spine, borderBottomRightRadius: spine }
  if (facing === 'right') return { borderTopLeftRadius: spine, borderBottomLeftRadius: spine, borderTopRightRadius: r, borderBottomRightRadius: r }
  return { borderRadius: r }
}

/**
 * One page's bars. The first pieces (header, then items in reading order) enter in turn; everything past the stagger
 * cap enters together as one layer, so a dense page costs at most `STAGGER_CAP + 1` animated views.
 */
const PageBars = memo(function PageBars({ page, delay, step }: { page: PreviewPage; delay: number; step: number }) {
  const head = page.pieces.slice(0, STAGGER_CAP)
  const tail = page.pieces.slice(STAGGER_CAP)
  return (
    <>
      {head.map((p, i) => <Piece key={p.key} piece={p} delay={delay + i * step} />)}
      {tail.length ? (
        <Enter delay={delay + STAGGER_CAP * step} rise={4} style={StyleSheet.absoluteFill}>
          {tail.map(p => <Bars key={p.key} piece={p} box={FULL} />)}
        </Enter>
      ) : null}
    </>
  )
})

interface Box { x: number; y: number; w: number; h: number }
const FULL: Box = { x: 0, y: 0, w: 1, h: 1 }

/** A piece enters inside its own bounding box, so the rise moves only its lines. */
function Piece({ piece, delay }: { piece: PreviewPiece; delay: number }) {
  const box = useMemo<Box>(() => {
    const x = Math.min(...piece.bars.map(b => b.x)), y = Math.min(...piece.bars.map(b => b.y))
    const w = Math.max(...piece.bars.map(b => b.x + b.w)) - x, h = Math.max(...piece.bars.map(b => b.y + b.h)) - y
    return { x, y, w: Math.max(w, 1e-4), h: Math.max(h, 1e-4) }
  }, [piece])
  return (
    <Enter delay={delay} rise={4} style={{ position: 'absolute', left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) }}>
      <Bars piece={piece} box={box} />
    </Enter>
  )
}

function Bars({ piece, box }: { piece: PreviewPiece; box: Box }) {
  const c = useColors()
  return (
    <>
      {piece.bars.map((b, i) => (
        <View key={i} style={{
          position: 'absolute',
          left: pct((b.x - box.x) / box.w), top: pct((b.y - box.y) / box.h),
          width: pct(b.w / box.w), height: pct(b.h / box.h),
          borderRadius: RADIUS.pill, backgroundColor: alpha(c.text, INK[b.tone]),
        }} />
      ))}
    </>
  )
}
