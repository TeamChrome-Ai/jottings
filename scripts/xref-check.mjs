// Footnote cross-reference links against a local server: a same-chapter "ver. 15" must scroll+select, a bare
// continuation "6.29" (book carried from "chs. 4:39") must open John 6.
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(() => localStorage.setItem('berean_prefs', JSON.stringify({ theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true })))
const page = await ctx.newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
await page.goto(base + '/read/43/3', { waitUntil: 'networkidle' })
await page.waitForSelector('text=Nicodemus')
await page.locator('[aria-label*="note c"]:visible, [aria-label="Note c"]:visible').first().click()   // the hidden neighbour pages carry markers too
await page.waitForTimeout(600)
console.log('links in open note:', await page.locator('[role=link]').allTextContents())
await page.screenshot({ path: '/tmp/bdb-ui/xref-note.png' })
await page.getByRole('link', { name: 'ver. 15' }).click()
await page.waitForTimeout(600)
console.log('url after ver. 15:', page.url())
await page.screenshot({ path: '/tmp/bdb-ui/xref-after-ver15.png' })
await page.locator('[aria-label*="note a"]:visible, [aria-label="Note a"]:visible').first().click(); await page.waitForTimeout(500)
console.log('links now:', await page.locator('[role=link]').allTextContents())
await page.getByRole('link', { name: '6.29', exact: true }).click(); await page.waitForTimeout(1500)
console.log('url after 6.29:', page.url())
await page.waitForSelector('text=Philip', { timeout: 15000 }).then(() => console.log('John 6 loaded')).catch(() => console.log('John 6 NOT loaded'))
await page.screenshot({ path: '/tmp/bdb-ui/xref-after-6-29.png' })
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors')
await browser.close()
