// Paged mode timings against a running server, 390x844 at 4x CPU throttle (a phone-class main thread):
//   open    goto /flip/19/119 (Psalm 119, the longest chapter) -> page count in the HUD -> next frame
//   inapp   /read/19/119 -> More -> Paged mode (click) -> page count in the HUD -> next frame
//   theme   click a theme swatch -> scripture colour changed -> next frame; main-thread long tasks after the click
//   turn    ArrowRight -> progress bar moved (the turn committed) -> next frame, which includes the 240 ms slide;
//           worst frame gap while it runs
// BASE=http://127.0.0.1:8796 RUNS=3 node scripts/flip-perf.mjs
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8796'
const runs = +(process.env.RUNS ?? 3)
const CPU = +(process.env.CPU ?? 4)

// records when the HUD first reads "page N of" (text-node mutations only: cheap whatever the DOM size)
const hook = () => {
  window.__pageAt = {}
  window.__longTasks = []
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__longTasks.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true })
  const seen = s => {
    const m = /page (\d+) of (\d+)/.exec(s ?? '')
    if (!m || window.__pageAt[m[1]]) return
    const hit = { t: performance.now(), n: +m[2] }
    window.__pageAt[m[1]] = hit
    requestAnimationFrame(() => { hit.painted = performance.now() })
  }
  const start = () => new MutationObserver(recs => {
    for (const r of recs) {
      if (r.type === 'characterData') seen(r.target.data)
      else for (const n of r.addedNodes) if (n.nodeType === 3) seen(n.data); else if (n.nodeType === 1 && n.childElementCount < 8) seen(n.textContent)
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true })
  if (document.documentElement) start(); else addEventListener('DOMContentLoaded', start)
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const browser = await chromium.launch()
const out = { open: [], inapp: [], turn: [], turnGap: [], theme: [], themeBlock: [], pages: 0 }
for (let r = 0; r < runs; r++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await ctx.addInitScript(hook)
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })

  // warm the bundle and the chapter, then a clean open
  await page.goto(base + '/flip/19/119?v=1')
  await page.waitForFunction(() => window.__pageAt['1']?.painted, null, { timeout: 120000 })
  await page.goto(base + '/flip/19/119?v=1')
  await page.waitForFunction(() => window.__pageAt['1']?.painted, null, { timeout: 120000 })
  const o = await page.evaluate(() => window.__pageAt['1'])
  out.open.push(o.painted); out.pages = o.n
  await page.waitForTimeout(3500)

  // theme change from the paged-mode settings sheet
  await page.mouse.click(195, 500)   // centre tap: the HUD
  await page.waitForTimeout(600)
  await page.getByLabel('Reading settings').first().click()
  await page.waitForTimeout(800)
  const swatch = page.getByLabel('Midnight theme').first()
  await swatch.scrollIntoViewIfNeeded()
  await page.evaluate(() => {
    const spans = [...document.querySelectorAll('span')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.data.includes('Blessed')))
    window.__probe = spans.find(e => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden') ?? null
    window.__probeColor = window.__probe && getComputedStyle(window.__probe).color
    window.__down = 0
    addEventListener('pointerdown', () => { window.__down = performance.now() }, { capture: true, once: true })
  })
  await swatch.click()
  const th = await page.evaluate(async () => {
    const t0 = window.__down, deadline = t0 + 10000
    while (performance.now() < deadline && window.__probe && getComputedStyle(window.__probe).color === window.__probeColor) await new Promise(r => requestAnimationFrame(r))
    await new Promise(r => requestAnimationFrame(r))
    const t1 = performance.now()
    await new Promise(r => setTimeout(r, 600))
    const block = window.__longTasks.filter(([s]) => s >= t0 - 5).reduce((a, [, d]) => a + d, 0)
    return { ms: t1 - t0, block, probe: !!window.__probe }
  })
  if (!th.probe) console.error('theme probe missing')
  out.theme.push(th.ms); out.themeBlock.push(th.block)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1200)

  // page turn by key; the progress bar is the one inline percentage width on the screen
  const turn = await page.evaluate(async () => {
    const bar = [...document.querySelectorAll('div')].find(e => /width: [0-9.]+%/.test(e.getAttribute('style') ?? ''))
    const w0 = bar.style.width
    const gaps = []; let last = performance.now(), on = true
    const tick = () => { const n = performance.now(); gaps.push(n - last); last = n; if (on) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    const t0 = performance.now()
    dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    const deadline = t0 + 10000
    while (bar.style.width === w0 && performance.now() < deadline) await new Promise(r => requestAnimationFrame(r))
    await new Promise(r => requestAnimationFrame(r))
    const ms = performance.now() - t0
    on = false
    return { ms: bar.style.width === w0 ? NaN : ms, gap: Math.max(...gaps) }
  })
  out.turn.push(turn.ms); out.turnGap.push(turn.gap)

  // in-app: from the scrolling reader, More -> Paged mode
  await page.goto(base + '/read/19/119')
  await page.getByText('Blessed are', { exact: false }).first().waitFor({ timeout: 120000 })
  await page.waitForTimeout(1500)
  await page.getByLabel('More').first().click()
  await page.waitForTimeout(700)
  await page.evaluate(() => { window.__pageAt = {}; window.__down = 0; addEventListener('pointerdown', () => { window.__down = performance.now() }, { capture: true, once: true }) })
  await page.getByText('Paged mode', { exact: true }).first().click()
  await page.waitForFunction(() => Object.values(window.__pageAt)[0]?.painted, null, { timeout: 120000 })
  out.inapp.push(await page.evaluate(() => Object.values(window.__pageAt)[0].painted - window.__down))
  await ctx.close()
}
await browser.close()
const f = a => a.map(x => Math.round(x))
console.log(JSON.stringify({
  cpu: CPU, pages: out.pages, open_ms: f(out.open), inapp_ms: f(out.inapp), theme_ms: f(out.theme), theme_longtask_ms: f(out.themeBlock), turn_ms: f(out.turn), turn_worst_frame_ms: f(out.turnGap),
  median: { open: Math.round(median(out.open)), inapp: Math.round(median(out.inapp)), theme: Math.round(median(out.theme)), themeBlock: Math.round(median(out.themeBlock)), turn: Math.round(median(out.turn)), turnFrame: Math.round(median(out.turnGap)) },
}))
