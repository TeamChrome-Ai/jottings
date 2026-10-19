// Your own path (Paths): tap Mark, John, Romans, Genesis and each chip shows its place (1 to 4, "John, 2 of 4" to a
// screen reader) with the order spelled out over Start; take John out and the rest renumber. Light and dark, 412 px.
//   BASE=http://127.0.0.1:8791 OUT=/tmp/paths-order node scripts/paths-order-check.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8791', out = process.env.OUT ?? '/tmp/paths-order'
mkdirSync(out, { recursive: true })
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, onboarded: true, toured: true }
const browser = await chromium.launch()
let failed = 0
const ok = (l, c) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${l}`); if (!c) failed++ }
for (const [theme, dark] of [['paper', false], ['slate', true]]) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' })
  await ctx.addInitScript(p => { if (!sessionStorage.getItem('primed')) { localStorage.setItem('berean_prefs', JSON.stringify(p)); sessionStorage.setItem('primed', '1') } }, { ...prefs, theme })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}/paths`, { waitUntil: 'networkidle' })
  await page.getByText('Your own', { exact: true }).first().click()
  await page.waitForTimeout(1200)
  for (const b of ['Mark', 'John', 'Romans', 'Genesis']) { await page.getByRole('button', { name: b, exact: true }).click(); await page.waitForTimeout(150) }
  ok(`${theme}: John is 2 of 4`, await page.getByRole('button', { name: 'John, 2 of 4', exact: true }).count() === 1)
  ok(`${theme}: the order line`, await page.getByText('In this order: Mark, John, Romans, Genesis').count() === 1)
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${out}/${theme}-4.png` })
  await page.getByRole('button', { name: 'John, 2 of 4', exact: true }).click()
  await page.waitForTimeout(400)
  ok(`${theme}: Romans renumbers to 2 of 3`, await page.getByRole('button', { name: 'Romans, 2 of 3', exact: true }).count() === 1)
  ok(`${theme}: John is plain again`, await page.getByRole('button', { name: 'John', exact: true }).count() === 1)
  ok(`${theme}: the line follows`, await page.getByText('In this order: Mark, Romans, Genesis').count() === 1)
  await page.screenshot({ path: `${out}/${theme}-3.png` })
  ok(`${theme}: no page errors (${errors.join(' | ')})`, errors.length === 0)
  await ctx.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
