// Vertical chapter turns from the ends of the scroll: a touch pull past the bottom lands on the next chapter at its
// top, a pull past the top lands on the previous chapter at its end, a release short of the threshold does nothing,
// the mouse wheel turns once (not repeatedly) and only from a gesture begun at the end, momentum that merely reaches
// the end never turns, and Revelation 22 goes nowhere. BASE=http://127.0.0.1:8862 node scripts/vpull-check.mjs
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const shots = process.env.SHOTS ?? '/tmp/wt-vpull'
await import('node:fs').then(fs => fs.mkdirSync(shots, { recursive: true }))
const W = 412, H = 860
const browser = await chromium.launch()
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++ }
const PREFS = r => JSON.stringify({ theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: r, align: 'center', width: 'medium' })

async function open({ reduceMotion = false, touch = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch })
  await ctx.addInitScript(p => {
    localStorage.setItem('berean_prefs', p)
    // the current page's scroll element: the visible, scrollable div outside the hidden neighbours
    window.__cur = () => [...document.querySelectorAll('div')].find(d => {
      const s = getComputedStyle(d), r = d.getBoundingClientRect()
      return /auto|scroll/.test(s.overflowY) && !d.closest('[aria-hidden="true"]') && r.width > 300 && Math.abs(r.left) < 2 && r.height > 300 && d.checkVisibility({ visibilityProperty: true })
    })
  }, PREFS(reduceMotion))
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  return { ctx, page, errors, cdp: touch ? await ctx.newCDPSession(page) : null }
}
const path = page => new URL(page.url()).pathname
const scrollState = page => page.evaluate(() => { const d = window.__cur(); return d ? { top: Math.round(d.scrollTop), max: d.scrollHeight - d.clientHeight } : null })
async function toEnd(page, where) {
  await page.evaluate(w => { const d = window.__cur(); d.scrollTop = w === 'bottom' ? d.scrollHeight : 0 }, where)
  await page.waitForTimeout(400)
}
/** A cue by its label: painted opacity (product of ancestors) and whether it is inside the viewport. */
const cueState = (page, label) => page.evaluate(([label, H]) => {
  const el = [...document.querySelectorAll('div')].find(d => d.childElementCount === 0 && d.textContent === label)
  if (!el) return { found: false }
  let o = 1
  for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity || '1')
  const r = el.getBoundingClientRect()
  return { found: true, opacity: +o.toFixed(2), onScreen: r.bottom > 0 && r.top < H && r.height > 0, y: Math.round(r.top) }
}, [label, H])
/** A vertical touch drag from y0 to y1 at x, in 16 ms steps; `onStep(i, y)` may inspect mid-drag. */
async function vdrag(cdp, page, y0, y1, { steps = 16, onStep, x = 206 } = {}) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
  for (let i = 1; i <= steps; i++) {
    const y = y0 + (y1 - y0) * i / steps
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
    await page.waitForTimeout(16)
    if (onStep) await onStep(i, y)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
const settle = page => page.waitForTimeout(900)
const firstWords = (page, b, c) => page.evaluate(async ([b, c]) => (await (await fetch(`/bible/${b}/${c}.json`)).json()).verses[0].t.split(' ').slice(0, 5).join(' '), [b, c])
/** Text painted inside the viewport (the neighbours carry the same words offscreen). */
const onScreen = (page, snippet) => page.evaluate(([snippet, W, H]) => {
  let best = null
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent?.includes(snippet)) best = n
  if (!best) return false
  const r = best.getBoundingClientRect()
  return best.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && r.right > 0 && r.left < W && r.bottom > 0 && r.top < H
}, [snippet, W, H])

// ---- touch: bottom of Genesis 1 → Genesis 2 at its top → back to Genesis 1 at its end ----
{
  const { page, errors, cdp } = await open()
  await page.goto(base + '/read/1/1', { waitUntil: 'networkidle' })
  await page.waitForSelector('text=In the beginning'); await page.waitForTimeout(900)
  await toEnd(page, 'bottom')
  const at = await scrollState(page)
  check(at && at.max > 0 && at.top >= at.max - 2, `Genesis 1 scrolled to its end (${at?.top} of ${at?.max})`)
  // short pull: the cue shows but a release before the threshold does nothing
  let short = null
  await vdrag(cdp, page, 600, 560, { steps: 8, onStep: async i => { if (i === 8) short = await cueState(page, 'Next: Genesis 2') } })
  check(short?.found && short.onScreen && short.opacity > 0 && short.opacity < 1, `short pull shows a partial cue (opacity ${short?.opacity})`)
  await settle(page)
  const after = await scrollState(page)
  const gone = await cueState(page, 'Next: Genesis 2')
  check(path(page) === '/read/1/1' && after.top >= after.max - 2, `release before the threshold stays on Genesis 1 at its end (${path(page)}, ${after.top}/${after.max})`)
  check(!gone.onScreen || gone.opacity === 0, `the cue eased away (opacity ${gone.opacity})`)
  await page.screenshot({ path: `${shots}/vpull-short-released.png` })
  // full pull: the cue grows, lights, and the release turns
  let mid = null
  await vdrag(cdp, page, 640, 420, { steps: 16, onStep: async i => { if (i === 14) { mid = await cueState(page, 'Next: Genesis 2'); await page.screenshot({ path: `${shots}/vpull-mid.png` }) } } })
  check(mid?.found && mid.onScreen && mid.opacity >= 0.99, `mid-pull past the threshold: "Next: Genesis 2" fully shown at y ${mid?.y} (opacity ${mid?.opacity})`)
  // mid-slide: the cue rides in the gap between the chapters and never over the incoming text
  const g2first = await firstWords(page, 1, 2)
  const slide = await page.evaluate(([label, snippet]) => {
    const cue = [...document.querySelectorAll('div')].find(d => d.childElementCount === 0 && d.textContent === label)
    let text = null
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent?.includes(snippet)) text = n
    return { cue: cue ? Math.round(cue.getBoundingClientRect().bottom) : null, text: text ? Math.round(text.getBoundingClientRect().top) : null }
  }, ['Next: Genesis 2', g2first])
  await page.screenshot({ path: `${shots}/vpull-sliding.png` })
  check(slide.cue !== null && slide.text !== null && slide.cue < slide.text, `mid-slide the cue (bottom ${slide.cue}) stays above Genesis 2's text (top ${slide.text})`)
  await settle(page)
  const g2 = await scrollState(page)
  check(path(page) === '/read/1/2', `landed on ${path(page)}`)
  check(g2 && g2.top <= 2, `Genesis 2 opens at its top (scrollTop ${g2?.top})`)
  const g2words = await firstWords(page, 1, 2)
  check(await onScreen(page, g2words), `Genesis 2 opens on its first verse ("${g2words}…" on screen)`)
  await page.screenshot({ path: `${shots}/vpull-landed-next.png` })
  // pull down past the top of Genesis 2: back to Genesis 1, at its end
  let up = null
  await vdrag(cdp, page, 260, 480, { steps: 16, onStep: async i => { if (i === 14) { up = await cueState(page, 'Previous: Genesis 1'); await page.screenshot({ path: `${shots}/vpull-mid-prev.png` }) } } })
  check(up?.found && up.onScreen && up.opacity >= 0.99, `pull down: "Previous: Genesis 1" shown (opacity ${up?.opacity})`)
  await settle(page)
  const g1 = await scrollState(page)
  check(path(page) === '/read/1/1', `landed back on ${path(page)}`)
  check(g1 && g1.top >= g1.max - 2, `Genesis 1 opens at its end (${g1?.top} of ${g1?.max})`)
  await page.screenshot({ path: `${shots}/vpull-landed-prev.png` })
  // a scroll that starts mid-chapter and runs into the end is a scroll, not a pull
  await page.evaluate(() => { const d = window.__cur(); d.scrollTop = d.scrollHeight - d.clientHeight - 150 })
  await page.waitForTimeout(400)
  await vdrag(cdp, page, 700, 300, { steps: 16 })
  await settle(page)
  check(path(page) === '/read/1/1', `a drag begun 150 px above the end stays on Genesis 1 (${path(page)})`)
  // sideways swipe still turns chapters
  await page.waitForTimeout(300)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 360, y: 480 }] })
  for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 360 - 290 * i / 12, y: 480 }] }); await page.waitForTimeout(16) }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await settle(page)
  check(path(page) === '/read/1/2', `sideways swipe still turns (${path(page)})`)
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors (touch)')
  await page.context().close()
}

// ---- regressions (build 26): scrolling back from an end is a scroll; flicks into the end are scrolling ----
/**
 * A quick stroke of dy (+ = finger down = scroll up) from y0: `steps` moves `ms` apart by the events' own timestamps,
 * as a phone's hardware stamps them. (Without them each CDP event waits for the page to handle the last, and a
 * flick over a busy main thread would arrive as a slow drag.)
 */
async function flick(cdp, dy, y0, steps = 6, ms = 4) {
  const t0 = Date.now() / 1000
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 206, y: y0 }], timestamp: t0 })
  for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 206, y: y0 + dy * i / steps }], timestamp: t0 + i * ms / 1000 })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + (steps + 1) * ms / 1000 })
}
{
  const { page, errors, cdp } = await open()
  await page.goto(base + '/read/1/1', { waitUntil: 'networkidle' })
  await page.waitForSelector('text=In the beginning'); await page.waitForTimeout(900)
  // fast flicks down to the end, then straight away a drag back up (finger down)
  for (let i = 0; i < 12; i++) {
    await flick(cdp, -600, 760)
    await page.waitForTimeout(60)
    const s = await scrollState(page)
    if (s.top >= s.max - 2) break
  }
  const b1 = await scrollState(page)
  check(path(page) === '/read/1/1' && b1.top >= b1.max - 2, `fast flicks reach the end of Genesis 1 without turning (${b1.top}/${b1.max}, ${path(page)})`)
  await vdrag(cdp, page, 200, 600)
  await settle(page)
  const u1 = await scrollState(page)
  check(path(page) === '/read/1/1' && u1.top < b1.top - 200, `a drag back up right after the flicks scrolls (${b1.top} → ${u1.top}, ${path(page)})`)
  // a flick that starts as the scroll arrives at the end is a flick (fast, released at once): it never turns
  await page.evaluate(() => { const d = window.__cur(); d.scrollTop = d.scrollHeight })
  await page.waitForTimeout(40)
  await flick(cdp, -500, 760)
  await settle(page)
  check(path(page) === '/read/1/1', `a flick begun as the scroll arrives at the end does not turn (${path(page)})`)
  // after a vertical turn the edges are the new chapter's: from its end, dragging up scrolls, pulling on turns
  await toEnd(page, 'bottom')
  await vdrag(cdp, page, 640, 420)
  await settle(page)
  check(path(page) === '/read/1/2', `pulled on to ${path(page)}`)
  await toEnd(page, 'bottom')
  const b2 = await scrollState(page)
  let prevented = null
  await vdrag(cdp, page, 200, 600, { onStep: async i => { if (i === 16) prevented = await cueState(page, 'Previous: Genesis 1') } })
  await settle(page)
  const u2 = await scrollState(page)
  check(path(page) === '/read/1/2' && u2.top < b2.top - 200, `after a turn, dragging up from the bottom of Genesis 2 scrolls up (${b2.top} → ${u2.top}, ${path(page)})`)
  check(!prevented?.onScreen || prevented.opacity === 0, 'and no “Previous” cue appears while doing it')
  await toEnd(page, 'bottom')
  await vdrag(cdp, page, 640, 420)
  await settle(page)
  check(path(page) === '/read/1/3', `and pulling on past the end of Genesis 2 still turns (${path(page)})`)
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors (regressions)')
  await page.context().close()
}

// ---- build 27: a deliberate pull straight after a fling works; a run of flicks at the end never turns ----
{
  const { page, errors, cdp } = await open()
  await page.goto(base + '/read/1/1', { waitUntil: 'networkidle' })
  await page.waitForSelector('text=In the beginning'); await page.waitForTimeout(900)
  await page.evaluate(() => { window.__scrolled = 0; document.addEventListener('scroll', e => { window.__scrolled = e.timeStamp }, true); addEventListener('touchstart', e => { window.__down = e.timeStamp }, true) })
  // fling down until the scroll lands at the end, then pull at once, at a hand's speed
  const atEnd = () => page.waitForFunction(() => { const d = window.__cur(); return d.scrollTop >= d.scrollHeight - d.clientHeight - 2 }, null, { polling: 'raf', timeout: 700 }).then(() => true, () => false)
  let landedAtEnd = false
  for (let i = 0; i < 12 && !landedAtEnd; i++) {
    await flick(cdp, -300, 700, 6, 6)
    landedAtEnd = await atEnd()
  }
  await vdrag(cdp, page, 640, 400)
  const gap = await page.evaluate(() => Math.round(window.__down - window.__scrolled))
  await settle(page)
  check(landedAtEnd && gap < 150 && path(page) === '/read/1/2', `a deliberate pull ${gap} ms after a fling landed at the end turns (${path(page)})`)
  // at the end, at rest: a run of quick flicks (short, fast strokes released at once) never turns
  await toEnd(page, 'bottom')
  const here = path(page)
  for (let i = 0; i < 6; i++) { await flick(cdp, -500, 760); await page.waitForTimeout(60) }
  await settle(page)
  const after = await scrollState(page)
  check(path(page) === here && after.top >= after.max - 2, `six quick flicks at the end of ${here} stay on it (${path(page)})`)
  // and one hard flick right after landing from a fling
  await page.evaluate(() => { window.__cur().scrollTop = 0 })
  await page.waitForTimeout(400)
  for (let i = 0; i < 12; i++) {
    await flick(cdp, -600, 760)
    await page.waitForTimeout(40)
    const s = await scrollState(page)
    if (s.top >= s.max - 2) break
  }
  const here2 = path(page)
  await flick(cdp, -500, 760)
  await settle(page)
  check(path(page) === here2, `a quick flick straight after a fling lands at the end does not turn (${here2} → ${path(page)})`)
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors (fling then pull)')
  await page.context().close()
}

// ---- chapters shorter or barely longer than the screen: Psalm 117, Obadiah ----
{
  const { page, errors, cdp } = await open()
  await page.goto(base + '/read/19/117', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__cur()); await page.waitForTimeout(900)
  const s = await scrollState(page)
  // nothing to scroll: a vertical drag can only be a pull, and a short one does nothing
  await vdrag(cdp, page, 300, 340, { steps: 8 })
  await settle(page)
  check(path(page) === '/read/19/117', `Psalm 117 (scroll range ${s.max}): a short drag down stays (${path(page)})`)
  await vdrag(cdp, page, 640, 420)
  await settle(page)
  check(path(page) === '/read/19/118', `Psalm 117: pulling up turns to ${path(page)}, at its top (${(await scrollState(page)).top})`)
  await page.goto(base + '/read/31/1', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__cur()); await page.waitForTimeout(900)
  await toEnd(page, 'bottom')
  const ob = await scrollState(page)
  await vdrag(cdp, page, 200, 600)
  await settle(page)
  const obu = await scrollState(page)
  check(path(page) === '/read/31/1' && obu.top < ob.top - 200, `Obadiah: dragging up from the end scrolls (${ob.top} → ${obu.top}, ${path(page)})`)
  await toEnd(page, 'top')
  await vdrag(cdp, page, 600, 200)
  await settle(page)
  const obd = await scrollState(page)
  check(path(page) === '/read/31/1' && obd.top > 200, `Obadiah: dragging down from the top scrolls (0 → ${obd.top}, ${path(page)})`)
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors (short chapters)')
  await page.context().close()
}

// ---- mouse wheel ----
{
  const { page, errors } = await open({ touch: false })
  await page.goto(base + '/read/1/1', { waitUntil: 'networkidle' })
  await page.waitForSelector('text=In the beginning'); await page.waitForTimeout(900)
  await page.mouse.move(206, 500)
  // momentum that scrolls down through the end: one continuous stream, never a turn
  for (let i = 0; i < 160; i++) { await page.mouse.wheel(0, 60); await page.waitForTimeout(12) }
  await page.waitForTimeout(400)
  const s = await scrollState(page)
  check(path(page) === '/read/1/1' && s.top >= s.max - 2, `a wheel stream that runs into the end does not turn (${path(page)}, ${s.top}/${s.max})`)
  // one notch at the end: the cue shows and eases back
  await page.mouse.wheel(0, 100)
  await page.waitForTimeout(60)
  const one = await cueState(page, 'Next: Genesis 2')
  await page.waitForTimeout(700)
  check(path(page) === '/read/1/1' && one.onScreen && one.opacity > 0, `one notch pulls the cue (opacity ${one.opacity}) and lets go`)
  // a deliberate gesture begun at the end: three notches turn, and its tail (momentum) does not turn again
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(50) }
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(14); await page.mouse.wheel(0, 40) }
  await settle(page)
  const g2 = await scrollState(page)
  check(path(page) === '/read/1/2', `wheel past the end turned once, to ${path(page)}`)
  check(g2 && g2.top <= 2, `its momentum tail did not scroll Genesis 2 (scrollTop ${g2?.top})`)
  await page.screenshot({ path: `${shots}/vpull-wheel-landed.png` })
  // regression (build 26): after a turn, the wheel read the edges of the page turned away from, so wheeling up from
  // the bottom of the new chapter turned back to the previous one
  await page.waitForTimeout(400)
  for (let i = 0; i < 80; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(8) }
  await page.waitForTimeout(400)
  const b2 = await scrollState(page)
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(30) }
  await settle(page)
  const u2 = await scrollState(page)
  check(path(page) === '/read/1/2' && b2.top >= b2.max - 2 && u2.top < b2.top - 100, `after a turn, wheel up from the bottom of Genesis 2 scrolls up (${b2.top} → ${u2.top}, ${path(page)})`)
  // and back up past the top
  await page.evaluate(() => { window.__cur().scrollTop = 0 })
  await page.waitForTimeout(400)
  // Chromium divides the synthetic delta by the device scale factor (a "100" notch arrives as 50): three notches
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(50) }
  await settle(page)
  const g1 = await scrollState(page)
  check(path(page) === '/read/1/1' && g1.top >= g1.max - 2, `wheel up past the top: ${path(page)} at its end (${g1.top}/${g1.max})`)
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors (wheel)')
  await page.context().close()
}

// ---- Revelation 22: the end of the Bible goes nowhere ----
{
  const { page, errors, cdp } = await open()
  await page.goto(base + '/read/66/22', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__cur()); await page.waitForTimeout(900)
  await toEnd(page, 'bottom')
  let last = null
  await vdrag(cdp, page, 640, 380, { steps: 16, onStep: async i => { if (i === 14) { last = await cueState(page, 'Revelation 22 is the last chapter'); await page.screenshot({ path: `${shots}/vpull-last.png` }) } } })
  check(last?.found && last.onScreen, `Revelation 22: the cue says it is the last chapter (opacity ${last?.opacity})`)
  await settle(page)
  const s = await scrollState(page)
  check(path(page) === '/read/66/22' && s.top >= s.max - 2, `Revelation 22 bottom: the pull goes nowhere (${path(page)})`)
  await page.mouse.move(206, 500)
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(50) }
  await settle(page)
  check(path(page) === '/read/66/22', `Revelation 22 bottom: the wheel goes nowhere (${path(page)})`)
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors (end)')
  await page.context().close()
}

// ---- Reduce animation: the turn is instant ----
{
  const { page, errors, cdp } = await open({ reduceMotion: true })
  await page.goto(base + '/read/19/23', { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Jehovah is my shepherd'); await page.waitForTimeout(900)
  await toEnd(page, 'bottom')
  await vdrag(cdp, page, 640, 420)
  await page.waitForTimeout(250)
  check(path(page) === '/read/19/24', `reduce motion: Psalm 24 within 250 ms (${path(page)})`)
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors (reduce)')
  await page.context().close()
}
await browser.close()
console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
