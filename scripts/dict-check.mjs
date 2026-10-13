// Dictionary browsing (letter -> two-letter group -> page 2, paged search) and word lookup in the reader (a tagged word:
// the word, the subject folded beneath; an untagged word: the subject alone), at a 412 px phone width.
// BASE=http://127.0.0.1:8799 OUT=/tmp/wt-dict node scripts/dict-check.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const out = process.env.OUT ?? '/tmp/bdb-ui'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(() => localStorage.setItem('berean_prefs', JSON.stringify({ theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true, align: 'center', width: 'medium' })))
const page = await ctx.newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
const shot = async (name, full = false) => { await page.waitForTimeout(350); await page.screenshot({ path: `${out}/${name}.png`, fullPage: full }); console.log('shot', name) }
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) process.exitCode = 1 }
const visible = t => page.getByText(t, { exact: true }).first().isVisible().catch(() => false)
const headwords = () => page.locator('[role=link]').evaluateAll(els => els.map(e => e.textContent ?? ''))

// 1. A to Z: A's groups as chips, with counts
await page.goto(base + '/dictionary', { waitUntil: 'networkidle' })
await page.waitForSelector('text=The Bible’s people, places, things and teaching')
await page.getByLabel(/^Ab, \d+ headwords$/).waitFor()
const chips = await page.locator('[aria-label$=" headwords"], [aria-label$=" headword"]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')))
ok(`A shows its two-letter groups (${chips.length}: ${chips.slice(0, 6).join('; ')} …)`, chips.length > 10 && chips.some(c => /^Ab, /.test(c)))
ok('A lists page 1 of its headwords', /Page 1 of \d+/.test(await page.locator('body').innerText()))
await shot('01-dictionary-A')

// 2. A -> Ab
await page.getByLabel(/^Ab, \d+ headwords$/).click()
await page.waitForTimeout(400)
const ab1 = (await headwords()).filter(h => /^Ab/i.test(h))
ok(`Ab lists only Ab headwords (${ab1.length} on page 1, first “${ab1[0]}”)`, ab1.length === 30)
ok('Ab says page 1 of 3', await visible('Page 1 of 3'))
await page.mouse.wheel(0, 3000); await page.waitForTimeout(300)
await shot('02-dictionary-Ab')

// 3. Ab page 2, then away to another group and back: the page is kept
await page.getByLabel('Next page').click()
await page.waitForTimeout(500)
const ab2 = (await headwords()).filter(h => /^Ab/i.test(h))
ok(`Ab page 2 shows the next 30 (first “${ab2[0]}”)`, ab2.length === 30 && ab2[0] !== ab1[0])
ok('page 2 of 3', await visible('Page 2 of 3'))
await shot('03-dictionary-Ab-page2')
await page.getByLabel(/^Ac, \d+ headwords$/).click(); await page.waitForTimeout(300)
await page.getByLabel(/^Ab, \d+ headwords$/).click(); await page.waitForTimeout(300)
ok('back on Ab, still page 2', await visible('Page 2 of 3'))

// 4. search, paged
const search = page.getByLabel('Search the dictionary')
await search.fill('an')
await page.waitForTimeout(500)
const body = await page.locator('body').innerText()
const m = /([\d,]+) headwords match “an”/.exec(body)
ok(`search “an”: ${m?.[1]} matches, paged (${/Page 1 of (\d+)/.exec(body)?.[1]} pages)`, !!m && /Page 1 of \d+/.test(body))
await shot('04-dictionary-search')
await page.getByLabel('Next page').click(); await page.waitForTimeout(400)
ok('search page 2', /Page 2 of \d+/.test(await page.locator('body').innerText()))
await shot('05-dictionary-search-page2')

// 5. John 3 with word lookup on (More -> Word lookup): one switch, and the tags load
await page.goto(base + '/read/43/3', { waitUntil: 'networkidle' })
await page.waitForSelector('text=Nicodemus')
await page.getByLabel('More').click(); await page.waitForTimeout(400)
ok('More offers word lookup as one switch, no choice under it', !(await page.getByRole('radio', { name: 'Morrish', exact: true }).count()))
await page.getByRole('switch', { name: 'Word lookup' }).first().click(); await page.waitForTimeout(300)
await shot('06-reader-more-word-lookup')
await page.mouse.click(200, 120)
await page.locator("[aria-label*=\"Strong’s\"]").first().waitFor({ timeout: 15000 })
ok(`word lookup loads the tags (${await page.locator("[aria-label*=\"Strong’s\"]").count()} tagged words)`, true)
await shot('07-reader-john3-word-lookup')

// 6. a tagged word: the word first, its subject folded beneath; an untagged word with no article: search
await page.locator("[aria-label*=\"Strong’s\"]").filter({ hasText: /^Nicodemus$/ }).first().click()
await page.getByRole('dialog').getByRole('radio', { name: 'Concordance' }).waitFor({ timeout: 10000 })
await page.waitForTimeout(1200)
const both = await page.getByRole('dialog').innerText()
ok('tapping tagged “Nicodemus” opens on the word (G…), the subject one tap away', /G\d+/.test(both) && /behind the English/.test(both) && await page.getByRole('dialog').getByRole('radio', { name: 'The subject' }).isVisible())
await shot('08-reader-tagged')
await page.getByRole('dialog').getByRole('radio', { name: 'The subject' }).click(); await page.waitForTimeout(900)
ok('one tap shows the subject, the Nicodemus article', /Nicodemus/.test(await page.getByRole('dialog').innerText()) && /What it is: a person/.test(await page.getByRole('dialog').innerText()))
await shot('08b-reader-tagged-subject')
await page.keyboard.press('Escape'); await page.waitForTimeout(500)
await page.getByText('needful', { exact: true }).filter({ visible: true }).first().click(); await page.waitForTimeout(700)
const none = await page.getByRole('dialog').innerText().catch(() => '')
ok('tapping untagged “needful” offers Search the dictionary, no word part', /No article is headed “needful”/.test(none) && /Search the dictionary/.test(none) && !/Concordance/.test(none))
await shot('09-reader-word-no-article')
await page.keyboard.press('Escape'); await page.waitForTimeout(500)

// 7. an untagged word with an article: the subject alone
const untagged = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('span')].filter(e => {
    const r = e.getBoundingClientRect()
    return e.children.length === 0 && /^[A-Za-z]{3,}$/.test(e.textContent ?? '') && !e.closest('[aria-label]') && getComputedStyle(e).cursor === 'pointer' && r.x >= 0 && r.x < innerWidth && r.width > 0
  })
  const pick = ['begotten', 'heart', 'Rabbi', 'mother', 'womb', 'bridegroom', 'friend'].map(w => spans.find(e => e.textContent === w)).find(Boolean)
  if (pick) pick.setAttribute('data-probe', '1')
  return { n: spans.length, sample: spans.slice(0, 8).map(e => e.textContent), pick: pick?.textContent }
})
console.log(`untagged tappable words on John 3: ${untagged.n} (e.g. ${untagged.sample.join(', ')}); tapping untagged “${untagged.pick}”`)
if (untagged.pick) {
  await page.locator('[data-probe="1"]').click(); await page.waitForTimeout(800)
  const t = await page.getByRole('dialog').innerText().catch(() => '')
  ok(`untagged “${untagged.pick}” opens the subject alone`, /The subject/.test(t) && !/Concordance/.test(t))
  await shot('11-reader-untagged')
}

// 8. wider screens: Aa is a plain toggle; Settings -> Reading has no lookup choice
{
  const wctx = await browser.newContext({ viewport: { width: 1100, height: 900 } })
  await wctx.addInitScript(() => localStorage.setItem('berean_prefs', JSON.stringify({ theme: 'paper', reduceMotion: true })))
  const p = await wctx.newPage()
  p.on('pageerror', e => errors.push(e.message))
  await p.goto(base + '/read/43/3', { waitUntil: 'networkidle' }); await p.waitForSelector('text=Nicodemus')
  await p.getByLabel('Word lookup', { exact: true }).click(); await p.waitForTimeout(400)
  ok('Aa turns word lookup on', await p.getByLabel('Word lookup off').isVisible().catch(() => false))
  await p.screenshot({ path: `${out}/14-wide-aa.png` }); console.log('shot 14-wide-aa')
  await p.getByLabel('More').click(); await p.waitForTimeout(400)   // Reading settings sits behind More at every width
  await p.getByRole('dialog').getByRole('button', { name: 'Reading settings' }).click(); await p.getByText('Footnote markers').waitFor()
  await p.getByText('Footnote markers').scrollIntoViewIfNeeded(); await p.waitForTimeout(400)
  ok('Settings → Reading has no Word lookup row', !(await p.getByText('Word lookup', { exact: true }).isVisible().catch(() => false)))
  await p.screenshot({ path: `${out}/15-settings-reading.png` }); console.log('shot 15-settings-reading')
  await wctx.close()
}

// 9. the reader's font on today's verse and in an article (OpenDyslexic, then Sans)
for (const font of ['dyslexic', 'sans']) {
  const fctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await fctx.addInitScript(f => localStorage.setItem('berean_prefs', JSON.stringify({ theme: 'paper', font: f, reduceMotion: true })), font)
  const p = await fctx.newPage()
  p.on('pageerror', e => errors.push(e.message))
  const familyOf = async (re) => p.evaluate(src => { const r = new RegExp(src); const e = [...document.querySelectorAll('div,span')].find(x => x.children.length === 0 && r.test(x.textContent ?? '')); return e ? getComputedStyle(e).fontFamily : null }, re.source)
  const want = font === 'dyslexic' ? /OpenDyslexic/ : /system-ui/
  await p.goto(base + '/', { waitUntil: 'networkidle' }); await p.getByText('Today’s verse').waitFor(); await p.waitForTimeout(600)
  const votd = await p.evaluate(() => { const card = [...document.querySelectorAll('[aria-label^="Today’s verse"]')][0]; const t = card && [...card.querySelectorAll('div,span')].filter(x => x.children.length === 0).sort((a, b) => (b.textContent?.length ?? 0) - (a.textContent?.length ?? 0))[0]; return t ? getComputedStyle(t).fontFamily : null })
  ok(`${font}: today’s verse is set in ${votd}`, want.test(votd ?? ''))
  if (font === 'dyslexic') { await p.screenshot({ path: `${out}/12-home-votd-dyslexic.png` }); console.log('shot 12-home-votd-dyslexic') }
  await p.goto(base + '/dictionary?id=serpent', { waitUntil: 'networkidle' }); await p.getByText(/most commonly translated/).first().waitFor(); await p.waitForTimeout(400)
  const art = await familyOf(/most commonly translated/)
  ok(`${font}: a dictionary article is set in ${art}`, want.test(art ?? ''))
  if (font === 'dyslexic') { await p.screenshot({ path: `${out}/13-article-dyslexic.png` }); console.log('shot 13-article-dyslexic') }
  await fctx.close()
}

await browser.close()
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors')
