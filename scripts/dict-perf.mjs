// What dictionary word lookup (every content word tappable) costs in the reader, against a running server: 412x915 at
// 4x CPU throttle, word lookup off vs Strong's vs Dictionary, on John 3 and Psalm 119 (the longest chapter). Per action,
// over the 2.5 s after it: the main thread's blocked time (frame gaps beyond 50 ms, summed) and the worst frame gap;
// plus the DOM span count with the chapter and its two neighbours mounted.
//   switch  More -> Word lookup on (Strong's: the tags arrive and the chapter re-renders with a span per tagged word;
//           Dictionary: the chapter and both neighbours re-render with a span per content word, no request)
//   select  tap a verse number (selection tint + action bar)
//   turn    ArrowRight to the next chapter (the neighbour was laid out in the same mode)
// BASE=http://127.0.0.1:8799 RUNS=3 node scripts/dict-perf.mjs
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const runs = +(process.env.RUNS ?? 3)
const CPU = +(process.env.CPU ?? 4)
const chapters = (process.env.CHAPTERS ?? '43/3,19/119').split(',')
const hook = () => {
  window.__watch = (ms = 2500) => new Promise(res => {
    const t0 = performance.now(); let last = t0, worst = 0
    let block = 0
    const f = () => { const n = performance.now(), gap = n - last; worst = Math.max(worst, gap); if (gap > 50) block += gap - 50; last = n; if (n - t0 < ms) requestAnimationFrame(f); else res({ worst, block }) }
    requestAnimationFrame(f)
  })
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const browser = await chromium.launch()
const MODES = ['off', 'strongs', 'dictionary']
const acc = new Map()
for (let i = 0; i < runs; i++) {
  for (const ch of chapters) {
    for (const mode of MODES) {   // interleaved, so drift on a shared box spreads over all three
      const k = `${ch}|${mode}`
      if (!acc.has(k)) acc.set(k, { switch: [], switchGap: [], select: [], selectGap: [], turn: [], turnGap: [], spans: [] })
      const r = acc.get(k)
      const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
      await ctx.addInitScript(hook)
      await ctx.addInitScript(m => localStorage.setItem('berean_prefs', JSON.stringify({ theme: 'paper', reduceMotion: true, wordLookup: m === 'off' ? 'both' : m })), mode)
      const page = await ctx.newPage()
      const cdp = await ctx.newCDPSession(page)
      await page.goto(`${base}/read/${ch}`, { waitUntil: 'networkidle' })
      await page.waitForSelector('text=/\\w/')
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
      await page.waitForTimeout(3500)   // neighbours are laid out after the page lands
      if (mode !== 'off') {
        await page.getByLabel('More').click(); await page.waitForTimeout(800)
        const w = page.evaluate(() => window.__watch())
        await page.getByRole('switch', { name: 'Word lookup' }).first().click()
        const m = await w; r.switch.push(m.block); r.switchGap.push(m.worst)
        await page.mouse.click(200, 120); await page.waitForTimeout(1200)
      }
      r.spans.push(await page.evaluate(() => document.querySelectorAll('span').length))
      // select: verse 2's number
      const num = page.getByText('2', { exact: true }).filter({ visible: true }).first()
      let w = page.evaluate(() => window.__watch())
      await num.click()
      let m = await w; r.select.push(m.block); r.selectGap.push(m.worst)
      await page.keyboard.press('Escape'); await page.waitForTimeout(1000)
      w = page.evaluate(() => window.__watch())
      await page.keyboard.press('ArrowRight')
      m = await w; r.turn.push(m.block); r.turnGap.push(m.worst)
      await ctx.close()
    }
  }
}
const f = a => a.length ? Math.round(median(a)) : '-'
const rows = [...acc].map(([k, r]) => { const [chapter, mode] = k.split('|'); return { chapter, mode, spans: f(r.spans), 'switch blocked': f(r.switch), 'switch worst': f(r.switchGap), 'select blocked': f(r.select), 'select worst': f(r.selectGap), 'turn blocked': f(r.turn), 'turn worst': f(r.turnGap) } })
console.log(`median of ${runs}, ms at ${CPU}x CPU throttle`)
await browser.close()
console.table(rows)
