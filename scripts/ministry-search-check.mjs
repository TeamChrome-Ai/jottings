// The ministry library's search at a 412 px phone: "Christ for my" lists the paper "Christ for my sins and Christ for my
// cares" (Collected Writings 34) from the server's title search, and tapping it opens the reader on that section;
// "romans 5" still lists the Synopsis and Coates places (the server's duplicate of a place is not listed twice); a query
// nobody wrote ends in "Nothing for …" only after the server has answered.
// BASE=http://127.0.0.1:8790 OUT=/tmp/wt-msearch node scripts/ministry-search-check.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8790'
const out = process.env.OUT ?? '/tmp/wt-msearch'
mkdirSync(out, { recursive: true })
const W = 412, H = 915
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false, align: 'center', width: 'medium', onboarded: true, toured: true }
const browser = await chromium.launch()
const errors = []
let failed = 0
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failed++ }
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(p => { if (!sessionStorage.getItem('primed')) { localStorage.setItem('berean_prefs', p); sessionStorage.setItem('primed', '1') } }, JSON.stringify(prefs))
const page = await ctx.newPage()
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|status of 404|when fetching the script/.test(m.text())) errors.push('console: ' + m.text()) })
const shot = async (name, wait = 700) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name) }
const params = () => Object.fromEntries(new URL(page.url()).searchParams)
const PAPER = 'Christ for my sins and Christ for my cares'

await page.goto(base + '/companion', { waitUntil: 'networkidle' })
const input = page.getByPlaceholder('Search by passage or title')
await input.waitFor({ timeout: 30000 })

// 1. a paper inside a volume, by its title
const requests = []
page.on('request', r => { if (r.url().includes('/api/ministry/search')) requests.push(new URL(r.url()).searchParams.get('q')) })
await input.pressSequentially('Christ for my', { delay: 60 })
const paper = page.getByText(PAPER, { exact: true })
await paper.waitFor({ timeout: 15000 })
ok('typing "Christ for my" lists the paper from Collected Writings 34', await paper.isVisible())
ok(`the server was asked once, after typing stopped (${JSON.stringify(requests)})`, requests.length === 1 && requests[0] === 'Christ for my')
ok('its line names the author and the volume', await page.getByText(/Darby · Collected Writings 34/).first().isVisible())
ok('no "Nothing for" once there is a hit', !(await page.getByText(/^Nothing for/).count()))
await shot('search-christ-for-my')
await paper.click()
await page.waitForTimeout(1500)
const p1 = params()
ok(`tapping it opens the reader on that section (${JSON.stringify(p1)})`, p1.author === 'darby' && p1.work === 'cw-miscellaneous-3' && p1.n === '39')
ok('… with the paper’s title on the page', (await page.getByText(PAPER, { exact: true }).filter({ visible: true }).count()) > 0)
await shot('search-hit-opened')

// 2. a passage: the Synopsis and Coates places, each once
await page.goto(base + '/companion', { waitUntil: 'networkidle' })
await input.waitFor({ timeout: 30000 })
await input.fill('romans 5')
await page.getByText('Romans 5:1–11', { exact: true }).first().waitFor({ timeout: 15000 })
await page.waitForTimeout(1200)
const synopsis = await page.getByText('Romans 5:1–11', { exact: true }).count()
const coates = await page.getByText(/^Coates · /).count()
ok(`"romans 5" lists the Synopsis place once (${synopsis}) and Coates (${coates})`, synopsis === 1 && coates >= 1)
ok('… and no "Nothing for"', !(await page.getByText(/^Nothing for/).count()))
await shot('search-romans-5')

// 3. nothing anywhere, once the server has answered
await input.fill('zzqx nothing here')
await page.getByText('Nothing for “zzqx nothing here”.').waitFor({ timeout: 15000 })
ok('a query nobody wrote ends in "Nothing for …" after the server answers', true)

// (Back-clears-search is a `beforeRemove` listener, which the browser's Back button does not raise on web; the phone's
// hardware Back does. Not checked here.)

ok(`no page errors (${errors.length})`, errors.length === 0)
if (errors.length) console.log(errors.join('\n'))
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all ok')
process.exit(failed ? 1 : 0)
