// Chapter turns show the neighbouring chapter already laid out: during a touch drag the incoming page carries its
// text, within ~100 ms of the finger lifting it is on screen, the page is reused (not remounted), no spinner shows,
// and the selection label compresses verse runs. BASE=http://127.0.0.1:8795 node scripts/swipe-check.mjs
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const shots = process.env.SHOTS ?? '/tmp/wt-ux-shots'
await import('node:fs').then(fs => fs.mkdirSync(shots, { recursive: true }))
const W = 412, H = 860
const browser = await chromium.launch()
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++ }

async function open(reduceMotion) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(r => localStorage.setItem('berean_prefs', JSON.stringify({ theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: r, align: 'center', width: 'medium' })), reduceMotion)
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  return { ctx, page, errors, cdp: await ctx.newCDPSession(page) }
}
const firstWords = async (page, b, c) => page.evaluate(async ([b, c]) => {
  const r = await fetch(`/bible/${b}/${c}.json`); const j = await r.json()
  return j.verses[0].t.split(' ').slice(0, 5).join(' ')
}, [b, c])
/** Where the text is: on screen (painted, inside the viewport), and its left edge. */
const probe = (page, snippet) => page.evaluate(([snippet, W]) => {
  let best = null
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.textContent?.includes(snippet)) best = n   // deepest last
  if (!best) return { mounted: false, visible: false, x: null, spinner: false }
  const r = best.getBoundingClientRect()
  const painted = best.checkVisibility({ visibilityProperty: true, opacityProperty: true })
  const spinner = [...document.querySelectorAll('[role="progressbar"]')].some(s => { const q = s.getBoundingClientRect(); return q.right > 0 && q.left < W && s.checkVisibility({ visibilityProperty: true }) })
  return { mounted: true, visible: painted && r.right > 0 && r.left < W && r.width > 0, x: Math.round(r.left), spinner }
}, [snippet, W])
async function drag(cdp, page, fromX, toX, onMid) {
  const y = 480, steps = 12
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX + (toX - fromX) * i / steps, y }] })
    await page.waitForTimeout(16)
    if (i === Math.round(steps * 0.6) && onMid) await onMid()
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  return Date.now()
}
/**
 * In-page, every animation frame from now on: when the finger lifts (or the key goes down), the first frame the text
 * is painted on screen, and the frame it comes to rest at x ~ 20. Timed in the page, so CDP round trips do not count.
 */
const watch = (page, snippet) => page.evaluate(([snippet, W]) => {
  const st = { lift: null, seen: null, rest: null, spinner: false, longest: 0 }
  window.__turn = st
  window.__turnObs?.disconnect()
  window.__turnObs = new PerformanceObserver(l => { for (const e of l.getEntries()) if (st.lift !== null && e.startTime >= st.lift - 50) st.longest = Math.max(st.longest, Math.round(e.duration)) })
  window.__turnObs.observe({ type: 'longtask' })
  const mark = () => { if (st.lift === null) st.lift = performance.now() }
  addEventListener('touchend', mark, { capture: true, once: true })
  addEventListener('keydown', mark, { capture: true, once: true })
  const find = () => { let best = null; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT); for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent?.includes(snippet)) best = n; return best }
  const t0 = performance.now()
  const frame = () => {
    if (st.lift !== null) {
      const el = find()
      const r = el?.getBoundingClientRect()
      const on = !!el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && r.right > 0 && r.left < W && r.width > 0
      st.spinner ||= [...document.querySelectorAll('[role="progressbar"]')].some(x => { const q = x.getBoundingClientRect(); return q.right > 0 && q.left < W && x.checkVisibility({ visibilityProperty: true }) })
      const t = Math.round(performance.now() - st.lift)
      if (on && st.seen === null) st.seen = t
      if (on && Math.abs(r.left - 20) <= 2) { st.rest = t; return }
    }
    if (performance.now() - t0 < 5000) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}, [snippet, W])
async function settle(page) {
  await page.waitForFunction(() => window.__turn.rest !== null, null, { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(600)   // the params swap after the slide lands inside this window
  return page.evaluate(() => window.__turn)
}

// ---- animated turns ----
{
  const { page, errors, cdp } = await open(false)
  await page.goto(base + '/read/43/3', { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Nicodemus'); await page.waitForTimeout(900)
  const next = await firstWords(page, 43, 4), prev = await firstWords(page, 43, 2), here = await firstWords(page, 43, 3)
  const before = await probe(page, next)
  check(before.mounted && !before.visible, `John 4 is laid out offscreen before any gesture (mounted ${before.mounted}, painted ${before.visible})`)
  // tag the neighbour's DOM so a remount would show
  await page.evaluate(s => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT); let b = null; for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent?.includes(s)) b = n; b.dataset.swipeMark = '1' }, next)
  let mid = null
  await watch(page, next)
  await drag(cdp, page, 360, 70, async () => { mid = await probe(page, next); await page.screenshot({ path: `${shots}/swipe-mid.png` }) })
  check(!!mid?.visible, `John 4 text is on screen during the drag (x ${mid?.x})`)
  const s1 = await settle(page)
  console.log(`      after lift: text painted on screen ${s1.seen} ms, at rest ${s1.rest} ms, longest main-thread task after the lift ${s1.longest} ms (in-page timing)`)
  check(s1.seen !== null && s1.seen <= 100, `John 4 visible within 100 ms of the gesture ending (${s1.seen} ms)`)
  check(s1.rest !== null && s1.rest <= 400, `John 4 settled in place (${s1.rest} ms)`)
  check(!s1.spinner, 'no spinner on screen during the turn')
  await page.waitForTimeout(300)
  check(page.url().includes('/read/43/4'), `route followed the turn (${new URL(page.url()).pathname})`)
  check(await page.evaluate(() => !!document.querySelector('[data-swipe-mark="1"]')), 'the neighbour page was reused, not remounted')
  await page.screenshot({ path: `${shots}/swipe-after.png` })
  // previous chapter was the current one a moment ago: back with a right swipe
  await page.waitForTimeout(400)
  await watch(page, here)
  await drag(cdp, page, 60, 350)
  const s2 = await settle(page)
  check(s2.seen !== null && s2.seen <= 100 && !s2.spinner, `swipe back: John 3 visible in ${s2.seen} ms, at rest ${s2.rest} ms, longest task ${s2.longest} ms, spinner ${s2.spinner}`)
  // a short drag springs back and leaves the chapter alone
  await page.waitForTimeout(500)
  await drag(cdp, page, 300, 250)
  await page.waitForTimeout(700)
  const back = await probe(page, here)
  check(page.url().includes('/read/43/3') && Math.abs(back.x - 20) <= 24, `short drag springs back (x ${back.x})`)
  // arrow key turn: the whole page slides in with its text
  await watch(page, prev)
  await page.keyboard.press('ArrowLeft')
  const s3 = await settle(page)
  check(s3.seen !== null && s3.seen <= 100 && !s3.spinner, `arrow key: John 2 visible in ${s3.seen} ms, at rest ${s3.rest} ms`)
  // rapid second turn: the page after next was warmed, so it still arrives with text
  await page.waitForTimeout(250)
  await watch(page, here)
  await drag(cdp, page, 360, 70)
  const s4 = await settle(page)
  check(s4.seen !== null && s4.seen <= 100, `quick second turn: John 3 visible in ${s4.seen} ms, spinner ${s4.spinner}`)
  // selection label on the carried-in page: runs compress
  await page.waitForTimeout(500)
  for (const v of [1, 2, 4, 5]) {
    await page.evaluate(n => {
      const s = [...document.querySelectorAll('span')].find(x => x.textContent?.trim() === String(n) && x.getBoundingClientRect().width < 40 && x.checkVisibility({ visibilityProperty: true }) && x.getBoundingClientRect().left >= 0)
      s?.parentElement?.click()
    }, v)
    await page.waitForTimeout(150)
  }
  await page.waitForTimeout(400)
  const label = await page.getByText(/^John 3:1-2, 4-5$/).count()
  check(label > 0, 'selection label reads "John 3:1-2, 4-5"')
  await page.screenshot({ path: `${shots}/selection-label.png` })
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors')
  await page.context().close()
}

// ---- Reduce animation: turns are instant and still carry text ----
{
  const { page, errors, cdp } = await open(true)
  await page.goto(base + '/read/19/23', { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Jehovah is my shepherd'); await page.waitForTimeout(900)
  const next = await firstWords(page, 19, 24)
  await watch(page, next)
  await drag(cdp, page, 360, 70)
  const s = await settle(page)
  check(s.seen !== null && s.seen <= 100 && s.rest !== null && s.rest <= 100, `reduce motion: Psalm 24 visible ${s.seen} ms, at rest ${s.rest} ms, longest task ${s.longest} ms`)
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors (reduce)')
  await page.context().close()
}
await browser.close()
console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
