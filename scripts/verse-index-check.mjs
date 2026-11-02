// The scroll reader's verse index (1.3.2): nothing at rest or on a link's landing, the reader's own scrolling brings it
// up and it goes once the page rests; on the band a tap turns the chapter, a still press and a short sideways drag do
// not, a vertical drag scrubs (the page at the verse under the finger, the pill naming it, fine mode one verse per
// 16 px, the landing tinted once, the page then still, the text untouched); the same with footnotes open, a second
// Bible, Reduce animation, and a narrow phone. BASE=http://127.0.0.1:8098 node scripts/verse-index-check.mjs
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const api = process.env.API ?? base
const shots = process.env.SHOTS ?? '/tmp/wt-verse-index'
await import('node:fs').then(fs => fs.mkdirSync(shots, { recursive: true }))
const browser = await chromium.launch()
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++ }
const PREFS = ({ reduceMotion, bible2 }) => JSON.stringify({ theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion, align: 'center', width: 'medium', bible2 })

async function open({ reduceMotion = false, bible2 = '', touch = true, width = touch ? 412 : 1280, height = touch ? 860 : 800 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch })
  await ctx.addInitScript(({ p, api }) => {
    localStorage.setItem('berean_prefs', p)
    localStorage.setItem('berean_api_base', api)
    // the current page's scroll element: the innermost visible, scrollable div outside the hidden neighbours under a
    // point just inside the band (the page need not start at x 0: on a desktop the book pane sits to its left)
    window.__cur = () => {
      const b = document.querySelector('[data-testid="verse-index-band"]')?.getBoundingClientRect()
      if (!b) return undefined
      const x = b.left - 30, y = (b.top + b.bottom) / 2
      return [...document.querySelectorAll('div')].filter(d => {
        const s = getComputedStyle(d), r = d.getBoundingClientRect()
        return /auto|scroll/.test(s.overflowY) && !d.closest('[aria-hidden="true"]') && r.width > 300 && r.height > 300 && r.left <= x && x < r.right && r.top <= y && y < r.bottom && d.checkVisibility({ visibilityProperty: true })
      }).pop()
    }
    // verse n on the live page: the zero-size marker at its first line (data-verse-mark, English numbering), its verse
    // span and its number span ("n "); a second Bible's verses carry no marker
    window.__verse = n => {
      const cur = window.__cur()
      const marker = cur?.querySelector(`[data-verse-mark="${n}"]`)
      const num = marker && [...marker.parentElement.children].find(s => s.textContent === `${n} `)
      return num ? { cur, span: marker.parentElement, marker, num } : null
    }
  }, { p: PREFS({ reduceMotion, bible2 }), api })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const cdp = touch ? await ctx.newCDPSession(page) : null
  const finger = touch ? { scrub: (pts, o) => scrub(cdp, page, pts, o), lift: () => lift(cdp) } : { scrub: (pts, o) => mscrub(page, pts, o), lift: () => mlift(page) }
  return { ctx, page, errors, cdp, finger }
}
const path = page => new URL(page.url()).pathname
const settle = page => page.waitForTimeout(900)
async function john1(page) {
  await page.goto(base + '/read/43/1', { waitUntil: 'networkidle' })
  await page.waitForSelector('text=beginning was the Word'); await page.waitForTimeout(900)
}
const scrollState = page => page.evaluate(() => { const d = window.__cur(); return d ? { top: Math.round(d.scrollTop), max: d.scrollHeight - d.clientHeight } : null })
const band = page => page.evaluate(() => { const r = document.querySelector('[data-testid="verse-index-band"]')?.getBoundingClientRect(); return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null })
/** A point on the reading column's text, 120 px in from the band: on a desktop the book pane takes the left of the window. */
const column = async page => { const r = await band(page); return [r.left - 120, (r.top + r.bottom) / 2] }
/** The face's computed opacity as a string ('0', '0.43', '1'); null while it has never been drawn. */
const faceOpacity = page => page.evaluate(() => { const el = document.querySelector('[data-testid="verse-index"]'); return el ? getComputedStyle(el).opacity : null })
const shown = o => o !== null && +o > 0
const gone = o => o === null || +o === 0
const say = o => o === null ? 'not drawn' : `opacity ${o}`
const pillOf = (page, ref) => page.getByRole('button', { name: new RegExp(`^${ref}(:\\d+)? ▾$`) }).first()
const pill = async (page, ref = 'John 1') => { const b = pillOf(page, ref); return (await b.count()) ? (await b.textContent()).trim() : null }
const verseOf = text => +(text?.match(/:(\d+) ▾$/)?.[1] ?? 0)
/** Where verse n's number sits on the page: px below the page's top edge, and the line-height of its run (19 × 1.6 by the
 *  prefs). On the page's first line and not cut means `0 <= top < lh`; null when the verse is not on the page. */
const numberLine = (page, n) => page.evaluate(n => {
  const v = window.__verse(n)
  if (!v) return null
  let run = v.span
  while (getComputedStyle(run).display === 'inline') run = run.parentElement
  return { top: +(v.num.getBoundingClientRect().top - v.cur.getBoundingClientRect().top).toFixed(1), lh: parseFloat(getComputedStyle(run).lineHeight) }
}, n)
const onFirstLine = l => l !== null && l.top >= 0 && l.top < l.lh
const verseTint = (page, n) => page.evaluate(n => { const v = window.__verse(n); return v ? getComputedStyle(v.span).backgroundColor : null }, n)
const CLEAR = 'rgba(0, 0, 0, 0)'
/** A cue by its label: painted opacity (product of ancestors) and whether it is inside the viewport. */
const cueState = (page, label) => page.evaluate(([label, H]) => {
  const el = [...document.querySelectorAll('div')].find(d => d.childElementCount === 0 && d.textContent === label)
  if (!el) return { found: false }
  let o = 1
  for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity || '1')
  const r = el.getBoundingClientRect()
  return { found: true, opacity: +o.toFixed(2), onScreen: r.bottom > 0 && r.top < H && r.height > 0, y: Math.round(r.top) }
}, [label, page.viewportSize().height])
const cueSays = c => c?.found ? `opacity ${c.opacity}` : 'not found'
/** `steps + 1` points from `from` to `to`, the first being `from`. */
const line = ([x0, y0], [x1, y1], steps) => Array.from({ length: steps + 1 }, (_, i) => [x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps])
/** A touch down at `points[0]`, then moves through the rest 16 ms apart, without lifting; `onStep(i)` may inspect mid-drag. */
async function scrub(cdp, page, points, { onStep } = {}) {
  const [x, y] = points[0]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
    await page.waitForTimeout(16)
    if (onStep) await onStep(i)
  }
}
const lift = cdp => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
/** The mouse's `scrub`: button down at `points[0]`, moves through the rest 16 ms apart. */
async function mscrub(page, points, { onStep } = {}) {
  await page.mouse.move(...points[0])
  await page.mouse.down()
  for (let i = 1; i < points.length; i++) {
    await page.mouse.move(...points[i])
    await page.waitForTimeout(16)
    if (onStep) await onStep(i)
  }
}
const mlift = page => page.mouse.up()
/** Polls `probe` every `every` ms until it holds or `ms` have passed: the ms it took, or null. */
async function within(page, ms, probe, every = 50) {
  const t0 = Date.now()
  for (;;) {
    if (await probe()) return Date.now() - t0
    if (Date.now() - t0 >= ms) return null
    await page.waitForTimeout(every)
  }
}
/** The index should be gone ~1.8 s after the reader's last input at `t0` (1.2 s of rest, then the fade): waits for
 *  that moment, then allows 400 ms more. */
async function goneAfter(page, t0, tag, what) {
  await page.waitForTimeout(Math.max(0, 1800 - (Date.now() - t0)))
  const late = await within(page, 400, async () => gone(await faceOpacity(page)))
  check(late !== null, late === null ? `${tag}: the index is still up 2.2 s after ${what} (${say(await faceOpacity(page))})` : `${tag}: the index is gone ${Date.now() - t0} ms after ${what}`)
}
/**
 * A scrub on John 1 as just opened, by touch or mouse: while held the pill names the verse at the finger and the page
 * sits at that verse's top; after the release the pill reverts, the landing is tinted once and the page stays.
 * Returns the verse landed on.
 */
async function scrubChecks(page, finger, tag) {
  const r = await band(page)
  // from the column's middle: a verse well before the last screenful, whose target is its own top and not the scroll's end
  const x = r.left + 9, y0 = r.top + r.height / 2
  await finger.scrub(line([x, y0], [x, y0 + 24], 3))
  await page.waitForTimeout(80)
  const held = await pill(page)
  const n = verseOf(held)
  const num = n ? await numberLine(page, n) : null
  const at = await scrollState(page)
  await page.screenshot({ path: `${shots}/verse-index-held-${tag.replace(/\W+/g, '-')}.png` })
  // what a reader sees: the landed verse's number on the first line, whole. Strict on purpose: the verse landed on here
  // (John 1:28 from the column's middle) heads no paragraph with a heading or a printed-chapter label, which would sit
  // the number lower than the paragraph's top the page scrolls to
  check(n > 0 && onFirstLine(num), `${tag}: held, the pill reads "${held}" and verse ${n}'s number is on the page's first line (${num ? `${num.top} px below the top, lines ${num.lh} px` : 'not found'}; scrollTop ${at?.top})`)
  await finger.lift()
  const t0 = Date.now()
  const tinted = await within(page, 400, async () => n > 0 && (await verseTint(page, n)) !== CLEAR)
  const rested = await pill(page)
  check(rested === 'John 1 ▾', `${tag}: released, the pill reads "${rested}"`)
  check(tinted !== null, tinted === null ? `${tag}: verse ${n} not tinted within 400 ms of the release` : `${tag}: verse ${n} tinted ${tinted} ms after the release`)
  await page.waitForTimeout(Math.max(0, 500 - (Date.now() - t0)))
  const later = await scrollState(page)
  check(later.top === at.top, `${tag}: the page has not moved 500 ms after the release (${at.top} → ${later.top})`)
  await page.waitForTimeout(Math.max(0, 3500 - (Date.now() - t0)))
  const tint = await verseTint(page, n)
  check(tint === CLEAR, `${tag}: verse ${n} transparent again 3.5 s after the release (${tint})`)
  return n
}

// ---- at rest, a link's landing, and the reader's own scrolling (touch) ----
{
  const { page, errors, finger } = await open()
  await john1(page)
  const r = await band(page)
  check(r && Math.round(r.width) === 18, r ? `the band is ${r.width} px wide at x ${Math.round(r.left)}, y ${Math.round(r.top)}–${Math.round(r.bottom)}` : 'no band on the page')
  const rest = await faceOpacity(page)
  check(gone(rest), `John 1 at rest: no index (${say(rest)})`)
  await page.goto(base + '/read/43/1?v=29', { waitUntil: 'networkidle' })
  await page.waitForSelector('text=beginning was the Word')
  const samples = []
  for (let i = 0; i < 15; i++) { samples.push(await faceOpacity(page)); await page.waitForTimeout(100) }
  const peak = Math.max(...samples.map(o => o === null ? 0 : +o))
  const landed = await scrollState(page)
  check(peak === 0 && landed?.top > 0, `a link's landing on verse 29 (scrollTop ${landed?.top}) never shows the index (peak opacity ${peak} over 1.5 s)`)
  await john1(page)
  let shownAt = null
  await finger.scrub(line([206, 600], [206, 300], 16), { onStep: async i => { if (shownAt === null && shown(await faceOpacity(page))) shownAt = i } })
  // held still before the lift: no fling, so the page rests the moment the finger leaves
  await page.waitForTimeout(150)
  await finger.lift()
  const t0 = Date.now()
  check(shownAt !== null, shownAt === null ? `touch: a drag on the page never showed the index (${say(await faceOpacity(page))})` : `touch: a drag on the page shows the index by move ${shownAt} of 16`)
  await goneAfter(page, t0, 'touch', 'the lift')
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors (rest, landing, scrolling)')
  await page.context().close()
}

// ---- the band's own gestures: a still press and a short sideways drag turn nothing; a tap and a sideways-left drag turn ----
{
  const { page, errors, cdp } = await open()
  await john1(page)
  const r = await band(page)
  const x = r.left + 9, y = r.top + r.height / 2
  await scrub(cdp, page, [[x, y]]); await page.waitForTimeout(600); await lift(cdp)
  await settle(page)
  const still = await scrollState(page)
  check(path(page) === '/read/43/1' && still.top === 0, `a press held still 600 ms on the band turns nothing and keeps the place (${path(page)}, scrollTop ${still.top})`)
  // 20 px, not less: Chrome sends no touchmove until a touch leaves its ~15 px slop, so a shorter wiggle reaches the band
  // as a press and is a tap there, as it was for the Pressable; the phone's responder sees every move
  await scrub(cdp, page, line([x, y], [x - 20, y], 10)); await lift(cdp)
  await settle(page)
  check(path(page) === '/read/43/1', `a sideways drag let go 20 px left of where it began turns nothing (${path(page)})`)
  // a turn is waited for, up to 3 s: on a loaded machine the dev build's turn (the pager's slide, then the route)
  // takes longer than settle's 900 ms, though the band asked for it at once (measured: every tap turned by 3.5 s)
  const turned = () => within(page, 3000, async () => path(page) === '/read/43/2')
  await scrub(cdp, page, [[x, y]]); await page.waitForTimeout(60); await lift(cdp)
  const tapMs = await turned()
  check(tapMs !== null, `a tap on the band turns to ${path(page)}${tapMs === null ? ' (none within 3 s)' : ` in ${tapMs} ms`}`)
  await john1(page)
  await scrub(cdp, page, line([x, y], [x - 60, y], 10)); await lift(cdp)
  const swipeMs = await turned()
  check(swipeMs !== null, `a sideways drag let go 60 px left turns to ${path(page)}${swipeMs === null ? ' (none within 3 s)' : ` in ${swipeMs} ms`}`)
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors (band gestures)')
  await page.context().close()
}

// ---- scrubbing: the page follows the finger, fine mode, the chapter's top, and the text untouched ----
{
  const { page, errors, cdp, finger } = await open()
  await john1(page)
  await scrubChecks(page, finger, 'touch')
  const r = await band(page)
  const x = r.left + 9, y0 = r.top + r.height / 2, at = y0 + 24
  // three steps down, then across the 40 px line at the same y (fine mode anchors where it is crossed), then 48 px down
  const pts = [...line([x, y0], [x, at], 3), ...line([x, at], [r.left - 44, at], 4).slice(1), ...line([r.left - 44, at], [r.left - 44, at + 48], 3).slice(1)]
  let coarse = null, fine = null
  await scrub(cdp, page, pts, { onStep: async i => {
    if (i === 7) { await page.waitForTimeout(60); coarse = await pill(page) }
    if (i === 10) { await page.waitForTimeout(60); fine = await pill(page); await page.screenshot({ path: `${shots}/verse-index-fine.png` }) }
  } })
  await lift(cdp)
  const a = verseOf(coarse), b = verseOf(fine)
  check(a > 0 && b === a + 3, `fine mode: 44 px inward the pill reads "${coarse}"; 48 px further down it reads "${fine}" (three verses on)`)
  await settle(page)
  await page.evaluate(() => { window.__cur().scrollTop = 0 })
  await page.waitForTimeout(400)
  let cueMid = null, pillMid = null
  await scrub(cdp, page, line([x, 300], [x, 500], 10), { onStep: async i => { if (i === 10) { await page.waitForTimeout(60); cueMid = await cueState(page, 'Previous: Luke 24'); pillMid = await pill(page) } } })
  await lift(cdp)
  await settle(page)
  const cueAfter = await cueState(page, 'Previous: Luke 24')
  check((!cueMid?.found || cueMid.opacity === 0) && (!cueAfter.found || cueAfter.opacity === 0), `at the chapter's top a drag down the band opens no "Previous: Luke 24" cue (held: ${cueSays(cueMid)}; after: ${cueSays(cueAfter)})`)
  check(/^John 1:\d+ ▾$/.test(pillMid ?? ''), `it scrubbed instead: the pill read "${pillMid}" while held`)
  await page.evaluate(() => {
    window.__muts = 0
    window.__mo = new MutationObserver(ms => { window.__muts += ms.length })
    window.__mo.observe(window.__cur(), { childList: true, characterData: true, attributes: true, subtree: true })
  })
  await scrub(cdp, page, line([x, y0], [x, at], 3))
  await page.waitForTimeout(80)
  const during = await pill(page)
  const muts = await page.evaluate(() => { const n = window.__muts + window.__mo.takeRecords().length; window.__mo.disconnect(); return n })
  await lift(cdp)
  check(muts === 0 && /^John 1:\d+ ▾$/.test(during ?? ''), `nothing in the chapter text changes during a scrub (${muts} mutations while the pill read "${during}")`)
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors (scrubbing)')
  await page.context().close()
}

// ---- with all footnotes open: the verses are measured as the notes lay them out ----
{
  const { page, errors, finger } = await open()
  await john1(page)
  await page.getByRole('button', { name: 'Show all footnotes' }).click()
  await page.waitForTimeout(700)
  await scrubChecks(page, finger, 'all footnotes open')
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors (footnotes)')
  await page.context().close()
}

// ---- mouse: the wheel brings the index up and it goes when the page rests ----
{
  const { page, errors } = await open({ touch: false })
  await john1(page)
  await page.mouse.move(...await column(page))
  const t0 = Date.now()
  await page.mouse.wheel(0, 300)
  const up = await within(page, 300, async () => shown(await faceOpacity(page)), 30)
  check(up !== null, up === null ? `mouse: no index 300 ms after a wheel (${say(await faceOpacity(page))})` : `mouse: a wheel shows the index within ${up} ms (${say(await faceOpacity(page))})`)
  await page.screenshot({ path: `${shots}/verse-index-wheel.png` })
  await goneAfter(page, t0, 'mouse', 'the wheel')
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors (wheel)')
  await page.context().close()
}

// ---- a second Bible, under the verses (a phone) and beside them (a desktop): the English verse's top is the target ----
for (const [touch, tag] of [[true, 'second Bible under the verses, touch'], [false, 'second Bible beside the verses, mouse']]) {
  const { page, errors, finger } = await open({ touch, bible2: 'fr' })
  await john1(page)
  const twice = await page.waitForFunction(() => [...window.__cur().querySelectorAll('span')].filter(s => s.textContent === '1 ').length >= 2, null, { timeout: 8000 }).then(() => true, () => false)
  check(twice, `${tag}: verse 1's number is on the page twice (English and French)`)
  await scrubChecks(page, finger, tag)
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : `no page errors (${tag})`)
  await page.context().close()
}

// ---- Reduce animation (mouse): the index appears and goes at once ----
{
  const { page, errors } = await open({ touch: false, reduceMotion: true })
  await john1(page)
  await page.mouse.move(...await column(page))
  const t0 = Date.now()
  await page.mouse.wheel(0, 300)
  const samples = []
  for (let i = 0; i < 25; i++) { samples.push(await faceOpacity(page)); await page.waitForTimeout(16) }
  const seen = [...new Set(samples)].map(o => o === null ? 'absent' : o).join(', ')
  check(samples.every(o => o === null || o === '0' || o === '1') && samples.includes('1'), `reduce motion: over 400 ms after a wheel the face's opacity is only ever ${seen}`)
  await goneAfter(page, t0, 'reduce motion', 'the wheel')
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors (reduce motion)')
  await page.context().close()
}

// ---- a narrow phone and a long book name: the pill holds the whole reference ----
{
  const { page, errors, cdp } = await open({ width: 360, height: 780 })
  await page.goto(base + '/read/52/5', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__cur()); await page.waitForTimeout(900)
  const r = await band(page)
  // stop 22 of 28 (verse 23): 8 px pads at the column's ends, the stops spaced evenly by index between them
  const x = r.left + 9, y = r.top + 8 + (22 / 27) * (r.height - 16)
  await scrub(cdp, page, line([x, y - 24], [x, y], 3))
  await page.waitForTimeout(80)
  const b = pillOf(page, '1 Thessalonians 5')
  const p = (await b.count()) ? await b.evaluate(btn => {
    const text = [...btn.querySelectorAll('*')].find(e => getComputedStyle(e).textOverflow === 'ellipsis') ?? btn
    return { text: btn.textContent.trim(), truncated: text.scrollWidth > text.clientWidth + 1, right: Math.round(btn.getBoundingClientRect().right) }
  }) : null
  await page.screenshot({ path: `${shots}/verse-index-thess.png` })
  await lift(cdp)
  check(p?.text === '1 Thessalonians 5:23 ▾', `360 wide: scrubbed to stop 22 of 28, the pill reads "${p?.text ?? 'no pill'}"`)
  check(p && !p.truncated, p ? `360 wide: the pill's text is ${p.truncated ? '' : 'not '}truncated` : '360 wide: no pill to measure')
  check(p && p.right <= 360, `360 wide: the pill's right edge at x ${p?.right} is inside the viewport`)
  check(!errors.length, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors (narrow phone)')
  await page.context().close()
}
await browser.close()
console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
