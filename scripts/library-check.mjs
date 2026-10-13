// The ministry library reader at a 412 px phone (touch) and at 1280 wide: Home → Ministry → C. A. Coates → The
// Believer Established → its list of addresses → the reader; a sideways drag to the next section; the edge pull past the bottom to the next;
// the contents picker as a list (addresses) and as a grid (Coates's Outlines), and "All books" across the collection;
// the place kept on leaving and restored on return ("Continue reading" too); a reference followed into the Bible reader
// and back; a deep link with `p` (the paragraph at the top, washed) and `from` (Back returns to the verse); a volume of
// letters by number, when the server has one; Notes and Jottings as a list of readings before the reader, Back to the
// list, the pill's chevron whole at 360 px; the wide toolbar, arrow keys and the wheel.
// BASE=http://127.0.0.1:8841 OUT=/tmp/wt-ministry/library node scripts/library-check.mjs   (REDUCE=1: Reduce animation on)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8841'
const reduce = process.env.REDUCE === '1'
const out = process.env.OUT ?? '/tmp/wt-ministry/library'
const tag = reduce ? 'reduce-' : ''
mkdirSync(out, { recursive: true })
const W = 412, H = 915
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: reduce, align: 'center', width: 'medium', onboarded: true, toured: true }
const browser = await chromium.launch()
const errors = []
let failed = 0
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failed++ }

async function open({ touch = true, width = W, height = H, p = prefs } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch })
  await ctx.addInitScript(p => {
    if (!sessionStorage.getItem('primed')) { localStorage.setItem('berean_prefs', p); sessionStorage.setItem('primed', '1') }
    // the current page's scroll element: visible, scrollable, not inside a hidden neighbour, on screen
    window.__cur = () => [...document.querySelectorAll('div')].find(d => {
      const s = getComputedStyle(d), r = d.getBoundingClientRect()
      return /auto|scroll/.test(s.overflowY) && d.scrollHeight > d.clientHeight && !d.closest('[aria-hidden="true"]') && !d.closest('[role=dialog]') && r.width > 300 && Math.abs(r.left) < 2 && r.height > 300 && d.checkVisibility({ visibilityProperty: true })
    })
  }, JSON.stringify(p))
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|status of 404|when fetching the script/.test(m.text())) errors.push('console: ' + m.text()) })
  return { ctx, page, cdp: touch ? await ctx.newCDPSession(page) : null }
}
const shot = async (page, name, wait = 700) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${tag}${name}.png` }); console.log('shot', tag + name) }
const params = page => Object.fromEntries(new URL(page.url()).searchParams)
const scroll = page => page.evaluate(() => { const d = window.__cur(); return d ? { top: Math.round(d.scrollTop), max: d.scrollHeight - d.clientHeight } : null })
const setScroll = (page, y) => page.evaluate(y => { const d = window.__cur(); d.scrollTop = y === 'end' ? d.scrollHeight : y }, y)
/** Text painted inside the viewport (neighbours carry their text offscreen or hidden): any innermost element holding it. */
const onScreen = (page, snippet) => page.evaluate(([snippet, W, H]) => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!n.textContent?.includes(snippet) || [...n.children].some(c => c.textContent?.includes(snippet))) continue
    const r = n.getBoundingClientRect()
    if (n.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && r.right > 0 && r.left < W && r.bottom > 0 && r.top < H && r.width > 0) return true
  }
  return false
}, [snippet, W, H])
const waitOnScreen = async (page, snippet, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await onScreen(page, snippet)) return true; await page.waitForTimeout(150) } return false }
async function hdrag(cdp, page, fromX, toX, y = 520, steps = 12) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] })
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX + (toX - fromX) * i / steps, y }] }); await page.waitForTimeout(16) }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
async function vdrag(cdp, page, y0, y1, { steps = 16, onStep, x = 206 } = {}) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
  for (let i = 1; i <= steps; i++) {
    const y = y0 + (y1 - y0) * i / steps
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
    await page.waitForTimeout(16)
    if (onStep) await onStep(i)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
const titleButton = page => page.getByLabel(/, contents$/)
const dialog = page => page.getByRole('dialog').last()

// ---------------- phone ----------------
{
  const { page, cdp } = await open()
  // 1. Home → Ministry
  await page.goto(base + '/', { waitUntil: 'networkidle' })
  const row = page.getByLabel('Ministry', { exact: true })
  await row.waitFor({ timeout: 30000 }); await row.scrollIntoViewIfNeeded()
  await shot(page, '01-home-ministry-row')
  await row.click()
  await page.getByPlaceholder('Search by passage or title').waitFor()
  await page.getByText('C. A. Coates').first().waitFor({ timeout: 15000 })
  const index = await page.locator('body').innerText()
  ok('the library lists both authors with their collections', /J\. N\. Darby/.test(index) && /C\. A\. Coates/.test(index) && /Synopsis/.test(index) && /Addresses|The Believer Established/.test(index))
  ok('no explanatory paragraph on the index', !/goes through every book/.test(index))
  await shot(page, '02-library-index')

  // 2. Coates → Addresses → The Believer Established: a book of addresses lists them first (a book of the Bible would
  // open the reader at once); the first address opens the reader
  if (!(await page.getByText('The Believer Established', { exact: true }).count())) { await page.getByLabel('Addresses', { exact: true }).click(); await page.waitForTimeout(700) }
  await page.getByText('The Believer Established', { exact: true }).first().click()
  await page.getByText('Devotedness', { exact: true }).waitFor({ timeout: 15000 })
  const c0 = params(page)
  ok(`The Believer Established opens on its list of addresses (${JSON.stringify(c0)})`, c0.view === 'contents' && c0.work === 'believer-established' && !(await titleButton(page).count()))
  ok('… headed by its collection and the count', /Addresses · \d+ addresses/.test(await page.locator('body').innerText()))
  await shot(page, '02b-contents-addresses')
  await page.getByText('The believer established', { exact: true }).first().click()
  ok('the first address opens in the reader', await waitOnScreen(page, 'The believer established'))
  const p0 = params(page)
  ok(`the route names the work (${JSON.stringify(p0)})`, p0.author === 'coates' && p0.work === 'believer-established')
  await titleButton(page).waitFor()
  ok(`the toolbar names the section: “${await titleButton(page).getAttribute('aria-label')}”`, /^The believer established, contents$/.test(await titleButton(page).getAttribute('aria-label') ?? ''))
  await shot(page, '03-reader-first-address')

  // 3. a sideways drag turns to the next section, already laid out
  await page.waitForTimeout(900)
  await hdrag(cdp, page, 380, 60)
  await page.waitForTimeout(reduce ? 400 : 900)
  ok(`drag left → section 2 (n=${params(page).n})`, params(page).n === '2' && await waitOnScreen(page, 'Three scenes of judgment', 4000))
  await shot(page, '04-swiped-to-section-2')

  // 4. the edge pull past the bottom turns to the next section, opening at its top
  await page.waitForTimeout(900)
  await setScroll(page, 'end'); await page.waitForTimeout(400)
  let cue = null
  await vdrag(cdp, page, 640, 420, { onStep: async i => { if (i === 14) { cue = await onScreen(page, 'Next: Adam or Christ'); await page.screenshot({ path: `${out}/${tag}05-edge-pull-cue.png` }) } } })
  ok('mid-pull the cue names the next section', cue === true)
  await page.waitForTimeout(reduce ? 500 : 1100)
  const s3 = await scroll(page)
  ok(`released: section 3 at its top (n=${params(page).n}, scrollTop ${s3?.top})`, params(page).n === '3' && s3 && s3.top <= 2)
  await shot(page, '06-edge-pulled-to-section-3')

  // 5. the contents as a list (addresses): pick Devotedness
  await titleButton(page).click()
  await dialog(page).getByText('Devotedness').waitFor()
  await shot(page, '07-picker-list-addresses', 900)
  await dialog(page).getByText('Devotedness').click()
  await page.waitForTimeout(900)
  ok(`picked from the list → Devotedness (n=${params(page).n})`, params(page).n === '4' && await waitOnScreen(page, 'Devotedness', 4000))

  // 6. the place is kept: scroll into Devotedness, leave, come back by Continue reading and by the work's own row
  await page.waitForTimeout(600)
  const deep = await page.evaluate(() => { const d = window.__cur(); d.scrollTop = Math.min(1400, d.scrollHeight - d.clientHeight - 50); return Math.round(d.scrollTop) })
  await page.waitForTimeout(600)
  await page.getByLabel('Back', { exact: true }).click()
  // Back returns to the list of addresses, the one being read marked; then up through Addresses to the library
  await page.waitForTimeout(900)
  ok(`Back returns to the list of addresses (${JSON.stringify(params(page))})`, params(page).view === 'contents' && await page.getByText('Devotedness', { exact: true }).isVisible())
  ok('… with Devotedness marked as the one being read', await page.locator('[aria-selected="true"]').filter({ hasText: 'Devotedness' }).count() === 1)
  await shot(page, '07b-back-to-addresses')
  for (let i = 0; i < 3 && !(await page.getByPlaceholder('Search by passage or title').isVisible()); i++) { await page.goBack(); await page.waitForTimeout(700) }
  await page.getByPlaceholder('Search by passage or title').waitFor()
  await page.waitForTimeout(900)
  const cont = page.getByLabel('Continue reading', { exact: true })
  ok('the library offers Continue reading', await cont.isVisible())
  await shot(page, '08-continue-reading')
  await cont.click()
  await page.waitForTimeout(1500)
  const back1 = await scroll(page)
  ok(`Continue reading reopens Devotedness where it was left (n=${params(page).n}, scrollTop ${back1?.top} vs ${deep})`, params(page).n === undefined || params(page).n === '4')
  ok(`… at the same place (±60 px)`, back1 && Math.abs(back1.top - deep) <= 60 && await onScreen(page, 'Devotedness'))
  await shot(page, '09-position-restored')
  await page.goBack(); await page.waitForTimeout(700)
  await page.goto(base + '/companion', { waitUntil: 'networkidle' })
  if (!(await page.getByText('The Believer Established', { exact: true }).count())) { await page.getByLabel('Addresses', { exact: true }).click(); await page.waitForTimeout(700) }
  await page.getByText('The Believer Established', { exact: true }).first().click()
  await page.getByText('Devotedness', { exact: true }).waitFor({ timeout: 15000 })
  await page.getByText('Devotedness', { exact: true }).click()
  await page.waitForTimeout(1500)
  const back2 = await scroll(page)
  ok(`the marked address reopens it there too (n=${params(page).n}, scrollTop ${back2?.top})`, params(page).n === '4' && back2 && Math.abs(back2.top - deep) <= 60)

  // 7. a reference into the Bible reader, and system back to the same place
  await setScroll(page, 0); await page.waitForTimeout(300)
  const link = page.getByRole('link').filter({ hasText: /^[1-3]?\s?[A-Z][a-z]+\.? \d+:\d+/ }).first()
  await link.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  const at = (await scroll(page))?.top ?? 0
  const label = await link.textContent()
  await link.click()
  await page.waitForTimeout(1500)
  ok(`following “${label}” opens the Bible reader (${new URL(page.url()).pathname}${new URL(page.url()).search})`, /\/read\/\d+\/\d+/.test(page.url()))
  await shot(page, '10-reference-in-bible-reader')
  await page.goBack()
  await page.waitForTimeout(1500)
  const ret = await scroll(page)
  ok(`back returns to the library reader at the same place (${new URL(page.url()).search}, scrollTop ${ret?.top} vs ${at})`, /work=believer-established/.test(page.url()) && ret && Math.abs(ret.top - at) <= 60)
  await shot(page, '11-back-from-bible-reader')

  // 8. the grid: Coates's Outlines as book chips, a chapter picked from the grid, "All books" to Exodus
  await page.goto(base + '/companion?author=coates&collection=outlines', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Gen', exact: true }).or(page.getByRole('link', { name: 'Gen', exact: true })).first().waitFor({ timeout: 15000 })
  await shot(page, '12-outlines-book-chips')
  await page.getByRole('button', { name: 'Gen', exact: true }).or(page.getByRole('link', { name: 'Gen', exact: true })).first().click()
  await titleButton(page).waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)
  await titleButton(page).click()
  await dialog(page).getByRole('button', { name: '3', exact: true }).waitFor()
  await shot(page, '13-picker-grid-genesis', 900)
  await dialog(page).getByRole('button', { name: '3', exact: true }).click()
  await page.waitForTimeout(900)
  ok(`grid → Genesis 3 (${await titleButton(page).getAttribute('aria-label')})`, /^Genesis 3, contents$/.test(await titleButton(page).getAttribute('aria-label') ?? ''))
  await titleButton(page).click()
  await dialog(page).getByRole('button', { name: 'All books', exact: true }).click()
  await dialog(page).getByRole('button', { name: 'Ex', exact: true }).waitFor()
  await shot(page, '14-picker-all-books', 900)
  await dialog(page).getByRole('button', { name: 'Ex', exact: true }).click()
  await dialog(page).getByRole('button', { name: '2', exact: true }).waitFor()
  await dialog(page).getByRole('button', { name: '2', exact: true }).click()
  await page.waitForTimeout(900)
  ok(`across the collection → Exodus 2 (${JSON.stringify(params(page))})`, params(page).work === 'exodus' && /^Exodus 2, contents$/.test(await titleButton(page).getAttribute('aria-label') ?? ''))
  // the last section of Genesis turns into the first of Exodus: from Exodus's first, a drag right goes back to Genesis
  await page.goto(base + '/companion?author=coates&work=exodus&n=1', { waitUntil: 'networkidle' })
  await titleButton(page).waitFor(); await page.waitForTimeout(1200)
  await hdrag(cdp, page, 40, 380)
  await page.waitForTimeout(1000)
  ok(`drag right from Exodus's first section → the end of Genesis (${JSON.stringify(params(page))})`, params(page).work === 'genesis' && params(page).n === '28')
  await shot(page, '15-across-works-to-genesis-end')

  // 9. the deep link: a paragraph, washed, and Back to the verse
  await page.goto(base + '/companion?author=darby&work=genesis&n=2&p=6&from=1.1.26', { waitUntil: 'networkidle' })
  await page.getByLabel(/^Back to the verse, Genesis 1:26$/).waitFor({ timeout: 15000 })
  await page.waitForTimeout(reduce ? 400 : 160)
  await page.screenshot({ path: `${out}/${tag}16-deep-link-landing-wash.png` }); console.log('shot', tag + '16-deep-link-landing-wash')
  await page.waitForTimeout(900)
  const dl = await scroll(page)
  const landed = await page.evaluate(() => {
    const d = window.__cur(), box = d.getBoundingClientRect()
    const first = [...d.querySelectorAll('[data-testid^="para-"]')].find(e => e.getBoundingClientRect().bottom > box.top + 30)
    return { top: first ? Math.round(first.getBoundingClientRect().top - box.top) : -1, text: (first?.textContent ?? '').slice(0, 90), index: first ? +first.dataset.testid.slice(5) : -1 }
  })
  ok(`the deep link opens Genesis 1 at paragraph 6 (scrollTop ${dl?.top}; first in view: #${landed.index} at ${landed.top}px “${landed.text}…”)`, dl && dl.top > 100 && landed.index === 6 && landed.top < 80)
  ok(`the toolbar's back names the verse (${await page.getByLabel(/^Back to the verse/).innerText()})`, /Gen 1:26/.test(await page.getByLabel(/^Back to the verse/).innerText()))
  await shot(page, '17-deep-link-landed')
  // 9b. landed mid-page: a small drag down at once (the "scroll up" that opened the Previous cue on the phone right
  // after a turn, build 31) scrolls and shows no cue; at the very top the same short drag opens it and eases back
  let cuePrev = false
  const sawPrev = async () => { if (await onScreen(page, 'Previous:')) cuePrev = true }
  await vdrag(cdp, page, 400, 470, { steps: 8, onStep: sawPrev })
  await page.waitForTimeout(400)
  const s9 = await scroll(page)
  ok(`a drag down straight after the landing shows no Previous cue (scrollTop ${dl?.top} → ${s9?.top}, n=${params(page).n})`, !cuePrev && params(page).n === '2' && s9 && s9.top < dl.top)
  await setScroll(page, 0); await page.waitForTimeout(400)
  cuePrev = false
  await vdrag(cdp, page, 400, 460, { steps: 10, onStep: async i => { if (i >= 6) await sawPrev() } })
  ok('… scrolled to the very top, the same drag opens the Previous cue', cuePrev)
  await page.waitForTimeout(reduce ? 400 : 900)
  ok(`… and, short of PULL_FAR, eases back without turning (n=${params(page).n})`, params(page).n === '2')
  await page.getByLabel(/^Back to the verse/).click()
  await page.waitForTimeout(1500)
  ok(`Back to the verse opens the reader at Genesis 1:26 (${new URL(page.url()).pathname}${new URL(page.url()).search})`, /\/read\/1\/1/.test(page.url()) && /v=26/.test(page.url()))
  await shot(page, '18-back-to-the-verse')

  // 10. a volume of letters, by number (only when the server has one)
  const lib = await page.evaluate(async () => { try { const r = await fetch('/api/ministry'); return r.ok ? await r.json() : null } catch { return null } })
  const lw = lib?.authors?.flatMap(a => a.collections.flatMap(c => c.works.map(w => ({ a: a.id, ...w })))).find(w => w.kind === 'letters' && w.count >= 12)
  if (!lw) console.log('skip letters: the server has no volume of letters yet')
  else {
    await page.goto(`${base}/companion?author=${lw.a}&work=${lw.id}&n=12`, { waitUntil: 'networkidle' })
    await titleButton(page).waitFor({ timeout: 15000 }); await page.waitForTimeout(1200)
    ok(`a letter by number: “${await titleButton(page).getAttribute('aria-label')}”`, /^Letter 12, contents$/.test(await titleButton(page).getAttribute('aria-label') ?? ''))
    await shot(page, '19-letter-12')
    await titleButton(page).click(); await page.waitForTimeout(1200)
    await shot(page, '20-letters-picker-by-number')
    const rows = await dialog(page).getByRole('button').allInnerTexts()
    ok(`the letters are listed by number with their recipient and date (${rows.slice(2, 4).join(' | ').replace(/\n/g, ' / ')})`, rows.some(r => /^12\n/.test(r)))
    await dialog(page).getByRole('button').filter({ hasText: /^13\D/ }).first().click()
    await page.waitForTimeout(900)
    ok(`picked letter 13 (n=${params(page).n})`, params(page).n === '13')
  }
  // 11. a volume of papers: its pieces as a list under their parts (only when the server has one)
  const pw = lib?.authors?.flatMap(a => a.collections.flatMap(c => c.works.map(w => ({ a: a.id, ...w })))).find(w => w.kind === 'papers')
  if (pw) {
    await page.goto(`${base}/companion?author=${pw.a}&work=${pw.id}&n=2`, { waitUntil: 'networkidle' })
    await titleButton(page).waitFor({ timeout: 15000 }); await page.waitForTimeout(1200)
    await shot(page, '21-papers-section')
    await titleButton(page).click(); await page.waitForTimeout(1200)
    await shot(page, '22-papers-picker-by-part')
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  }
  // 12. Notes and Jottings: a collection of one work, so its row leads straight to its readings; a reading opens in
  // the reader, Back returns to the list; the phone's More sheet offers the contents too
  await page.goto(base + '/companion', { waitUntil: 'networkidle' })
  const nj = page.getByLabel('Notes and Jottings', { exact: true })
  if (await nj.count()) {
    await nj.click()
    await page.getByText('Ryde meeting', { exact: true }).waitFor({ timeout: 15000 })
    const cj = params(page)
    ok(`Notes and Jottings opens on its list of readings, not the reader (${JSON.stringify(cj)})`, cj.view === 'contents' && cj.work === 'notes-jottings' && !(await titleButton(page).count()))
    ok('… headed by the author and the count of readings', /J\. N\. Darby · \d+ readings/.test(await page.locator('body').innerText()))
    await shot(page, '26-notes-jottings-contents')
    await page.getByText(/Lonsdale square: Luke 15/).first().click()
    await titleButton(page).waitFor({ timeout: 15000 }); await page.waitForTimeout(900)
    ok(`the Luke 15 reading opens in the reader (n=${params(page).n}; “${await titleButton(page).getAttribute('aria-label')}”)`, params(page).n === '1' && /Luke 15, contents$/.test(await titleButton(page).getAttribute('aria-label') ?? ''))
    await shot(page, '27-reading-luke-15')
    await page.getByLabel('More', { exact: true }).click()
    await dialog(page).getByRole('button', { name: 'Contents', exact: true }).waitFor()
    await shot(page, '27b-more-sheet-contents', 500)
    await dialog(page).getByRole('button', { name: 'Contents', exact: true }).click()
    await dialog(page).getByText('Ryde meeting', { exact: true }).waitFor({ timeout: 5000 })
    ok('More → Contents opens the picker', true)
    await page.keyboard.press('Escape'); await page.waitForTimeout(600)
    await page.getByLabel('Back', { exact: true }).click(); await page.waitForTimeout(900)
    ok(`Back returns to the list of readings (${JSON.stringify(params(page))})`, params(page).view === 'contents' && await page.getByText('Ryde meeting', { exact: true }).isVisible())
    ok('… with the Luke 15 reading marked', await page.locator('[aria-selected="true"]').filter({ hasText: 'Luke 15' }).count() === 1)
    await shot(page, '28-back-to-readings')
    // a link straight into a reading, with no history: Back goes up to the list, not the library's front
    await page.goto(base + '/companion?author=darby&work=notes-jottings&n=2', { waitUntil: 'networkidle' })
    await titleButton(page).waitFor({ timeout: 15000 }); await page.waitForTimeout(900)
    await page.getByLabel('Back', { exact: true }).click(); await page.waitForTimeout(900)
    ok(`Back from a link with no history lands on the list (${JSON.stringify(params(page))})`, params(page).view === 'contents' && params(page).work === 'notes-jottings')
  } else console.log('skip Notes and Jottings: the server has no such collection')
  await page.context().close()
}

// ---------------- 360 px: the title pill's chevron stays whole while the long title truncates ----------------
{
  const { page } = await open({ width: 360, height: 780 })
  await page.goto(base + '/companion?author=darby&work=notes-jottings&n=1', { waitUntil: 'networkidle' })
  await titleButton(page).waitFor({ timeout: 15000 }); await page.waitForTimeout(1200)
  const pill = await titleButton(page).evaluate(b => {
    const svg = b.querySelector('svg'), text = b.querySelector('[dir=auto], span, div:not(:has(*))')
    const r = b.getBoundingClientRect(), g = svg?.getBoundingClientRect()
    return { right: Math.round(r.right), glyph: g ? { left: Math.round(g.left), right: Math.round(g.right), width: Math.round(g.width) } : null, truncated: text ? text.scrollWidth > text.clientWidth + 1 : null, label: b.getAttribute('aria-label') }
  })
  ok(`360 px: the pill's chevron is drawn whole inside the pill (${JSON.stringify(pill)})`, !!pill.glyph && pill.glyph.width >= 12 && pill.glyph.right <= pill.right && pill.glyph.right <= 360)
  await shot(page, '29-pill-chevron-360')
  await page.context().close()
}

// ---------------- wide ----------------
{
  const { page } = await open({ touch: false, width: 1280, height: 900, p: { ...prefs, width: 'wide' } })
  await page.goto(base + '/companion?author=darby&work=romans&n=2', { waitUntil: 'networkidle' })
  await titleButton(page).waitFor({ timeout: 15000 }); await page.waitForTimeout(1200)
  ok('wide: the toolbar has A−, A+, Theme and Reading settings', await page.getByLabel('Smaller text').isVisible() && await page.getByLabel('Larger text').isVisible() && await page.getByLabel('Theme', { exact: true }).isVisible() && await page.getByLabel('Reading settings').isVisible())
  await shot(page, '23-wide-reader')
  const before = await page.evaluate(() => { const el = [...document.querySelectorAll('[dir=auto]')].find(e => (e.textContent ?? '').length > 200); return el ? parseFloat(getComputedStyle(el).fontSize) : 0 })
  await page.getByLabel('Larger text').click(); await page.waitForTimeout(500)
  const after = await page.evaluate(() => { const el = [...document.querySelectorAll('[dir=auto]')].find(e => (e.textContent ?? '').length > 200); return el ? parseFloat(getComputedStyle(el).fontSize) : 0 })
  ok(`A+ sets the text a size larger (${before} → ${after} px)`, after === before + 1)
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(900)
  ok(`→ turns to the next section (n=${params(page).n})`, params(page).n === '3')
  // the wheel: a gesture begun at the end turns once
  await page.mouse.move(640, 500)
  await setScroll(page, 'end'); await page.waitForTimeout(600)
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(30) }
  await page.waitForTimeout(1200)
  ok(`the wheel past the end turns once (n=${params(page).n})`, params(page).n === '4')
  await titleButton(page).click(); await page.waitForTimeout(1000)
  await shot(page, '24-wide-picker')
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  await page.goto(base + '/companion', { waitUntil: 'networkidle' }); await page.waitForTimeout(800)
  await shot(page, '25-wide-library')
  // a volume's contents at 1280: its papers under their parts, headed by the collection and the count
  await page.goto(base + '/companion?author=darby&work=cw-ecclesiastical-1&view=contents', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const wideText = await page.locator('body').innerText()
  if (/Collected Writings · \d+ sections/.test(wideText)) { ok('wide: a volume of the Collected Writings lists its papers under the collection line', true); await shot(page, '30-wide-contents-volume') }
  else console.log('skip wide contents: the server has no Collected Writings volume 1')
  await page.context().close()
}

ok(`no page errors${errors.length ? ': ' + errors.join(' / ') : ''}`, errors.length === 0)
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exitCode = failed ? 1 : 0
