// The companion (Darby's Synopsis, Coates's Outlines and addresses) at a 412 px phone width: More → "Darby and Coates
// on this chapter" on Genesis 1, opened at the section and paragraph for a selected verse, Darby and Coates as two
// segments; a chapter Coates reads with an address on a verse in it (chips); a reference followed into the reader; a
// chapter only Darby treats; Home → Library → Darby and Coates → Coates → The Believer Established; the search; the
// wide toolbar's glyph.
// BASE=http://127.0.0.1:8823 OUT=/tmp/wt-coates node scripts/companion-check.mjs   (REDUCE=1: Reduce animation on)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8823'
const out = process.env.OUT ?? '/tmp/wt-coates'
mkdirSync(out, { recursive: true })
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: false, showNotes: true, reduceMotion: process.env.REDUCE === '1', align: 'center', width: 'medium', onboarded: true, toured: true }
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(p => localStorage.setItem('berean_prefs', JSON.stringify(p)), prefs)
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name) }
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) process.exitCode = 1 }
const dialog = () => page.getByRole('dialog').last()
const LABEL = /^(Darby and Coates|Darby|Coates) on this chapter$/
/** The sheet's scroll offset and the first long paragraph whose top is in its view. */
const sheetView = (p = page) => p.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role=dialog]')]
  const d = dialogs[dialogs.length - 1]
  const sc = [...d.querySelectorAll('div')].find(e => e.scrollHeight > e.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))
  if (!sc) return { top: -1, first: '' }
  const box = sc.getBoundingClientRect()
  const paras = [...sc.querySelectorAll('[dir=auto]')].filter(e => { const r = e.getBoundingClientRect(); return r.top >= box.top - 4 && r.top < box.bottom && (e.textContent ?? '').length > 120 && !e.parentElement?.closest('[dir=auto]') })
  return { top: sc.scrollTop, first: (paras[0]?.textContent ?? '').slice(0, 200) }
})
const openFromMore = async (moreOpen = false) => {
  if (!moreOpen) await page.getByLabel('More').click()
  const b = dialog().getByText(LABEL)
  await b.waitFor()
  const label = await b.textContent()
  await b.click()
  await page.getByRole('dialog').last().getByText(/Synopsis ·|An Outline of|The Believer Established/).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
  return label
}

// 1. Genesis 1: select verse 26; More names both authors
await page.goto(base + '/read/1/1', { waitUntil: 'networkidle' })
await page.getByText(/Let us make Man/i).first().waitFor({ timeout: 30000 })
await page.getByText(/Let us make Man/i).first().click()
await page.waitForTimeout(400)
await page.getByLabel('More').click()
const more = await dialog().getByText(LABEL).textContent()
ok(`More on Genesis 1 reads “${more}”`, more === 'Darby and Coates on this chapter')
await shot('01-more-sheet-genesis-1')

// 2. the sheet: Darby first, opened at the section and paragraph for verse 26; then Coates at his
await openFromMore(true)
const [bd, bc] = await Promise.all(['Darby', 'Coates'].map(n => dialog().getByRole('radio', { name: n, exact: true }).boundingBox()))
const d1 = await sheetView()
ok('two segments, Darby first and chosen', !!bd && !!bc && bd.x < bc.x && /Synopsis · Genesis/.test(await dialog().innerText()))
ok(`Darby opens at the paragraph for verse 26 (scrollTop ${Math.round(d1.top)}: “${d1.first.slice(0, 100)}…”)`, d1.top > 100)
await shot('02-sheet-darby-genesis-1-v26')
await dialog().getByRole('radio', { name: 'Coates' }).click()
await page.waitForTimeout(1000)
const c1 = await sheetView()
ok(`Coates opens at his paragraph for verse 26 (scrollTop ${Math.round(c1.top)}: “${c1.first.slice(0, 100)}…”)`, c1.top > 100 && /An Outline of Genesis/.test(await dialog().innerText()))
await shot('03-sheet-coates-genesis-1-v26')

// 3. a reference in the reading goes to the reader
const link = dialog().getByRole('link').filter({ hasText: /^(?!Genesis 1\b)[1-3]?\s?[A-Z][a-z]+\.? \d+(:\d+)?/ }).first()
const label = (await link.textContent()) ?? ''
await link.click()
await page.waitForTimeout(1200)
ok(`following “${label}” leaves the sheet for the reader (${new URL(page.url()).pathname}${new URL(page.url()).search})`, /\/read\/\d+\/\d+/.test(page.url()) && (await page.getByRole('dialog').count()) === 0)
await shot('04-reference-followed')

// 4. Romans 15: Coates's chapter reading and the address on 15:13 as chips
await page.goto(base + '/read/45/15', { waitUntil: 'networkidle' })
await page.getByText(/God of hope/).first().waitFor({ timeout: 30000 })
await openFromMore()
await dialog().getByRole('radio', { name: 'Coates' }).click(); await page.waitForTimeout(800)
const tabs = await dialog().getByRole('tab').allTextContents()
ok(`Coates on Romans 15 offers his readings as chips (${tabs.join(' | ')})`, tabs.length >= 2)
await shot('05-sheet-romans-15-coates-chips')
await dialog().getByRole('tab').last().click(); await page.waitForTimeout(700)
ok('the address on Romans 15:13 swaps in', /The Believer Established/.test(await dialog().innerText()))
await shot('06-sheet-romans-15-address')
await page.keyboard.press('Escape'); await page.waitForTimeout(600)

// 5. a chapter only Darby treats (Job 3): the affordance names him alone and the sheet has no segments
await page.goto(base + '/read/18/3', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.getByLabel('More').click(); await page.waitForTimeout(600)
const job = await dialog().getByText(LABEL).textContent().catch(() => '')
ok(`Job 3 reads “${job}”`, job === 'Darby on this chapter')
await dialog().getByText(LABEL).click(); await page.waitForTimeout(1500)
ok('Job 3: one author, no segments', (await dialog().getByRole('radio').count()) === 0 && /Synopsis · Job/.test(await dialog().innerText()))
await shot('07-sheet-job-3-darby-only')
await page.keyboard.press('Escape'); await page.waitForTimeout(600)

// 5b. a chapter only Coates's unshipped volumes treat (Colossians 1): Darby alone, in More and in the library's search
await page.goto(base + '/read/51/1', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.getByLabel('More').click(); await page.waitForTimeout(600)
const col = await dialog().getByText(LABEL).textContent().catch(() => '')
ok(`Colossians 1 reads “${col}”`, col === 'Darby on this chapter')
await page.keyboard.press('Escape'); await page.waitForTimeout(500)
await page.goto(base + '/companion?q=col%201', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const colHits = await page.locator('body').innerText()
ok('search “col 1” lists Darby only', /Darby ·/.test(colHits) && !/Coates ·/.test(colHits))

// 6. Home → Library → Darby and Coates → C. A. Coates: The Believer Established → its first address
await page.goto(base + '/', { waitUntil: 'networkidle' })
const row = page.getByLabel('Darby and Coates', { exact: true })
await row.waitFor({ timeout: 30000 })
await row.scrollIntoViewIfNeeded()
await shot('08-home-library-row')
await row.click()
await page.getByPlaceholder('Search by passage or title').waitFor()
await page.waitForTimeout(600)
await shot('09-companion-index')
await page.getByLabel('The Believer Established', { exact: true }).scrollIntoViewIfNeeded()
await page.getByLabel('The Believer Established', { exact: true }).click()
const first = page.getByRole('link').filter({ hasText: /^The believer established/i }).last()
await first.waitFor()
await shot('10-believer-established-contents')
await first.click()
await page.getByLabel(/^Read Romans 15:13/).waitFor({ timeout: 15000 })
await shot('11-believer-established-address')
const pages = /Page 1 of (\d+)/.exec(await page.locator('body').innerText())
ok(`the address reads in ${pages ? pages[1] + ' pages' : 'one page'}`, true)
if (pages) {
  await page.getByLabel('Next page').click(); await page.waitForTimeout(600)
  ok('page 2 turns', /Page 2 of/.test(await page.locator('body').innerText()))
  await shot('12-believer-established-page-2')
}
await page.getByLabel(/^Read Romans 15:13/).click()
await page.waitForTimeout(1200)
ok(`“Read this passage” opens Romans 15 at verse 13 (${new URL(page.url()).pathname}${new URL(page.url()).search})`, /\/read\/45\/15/.test(page.url()) && /v=13/.test(page.url()))

// 7. the Synopsis list, and search by passage across both authors
await page.goto(base + '/companion?author=darby', { waitUntil: 'networkidle' })
await page.getByText('Synopsis of the Books of the Bible').first().waitFor({ timeout: 15000 })
await shot('13-synopsis-books')
await page.goto(base + '/companion', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Search by passage or title').fill('rom 15:13')
await page.waitForTimeout(600)
const found = await page.locator('body').innerText()
ok('search “rom 15:13” finds both authors', /Darby ·/.test(found) && /Coates ·/.test(found))
await shot('14-companion-search')

// 8. wide: the toolbar's glyph where there is a reading, none where there is not
{
  const w = await browser.newContext({ viewport: { width: 1100, height: 900 } })
  await w.addInitScript(p => localStorage.setItem('berean_prefs', JSON.stringify(p)), { ...prefs, width: 'wide' })
  const p = await w.newPage()
  p.on('pageerror', e => errors.push(e.message))
  await p.goto(base + '/read/1/1', { waitUntil: 'networkidle' }); await p.getByText(/Let us make Man/i).first().waitFor()
  await p.waitForTimeout(800)
  ok('wide Genesis 1: the toolbar has “Darby and Coates on this chapter”', await p.getByLabel('Darby and Coates on this chapter').isVisible())
  await p.screenshot({ path: `${out}/15-wide-toolbar.png` }); console.log('shot 15-wide-toolbar')
  await p.getByLabel('Darby and Coates on this chapter').click(); await p.waitForTimeout(1300)
  await p.screenshot({ path: `${out}/16-wide-sheet.png` }); console.log('shot 16-wide-sheet')
  await w.close()
}

ok(`no page errors${errors.length ? ': ' + errors.join(' / ') : ''}`, errors.length === 0)
await browser.close()
