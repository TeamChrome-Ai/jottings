// The chronological table at desktop and phone widths, plus the digit fix in the note on dates.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
mkdirSync('/tmp/bdb-ui', { recursive: true })
const browser = await chromium.launch()
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true, align: 'center', width: 'wide' }
const errors = []
for (const [name, vw, vh, dsf, mobile] of [['chronology-desktop', 1280, 900, 1, false], ['chronology-phone', 390, 780, 2, true]]) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dsf, isMobile: mobile, hasTouch: mobile })
  await ctx.addInitScript(p => localStorage.setItem('berean_prefs', JSON.stringify(p)), prefs)
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`))
  await page.goto(base + '/chronology', { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Rehoboam', { timeout: 30000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `/tmp/bdb-ui/${name}.png` })
  console.log('shot', name, '| sub-line present:', await page.getByText('Every reference opens').isVisible().catch(() => false))
  await ctx.close()
}
const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } })
const page = await ctx.newPage()
await page.goto(base + '/about', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const body = await page.evaluate(() => document.body.innerText)
console.log('about contains "1O95":', body.includes('1O95'), '| "1095":', body.includes('1095'), '| "xxvii. 1O":', body.includes('xxvii. 1O'))
await browser.close()
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors')
