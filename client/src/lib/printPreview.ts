/**
 * Schematic layout of the printed outline: where each line of `buildPrintHtml` (lib/outlines.ts) lands, as bars on
 * pages. No text is measured; widths come from average character advances, so the page count is an estimate.
 * Pure (no React Native imports) so the flow is testable in node. Keep the sizes in step with the print CSS.
 */

/** The print style as `buildPrintHtml` resolves it (settings override, else the outline's own). */
export type PreviewStyle = 'verses-first' | 'inline' | 'refs-only'

/** One outline item, resolved by the caller. `text: null` on a verse means its text has not loaded yet. */
export type PreviewItem =
  | { kind: 'verse'; depth: number; label: string; text: string | null }
  | { kind: 'heading' | 'note' | 'link'; depth: number; text: string }

export interface PreviewInput {
  title: string
  meta: string
  description: string
  items: readonly PreviewItem[]
  style: PreviewStyle
  /** Paper and margin in inches, font in points: the print settings. */
  paper: { w: number; h: number }
  margin: number
  font: number
  columns: 1 | 2
}

export type BarTone = 'title' | 'heading' | 'ref' | 'verse' | 'note' | 'meta' | 'rule'
/** Page fractions: x and w of the page width, y and h of the page height. */
export interface PreviewBar { x: number; y: number; w: number; h: number; tone: BarTone }
/** The lines of one item (or of the header) that fall in one column of one page. */
export interface PreviewPiece { key: string; bars: PreviewBar[] }
export interface PreviewPage { pieces: PreviewPiece[] }
export interface PreviewLayout { pages: PreviewPage[]; aspect: number }

const PT = 72
const LH = 1.35
const COL_GAP = 0.3 * PT
const MAX_DEPTH = 3
/** Average advance per character in em: sans body, serif scripture, bold sans. Word wrap wastes about 6%. */
const ADV = { sans: 0.5, serif: 0.47, bold: 0.56 } as const
const WRAP = 1.06
/** Bar thickness as a share of the font size: headings read heavier, notes lighter than scripture. */
const THICK: Record<BarTone, number> = { title: 0.66, heading: 0.7, ref: 0.5, verse: 0.46, note: 0.4, meta: 0.4, rule: 0 }
/** Thinnest bar drawn, in points: the rule and very small type stay visible. */
const MIN_BAR = 0.75

/** `h: 0` marks a bar that shares the next line (the bold reference in front of inline verse text). */
interface Line { h: number; bar: number; w: number; indent: number; tone: BarTone }
/** `keep` lines must share a column; `keepNext` (a heading) also pulls the next block's kept lines along. */
interface Block { key: string; before: number; after: number; lines: Line[]; split: boolean; keep: number; keepNext?: boolean }

/** Deterministic ragged right: full lines end between 88% and 100% of the measure. */
const ragged = (seed: number) => 0.88 + 0.12 * (((seed * 9301 + 49297) % 233280) / 233280)

/**
 * Wrap `chars` characters of `size` pt text into lines `width` pt wide. The last line keeps its real share;
 * `lead` characters already sit on the first line.
 */
function wrap(chars: number, size: number, adv: number, width: number, tone: BarTone, indent: number, seed: number, lh = LH, lead = 0): Line[] {
  const per = Math.max(4, Math.floor(width / (size * adv)))
  const total = Math.max(1, Math.ceil((chars + lead) * WRAP))
  const n = Math.ceil(total / per)
  const out: Line[] = []
  for (let i = 0; i < n; i++) {
    const w = i === n - 1 ? Math.max(0.12, (total - per * (n - 1)) / per) : ragged(seed + i)
    out.push({ h: size * lh, bar: size * THICK[tone], w: Math.min(1, w), indent, tone })
  }
  return out
}

function itemBlock(it: PreviewItem, i: number, style: PreviewStyle, font: number, colW: number): Block {
  const indent = Math.min(Math.max(it.depth, 0), MAX_DEPTH) * font
  const width = Math.max(font * 4, colW - indent)
  const pad = { before: 0.15 * font, after: 0.35 * font }
  const key = `i${i}`
  const seed = i * 31
  switch (it.kind) {
    case 'heading': {
      const lines = wrap(it.text.length, 1.05 * font, ADV.bold, width, 'heading', indent, seed)
      // a heading never reads shorter than a bar the eye can tell from a note
      for (const l of lines) l.w = Math.max(l.w, 0.45)
      return { key, before: pad.before + 0.45 * font, after: pad.after, lines, split: false, keep: lines.length, keepNext: true }
    }
    case 'note': {
      // notes run a little short of the measure so they read lighter than scripture
      const lines = it.text.split('\n').flatMap(para => wrap(para.length, 0.95 * font, ADV.sans, width, 'note', indent, seed + para.length, 1.4))
      for (const l of lines) l.w *= 0.85
      return { key, ...pad, lines, split: false, keep: lines.length }
    }
    case 'link': {
      const lines = wrap(it.text.length, 0.9 * font, ADV.sans, width, 'note', indent, seed)
      return { key, ...pad, lines, split: false, keep: lines.length }
    }
    case 'verse': {
      // text not loaded yet: sized as a short passage, about two lines
      const chars = it.text?.length ?? Math.round((width / (font * ADV.serif)) * 1.6)
      if (style === 'refs-only') {
        const lines = wrap(it.label.length, font, ADV.bold, width, 'ref', indent, seed)
        return { key, before: 0.05 * font, after: 0.05 * font, lines, split: false, keep: lines.length }
      }
      if (style === 'inline') {
        const lead = Math.ceil(it.label.length * 0.85 * (ADV.bold / ADV.serif)) + 3
        const lines = wrap(chars, font, ADV.serif, width, 'verse', indent, seed, LH, lead)
        const labelW = Math.min(0.6, (lead * font * ADV.serif) / width)
        const gap = (font * 0.3) / width
        const first = lines[0]
        const label: Line = { h: 0, bar: font * THICK.ref, w: labelW, indent, tone: 'ref' }
        const rest: Line = { ...first, indent: indent + (labelW + gap) * width, w: Math.max(0.08, (first.w - labelW - gap) * width / (width - (labelW + gap) * width)) }
        return { key, ...pad, lines: [label, rest, ...lines.slice(1)], split: true, keep: Math.min(3, lines.length + 1) }
      }
      const label = wrap(it.label.length * 1.1, 0.78 * font, ADV.bold, width, 'ref', indent, seed)
      label[label.length - 1].h += 0.1 * font
      const lines = [...label, ...wrap(chars, font, ADV.serif, width, 'verse', indent, seed + 7)]
      // the label never ends a column, and a column never keeps a single line of the verse
      return { key, ...pad, lines, split: true, keep: Math.min(lines.length, label.length + 2) }
    }
    default: { const _x: never = it; return _x }
  }
}

/** Flow the header and items into columns and pages, the way the print CSS breaks them. */
export function layoutPrintPreview(p: PreviewInput): PreviewLayout {
  const W = p.paper.w * PT, H = p.paper.h * PT
  const M = Math.min(Math.max(0, p.margin) * PT, W / 3, H / 3)
  const font = p.font
  const innerW = W - 2 * M, innerH = H - 2 * M
  const cols = p.columns
  const colW = cols === 2 ? (innerW - COL_GAP) / 2 : innerW
  const pages: PreviewPage[] = [{ pieces: [] }]
  const toBar = (x: number, top: number, l: Line, width: number, rowH: number): PreviewBar => {
    const bh = Math.max(MIN_BAR, l.bar)
    return { x: x / W, y: (M + top + (rowH - bh) / 2) / H, w: (width * l.w) / W, h: bh / H, tone: l.tone }
  }

  // header: title, meta line, description, rule; spans every column of the first page
  const head: PreviewBar[] = []
  let y = 0
  const put = (lines: Line[]) => { for (const l of lines) { head.push(toBar(M + l.indent, y, l, innerW - l.indent, l.h)); y += l.h } }
  put(wrap(Math.max(1, p.title.length), 1.35 * font, ADV.serif, innerW, 'title', 0, 7, 1.2))
  y += 0.15 * font
  put(wrap(Math.max(1, p.meta.length) * 1.15, 0.8 * font, ADV.sans, innerW, 'meta', 0, 11))
  if (p.description.trim()) {
    y += 0.4 * font
    put(p.description.split('\n').flatMap((d, k) => wrap(d.length, 0.9 * font, ADV.sans, innerW, 'note', 0, 13 + k * 5)))
  }
  y += 0.35 * font
  head.push({ x: M / W, y: (M + y) / H, w: innerW / W, h: MIN_BAR / H, tone: 'rule' })
  y += 1 + 0.6 * font
  pages[0].pieces.push({ key: 'head', bars: head })

  const blocks: Block[] = p.items.length
    ? p.items.map((it, i) => itemBlock(it, i, p.style, font, colW))
    : [{ key: 'empty', before: 0, after: 0, lines: wrap(22, font, ADV.sans, colW, 'note', 0, 3), split: false, keep: 1 }]

  let page = 0, col = 0, colTop = y
  const advance = () => {
    col++
    if (col >= cols) { col = 0; page++; pages.push({ pieces: [] }) }
    y = 0; colTop = 0
  }
  const lead = (b: Block) => b.before + b.lines.slice(0, b.split ? b.keep : b.lines.length).reduce((a, l) => a + l.h, 0) + (b.split ? 0 : b.after)
  blocks.forEach((b, bi) => {
    const next = blocks[bi + 1]
    const need = lead(b) + (b.keepNext && next ? lead(next) : 0)
    // an unbreakable block, or the kept head of a verse, moves to the next column rather than split
    if (y > colTop && y + need > innerH) advance()
    y += b.before
    let part = 0
    let bars: PreviewBar[] = []
    const flush = () => { if (bars.length) pages[page].pieces.push({ key: `${b.key}.${part++}`, bars }); bars = [] }
    b.lines.forEach((l, k) => {
      if (l.h > 0 && y + l.h > innerH && y > colTop) { flush(); advance() }
      const x = M + col * (colW + COL_GAP) + l.indent
      bars.push(toBar(x, y, l, colW - l.indent, l.h || b.lines[k + 1]?.h || font * LH))
      y += l.h
    })
    flush()
    y += b.after
  })
  return { pages, aspect: W / H }
}
