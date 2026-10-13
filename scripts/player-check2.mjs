// Read-aloud with spoken numbers (per-number clips), verse tap seeks, next/prev, no stale-run replay. Needs tts/alec/65-1.* and tts/alec/numbers/*.mp3.
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(() => localStorage.setItem('berean_prefs', JSON.stringify({ theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true, ttsVoice: 'alec', ttsSpeed: 1, ttsNumbers: true, ttsHeading: false, ttsPause: 'short', ttsWord: true, ttsAutoNext: false, ttsDevice: false })))
const page = await ctx.newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
const numberHits = [], audioUrls = []; page.on('request', r => { const m = r.url().match(/numbers\/(\d+)\/audio/); if (m) numberHits.push(+m[1]); if (/\/audio(\.opus)?$/.test(r.url())) audioUrls.push(r.url().split('/api/tts/')[1]) })
await page.goto(base + '/read/65/1', { waitUntil: 'networkidle' }); await page.waitForSelector('text=Jude')
const bar = async () => (await page.locator('text=/^Jude 1(:\\d+)?$/').first().textContent().catch(() => '?'))
await page.getByLabel('Read aloud').click(); await page.waitForTimeout(3500)
console.log('after 3.5s:', await bar(), '| number clips requested:', numberHits.slice(0, 3))
// tap verse 10 while playing → reading moves there, nothing gets selected
await page.getByText(/irrational/).first().click(); await page.waitForTimeout(2500)
console.log('after tapping verse 10:', await bar(), '| selection bar shown:', await page.getByRole('button', { name: 'Deselect' }).isVisible().catch(() => false), '(want false)')
await page.getByLabel('Next verse').click(); await page.waitForTimeout(2500)
const afterNext = await bar(); console.log('after next:', afterNext)
await page.waitForTimeout(3000); console.log('3s later still on or past it:', await bar())
await page.getByLabel('Stop reading').click(); await page.waitForTimeout(400)
// with the player idle, tapping a verse selects it and the action bar shows Listen
await page.getByText(/irrational/).first().click(); await page.waitForTimeout(500)
console.log('idle tap selects:', await page.getByRole('button', { name: 'Deselect' }).isVisible().catch(() => false), '| Listen button:', await page.getByRole('button', { name: 'Listen' }).isVisible().catch(() => false))
await page.getByRole('button', { name: 'Listen' }).click(); await page.waitForTimeout(3000)
console.log('Listen from selection:', await bar(), '| number hits total:', numberHits.length)
console.log('audio urls:', [...new Set(audioUrls)].slice(0, 3))
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors')
await browser.close()
