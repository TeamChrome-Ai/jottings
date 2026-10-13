import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Animated, Platform, ScrollView, Text, View, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import Svg, { Circle, G, Path, Polyline, Text as SvgText, TSpan } from 'react-native-svg'
import { bandOf, blockText, chartSections, compactRef, entriesOf, harmonyOf, rowCount, tableWidths, isEntry, pagesOf, parallelsOf, refOfPassage, type ChartFigure, type DiagramFigure, type Figure, type HarmonyRow, type ParallelEntry, type ParallelItem, type ParallelsFigure, type Shape, type TableFigure, type Tone } from '@shared/figures'
import { formatPassage } from '@shared/companion'
import { parseRef, type Ref } from '@shared/ref'
import { inlineSpans, superscript } from '../lib/intro'
import { useReadingFont } from '../hooks/useReadingFont'
import { useColors } from '../hooks/useTheme'
import { band } from '../theme'
import { Rule, Sc } from './ChronologyTable'
import { PulseOnce } from './motion/community'
import { Button, RADIUS, Segmented, Tap } from './ui'

/** At this width and above a figure of parallel columns is set as its page sets it, the columns side by side. */
export const PAGE_LAYOUT_MIN = 600

/**
 * The figures a section's page prints beside its text (shared/figures.ts), in the chronological table's style: heavy
 * rules above and below, a light rule under the headings, headings in small capitals, the text in the reader's font,
 * every reference a link into the reader (`onRef`). One place for every author's figures: a new kind is drawn here.
 * Each row that is an index unit has a slot (`base` onward, in `figureRows` order): it reports where it stands through
 * `onRow` (from the top of this block, as a paragraph reports its place) and is washed when it is `wash`.
 */
export default memo(function Figures({ figures, size, onRef, base = 0, onRow, wash = -1 }: { figures: readonly Figure[]; size: number; onRef: (r: Ref) => void; base?: number; onRow?: Report; wash?: number }) {
  const starts = useMemo(() => figures.reduce<number[]>((a, f, i) => [...a, i ? a[i - 1] + rowCount(figures[i - 1]) : base], []), [figures, base])
  return (
    <WashCtx.Provider value={wash}>
      <Nest root={onRow ?? null} style={{ gap: 24 }}>
        {figures.map((f, i) => f.kind === 'parallels' ? <Parallels key={i} fig={f} size={size} onRef={onRef} slot0={starts[i]} />
          : f.kind === 'table' ? <Table key={i} fig={f} size={size} onRef={onRef} slot0={starts[i]} />
            : f.kind === 'chart' ? <Chart key={i} fig={f} size={size} onRef={onRef} slot0={starts[i]} /> : <Diagram key={i} fig={f} />)}
      </Nest>
    </WashCtx.Provider>
  )
})

type Report = (slot: number, y: number) => void
const ReportCtx = createContext<Report | null>(null)
const WashCtx = createContext(-1)

/** A block the rows inside report through: it adds its own place to theirs (a child is laid out before its parent
 *  knows its place, so what it heard is passed up again when it learns it). `root`: the report at the top. */
function Nest({ root, style, onLayout, viewRef, children }: { root?: Report | null; style?: StyleProp<ViewStyle>; onLayout?: (e: LayoutChangeEvent) => void; viewRef?: RefObject<View | null>; children: ReactNode }) {
  const ctx = useContext(ReportCtx)
  const up = root !== undefined ? root : ctx
  const top = useRef<number | null>(null)
  const seen = useRef(new Map<number, number>())
  const report = useCallback<Report>((slot, y) => { seen.current.set(slot, y); if (up && top.current !== null) up(slot, y + top.current) }, [up])
  return (
    <ReportCtx.Provider value={up ? report : null}>
      <View ref={viewRef} style={style} onLayout={e => {
        top.current = e.nativeEvent.layout.y
        if (up) for (const [slot, y] of seen.current) up(slot, y + top.current)
        onLayout?.(e)
      }}>{children}</View>
    </ReportCtx.Provider>
  )
}

/** A row that is an index unit (or several: a harmony's pericope carries each of its passages): reports its place, and
 *  takes the wash when the reader lands on it. */
function RowMark({ slot, lift = 0, style, children }: { slot: number | readonly number[]; /** reported this much higher: a header held over the rows */ lift?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const report = useContext(ReportCtx)
  const wash = useContext(WashCtx)
  const slots = typeof slot === 'number' ? [slot] : slot
  const y = useRef<number | null>(null)
  // the header is measured after the rows: a new lift is reported again, the row itself not having moved
  useEffect(() => { if (report && y.current !== null) for (const s of slots) report(s, y.current - lift) }, [lift])  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={style} onLayout={report ? e => { y.current = e.nativeEvent.layout.y; for (const s of slots) report(s, y.current - lift) } : undefined}>
      {slots.includes(wash) ? <View pointerEvents="none" style={{ position: 'absolute', left: -6, right: -6, top: 0, bottom: 0 }}><PulseOnce radius={RADIUS.control} strength={0.16} /></View> : null}
      {children}
    </View>
  )
}

/** The figure's size: a step below the reading size, as a table's notes are set in a book. */
const figureSize = (size: number) => Math.max(14, Math.min(18, Math.round(size * 0.85)))

function Caption({ fig }: { fig: Figure }) {
  const c = useColors()
  return <Text style={{ color: c.muted, fontSize: 13, lineHeight: 18, marginTop: 8 }}>{fig.source}</Text>
}

/** Words with the page's `<i>` and `<sc>` (small capitals set by hand, as `Sc` sets them). */
function Styled({ text, italic, fs }: { text: string; italic: TextStyle; fs: number }) {
  return text.split(/(<i>.*?<\/i>|<sc>.*?<\/sc>)/).filter(Boolean).map((t, i) =>
    t.startsWith('<i>') ? <Text key={i} style={italic}>{t.slice(3, -4)}</Text>
      : t.startsWith('<sc>') ? <Text key={i} style={{ fontSize: Math.round(fs * 0.82), letterSpacing: fs * 0.08 }}>{t.slice(4, -5).toUpperCase()}</Text>
        : <Text key={i}>{t}</Text>)
}

// ---------- passages in parallel columns ----------

/** How the harmony is read, kept for the session: in parallel (pericopes in Mark's order) or as the page prints it. */
type HarmonyMode = 'parallel' | 'printed'
let harmonyMode: HarmonyMode = 'parallel'
const MODES: { value: HarmonyMode; label: string }[] = [{ value: 'parallel', label: 'In parallel' }, { value: 'printed', label: 'As printed' }]

function Parallels({ fig, size, onRef, slot0 }: { fig: ParallelsFigure; size: number; onRef: (r: Ref) => void; slot0: number }) {
  const c = useColors()
  const window = useWindowDimensions().width
  const [width, setWidth] = useState(0)
  const [mode, setMode] = useState(harmonyMode)
  // until the figure is measured, the window's width less the page's gutters decides
  const wide = (width || window - 40) >= PAGE_LAYOUT_MIN
  const byN = useMemo(() => entriesOf(fig), [fig])
  // each passage's slot: its place among the passages, in the page's order
  const slotOf = useMemo(() => { const m = new Map<number, number>(); fig.items.filter(isEntry).forEach((e, i) => m.set(e.n, slot0 + i)); return m }, [fig, slot0])
  const fs = figureSize(size)
  const p = { fig, byN, fs, onRef, slotOf }
  return (
    <Nest onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      <View style={{ gap: 8, marginBottom: 16 }}>
        <Segmented value={mode} options={MODES} onChange={m => { harmonyMode = m; setMode(m) }} />
        <Text style={{ color: c.muted, fontSize: 13, lineHeight: 18 }}>
          {mode === 'parallel' ? 'Rows in Mark’s order; the shaded cells are the Gospels that tell it' : 'Each Gospel in its own order, with the numbers of its parallels'}
        </Text>
      </View>
      {mode === 'parallel' ? <InParallel {...p} width={width || window - 40} window={window} /> : wide ? <PageLayout {...p} /> : <Stacked {...p} />}
      <Caption fig={fig} />
    </Nest>
  )
}

interface LayoutProps { fig: ParallelsFigure; byN: Map<number, ParallelEntry>; fs: number; onRef: (r: Ref) => void; slotOf: Map<number, number> }

/** "Mark 6:30–44": the column's book and the reference as it prints it, never broken across lines. */
const fullRef = (fig: ParallelsFigure, e: ParallelEntry) => `${fig.columns[e.col].title} ${e.ref}`.trim().replace(/ /g, '\u00a0')

/** The small figures of a run, each a link to the passage it numbers (0, no parallel, is not). */
function Figs({ see, fig, byN, fs, onRef }: { see: number[] } & LayoutProps) {
  const c = useColors()
  if (!see.length) return null
  return (
    <Text style={{ color: c.muted, fontSize: fs }}>
      {see.map((n, i) => {
        const e = byN.get(n)
        const label = superscript(String(n)) + (i < see.length - 1 ? ' ' : ' ')
        return e?.passage
          ? <Text key={i} accessibilityRole="link" accessibilityLabel={`Parallel ${n}: ${fullRef(fig, e)}`} onPress={() => onRef(refOfPassage(e.passage!))}>{label}</Text>
          : <Text key={i}>{label}</Text>
      })}
    </Text>
  )
}

/** A passage's words as the page runs them, its small figures before the words they go with. */
function Words({ e, figs, ...p }: { e: ParallelEntry; figs: boolean } & LayoutProps) {
  const f = useReadingFont(p.fs, 1.4)
  return e.parts.map((part, i) => (
    <Text key={i}>
      {i ? ' ' : ''}
      {figs ? <Figs see={part.see} {...p} /> : null}
      <Styled text={part.text} italic={f.italic} fs={p.fs} />
    </Text>
  ))
}

/** Narrow: each column in turn under its heading, a passage a row: its number, the passage and its parallels on one
 *  line (the column order kept, the passage itself in the text colour), the words under them. */
function Stacked(p: LayoutProps) {
  const { fig, fs } = p
  const c = useColors()
  const runs = useMemo(() => fig.columns.map((_, col) => fig.items.filter(it => it.col === col)), [fig])
  return (
    <Nest style={{ gap: 20 }}>
      {runs.map((items, col) => (
        <Nest key={col}>
          <Rule heavy />
          <View style={{ paddingVertical: 8 }}><Sc color={c.text} size={fs} bold>{fig.columns[col].title}</Sc></View>
          <Rule />
          {items.map((it, i) => <StackedRow key={i} it={it} {...p} />)}
          <Rule heavy />
        </Nest>
      ))}
    </Nest>
  )
}

function StackedRow({ it, ...p }: { it: ParallelItem } & LayoutProps) {
  const { fig, byN, fs, onRef } = p
  const c = useColors()
  const f = useReadingFont(fs, 1.4)
  const small = useReadingFont(fs - 2, 1.35)
  const numW = Math.round(fs * 2.3)
  if (!isEntry(it)) return <Text style={[small.body, small.italic, { color: c.muted, paddingVertical: 8, paddingLeft: numW + 8 }]}>{it.note}</Text>
  const cols = parallelsOf(fig, it, byN)
  cols[it.col] = [it, ...cols[it.col]]
  const refs = cols.flat().filter(e => e.passage)
  return (
    <RowMark slot={p.slotOf.get(it.n)!} style={{ flexDirection: 'row', gap: 8, paddingVertical: 8 }}>
      <Text style={[f.body, f.bold, { color: c.text, width: numW, textAlign: 'right', fontVariant: ['tabular-nums'] }]}>{it.n}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[small.body, { color: c.muted }]}>
          {refs.map((e, i) => (
            <Text key={e.n}>
              {i ? ' · ' : ''}
              <Text accessibilityRole="link" onPress={() => onRef(refOfPassage(e.passage!))}
                style={e === it ? [small.bold, { color: c.text }] : { color: c.accent }}>{fullRef(fig, e)}</Text>
            </Text>
          ))}
          {refs.length === 1 && refs[0] === it ? ' · no parallel' : ''}
        </Text>
        <Text style={[f.body, { color: c.text }]}><Words e={it} figs={it.parts.length > 1} {...p} /></Text>
      </View>
    </RowMark>
  )
}

/** Wide: the page as printed, a column per book side by side, page after page; each passage its number, reference,
 *  small figures and words. */
function PageLayout(p: LayoutProps) {
  const { fig, fs, onRef } = p
  const c = useColors()
  const f = useReadingFont(fs - 1, 1.35)
  const pages = useMemo(() => pagesOf(fig), [fig])
  const numW = Math.round(fs * 2.2)
  const gap = 16
  return (
    <Nest>
      <Rule heavy />
      <View style={{ flexDirection: 'row', gap, paddingVertical: 8 }}>
        {fig.columns.map(col => <View key={col.title} style={{ flex: 1, alignItems: 'center' }}><Sc color={c.text} size={fs} bold>{col.title}</Sc></View>)}
      </View>
      <Rule />
      {pages.map((pg, i) => (
        <Nest key={i}>
          {i ? <Rule /> : null}
          <Nest style={{ flexDirection: 'row', gap, paddingVertical: 6 }}>
            {pg.cols.map((items, col) => (
              <Nest key={col} style={{ flex: 1 }}>
                {items.map((it, k) => isEntry(it) ? (
                  <RowMark key={k} slot={p.slotOf.get(it.n)!} style={{ flexDirection: 'row', gap: 6, paddingVertical: 4 }}>
                    <Text style={[f.body, f.bold, { color: c.text, width: numW, textAlign: 'right', fontVariant: ['tabular-nums'] }]}>{it.n}</Text>
                    <Text style={[f.body, { flex: 1, color: c.text }]}>
                      {it.passage ? <Text accessibilityRole="link" accessibilityLabel={fullRef(fig, it)} onPress={() => onRef(refOfPassage(it.passage!))} style={{ color: c.accent, fontVariant: ['tabular-nums'] }}>{it.ref}</Text> : null}
                      {it.passage ? ' ' : ''}
                      <Words e={it} figs {...p} />
                    </Text>
                  </RowMark>
                ) : <Text key={k} style={[f.body, f.italic, { color: c.muted, textAlign: 'center', paddingVertical: 8, paddingHorizontal: 8 }]}>{it.note}</Text>)}
              </Nest>
            ))}
          </Nest>
        </Nest>
      ))}
      <Rule heavy />
    </Nest>
  )
}

// ---------- the harmony read in parallel ----------

/** At this window width and above (the figure at least `ROOMY_FIGURE` wide) the rows set the references as printed with
 *  Darby's words beside them; below, compact references with the words under the row. */
export const ROOMY_MIN = 800
const ROOMY_FIGURE = 520
const GAP = 4

/**
 * The page's scroll, for a table's header that stays at the top while the table passes under it: the offset, the content
 * it is measured from and listeners told when the content changes size. Native only: the web sets the header sticky.
 */
export interface PageScroll { y: Animated.Value; content: RefObject<View | null>; resized: Set<() => void> }
export const PageScrollCtx = createContext<PageScroll | null>(null)

/**
 * Darby's harmony as pericopes (shared/figures.ts `harmonyOf`): a row per pericope in Mark's order, one aligned cell per
 * Gospel, the cells a Gospel fills tinted (`band`) so three, two or one read at a glance, an en dash where it has none.
 * The column names stay at the top of the page while the table passes under them. Each row carries the slots of its
 * passages, so a landing on any of them finds the row and washes it.
 */
function InParallel({ fig, fs, onRef, slotOf, width, window }: LayoutProps & { width: number; window: number }) {
  const c = useColors()
  const h = useMemo(() => harmonyOf(fig), [fig])
  const roomy = window >= ROOMY_MIN && width >= ROOMY_FIGURE
  // a passage standing in two rows is found at the first
  const slots = useMemo(() => {
    const seen = new Set<number>()
    return h.rows.map(r => r.cells.flat().filter(e => !seen.has(e.n) && !!seen.add(e.n)).map(e => slotOf.get(e.n)!))
  }, [h, slotOf])
  const refW = roomy ? Math.round(fs * 6.4) : 0
  const tint = band(c)
  const page = useContext(PageScrollCtx)
  const table = useRef<View>(null)
  const [box, setBox] = useState<{ top: number; height: number } | null>(null)
  const measure = useCallback(() => {
    const t = table.current, root = page?.content.current
    if (t && root) t.measureLayout(root, (_x, top, _w, height) => setBox(b => b && b.top === top && b.height === height ? b : { top, height }), () => {})
  }, [page])
  useEffect(() => {
    if (!page) return
    page.resized.add(measure)
    return () => { page.resized.delete(measure) }
  }, [page, measure])
  const cell = (col: number): ViewStyle => roomy ? { width: refW } : { flex: 1, minWidth: 0 }
  // a landing brings its row in under the held header, not beneath it
  const [head, setHead] = useState(0)
  return (
    <Nest viewRef={table} onLayout={page ? measure : undefined}>
      <StickyHead box={box} onHeight={setHead}>
        <Rule heavy />
        <View style={{ flexDirection: 'row', gap: GAP, paddingVertical: 8 }}>
          {fig.columns.map((col, i) => <View key={col.title} style={cell(i)}><View style={{ paddingHorizontal: 6 }}><Sc color={c.text} size={fs - 1} bold>{col.title}</Sc></View></View>)}
          {roomy ? <View style={{ flex: 1 }} /> : null}
        </View>
        <Rule />
      </StickyHead>
      {h.rows.map((r, i) => <PericopeRow key={i} row={r} slots={slots[i]} lift={head} first={i === 0} roomy={roomy} fs={fs} cell={cell} tint={tint} fig={fig} onRef={onRef} />)}
      <Rule heavy />
    </Nest>
  )
}

/** The table's header, held at the top of the page while the table passes under it, and no further than its end. */
function StickyHead({ box, onHeight, children }: { box: { top: number; height: number } | null; onHeight: (h: number) => void; children: ReactNode }) {
  const c = useColors()
  const page = useContext(PageScrollCtx)
  const [h, setHeight] = useState(0)
  const setH = (v: number) => { setHeight(v); onHeight(v) }
  const ty = useMemo(() => {
    if (!page || !box || !h) return 0
    const room = Math.max(1, box.height - h)
    return page.y.interpolate({ inputRange: [box.top, box.top + room], outputRange: [0, room], extrapolate: 'clamp' })
  }, [page, box, h])
  // react-native-web passes `sticky` through to CSS; native's own types do not know it
  if (Platform.OS === 'web') return <View onLayout={e => setH(e.nativeEvent.layout.height)} style={{ position: 'sticky' as 'relative', top: 0, zIndex: 2, backgroundColor: c.bg }}>{children}</View>
  return <Animated.View onLayout={e => setH(e.nativeEvent.layout.height)} style={{ zIndex: 2, backgroundColor: c.bg, transform: [{ translateY: ty }] }}>{children}</Animated.View>
}

interface RowProps { row: HarmonyRow; slots: number[]; lift: number; first: boolean; roomy: boolean; fs: number; cell: (col: number) => ViewStyle; tint: string; fig: ParallelsFigure; onRef: (r: Ref) => void }

/** One pericope: its page notes above it, the three cells, and Darby's words (beside the cells when roomy, else under
 *  them in the muted ink) with any passage his figures compare it to. */
const PericopeRow = memo(function PericopeRow({ row, slots, lift, first, roomy, fs, cell, tint, fig, onRef }: RowProps) {
  const c = useColors()
  const f = useReadingFont(fs - 1, 1.4)
  const small = useReadingFont(fs - 2, 1.4)
  const cf = row.compare.filter(e => e.passage)
  const words = (
    <View style={{ gap: 2 }}>
      <Text style={[roomy ? f.body : small.body, { color: roomy ? c.text : c.muted }]}><Styled text={row.subject} italic={roomy ? f.italic : small.italic} fs={roomy ? fs - 1 : fs - 2} /></Text>
      {cf.length ? (
        <Text style={[small.body, { color: c.muted }]}>
          Compare {cf.map((e, i) => (
            <Text key={e.n}>{i ? ', ' : ''}<Text accessibilityRole="link" onPress={() => onRef(refOfPassage(e.passage!))} style={{ color: c.accent }}>{formatPassage(e.passage!).replace(/ /g, '\u00a0')}</Text></Text>
          ))}
        </Text>
      ) : null}
    </View>
  )
  return (
    <>
      {row.notes.map((n, i) => <Text key={`n${i}`} style={[small.body, small.italic, { color: c.muted, textAlign: 'center', paddingTop: 14, paddingBottom: 6, paddingHorizontal: 12 }]}>{n}</Text>)}
      <RowMark slot={slots} lift={lift} style={{ paddingVertical: 8, gap: 6, borderTopWidth: first ? 0 : 0.75, borderTopColor: c.border }}>
        <View style={{ flexDirection: 'row', gap: GAP }}>
          {row.cells.map((es, col) => <Cell key={col} entries={es} col={col} style={cell(col)} roomy={roomy} fs={fs} tint={tint} fig={fig} onRef={onRef} />)}
          {roomy ? <View style={{ flex: 1, paddingLeft: 8, justifyContent: 'center' }}>{words}</View> : null}
        </View>
        {roomy ? null : <View style={{ paddingHorizontal: 6 }}>{words}</View>}
      </RowMark>
    </>
  )
})

/** A Gospel's cell of a pericope: tinted with its references (each a link into the reader), or a quiet en dash. */
function Cell({ entries, col, style, roomy, fs, tint, fig, onRef }: { entries: ParallelEntry[]; col: number; style: ViewStyle; roomy: boolean; fs: number; tint: string; fig: ParallelsFigure; onRef: (r: Ref) => void }) {
  const c = useColors()
  const f = useReadingFont(roomy ? fs : fs - 1, 1.3)
  const book = fig.columns[col].title
  if (!entries.length) return (
    // the padding on the text, not the cell: a padded flex item takes more than its third
    <View style={[style, { justifyContent: 'center' }]} accessible accessibilityLabel={`Not in ${book}`}>
      <Text style={[f.body, { color: c.muted, paddingHorizontal: 6, paddingVertical: 6 }]}>–</Text>
    </View>
  )
  return (
    <View style={[style, { backgroundColor: tint, borderRadius: 8, paddingVertical: 2 }]}>
      {entries.map(e => e.passage ? (
        <Tap key={e.n} onPress={() => onRef(refOfPassage(e.passage!))} scaleTo={0.94} accessibilityRole="link" accessibilityLabel={formatPassage(e.passage)}
          style={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 5 }}>
          <Text style={[f.body, { color: c.accent, fontVariant: ['tabular-nums'] }]}>{roomy ? e.ref : compactRef(e.passage)}</Text>
        </Tap>
      ) : (
        <Text key={e.n} accessible accessibilityLabel={`${book}, no reference printed`} style={[f.body, { color: c.muted, paddingHorizontal: 6, paddingVertical: 5 }]}>—</Text>
      ))}
    </View>
  )
}

// ---------- a plain table ----------

function Table({ fig, size, onRef, slot0 }: { fig: TableFigure; size: number; onRef: (r: Ref) => void; slot0: number }) {
  const c = useColors()
  const fs = figureSize(size)
  const f = useReadingFont(fs, 1.4)
  const [width, setWidth] = useState(0)
  const { widths, total, scroll } = useMemo(() => tableWidths(fig, width, fs), [fig, width, fs])
  const align = (col: number) => fig.align?.[col] ?? 'left'
  // a heading left empty belongs to the column before it: the two share it, as \multicolumn does
  const heads: { h: string; w: number; col: number }[] = []
  fig.columns.forEach((h, col) => { if (h !== '' || !heads.length) heads.push({ h, w: widths[col], col }); else heads[heads.length - 1].w += widths[col] })
  const cellStyle = (i: number) => ({ width: widths[i], paddingHorizontal: 6, paddingVertical: 5, textAlign: align(i) }) as const
  const row = (cells: string[], k: string, bold?: boolean) => {
    const inner = cells.map((t, i) => (
      <Text key={i} style={[f.body, bold ? f.bold : null, { color: c.text, fontVariant: ['tabular-nums'] }, cellStyle(i)]}>
        {inlineSpans(t).map((s, j) => s.ref
          ? <Text key={j} accessibilityRole="link" onPress={() => onRef(s.ref!)} style={[s.italic ? f.italic : null, { color: c.accent }]}>{s.text}</Text>
          : <Text key={j} style={s.italic ? f.italic : undefined}>{s.text}</Text>)}
      </Text>
    ))
    return k === 'foot' ? <View key={k} style={{ flexDirection: 'row' }}>{inner}</View> : <RowMark key={k} slot={slot0 + Number(k)} style={{ flexDirection: 'row' }}>{inner}</RowMark>
  }
  const body = (
    <Nest style={{ width: total }}>
      <Rule heavy />
      {/* a table the page sets without headings has none */}
      {fig.columns.some(Boolean) ? [
        <View key="h" style={{ flexDirection: 'row' }}>
          {heads.map(({ h, w, col }) => <View key={col} style={{ width: w, paddingHorizontal: 6, paddingVertical: 8 }}><Sc color={c.text} size={fs - 1} align={w > widths[col] ? 'left' : align(col)}>{h}</Sc></View>)}
        </View>,
        <Rule key="r" />,
      ] : null}
      {fig.rows.map((r, k) => [
        fig.rules?.includes(k) ? <Rule key={`r${k}`} /> : null,
        ...(fig.groups ?? []).filter(g => g.at === k).map((g, j) => <Text key={`g${k}-${j}`} style={[f.body, f.italic, { color: c.muted, paddingHorizontal: 6, paddingTop: k ? 12 : 6, paddingBottom: 2 }]}>{g.label}</Text>),
        row(r, String(k)),
      ])}
      {fig.foot ? [<Rule key="fr" />, row(fig.foot, 'foot', true)] : null}
      <Rule heavy />
    </Nest>
  )
  return (
    <Nest>
      {fig.title ? <Text style={[f.body, f.bold, { color: c.text, marginBottom: 8 }]}>{fig.title}</Text> : null}
      <Nest onLayout={e => setWidth(Math.floor(e.nativeEvent.layout.width))}>
        {width <= 0 ? null : scroll ? <ScrollView horizontal showsHorizontalScrollIndicator>{body}</ScrollView> : body}
      </Nest>
      {fig.notes?.map((n, i) => <Text key={i} style={{ color: c.muted, fontSize: 13, lineHeight: 18, marginTop: 6 }}>{'*†‡'[i] ?? ''} {n}</Text>)}
      <Caption fig={fig} />
    </Nest>
  )
}

// ---------- a drawing ----------

function Diagram({ fig }: { fig: DiagramFigure }) {
  const c = useColors()
  const f = useReadingFont(14, 1.3)
  const [width, setWidth] = useState(0)
  const { ink, dash } = useInks()
  const w = Math.max(Math.min(width, fig.maxWidth ?? 560), Math.round(fig.width * (fig.minScale ?? 0)))
  return (
    <View onLayout={e => setWidth(e.nativeEvent.layout.width)} accessible accessibilityRole="image" accessibilityLabel={fig.alt}>
      {fig.title ? <Text style={[f.body, f.bold, { color: c.text, marginBottom: 8 }]}>{fig.title}</Text> : null}
      {width > 0 ? (() => {
        const svg = (
          <Svg width={w} height={Math.round(w * fig.height / fig.width)} viewBox={`0 0 ${fig.width} ${fig.height}`}>
            {fig.shapes.map((sh, i) => <ShapeView key={i} sh={sh} ink={ink} font={f.body.fontFamily as string | undefined} dash={dash} />)}
          </Svg>
        )
        // wider than the column: it scrolls sideways, as a folding map is opened
        return w > width ? <ScrollView horizontal showsHorizontalScrollIndicator>{svg}</ScrollView> : <View style={{ alignItems: 'center' }}>{svg}</View>
      })() : null}
      <Caption fig={fig} />
    </View>
  )
}

/** The theme's inks by name, and a dash pattern for a line of this weight. */
function useInks() {
  const c = useColors()
  return useMemo(() => ({ ink: { ink: c.text, muted: c.muted, accent: c.accent, soft: c.accentSoft, card: c.card } as Record<Tone, string>,
    dash: (d?: 'dash' | 'dot', w = 1.5) => d === 'dash' ? `${w * 4} ${w * 3}` : d === 'dot' ? `${w} ${w * 2.5}` : undefined }), [c])
}

function ShapeView({ sh, ink, font, dash }: { sh: Shape; ink: Record<Tone, string>; font?: string; dash: (d?: 'dash' | 'dot', w?: number) => string | undefined }) {
  switch (sh.t) {
    case 'line': {
      const weight = sh.weight ?? 1.5
      const stroke = ink[sh.tone ?? 'ink']
      const pts = sh.closed ? [...sh.points, sh.points[0], sh.points[1]] : sh.points
      const n = pts.length
      // an arrowhead on the last point, along the last segment
      const head = sh.arrow && n >= 4 ? (() => {
        const [x1, y1, x2, y2] = [pts[n - 4], pts[n - 3], pts[n - 2], pts[n - 1]]
        const a = Math.atan2(y2 - y1, x2 - x1), l = weight * 4
        const p = (d: number) => `${x2 - l * Math.cos(a + d)},${y2 - l * Math.sin(a + d)}`
        return <Path d={`M${p(0.45)} L${x2},${y2} L${p(-0.45)} Z`} fill={stroke} />
      })() : null
      return <G><Polyline points={pts.join(' ')} fill={sh.fill ? ink[sh.fill] : 'none'} stroke={stroke} strokeWidth={weight} strokeDasharray={dash(sh.dash, weight)} strokeLinejoin="round" strokeLinecap={sh.dash === 'dot' ? 'round' : 'butt'} />{head}</G>
    }
    case 'path':
      return <Path d={sh.d} fill={sh.fill ? ink[sh.fill] : 'none'} stroke={sh.tone === undefined && sh.fill ? 'none' : ink[sh.tone ?? 'ink']} strokeWidth={sh.weight ?? 1.5} strokeDasharray={dash(sh.dash, sh.weight ?? 1.5)} strokeLinejoin="round" strokeLinecap={sh.dash === 'dot' ? 'round' : 'butt'} />
    case 'dot':
      return <Circle cx={sh.x} cy={sh.y} r={sh.r ?? 2.5} fill={ink[sh.tone ?? 'ink']} />
    case 'text': {
      const size = sh.size ?? 10
      const lines = [sh.text, ...(sh.lines ?? [])].map(t => sh.caps ? t.toUpperCase() : t)
      return (
        <SvgText x={sh.x} y={sh.y} fill={ink[sh.tone ?? 'ink']} fontSize={sh.caps ? size * 0.82 : size} fontFamily={font} fontStyle={sh.italic ? 'italic' : 'normal'}
          letterSpacing={sh.caps ? size * 0.08 : 0} textAnchor={sh.anchor ?? 'start'} transform={sh.rotate ? `rotate(${sh.rotate} ${sh.x} ${sh.y})` : undefined}>
          {lines.map((t, i) => <TSpan key={i} x={sh.x} dy={i ? sh.pitch ?? size * 1.2 : 0}>{t}</TSpan>)}
        </SvgText>
      )
    }
  }
}

// ---------- a chart of periods against passages ----------

/** A column heading's passage as a link target: its first verse ("Revelation 10:1–11:14" opens at 10:1). */
const refOfHead = (ref?: string) => ref ? parseRef(ref.replace(/–/g, '-').replace(/(\d+:\d+)-\d+:\d+$/, '$1').replace(/(\d+)-\d+$/, '$1')) : null

/**
 * Read as a list: column by column, the heading and its passage, then each note of the column with the period it stands
 * in. "As printed" draws the chart itself, at the page's proportions, sideways scrolling where it is wider than the
 * column (it is a folding plate in the book).
 */
function Chart({ fig, size, onRef, slot0 }: { fig: ChartFigure; size: number; onRef: (r: Ref) => void; slot0: number }) {
  const c = useColors()
  const fs = figureSize(size)
  const f = useReadingFont(fs, 1.4)
  const small = useReadingFont(fs - 2, 1.35)
  const [printed, setPrinted] = useState(false)
  const sections = useMemo(() => chartSections(fig), [fig])
  return (
    <Nest style={{ gap: 12 }}>
      {fig.title ? <Text style={[f.body, f.bold, { color: c.text }]}>{fig.title}</Text> : null}
      <Button small title={printed ? 'Show as a list' : 'Show the chart as printed'} onPress={() => setPrinted(p => !p)} style={{ alignSelf: 'flex-start' }} />
      {printed ? <ChartDrawing fig={fig} /> : (
        <Nest>
          <Rule heavy />
          {sections.map((sec, i) => {
            const r = refOfHead(sec.ref)
            return (
              <RowMark key={i} slot={slot0 + i} style={{ paddingVertical: 10, gap: 6, borderBottomWidth: i < sections.length - 1 ? 0.75 : 0, borderBottomColor: c.border }}>
                {r ? <Text accessibilityRole="link" onPress={() => onRef(r)} style={[f.body, f.bold, { color: c.accent, alignSelf: 'flex-start' }]}>{sec.ref}</Text>
                  : <Text style={[f.body, f.bold, { color: c.text }]}>{sec.ref ?? sec.head}</Text>}
                {sec.blocks.length ? sec.blocks.map((b, k) => (
                  <View key={k} style={{ gap: 1 }}>
                    {bandOf(fig, b.rotate ? b.y - 20 : b.y).label ? <Sc color={c.muted} size={fs - 2}>{bandOf(fig, b.rotate ? b.y - 20 : b.y).label}</Sc> : null}
                    {blockText(b.lines).map((t, j) => <Text key={j} style={[f.body, { color: c.text }]}><Styled text={t} italic={f.italic} fs={fs} /></Text>)}
                  </View>
                )) : <Text style={[small.body, small.italic, { color: c.muted }]}>Nothing written in this column.</Text>}
              </RowMark>
            )
          })}
          <Rule heavy />
        </Nest>
      )}
      {fig.note ? <Text style={[small.body, { color: c.muted }]}>{fig.note}</Text> : null}
      <Caption fig={fig} />
    </Nest>
  )
}

/** A line of a chart with its `<i>` runs. */
const runsOf = (t: string) => t.split(/(<i>.*?<\/i>)/).filter(Boolean).map(x => x.startsWith('<i>') ? { t: x.slice(3, -4), i: true } : { t: x, i: false })

/** The chart drawn: its rules and headings, and each block's lines in its column, as lettered or set. */
function ChartDrawing({ fig }: { fig: ChartFigure }) {
  const c = useColors()
  const { ink, dash } = useInks()
  const font = useReadingFont(14, 1.3).body.fontFamily as string | undefined
  // the words at 13 px whatever the chart's units: the plate is wider than a page, so it scrolls sideways
  const scale = 13 / fig.size
  const w = Math.round(fig.width * scale), h = Math.round(fig.height * scale)
  const line = (t: string, key: number, x: number, y: number, size: number, anchor: 'start' | 'middle', rotate?: boolean) => (
    // lettered capitals are narrower than the reading face's: set a size down, untracked, to keep within the columns
    <SvgText key={key} x={x} y={y} fill={ink.ink} fontSize={fig.caps ? size * 0.78 : size} fontFamily={font}
      textAnchor={anchor} transform={rotate ? `rotate(-90 ${x} ${y})` : undefined}>
      {runsOf(fig.caps ? t.toUpperCase() : t).map((r, k) => <TSpan key={k} fontStyle={r.i ? 'italic' : 'normal'}>{r.t}</TSpan>)}
    </SvgText>
  )
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator style={{ backgroundColor: c.bg }}>
      <Svg width={w} height={h} viewBox={`0 0 ${fig.width} ${fig.height}`}>
        {fig.shapes.map((sh, i) => <ShapeView key={i} sh={sh} ink={ink} font={font} dash={dash} />)}
        {fig.blocks.map((b, i) => {
          const col = fig.columns[b.col], last = fig.columns[b.to ?? b.col]
          const size = b.size ?? fig.size, pitch = b.pitch ?? fig.pitch
          const left = b.align === 'left'
          if (b.rotate) {
            // set up the column from its foot, the first line leftmost
            const x0 = (col.x0 + last.x1) / 2 - pitch * (b.lines.length - 1) / 2 + size * 0.35
            return <G key={i}>{b.lines.map((t, j) => line(t, j, x0 + j * pitch, b.y, size, 'start', true))}</G>
          }
          const x = left ? col.x0 + 3 : (col.x0 + last.x1) / 2
          return <G key={i}>{b.lines.map((t, j) => t === '—'
            ? <Path key={j} d={`M${x - 18} ${b.y + j * pitch - size * 0.35} h36`} stroke={ink.ink} strokeWidth={1} />
            : line(t, j, x, b.y + j * pitch, size, left ? 'start' : 'middle'))}</G>
        })}
      </Svg>
    </ScrollView>
  )
}
