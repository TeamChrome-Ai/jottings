// A link's arrival params act once. After read aloud went on into 3 John by itself, a turn to Jude started reading
// Jude from verse 1 though the reader had paused; after a jotting's "JND on John 3:16" link, every turn opened the
// ministry again. Paged mode opened with v=1 (the top of the chapter, as the reader hands it) lands on page 1, not on
// the saved place.
// Needs a server whose BEREAN_DATA has tts/alec/63-1.*, 64-1.* and 65-1.*; BASE picks the build (default
// 127.0.0.1:8787). For a branch, an export served with /api and the chapters proxied to that server.
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const only = process.argv.slice(2)
const prefs = { theme: 'paper', font: 'serif', fontSize: 19, reduceMotion: true, ttsVoice: 'alec', ttsSpeed: 1.5, ttsNumbers: false, ttsHeading: false, ttsPause: 'short', ttsWord: false, ttsAutoNext: true, ttsDevice: false, tourDone: true }
const visible = (page, sel) => page.locator(`${sel} >> visible=true`).first().isVisible().catch(() => false)
const path = page => new URL(page.url()).pathname
const until = async (ok, ms) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 300))) if (await ok()) return true; return false }

const flows = {
  'read aloud stays paused on a turn after going on by itself': async page => {
    await page.goto(base + '/read/63/1', { waitUntil: 'networkidle' })
    await page.getByLabel('Read aloud').first().click()
    await page.getByLabel('Pause').first().waitFor({ timeout: 15000 })
    for (let i = 0; i < 20 && !await visible(page, 'text=/^2 John (1:)?12$/'); i++) {
      await page.getByLabel('Next verse').first().click({ timeout: 2000 }).catch(() => {})
      await page.waitForTimeout(300)
    }
    if (!await until(async () => path(page) === '/read/64/1' && await visible(page, 'text=/^3 John (1:)?\\d+$/'), 60000)) return `never went on into 3 John (url ${path(page)})`
    await page.getByLabel('Pause').first().click()
    await page.getByLabel('Play').first().waitFor({ timeout: 5000 })
    await page.keyboard.press('ArrowRight')
    if (!await until(async () => path(page) === '/read/65/1', 10000)) return `the turn did not reach Jude (url ${path(page)})`
    await page.waitForTimeout(5000)
    const playing = await visible(page, '[aria-label="Pause"]')
    const jude = await visible(page, 'text=/^Jude (1:)?\\d+$/')
    return playing || jude ? `read aloud started again on Jude (${playing ? 'playing' : 'paused'}${jude ? ', the bar on Jude' : ''})` : ''
  },
  'a ministry link opens the ministry once': async page => {
    await page.goto(base + '/read/43/3?v=16&ministry=darby', { waitUntil: 'networkidle' })
    const sheet = () => visible(page, '[aria-label="Drag down to close"]')
    if (!await until(async () => await sheet() && await visible(page, 'text="John 3:16"'), 15000)) return 'the link did not open the ministry on John 3:16'
    await page.keyboard.press('Escape')
    if (!await until(async () => !await sheet(), 5000)) return 'the ministry did not close'
    await page.waitForTimeout(800)
    await page.keyboard.press('ArrowRight')
    if (!await until(async () => path(page) === '/read/43/4', 10000)) return `the turn did not reach John 4 (url ${path(page)})`
    await page.waitForTimeout(3000)
    return await sheet() ? 'the ministry opened again on John 4' : ''
  },
  'paged mode lands on v=1': async page => {
    await page.addInitScript(() => localStorage.setItem('berean_pos', JSON.stringify({ book: 43, chapter: 3, verse: 20 })))
    await page.goto(base + '/flip/43/3?v=1', { waitUntil: 'networkidle' })
    let at = null
    await until(async () => (at = await page.evaluate(() => /page (\d+) of (\d+)/.exec(document.body.textContent ?? '')?.[1] ?? null)) !== null, 30000)
    return at === '1' ? '' : `landed on page ${at ?? 'none'}`
  },
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
let failed = 0
for (const [name, flow] of Object.entries(flows)) {
  if (only.length && !only.includes(name)) continue
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
  await ctx.addInitScript(p => localStorage.setItem('berean_prefs', JSON.stringify(p)), prefs)
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const why = await flow(page).catch(e => `threw: ${e.message.split('\n')[0]}`)
  if (why) failed++
  console.log(`${why ? 'FAIL' : 'pass'}  ${name}${why ? `  (${why})` : ''}${errors.length ? `  errors: ${errors.join(' | ')}` : ''}`)
  await ctx.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
