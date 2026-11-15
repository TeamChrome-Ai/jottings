import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8790'
const out = process.env.OUT ?? '/tmp/wt-mtext'
mkdirSync(out, { recursive: true })
const W = 412, H = 915
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false, align: 'center', width: 'medium', onboarded: true, toured: true }
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const errors = []
let failed = 0
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failed++ }
// a service worker would answer /api before page.route sees it
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
await ctx.addInitScript(p => { if (!sessionStorage.getItem('primed')) { localStorage.setItem('berean_prefs', p); sessionStorage.setItem('primed', '1') } }, JSON.stringify(prefs))
const page = await ctx.newPage()
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|status of 404|when fetching the script/.test(m.text())) errors.push('console: ' + m.text()) })
const shot = async (name, wait = 700) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name) }
const params = () => Object.fromEntries(new URL(page.url()).searchParams)
const fits = async () => { const w = await page.evaluate(() => document.documentElement.scrollWidth); return { w, ok: w <= W } }
const fitsOk = async state => { const f = await fits(); ok(`nothing wider than the phone ${state} (${f.w} px)`, f.ok) }

const requests = []
const answers = new Map()
const isText = u => new URL(u).pathname.endsWith('/api/ministry/text')
page.on('request', r => { if (isText(r.url())) requests.push(Object.fromEntries(new URL(r.url()).searchParams)) })
page.on('response', async r => { if (isText(r.url()) && r.ok()) { try { answers.set(r.url(), await r.json()) } catch {} } })
const answerFor = (q, more = {}) => [...answers].find(([u]) => { const s = new URL(u).searchParams; return s.get('q') === q && Object.entries(more).every(([k, v]) => s.get(k) === v) })?.[1]

const hits = () => page.getByTestId('text-hit').filter({ visible: true })
const words = () => page.getByTestId('text-hit-words').filter({ visible: true })
const rowTexts = async () => (await hits().allTextContents()).map(s => s.trim())
const waitChange = async (before, ms = 15000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { const now = await rowTexts(); if (now.length && now[0] !== before[0]) return now; await page.waitForTimeout(200) }
  return await rowTexts()
}

await page.goto(base + '/companion', { waitUntil: 'networkidle' })
const input = page.getByPlaceholder('Search by passage, title or words')
await input.waitFor({ timeout: 30000 })
ok('the search names the words in its accessibility label', (await page.getByLabel('Search the ministry by passage, title or words').count()) > 0)

const PHRASE = 'sealed with the Spirit'
await input.pressSequentially(PHRASE, { delay: 60 })
const heading = page.getByText(/^15 paragraphs\b/).filter({ visible: true })
await heading.first().waitFor({ timeout: 20000 })
await page.waitForTimeout(800)
ok(`typing "${PHRASE}" asks the text search once, after typing stops (${JSON.stringify(requests.map(r => r.q))})`, requests.length === 1 && requests[0].q === PHRASE)
ok(`the block is headed "15 paragraphs" (${await heading.first().textContent()})`, await heading.first().isVisible())
const first = (await words().first().textContent())?.trim() ?? ''
ok(`the first row's accent words are the phrase ("${first}")`, first.toLowerCase() === PHRASE.toLowerCase())
ok('no "Nothing for" once there is a paragraph', !(await page.getByText(/^Nothing for/).count()))
await fitsOk('with the paragraphs listed')
await shot('text-sealed')

const sealed = answerFor(PHRASE)
const top = sealed?.items?.[0]
const before = await rowTexts()
await hits().first().click()
await page.waitForTimeout(2500)
const p1 = params()
ok(`a tap opens the reader at that paragraph (${JSON.stringify(p1)})`, !!top && p1.author === top.author && p1.work === top.work.id && p1.n === String(top.n) && p1.p === String(top.para) && !p1.from)
const inView = await page.evaluate(phrase => {
  const re = new RegExp(phrase, 'i')
  const leaves = [...document.querySelectorAll('div, span, p')].filter(el => !el.closest('[data-testid="text-hit"]') && re.test(el.textContent ?? '') && ![...el.children].some(c => re.test(c.textContent ?? '')))
  return leaves.some(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth })
}, PHRASE)
ok('… with a paragraph that has the phrase in view', inView)
await fitsOk('in the reader')
await shot('text-sealed-opened', 300)

await page.goBack()
await page.waitForTimeout(1500)
const back = await rowTexts()
ok(`Back shows the same results (${back.length} rows, input "${await input.inputValue().catch(() => '')}")`, back.length === before.length && back[0] === before[0] && await heading.first().isVisible())

await input.fill('the love of God')
const allChoice = page.getByText(/^All [\d,]+$/).filter({ visible: true })
await allChoice.first().waitFor({ timeout: 20000 })
await page.waitForTimeout(800)
ok('"the love of God" shows the authors to narrow it to', await allChoice.first().isVisible())
await fitsOk('with the authors shown')
await shot('text-love-all')
const love = answerFor('the love of God')
const all = await rowTexts()
const pick = love ? [...love.authors].sort((a, b) => b.total - a.total).find(a => a.id !== love.items[0].author) : null
ok(`a second author has the words (${JSON.stringify(love?.authors)})`, !!pick)
if (pick) {
  const asked = requests.length
  await page.getByRole('radio', { name: `${pick.short} ${pick.total.toLocaleString('en-US')}` }).click()
  const narrowed = await waitChange(all)
  ok(`choosing ${pick.short} asks with author=${pick.id} (${JSON.stringify(requests.slice(asked))})`, requests.slice(asked).some(r => r.author === pick.id && r.q === 'the love of God'))
  ok(`… and lists only ${pick.short}'s paragraphs (${narrowed.length})`, narrowed.length > 0 && narrowed[0] !== all[0] && narrowed.every(s => s.startsWith(`${pick.short} · `)))
  await fitsOk(`narrowed to ${pick.short}`)
  await shot('text-love-author')
  const next = page.getByRole('button', { name: 'Next page' }).filter({ visible: true })
  ok(`${pick.short}'s list has a next page`, (await next.count()) > 0)
  if (await next.count()) {
    const at = requests.length
    await next.first().click()
    const turned = await waitChange(narrowed)
    ok(`Next asks for page=2 (${JSON.stringify(requests.slice(at))})`, requests.slice(at).some(r => r.page === '2' && r.author === pick.id))
    ok(`… and shows other paragraphs (${turned[0]?.slice(0, 60)})`, turned.length > 0 && turned[0] !== narrowed[0] && !turned.some(s => narrowed.includes(s)))
    await fitsOk('on page 2')
    await shot('text-love-page-2')
  }
}

await input.fill('Lords supper')
await page.getByText(/^[\d,]+ paragraphs?\b/).filter({ visible: true }).first().waitFor({ timeout: 20000 })
await page.waitForTimeout(800)
const supper = (await words().allTextContents()).map(s => s.trim())
ok(`"Lords supper" finds "Lord’s supper" (${JSON.stringify(supper.slice(0, 3))})`, supper.some(s => /lord[’']s supper/i.test(s)))
await fitsOk('for "Lords supper"')
await shot('text-lords-supper')

const NOBODY = 'zzqx nothing here'
await page.route('**/api/ministry/text**', r => r.abort())
await input.fill(NOBODY)
const offline = page.getByText('Finding words in the ministry needs a connection to the server.').filter({ visible: true })
await offline.first().waitFor({ timeout: 15000 }).catch(() => {})
await page.waitForTimeout(1200)
ok('without a connection the block says the server is needed', await offline.first().isVisible().catch(() => false))
ok('… and no "Nothing for"', !(await page.getByText(/^Nothing for/).filter({ visible: true }).count()))
await fitsOk('without a connection')
await shot('text-offline')
await page.unroute('**/api/ministry/text**')

await page.route('**/api/ministry/text**', r => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'no such API' }) }))
await page.goto(base + '/companion', { waitUntil: 'networkidle' })
await input.waitFor({ timeout: 30000 })
await input.fill('the love of God')
await page.waitForTimeout(2500)
ok('against a server without the search there is no paragraph block', !(await hits().count()) && !(await page.getByText(/^All [\d,]+$/).count()) && !(await offline.count()))
await fitsOk('against an older server')
await shot('text-unsupported')
await input.fill(NOBODY)
await page.getByText(`Nothing for “${NOBODY}”.`).waitFor({ timeout: 15000 }).then(() => ok('… and a query nobody wrote still ends in "Nothing for …"', true), () => ok('… and a query nobody wrote still ends in "Nothing for …"', false))
await page.unroute('**/api/ministry/text**')

ok(`no page errors (${errors.length})`, errors.length === 0)
if (errors.length) console.log(errors.join('\n'))
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all ok')
process.exit(failed ? 1 : 0)
