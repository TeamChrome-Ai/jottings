import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const out = process.env.OUT ?? '/tmp/footnotes-shots'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(() => localStorage.setItem('berean_prefs', JSON.stringify({ theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true, align: 'center', width: 'medium' })))
const page = await ctx.newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
const asked = []; page.on('request', r => { if (/\/footnotes\.json/.test(r.url())) asked.push(r.url()) })
const chunks = []
page.on('response', async r => { if (r.url().includes('/_expo/static/js/') && /chiliarchs"?:\[\[41,6,21,1,/.test(await r.text().catch(() => ''))) chunks.push(r.url()) })
const shot = async (name, target = page) => { await page.waitForTimeout(350); await target.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name) }
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) process.exitCode = 1 }
const CHILIARCH = ['Mark 6:21', 'John 18:12', 'Acts 21:31']

const places = block => block.locator('[aria-label^="Read "]').evaluateAll(els => els.map(e => e.textContent.replace(/\u00a0/g, ' ')))
const rows = block => block.locator('[aria-label^="Read "]').evaluateAll(els => new Set(els.map(e => e.parentElement)).size)
const lines = async block => (await block.innerText()).replace(/\u00a0/g, ' ').split('\n').map(s => s.trim()).filter(Boolean)
const count = async block => (await lines(block))[1]
const lineBefore = async (block, ref) => { const l = await lines(block); return l[l.indexOf(ref) - 1] ?? '' }
const below = block => block.evaluate(el => {
  const kids = [...el.parentElement.children]
  const top = el.getBoundingClientRect().top
  return kids[kids.length - 1] === el && kids.slice(0, -1).every(k => k.getBoundingClientRect().bottom <= top + 1)
})
const search = async q => {
  await page.getByPlaceholder('jn 3:16, words, or G1320').fill(q)
  await page.getByRole('button', { name: 'Go' }).click()
  await page.getByText(/ verses? · | match “/).first().waitFor({ timeout: 20000 }).catch(() => {})
}
const card = page.locator('[data-testid=word-footnotes]')
const settled = async () => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200) }

await page.goto(base + '/search', { waitUntil: 'networkidle' })
await search('chiliarch')
await card.waitFor({ timeout: 20000 })
ok(`Search “chiliarch”: count ${await count(card)}, rows ${(await places(card)).join(', ')}`, await count(card) === '3' && JSON.stringify(await places(card)) === JSON.stringify(CHILIARCH))
ok(`the John 18:12 row is the tribune note (“${await lineBefore(card, 'John 18:12')}”)`, /tribune/.test(await lineBefore(card, 'John 18:12')))
await shot('01-search-chiliarch', card)
await shot('01b-search-chiliarch-page')
await page.getByRole('radio', { name: 'Old Testament' }).click()
await settled()
ok('“chiliarch” in the Old Testament: no card', !(await card.count()))
await page.getByRole('radio', { name: 'All' }).click()
await card.waitFor({ timeout: 20000 })
await card.getByRole('link', { name: 'Read John 18:12' }).click()
await page.waitForURL(/\/read\/43\/18/, { timeout: 15000 }).catch(() => {})
const john = new URL(page.url())
ok(`clicking John 18:12 opens ${john.pathname}?v=${john.searchParams.get('v')}`, john.pathname === '/read/43/18' && john.searchParams.get('v') === '12')

const wordLookup = async () => {
  await page.getByLabel('More').filter({ visible: true }).first().click(); await page.waitForTimeout(400)
  await page.getByRole('switch', { name: 'Word lookup', checked: false }).filter({ visible: true }).first().click(); await page.waitForTimeout(300)
  await page.mouse.click(200, 120)
}
await page.goto(base + '/read/43/18', { waitUntil: 'networkidle' })
await page.getByText('chiliarch', { exact: true }).first().waitFor({ timeout: 20000 })
await wordLookup()
const tagged = page.locator('[aria-label*="Strong’s"]').filter({ hasText: /^chiliarch$/ }).first()
await tagged.waitFor({ timeout: 20000 })
await tagged.click()
const dialog = page.getByRole('dialog')
await dialog.getByText('G5506', { exact: true }).first().waitFor({ timeout: 20000 })
const sheetBlock = dialog.locator('[data-testid=word-footnotes]')
await sheetBlock.waitFor({ timeout: 20000 })
await settled()
ok(`John 18, tapping “chiliarch” opens on the Concordance (G5506) with the block below the part: ${(await places(sheetBlock)).join(', ')}`, await dialog.getByRole('radio', { name: 'Concordance', checked: true }).count() > 0 && JSON.stringify(await places(sheetBlock)) === JSON.stringify(CHILIARCH) && await below(sheetBlock))
await sheetBlock.scrollIntoViewIfNeeded()
await shot('02-sheet-concordance-block', dialog)
await dialog.getByRole('radio', { name: 'The subject' }).click()
await settled()
await sheetBlock.waitFor({ timeout: 20000 })
ok(`after The subject, the block is still there below the part: ${(await places(sheetBlock)).join(', ')}`, JSON.stringify(await places(sheetBlock)) === JSON.stringify(CHILIARCH) && await below(sheetBlock))
await sheetBlock.scrollIntoViewIfNeeded()
await shot('03-sheet-subject-block', dialog)
await sheetBlock.getByRole('link', { name: 'Read Mark 6:21' }).click()
await page.waitForURL(/\/read\/41\/6/, { timeout: 15000 }).catch(() => {})
await page.waitForTimeout(700)
ok(`clicking Mark 6:21 closes the sheet and opens ${new URL(page.url()).pathname}`, new URL(page.url()).pathname === '/read/41/6' && !(await dialog.isVisible().catch(() => false)))
await page.getByText('chiliarchs', { exact: true }).first().waitFor({ timeout: 20000 })
await wordLookup()
const plural = page.locator('[aria-label*="Strong’s"]').filter({ hasText: /^chiliarchs$/ }).first()
await plural.waitFor({ timeout: 20000 })
await plural.click()
await sheetBlock.waitFor({ timeout: 20000 })
await settled()
ok(`Mark 6, tapping “chiliarchs”: ${(await places(sheetBlock)).join(', ')}`, JSON.stringify(await places(sheetBlock)) === JSON.stringify(CHILIARCH))
await page.keyboard.press('Escape'); await page.waitForTimeout(500)

await page.goto(base + '/search', { waitUntil: 'networkidle' })
await search('man')
await card.waitFor({ timeout: 20000 })
await settled()
const all = card.getByRole('button', { name: /^All [\d,]+ footnotes$/ })
ok(`Search “man”: ${await rows(card)} rows (${(await places(card)).length} places), count ${await count(card)}, “${await all.textContent().catch(() => '')}”`, await rows(card) === 3 && await all.count() === 1 && (await all.textContent()) === `All ${await count(card)} footnotes`)
await shot('04-search-man', card)
const man = await count(card)
await all.click()
await sheetBlock.waitFor({ timeout: 20000 })
await settled()
const title = await dialog.getByRole('heading').first().textContent().catch(() => '')
ok(`“All n footnotes” opens the sheet titled “${title}” with the block: ${await rows(sheetBlock)} rows, count ${await count(sheetBlock)}, “${await sheetBlock.getByRole('button').last().textContent().catch(() => '')}”`, title === 'man' && await rows(sheetBlock) === 5 && await count(sheetBlock) === man)
await shot('05-sheet-man', dialog)
const firstFive = await places(sheetBlock)
await sheetBlock.getByRole('button').last().click()
for (let t = 0; t < 40 && await rows(sheetBlock) <= 5; t++) await page.waitForTimeout(250)
const grown = await places(sheetBlock)
ok(`“96 more” grows the sheet's list to ${await rows(sheetBlock)} rows, the first 5 kept in place`, await rows(sheetBlock) === 25 && firstFive.every((p, k) => grown[k] === p))
await page.keyboard.press('Escape'); await page.waitForTimeout(500)

for (const q of ['of', 'G5506']) {
  await page.goto(base + '/search', { waitUntil: 'networkidle' })
  await page.getByPlaceholder('jn 3:16, words, or G1320').fill(q)
  await page.getByRole('button', { name: 'Go' }).click()
  await settled()
  ok(`Search “${q}”: no footnotes`, !(await page.locator('[data-testid=word-footnotes]').count()))
}

ok(`no request for footnotes.json (${asked.join(', ') || 'none'})`, asked.length === 0)
ok(`the index came as a script chunk (${[...new Set(chunks.map(u => new URL(u).pathname))].join(', ')})`, chunks.length > 0 && chunks.every(u => new URL(u).pathname.startsWith('/_expo/static/js/')))
await browser.close()
ok(errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors', !errors.length)
