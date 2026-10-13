// The About screen at phone width: open each notice, shoot it and its set pieces, count the links, follow one to the reader.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const out = process.env.OUT ?? '/tmp/wt-about'
mkdirSync(out, { recursive: true })
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true, align: 'center', width: 'wide' }
const titles = [
  'Introductory notice to the 1961 edition',
  'Extract from the introductory notice to the 1890 edition (Old Testament)',
  'Extracts from the introductory notice to the 1884 edition (New Testament)',
  'Revised preface to the second edition of the New Testament (1871)',
  'Chronological order of the prophets; note on the chronological dates',
]
const errors = []
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(p => localStorage.setItem('berean_prefs', JSON.stringify(p)), prefs)
const page = await ctx.newPage()
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await page.goto(base + '/about', { waitUntil: 'networkidle' })
await page.waitForSelector('text=About this translation', { timeout: 30000 })
await page.waitForTimeout(600)

const links = () => page.evaluate(() => [...document.querySelectorAll('[role=link], a')].filter(e => e.offsetParent !== null).length)
const header = (t) => page.getByText(t, { exact: true })
const shotAt = async (name, locator) => {
  await locator.first().evaluate(e => e.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${out}/${name}.png` })
  console.log('shot', name)
}

// all shut: the baseline links (the chronology row)
await header(titles[0]).click()
await page.waitForTimeout(300)
const baseline = await links()
for (let i = 0; i < titles.length; i++) {
  await header(titles[i]).click()
  await page.waitForTimeout(400)
  console.log(`section ${i + 1} "${titles[i]}": ${(await links()) - baseline} reference links`)
  await shotAt(`section-${i + 1}`, header(titles[i]))
  if (i === 1) await shotAt('s2-names-of-god', page.getByText('The notes are taken partly', { exact: false }))
  if (i === 3) {
    await shotAt('s4-kurios-list', page.getByText('All the instances in which the article', { exact: false }))
    await shotAt('s4-kurios-list-end', page.getByText('2 Corinthians', { exact: true }))
    const caller = page.getByRole('button', { name: 'Footnote 2' })
    await caller.click()
    await page.waitForTimeout(400)
    await shotAt('s4-footnote-open', page.getByText('For this reason there are only two tenses', { exact: false }))
    await shotAt('s4-notes', page.getByText('Notes', { exact: true }))
  }
  if (i === 4) {
    await shotAt('s5-headings', header(titles[i]))
    await shotAt('s5-year-table', page.getByText('These considerations enable us', { exact: false }))
  }
  await header(titles[i]).click()
  await page.waitForTimeout(300)
}

// follow a link: John xix. 34 in the 1884 notice lands in John 19 at verse 34
await header(titles[2]).click()
await page.waitForTimeout(400)
const link = page.getByRole('link', { name: 'John xix. 34', exact: true })
await link.scrollIntoViewIfNeeded()
await link.click()
await page.waitForURL(/\/read\/43\/19/, { timeout: 15000 })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}/reader-john-19.png` })
const body = await page.evaluate(() => document.body.innerText)
console.log('landed on', page.url(), '| reader shows verse 34 text:', /forthwith came there out blood and water|blood and water/.test(body))

await browser.close()
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors')
