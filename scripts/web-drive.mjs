// Production web build drive: chapter turn by keyboard and by edge tap, reduce-motion, footnote, search.
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } })
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message))
const log = {}
await page.goto(base + '/read/43/3', { waitUntil: 'networkidle' }); await page.waitForSelector('text=Nicodemus', { timeout: 30000 })
await page.click('text=John 4 →'); await page.waitForSelector('text=Samaria', { timeout: 15000 }); log.next = page.url()
await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(800); log.afterLeft = page.url()
await page.click('text=†'); await page.waitForTimeout(300); log.allNotes = await page.locator('text=I have hesitated a moment').count()
await page.goto(base + '/search?q=loving-kindness', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); log.search = await page.locator('text=loving-kindness').count()
await page.goto(base + '/read/40/23', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); log.omitted = await page.locator('text=[omitted]').count()
console.log(JSON.stringify({ ...log, errors: errors.slice(0, 5) }))
await browser.close()
