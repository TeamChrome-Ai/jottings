// usage: node scripts/shot.mjs <path> <out.png> [--mobile] [--dark] [--cookie token]
import { chromium } from 'playwright'
const [,, path = '/', out = '/tmp/shot.png', ...flags] = process.argv
const mobile = flags.includes('--mobile')
const dark = flags.includes('--dark')
const tokenIdx = flags.indexOf('--token')
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, colorScheme: dark ? 'dark' : 'light', isMobile: mobile, hasTouch: mobile })
if (tokenIdx >= 0) await ctx.addInitScript(t => { localStorage.setItem('berean_token', t); localStorage.setItem('berean.token', t) }, flags[tokenIdx + 1])
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await page.goto((process.env.BASE ?? 'http://127.0.0.1:5173') + path, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.screenshot({ path: out, fullPage: false })
console.log(JSON.stringify({ url: page.url(), title: await page.title(), errors: errors.slice(0, 10) }))
await browser.close()
