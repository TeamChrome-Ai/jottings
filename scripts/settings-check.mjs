// Settings: on its Text page the preview keeps one footprint, so the sliders under it stay put at every text size and
// while a slider is dragged; the index lists every group as a row saying how it is set, each opening its page, the
// themes or a sheet, and Back returns to it; Reading settings in the chapter lands on Text and Back returns to the
// chapter. Whole-screen shots at 412 px in Paper and Slate of the index signed out and signed in and of every page, and
// at 1280 px of the index and the Text page. BASE=http://127.0.0.1:8795 node scripts/settings-check.mjs
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const shots = process.env.SHOTS ?? '/tmp/wt-polish2/out/stills'
await import('node:fs').then(fs => fs.mkdirSync(shots, { recursive: true }))
const browser = await chromium.launch()
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++ }
const prefs = (fontSize, lineHeight, font = 'serif') => ({ theme: 'paper', themeLight: 'paper', themeDark: 'slate', font, fontSize, lineHeight, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true, align: 'center', width: 'medium' })
async function layout(p, shot) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(v => localStorage.setItem('berean_prefs', JSON.stringify(v)), p)
  const page = await ctx.newPage()
  await page.goto(base + '/settings/text', { waitUntil: 'networkidle' })
  // letter and word spacing sit behind their row
  await page.getByRole('button', { name: 'Letter and word spacing' }).click()
  await page.waitForSelector('text=Letter spacing'); await page.waitForTimeout(500)
  const m = await page.evaluate(() => {
    const box = s => document.querySelector(`[aria-label="${s}"]`)?.getBoundingClientRect()
    const sliders = [...document.querySelectorAll('[role="slider"],[role="adjustable"]')].map(e => Math.round(e.getBoundingClientRect().y))
    const pv = box('Preview of the reading text')
    return { preview: pv ? Math.round(pv.height) : null, sliders }
  })
  if (shot) await page.screenshot({ path: `${shots}/${shot}`, clip: { x: 0, y: 0, width: 412, height: 900 } })
  return { ...m, ctx, page }
}
// 1.5, not the slider's 1.2: below the serif's floor the row gains the "tighter than the font allows" note by design
const small = await layout(prefs(14, 1.5), 'settings-min.png'); await small.ctx.close()
const big = await layout(prefs(32, 2.4), 'settings-max.png'); await big.ctx.close()
const dys = await layout(prefs(32, 2.4, 'dyslexic'), 'settings-max-dyslexic.png'); await dys.ctx.close()
console.log('preview height min/max/dyslexic:', small.preview, big.preview, dys.preview, '| slider y min:', small.sliders.join(','), '| max:', big.sliders.join(','))
check(small.preview === big.preview && big.preview === dys.preview, 'preview height is the same at every setting')
check(small.sliders.length >= 4 && small.sliders.join() === big.sliders.join() && big.sliders.join() === dys.sliders.join(), 'sliders sit at the same y at min and max text size')

// drag the Text size thumb from end to end: the other sliders must not move meanwhile
const live = await layout(prefs(19, 1.6))
const cdp = await live.ctx.newCDPSession(live.page)
const track = await live.page.evaluate(() => { const r = document.querySelectorAll('[role="slider"],[role="adjustable"]')[0].getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width } })
const ys = []
const sample = () => live.page.evaluate(() => [...document.querySelectorAll('[role="slider"],[role="adjustable"]')].map(e => Math.round(e.getBoundingClientRect().y)).join(',') + '|' + (document.body.innerText.match(/\d+ px/)?.[0] ?? ''))
const x0 = track.x + track.w * 0.35
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: track.y }] })
for (let i = 1; i <= 16; i++) {
  const x = i <= 8 ? x0 + (track.x + track.w - x0) * i / 8 : track.x + track.w - (track.w * (i - 8)) / 8
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: track.y }] })
  await live.page.waitForTimeout(40)
  ys.push(await sample())
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
const sizes = new Set(ys.map(y => y.split('|')[1]))
check(new Set(ys.map(y => y.split('|')[0])).size === 1 && sizes.size > 5, `sliders held still through a full drag of Text size (${sizes.size} sizes shown, one slider layout)`)
await live.ctx.close()

// the index: its rows in order, how each is set, what each opens, and Back to it; every page in Paper and Slate
const errors = []
const PAGES = [['Text', 'text', 'Text size'], ['Page', 'page', 'Paragraphs'], ['Motion', 'motion', 'Reduce animation'], ['About', 'about', 'Welcome and tour']]
const SIGNED_IN = [['Account', 'account', 'Blocked users'], ['Daily', 'daily', 'Daily goal']]
const ROWS = ['Text', 'Page', 'Theme', 'Listening', 'Daily', 'Language', 'Motion', 'Offline', 'About']
async function screen({ signedIn = false, theme = 'paper', width = 412, path = '/settings' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, isMobile: width < 720, hasTouch: true })
  await ctx.addInitScript(v => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('berean_prefs', JSON.stringify(v)); sessionStorage.setItem('seeded', '1') } }, { ...prefs(19, 1.6), theme, onboarded: true, toured: true })
  await ctx.route('**/sw.js', r => r.fulfill({ status: 404, body: '' }))
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(base + '/', { waitUntil: 'networkidle' })
  if (signedIn) {
    const handle = 'set' + Date.now().toString(36)
    await page.evaluate(async h => { await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: h, display_name: 'Settings', password: 'Settings-pass-123' }) }) }, handle)
    await page.goto(base + '/login', { waitUntil: 'networkidle' })
    await page.getByPlaceholder('Handle').fill(handle); await page.getByPlaceholder('Password').fill('Settings-pass-123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForTimeout(1500)
  }
  await page.goto(base + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(900)
  return { ctx, page }
}
/** The whole scrolling screen as one picture: the viewport grows to the content's height for the shot. */
async function whole(page, file) {
  const { width } = page.viewportSize()
  const h = await page.evaluate(() => Math.max(...[...document.querySelectorAll('div')].map(d => d.scrollHeight > d.clientHeight + 10 && d.clientHeight > 0 && getComputedStyle(d).overflowY !== 'visible' ? d.scrollHeight : 0)))
  await page.setViewportSize({ width, height: Math.min(8000, Math.max(900, h + 80)) }); await page.waitForTimeout(600)
  await page.screenshot({ path: `${shots}/${file}` })
  await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(300)
}
const rowsOf = async page => (await page.evaluate(() => [...document.querySelectorAll('[role="button"]')].filter(e => e.offsetParent).map(e => e.getAttribute('aria-label')))).filter(r => ROWS.includes(r))
// the profile card is read out as "<name>, Account"
const row = (page, name) => page.getByRole('button', { name: new RegExp(`^(?:.+, )?${name}$`) })
const summary = async (page, name) => (await row(page, name).innerText()).split('\n').pop()
const path = page => new URL(page.url()).pathname
const seen = (page, s) => page.getByText(s, { exact: true }).last().isVisible().catch(() => false)
const back = async page => { await page.getByLabel(/, back$/).last().click(); await page.waitForTimeout(900) }
/** A row opens its page (its header and a control of it showing); Back returns to the index. */
async function visit(page, [name, slug, control], shot) {
  await row(page, name).click(); await page.waitForTimeout(900)
  const ok = path(page) === `/settings/${slug}` && await seen(page, control)
  if (shot) await whole(page, shot)
  await back(page)
  return ok && path(page) === '/settings' && await seen(page, 'Reset all settings')
}
for (const theme of ['paper', 'slate']) {
  const { ctx, page } = await screen({ theme })
  if (theme === 'paper') {
    check(JSON.stringify(await page.getByRole('heading').allInnerTexts()) === '["Settings","Reset"]', 'the index has two headings, Settings and Reset')
    const rows = await rowsOf(page)
    check(rows.join() === 'Text,Page,Theme,Listening,Language,Motion,About', `rows on the web signed out, no Daily or Offline: ${rows.join(' / ')}`)
    const says = { Text: 'Serif · 19 px · line 1.60', Page: 'Paragraphs, verse numbers, footnotes', Theme: 'Paper', Listening: 'Alec at 1×, short pauses', Language: 'English · Darby (English)', Motion: 'Reduced', About: 'Credits, feedback, the tour' }
    for (const [name, line] of Object.entries(says)) check(await summary(page, name) === line, `${name} says “${line}” (${await summary(page, name)})`)
    check(await seen(page, 'Not signed in'), 'signed out: the sign-in card stands where the account will')
    await row(page, 'Listening').click(); await page.waitForTimeout(700)
    const ls = await page.getByRole('dialog').innerText().catch(() => '')
    check(/Pause between verses/.test(ls) && /Use the device voice/.test(ls) && path(page) === '/settings', 'Listening opens every listening setting in one sheet, on the index')
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)
    await row(page, 'Language').click(); await page.waitForTimeout(700)
    check(/The app’s language/.test(await page.getByRole('dialog').innerText().catch(() => '')) && path(page) === '/settings', 'Language opens its sheet on the index')
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)
    await row(page, 'Theme').click(); await page.waitForTimeout(900)
    check(path(page) === '/themes', 'Theme pushes the gallery')
    await back(page)
    await row(page, 'About').click(); await page.waitForTimeout(900)
    await row(page, 'Welcome and tour').click(); await page.waitForTimeout(700)
    const again = await page.getByRole('dialog').innerText().catch(() => '')
    check(/Welcome/.test(again) && !/Short tour/.test(again) && /Full tour/.test(again), 'About → Welcome and tour offers Welcome / Full tour, no Short tour row')
    await page.screenshot({ path: `${shots}/settings-again-sheet.png` })
    await page.getByRole('dialog').getByRole('button', { name: 'Welcome', exact: true }).click()
    const welcome = await page.getByRole('button', { name: 'Skip the welcome' }).waitFor({ timeout: 4000 }).then(() => true, () => false)
    check(welcome && path(page) === '/settings', 'About → Welcome and tour → Welcome plays it over the tabs, the About page gone')
    await page.getByRole('button', { name: 'Skip the welcome' }).click(); await page.waitForTimeout(1500)
    await page.goto(base + '/settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(900)
    await row(page, 'Motion').click(); await page.waitForTimeout(900)
    check(await page.getByRole('slider', { name: /Animation speed/ }).count() > 0 || await page.getByText('Animation speed').count() > 0, 'Motion holds the Animation speed slider')
    await back(page)
    for (const slug of ['daily', 'offline', 'account']) { await page.goto(`${base}/settings/${slug}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(900); check(path(page) === '/settings', `/settings/${slug} on the web signed out goes back to Settings`) }
  }
  await whole(page, `settings-${theme}-index-signed-out.png`)
  for (const p of PAGES) check(await visit(page, p, `settings-${theme}-${p[1]}.png`), `${theme}: ${p[0]} opens /settings/${p[1]} and Back returns to the index`)
  await ctx.close()
}
for (const theme of ['paper', 'slate']) {
  const { ctx, page } = await screen({ signedIn: true, theme })
  if (theme === 'paper') {
    const rows = await rowsOf(page)
    check(rows.join() === 'Text,Page,Theme,Listening,Daily,Language,Motion,About', `rows on the web signed in, Daily after Listening: ${rows.join(' / ')}`)
    check(await summary(page, 'Daily') === '10 min a day', `Daily says the goal (${await summary(page, 'Daily')})`)
    check(/Settings/.test(await row(page, 'Account').innerText()) && /@set/.test(await row(page, 'Account').innerText()), 'the profile card shows the name and handle')
    await row(page, 'Account').click(); await page.waitForTimeout(900)
    const text = await page.evaluate(() => document.body.innerText)
    check(path(page) === '/settings/account' && ['Friends', 'Public profile', 'Blocked users', 'Your data', 'Delete account', 'Sign out'].every(t => text.includes(t)), 'Account holds friends, the public profile, blocked users, your data, delete and sign out')
    await row(page, 'Blocked users').click(); await page.waitForTimeout(900)
    check(/not blocked anyone/.test(await page.getByRole('dialog').innerText().catch(() => '')), 'Blocked users opens its list in a sheet')
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)
    await back(page)
    await row(page, 'Daily').click(); await page.waitForTimeout(900)
    check(await seen(page, 'Daily goal') && !(await seen(page, 'Streak reminder')) && !(await seen(page, 'Verse of the day')), 'Daily on the web: the goal, and no phone notifications')
    await back(page)
  }
  await whole(page, `settings-${theme}-index-signed-in.png`)
  for (const p of SIGNED_IN) check(await visit(page, p, `settings-${theme}-${p[1]}.png`), `${theme}: ${p[0]} opens /settings/${p[1]} and Back returns to the index`)
  if (theme === 'paper') {
    await row(page, 'Account').click(); await page.waitForTimeout(900)
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.waitForTimeout(1500)
    check(path(page) === '/settings' && await seen(page, 'Not signed in'), 'Sign out on Account returns to the index, signed out')
  }
  await ctx.close()
}
for (const theme of ['paper', 'slate']) {
  const { ctx, page } = await screen({ theme, path: '/read/43/3' })
  await page.waitForSelector('text=Nicodemus')
  await page.getByLabel('More').click(); await page.waitForTimeout(500)
  await page.getByRole('dialog').getByRole('button', { name: 'Reading settings' }).click(); await page.waitForTimeout(900)
  check(path(page) === '/settings/text' && await seen(page, 'Text size'), `${theme}: Reading settings in the chapter lands on Text`)
  await page.screenshot({ path: `${shots}/settings-${theme}-reader-to-text.png` })
  await back(page)
  check(path(page) === '/read/43/3' && await page.getByText('Nicodemus').first().isVisible().catch(() => false), `${theme}: Back from Text returns to the chapter`)
  await page.screenshot({ path: `${shots}/settings-${theme}-back-to-chapter.png` })
  await ctx.close()
}
{
  const { ctx, page } = await screen({ width: 1280 })
  await whole(page, 'settings-desktop-index.png')
  await row(page, 'Text').click(); await page.waitForTimeout(900)
  check(path(page) === '/settings/text', 'desktop: Text opens its page')
  await whole(page, 'settings-desktop-text.png')
  await ctx.close()
}
check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
