// Settings: the text preview keeps one footprint, so the sliders under it stay put at every text size and while
// a slider is dragged; the layout (sections, merged rows, sheets) keeps every feature one or two taps away; whole-screen
// shots at 412 px signed out and signed in. BASE=http://127.0.0.1:8795 node scripts/settings-check.mjs
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
  await page.goto(base + '/settings', { waitUntil: 'networkidle' })
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
check(small.sliders.length >= 5 && small.sliders.join() === big.sliders.join() && big.sliders.join() === dys.sliders.join(), 'sliders sit at the same y at min and max text size')

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

// the layout: the spine of sections, the merged rows and what each opens
const errors = []
async function screen({ signedIn = false, reduce = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(v => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('berean_prefs', JSON.stringify(v)); sessionStorage.setItem('seeded', '1') } }, { ...prefs(19, 1.6), reduceMotion: reduce, onboarded: true, toured: true })
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
  await page.goto(base + '/settings', { waitUntil: 'networkidle' }); await page.waitForSelector('text=Reset all settings'); await page.waitForTimeout(900)
  return { ctx, page }
}
/** The whole scrolling screen as one picture: the viewport grows to the content's height for the shot. */
async function whole(page, file) {
  const h = await page.evaluate(() => Math.max(...[...document.querySelectorAll('div')].map(d => d.scrollHeight > d.clientHeight + 10 && getComputedStyle(d).overflowY !== 'visible' ? d.scrollHeight : 0)))
  await page.setViewportSize({ width: 412, height: Math.min(8000, h + 80) }); await page.waitForTimeout(600)
  await page.screenshot({ path: `${shots}/${file}` })
  await page.setViewportSize({ width: 412, height: 900 }); await page.waitForTimeout(300)
}
{
  const { ctx, page } = await screen()
  const heads = await page.getByRole('heading').allInnerTexts()
  const spine = ['Text', 'Theme', 'Reading', 'Listening', 'About', 'Account', 'Reset']
  check(JSON.stringify(heads.filter(h => spine.includes(h))) === JSON.stringify(spine) && heads.length <= spine.length + 1, `sections in order: ${heads.join(' / ')}`)
  const rows = await page.getByRole('button').allInnerTexts()
  check(!rows.some(r => /Play the welcome again|Show the tour again|Take the full tour|Chronological table/.test(r)), 'the three replay rows are one, and the chronological table lives on Home')
  // Welcome and tour opens a small sheet with the two (the short tour runs from the welcome on a new device)
  await page.getByRole('button', { name: 'Welcome and tour' }).click(); await page.waitForTimeout(700)
  const again = await page.getByRole('dialog').innerText().catch(() => '')
  check(/Welcome/.test(again) && !/Short tour/.test(again) && /Full tour/.test(again), 'Welcome and tour offers Welcome / Full tour, no Short tour row')
  await page.screenshot({ path: `${shots}/settings-again-sheet.png` })
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  // Listening: one row, the player's own sheet
  await page.getByRole('button', { name: 'Voice, speed and pauses' }).click(); await page.waitForTimeout(700)
  const ls = await page.getByRole('dialog').innerText().catch(() => '')
  check(/Pause between verses/.test(ls) && /Use the device voice/.test(ls), 'Listening opens every listening setting in one sheet')
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  // Animation speed: a slider under Reduce animation, dimmed while that is on
  check(await page.getByRole('slider', { name: /Animation speed/ }).count() > 0 || await page.getByText('Animation speed').count() > 0, 'Animation speed slider under Reading')
  await whole(page, 'settings-signed-out.png')
  await ctx.close()
}
{
  const { ctx, page } = await screen({ signedIn: true })
  const text = await page.evaluate(() => document.body.innerText)
  check(['Friends', 'Blocked users', 'Your data', 'Delete account', 'Sign out'].every(t => text.includes(t)), 'Account holds friends, blocked users, your data, delete and sign out (groups live on Home)')
  await page.getByRole('button', { name: 'Blocked users' }).click(); await page.waitForTimeout(900)
  check(/not blocked anyone/.test(await page.getByRole('dialog').innerText().catch(() => '')), 'Blocked users opens its list in a sheet')
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  await whole(page, 'settings-signed-in.png')
  await ctx.close()
}
check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
