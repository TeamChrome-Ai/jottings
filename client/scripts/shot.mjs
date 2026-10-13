// Playwright smoke shots of the web build. Run from the repo root (playwright is installed there):
//   node mobile/scripts/shot.mjs [baseUrl=http://localhost:8081] [outDir=mobile/shots]
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const base = process.argv[2] ?? 'http://localhost:8081'
const out = process.argv[3] ?? 'mobile/shots'
await mkdir(out, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
for (const [name, path, wait] of [['home', '/', 'text=Verse of the day'], ['read', '/read/43/3', 'text=Nicodemus'], ['settings', '/settings', 'text=Reduce animation'], ['search', '/search', 'text=Search'], ['login', '/login', 'text=Sign in']]) {
  await page.goto(base + path, { waitUntil: 'networkidle' })
  try { await page.waitForSelector(wait, { timeout: 20000 }) } catch { errors.push(`${name}: "${wait}" not found`) }
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false })
  console.log(`shot ${name} -> ${out}/${name}.png`)
}
// the reader with the dyslexic font, dark theme and larger text, via the prefs store
await page.goto(base + '/read/19/119', { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.setItem('berean_prefs', JSON.stringify({ theme: 'dark', font: 'dyslexic', fontSize: 24, reduceMotion: true })))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('text=ALEPH', { timeout: 20000 }).catch(() => errors.push('ps119 heading missing'))
await page.screenshot({ path: `${out}/read-dark-dyslexic.png` })
await browser.close()
if (errors.length) { console.error('errors:\n' + errors.join('\n')); process.exit(1) }
console.log('ok')
