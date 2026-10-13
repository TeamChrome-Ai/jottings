// Offline verification: read a chapter online, download all, go offline, read another chapter, search.
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
if (process.env.TOKEN) await ctx.addInitScript(t => localStorage.setItem('berean_token', t), process.env.TOKEN)
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.goto(base + '/read/43/3', { waitUntil: 'networkidle' })
await page.waitForTimeout(9000)   // let the deferred service worker register + precache
const sw = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()))
const dl = await page.evaluate(async () => {
  const m = await import('/src/lib/bible.ts').catch(() => null) // dev only
  return m ? 'dev' : 'prod'
})
// production: trigger the same code path the Settings button uses, through the UI
await page.goto(base + '/settings', { waitUntil: 'networkidle' })
const hasBtn = await page.locator('text=Download all').count()
if (hasBtn) { await page.click('text=Download all'); await page.waitForSelector('text=Whole Bible available offline', { timeout: 120000 }) }
const status = await page.locator('.chip').first().textContent()
await ctx.setOffline(true)
await page.goto(base + '/read/19/23', { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForSelector('.reader .vv', { timeout: 20000 })
const ps23 = await page.locator('#v1').textContent()
await page.goto(base + '/search?q=shepherd', { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForSelector('.hit', { timeout: 60000 })
const info = await page.locator('.search-box .tiny').textContent()
const first = await page.locator('.hit .ref').first().textContent()
await page.goto(base + '/read/1/1#v3', { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForSelector('.reader .vv', { timeout: 20000 })
await page.screenshot({ path: '/tmp/shot-offline.png' })
console.log(JSON.stringify({ sw, mode: dl, status, ps23: ps23?.slice(0, 50), search: info, first, errors: errors.slice(0, 5) }))
await browser.close()
