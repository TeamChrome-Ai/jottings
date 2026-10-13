// Visual check of the theme gallery and animated chrome against a local server: screenshots into /tmp/bdb-ui.
//   BASE=http://127.0.0.1:8787 node scripts/ui-check.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const out = '/tmp/bdb-ui'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const prefs = theme => ({ theme, themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false })
const cases = [
  ['/themes', 'themes-paper', 'paper', 'text=Follow the system'],
  ['/themes', 'themes-midnight', 'midnight', 'text=Follow the system'],
  ['/', 'home-mint', 'mint', "text=Today’s verse"],
  ['/read/43/3', 'read-black-gold', 'black-gold', 'text=Nicodemus'],
  ['/settings', 'settings-rose', 'rose', 'text=Theme'],
  ['/credits', 'credits-paper', 'paper', 'text=Open Scriptures'],
]
const errors = []
for (const [path, name, theme, waitFor] of cases) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(p => localStorage.setItem('berean_prefs', JSON.stringify(p)), prefs(theme))
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name} console: ${m.text().slice(0, 200)}`) })
  await page.goto(base + path, { waitUntil: 'networkidle' })
  await page.waitForSelector(waitFor, { timeout: 30000 }).catch(e => errors.push(`${name}: ${e.message.split('\n')[0]}`))
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/${name}.png` })
  await ctx.close()
  console.log('shot', name)
}
// interaction: open the reader palette sheet and pick a theme; the body background must change
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(p => localStorage.setItem('berean_prefs', JSON.stringify(p)), prefs('paper'))
const page = await ctx.newPage()
page.on('pageerror', e => errors.push(`interact: ${e.message}`))
await page.goto(base + '/read/43/3', { waitUntil: 'networkidle' })
await page.waitForSelector('text=Nicodemus', { timeout: 30000 })
await page.getByLabel('Theme').first().click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/reader-sheet.png` })
await page.getByLabel('Forest theme').click()
await page.waitForTimeout(700)
await page.screenshot({ path: `${out}/reader-after-forest.png` })
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('berean_prefs') ?? '{}'))
console.log('prefs after pick:', stored.theme, stored.themeDark)
await ctx.close()
await browser.close()
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors')
