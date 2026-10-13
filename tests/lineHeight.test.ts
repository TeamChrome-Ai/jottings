import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { DEFAULT_MIN_LINE, DYSLEXIC_LINE, MIN_LINE, lineFactor, lineTight, minLine } from '../client/src/lib/lineHeight'
import { cleanCustomFonts, lineFloorOf, setCustomFonts } from '../client/src/lib/customFonts'

const font = (f: string) => readFileSync(new URL(`../client/assets/fonts/${f}`, import.meta.url))

describe('line height floors (build 31: descenders cut off at low line heights on Android)', () => {
  it('Literata needs 1.45 (ascent 1.177 + descent 0.308 centred in the box; g reaches 0.23 below the baseline)', () => {
    expect(MIN_LINE.serif).toBe(1.45)
    expect(minLine('serif')).toBe(1.45)
    // the slider's 1.2 is laid out at the floor; the default 1.6 is untouched
    expect(lineFactor('serif', 1.2)).toBe(1.45)
    expect(lineFactor('serif', 1.6)).toBe(1.6)
    expect(lineTight('serif', 1.2)).toBe(true)
    expect(lineTight('serif', 1.45)).toBe(false)
    expect(lineTight('serif', 1.6)).toBe(false)
  })
  it('the system sans is safe at the slider minimum; OpenDyslexic keeps its 1.8', () => {
    expect(lineFactor('sans', 1.2)).toBe(1.2)
    expect(lineTight('sans', 1.2)).toBe(false)
    expect(lineFactor('dyslexic', 1.2)).toBe(DYSLEXIC_LINE)
    expect(lineFactor('dyslexic', 2.0)).toBe(2.0)
    expect(MIN_LINE.dyslexic).toBeLessThan(DYSLEXIC_LINE)
  })
  it('an added font carries its own floor from its record, else the default', () => {
    setCustomFonts([{ id: 'lora-0001', name: 'Lora', source: 'google', faces: { regular: 'fonts/lora-0001/regular.ttf' }, minLine: 1.32 }, { id: 'web-0002', name: 'Web', source: 'google', faces: { regular: 'web-0002/regular' } }])
    expect(minLine('custom:lora-0001')).toBe(1.32)
    expect(lineFactor('custom:lora-0001', 1.2)).toBe(1.32)
    expect(minLine('custom:web-0002')).toBe(DEFAULT_MIN_LINE)
    expect(minLine('custom:gone-0003')).toBe(DEFAULT_MIN_LINE)
    setCustomFonts([])
  })
})

describe('lineFloorOf: the floor measured from a font file', () => {
  it('reads Literata from its OS/2 typo metrics (USE_TYPO_METRICS set) to within a hair of the hand-measured 1.33-1.4', () => {
    const f = lineFloorOf(new Uint8Array(font('Literata-Regular.ttf')))
    expect(f).not.toBeNull()
    expect(f!).toBeGreaterThanOrEqual(1.35)
    expect(f!).toBeLessThanOrEqual(1.4)
    expect(lineFloorOf(new Uint8Array(font('Literata-Bold.ttf')))).toBe(f)
  })
  it('reads OpenDyslexic (an OTF, hhea metrics 1.25 / 0.5)', () => {
    const f = lineFloorOf(new Uint8Array(font('OpenDyslexic-Regular.otf')))
    expect(f).toBe(1.55)
  })
  it('is null for what is not a TrueType or OpenType file', () => {
    expect(lineFloorOf(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]))).toBeNull()   // wOF2
    expect(lineFloorOf(new Uint8Array(0))).toBeNull()
    expect(lineFloorOf(new Uint8Array([0, 1, 0, 0, 0, 3]))).toBeNull()                     // a header and nothing after it
  })
  it('the record keeps a sane floor and drops a bad one', () => {
    const [a, b] = cleanCustomFonts([{ id: 'a-0001', name: 'A', source: 'file', faces: { regular: 'x' }, minLine: 1.32 }, { id: 'b-0002', name: 'B', source: 'file', faces: { regular: 'x' }, minLine: '1.3' }])
    expect(a.minLine).toBe(1.32)
    expect(b.minLine).toBeUndefined()
  })
})
