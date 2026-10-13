// Contact sheet of the preset avatars (shared/avatars.ts) in Paper, Slate and Black, at 96 and 28 px.
//   node scripts/avatars-preview.mjs [out.png] [--all] [--zoom]
// Node runs the .ts module directly (type stripping). --all adds a strip of every theme at 40 px; --zoom draws Paper
// and Slate at 200 px instead, for looking at details.
// Also prints each avatar's drawn area (share of the disc not in the ground colour) to compare visual weight.
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import { AVATARS, avatarRoleColours } from '../shared/avatars.ts'

const args = process.argv.slice(2)
const out = args.find(a => !a.startsWith('--')) ?? '/tmp/wt-friends/avatars-sheet.png'
const all = args.includes('--all'), zoom = args.includes('--zoom')
const require = createRequire('/home/ubuntu/work-dev/berean/package.json')
const { chromium } = require('playwright')

// Derived colours, copied from client/src/theme.ts (build(), legible(), the mix ratios). Preview only.
const rgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join('') }
const lum = h => { const [r, g, b] = rgb(h).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const legible = (fg, toward, on, min) => { let o = fg; for (let t = 0.08; t <= 1 && on.some(s => contrast(o, s) < min); t += 0.08) o = mix(fg, toward, t); return o }
const MIX = { light: { card: 0.055, soft: 0.13 }, dark: { card: 0.075, soft: 0.18 }, black: { card: 0.085, soft: 0.2 } }
const build = (id, group, bg, text, muted, accent, accentText) => {
  const m = MIX[group], card = mix(bg, text, m.card)
  return { id, bg, text, card, muted: legible(muted, text, [bg, card], 4.5), accent: legible(accent, text, [bg, card], 4.5), accentSoft: mix(bg, accent, m.soft), accentText: accentText ?? (group === 'light' ? '#ffffff' : bg) }
}
const B = (id, accent) => build(id, 'black', '#000000', '#e8e6e3', '#8f8f8f', accent, '#000000')
const THEMES = [
  build('paper', 'light', '#faf7f2', '#221b16', '#6b5f55', '#7c2d12'),
  build('sepia', 'light', '#f3e9d4', '#382b1c', '#6e5d45', '#8a3a0e'),
  build('linen', 'light', '#f3f0ea', '#1f2330', '#5f6170', '#27466e'),
  build('sand', 'light', '#faf3e3', '#33260f', '#735f3c', '#9a4a06'),
  build('mint', 'light', '#ecf5ef', '#10302a', '#4f6d64', '#0b6b61'),
  build('sky', 'light', '#edf3fb', '#0f1d38', '#51607a', '#1f4fd1'),
  build('rose', 'light', '#fbf0f2', '#3b0f1e', '#7d4f5d', '#b3123d'),
  build('lavender', 'light', '#f3f0fb', '#221a3d', '#625a7d', '#6427cf'),
  build('olive', 'light', '#f2f3ea', '#1e2314', '#5f6650', '#46700c'),
  build('slate', 'dark', '#1c1917', '#ebe6e1', '#a79f97', '#f6b17f'),
  build('midnight', 'dark', '#0e1628', '#e3e9f3', '#95a3ba', '#8ccbff'),
  build('forest', 'dark', '#0e1d16', '#dbf3e3', '#8db29c', '#72e0b3'),
  build('wine', 'dark', '#1d0e13', '#f8e6ec', '#b98f9e', '#ff9fb0'),
  build('nord', 'dark', '#2e3440', '#eceff4', '#aab3c5', '#88c0d0'),
  build('plum', 'dark', '#272433', '#f3f0f8', '#a8a2bb', '#c3a2ff'),
  build('graphite', 'dark', '#1f1f1f', '#ececec', '#a0a0a0', '#e6e6e6'),
  build('ocean', 'dark', '#0a1b23', '#e0f1f8', '#8fb2c2', '#3fd5c2'),
  B('black', '#fdba74'), B('black-ember', '#fb8a3c'), B('black-jade', '#34d399'), B('black-ice', '#6aa8ff'),
  B('black-rose', '#fb7185'), B('black-gold', '#fbbf24'), B('black-lilac', '#c89bff'), B('black-white', '#f5f5f5'),
]
const byId = Object.fromEntries(THEMES.map(t => [t.id, t]))

let clip = 0
const svg = (a, t, size) => {
  const c = avatarRoleColours(t), id = `c${clip++}`
  const paths = a.shapes.map(s => `<path d="${s.d}" fill="${c[s.role]}"${s.opacity != null ? ` fill-opacity="${s.opacity}"` : ''}/>`).join('')
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64"><defs><clipPath id="${id}"><circle cx="32" cy="32" r="32"/></clipPath></defs><g clip-path="url(#${id})">${paths}</g></svg>`
}
const block = t => `
  <section style="background:${t.bg};color:${t.text}">
    <h2>${t.id}</h2>
    <div class="grid">${AVATARS.map(a => `<figure style="background:${t.card}">${svg(a, t, 96)}<figcaption style="color:${t.muted}">${a.name}</figcaption></figure>`).join('')}</div>
    <div class="row" style="background:${t.card}">${AVATARS.map(a => svg(a, t, 28)).join('')}</div>
    <div class="row">${AVATARS.map(a => svg(a, t, 28)).join('')}</div>
  </section>`
const big = t => `<div class="big" style="background:${t.bg}">${AVATARS.map(a => svg(a, t, 200)).join('')}</div>`
const strip = t => `<div class="strip" style="background:${t.bg}"><span style="color:${t.muted}">${t.id}</span>${AVATARS.map(a => svg(a, t, 40)).join('')}</div>`

const html = `<!doctype html><html><head><style>
  body { margin: 0; font: 13px system-ui, sans-serif; background: #888 }
  section { padding: 16px 20px 20px }
  h2 { margin: 0 0 12px; font-size: 16px }
  .grid { display: grid; grid-template-columns: repeat(12, 112px); gap: 8px }
  figure { margin: 0; padding: 8px 0 6px; border-radius: 14px; display: flex; flex-direction: column; align-items: center; gap: 4px }
  figcaption { font-size: 11px }
  .row { display: flex; gap: 10px; padding: 10px 12px; margin-top: 10px; border-radius: 14px; width: max-content }
  .big { display: grid; grid-template-columns: repeat(6, 200px); gap: 16px; padding: 16px }
  .strip { display: flex; align-items: center; gap: 6px; padding: 6px 20px }
  .strip span { width: 90px; font-size: 11px }
</style></head><body>
  ${zoom ? ['paper', 'slate'].map(id => big(byId[id])).join('') : ['paper', 'slate', 'black'].map(id => block(byId[id])).join('')}
  ${all ? THEMES.map(strip).join('') : ''}
</body></html>`

mkdirSync(dirname(out), { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1480, height: 800 }, deviceScaleFactor: 1 })
await page.setContent(html)
await page.screenshot({ path: out, fullPage: true })

// visual weight: share of the disc painted in something other than the ground, rendered at 64 px
const weights = await page.evaluate(async list => {
  const res = []
  for (const { id, svg } of list) {
    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    await img.decode()
    const cv = document.createElement('canvas'); cv.width = cv.height = 64
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0)
    const px = g.getImageData(0, 0, 64, 64).data
    let disc = 0, drawn = 0
    for (let i = 0; i < 64 * 64; i++) {
      const x = i % 64 + 0.5 - 32, y = Math.floor(i / 64) + 0.5 - 32
      if (x * x + y * y > 32 * 32) continue
      disc++
      if (px[i * 4 + 3] > 127) drawn++
    }
    res.push([id, Math.round((100 * drawn) / disc)])
  }
  return res
}, AVATARS.map(a => ({ id: a.id, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${a.shapes.filter(s => s.role !== 'ground' && s.role !== 'light').map(s => `<path d="${s.d}" fill="#000"/>`).join('')}</svg>` })))
await browser.close()
console.log(`wrote ${out}`)
console.log('drawn area (% of disc):', weights.map(([id, w]) => `${id} ${w}`).join(', '))
