// The first-launch welcome at 412 px: a video of the whole thing, stills at each beat, Skip, no second showing,
// the Settings replay (ending in a chosen chapter), the Reduce-animation still, a dark theme, and frame pacing.
// BASE = a throwaway server; OUT = where the video, stills and the pacing report go.
import { chromium } from 'playwright'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8793'
const out = process.env.OUT ?? '/tmp/wt-onboard'
mkdirSync(`${out}/video`, { recursive: true })
const VIEW = { width: 412, height: 915 }
/** ONLY=pacing runs the frame-pacing pass alone. */
const only = process.env.ONLY
const browser = await chromium.launch()
const errors = []
const check = (label, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1 }
const phone = async ({ video = false, prefs = null, frames = false } = {}) => {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...(video ? { recordVideo: { dir: `${out}/video`, size: VIEW } } : {}) })
  if (prefs) await ctx.addInitScript(p => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('berean_prefs', JSON.stringify(p)); sessionStorage.setItem('seeded', '1') } }, prefs)
  if (frames) await ctx.addInitScript(() => {
    const f = window.__frames = []
    const tick = t => { f.push(t); requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  return { ctx, page }
}
const skipBtn = page => page.getByRole('button', { name: 'Skip the welcome' })
const shown = async (loc, ms = 2500) => loc.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false)
const storedPrefs = page => page.evaluate(() => JSON.parse(localStorage.getItem('berean_prefs') ?? 'null'))
const FULL = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false, align: 'center', width: 'medium', onboarded: false, readerName: '' }

// 1. stills at each beat, exact: Playwright's clock is paused and stepped, so a screenshot never lands late
const BEATS = [[600, '01-genesis'], [2300, '02-words'], [4300, '03-verse'], [4850, '04-caller'], [5150, '05-note-blooms'], [6400, '06-note-open'],
  [7300, '07-folding'], [7800, '08-jots'], [8300, '09-gathering'], [8900, '10-letters'], [9450, '11-tittle-falls'], [9760, '12-tittle-lands'],
  [10300, '13-name'], [10800, '14-lift'], [11600, '15-handoff']]
if (!only) {
  const { ctx, page } = await phone()
  await page.clock.install()
  await page.clock.pauseAt(Date.now() + 500)
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  for (let i = 0; i < 400 && !(await skipBtn(page).isVisible().catch(() => false)); i++) await page.clock.runFor(50)
  let now = 0
  for (const [ms, name] of BEATS) { await page.clock.runFor(ms - now); now = ms; await page.screenshot({ path: `${out}/${name}.png` }) }
  await ctx.close()
}

// 2. first launch on a fresh device, filmed in real time from load to Home
if (!only) {
  const { ctx, page } = await phone({ video: true })
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  check('fresh device: no saved settings', (await storedPrefs(page)) === null)
  check('first launch shows the welcome with Skip from the start', await shown(skipBtn(page), 15000))
  await page.waitForTimeout(11000)
  const begin = page.getByRole('button', { name: 'Begin', exact: true })
  // a trial click passes only once nothing lies over the button: the form takes taps from the hand-off on
  check('hand-off offers Begin (tappable)', await begin.click({ trial: true, timeout: 4000 }).then(() => true, () => false))
  const text = await page.evaluate(() => document.body.innerText)
  check('hand-off has name, where to begin and sign in later', text.includes('Your name') && text.includes('Where to begin') && text.includes('Sign in later'))
  await page.getByLabel('Your name, optional').fill('Anna')
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${out}/16-handoff-named.png` })
  await begin.click()
  check('Begin closes the welcome', await skipBtn(page).waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false))
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/17-home.png` })
  const home = await page.evaluate(() => document.body.innerText)
  check('Home greets by name', /(morning|afternoon|evening|night), Anna/.test(home))
  const p = await storedPrefs(page)
  check('onboarded and the name are saved', p?.onboarded === true && p?.readerName === 'Anna')
  const video = page.video()
  await ctx.close()
  const path = await video.path()
  renameSync(path, `${out}/welcome.webm`)
  console.log('video', `${out}/welcome.webm`)
}

// 3. Skip mid-animation, then the second launch shows nothing, then Settings plays it again
if (!only) {
  const { ctx, page } = await phone()
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  check('welcome shows again on another fresh device', await shown(skipBtn(page), 15000))
  await page.waitForTimeout(3000)
  const t = Date.now()
  await skipBtn(page).click()
  const gone = await skipBtn(page).waitFor({ state: 'detached', timeout: 2000 }).then(() => true, () => false)
  check(`Skip mid-verse closes it (${Date.now() - t} ms)`, gone)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/20-after-skip.png` })
  check('skipping counts as seen', (await storedPrefs(page))?.onboarded === true)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('Library').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(2500)
  check('second launch: no welcome', !(await skipBtn(page).isVisible().catch(() => false)))
  await page.screenshot({ path: `${out}/21-second-launch.png` })

  await page.goto(base + '/settings', { waitUntil: 'networkidle' })
  // Settings → Welcome and tour → Welcome
  const again = page.getByRole('button', { name: 'Welcome and tour' })
  await again.scrollIntoViewIfNeeded(); await again.click(); await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/22-settings-row.png` })
  await page.getByRole('dialog').getByRole('button', { name: 'Welcome', exact: true }).click()
  check('Settings replays the welcome', await shown(skipBtn(page), 3000))
  await page.waitForTimeout(6000)
  await page.screenshot({ path: `${out}/23-replay-note.png` })
  await page.getByRole('button', { name: 'Begin', exact: true }).waitFor({ timeout: 9000 })
  await page.getByRole('radio', { name: /A book of your choice/ }).click()
  // the picker's cells are named in full for a screen reader ("Psalms", "Psalms 23"), the chip shows "Ps"
  await page.getByRole('button', { name: 'Psalms', exact: true }).click()
  await page.getByRole('button', { name: 'Psalms 23', exact: true }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/24-replay-chosen.png` })
  const read = page.getByRole('button', { name: 'Read Psalms 23' })
  check('the button names the chosen chapter', await shown(read, 2000))
  await read.click()
  await page.waitForURL(/\/read\/19\/23/, { timeout: 5000 }).then(() => check('Begin opens Psalms 23', true), () => check('Begin opens Psalms 23', false))
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/25-psalm-23.png` })
  await ctx.close()
}

// 4. Reduce animation: a still page, crossfaded to the hand-off
if (!only) {
  const { ctx, page } = await phone({ prefs: { ...FULL, reduceMotion: true } })
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  check('Reduce animation still shows the welcome', await shown(skipBtn(page), 15000))
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/30-reduce-page.png` })
  check('Reduce animation reaches the hand-off', await page.getByRole('button', { name: 'Begin', exact: true }).click({ trial: true, timeout: 8000 }).then(() => true, () => false))
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/31-reduce-handoff.png` })
  await ctx.close()
}

// 5. a dark theme, the note and the name
if (!only) {
  const { ctx, page } = await phone({ prefs: { ...FULL, theme: 'slate' } })
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await skipBtn(page).waitFor({ timeout: 15000 })
  const t0 = Date.now()
  for (const [ms, name] of [[6600, '40-dark-note'], [9900, '41-dark-name'], [11700, '42-dark-handoff']]) { await page.waitForTimeout(ms - (Date.now() - t0)); await page.screenshot({ path: `${out}/${name}.png` }) }
  await ctx.close()
}

// 6. frame pacing: requestAnimationFrame deltas across the whole animation, as is and with the CPU slowed 4x
const pacing = {}
for (const [label, rate] of [['desktop', 1], ['cpu-4x', 4]]) {
  const { ctx, page } = await phone({ frames: true })
  if (rate > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate }) }
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await skipBtn(page).waitFor({ timeout: 30000 })
  // thread CPU time of the renderer's main thread: unlike frame deltas, not inflated by other load on the machine
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] })
  const start = await page.evaluate(() => performance.now())
  await page.getByRole('button', { name: 'Begin', exact: true }).click({ trial: true, timeout: 40000 })
  await page.waitForTimeout(1200)
  const end = await page.evaluate(() => performance.now())
  const trace = JSON.parse((await browser.stopTracing()).toString())
  const main = trace.traceEvents.find(e => e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
  const tasks = trace.traceEvents.filter(e => e.name === 'RunTask' && e.ph === 'X' && main && e.pid === main.pid && e.tid === main.tid)
  const cpu = tasks.reduce((n, e) => n + (e.tdur ?? e.dur ?? 0), 0) / 1000
  const span = tasks.length ? (Math.max(...tasks.map(e => e.ts + e.dur)) - Math.min(...tasks.map(e => e.ts))) / 1000 : 1
  const f = (await page.evaluate(() => window.__frames)).filter(t => t >= start && t <= end)
  const d = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b)
  const q = x => d[Math.min(d.length - 1, Math.floor(x * d.length))]
  const r = { mainThreadCpuPct: +(100 * cpu / span).toFixed(1), longestTaskCpuMs: +(Math.max(0, ...tasks.map(e => (e.tdur ?? 0) / 1000))).toFixed(1), seconds: +((end - start) / 1000).toFixed(2), frames: f.length, fps: +(f.length / ((end - start) / 1000)).toFixed(1), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), max: +d[d.length - 1].toFixed(1), over20: d.filter(x => x > 20).length, over33: d.filter(x => x > 33.4).length }
  // long frames by second of the animation, to see which beat they fall in
  r.longBySecond = Array.from({ length: Math.ceil(r.seconds) }, (_, i) => f.slice(1).filter((t, j) => t - f[j] > 20 && Math.floor((t - start) / 1000) === i).length)
  pacing[label] = r
  console.log('pacing', label, JSON.stringify(r))
  await ctx.close()
}
writeFileSync(`${out}/pacing.json`, JSON.stringify(pacing, null, 2))

await browser.close()
const real = errors.filter(e => !/useNativeDriver|Failed to load resource/.test(e))
console.log(real.length ? 'ERRORS: ' + real.join(' | ') : 'no page errors')
