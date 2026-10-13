// Cold-cache load timing against a running server: bytes over the wire, TTFB, DCL, load, LCP-ish (first paint).
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const browser = await chromium.launch()
for (const [label, opts] of [['desktop', {}], ['slow-3g-phone', { cpu: 4, net: { downloadThroughput: 400 * 1024 / 8, uploadThroughput: 100 * 1024 / 8, latency: 300 } }]]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  if (opts.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.cpu })
  if (opts.net) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...opts.net })
  let bytes = 0, reqs = 0
  page.on('response', async r => { reqs++; const h = r.headers(); bytes += +(h['content-length'] ?? 0) })
  const t0 = Date.now()
  await page.goto(base + '/read/43/3', { waitUntil: 'commit' })
  await page.waitForSelector('text=Nicodemus', { timeout: 60000 })
  const textAt = Date.now() - t0
  await page.waitForLoadState('load')
  const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const fp = performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint'); return { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: fp ? Math.round(fp.startTime) : null } })
  console.log(JSON.stringify({ label, requests: reqs, wire_kb: Math.round(bytes / 1024), ...nav, scripture_visible_ms: textAt }))
  await ctx.close()
}
await browser.close()
