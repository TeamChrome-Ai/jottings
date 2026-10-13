// Sheet drag-to-dismiss, phone Settings hides the width row, "jn 3v16" opens John 3:16.
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(p => localStorage.setItem('berean_prefs', JSON.stringify(p)), { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false })
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message))
await page.goto(base + '/read/43/3', { waitUntil: 'networkidle' })
await page.getByLabel('More').click(); await page.waitForTimeout(700)
console.log('sheet open:', await page.getByText('Text size').isVisible())
const h = await page.getByLabel('Drag down to close').boundingBox()
await page.touchscreen.tap(h.x + h.width / 2, h.y + 10)   // tap must not close it
await page.waitForTimeout(300); console.log('still open after tap on handle:', await page.getByText('Text size').isVisible())
// drag the handle down 250px
const cdp = await ctx.newCDPSession(page)
const x = h.x + h.width / 2, y0 = h.y + 10
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + i * 25 }] }); await page.waitForTimeout(16) }
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await page.waitForTimeout(600)
console.log('closed after drag:', !(await page.getByText('Text size').isVisible().catch(() => false)))
await page.goto(base + '/settings', { waitUntil: 'networkidle' })
console.log('width row on phone:', await page.getByText('Width', { exact: true }).isVisible().catch(() => false), '(want false)')
await page.goto(base + '/search', { waitUntil: 'networkidle' })
await page.getByRole('searchbox').or(page.getByPlaceholder(/search|reference|jn/i)).first().fill('jn 3v16'); await page.keyboard.press('Enter'); await page.waitForTimeout(1200)
console.log('3v16 →', page.url().replace(base, ''))
const wide = await browser.newContext({ viewport: { width: 900, height: 800 } }); const p2 = await wide.newPage()
await p2.addInitScript(() => localStorage.setItem('berean_prefs', JSON.stringify({ theme: 'paper' }))); await p2.goto(base + '/settings', { waitUntil: 'networkidle' })
console.log('width row on wide:', await p2.getByText('Width', { exact: true }).isVisible().catch(() => false), '(want true)')
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors')
await browser.close()
