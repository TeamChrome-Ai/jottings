// Ministry at a 412 px phone width: select John 3:16 and the bar offers Ministry; the sheet lists Darby and Coates as
// segments, best first; an item opens in the library's reader at its paragraph; a reference there goes into the Bible
// reader; "Back to the verse" comes home. Romans 8:28 the same, with a page turn when Darby runs to more than one page.
// A verse nobody wrote on: no Ministry in the bar. More → "Ministry on this chapter" on Genesis 1.
// BASE=http://127.0.0.1:8841 OUT=/tmp/wt-ministry node scripts/ministry-check.mjs   (REDUCE=1: Reduce animation on)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8841'
const out = process.env.OUT ?? '/tmp/wt-ministry'
mkdirSync(out, { recursive: true })
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: false, showNotes: true, reduceMotion: process.env.REDUCE === '1', align: 'center', width: 'medium', onboarded: true, toured: true }
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(p => localStorage.setItem('berean_prefs', JSON.stringify(p)), prefs)
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
// the throwaway build has no service worker (scripts/make-sw.mjs is not run): its 404 is not an error of the app
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|fetching the script/.test(m.text())) errors.push('console: ' + m.text()) })
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name) }
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) process.exitCode = 1 }
const dialog = () => page.getByRole('dialog').last()
const ministryButton = () => page.getByRole('button', { name: /^Ministry on / })

/** Opens a chapter and selects the verse whose text `words` begins; returns the bar's height. */
async function select(book, chapter, words) {
  await page.goto(`${base}/read/${book}/${chapter}`, { waitUntil: 'networkidle' })
  const v = page.getByText(words).first()
  await v.waitFor({ timeout: 30000 })
  await v.click()
  await page.getByRole('button', { name: 'Copy' }).waitFor()
  await page.waitForTimeout(900)
}
const barHeight = () => page.getByRole('button', { name: 'Copy' }).evaluate(b => { let e = b; while (e && getComputedStyle(e).position !== 'absolute') e = e.parentElement; return e ? e.getBoundingClientRect().height : 0 })

// 1. John 3:16: Ministry offered, the sheet, an item
await select(43, 3, /For God so/)
ok('John 3:16 selected: the bar offers Ministry', await ministryButton().isVisible())
await shot('01-john-3-16-bar')
await ministryButton().click()
await dialog().getByText(/^John 3:16$/).waitFor()
await dialog().getByRole('link').first().waitFor({ timeout: 15000 })
await page.waitForTimeout(900)
// each segment's label is drawn twice (the ink under the thumb and beside it): read the first half
const segs = (await dialog().getByRole('radio').allTextContents()).map(t => t.slice(0, t.length / 2))
ok(`the sheet groups by author, Darby first (${segs.join(' | ') || 'one author'})`, segs.length === 0 || segs[0] === 'Darby')
const first = await dialog().getByRole('link').first().getAttribute('aria-label')
ok(`Darby's first item: “${first?.slice(0, 120)}…”`, !!first)
await shot('02-john-3-16-sheet-darby')
if (segs.includes('Coates')) {
  await dialog().getByRole('radio', { name: 'Coates' }).click(); await page.waitForTimeout(900)
  await shot('03-john-3-16-sheet-coates')
  await dialog().getByRole('radio', { name: 'Darby' }).click(); await page.waitForTimeout(700)
}
// the item opens in the library's reader at its paragraph
await dialog().getByRole('link').first().click()
await page.waitForURL(/\/companion/, { timeout: 15000 })
await page.waitForTimeout(1600)
const url = new URL(page.url())
ok(`the item opens the library reader at its place (${url.pathname}${url.search})`, url.searchParams.get('p') !== null && url.searchParams.get('from') === '43.3.16')
await shot('04-item-in-context')
// a reference in the reading goes into the Bible reader, and back
const link = page.getByRole('link').filter({ hasText: /\d/ }).first()
if (await link.count()) {
  const label = await link.textContent()
  await link.scrollIntoViewIfNeeded()
  await link.click()
  await page.waitForURL(/\/read\/\d+\/\d+/, { timeout: 15000 }); await page.waitForTimeout(1200)
  ok(`following “${label}” opens the Bible reader (${new URL(page.url()).pathname})`, true)
  await shot('05-reference-followed')
  await page.goBack(); await page.waitForTimeout(1500)
  ok('back returns to the library reader', /\/companion/.test(page.url()))
}
const back = page.getByRole('button', { name: /^Back to the verse/ })
ok('“Back to the verse” is offered', await back.count() > 0)
await back.first().click()
await page.waitForURL(/\/read\/43\/3/, { timeout: 15000 }); await page.waitForTimeout(1200)
ok(`back at the verse (${new URL(page.url()).pathname}${new URL(page.url()).search})`, /\/read\/43\/3/.test(page.url()))
await shot('06-back-to-the-verse')

// 2. Romans 8:28: best first, paged when long
await select(45, 8, /all things work together/)
ok('Romans 8:28 selected: Ministry offered', await ministryButton().isVisible())
await ministryButton().click()
await dialog().getByRole('link').first().waitFor({ timeout: 15000 }); await page.waitForTimeout(900)
await shot('07-romans-8-28-sheet')
const next = dialog().getByRole('button', { name: 'Next page' })
if (await next.count() && await next.isEnabled()) {
  await next.click(); await page.waitForTimeout(1200)
  ok('page 2 of the list', /Page 2 of/.test(await dialog().innerText()))
  await shot('08-romans-8-28-page-2')
}
await page.keyboard.press('Escape'); await page.waitForTimeout(600)

// 3. a verse nobody wrote on: no Ministry, and the bar is the height it always is
const plainHeight = await (async () => { await select(13, 1, /The sons of Japheth/); return barHeight() })()
ok('1 Chronicles 1:5 selected: no Ministry in the bar', !(await ministryButton().count()))
await shot('09-no-ministry-bar')
await select(43, 3, /For God so/)
ok(`the bar does not change height for Ministry (${Math.round(plainHeight)} and ${Math.round(await barHeight())} px)`, Math.abs(plainHeight - await barHeight()) < 1)

// 4. the chapter: More → Ministry on this chapter
await page.goto(`${base}/read/1/1`, { waitUntil: 'networkidle' })
await page.getByText(/Let us make Man/i).first().waitFor({ timeout: 30000 })
await page.getByLabel('More').click()
await dialog().getByText('Ministry on this chapter').click()
await dialog().getByRole('link').first().waitFor({ timeout: 15000 }); await page.waitForTimeout(900)
ok('Genesis 1: the chapter’s sections as items', /Synopsis · Genesis/.test(await dialog().innerText()))
await shot('10-genesis-1-chapter-scope')

ok(`no page errors${errors.length ? ': ' + errors.join(' / ') : ''}`, errors.length === 0)
await browser.close()
