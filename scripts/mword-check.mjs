// Word lookup in the ministry reader, and Darby's glossary, at a 412 px phone (touch) and at 1280 wide: open a
// Collected Writings paper, turn Word lookup on (More → switch; the Aa toggle when wide), click "assembly" → the word
// sheet shows Darby's usage FIRST, then Morrish; its source link opens that section in the reader; click
// "propitiation" → Strong's (the word) and Morrish (the subject), no glossary block; a function word opens nothing; a
// scripture reference is still a link. Then Home → Library → Dictionary → Darby's terms: the list, and a term opening
// the same block plus the article.
// BASE=http://127.0.0.1:8791 OUT=/tmp/wt-mword node scripts/mword-check.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8791'
const out = process.env.OUT ?? '/tmp/wt-mword'
mkdirSync(out, { recursive: true })
const W = 412, H = 915
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false, align: 'center', width: 'medium', onboarded: true, toured: true }
const browser = await chromium.launch()
const errors = []
let failed = 0
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failed++ }
const shot = async (page, name, wait = 700) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name) }

async function open({ touch = true, width = W, height = H } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch })
  await ctx.addInitScript(p => { if (!sessionStorage.getItem('primed')) { localStorage.setItem('berean_prefs', p); sessionStorage.setItem('primed', '1') } }, JSON.stringify(prefs))
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|status of 404|when fetching the script/.test(m.text())) errors.push('console: ' + m.text()) })
  return { ctx, page }
}
const dialog = page => page.getByRole('dialog').last()
const params = page => Object.fromEntries(new URL(page.url()).searchParams)

/** Scrolls the first whole word `word` of the visible page into view and returns the centre of its glyphs. */
async function wordPoint(page, word, width = W) {
  return page.evaluate(([word, W]) => {
    const re = new RegExp(`(^|[^A-Za-z’'-])(${word})(?=$|[^A-Za-z’'-])`)
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const m = re.exec(n.textContent ?? '')
      if (!m || n.parentElement?.closest('[aria-hidden="true"], [role="dialog"]')) continue
      const el = n.parentElement
      const pr = el.getBoundingClientRect()
      // the page's text column is on screen; neighbours sit offscreen either side
      if (pr.width === 0 || pr.left < -2 || pr.left > W) continue
      const r = document.createRange()
      r.setStart(n, m.index + m[1].length); r.setEnd(n, m.index + m[1].length + m[2].length)
      el.scrollIntoView({ block: 'center' })
      const b = r.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, text: r.toString() }
    }
    return null
  }, [word, width])
}
/** The y of the first element in the open sheet whose own text starts with `text`. */
const yOf = (page, text) => page.evaluate(text => {
  const d = [...document.querySelectorAll('[role="dialog"]')].pop()
  for (const el of d?.querySelectorAll('*') ?? []) if (el.childElementCount === 0 ? el.textContent?.trim().startsWith(text) : [...el.childNodes].some(c => c.nodeType === 3 && c.textContent.trim().startsWith(text))) return el.getBoundingClientRect().top
  return null
}, text)
const paper = '/companion?author=darby&work=cw-doctrinal-7&n=6'

// ---------------- phone ----------------
{
  const { page } = await open()
  await page.goto(base + paper, { waitUntil: 'networkidle' })
  await page.getByText('What do I learn from scripture?').first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(800)
  // with the switch off, a tap on a word opens nothing
  let pt = await wordPoint(page, 'assembly')
  ok(`the paper prints "assembly" (${pt?.text})`, pt?.text === 'assembly')
  await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(800)
  ok('Word lookup off: a tap on a word opens no sheet', !(await dialog(page).count()))
  // More → Word lookup
  await page.getByLabel('More', { exact: true }).click()
  const sw = dialog(page).getByRole('switch', { name: 'Word lookup' }).first()
  await sw.waitFor()
  ok('the More sheet has the Word lookup switch', await sw.count() === 1)
  await shot(page, 'mword-01-more-switch')
  await sw.click(); await page.waitForTimeout(300)   // on: the sheet opening on the next tap proves it
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  // "assembly" → Darby's usage first, Morrish beneath
  pt = await wordPoint(page, 'assembly')
  await page.mouse.click(pt.x, pt.y)
  await dialog(page).getByText('Darby’s usage').waitFor({ timeout: 15000 })
  await page.waitForTimeout(900)
  const t1 = await dialog(page).innerText()
  ok('the sheet opens on "assembly" with Darby’s usage', /Darby’s usage/.test(t1) && /the assembly — His word for the church/.test(t1))
  ok('… quoting his sentence with its source', /The assembly is the gathering of the children of God/.test(t1) && /Ecclesiastical 3/.test(t1))
  // the part's own first line (its hint) comes after the block; the segmented pair above the scroll is a control, not content
  const partTop = async () => (await yOf(page, 'The Hebrew behind')) ?? (await yOf(page, 'The Greek behind')) ?? (await yOf(page, 'What it is'))
  let yD = await yOf(page, 'Darby’s usage'), yP = await partTop()
  ok(`… FIRST: above the part (${yD} < ${yP})`, yD !== null && yP !== null && yD < yP)
  ok('… and The word too: Darby’s text renders tagged words "assembly" (the segmented pair, on the word)', await dialog(page).getByRole('radio', { name: 'Concordance' }).count() > 0 && /The Hebrew behind/.test(t1))
  await dialog(page).getByRole('radio', { name: 'The subject' }).first().click(); await page.waitForTimeout(900)
  const t1b = await dialog(page).innerText()
  yD = await yOf(page, 'Darby’s usage'); yP = await partTop()
  ok(`… The subject: Morrish’s article Assembly, Darby’s usage still first (${yD} < ${yP})`, /What it is/.test(t1b) && /Assembly/.test(t1b) && yD !== null && yP !== null && yD < yP)
  await shot(page, 'mword-02b-assembly-subject')
  await shot(page, 'mword-02-assembly-sheet')
  // the source link leaves for that section of the ministry
  await dialog(page).getByLabel(/^Read it in the ministry/).click()
  await page.waitForTimeout(1500)
  const p1 = params(page)
  ok(`the source link opens Ecclesiastical 3 §2 (${JSON.stringify(p1)})`, p1.work === 'cw-ecclesiastical-3' && p1.n === '2')
  await shot(page, 'mword-03-source-section')
  // the switch stays on across the move: a word of the new section opens the sheet at once
  pt = await wordPoint(page, 'assembly')
  await page.mouse.click(pt.x, pt.y)
  ok('… and the switch stays on across the move', await dialog(page).getByText('Darby’s usage').waitFor({ timeout: 10000 }).then(() => true, () => false))
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  await page.goBack(); await page.waitForTimeout(1200)
  // "propitiation" → the word (Strong's) and the subject (Morrish), no glossary
  pt = await wordPoint(page, 'propitiation')
  ok(`the paper prints "propitiation" (${pt?.text})`, pt?.text === 'propitiation')
  await page.mouse.click(pt.x, pt.y)
  await dialog(page).getByText(/^The (word|subject)$/).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  const t2 = await dialog(page).innerText()
  ok('the sheet on "propitiation" has The word: a Greek number with its lemma', /Concordance/.test(t2) && /G\d{3,4}/.test(t2) && /ἱλασ/.test(t2))
  ok('… and The subject one tap away, with no Darby’s usage block', /The subject/.test(t2) && !/Darby’s usage/.test(t2))
  await shot(page, 'mword-04-propitiation-word')
  await dialog(page).getByRole('radio', { name: 'The subject' }).first().click(); await page.waitForTimeout(900)
  const t3 = await dialog(page).innerText()
  ok('… The subject is Morrish’s Propitiation', /Propitiation/.test(t3))
  await shot(page, 'mword-05-propitiation-subject')
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  // a function word opens nothing; a reference is still a link
  pt = await wordPoint(page, 'the')
  await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(700)
  ok('a tap on "the" opens nothing', !(await dialog(page).count()))
  const link = page.getByRole('link', { name: /^[1-3]? ?[A-Z][a-z]+\.? \d+/ }).first()
  ok('scripture references in the prose are still links', await link.count() > 0)
  // a word with neither: quietly, Search the dictionary
  pt = await wordPoint(page, 'Saviour') ?? await wordPoint(page, 'suppose')
  if (pt) {
    await page.mouse.click(pt.x, pt.y)
    await dialog(page).waitFor({ timeout: 10000 }); await page.waitForTimeout(1200)
    const t4 = await dialog(page).innerText()
    ok(`"${pt.text}": the sheet says quietly what it has (${t4.split('\n').slice(0, 3).join(' / ')})`, /Search the dictionary|Concordance|The subject/.test(t4))
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  }
  await page.close()
}

// ---------------- wide: the Aa toggle ----------------
{
  const { page } = await open({ touch: false, width: 1280, height: 900 })
  await page.goto(base + paper, { waitUntil: 'networkidle' })
  await page.getByText('What do I learn from scripture?').first().waitFor({ timeout: 30000 })
  const aa = page.getByLabel('Word lookup', { exact: true })
  ok('wide: the toolbar has the Aa toggle', await aa.count() === 1)
  await aa.click(); await page.waitForTimeout(400)
  ok('… which reads Word lookup off once on', await page.getByLabel('Word lookup off', { exact: true }).count() === 1)
  const pt = await wordPoint(page, 'obedience', 1280)
  if (pt) {
    await page.mouse.click(pt.x, pt.y)
    await dialog(page).getByText('Darby’s usage').waitFor({ timeout: 15000 }); await page.waitForTimeout(800)
    ok('wide: "obedience" opens on Darby’s usage', /The delight of the new nature/.test(await dialog(page).innerText()))
    await shot(page, 'mword-06-wide-obedience')
  } else ok('wide: the paper prints "obedience"', false)
  await page.close()
}

// ---------------- the dictionary's Darby's terms ----------------
{
  const { page } = await open()
  await page.goto(base + '/dictionary', { waitUntil: 'networkidle' })
  const row = page.getByText('Darby’s terms', { exact: true }).first()
  await row.waitFor({ timeout: 30000 })
  ok('the dictionary index lists Darby’s terms beside the synonyms', await page.getByText('New Testament synonyms', { exact: true }).count() > 0)
  await row.click(); await page.waitForTimeout(900)
  const body = await page.locator('body').innerText()
  ok('… as its own section, counted', /Darby’s terms · \d\d terms/.test(body) && /the appearing/.test(body) && /the assembly/.test(body))
  await shot(page, 'mword-07-dictionary-terms')
  await page.getByLabel('the assembly, Darby’s usage').click()
  await dialog(page).getByText('Darby’s usage').waitFor({ timeout: 15000 }); await page.waitForTimeout(1200)
  const t = await dialog(page).innerText()
  ok('a term opens the sheet: Darby’s usage, then Morrish’s article', /His word for the church/.test(t) && /The subject/.test(t) && /Assembly/.test(t))
  await shot(page, 'mword-08-dictionary-term-sheet')
  await page.close()
}

await browser.close()
if (errors.length) { console.log('page errors:', errors); failed++ }
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
