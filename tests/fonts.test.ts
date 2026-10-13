import { describe, it, expect } from 'vitest'
import { familyCandidates, googleCssUrl, parseGoogleCss } from '../client/src/lib/googleFonts'
import { cleanCustomFonts, customIdOf, migrateFontPrefs, nameFromFile, newFontId, sniffFont } from '../client/src/lib/customFonts'

// what fonts.googleapis.com returns to a plain user agent: one whole TTF per face
const TTF_CSS = `@font-face {
  font-family: 'Lora';
  font-style: italic;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/lora/v37/italic.ttf) format('truetype');
}
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/lora/v37/regular.ttf) format('truetype');
}
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/lora/v37/bold.ttf) format('truetype');
}
`
// what a modern browser gets: WOFF2 split by script, a comment naming each subset
const block = (subset: string, style: string, weight: number) => `/* ${subset} */
@font-face {
  font-family: 'EB Garamond';
  font-style: ${style};
  font-weight: ${weight};
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/ebgaramond/${subset}-${style}-${weight}.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
`
const WOFF2_CSS = ['cyrillic-ext', 'greek', 'latin-ext', 'latin', 'vietnamese'].flatMap(s => [block(s, 'italic', 400), block(s, 'normal', 400), block(s, 'normal', 700)]).join('')

describe('parseGoogleCss', () => {
  it('takes one TTF per face and the family name', () => {
    const p = parseGoogleCss(TTF_CSS)
    expect(p.family).toBe('Lora')
    expect(p.regular).toEqual({ url: 'https://fonts.gstatic.com/s/lora/v37/regular.ttf', format: 'truetype' })
    expect(p.bold?.url).toMatch(/bold\.ttf$/)
    expect(p.italic?.url).toMatch(/italic\.ttf$/)
  })
  it('keeps the Latin block when the stylesheet is split by script', () => {
    const p = parseGoogleCss(WOFF2_CSS)
    expect(p.family).toBe('EB Garamond')
    expect(p.regular).toEqual({ url: 'https://fonts.gstatic.com/s/ebgaramond/latin-normal-400.woff2', format: 'woff2' })
    expect(p.bold?.url).toMatch(/\/latin-normal-700\.woff2$/)
    expect(p.italic?.url).toMatch(/\/latin-italic-400\.woff2$/)
  })
  it('leaves out faces the family does not have and ignores other weights', () => {
    const css = TTF_CSS.replace(/@font-face {\s*font-family: 'Lora';\s*font-style: italic;[^}]*}/, '').replace('font-weight: 700', 'font-weight: 300')
    const p = parseGoogleCss(css)
    expect(p.regular).toBeDefined()
    expect(p.bold).toBeUndefined()
    expect(p.italic).toBeUndefined()
  })
  it('finds nothing in an error page', () => {
    expect(parseGoogleCss('<!DOCTYPE html><title>400: Font family not found</title>')).toEqual({})
  })
  it('accepts quoted URLs and a src without format()', () => {
    const p = parseGoogleCss(`@font-face{font-family:"X";font-style:normal;font-weight:400;src:url('https://a.test/x.otf')}`)
    expect(p.regular).toEqual({ url: 'https://a.test/x.otf', format: 'otf' })
  })
})

describe('Google Fonts request', () => {
  it('asks for Regular, Bold and Italic with spaces as plus signs', () => {
    expect(googleCssUrl(' EB Garamond ')).toBe('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,700;1,400&display=swap')
  })
  it('tries a typed name with capitals first, and case fixes first for an all-lowercase one', () => {
    expect(familyCandidates('eb  garamond')).toEqual(['EB Garamond', 'Eb Garamond', 'eb garamond'])
    expect(familyCandidates('lora')).toEqual(['Lora', 'lora'])
    expect(familyCandidates('Lora')).toEqual(['Lora'])
    expect(familyCandidates('IM Fell English')).toEqual(['IM Fell English', 'Im Fell English'])
    expect(familyCandidates('   ')).toEqual([])
  })
})

describe('custom font records', () => {
  const lora = { id: 'lora-ab12', name: 'Lora', source: 'google', faces: { regular: 'fonts/lora-ab12/regular.ttf', bold: 'fonts/lora-ab12/bold.ttf' } }
  it('keeps a custom choice whose font is stored', () => {
    expect(migrateFontPrefs({ font: 'custom:lora-ab12', customFonts: [lora] })).toEqual({ font: 'custom:lora-ab12', customFonts: [lora] })
  })
  it('reads a custom choice whose record is gone as Serif', () => {
    expect(migrateFontPrefs({ font: 'custom:gone-0000', customFonts: [lora] }).font).toBe('serif')
  })
  it('gives prefs from before added fonts an empty list and keeps their font', () => {
    expect(migrateFontPrefs({ font: 'dyslexic' })).toEqual({ font: 'dyslexic', customFonts: [] })
    expect(migrateFontPrefs({ font: 'noto', customFonts: 'junk' })).toEqual({ font: 'serif', customFonts: [] })
    expect(migrateFontPrefs({}).font).toBe('serif')
    expect(migrateFontPrefs({ font: 'comic' }).font).toBe('serif')
  })
  it('drops malformed records and duplicate ids, and empty optional faces', () => {
    const out = cleanCustomFonts([
      lora, { ...lora }, null, 'x',
      { id: '../etc', name: 'Bad', source: 'file', faces: { regular: 'a' } },
      { id: 'no-regular', name: 'N', source: 'file', faces: { bold: 'b' } },
      { id: 'wrong-source', name: 'W', source: 'ftp', faces: { regular: 'a' } },
      { id: 'mine-0001', name: '  Mine ', source: 'file', faces: { regular: 'fonts/mine-0001/regular.otf', italic: '' } },
    ])
    expect(out.map(f => f.id)).toEqual(['lora-ab12', 'mine-0001'])
    expect(out[1]).toEqual({ id: 'mine-0001', name: 'Mine', source: 'file', faces: { regular: 'fonts/mine-0001/regular.otf' } })
  })
  it('makes ids safe for paths and pref values', () => {
    const id = newFontId('EB Garamond / Élégant!', () => 0.5)
    expect(id).toMatch(/^eb-garamond-elegant-[a-z0-9]{4}$/)
    expect(customIdOf(`custom:${id}`)).toBe(id)
    expect(newFontId('∑∑∑', () => 0)).toBe('font-0000')
  })
  it('knows a font file by its first bytes', () => {
    expect(sniffFont(new Uint8Array([0, 1, 0, 0, 9]))).toBe('ttf')
    expect(sniffFont(new TextEncoder().encode('OTTO....'))).toBe('otf')
    expect(sniffFont(new TextEncoder().encode('wOF2....'))).toBe('woff2')
    expect(sniffFont(new TextEncoder().encode('<!DOCTYPE'))).toBeNull()
    expect(sniffFont(new Uint8Array([0, 1]))).toBeNull()
  })
  it('names a picked file without its style suffix', () => {
    expect(nameFromFile('/tmp/EBGaramond-Regular.ttf')).toBe('EBGaramond')
    expect(nameFromFile('my_font.otf')).toBe('my font')
    expect(nameFromFile('.ttf')).toBe('My font')
  })
})
