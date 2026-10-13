// The desktop layout on the web build (docs/DESIGN.md, Layout › Desktop), at 1280 × 800 and 1440 × 900: the five tabs
// stand in a left rail and there is no bottom bar; Home's Library and Together sit side by side; /read/43/3 shows the
// book pane with John and chapter 3 marked; Psalms → 23 navigates to /read/19/23 and the pane follows; the reading
// column is no wider than the measure and centred in what the pane and rail leave; the Theme sheet is a centred
// dialog (≤ 560 px, off the bottom edge, no grab bar) that Escape closes. Then 412 px: bottom bar, no pane, the sheet a
// full-width bottom sheet with its grab bar, as before. Stills at 1280 of Home, the reader and the sheet.
//   BASE=http://127.0.0.1:8793 OUT=/tmp/wt-desktop node scripts/desktop-check.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8793'
const out = process.env.OUT ?? '/tmp/wt-desktop'
mkdirSync(out, { recursive: true })
const RAIL = 80, PANE = 260, DIALOG = 560
/** The medium measure at 19 px: 34 em plus the 20 px gutters (ChapterView). */
const MEASURE = 19 * 34 + 40
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false, align: 'center', width: 'medium', onboarded: true, toured: true }
const browser = await chromium.launch()
const errors = []
let failed = 0
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failed++ }
const visible = (loc, ms = 8000) => loc.first().waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false)
const gone = (loc, ms = 8000) => loc.first().waitFor({ state: 'hidden', timeout: ms }).then(() => true, () => false)

async function open(width, height) {
  const touch = width < 720
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch })
  await ctx.addInitScript(p => { if (!sessionStorage.getItem('primed')) { localStorage.setItem('berean_prefs', JSON.stringify(p)); sessionStorage.setItem('primed', '1') } }, prefs)
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${width}: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|status of 404|when fetching the script/.test(m.text())) errors.push(`${width} console: ${m.text()}`) })
  return { ctx, page }
}
const tabs = page => page.getByRole('tab')
async function tabBoxes(page) {
  await tabs(page).first().waitFor({ timeout: 30000 })
  const n = await tabs(page).count(), bs = []
  for (let i = 0; i < n; i++) bs.push(await tabs(page).nth(i).boundingBox())
  return bs.filter(Boolean)
}
const selected = async loc => (await loc.getAttribute('aria-selected')) === 'true'
const btn = (page, name) => page.getByRole('button', { name, exact: true })
/** The box of the innermost visible element painting `snippet` inside the viewport (neighbour chapters sit offscreen). */
const textBox = (page, snippet, W, H) => page.evaluate(([snippet, W, H]) => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!n.textContent?.includes(snippet) || [...n.children].some(c => c.textContent?.includes(snippet))) continue
    const r = n.getBoundingClientRect()
    if (n.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && r.right > 0 && r.left < W && r.bottom > 0 && r.top < H && r.width > 0) return { x: r.left, y: r.top, width: r.width, height: r.height }
  }
  return null
}, [snippet, W, H])

async function desktop(W, H) {
  const tag = `${W}×${H}`
  const { ctx, page } = await open(W, H)
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  const bs = await tabBoxes(page)
  ok(`${tag}: five tabs`, bs.length === 5)
  ok(`${tag}: the tabs stand in a left rail (x < ${RAIL}, stacked)`, bs.every(b => b.x >= 0 && b.x + b.width <= RAIL + 1) && bs.every((b, i) => i === 0 || b.y >= bs[i - 1].y + b.height - 1))
  ok(`${tag}: no bottom bar`, bs.every(b => b.y + b.height < H - 120))
  const list = await page.getByRole('tablist').boundingBox()
  ok(`${tag}: the rail is ${RAIL} px wide and runs the window's height`, list && Math.round(list.width) === RAIL && list.height >= H - 2)
  ok(`${tag}: Home's tab is selected`, await selected(tabs(page).first()))
  await page.getByText('Together', { exact: true }).waitFor({ timeout: 15000 })
  // the block's entrance (rise 12 px over 340 ms at house tempo) has landed before its rows are measured
  await page.waitForTimeout(900)
  const lib = await page.getByText('Library', { exact: true }).boundingBox(), tog = await page.getByText('Together', { exact: true }).boundingBox()
  ok(`${tag}: Library and Together side by side, Library first`, lib && tog && Math.abs(lib.y - tog.y) < 4 && tog.x > lib.x + 100)
  ok(`${tag}: Home's content sits right of the rail`, lib && lib.x > RAIL)
  if (W === 1280) { await page.waitForTimeout(900); await page.screenshot({ path: `${out}/home.png` }); console.log('shot home') }

  // the reader: John 3 with the pane
  await page.goto(base + '/read/43/3', { waitUntil: 'domcontentloaded' })
  ok(`${tag}: the Read tab is selected`, await visible(tabs(page).nth(1).and(page.locator('[aria-selected="true"]')), 20000))
  const pane = page.getByLabel('Books and chapters')
  ok(`${tag}: the book pane shows`, await visible(pane, 20000))
  const pb = await pane.boundingBox()
  ok(`${tag}: the pane is ${PANE} px wide beside the rail`, pb && Math.round(pb.width) === PANE && Math.abs(pb.x - RAIL) < 1.5)
  ok(`${tag}: the pane lists the books by name under both testaments`, await visible(pane.getByText('Old Testament', { exact: true }), 2000) && await visible(pane.getByText('New Testament', { exact: true }), 2000) && await visible(btn(page, 'Genesis'), 2000) && await visible(btn(page, 'Revelation'), 2000))
  ok(`${tag}: John is marked in the pane`, await selected(btn(page, 'John')))
  ok(`${tag}: Genesis is not`, !(await selected(btn(page, 'Genesis'))))
  ok(`${tag}: John's chapters show, 3 marked`, await visible(btn(page, 'John 21'), 4000) && await selected(btn(page, 'John 3')) && !(await selected(btn(page, 'John 4'))))
  ok(`${tag}: the current book is in view in the pane`, (await btn(page, 'John').boundingBox())?.y < H)
  ok(`${tag}: the pill still offers the picker`, await visible(page.getByRole('button', { name: /^John 3 ▾$/ }), 2000))
  const v1 = await (async () => { const t = Date.now(); while (Date.now() - t < 15000) { const b = await textBox(page, 'Nicodemus', W, H); if (b) return b; await page.waitForTimeout(150) } return null })()
  ok(`${tag}: the reading column is no wider than the measure (${MEASURE})`, v1 && v1.width <= MEASURE && v1.x > RAIL + PANE)
  const columnMid = (RAIL + PANE + W) / 2
  ok(`${tag}: the text is centred in the space beside the pane`, v1 && Math.abs(v1.x + v1.width / 2 - columnMid) < 60)
  if (W === 1280) { await page.waitForTimeout(900); await page.screenshot({ path: `${out}/reader.png` }); console.log('shot reader') }

  // Psalms → 23 through the pane
  ok(`${tag}: the pane scrolled itself to the current book`, (await pane.evaluate(el => el.scrollTop)) > 200)
  await btn(page, 'Psalms').click()
  ok(`${tag}: Psalms opens its grid in place`, await visible(btn(page, 'Psalms 150'), 4000))
  await page.waitForTimeout(300)
  const before = await pane.evaluate(el => el.scrollTop)
  await btn(page, 'Psalms 23').click()
  const went = await page.waitForURL(/\/read\/19\/23/, { timeout: 8000 }).then(() => true, () => false)
  ok(`${tag}: Psalms 23 navigates to /read/19/23`, went)
  await page.waitForTimeout(600)
  // the chapter changed under it; the pane is the same one, where it was (not back at the top, not re-placed)
  ok(`${tag}: the pane kept its scroll place across the navigation`, Math.abs((await pane.evaluate(el => el.scrollTop)) - before) < 2 && before > 0)
  ok(`${tag}: the pane now marks Psalms and 23`, await selected(btn(page, 'Psalms')) && await selected(btn(page, 'Psalms 23')) && !(await selected(btn(page, 'John'))))
  ok(`${tag}: the pill follows`, await visible(page.getByRole('button', { name: /^Psalms 23 ▾$/ }), 4000))

  // a sheet: the Theme sheet as a dialog
  await btn(page, 'Theme').click()
  const dialog = page.getByTestId('sheet-dialog')
  ok(`${tag}: the sheet presents as a dialog`, await visible(dialog, 4000))
  await page.waitForTimeout(700)
  const db = await dialog.boundingBox()
  ok(`${tag}: the dialog is at most ${DIALOG} px wide`, db && db.width <= DIALOG + 0.5)
  ok(`${tag}: the dialog is centred`, db && Math.abs(db.x + db.width / 2 - W / 2) < 2)
  ok(`${tag}: the dialog floats off the bottom edge`, db && db.y > 40 && db.y + db.height < H - 40)
  ok(`${tag}: no grab bar on the dialog`, (await page.getByLabel('Drag down to close').count()) === 0)
  ok(`${tag}: the dialog carries its title`, await visible(dialog.getByRole('heading', { name: 'Theme' }), 2000))
  if (W === 1280) { await page.screenshot({ path: `${out}/sheet.png` }); console.log('shot sheet') }
  await page.keyboard.press('Escape')
  ok(`${tag}: Escape closes the dialog`, await gone(dialog, 4000))
  await ctx.close()
}

async function phone(W = 412, H = 915) {
  const tag = `${W}×${H}`
  const { ctx, page } = await open(W, H)
  await page.goto(base + '/read/43/3', { waitUntil: 'domcontentloaded' })
  const bs = await tabBoxes(page)
  ok(`${tag}: five tabs`, bs.length === 5)
  ok(`${tag}: the tabs are a bottom bar`, bs.every(b => b.y > H - 90) && bs.every((b, i) => i === 0 || b.x > bs[i - 1].x))
  ok(`${tag}: no book pane`, (await page.getByLabel('Books and chapters').count()) === 0 && (await btn(page, 'Genesis').count()) === 0)
  ok(`${tag}: the pill is there`, await visible(page.getByRole('button', { name: /^John 3 ▾$/ }), 20000))
  await btn(page, 'Theme').click()
  const panel = page.getByTestId('sheet-panel')
  ok(`${tag}: the sheet is a bottom sheet`, await visible(panel, 4000))
  await page.waitForTimeout(700)
  const pb = await panel.boundingBox()
  ok(`${tag}: full width, on the bottom edge`, pb && Math.round(pb.width) === W && Math.abs(pb.y + pb.height - H) < 1.5)
  ok(`${tag}: with its grab bar`, (await page.getByLabel('Drag down to close').count()) === 1)
  ok(`${tag}: no dialog`, (await page.getByTestId('sheet-dialog').count()) === 0)
  await page.keyboard.press('Escape')
  ok(`${tag}: Escape closes the sheet`, await gone(panel, 4000))
  await ctx.close()
}

await desktop(1280, 800)
await desktop(1440, 900)
await phone()
for (const e of errors) console.log('page error:', e)
ok('no page errors', errors.length === 0)
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
