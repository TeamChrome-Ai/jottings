// Search latency on the web build, Enter to the first result card on screen, timed in the page with performance.now():
// the server (/api/search, fresh browser cache per run) against the on-device index (whole Bible stored).
// The status line is not the mark: it trails the cards by its 90 ms FadeSwap when the answer is ready at once.
// BASE=http://127.0.0.1:8797 node scripts/search-speed.mjs
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const QUERIES = (process.env.QUERIES ?? 'faith|loving-kindness|the lord').split('|')
const RUNS = Number(process.env.RUNS ?? 3)
const browser = await chromium.launch()
const errors = []
const newPage = async ctx => { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); return p }
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/** Types the query, presses Enter, and returns ms from the keydown to the first verse reference on screen. */
async function timeQuery(page, q) {
  const input = page.getByPlaceholder('jn 3:16, or words to find')
  await input.fill('')
  await page.waitForTimeout(250)
  await input.fill(q)
  await page.evaluate(() => {
    window.__done = new Promise(resolve => {
      let t0 = 0
      document.addEventListener('keydown', e => { if (e.key === 'Enter') t0 = performance.now() }, { capture: true, once: true })
      const seen = () => /[A-Z][a-z]+ \d+:\d+|No verses match/.test(document.body.innerText)
      const obs = new MutationObserver(() => { if (t0 && seen()) { obs.disconnect(); resolve(performance.now() - t0) } })
      obs.observe(document.body, { childList: true, subtree: true, characterData: true })
    })
  })
  await input.press('Enter')
  const ms = await page.evaluate(() => window.__done)
  await page.waitForFunction(() => /[\d,]+ verses? · \d+ ms|No verses match/.test(document.body.innerText))
  const status = await page.evaluate(() => (document.body.innerText.match(/[\d,]+ verses? · \d+ ms[^\n]*|No verses match[^\n]*/) ?? [''])[0])
  return { ms, status }
}

// server: a fresh context per run so neither the HTTP cache nor a stored Bible answers
const server = Object.fromEntries(QUERIES.map(q => [q, []]))
const api = Object.fromEntries(QUERIES.map(q => [q, []]))
for (let run = 0; run < RUNS; run++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, serviceWorkers: 'block' })
  const page = await newPage(ctx)
  await page.goto(base + '/search', { waitUntil: 'networkidle' })
  for (const q of QUERIES) {
    const r = await timeQuery(page, q)
    server[q].push(r.ms)
    if (run === 0) console.log(`server  ${q}: ${r.status}`)
    api[q].push(await page.evaluate(async q => { const t = performance.now(); await (await fetch(`/api/search?q=${encodeURIComponent(q)}&scope=all&limit=100&r=${Math.random()}`)).json(); return performance.now() - t }, q))
  }
  await ctx.close()
}

// local: store every chapter once (Settings, "Download whole Bible"), then search in a fresh page load
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, serviceWorkers: 'block' })
const setup = await newPage(ctx)
await setup.goto(base + '/settings', { waitUntil: 'networkidle' })
await setup.getByText('Download whole Bible').click()
await setup.waitForSelector('text=Whole Bible stored offline', { timeout: 180000 })
await setup.close()
const local = Object.fromEntries(QUERIES.map(q => [q, []]))
const first = {}
for (let run = 0; run < RUNS; run++) {
  const page = await newPage(ctx)
  await page.goto(base + '/search', { waitUntil: 'networkidle' })
  // run 0 searches at once, so the first query also waits for the index; later runs let the warm-up finish
  if (run > 0) await page.waitForTimeout(2500)
  for (const [i, q] of QUERIES.entries()) {
    const r = await timeQuery(page, q)
    if (run === 0 && i === 0) first[q] = r.ms
    else local[q].push(r.ms)
    if (run === 0) console.log(`local   ${q}: ${r.status}`)
  }
  await page.close()
}
await ctx.close()

console.log('\nquery              | /api/search fetch | server, Enter to results | local, Enter to results')
for (const q of QUERIES) console.log(`${q.padEnd(18)} | ${median(api[q]).toFixed(0).padStart(14)} ms | ${median(server[q]).toFixed(0).padStart(21)} ms | ${median(local[q]).toFixed(0).padStart(20)} ms`)
for (const [q, ms] of Object.entries(first)) console.log(`first local query right after load (index built on demand), ${q}: ${ms.toFixed(0)} ms`)
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors')
await browser.close()
