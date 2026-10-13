// Descenders at the tightest line height (build 31: "the bottom of letters gets cut off" on Android). Genesis 1 in
// the serif at the slider's minimum, 412 px: the verse text is laid out at Literata's floor (lib/lineHeight.ts), and
// the room under the baseline in that line box — (line + descent − ascent) / 2, the box being centred on the font's
// content area as Android and the web both do — holds the ink of a descender (canvas actualBoundingBoxDescent of
// "g"). The same at the default 1.6 (unchanged), the sans at 1.2 (no floor needed), and the Settings preview with its
// note. Stills of Genesis 1 at the minimum go to OUT.
// BASE=http://127.0.0.1:8796 OUT=/tmp/wt-readerpolish node scripts/line-height-check.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8796'
const out = process.env.OUT ?? '/tmp/wt-readerpolish'
mkdirSync(out, { recursive: true })
const PREFS = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: false, showNotes: true, reduceMotion: true, align: 'center', width: 'medium', onboarded: true, toured: true, readerName: '' }
const browser = await chromium.launch()
let failed = 0
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failed++ }

async function open(prefs) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(p => { localStorage.setItem('berean_prefs', p) }, JSON.stringify(prefs))
  return ctx.newPage()
}
/** The verse text's line box and the font's metrics, from the first verse holding "beginning". */
const measure = page => page.evaluate(async () => {
  await document.fonts.ready
  const el = [...document.querySelectorAll('[dir=auto]')].find(e => /In the beginning/.test(e.textContent ?? '') && (e.textContent ?? '').length < 400)
  if (!el) return null
  const cs = getComputedStyle(el)
  const fontSize = parseFloat(cs.fontSize), line = parseFloat(cs.lineHeight)
  const ctx = document.createElement('canvas').getContext('2d')
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${fontSize}px ${cs.fontFamily}`
  const g = ctx.measureText('g'), y = ctx.measureText('y'), j = ctx.measureText('j')
  const ink = Math.max(g.actualBoundingBoxDescent, y.actualBoundingBoxDescent, j.actualBoundingBoxDescent)
  const asc = g.fontBoundingBoxAscent, desc = g.fontBoundingBoxDescent
  // the box's room under the baseline, the content area (asc + desc) being centred in it
  const room = (line + desc - asc) / 2
  const r = el.getBoundingClientRect()
  return { family: cs.fontFamily.split(',')[0], fontSize, line, factor: +(line / fontSize).toFixed(3), asc: +(asc / fontSize).toFixed(3), desc: +(desc / fontSize).toFixed(3), ink: +(ink / fontSize).toFixed(3), room: +room.toFixed(2), inkPx: +ink.toFixed(2), height: Math.round(r.height) }
})

for (const [label, prefs, want] of [
  ['serif at the slider minimum 1.2', { ...PREFS, lineHeight: 1.2 }, { factor: 1.45, shot: 'genesis-1-line-min-after' }],
  ['serif at the default 1.6', PREFS, { factor: 1.6 }],
  ['sans at 1.2', { ...PREFS, font: 'sans', lineHeight: 1.2 }, { factor: 1.2 }],
]) {
  const page = await open(prefs)
  await page.goto(base + '/read/1/1', { waitUntil: 'networkidle' })
  await page.getByText('In the beginning', { exact: false }).first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(800)
  const m = await measure(page)
  console.log(`   ${label}: ${JSON.stringify(m)}`)
  ok(`${label}: laid out at ${want.factor} × the size (${m?.factor})`, m && Math.abs(m.factor - want.factor) < 0.03)
  ok(`${label}: the line box holds the descenders (room ${m?.room} px under the baseline, ink ${m?.inkPx} px)`, m && m.room >= m.inkPx)
  if (want.shot) { await page.screenshot({ path: `${out}/${want.shot}.png` }); console.log('shot', want.shot) }
  await page.context().close()
}

// what the slider minimum looked like before the floor: the same page with the verses forced to 1.2 × size
{
  const page = await open({ ...PREFS, lineHeight: 1.2 })
  await page.goto(base + '/read/1/1', { waitUntil: 'networkidle' })
  await page.getByText('In the beginning', { exact: false }).first().waitFor({ timeout: 30000 })
  await page.addStyleTag({ content: '[dir=auto] { line-height: 22.8px !important }' })
  await page.waitForTimeout(500)
  const m = await measure(page)
  ok(`before (verses forced to 1.2): the descenders did NOT fit (room ${m?.room} px, ink ${m?.inkPx} px) — the bug`, m && m.room < m.inkPx)
  await page.screenshot({ path: `${out}/genesis-1-line-min-before.png` }); console.log('shot genesis-1-line-min-before')
  await page.context().close()
}

// Settings: the preview is laid out at the floor and the row says so; not at the default
{
  const page = await open({ ...PREFS, lineHeight: 1.2 })
  await page.goto(base + '/settings', { waitUntil: 'networkidle' })
  const preview = page.getByLabel('Preview of the reading text')
  await preview.waitFor({ timeout: 30000 })
  await page.waitForTimeout(800)
  const line = await preview.evaluate(el => { const t = el.querySelector('[dir=auto]'); return t ? parseFloat(getComputedStyle(t).lineHeight) / parseFloat(getComputedStyle(t).fontSize) : 0 })
  ok(`Settings preview at 1.2 is laid out at the floor (${line.toFixed(3)})`, Math.abs(line - 1.45) < 0.03)
  const note = page.getByText(/Tighter than the font allows: shown at 1\.45/)
  ok('… and the row says "Tighter than the font allows: shown at 1.45"', await note.count() === 1)
  await note.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${out}/settings-line-min-note.png` }); console.log('shot settings-line-min-note')
  await page.context().close()
}
{
  const page = await open(PREFS)
  await page.goto(base + '/settings', { waitUntil: 'networkidle' })
  await page.getByLabel('Preview of the reading text').waitFor({ timeout: 30000 })
  await page.waitForTimeout(500)
  ok('at 1.6 the row carries no note', await page.getByText(/Tighter than the font allows/).count() === 0)
  await page.context().close()
}

await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exitCode = failed ? 1 : 0
