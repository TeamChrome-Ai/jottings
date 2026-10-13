import { chromium } from 'playwright'
const browser = await chromium.launch()
for (const [w, scale] of [[360, 1], [412, 1], [800, 1]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(p => localStorage.setItem('berean_prefs', JSON.stringify(p)), { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true })
  const page = await ctx.newPage()
  if (scale !== 1) await page.addStyleTag({ content: '' }).catch(() => {})
  await page.goto('http://127.0.0.1:8787/read/1/1', { waitUntil: 'networkidle' })
  if (scale !== 1) await page.evaluate(s => { document.documentElement.style.fontSize = (16 * s) + 'px'; document.querySelectorAll('div[role=button] > div').forEach(el => { el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * s) + 'px' }) }, scale)
  await page.getByLabel('Read aloud').waitFor({ timeout: 15000 }); await page.waitForTimeout(300)
  const bar = await page.evaluate(() => { const btns = [...document.querySelectorAll('div[role=button], button')].slice(0, 12).map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.width), Math.round(r.height), b.getAttribute('aria-label') || b.textContent.trim().slice(0, 12)] }); return { w: innerWidth, btns } })
  console.log(w, 'x', scale, JSON.stringify(bar))
  await page.screenshot({ path: `/tmp/bdb-ui/toolbar-${w}-${scale}.png`, clip: { x: 0, y: 0, width: w, height: 120 } })
  await ctx.close()
}
await browser.close()
