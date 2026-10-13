// The short tour on the web build, at each width in VIEWS (360 and 412 px): a still per step, each spotlight checked
// against the element its words name (scripts/tour-spots.mjs), Skip mid-tour, no tour on the second launch or over a
// shared link, the Settings replay, Reduce animation and a dark theme; at 800 px (SPOT_VIEWS) the spotlights again,
// where the toolbar holds word lookup; at 412 px a video of a fresh device's welcome flowing into the tour, and frame
// pacing through the spotlight glides.
// BASE = a throwaway server; OUT = where the video, stills and the pacing report go; ONLY=pacing|video|views|spots.
import { chromium } from 'playwright'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { landed, stepByText } from './tour-spots.mjs'
const base = process.env.BASE ?? 'http://127.0.0.1:8795'
const out = process.env.OUT ?? '/tmp/wt-tour'
const only = process.env.ONLY
const want = k => !only || only === k
const VIEWS = (process.env.VIEWS ?? '360,412').split(',').map(Number)
const SPOT_VIEWS = (process.env.SPOT_VIEWS ?? '800').split(',').filter(Boolean).map(Number)
mkdirSync(`${out}/video`, { recursive: true })
const size = w => ({ width: w, height: w >= 720 ? 1000 : 915 })
const browser = await chromium.launch()
const errors = []
const check = (label, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1 }
const PREFS = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false, align: 'center', width: 'medium', onboarded: true, toured: false, readerName: '' }
const phone = async ({ w = 412, video = false, prefs = null, frames = false } = {}) => {
  const VIEW = size(w)
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: w < 720, hasTouch: true, ...(video ? { recordVideo: { dir: `${out}/video`, size: VIEW } } : {}) })
  // seeded once per tab, so a reload is a true second launch
  if (prefs) await ctx.addInitScript(p => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('berean_prefs', JSON.stringify(p)); sessionStorage.setItem('seeded', '1') } }, prefs)
  if (frames) await ctx.addInitScript(() => { const f = window.__frames = []; const tick = t => { f.push(t); requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  return { ctx, page }
}
const skipTour = page => page.getByRole('button', { name: 'Skip the tour' })
const nextBtn = (page, last) => page.getByRole('button', { name: last ? 'Done' : 'Next', exact: true })
/** The short tour's Done now offers the full tour; these checks take "That's enough". */
const enough = page => page.getByRole('button', { name: 'That’s enough' }).click({ timeout: 6000 })
const stepIs = async (page, n) => page.getByLabel(`Step ${n} of 6`).waitFor({ timeout: 8000 }).then(() => true, () => false)
const shown = async (loc, ms = 2500) => loc.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false)
const visible = loc => loc.first().isVisible().catch(() => false)
const storedPrefs = page => page.evaluate(() => JSON.parse(localStorage.getItem('berean_prefs') ?? 'null'))
/** The label's words: the Skip pill sits in the footer, whose parent is the label. */
const labelText = async page => ((await skipTour(page).last().locator('xpath=../../..').innerText().catch(() => '')) || '').split('\n')[0]
/** Waits for the label of step `n` to be up and still, then takes the still. */
const settle = async (page, n, name) => {
  check(`step ${n} shows`, await stepIs(page, n))
  await page.waitForTimeout(900)
  if (name) await page.screenshot({ path: `${out}/${name}.png` })
}
const ORDER = { false: ['picker', 'note', 'verse', 'lookup', 'listen', 'tabs'], true: ['picker', 'note', 'verse', 'lookup-wide', 'listen', 'tabs'] }
/** Step `n`'s spotlight is round what its words name, and the step is the one expected there. */
const lands = async (page, n, w) => {
  const step = stepByText(await labelText(page), w >= 720)
  check(`${w} px step ${n} is ${ORDER[w >= 720][n - 1]}`, step?.id === ORDER[w >= 720][n - 1])
  if (!step) return
  const r = await landed(page, step.id, size(w))
  check(`${w} px step ${n} (${step.id}) spotlight lands on what it names${r.ok ? '' : `: ${r.why}`}`, r.ok)
}
/** The scene each step sets, as a reader sees it. */
const scene = async (page, n, w) => {
  if (n === 2) check(`${w} px: the tour opened a note in place`, await visible(page.getByRole('button', { name: 'Close note' })))
  if (n === 3) {
    check(`${w} px: a verse is selected, its bar up`, await visible(page.getByRole('button', { name: 'Highlight yellow' })))
    check(`${w} px: the bar offers Ministry on it`, await shown(page.getByRole('button', { name: /^Ministry on .+:\d/ }), 3000))
  }
  if (n === 4 && w < 720) check(`${w} px: word lookup is shown where it is, in More`, await visible(page.getByRole('dialog').getByText('Word lookup', { exact: true })))
  if (n === 5) check(`${w} px: the More sheet and the selection are closed again`, !(await visible(page.getByRole('dialog'))) && !(await visible(page.getByRole('button', { name: 'Highlight yellow' }))))
}

// 1. a fresh device at 412 px: the welcome, Begin, and the tour through to the reader, filmed
if (want('video')) {
  const { ctx, page } = await phone({ video: true })
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  check('fresh device: no saved settings', (await storedPrefs(page)) === null)
  await page.getByRole('button', { name: 'Begin', exact: true }).click({ timeout: 30000 })
  check('Begin hands over to the tour', await shown(skipTour(page), 8000))
  // no stills in the filmed run: a screenshot taken while recording leaves a stray rescaled frame in the video
  for (let i = 0; i < 6; i++) {
    await settle(page, i + 1, null)
    await page.waitForTimeout(700)
    await nextBtn(page, i === 5).click()
  }
  await page.waitForTimeout(1400)
  await enough(page)
  await page.waitForTimeout(800)
  check('ends on the reader', /\/read\/43\/1/.test(page.url()))
  check('says goodbye', await visible(page.getByText('That’s it. Read well.')))
  check('the tour is gone after its fade', await page.getByText('That’s it. Read well.').waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false))
  await page.waitForTimeout(400)
  check('no sheet, no selection bar left', !(await visible(page.getByRole('dialog'))) && !(await visible(page.getByRole('button', { name: 'Highlight yellow' }))))
  // nothing left in front of the controls: the book button takes taps again
  await page.getByRole('button', { name: /^John 1/ }).click({ timeout: 3000 })
  check('controls answer after the tour (the picker opens)', await shown(page.getByText('Books', { exact: true }), 3000))
  const p = await storedPrefs(page)
  check('toured and onboarded are saved', p?.toured === true && p?.onboarded === true)
  const video = page.video()
  await ctx.close()
  renameSync(await video.path(), `${out}/short-tour.webm`)
  console.log('video', `${out}/short-tour.webm`)
}

// 2. per width: a still per step with its spotlight checked; Skip, second launch, the Settings replay; a shared link;
// Reduce animation and a dark theme
if (want('views')) for (const w of VIEWS) {
  const dir = `${out}/${w}`
  mkdirSync(dir, { recursive: true })
  {
    const { ctx, page } = await phone({ w, prefs: PREFS })
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
    await skipTour(page).waitFor({ timeout: 15000 })
    for (let i = 0; i < 6; i++) {
      await settle(page, i + 1, `${w}/0${i + 1}-${ORDER[w >= 720][i]}`)
      await lands(page, i + 1, w)
      await scene(page, i + 1, w)
      await nextBtn(page, i === 5).click()
    }
    check(`${w} px: the short tour ends on the choice`, await shown(page.getByRole('button', { name: 'Keep going: the full tour' }), 5000))
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${dir}/07-choice.png` })
    await enough(page)
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${dir}/08-opening-out.png` })
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${dir}/09-read-well.png` })
    await ctx.close()
  }
  {
    const { ctx, page } = await phone({ w, prefs: PREFS })
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
    check(`${w} px: an unfinished tour resumes on a launch at Home`, await shown(skipTour(page), 15000))
    await stepIs(page, 1); await nextBtn(page).click()
    await stepIs(page, 2); await nextBtn(page).click()
    await stepIs(page, 3)
    await page.waitForTimeout(600)
    await skipTour(page).click()
    check(`${w} px: Skip mid-tour ends it`, await skipTour(page).waitFor({ state: 'detached', timeout: 2000 }).then(() => true, () => false))
    await page.waitForTimeout(800)   // saved as it closes, then written after the settings store's short quiet period
    check(`${w} px: skipping counts as seen`, (await storedPrefs(page))?.toured === true)
    check(`${w} px: no note and no selection bar left by the tour`, !(await visible(page.getByRole('button', { name: 'Close note' }))) && !(await visible(page.getByRole('button', { name: 'Highlight yellow' }))))
    await page.screenshot({ path: `${dir}/20-after-skip.png` })
    await page.goto(base + '/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)
    check(`${w} px: second launch: no tour`, !(await visible(skipTour(page))))
    await page.goto(base + '/settings', { waitUntil: 'networkidle' })
    // Settings → Welcome and tour → Full tour (the short tour is no longer a row there; it runs from the welcome)
    const again = page.getByRole('button', { name: 'Welcome and tour' })
    await again.scrollIntoViewIfNeeded(); await again.click(); await page.waitForTimeout(700)
    await page.screenshot({ path: `${dir}/21-settings-rows.png` })
    await page.getByRole('dialog').getByRole('button', { name: 'Full tour' }).click()
    check(`${w} px: Settings shows the tour again`, await shown(skipTour(page), 4000))
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${dir}/22-replay-from-settings.png` })
    await ctx.close()
  }
  {
    const { ctx, page } = await phone({ w, prefs: PREFS })
    await page.goto(base + '/read/19/23', { waitUntil: 'domcontentloaded' })
    await page.getByText('Jehovah is my shepherd', { exact: false }).first().waitFor({ timeout: 15000 })
    await page.waitForTimeout(3000)
    check(`${w} px: never over a shared link`, !(await visible(skipTour(page))))
    await ctx.close()
  }
  for (const [tag, extra] of [['reduce', { reduceMotion: true }], ['dark', { theme: 'slate' }]]) {
    const { ctx, page } = await phone({ w, prefs: { ...PREFS, ...extra } })
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
    await skipTour(page).waitFor({ timeout: 15000 })
    for (let i = 0; i < 6; i++) {
      await settle(page, i + 1, i === 0 || i === 2 ? `${w}/3${tag === 'reduce' ? 0 : 5}-${tag}-${ORDER[w >= 720][i]}` : null)
      await lands(page, i + 1, w)
      await nextBtn(page, i === 5).click()
    }
    await enough(page)
    await page.waitForTimeout(tag === 'reduce' ? 200 : 800)
    await page.screenshot({ path: `${dir}/3${tag === 'reduce' ? 0 : 5}-${tag}-read-well.png` })
    await ctx.close()
  }
}

// 3. the spotlights where the toolbar holds everything (a tablet): word lookup is its Aa there
if (want('spots')) for (const w of SPOT_VIEWS) {
  mkdirSync(`${out}/${w}`, { recursive: true })
  const { ctx, page } = await phone({ w, prefs: PREFS })
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await skipTour(page).waitFor({ timeout: 15000 })
  for (let i = 0; i < 6; i++) {
    await settle(page, i + 1, `${w}/0${i + 1}-${ORDER[w >= 720][i]}`)
    await lands(page, i + 1, w)
    await scene(page, i + 1, w)
    await nextBtn(page, i === 5).click()
  }
  await enough(page)
  await ctx.close()
}

// 4. frame pacing across the glides at 412 px: requestAnimationFrame deltas from each Next to the spotlight at rest
if (want('pacing')) {
  const pacing = {}
  for (const [label, rate] of [['desktop', 1], ['cpu-4x', 4]]) {
    const { ctx, page } = await phone({ prefs: PREFS, frames: true })
    if (rate > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate }) }
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
    await skipTour(page).waitFor({ timeout: 30000 })
    const windows = []
    for (let i = 0; i < 6; i++) {
      await stepIs(page, i + 1); await page.waitForTimeout(1200)
      const t0 = await page.evaluate(() => performance.now())
      await nextBtn(page, i === 5).click()
      await page.waitForTimeout(1200)
      windows.push([t0, await page.evaluate(() => performance.now()), `glide ${i + 1}→${i + 2}`])
    }
    const f = await page.evaluate(() => window.__frames)
    // the glides alone, as the veil marks them (a re-measure that moves the spotlight a little is a glide too)
    const marks = await page.evaluate(() => { const s = performance.getEntriesByName('tour-glide-start').map(e => e.startTime), e = performance.getEntriesByName('tour-glide-end').map(e => e.startTime); return s.map(t => [t, e.find(x => x >= t) ?? t]) })
    const gd = marks.flatMap(([a, b]) => { const fs = f.filter(t => t >= a && t <= b + 1); return fs.slice(1).map((t, i) => t - fs[i]) }).sort((a, b) => a - b)
    const gq = x => +gd[Math.min(gd.length - 1, Math.floor(x * gd.length))].toFixed(1)
    const glidesOnly = { glides: marks.length, frames: gd.length, p50: gq(0.5), p95: gq(0.95), max: +gd[gd.length - 1].toFixed(1), over20: gd.filter(x => x > 20).length }
    const all = [], per = {}
    for (const [a, b, name] of windows) {
      const fs = f.filter(t => t >= a && t <= b), d = fs.slice(1).map((t, i) => t - fs[i])
      all.push(...d)
      per[name] = { frames: fs.length, fps: +(fs.length / ((b - a) / 1000)).toFixed(1), max: +Math.max(...d).toFixed(1), over20: d.filter(x => x > 20).length }
    }
    all.sort((a, b) => a - b)
    const q = x => +all[Math.min(all.length - 1, Math.floor(x * all.length))].toFixed(1)
    pacing[label] = { glidesOnly, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +all[all.length - 1].toFixed(1), over20: all.filter(x => x > 20).length, frames: all.length, per }
    console.log('pacing', label, JSON.stringify(pacing[label]))
    await ctx.close()
  }
  writeFileSync(`${out}/pacing.json`, JSON.stringify(pacing, null, 2))
}

await browser.close()
const real = errors.filter(e => !/useNativeDriver|Failed to load resource/.test(e))
console.log(real.length ? 'ERRORS: ' + real.join(' | ') : 'no page errors')
