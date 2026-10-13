// The full tour on the web build. At each width in VIEWS (360 and 412 px): a still per step with its words, every
// spotlight checked against the element its words name (scripts/tour-spots.mjs), nothing left behind at the end (no
// sheet, bar or sample outline; the chapter back where it was; the library work it opened not noted as read), Back
// across screens, Skip mid-way with a sheet and read aloud open and with the sample outline, the choice's "That's
// enough", a shared link, Reduce animation. At 800 px (SPOT_VIEWS) the spotlights again, where the toolbar holds what
// More holds on a phone. At 412 px a video of a fresh device from the welcome through the short tour, its choice and
// the full tour to the end (trying a theme on the way), the theme blob frame by frame, and frame pacing.
// BASE = a throwaway server; OUT = where the video, stills and the pacing report go;
// ONLY=video|stills|spots|blob|checks|pacing.
import { chromium } from 'playwright'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { NOUN } from './brand.mjs'
import { landed, stepByText } from './tour-spots.mjs'
const { stepsFor } = await import('../client/src/lib/tour.ts')
const base = process.env.BASE ?? 'http://127.0.0.1:8796'
const out = process.env.OUT ?? '/tmp/wt-tour2'
const only = process.env.ONLY
const want = k => !only || only === k
const VIEWS = (process.env.VIEWS ?? '360,412').split(',').map(Number)
const SPOT_VIEWS = (process.env.SPOT_VIEWS ?? '800').split(',').filter(Boolean).map(Number)
for (const d of ['video', 'blob']) mkdirSync(`${out}/${d}`, { recursive: true })
const size = w => ({ width: w, height: w >= 720 ? 1000 : 915 })
const browser = await chromium.launch()
const errors = []
const check = (label, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1 }
const SEEN = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false, align: 'center', width: 'medium', onboarded: true, toured: true, readerName: '' }
const phone = async ({ w = 412, video = false, prefs = null, frames = false } = {}) => {
  const VIEW = size(w)
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: w < 720, hasTouch: true, ...(video ? { recordVideo: { dir: `${out}/video`, size: VIEW } } : {}) })
  if (prefs) await ctx.addInitScript(p => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('berean_prefs', JSON.stringify(p)); sessionStorage.setItem('seeded', '1') } }, prefs)
  if (frames) await ctx.addInitScript(() => { const f = window.__frames = []; const tick = t => { f.push(t); requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
  return { ctx, page }
}
/** The steps a signed-out reader gets at this width, as lib/tour.ts lists them. */
const plan = w => stepsFor('full', { wide: w >= 720, signedIn: false, inGroup: false }).map(s => s.id)
const skipTour = page => page.getByRole('button', { name: 'Skip the tour' })
const stepLabel = (page, i) => page.getByLabel(new RegExp(`^Step ${i} of \\d+$`))
const total = async page => +(await page.getByLabel(/^Step \d+ of \d+$/).first().getAttribute('aria-label')).split(' of ')[1]
const next = (page, last) => page.getByRole('button', { name: last ? 'Done' : 'Next', exact: true }).last().click()
const visible = loc => loc.first().isVisible().catch(() => false)
/** Some match of `loc` is on screen (the reader keeps the chapters either side mounted off to the side). */
const inView = loc => loc.evaluateAll(es => es.some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.x + r.width / 2 > 0 && r.x + r.width / 2 < innerWidth && r.y + r.height / 2 > 0 && r.y + r.height / 2 < innerHeight })).catch(() => false)
/** The label's words: the Skip pill sits in the footer, whose parent is the label. */
const labelText = async page => ((await skipTour(page).last().locator('xpath=../../..').innerText().catch(() => '')) || '').split('\n')[0]
const settle = async (page, i) => { const ok = await stepLabel(page, i).waitFor({ timeout: 12000 }).then(() => true, () => false); if (ok) await page.waitForTimeout(900); return ok }
/** Settings → Welcome and tour → one of its three. */
const openSettingsRow = async (page, pick) => {
  await page.goto(base + '/settings', { waitUntil: 'networkidle' })
  const again = page.getByRole('button', { name: 'Welcome and tour' })
  await again.scrollIntoViewIfNeeded(); await again.click(); await page.waitForTimeout(700)
  await page.getByRole('dialog').getByRole('button', { name: pick, exact: true }).click()
}
const outlinesHaveSample = async page => {
  await page.goto(base + '/outlines', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  return visible(page.getByText(`Sample ${NOUN.one}`))
}
/** Walks the full tour from step `from` to the end; `onStep` sees each. Returns the step count. */
const walk = async (page, from, onStep) => {
  let n = 0
  for (let i = from; ; i++) {
    if (!(await settle(page, i))) { check(`step ${i} shows`, false); await page.screenshot({ path: `${out}/fail-${i}.png` }); console.log('at', page.url()); return n }
    n = await total(page)
    await onStep?.(i, n)
    await next(page, i === n)
    if (i === n) return n
  }
}
/** Goes through the full tour to the step `id` (1-based index returned). */
const walkTo = async (page, w, id) => {
  const at = plan(w).indexOf(id) + 1
  for (let i = 1; i < at; i++) { await settle(page, i); await next(page, false) }
  await settle(page, at)
  return at
}
/** Each step: the one lib/tour.ts puts there, its spotlight round what its words name. */
const spotWalk = async (page, w, dir) => {
  const ids = plan(w), rows = []
  let misses = 0
  const n = await walk(page, 1, async i => {
    const words = await labelText(page)
    const step = stepByText(words, w >= 720)
    if (step?.id !== ids[i - 1]) { misses++; check(`${w} px step ${i}: ${ids[i - 1]} expected, "${words}" shown`, false) }
    const r = step ? await landed(page, step.id, size(w)) : { ok: false, why: 'unknown words' }
    if (!r.ok) { misses++; check(`${w} px step ${i} (${step?.id}) spotlight lands on what it names: ${r.why}`, false) }
    rows.push(`${i}/${ids.length} ${step?.id ?? '?'}: ${words}`)
    if (dir) await page.screenshot({ path: `${dir}/${String(i).padStart(2, '0')}-${step?.id ?? 'x'}.png` })
  })
  check(`${w} px: all ${ids.length} steps shown in order, each spotlight on what its words name (${misses} misses)`, n === ids.length && misses === 0)
  return rows
}

// 1. the video at 412 px: a fresh device, the welcome, Begin, the short tour, "Keep going", the whole full tour, a theme
if (want('video')) {
  const { ctx, page } = await phone({ video: true })
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Begin', exact: true }).click({ timeout: 30000 })
  for (let i = 1; i <= 6; i++) { await settle(page, i); await page.waitForTimeout(600); await next(page, i === 6) }
  const more = page.getByRole('button', { name: 'Keep going: the full tour' })
  check('the short tour ends on the choice', await more.waitFor({ timeout: 5000 }).then(() => true, () => false))
  await page.waitForTimeout(1200)
  await more.click()
  const n = await walk(page, 7, async () => {
    await page.waitForTimeout(600)
    if (await visible(page.getByText('Tap one to try it.'))) { await page.getByRole('radio', { name: 'Slate theme' }).click(); await page.waitForTimeout(1600) }
  })
  check(`the full tour runs to its end (${n} steps)`, n === plan(412).length)
  check('says goodbye', await page.getByText('That’s it. Read well.').waitFor({ timeout: 3000 }).then(() => true, () => false))
  await page.waitForTimeout(3200)
  const v = page.video()
  await ctx.close()
  renameSync(await v.path(), `${out}/full-tour.webm`)
  console.log('video', `${out}/full-tour.webm`)
}

// 2. per width: a still per step, its words and its spotlight, from Settings → Welcome and tour → Full tour; then
// nothing left behind
if (want('stills')) for (const w of VIEWS) {
  const dir = `${out}/steps-${w}`
  mkdirSync(dir, { recursive: true })
  const { ctx, page } = await phone({ w, prefs: SEEN })
  await openSettingsRow(page, 'Full tour')
  const rows = await spotWalk(page, w, dir)
  writeFileSync(`${dir}/steps.txt`, rows.join('\n') + '\n')
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${dir}/99-read-well.png` })
  await page.waitForTimeout(2600)
  check(`${w} px: no sheet left open`, !(await visible(page.getByRole('dialog'))))
  check(`${w} px: no read-aloud bar left`, !(await visible(page.getByRole('button', { name: 'Stop reading' }))))
  // the chapter the tour scrolled to its end is back at its top; the ministry work it opened is not "Continue reading"
  await page.getByRole('tab', { name: /^Read/ }).click()
  await page.waitForTimeout(1200)
  check(`${w} px: the chapter is back where it was (its opening on screen, not its end)`, await inView(page.getByText('beginning was the Word', { exact: false })) && !(await inView(page.getByRole('button', { name: /→$/ }))))
  await page.goto(base + '/companion', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  check(`${w} px: the library work the tour opened is not left as last read`, !(await visible(page.getByText('Continue reading', { exact: true })))
    && !(await page.evaluate(() => Object.keys(localStorage).some(k => /library_pos/.test(k) && /darby/.test(localStorage.getItem(k) ?? '')))))
  check(`${w} px: the sample outline is gone`, !(await outlinesHaveSample(page)))
  await ctx.close()
}

// 3. the spotlights where the toolbar holds everything
if (want('spots')) for (const w of SPOT_VIEWS) {
  const dir = `${out}/steps-${w}`
  mkdirSync(dir, { recursive: true })
  const { ctx, page } = await phone({ w, prefs: SEEN })
  await openSettingsRow(page, 'Full tour')
  writeFileSync(`${dir}/steps.txt`, (await spotWalk(page, w, dir)).join('\n') + '\n')
  await ctx.close()
}

// 4. the blob, frame by frame on a paused clock
if (want('blob')) {
  const { ctx, page } = await phone({ prefs: SEEN })
  await openSettingsRow(page, 'Full tour')
  await walkTo(page, 412, 'theme-pick')
  await page.waitForTimeout(500)
  await page.clock.install()
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000)
  await page.getByRole('radio', { name: 'Slate theme' }).click()
  const shots = [0, 45, 90, 180, 270, 360, 420, 445, 470, 540, 620, 720, 800, 900]
  let now = 0
  for (const t of shots) { await page.clock.runFor(t - now); now = t; await page.screenshot({ path: `${out}/blob/${String(t).padStart(4, '0')}ms.png` }) }
  await page.clock.runFor(400)
  await page.clock.resume()
  await page.waitForTimeout(800)
  check('the theme is applied under the blob', (await page.evaluate(() => JSON.parse(localStorage.getItem('berean_prefs') ?? '{}').theme)) === 'slate')
  check('the tour carries on after the blob', await page.getByRole('button', { name: 'Next', exact: true }).last().isVisible())
  await ctx.close()
}

// 5. per width: Back across screens, Skip with everything open, the choice's "That's enough", a shared link, Reduce
if (want('checks')) for (const w of VIEWS) {
  const ids = plan(w)
  {
    // forward to Search, then Back through groups, friends, the outline pages, Home and the library to the reader
    const { ctx, page } = await phone({ w, prefs: SEEN })
    await openSettingsRow(page, 'Full tour')
    const far = await walkTo(page, w, 'search-field'), end = ids.indexOf('end') + 1
    let backOk = true
    for (let i = far - 1; i >= end; i--) {
      await page.getByRole('button', { name: 'Back', exact: true }).last().click()
      if (!(await settle(page, i))) { backOk = false; console.log('back failed at', i, ids[i - 1]); break }
    }
    check(`${w} px: Back walks from Search through groups, friends, outlines, Home and the library to the reader`, backOk)
    await page.screenshot({ path: `${out}/back-${w}.png` })
    // on to the listening sheet (read aloud cued, a sheet open), then Skip
    const listening = ids.indexOf('listening') + 1
    for (let i = end; i < listening; i++) { await next(page, false); await settle(page, i + 1) }
    check(`${w} px: the listening sheet is open at its step`, await visible(page.getByRole('dialog').getByText('Speed', { exact: true })))
    await skipTour(page).click()
    await skipTour(page).waitFor({ state: 'detached', timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${out}/skip-with-sheet-${w}.png` })
    check(`${w} px: Skip closes the sheet`, !(await visible(page.getByRole('dialog'))))
    check(`${w} px: Skip stops read aloud`, !(await visible(page.getByRole('button', { name: 'Stop reading' }))))
    check(`${w} px: Skip leaves the controls tappable (the book button opens the picker)`, await page.getByRole('button', { name: /^John 1/ }).click({ timeout: 3000 }).then(() => page.getByText('Books', { exact: true }).waitFor({ timeout: 3000 })).then(() => true, () => false))
    await ctx.close()
  }
  {
    const { ctx, page } = await phone({ w, prefs: SEEN })
    await openSettingsRow(page, 'Full tour')
    await walkTo(page, w, 'editor-items')
    check(`${w} px: the sample outline exists while its steps are up`, await visible(page.getByPlaceholder('Heading')))
    await skipTour(page).click()
    await page.waitForTimeout(900)
    check(`${w} px: Skip deletes the sample outline`, !(await outlinesHaveSample(page)))
    await ctx.close()
  }
  {
    // the short tour has no Settings row now: it runs on a device that has seen the welcome but not the tour
    const { ctx, page } = await phone({ w, prefs: { ...SEEN, toured: false } })
    await page.goto(base + '/', { waitUntil: 'networkidle' })
    for (let i = 1; i <= 6; i++) { await settle(page, i); check(`${w} px: short tour step ${i} of 6`, (await total(page)) === 6); await next(page, i === 6) }
    await page.getByRole('button', { name: 'That’s enough' }).click({ timeout: 5000 })
    check(`${w} px: "That’s enough" ends with the last line`, await page.getByText('That’s it. Read well.').waitFor({ timeout: 3000 }).then(() => true, () => false))
    await page.waitForTimeout(3000)
    check(`${w} px: and leaves nothing up`, !(await visible(skipTour(page))) && !(await visible(page.getByRole('dialog'))))
    await page.screenshot({ path: `${out}/enough-${w}.png` })
    await ctx.close()
  }
  {
    const { ctx, page } = await phone({ w, prefs: { ...SEEN, toured: false } })
    await page.goto(base + '/read/19/23', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    check(`${w} px: never over a shared link`, !(await visible(skipTour(page))))
    await ctx.close()
  }
  {
    const { ctx, page } = await phone({ w, prefs: { ...SEEN, reduceMotion: true } })
    await openSettingsRow(page, 'Full tour')
    await walkTo(page, w, 'theme-pick')
    await page.getByRole('radio', { name: 'Forest theme' }).click()
    await page.waitForTimeout(150)
    await page.screenshot({ path: `${out}/reduce-theme-${w}.png` })
    // no blob in the frame taken 150 ms after the tap; the choice is written after the settings store's quiet period
    check(`${w} px: Reduce animation: no blob`, !(await page.evaluate(() => performance.getEntriesByName('blob-start').length)))
    await page.waitForTimeout(900)
    check(`${w} px: Reduce animation: the theme applies`, (await page.evaluate(() => JSON.parse(localStorage.getItem('berean_prefs') ?? '{}').theme)) === 'forest')
    await ctx.close()
  }
}

// 6. frame pacing at 412 px: the blob (user-timing marks from blob-start to blob-end), as is and at 4x CPU
if (want('pacing')) {
  const pacing = {}
  for (const [label, rate] of [['desktop', 1], ['cpu-4x', 4]]) {
    const { ctx, page } = await phone({ prefs: SEEN, frames: true })
    await openSettingsRow(page, 'Full tour')
    if (rate > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate }) }
    await walkTo(page, 412, 'theme-pick')
    await page.waitForTimeout(800)
    const blobs = []
    for (const name of ['Slate theme', 'Paper theme', 'Midnight theme']) {
      await page.getByRole('radio', { name }).click()
      await page.waitForTimeout(rate > 1 ? 3500 : 1800)
      // the motion (lift, flight, spread) apart from the reveal, which waits on the app's own re-render in the new theme
      const r = await page.evaluate(() => {
        const at = n => performance.getEntriesByName(n).pop()?.startTime
        const s = at('blob-start'), c = at('blob-covered'), e = at('blob-end')
        const span = (a, b) => { const f = window.__frames.filter(t => t >= a && t <= b), d = f.slice(1).map((t, i) => t - f[i]); return { ms: Math.round(b - a), fps: +(Math.max(0, f.length - 1) / ((b - a) / 1000)).toFixed(1), max: +Math.max(0, ...d).toFixed(1), over20: d.filter(x => x > 20).length } }
        const fadeFrom = at('blob-fade')
        return { motion: span(s, c), redraw: Math.round(fadeFrom - c), fade: span(fadeFrom, e) }
      })
      blobs.push({ theme: name, ...r })
    }
    pacing[label] = blobs
    console.log('pacing', label, JSON.stringify(blobs))
    await ctx.close()
  }
  writeFileSync(`${out}/pacing.json`, JSON.stringify(pacing, null, 2))
}

await browser.close()
console.log(errors.length ? 'ERRORS: ' + [...new Set(errors)].join(' | ') : 'no page errors')
