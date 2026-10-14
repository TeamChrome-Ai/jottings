import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { HL_ALL, HL_CORE, HL_EXTRA, hlKey, hlPicker, isHlColor } from '../client/src/lib/hlColours'
import { deltaE } from '../client/src/lib/themeFade'

// theme.ts imports Platform for its font helpers; the colours need none of it
vi.mock('../client/node_modules/react-native', () => ({ Platform: { OS: 'web', select: (o: Record<string, unknown>) => o.web } }))
const { THEMES, contrast } = await import('../client/src/theme')
const src = (path: string) => readFileSync(new URL(`../client/src/${path}`, import.meta.url), 'utf8')

describe('the highlighters by name', () => {
  it('offers the core four, and the eight extra after them only when the setting is on', () => {
    expect(hlPicker(false)).toEqual(['yellow', 'green', 'blue', 'pink'])
    expect(hlPicker(true)).toEqual(['yellow', 'green', 'blue', 'pink', 'orange', 'red', 'purple', 'teal', 'sky', 'lime', 'brown', 'grey'])
    expect(hlPicker(true).slice(0, 4)).toEqual(hlPicker(false))
    expect([HL_CORE.length, HL_EXTRA.length, new Set(HL_ALL).size]).toEqual([4, 8, 12])
  })
  it('draws a name it does not have as yellow, and every name it has as itself', () => {
    for (const k of HL_ALL) expect(hlKey(k)).toBe(k)
    for (const k of ['gold', 'Orange', '', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) expect([k, hlKey(k), isHlColor(k)]).toEqual([k, 'yellow', false])
  })
  it('is what the bar, the verse and the web’s ink variables go by', () => {
    // these import react-native, so the wiring is read from the source
    expect(src('components/ActionBar.tsx')).toContain('hlPicker(more)')
    expect(src('components/ChapterView.tsx')).toContain("selected || flashed ? 'selected' : hl ? hlKey(hl) : null")
    expect(src('hooks/useTheme.tsx').match(/HL_ALL/g)).toHaveLength(3)
  })
})

const LIGHT = { yellow: '#fde68a', green: '#bbf7d0', blue: '#bfdbfe', pink: '#fbcfe8' }
const DARK = { yellow: '#713f12', green: '#14532d', blue: '#1e3a8a', pink: '#831843' }
/** CIE76 between two tints of one theme, and between a tint and its page: 2.3 is the least the eye can tell apart;
 *  the nearest pair today is 14.5 (orange and brown on Mint), the nearest to its page 13.7 (grey on Linen). */
const APART = 12

describe('highlight tints on every theme', () => {
  it('leaves the four core tints as they were, on all 25', () => {
    expect(THEMES).toHaveLength(25)
    for (const t of THEMES) expect([t.id, ...HL_CORE.map(k => t.hl[k])]).toEqual([t.id, ...Object.values(t.dark ? DARK : LIGHT)])
  })
  it('gives every theme a tint for each of the twelve', () => {
    for (const t of THEMES) {
      expect(Object.keys(t.hl)).toEqual([...HL_ALL])
      for (const k of HL_ALL) expect(t.hl[k]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
  it('keeps the words readable on each: 4.5:1, which the core tints pass on every theme', () => {
    for (const t of THEMES) {
      const core = Math.min(...HL_CORE.map(k => contrast(t.text, t.hl[k])))
      expect(core).toBeGreaterThanOrEqual(4.5)
      for (const k of HL_ALL) expect(contrast(t.text, t.hl[k]), `${t.id} ${k}`).toBeGreaterThanOrEqual(Math.min(4.5, core))
    }
  })
  it('holds the extra tints to more: words at 7:1, verse numbers and note letters at 3:1, or what the weakest core tint gives', () => {
    for (const t of THEMES) for (const [ink, want] of [[t.text, 7], [t.muted, 3], [t.accent, 3]] as const) {
      const floor = Math.min(want, ...HL_CORE.map(k => contrast(ink, t.hl[k])))
      for (const k of HL_EXTRA) expect(contrast(ink, t.hl[k]), `${t.id} ${k}`).toBeGreaterThanOrEqual(floor)
    }
  })
  it('keeps the twelve apart from one another and from the page', () => {
    for (const t of THEMES) HL_ALL.forEach((a, i) => {
      expect(deltaE(t.hl[a], t.bg), `${t.id} ${a} on the page`).toBeGreaterThanOrEqual(APART)
      for (const b of HL_ALL.slice(i + 1)) expect(deltaE(t.hl[a], t.hl[b]), `${t.id} ${a} and ${b}`).toBeGreaterThanOrEqual(APART)
    })
  })
})
