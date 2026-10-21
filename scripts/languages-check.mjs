// Languages (docs/LANGUAGES.md) in the web build against a server: the French and German Bibles in the English verses
// with their own numbers, references in the reader's language, side by side under (phone) and beside (wide), search,
// the Language sheet. BASE=http://127.0.0.1:8796 SHOTS=/tmp/lang-shots node scripts/languages-check.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const shots = process.env.SHOTS ?? '/tmp/lang-shots'
fs.mkdirSync(shots, { recursive: true })
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
let failed = 0
const check = (ok, what, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${ok || got === undefined ? '' : `  (got ${JSON.stringify(got).slice(0, 200)})`}`); if (!ok) failed++ }
const PREFS = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, verseNumbers: true, paragraphs: false, showNotes: true, reduceMotion: true, onboarded: true, toured: true }

async function open(prefs, path, viewport = { width: 412, height: 900 }, until = null) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 })
  await ctx.addInitScript(v => localStorage.setItem('berean_prefs', JSON.stringify(v)), { ...PREFS, ...prefs })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(base + path, { waitUntil: 'networkidle' })
  // drawn: the screen has its words (a busy machine can take seconds over a language's first load)
  await page.waitForFunction(u => u ? document.body.innerText.includes(u) : document.body.innerText.trim().length > 80, until, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
  return { ctx, page, errors }
}
const text = page => page.evaluate(() => document.body.innerText)

// French: Psalm 51 starts at its own verse 3, the title above; book names and the header in French
{
  const { ctx, page, errors } = await open({ lang: 'fr', bible: 'fr' }, '/read/19/51', undefined, 'Use de grâce')
  const body = await text(page)
  check(body.includes('Use de grâce envers moi, ô Dieu'), 'French text of Psalm 51', body.slice(0, 300))
  check(/Psaumes/.test(body), 'French book name in the heading')
  check(/\b3\s+Use de grâce/.test(body), 'Psalm 51:1 shows its own number 3', body.match(/.{0,8}Use de grâce/)?.[0])
  check(body.includes('Au chef de musique'), 'the psalm title above')
  await page.screenshot({ path: `${shots}/fr-psalm51.png` })
  check(!errors.length, 'no page errors (French reader)', errors)
  await ctx.close()
}
// French Joel 2 holds its own chapter 3 from verse 28: a heading there; the picker lists four chapters
{
  const { ctx, page } = await open({ lang: 'fr', bible: 'fr' }, '/read/29/2?v=27', undefined, 'Chapitre 3')
  const body = await text(page)
  check(/Chapitre 3/.test(body), 'a heading « Chapitre 3 » where French Joel 3 begins inside English Joel 2', body.slice(0, 300))
  check(/Joël 2 ▾/.test(body), 'the header names the chapter by its own number', body.slice(0, 80))
  await page.screenshot({ path: `${shots}/fr-joel2.png`, fullPage: true })
  await ctx.close()
}
// side by side on a phone: the English under each French verse
{
  const { ctx, page } = await open({ lang: 'fr', bible: 'fr', bible2: 'en' }, '/read/43/3', undefined, 'For God so loved')
  const body = await text(page)
  check(body.includes('Car Dieu a tant aimé le monde') && body.includes('For God so loved the world'), 'John 3:16 in French with the English under it')
  await page.screenshot({ path: `${shots}/fr-en-phone.png` })
  await ctx.close()
}
// side by side on a wide screen: two columns
{
  const { ctx, page } = await open({ lang: 'en', bible: 'en', bible2: 'fr' }, '/read/43/1', { width: 1280, height: 900 }, 'Au commencement')
  // the first visible text node holding each, by where it is drawn
  const pos = await page.evaluate(() => {
    const at = s => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n; (n = w.nextNode());) { if (!n.textContent.includes(s)) continue; const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); if (b.width && b.x >= 0 && b.x < innerWidth) return b } return null }
    const a = at('beginning was the Word'), b = at('Au commencement était la Parole')
    return a && b ? { ax: Math.round(a.x), bx: Math.round(b.x), ay: Math.round(a.y), by: Math.round(b.y) } : null
  })
  check(!!pos && pos.bx > pos.ax + 200 && Math.abs(pos.ay - pos.by) < 30, 'wide: the French beside the English, same line', pos)
  await page.screenshot({ path: `${shots}/en-fr-wide.png` })
  await ctx.close()
}
// German: John 3:16 in the Elberfelder, German book name, comma references
{
  const { ctx, page, errors } = await open({ lang: 'de', bible: 'de' }, '/read/43/3', undefined, 'Denn also')
  const body = await text(page)
  check(/Denn also hat Gott die Welt geliebt/.test(body), 'German John 3:16')
  check(/Johannes/.test(body), 'German book name')
  await page.screenshot({ path: `${shots}/de-john3.png` })
  check(!errors.length, 'no page errors (German reader)', errors)
  await ctx.close()
}
// Dutch screens over the English Darby
{
  const { ctx, page } = await open({ lang: 'nl' }, '/read/43/3', undefined, 'Pharisees')
  const body = await text(page)
  check(body.includes('a man from among the Pharisees') && /Johannes/.test(body) && /Lezen/.test(body), 'Dutch screens, English Bible, Dutch book name', body.slice(0, 200))
  await page.screenshot({ path: `${shots}/nl-john3.png` })
  await ctx.close()
}
// search in the French: hits in French, references in its numbering
{
  const { ctx, page } = await open({ lang: 'fr', bible: 'fr' }, '/search')
  const box = page.locator('input').first()
  await box.fill('berger'); await box.press('Enter'); await page.waitForTimeout(2500)
  const body = await text(page)
  check(/berger/i.test(body) && /Psaume 23/.test(body), 'French search finds "berger" in Psaume 23', body.slice(0, 400))
  await box.fill('Psaume 51:3'); await box.press('Enter'); await page.waitForTimeout(1500)
  check(page.url().includes('/read/19/51'), 'typing Psaume 51:3 opens Psalm 51', page.url())
  await page.screenshot({ path: `${shots}/fr-search.png` })
  await ctx.close()
}
// Settings: the Language sheet
{
  const { ctx, page } = await open({ lang: 'fr', bible: 'fr' }, '/settings')
  const row = page.getByRole('button', { name: /Langue|Language/ }).first()
  await row.click(); await page.waitForTimeout(700)
  const body = await text(page)
  check(['Français', 'Deutsch', 'Italiano', 'Nederlands', 'Svenska', 'Darby (français)', 'Elberfelder (Deutsch)'].every(s => body.includes(s)), 'the Language sheet lists the languages and Bibles')
  await page.screenshot({ path: `${shots}/fr-language-sheet.png` })
  await ctx.close()
}
// every language's Home, for a look; the screens say something in the language, never a raw key or placeholder
for (const [lang, bible, word] of [['fr', 'fr', 'Accueil'], ['fr-CA', 'fr', 'Accueil'], ['de', 'de', 'Lesen'], ['it', 'en', 'Leggi'], ['nl', 'en', 'Lezen'], ['sv', 'en', 'Läs']]) {
  const { ctx, page, errors } = await open({ lang, bible, readerName: 'Anna' }, '/')
  const body = await text(page)
  check(body.includes(word) && !/\{[a-zA-Z]+\}|\u0004|\u0000/.test(body), `${lang}: Home in the language, no placeholders left`, body.slice(0, 160))
  check(!errors.length, `${lang}: no page errors`, errors)
  await page.screenshot({ path: `${shots}/home-${lang}.png` })
  await ctx.close()
}
// a translated legal page, the English named as the one that governs
{
  const r = await fetch(`${base}/privacy-fr`)
  const html = await r.text()
  check(r.ok && html.includes('lang="fr"') && html.includes('Ceci est une traduction'), 'the French privacy policy is served', r.status)
  const it = await fetch(`${base}/privacy-it`), itHtml = await it.text()
  check(it.ok && itHtml.includes('lang="it"') && itHtml.includes('Questa è una traduzione'), 'the Italian privacy policy is served', it.status)
}
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
