// Settings → Listening → "Hear Alec": the button flips to Stop while the sample plays and comes back on its own
// when the clip ends (Psalm 23:1-3, about 14 s); a second press while playing stops it at once.
// BASE = a served build with tts/alec/19-23.* under its data dir.
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
await ctx.addInitScript(() => { localStorage.setItem('berean_prefs', JSON.stringify({ onboarded: true, toured: true, ttsVoice: 'alec' })) })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
const check = (label, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1 }
await page.goto(`${base}/settings`)
await page.getByText('Voice, speed and pauses').click()
const hear = page.getByRole('button', { name: /Hear a sample of Alec/ })
await hear.waitFor({ timeout: 10000 })
check('Hear Alec is on the sheet', await hear.isVisible())
await page.evaluate(() => { window.__played = []; const P = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__played.push(this.currentSrc || this.src); return P.call(this) } })
await hear.click()
const stop = page.getByRole('button', { name: /Stop the sample of Alec/ })
await stop.waitFor({ timeout: 5000 })
check('the button turns into Stop', await stop.isVisible())
await page.waitForTimeout(1500)
const played = await page.evaluate(() => window.__played)
check('the preview clip is what plays', played.some(u => /\/api\/tts\/alec\/preview\/audio/.test(u)))
await stop.click()
await hear.waitFor({ timeout: 3000 })
check('a press while playing stops it', await hear.isVisible())
await hear.click(); await stop.waitFor({ timeout: 5000 })
await hear.waitFor({ timeout: 20000 })
check('the button comes back when the clip ends', await hear.isVisible())
check('no page errors', errors.length === 0)
if (errors.length) console.log(errors.join('\n'))
await browser.close()
