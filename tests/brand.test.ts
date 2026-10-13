import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { BRAND, NOUN, SCHEMES, appUrl, linksOf, nounForms, possessive, siteUrl, withArticle, type Brand } from '../shared/brand'

// The brand is data (docs/BRAND.md): shared/brand.json is the real one, brand.example/ holds the placeholder for
// every brand file at the same path. These hold the two in step, whichever of them is in place.
const ROOT = path.resolve(__dirname, '..')
const EXAMPLE = path.join(ROOT, 'brand.example')
const read = (...p: string[]) => readFileSync(path.join(...p), 'utf8')
const brandAt = (root: string): Brand => JSON.parse(read(root, 'shared/brand.json'))
const real = brandAt(ROOT), example = brandAt(EXAMPLE)
// A trial of the placeholder (docs/BRAND.md rule 4) copies only brand.json over the real one: the tree's other brand
// files are then still the real brand's and cannot be checked against it. In this repository and in the public copy
// (every brand file replaced) they are checked.
const trial = JSON.stringify(real) === JSON.stringify(example) && read(ROOT, 'client/public/manifest.json') !== read(EXAMPLE, 'client/public/manifest.json')
const sides: (readonly [string, Brand])[] = trial ? [[EXAMPLE, example]] : [[ROOT, real], [EXAMPLE, example]]

/** A value's shape: its keys and the kind of each value (a list is a list, whatever it holds: one may be empty). */
function shape(v: unknown): unknown {
  if (Array.isArray(v)) return 'list'
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, shape(x)]))
  return typeof v
}
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(f => { const p = path.join(dir, f); return statSync(p).isDirectory() ? filesUnder(p) : [p] })
}
/** A PNG's pixel size, from its header. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file)
  expect(b.subarray(1, 4).toString('latin1'), file).toBe('PNG')
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

describe('the brand file and its placeholder', () => {
  it('have the same keys and kinds of value; only the wordmark may be left out', () => {
    const { wordmark: _real, ...realRest } = real, { wordmark: _example, ...exampleRest } = example
    expect(shape(exampleRest)).toEqual(shape(realRest))
    // in the same order too, so the two files read side by side
    expect(Object.keys(exampleRest)).toEqual(Object.keys(realRest))
  })
  it('is the brand the code reads', () => {
    expect(BRAND).toEqual(real)
  })
  it('sets a wordmark letter for letter with the name', () => {
    for (const b of [real, example]) {
      const w = b.wordmark
      if (!w) continue
      const name = Array.from(b.name)
      expect(w.letters).toHaveLength(name.length)
      expect(w.letters.map((ch, i) => (w.dot && i === w.dot.letter ? w.dot.glyph : ch)).join('')).toBe(b.name)
      expect(w.x).toHaveLength(name.length)
      expect(w.advance).toHaveLength(name.length)
      if (w.seasonal !== undefined) expect(w.seasonal).toBeLessThan(name.length)
    }
  })
})

describe('the placeholders under brand.example/', () => {
  const files = filesUnder(EXAMPLE).map(f => path.relative(EXAMPLE, f)).filter(f => !f.startsWith(`rs${path.sep}`))
  it('each stand in for a real file at the same path', () => {
    expect(files.length).toBeGreaterThan(10)
    for (const f of files) expect(existsSync(path.join(ROOT, f)), f).toBe(true)
  })
  it('are pictures of the real pictures’ sizes', () => {
    const pngs = files.filter(f => f.endsWith('.png'))
    expect(pngs.length).toBeGreaterThan(8)
    for (const f of pngs) expect(pngSize(path.join(EXAMPLE, f)), f).toEqual(pngSize(path.join(ROOT, f)))
  })
  it('carry the media card’s picture as the same base64 the file holds', () => {
    for (const root of [ROOT, EXAMPLE]) {
      const b64 = /'([A-Za-z0-9+/=]+)'/.exec(read(root, 'client/src/lib/mediaArtData.ts'))?.[1] ?? ''
      expect(Buffer.from(b64, 'base64').equals(readFileSync(path.join(root, 'client/assets/media-art.png'))), root).toBe(true)
    }
  })
  it('name their own brand in the web manifest and the page shell, which differ from the real ones in nothing else', () => {
    for (const [root, b] of sides) {
      const manifest = JSON.parse(read(root, 'client/public/manifest.json'))
      expect([manifest.name, manifest.short_name, manifest.description], root).toEqual([b.storeName, b.name, b.description])
      expect(read(root, 'client/public/index.html'), root).toContain(`<meta name="description" content="${b.description}" />`)
      expect(read(root, 'client/public/third-party.txt').split('\n')[0], root).toBe(`Third-party software in ${b.fullName}`)
    }
    if (trial) return
    const neutral = (root: string, b: Brand, file: string) => read(root, file).split(b.description).join('').split(b.storeName).join('').split(`"short_name": "${b.name}"`).join('')
    for (const file of ['client/public/index.html', 'client/public/manifest.json']) expect(neutral(EXAMPLE, example, file), file).toBe(neutral(ROOT, real, file))
    expect(read(EXAMPLE, 'client/public/third-party.txt').split('\n').slice(2)).toEqual(read(ROOT, 'client/public/third-party.txt').split('\n').slice(2))
  })
  it('have a page for every legal page, and the credits made from the placeholder brand', () => {
    for (const page of ['privacy', 'terms', 'copyright', 'account-deletion']) expect(read(EXAMPLE, `client/public/${page}.html`), page).toMatch(/^<!doctype html>[\s\S]*<h1>/)
    for (const page of ['credits', 'credits-1890']) for (const [root, b] of sides) expect(read(root, `client/public/${page}.html`), `${root} ${page}`).toContain(`<title>Credits and licences — ${b.name}</title>`)
  })
})

describe('the Expo config', () => {
  it('takes its brand from the brand file and the rest from app.json', () => {
    const require = createRequire(import.meta.url)
    const appJson = JSON.parse(read(ROOT, 'client/app.json')).expo
    const config = require('../client/app.config.js')({ config: { ...appJson, name: 'from-package-json', slug: 'from-package-json' } })
    expect([config.name, config.slug, config.scheme]).toEqual([BRAND.name, BRAND.slug, [BRAND.scheme, ...BRAND.extraSchemes]])
    expect([config.ios.bundleIdentifier, config.android.package]).toEqual([BRAND.iosBundleId, BRAND.androidPackage])
    expect([config.web.name, config.web.shortName, config.extra.apiBase]).toEqual([BRAND.storeName, BRAND.name, BRAND.site])
    const links: { scheme: string; host: string; pathPrefix: string }[] = config.android.intentFilters[0].data
    expect(links.length).toBe(appJson.android.intentFilters[0].data.length)
    for (const l of links) expect([l.scheme, l.host]).toEqual(['https', BRAND.host])
    const options = (name: string) => config.plugins.find((p: unknown) => Array.isArray(p) && p[0] === name)[1]
    expect(options('expo-camera').cameraPermission).toMatch(new RegExp(`^${BRAND.name} uses the camera`))
    expect(options('expo-contacts').contactsPermission).toMatch(new RegExp(`^${BRAND.name} reads your contacts`))
    // the release tools read these two from app.json as text
    expect([config.version, config.android.versionCode]).toEqual([appJson.version, appJson.android.versionCode])
    expect(appJson.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('the brand’s helpers', () => {
  it('give the noun and verb every form a sentence needs', () => {
    expect(nounForms({ one: 'study', many: 'studies', verb: 'Note' })).toEqual({ one: 'study', many: 'studies', One: 'Study', Many: 'Studies', a: 'a study', A: 'A study', verb: 'Note', verbLower: 'note' })
    expect(nounForms({ one: 'outline', many: 'outlines', verb: 'Add' })).toMatchObject({ a: 'an outline', A: 'An outline', Many: 'Outlines', verbLower: 'add' })
    expect(NOUN).toEqual(nounForms(BRAND.noun))
  })
  it('choose the article and the possessive by the word', () => {
    expect([withArticle('study'), withArticle('outline'), withArticle('Reader')]).toEqual(['a study', 'an outline', 'a Reader'])
    expect([possessive('Studies'), possessive('Reader')]).toEqual(['Studies’', 'Reader’s'])
  })
  it('build addresses on the site and by the app’s scheme, for the placeholder brand as for the real one', () => {
    const l = linksOf(example)
    expect(l.siteUrl('/friends?t=abc')).toBe(`${example.site}/friends?t=abc`)
    expect(l.siteUrl()).toBe(example.site)
    expect(l.appUrl('read/43/3?v=16')).toBe(`${example.scheme}://read/43/3?v=16`)
    expect(l.schemes).toEqual([example.scheme, ...example.extraSchemes])
    expect(new URL(l.siteUrl('/get')).host).toBe(example.host)
    expect([siteUrl('/get'), appUrl('login'), SCHEMES]).toEqual([`${BRAND.site}/get`, `${BRAND.scheme}://login`, [BRAND.scheme, ...BRAND.extraSchemes]])
    expect(new URL(BRAND.site).host).toBe(BRAND.host)
  })
})
