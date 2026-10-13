import { describe, it, expect } from 'vitest'
import { layoutPrintPreview, type PreviewInput, type PreviewItem } from '../client/src/lib/printPreview'

const verse = (chars: number, depth = 0): PreviewItem => ({ kind: 'verse', depth, label: 'Genesis 1:1-3', text: 'x'.repeat(chars) })
const base = (items: PreviewItem[], over: Partial<PreviewInput> = {}): PreviewInput => ({
  title: 'The creation', meta: '@anna · 25 Sept 2026 · Darby', description: '', items, style: 'verses-first',
  paper: { w: 3.5, h: 5.5 }, margin: 0.3, font: 9, columns: 1, ...over,
})
const bars = (l: ReturnType<typeof layoutPrintPreview>) => l.pages.flatMap(p => p.pieces.flatMap(pc => pc.bars))

describe('layoutPrintPreview', () => {
  it('keeps every bar inside the margins of its page', () => {
    const items = Array.from({ length: 40 }, (_, i) => i % 5 === 0 ? { kind: 'heading', depth: 0, text: 'Section' } as const : verse(300, i % 3))
    for (const columns of [1, 2] as const) {
      const l = layoutPrintPreview(base(items, { columns }))
      const mx = 0.3 / 3.5, my = 0.3 / 5.5
      for (const b of bars(l)) {
        expect(b.x).toBeGreaterThanOrEqual(mx - 1e-9)
        expect(b.x + b.w).toBeLessThanOrEqual(1 - mx + 1e-9)
        expect(b.y).toBeGreaterThanOrEqual(my - 1e-9)
        expect(b.y + b.h).toBeLessThanOrEqual(1 - my + 1e-9)
      }
    }
  })

  it('takes more pages for larger type, smaller paper and one column', () => {
    const items = Array.from({ length: 30 }, () => verse(400))
    const pages = (o: Partial<PreviewInput>) => layoutPrintPreview(base(items, o)).pages.length
    expect(pages({ font: 12 })).toBeGreaterThan(pages({ font: 8 }))
    expect(pages({ paper: { w: 3.5, h: 5.5 } })).toBeGreaterThan(pages({ paper: { w: 8.5, h: 11 } }))
    expect(pages({ paper: { w: 8.5, h: 11 }, columns: 1 })).toBeGreaterThanOrEqual(pages({ paper: { w: 8.5, h: 11 }, columns: 2 }))
  })

  it('draws headings thicker than verse text and notes shorter', () => {
    const l = layoutPrintPreview(base([{ kind: 'heading', depth: 0, text: 'In the beginning' }, verse(600), { kind: 'note', depth: 0, text: 'y'.repeat(600) }]))
    const all = bars(l)
    const heading = all.find(b => b.tone === 'heading')!, text = all.filter(b => b.tone === 'verse'), notes = all.filter(b => b.tone === 'note')
    expect(heading.h).toBeGreaterThan(text[0].h)
    expect(Math.max(...notes.map(b => b.w))).toBeLessThan(Math.max(...text.map(b => b.w)))
  })

  it('references only prints one short bar per verse item', () => {
    const l = layoutPrintPreview(base([verse(900), verse(900)], { style: 'refs-only' }))
    expect(bars(l).filter(b => b.tone === 'verse')).toHaveLength(0)
    expect(bars(l).filter(b => b.tone === 'ref')).toHaveLength(2)
  })

  it('never leaves a heading alone at the foot of a column', () => {
    const items: PreviewItem[] = []
    for (let i = 0; i < 12; i++) items.push({ kind: 'heading', depth: 0, text: 'Section heading' }, verse(260 + i * 37))
    const l = layoutPrintPreview(base(items))
    for (const p of l.pages) {
      const last = p.pieces[p.pieces.length - 1]
      expect(last.bars.every(b => b.tone === 'heading')).toBe(false)
    }
  })

  it('an empty outline is one page with its header', () => {
    const l = layoutPrintPreview(base([]))
    expect(l.pages).toHaveLength(1)
    expect(l.pages[0].pieces.map(p => p.key)).toEqual(['head', 'empty.0'])
  })
})
