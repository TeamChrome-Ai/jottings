// Ministry linked to verses, chapters and the words of a verse, through the API. Genesis 6:2: Darby's Notes and
// Comments on Genesis 6 (vol. 1, "—2. Jude and Peter seem to make the B'ney ha-Elohim (sons of God) the angels") and
// the Synopsis on Genesis 6–8 are on the verse; every verse of Genesis 6 has ministry; "sons of God" finds the
// paragraphs with those words, the ones on the verse first, then the chapter, then the rest. A sample of verses keeps
// what it had: the counts are printed before and after (BEFORE=<file> compares with a saved run, SAVE=<file> saves one).
// Then in a browser at a 412 px phone width (UI=0 skips it): Genesis 6:2 → Ministry → "sons" and "God" picked → the
// Notes and Comments → "Job 38:7" in it opens Ministry on that verse over the reading → a reading deeper → Back, Back;
// then word lookup on: "sons" tapped → the word sheet's "In the ministry" → Ministry on Genesis 6:2 with "sons" picked;
// then Darby's Hints on the book of Genesis: "(v. 1)" → Ministry on Genesis 1:1.
//   BASE=http://127.0.0.1:8851 OUT=/tmp/ministry-links node scripts/ministry-links-check.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8851'
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) process.exitCode = 1 }
const get = async (path) => { const r = await fetch(`${base}/api${path}`); return { status: r.status, body: r.status === 200 ? await r.json() : null } }
const at = (items, work, n) => items.findIndex(i => i.work.id === work && i.n === n)

const gen62 = (await get('/ministry/refs/1/6/2?author=darby')).body.groups[0]
console.log(`Genesis 6:2, Darby: ${gen62.total} paragraphs`)
for (const i of gen62.items.slice(0, 8)) console.log(`  ${i.mention ?? '-'} ${i.work.id} §${i.n} ¶${i.para}: ${i.snippet.slice(0, 90)}`)
ok('Genesis 6:2: Notes and Comments 1, "Genesis 6", on the first page', at(gen62.items, 'notes-comments-1', 22) >= 0)
ok('Genesis 6:2: its paragraph on verse 2 ("—2. Jude and Peter …")', gen62.items.some(i => i.work.id === 'notes-comments-1' && i.n === 22 && i.para === 1))
ok('Genesis 6:2: the Synopsis on Genesis 6–8 on the first page', at(gen62.items, 'genesis', 7) >= 0)

const ch = (await get('/ministry/chapter/1/6')).body
ok(`Genesis 6: every verse has ministry (${ch.verses.length} of 22)`, Array.from({ length: 22 }, (_, k) => k + 1).every(v => ch.verses.includes(v)))

const phrase = await get(`/ministry/refs/1/6/2?author=darby&q=${encodeURIComponent('sons  of God ')}`)
const pg = phrase.body?.groups?.[0]
ok('"sons of God" is read as asked', phrase.body?.q === 'sons of God')
ok(`"sons of God" in Darby: over 100 paragraphs (${pg?.total})`, (pg?.total ?? 0) > 100)
const nears = pg?.items.map(i => i.near) ?? []
console.log(`  near, page 1: ${nears.join(' ')}`)
const NEARS = ['verse', 'chapter', 'book', 'elsewhere']
ok('"sons of God": nearest first', nears.length > 0 && nears.every((x, k) => NEARS.includes(x) && (k === 0 || NEARS.indexOf(nears[k - 1]) <= NEARS.indexOf(x))))
ok('"sons of God": Notes and Comments on Genesis 6 among those on the verse', pg?.items.some(i => i.near === 'verse' && i.work.id === 'notes-comments-1' && i.n === 22))
ok('"sons of God": the Synopsis on Genesis 6–8 among those on the chapter', pg?.items.some(i => i.near === 'chapter' && i.work.id === 'genesis' && i.n === 7))
ok('"sons of God": every snippet shows the words', (pg?.items ?? []).every(i => /^sons\W+of\W+god$/i.test(i.snippet.slice(i.hl[0], i.hl[1]))))
const page2 = (await get(`/ministry/refs/1/6/2?author=darby&page=2&q=${encodeURIComponent('sons of God')}`)).body?.groups?.[0]
ok('"sons of God": a second page', page2?.page === 2 && page2.items.length > 0)
ok('"of the" alone is refused', (await get('/ministry/refs/1/6/2?q=of%20the')).status === 400)
const all = (await get(`/ministry/refs/1/6/2?q=${encodeURIComponent('sons of God')}`)).body
ok('"sons of God" without an author: a group per author that has the words, Darby first', all?.q === 'sons of God' && all.groups[0]?.author === 'darby' && all.groups.every(g => g.total > 0 && g.items.every(i => i.near)))

// a bare "(v. 1)" is in the book and chapter in hand: Darby's Hints on the book of Genesis (Collected Writings 19), its
// first chapter before any other is named, then the one last named; a bare verse closing a quotation of another book
// is that book's (Coates on Ezra 4 quoting Haggai 2, "(verse 8)")
/** The item of an author's list for a verse that `pred` picks, page by page. */
const findItem = async (path, pred) => {
  for (let page = 1; page <= 80; page++) {
    const g = (await get(`${path}&page=${page}`)).body?.groups?.[0]
    const hit = g?.items.find(pred)
    if (hit || !g || page >= g.pages) return hit
  }
}
const hints = (para) => (i) => i.work.id === 'cw-expository-1' && i.n === 2 && i.para === para
for (const [ref, verse, para, said] of [['1/1/1', 'Genesis 1:1', 7, 'The word “created” (v. 1)'], ['1/6/6', 'Genesis 6:6', 136, 'God changes His mind … (v. 6)'], ['1/18/22', 'Genesis 18:22', 223, '“… Abraham stood yet before the Lord” (v. 22)']]) {
  const item = await findItem(`/ministry/refs/${ref}?author=darby`, hints(para))
  ok(`Hints on the book of Genesis, ${said}: on ${verse} (${item?.mention ?? 'not listed'})`, !!item)
}
const haggai = await findItem('/ministry/refs/37/2/8?author=coates', i => i.work.id === 'ezra' && i.n === 4)
ok(`Coates on Ezra 4, “… saith the Lord of hosts” (verse 8): on Haggai 2:8 (${haggai?.mention ?? 'not listed'})`, !!haggai)

// a sample of verses: what each author has, by mention; nothing is lost
const sample = ['43/3/16', '45/8/28', '1/1/26', '1/6/2', '19/22/1', '66/1/5', '40/16/18']
const counts = {}
for (const s of sample) {
  const r = (await get(`/ministry/refs/${s}`)).body
  counts[s] = Object.fromEntries(r.groups.map(g => [g.author, g.total]))
}
console.log('sample', JSON.stringify(counts))
if (process.env.SAVE) writeFileSync(process.env.SAVE, JSON.stringify(counts, null, 1))
if (process.env.BEFORE) {
  const before = JSON.parse(readFileSync(process.env.BEFORE, 'utf8'))
  for (const s of sample) for (const [a, n] of Object.entries(before[s] ?? {})) ok(`${s} ${a}: ${n} → ${counts[s]?.[a] ?? 0}, nothing lost`, (counts[s]?.[a] ?? 0) >= n)
}

if (process.env.UI !== '0') {
  const { chromium } = await import('playwright')
  const out = process.env.OUT ?? '/tmp/ministry-links'
  mkdirSync(out, { recursive: true })
  const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: false, showNotes: true, reduceMotion: process.env.REDUCE === '1', align: 'center', width: 'medium', onboarded: true, toured: true }
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(p => localStorage.setItem('berean_prefs', JSON.stringify(p)), prefs)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|fetching the script/.test(m.text())) errors.push('console: ' + m.text()) })
  const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', `${out}/${name}.png`) }
  const dialog = () => page.getByRole('dialog').last()
  const labels = () => dialog().getByRole('link').evaluateAll(es => es.map(e => e.getAttribute('aria-label') ?? ''))

  await page.goto(`${base}/read/1/6`, { waitUntil: 'networkidle' })
  const verse = page.getByText(/the sons of God saw/).first()
  await verse.waitFor({ timeout: 30000 })
  await verse.click()
  await page.getByRole('button', { name: 'Copy' }).waitFor()
  await page.waitForTimeout(900)
  const ministry = page.getByRole('button', { name: /^Ministry on / })
  ok('Genesis 6:2 selected: the bar offers Ministry', await ministry.isVisible())
  await ministry.click()
  await dialog().getByRole('link').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(900)
  ok('the sheet lists Notes and Comments on Genesis 6, “Jude and Peter …”', (await labels()).some(l => /Notes and Comments/.test(l) && /Jude and Peter/.test(l)))
  ok('the paragraphs on the whole chapter come under “On Genesis 6”', await dialog().getByText('On Genesis 6', { exact: true }).count() > 0)
  await shot('01-genesis-6-2')
  /** Each author's segment not chosen: how much of the accent ink its label shows (0 when right). */
  const segmentsLit = () => dialog().getByRole('radio').evaluateAll(rs => rs.filter(r => r.getAttribute('aria-checked') !== 'true')
    .map(r => { const over = r.querySelector('[aria-hidden="true"]'); return over ? +getComputedStyle(over).opacity : 0 }))

  await dialog().getByText('sons', { exact: true }).first().click()
  await page.waitForTimeout(300)
  await dialog().getByText('God', { exact: true }).first().click()
  await dialog().getByText('Paragraphs with “sons of God”').waitFor({ timeout: 15000 })
  await dialog().getByText('On Genesis 6:2', { exact: true }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(900)
  const found = await labels()
  ok(`“sons of God” picked: the paragraphs with the words (${found.length} on the page), those on the verse first`, found.length > 1 && /sons of God/i.test(found[0]))
  ok('then those on Genesis 6', await dialog().getByText('On Genesis 6', { exact: true }).count() > 0)
  const lit = await segmentsLit()
  ok(`the authors grew from the verse's to the words' (${lit.length + 1}), and only the chosen one is in the accent ink (${lit.join(' ')})`, lit.length > 3 && lit.every(x => x < 0.1))
  await shot('02-sons-of-god')

  await dialog().getByRole('link', { name: /Notes and Comments.*Jude and Peter/ }).first().click()
  await page.waitForURL(/\/companion/, { timeout: 15000 })
  await page.waitForTimeout(1600)
  const at = new URL(page.url())
  ok(`the item opens the reading at its paragraph, the way back to Genesis 6:2 (${at.search})`, at.searchParams.get('p') !== null && at.searchParams.get('from') === '1.6.2')
  await shot('03-notes-and-comments')

  const job = page.getByRole('link', { name: /^Job 38:7$/ }).first()
  await job.scrollIntoViewIfNeeded()
  await job.click()
  const read = dialog().getByRole('button', { name: /^Read Job 38:7/ })
  await read.waitFor({ timeout: 15000 })
  await dialog().getByRole('link').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(900)
  ok('“Job 38:7” in the reading opens Ministry on it over the reading', /\/companion/.test(page.url()))
  await shot('04-job-38-7')

  const deeper = dialog().getByRole('link').first()
  const deeperLabel = await deeper.getAttribute('aria-label')
  await deeper.click()
  await page.waitForTimeout(1800)
  const there = new URL(page.url())
  ok(`an item opens another reading on top, without a way to a verse (${deeperLabel?.slice(0, 60)}…)`, /\/companion/.test(there.pathname) && there.searchParams.get('from') === null && there.search !== at.search)
  await shot('05-a-reading-deeper')

  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.waitForTimeout(1500)
  ok('Back returns to Notes and Comments', new URL(page.url()).search === at.search && await page.getByText(/Jude and Peter/).first().isVisible())
  await page.getByRole('button', { name: /^Back to the verse/ }).first().click()
  await page.waitForURL(/\/read\/1\/6/, { timeout: 15000 })
  await page.waitForTimeout(1200)
  ok('and from there, back to Genesis 6:2', /\/read\/1\/6/.test(page.url()))
  await shot('06-home')

  await page.getByRole('button', { name: 'More' }).click()
  await dialog().getByText('Word lookup', { exact: true }).click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /^sons, Strong’s/ }).first().click()
  const part = dialog().getByTestId('word-ministry')
  await part.waitFor({ timeout: 15000 })
  await part.scrollIntoViewIfNeeded()
  const said = await part.innerText()
  ok('word lookup, “sons”: the word sheet has In the ministry, on Genesis 6:2 first', /^In the ministry\nOn Genesis 6:2\n/.test(said))
  ok(`at most three of Darby’s paragraphs, and the count (${said.split('\n').find(l => / uses it in /.test(l))})`, await part.getByRole('link').count() <= 3 && /Darby uses it in \d[\d,]* paragraphs?\./.test(said))
  await shot('07-word-sheet-sons')
  await part.getByRole('button', { name: 'Ministry on Genesis 6:2' }).click()
  await dialog().getByText('Paragraphs with “sons”').waitFor({ timeout: 15000 })
  await page.waitForTimeout(900)
  ok('Ministry on Genesis 6:2: the Ministry sheet alone, with “sons” picked', await page.getByRole('dialog').count() === 1)
  await shot('08-ministry-sheet-sons')

  // Hints on the book of Genesis: "(v. 1)" is a link to Genesis 1:1, and opens Ministry on it over the reading
  await page.goto(`${base}/companion?author=darby&work=cw-expository-1&n=2&p=7`, { waitUntil: 'networkidle' })
  const v1 = page.getByRole('link', { name: 'v. 1', exact: true }).first()
  await v1.waitFor({ timeout: 30000 })
  await v1.scrollIntoViewIfNeeded()
  await shot('09-hints-on-genesis')
  await v1.click()
  await dialog().getByRole('button', { name: /^Read Genesis 1:1$/ }).waitFor({ timeout: 15000 })
  await dialog().getByRole('link').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(900)
  ok('Hints on the book of Genesis: “(v. 1)” opens Ministry on Genesis 1:1 over the reading', /\/companion/.test(page.url()))
  await shot('10-hints-v-1-sheet')

  ok(`no page errors${errors.length ? ': ' + errors.join(' / ') : ''}`, errors.length === 0)
  await browser.close()
}
