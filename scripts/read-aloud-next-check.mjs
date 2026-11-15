// Read aloud moves on to the next chapter wherever the reader is in the app (reports #28 and #44 ended "no reader to
// move on"). Each flow starts 2 John on the web build, skips to verse 12, goes somewhere and lets the chapter end. It
// passes when 3 John is then reading, at least `from` verses in (it went on while the reader was away), and the URL is
// `url` where the reader showing 2 John should have turned with it.
// Needs a server whose BEREAN_DATA has tts/alec/63-1.* and 64-1.*; BASE picks the build (default 127.0.0.1:8787).
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const only = process.argv.slice(2)
const prefs = { theme: 'paper', font: 'serif', fontSize: 19, reduceMotion: true, ttsVoice: 'alec', ttsSpeed: 1.5, ttsNumbers: false, ttsHeading: false, ttsPause: 'short', ttsWord: false, ttsAutoNext: true, ttsDevice: false, tourDone: true }

const tab = (page, name) => page.getByRole('tab', { name }).or(page.getByRole('link', { name })).first().click()
const pushChapter = async page => {
  await tab(page, 'Search')
  await page.waitForTimeout(800)
  await page.getByPlaceholder('jn 3:16, words, or G1320').fill('Jude 1')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1500)
  await page.locator('text=/Jude 1/ >> visible=true').first().click({ timeout: 5000 })
}
const away = async (page, ms) => { await tab(page, 'Home'); await page.waitForTimeout(ms); await tab(page, 'Read') }

const turned = '/read/64/1'
const flows = {
  stay: { act: async () => {}, url: turned },
  'home tab through the end': { act: page => away(page, 30_000), url: turned, from: 5 },
  'home tab and back': { act: page => away(page, 800), url: turned },
  'read tab again': { act: page => tab(page, 'Read') },
  'paged and back': { act: async page => { await page.getByLabel('More', { exact: true }).first().click(); await page.waitForTimeout(600); await page.getByText('Paged mode', { exact: true }).first().click(); await page.waitForTimeout(2000); await page.goBack() } },
  'another chapter on top': { act: pushChapter, url: '/read/65/1' },
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
let failed = 0
for (const [name, { act, url, from = 1 }] of Object.entries(flows)) {
  if (only.length && !only.includes(name)) continue
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })
  await ctx.addInitScript(p => localStorage.setItem('berean_prefs', JSON.stringify(p)), prefs)
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(base + '/read/63/1', { waitUntil: 'networkidle' })
  await page.getByLabel('Read aloud').first().click()
  await page.getByLabel('Pause').first().waitFor({ timeout: 15000 })
  for (let i = 0; i < 20 && !await page.locator('text=/^2 John (1:)?12$/ >> visible=true').first().isVisible().catch(() => false); i++) {
    await page.getByLabel('Next verse').first().click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(300)
  }
  await act(page)
  const verse = async () => Number((await page.locator('text=/^3 John (1:)?\\d+$/ >> visible=true').first().textContent({ timeout: 200 }).catch(() => '')).match(/(\d+)$/)?.[1] ?? 0)
  let v = 0
  for (let i = 0; i < 60 && !v; i++) { v = await verse(); if (!v) await page.waitForTimeout(1000) }
  const playing = await page.locator('[aria-label="Pause"] >> visible=true').first().isVisible().catch(() => false)
  const at = new URL(page.url()).pathname
  const ok = v >= from && playing && (!url || at === url)
  if (!ok) failed++
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}  (3 John verse ${v || 'none'}${from > 1 ? `, want ${from}+` : ''}, ${playing ? 'playing' : 'not playing'}, url ${at}${url ? `, want ${url}` : ''})${errors.length ? `  errors: ${errors.join(' | ')}` : ''}`)
  await ctx.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
