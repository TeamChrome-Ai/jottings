// Verse landing (centred, range tinted), desktop share fallback, and a word study's paged occurrences.
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] })
await ctx.addInitScript(() => localStorage.setItem('berean_prefs', JSON.stringify({ theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true, align: 'center', width: 'medium' })))
const page = await ctx.newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
// 1. range landing: Rom 8:28-30 → 28 near the middle, 28-30 tinted, 27 and 31 not
await page.goto(base + '/read/45/8?v=28&v2=30', { waitUntil: 'networkidle' })
await page.waitForSelector('text=all things work together'); await page.waitForTimeout(700)
const pos = await page.evaluate(() => {
  const find = n => [...document.querySelectorAll('span')].find(s => s.textContent?.trim() === String(n) && s.getBoundingClientRect().width < 40)
  const tinted = n => { let el = find(n)?.parentElement; while (el && getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)') el = el.parentElement; return !!el && el.tagName !== 'BODY' && el.getBoundingClientRect().width < 600 }
  const r = find(28)?.getBoundingClientRect()
  return { y28: r ? Math.round(r.y) : null, tinted: [27, 28, 29, 30, 31].map(n => tinted(n)) }
})
console.log('v28 y in 780px viewport:', pos.y28, '(centred if ~250-450) | tinted 27..31:', pos.tinted)
await page.screenshot({ path: '/tmp/bdb-ui/range-landing.png' })
// 2. desktop share: no navigator.share → clipboard + toast
await page.evaluate(() => { delete navigator.share })
await page.getByText('all things work together').first().click(); await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Share' }).click(); await page.waitForTimeout(600)
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '(clipboard unreadable)')
console.log('share toast:', await page.getByText('Copied with link').isVisible().catch(() => false), '| clipboard has link:', /\/read\/45\/8\?v=28/.test(clip))
// 3. a word study's occurrences: 30 verses a page, and the pager turns to the next (phones keep word lookup behind More)
await page.goto(base + '/read/43/3', { waitUntil: 'networkidle' }); await page.waitForSelector('text=Nicodemus')
await page.getByLabel('More').click(); await page.waitForTimeout(500)
await page.getByRole('switch', { name: 'Word lookup' }).first().click(); await page.waitForTimeout(300)
await page.mouse.click(200, 120); await page.waitForTimeout(1200)   // scrim above the sheet
await page.locator('[aria-label*="Strong’s"]').filter({ hasText: /^believes$/ }).first().click(); await page.waitForTimeout(2000)
// the occurrences fold to one line of totals; it opens in place
await page.getByRole('button', { name: /\d+ occurrences in \d+ verses/ }).click(); await page.waitForTimeout(800)
const rows = () => page.getByLabel(/^Read .+ \d+:\d+$/).count()
const before = await rows()
const next = page.getByRole('button', { name: 'Next page' })
console.log('pager visible:', await next.isVisible().catch(() => false), '| rows on page 1:', before)
await next.click(); await page.waitForTimeout(2000)
console.log('rows on page 2:', await rows())
await page.screenshot({ path: '/tmp/bdb-ui/strongs-more.png' })
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors')
await browser.close()
