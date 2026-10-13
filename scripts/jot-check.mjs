// Jot from the verse bar at a 412 px phone, signed out: select Psalms 23:1 → Jot is the first action after the colours
// → type a note → a jotting titled "Psalms 23:1" exists in the list, holding the passage and the note; the passage alone
// (note left empty) appended to that same jotting from the sheet's "Add to" row. Stills of the bar and the sheet.
// "Jot" and "jotting" here are the brand's verb and noun (shared/brand.json); the checks look for whatever they are.
//   BASE=http://127.0.0.1:8790 OUT=/tmp/wt-jot node scripts/jot-check.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { NOUN } from './brand.mjs'
const base = process.env.BASE ?? 'http://127.0.0.1:8790'
const out = process.env.OUT ?? '/tmp/wt-jot'
mkdirSync(out, { recursive: true })
let failed = 0
const check = (label, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failed++ }
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(() => localStorage.setItem('berean_prefs', JSON.stringify({ theme: 'paper', reduceMotion: true, onboarded: true, toured: true })))
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message))
await page.goto(base + '/read/19/23?v=1', { waitUntil: 'networkidle' })
await page.waitForSelector('text=my shepherd'); await page.waitForTimeout(1500)
const clickVerse = async n => {
  const ok = await page.evaluate(n => { const el = [...document.querySelectorAll('span')].find(e => e.firstChild?.nodeType === 3 && (e.firstChild.textContent || '').trim() === String(n) && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().width < 60 && getComputedStyle(e).visibility !== 'hidden'); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true }, n)
  if (!ok) throw new Error(`verse ${n} number not on screen`)
}
await clickVerse(1); await page.waitForTimeout(600)
const actions = await page.evaluate(verb => { const bar = [...document.querySelectorAll('[role=button]')].filter(b => /^(Copy|Bookmark|Remove bookmark|Share|Listen|Ministry)/.test(b.textContent || '') || (b.textContent || '').startsWith(verb)); return bar.map(b => (b.textContent || '').trim()) }, NOUN.verb)
check(`the actions run ${NOUN.verb}, Copy, Bookmark, Share, Listen: ${actions.join(' · ')}`, actions[0] === NOUN.verb && actions.slice(1, 5).join() === 'Copy,Bookmark,Share,Listen')
check('no "+ Outline" on the bar', !(await page.getByRole('button', { name: '+ Outline' }).isVisible().catch(() => false)))
await page.screenshot({ path: `${out}/jot-1-verse-bar.png` })
await page.getByRole('button', { name: NOUN.verb }).click(); await page.waitForTimeout(700)
check(`the sheet is titled ${NOUN.verb}`, await page.getByText(NOUN.verb, { exact: true }).last().isVisible())
const note = page.getByPlaceholder('What strikes you about these verses?')
check('the note field is up and focused', await note.isVisible() && await note.evaluate(e => document.activeElement === e))
check('the new jotting is already titled by the passage', await page.getByPlaceholder(`New ${NOUN.one} title`).inputValue() === 'Psalms 23:1')
await note.fill('The shepherd wants for nothing himself, so I shall not want.')
await page.screenshot({ path: `${out}/jot-2-sheet.png` })
await page.getByRole('button', { name: 'Create & add' }).click(); await page.waitForTimeout(900)
check('toast names the jotting', await page.getByText('Added to “Psalms 23:1”').isVisible().catch(() => false))
check('the selection is cleared', !(await page.getByRole('button', { name: NOUN.verb }).isVisible().catch(() => false)))
// the passage alone, onto the same jotting
await clickVerse(2); await page.waitForTimeout(600)
await page.getByRole('button', { name: NOUN.verb }).click(); await page.waitForTimeout(700)
check(`the row under the note offers Psalms 23:1 beside New ${NOUN.one}`, await page.getByRole('tab', { name: `New ${NOUN.one}` }).isVisible() && await page.getByRole('tab', { name: 'Psalms 23:1' }).isVisible())
await page.getByRole('tab', { name: 'Psalms 23:1' }).click(); await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Add to Psalms 23:1' }).click(); await page.waitForTimeout(900)
check('appended to it, no note needed', await page.getByText('Added to “Psalms 23:1”').isVisible().catch(() => false))
// the list has it; it opens with the passage and the note
await page.goto(base + '/outlines', { waitUntil: 'networkidle' }); await page.waitForTimeout(800)
check(`the list's screen is titled ${NOUN.Many}`, (await page.title()).includes(NOUN.Many) || await page.getByText(NOUN.Many, { exact: true }).first().isVisible())
check('the jotting is listed', await page.getByText('Psalms 23:1', { exact: true }).isVisible())
const row = await page.evaluate(() => document.body.innerText.match(/\d+ verses?[^\n]*/)?.[0] ?? '')
check(`kept on this device, with its verse count: ${JSON.stringify(row)}`, /^2 verses/.test(row) && await page.getByText('· On this device').isVisible())
await page.getByText('Psalms 23:1', { exact: true }).click(); await page.waitForTimeout(1200)
const body = await page.evaluate(() => document.body.innerText)
check('the passage text is there', /my shepherd/.test(body))
check('the note is there', body.includes('The shepherd wants for nothing himself, so I shall not want.'))
check('verse 2 followed', /green pastures/.test(body))
const order = [body.indexOf('my shepherd'), body.indexOf('The shepherd wants'), body.indexOf('green pastures')]
check(`passage, note, then the second passage: ${order.join(' < ')}`, order[0] > -1 && order[0] < order[1] && order[1] < order[2])
await page.screenshot({ path: `${out}/jot-3-jotting.png` })
// Home: signed out and nothing finished here, the sign-in prompt sits below Library
await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(1000)
const home = await page.evaluate(() => document.body.innerText)
check(`Home library row reads ${NOUN.Many}`, new RegExp(`${NOUN.Many}[\\s\\S]{0,40}Your studies`).test(home))
const lib = home.indexOf('Library'), streak = home.indexOf('Keep a daily reading streak'), together = home.indexOf('Together')
check(`sign-in prompt sits after Library and before Together: ${lib} < ${streak} < ${together}`, lib > -1 && streak > lib && together > streak)
check('no page errors', errors.length === 0); if (errors.length) console.log(errors)
await browser.close()
if (failed) { console.log(`${failed} FAILED`); process.exit(1) } else console.log('all ok')
