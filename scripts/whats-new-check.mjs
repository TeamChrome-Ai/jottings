// The news of an update (components/WhatsNew.tsx) against a web build, at 412 px: ten lanes, each printed as ok or FAIL.
//
//   node scripts/whats-new-check.mjs          the ten lanes; exit 1 if any fails
//   node scripts/whats-new-check.mjs perf     the entry chunk's bytes and the time to Home, trunk against head
//   node scripts/whats-new-check.mjs serve DIR [PORT]   the static server alone, over one build
//
// HEAD_DIST = the build under test (client/dist); TRUNK_DIST = a build of the commit it is stacked on (lane 1 and perf);
// OUT = where the screenshots, update.webm and perf.json go; LANES=2,5 runs only those.
// The builds are served from here: the scenes need no API, and every /api call is answered 404.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, gzipSync } from 'node:zlib'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const HEAD = resolve(process.env.HEAD_DIST ?? join(ROOT, 'client/dist'))
const TRUNK = process.env.TRUNK_DIST ? resolve(process.env.TRUNK_DIST) : null
const out = process.env.OUT ?? '/tmp/swarm-v2-25'
const VERSION = '2.0'

// ---------- a static server over one build: the app's shell for every route, precompressed files where there are any ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }
function serve(dir, port = 0) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (path.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"no API in this check"}'); return }
    let file = normalize(join(dir, path))
    if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return }
    const isFile = f => existsSync(f) && statSync(f).isFile()
    // a route of the app, not a file: the shell, which the router takes from there
    if (!isFile(file)) { if (extname(path)) { res.writeHead(404); res.end(); return } file = join(dir, 'index.html') }
    const hashed = path.startsWith('/_expo/')
    const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' }
    if (/\bbr\b/.test(req.headers['accept-encoding'] ?? '') && isFile(file + '.br')) { file += '.br'; headers['content-encoding'] = 'br' }
    const body = readFileSync(file)
    res.writeHead(200, { ...headers, 'content-length': body.length })
    res.end(body)
  })
  return new Promise(done => server.listen(port, '127.0.0.1', () => done({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })))
}

const [mode = 'lanes', ...args] = process.argv.slice(2)
if (mode === 'serve') {
  const s = await serve(resolve(args[0] ?? HEAD), Number(args[1] ?? 8793))
  console.log(s.base)
  await new Promise(() => {})
}

mkdirSync(`${out}/video`, { recursive: true })
const browser = await chromium.launch()
const VIEW = { width: 412, height: 915 }
const FULL = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false, align: 'center', width: 'medium', readerName: '' }
/** Someone who was reading before the update: the welcome and the tour seen, no news seen. */
const READER = { ...FULL, onboarded: true, toured: true }
const errors = []

/** A phone with `prefs` stored before the app first loads; `window.__news` logs what the overlay shows, as it changes. */
async function phone({ prefs = null, video = false, view = VIEW, sw = false } = {}) {
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: sw ? 'allow' : 'block', ...(video ? { recordVideo: { dir: `${out}/video`, size: view } } : {}) })
  if (prefs) await ctx.addInitScript(p => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('berean_prefs', JSON.stringify(p)); sessionStorage.setItem('seeded', '1') } }, prefs)
  await ctx.addInitScript(() => {
    const log = window.__news = []
    const seen = sel => { const el = document.querySelector(sel); return !!el && +getComputedStyle(el).opacity > 0.5 }
    setInterval(() => {
      let now = 'none'
      if (document.querySelector('[data-testid="whats-new"]')) {
        now = 'blank'
        for (const k of [0, 1, 2]) if (seen(`[data-testid="news-scene-${k}"]`)) now = `scene-${k + 1}`
        if (seen('[data-testid="news-close"]')) now = 'close'
      }
      if (!log.length || log[log.length - 1].s !== now) log.push({ s: now, t: performance.now() })
    }, 30)
  })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  return { ctx, page }
}
const newsLog = page => page.evaluate(() => window.__news)
const showing = async page => { const l = await newsLog(page); return l[l.length - 1].s }
const until = (page, s, ms = 20000) => page.waitForFunction(x => window.__news.some(e => e.s === x), s, { timeout: ms, polling: 50 }).then(() => true, () => false)
/** The overlay has been up and is gone. */
const untilGone = (page, ms = 40000) => page.waitForFunction(() => { const l = window.__news; return l.some(e => e.s !== 'none') && l[l.length - 1].s === 'none' }, null, { timeout: ms, polling: 50 }).then(() => true, () => false)
/** What played, in order, and how long the overlay was up. */
async function played(page) {
  const l = await newsLog(page)
  const order = l.map(e => e.s).filter(s => s !== 'blank' && s !== 'none').filter((s, i, a) => s !== a[i - 1])
  const up = l.find(e => e.s !== 'none'), down = [...l].reverse().find(e => e.s === 'none')
  return { order: order.join(' '), ms: up && down ? Math.round(down.t - up.t) : -1 }
}
/** Never up in the next `ms`, nor at any time since the page loaded. */
async function neverUp(page, ms = 2500) { await page.waitForTimeout(ms); return (await newsLog(page)).every(e => e.s === 'none') }
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('berean_prefs') ?? 'null'))
const skipNews = page => page.getByRole('button', { name: 'Skip what is new' })
const skipWelcome = page => page.getByRole('button', { name: 'Skip the welcome' })
const home = page => page.getByRole('heading', { name: 'Library', exact: true }).first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` })
/** Everything scene `k` says, as one string (the typed question is a view a letter, with hard spaces between words). */
const sceneText = (page, k) => page.evaluate(k => document.querySelector(`[data-testid="news-scene-${k - 1}"]`).textContent.replace(/ /g, ' '), k)
/** The search of the library scene 1 shows (lib/whatsNew.ts ASK): the question, and each wording with its count after it. */
const QUESTION = 'how can I be sure I am saved'
const FOUND = ['assurance of salvation33', 'the witness of the Spirit60', 'the new birth299']
/** Where scene `k`'s block (title, body, vignette) sits in the space between the skip pill and the dots. */
const placed = (page, k) => page.evaluate(k => {
  const rect = sel => document.querySelector(sel).getBoundingClientRect()
  const block = rect(`[data-testid="news-block-${k - 1}"]`), pill = rect('[data-testid="whats-new"] [role="button"]'), dots = rect('[data-testid="news-dots"]')
  return { top: block.top, bottom: block.bottom, from: pill.bottom, to: dots.top, off: (block.top + block.bottom) / 2 - (pill.bottom + dots.top) / 2 }
}, k)
const centred = p => Math.abs(p.off) <= 1.5 && p.top >= p.from && p.bottom <= p.to
const where = p => `${Math.round(p.top)} to ${Math.round(p.bottom)} in ${Math.round(p.from)} to ${Math.round(p.to)}, ${p.off.toFixed(1)} px off the middle`
const NARROW = { width: 360, height: 740 }, TABLET = { width: 820, height: 1180 }
const ALL = 'scene-1 scene-2 scene-3 close'

const results = []
const only = process.env.LANES ? new Set(process.env.LANES.split(',').map(Number)) : null
/** One lane: `run` returns its checks as [label, ok] pairs; the lane passes when all do. */
async function lane(n, title, run) {
  if (only && !only.has(n)) return
  let checks
  try { checks = await run() } catch (e) { checks = [[`threw: ${String(e?.message ?? e).split('\n')[0]}`, false]] }
  for (const [label, ok] of checks) console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`)
  const pass = checks.length > 0 && checks.every(c => c[1])
  results.push({ lane: n, title, pass })
  console.log(`${pass ? 'ok  ' : 'FAIL'} lane ${n}: ${title}`)
}
const run = (cmd, argv, env) => new Promise(done => {
  const p = spawn(cmd, argv, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let text = ''
  p.stdout.on('data', d => { text += d }); p.stderr.on('data', d => { text += d })
  p.on('close', code => done({ code, text }))
})

// ---------- perf: the entry chunk and the time to Home, for a reader who has seen the news ----------
/** The entry chunk: the scripts the page itself names (Metro's runtime, the code routes share, and the app's own
 *  start), which every visitor loads before anything shows. */
function entryOf(dist) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const files = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map(m => m[1])
  const bodies = files.map(f => readFileSync(join(dist, f)))
  const sum = f => bodies.reduce((n, b) => n + f(b), 0)
  return { files: files.map((f, i) => ({ file: f.split('/').pop(), bytes: bodies[i].length })), bytes: sum(b => b.length), gzip: sum(b => gzipSync(b).length), br: sum(b => brotliCompressSync(b).length), hasScenes: bodies.some(b => b.includes('news-scene-')) }
}
/** The lazy chunk that holds the scenes, if the build has one (with the welcome: components/Openings.ts). */
function scenesChunk(dist) {
  const dir = join(dist, '_expo/static/js/web')
  for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) { const b = readFileSync(join(dir, f)); if (b.includes('news-scene-')) return { file: f, bytes: b.length } }
  return null
}
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
if (mode === 'perf') {
  if (!TRUNK) throw new Error('perf needs TRUNK_DIST')
  const trunk = await serve(TRUNK), head = await serve(HEAD)
  const builds = [['trunk', trunk.base], ['head', head.base]]
  const report = { entry: { trunk: entryOf(TRUNK), head: entryOf(HEAD) }, scenes: scenesChunk(HEAD), home: {}, perfMjs: {} }
  report.entry.growth = report.entry.head.bytes - report.entry.trunk.bytes
  // Home's Library heading on screen, ms from the start of the navigation, on a cold cache; the builds take turns so
  // that whatever else the machine is doing falls on both alike
  const RUNS = Number(process.env.RUNS ?? 21)
  for (const [profile, rate] of [['desktop', 1], ['cpu-4x', 4]]) {
    const ms = { trunk: [], head: [] }
    for (let i = 0; i < RUNS; i++) for (const [name, base] of i % 2 ? [...builds].reverse() : builds) {
      const ctx = await browser.newContext({ viewport: VIEW, isMobile: true, serviceWorkers: 'block' })
      await ctx.addInitScript(p => {
        localStorage.setItem('berean_prefs', JSON.stringify(p))
        const look = () => { if ([...document.querySelectorAll('[role="heading"]')].some(h => h.textContent === 'Library')) window.__home = performance.now(); else requestAnimationFrame(look) }
        requestAnimationFrame(look)
      }, { ...READER, seenNew: VERSION })
      const page = await ctx.newPage()
      if (rate > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate }) }
      await page.goto(base + '/', { waitUntil: 'commit' })
      await page.waitForFunction(() => window.__home > 0, null, { timeout: 60000 })
      ms[name].push(Math.round(await page.evaluate(() => window.__home)))
      await ctx.close()
    }
    const t = median(ms.trunk), h = median(ms.head)
    report.home[profile] = { runs: RUNS, trunk: t, head: h, changePct: +((h - t) / t * 100).toFixed(2), trunkMin: Math.min(...ms.trunk), headMin: Math.min(...ms.head), all: ms }
  }
  // scripts/perf.mjs at both (a chapter on a cold cache), three times each, the middle run kept
  for (const [name, base] of builds) {
    const runs = []
    for (let i = 0; i < 3; i++) { const r = await run(process.execPath, ['scripts/perf.mjs'], { BASE: base }); runs.push(r.text.trim().split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l))) }
    report.perfMjs[name] = ['desktop', 'slow-3g-phone'].map(label => { const rows = runs.map(r => r.find(x => x.label === label)).filter(Boolean); return { label, wire_kb: rows[0]?.wire_kb, requests: rows[0]?.requests, scripture_visible_ms: median(rows.map(x => x.scripture_visible_ms)), load: median(rows.map(x => x.load)) } })
  }
  const rule = { entryGrowthMax: 2048, timeGrowthMaxPct: 3 }
  report.pass = { entry: report.entry.growth <= rule.entryGrowthMax, lazy: !report.entry.head.hasScenes && !!report.scenes, time: Object.values(report.home).every(p => p.changePct <= rule.timeGrowthMaxPct) }
  writeFileSync(`${out}/perf.json`, JSON.stringify(report, null, 1))
  const e = report.entry
  console.log(`entry chunk: trunk ${e.trunk.bytes} B (gzip ${e.trunk.gzip}, br ${e.trunk.br}), head ${e.head.bytes} B (gzip ${e.head.gzip}, br ${e.head.br}): ${e.growth >= 0 ? '+' : ''}${e.growth} B`)
  console.log(`scenes: ${report.scenes ? `${report.scenes.file}, ${report.scenes.bytes} B, a chunk of its own` : 'no chunk found'}; in the entry chunk: ${e.head.hasScenes}`)
  for (const [profile, p] of Object.entries(report.home)) console.log(`time to Home, ${profile}: trunk ${p.trunk} ms, head ${p.head} ms (median of ${p.runs}): ${p.changePct >= 0 ? '+' : ''}${p.changePct} %`)
  for (const [name, rows] of Object.entries(report.perfMjs)) for (const r of rows) console.log(`perf.mjs ${name} ${r.label}: ${r.requests} requests, ${r.wire_kb} KB, scripture visible ${r.scripture_visible_ms} ms, load ${r.load} ms`)
  for (const [k, ok] of Object.entries(report.pass)) console.log(`${ok ? 'ok  ' : 'FAIL'} perf ${k}`)
  if (!Object.values(report.pass).every(Boolean)) process.exitCode = 1
  await browser.close(); trunk.close(); head.close()
  process.exit()
}

const head = await serve(HEAD)
const base = head.base

// ---------- lane 1: the welcome is as it was, and a new install sees it and no news ----------
await lane(1, 'the welcome at trunk and head; a new install sees the welcome and no news', async () => {
  const checks = []
  if (!TRUNK) return [['TRUNK_DIST is set (a build of the commit this is stacked on)', false]]
  const trunk = await serve(TRUNK)
  for (const [name, at] of [['trunk', trunk.base], ['head', base]]) {
    const r = await run(process.execPath, ['scripts/welcome-check.mjs'], { BASE: at, OUT: `${out}/welcome-${name}` })
    writeFileSync(`${out}/welcome-${name}.log`, r.text)
    const lines = r.text.split('\n')
    checks.push([`scripts/welcome-check.mjs at ${name}: exit ${r.code}, ${lines.filter(l => l.startsWith('ok  ')).length} ok, ${lines.filter(l => l.startsWith('FAIL')).length} FAIL`, r.code === 0])
  }
  trunk.close()
  const { ctx, page } = await phone()
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  checks.push(['a new install at head sees the welcome', await skipWelcome(page).waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)])
  const p = await stored(page)
  checks.push([`the welcome marks the version seen as it starts (seenNew ${JSON.stringify(p?.seenNew)})`, p?.onboarded === true && p?.seenNew === VERSION])
  await page.waitForTimeout(6000)
  await shot(page, 'welcome-check')
  await skipWelcome(page).click()
  checks.push(['the welcome closes onto Home', await home(page)])
  checks.push(['and no news in that launch', await neverUp(page)])
  await page.reload({ waitUntil: 'domcontentloaded' })
  checks.push(['the next launch shows Home', await home(page)])
  checks.push(['with no welcome and no news', await neverUp(page) && !(await skipWelcome(page).isVisible().catch(() => false))])
  await ctx.close()
  return checks
})

// ---------- lanes 2 and 3: the first open after the update, filmed; then a reload ----------
let lane3 = null
await lane(2, 'an onboarded reader with no seenNew: three scenes in order, then Home', async () => {
  const checks = []
  const { ctx, page } = await phone({ prefs: READER, video: true })
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  checks.push(['the news shows, with Skip from the start', await skipNews(page).waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)])
  // each scene near its end, when all of it has arrived
  for (const [k, ms] of [[1, 3000], [2, 3350], [3, 2450]]) {
    checks.push([`scene ${k} shows`, await until(page, `scene-${k}`)])
    if (k === 1) checks.push([`the version is stored as seen before the scenes have run (seenNew ${JSON.stringify((await stored(page))?.seenNew)})`, (await stored(page))?.seenNew === VERSION])
    await page.waitForTimeout(ms)
    const p = await placed(page, k), text = await sceneText(page, k)
    checks.push([`scene ${k} is centred between Skip and the dots (${where(p)})`, centred(p)])
    if (k === 1) checks.push(['scene 1 shows the real search: the question, 1 John 5:13 and John 5:24, and each wording with its count', [QUESTION, '1 John 5:1333', 'John 5:2471', ...FOUND].every(s => text.includes(s))])
    if (k === 2) checks.push(['scene 2 answers the same question', text.includes(QUESTION)])
    await shot(page, `scene-${k}`)
  }
  checks.push(['the closing line shows', await until(page, 'close')])
  await page.waitForTimeout(450)
  await shot(page, 'closing')
  checks.push(['the overlay goes', await untilGone(page)])
  const p = await played(page)
  checks.push([`the scenes played in order: ${p.order}`, p.order === ALL])
  checks.push([`in about twelve seconds (${p.ms} ms)`, p.ms > 11000 && p.ms < 14000])
  checks.push(['Home returns', await home(page)])
  await page.waitForTimeout(3000)
  await shot(page, 'home')
  // lane 3 is this same page reloaded; it reports under its own number
  await page.reload({ waitUntil: 'domcontentloaded' })
  const atOnce = await home(page)
  const none = await neverUp(page)
  await shot(page, 'second-launch')
  lane3 = [['after a reload Home shows', atOnce], ['and the news is never up', none], [`seenNew is still ${VERSION}`, (await stored(page))?.seenNew === VERSION]]
  const video = page.video()
  await ctx.close()
  renameSync(await video.path(), `${out}/update.webm`)
  checks.push(['update.webm saved', existsSync(`${out}/update.webm`)])
  // the same in a dark theme, at 360 px and at a tablet's width: in order, and each scene's block centred
  const looks = [['dark', VIEW, 'slate'], ['narrow', NARROW, 'paper'], ['narrow-dark', NARROW, 'slate'], ['tablet', TABLET, 'paper'], ['tablet-dark', TABLET, 'slate']]
  checks.push(...(await Promise.all(looks.map(async ([name, view, theme]) => {
    const x = await phone({ prefs: { ...READER, theme }, view })
    await x.page.goto(base + '/', { waitUntil: 'domcontentloaded' })
    const at = []
    for (const [k, ms] of [[1, 3000], [2, 3350], [3, 2450]]) { await until(x.page, `scene-${k}`); await x.page.waitForTimeout(ms); at.push(await placed(x.page, k)); await shot(x.page, `${name}-scene-${k}`) }
    await untilGone(x.page)
    const d = await played(x.page)
    await x.ctx.close()
    return [[`${name} (${view.width} px, ${theme}): ${d.order}`, d.order === ALL], [`${name}: each scene centred (${at.map(p => p.off.toFixed(1)).join(', ')} px off the middle)`, at.every(centred)]]
  }))).flat())
  return checks
})
await lane(3, 'a reload shows Home at once', async () => lane3 ?? [['lane 2 ran first (this lane reloads its page)', false]])

// ---------- lane 4: the ways out ----------
await lane(4, 'Skip in scene 1 and Escape in scene 2 close it, and neither replays on reload', async () => {
  const checks = []
  for (const [how, scene] of [['Skip', 1], ['Escape', 2]]) {
    const { ctx, page } = await phone({ prefs: READER })
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
    await until(page, `scene-${scene}`)
    await page.waitForTimeout(900)
    const t = Date.now()
    if (how === 'Skip') await skipNews(page).click(); else await page.keyboard.press('Escape')
    const gone = await untilGone(page, 2000)
    checks.push([`${how} in scene ${scene} closes it (${Date.now() - t} ms)`, gone && (await played(page)).order === (scene === 1 ? 'scene-1' : 'scene-1 scene-2')])
    checks.push(['onto Home', await home(page)])
    if (how === 'Skip') { await page.waitForTimeout(400); await shot(page, 'skip') }
    await page.reload({ waitUntil: 'domcontentloaded' })
    checks.push([`after ${how}, a reload shows Home and no news`, await home(page) && await neverUp(page)])
    await ctx.close()
  }
  // a tap is not a way out: it moves on to the next scene
  const { ctx, page } = await phone({ prefs: READER })
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await until(page, 'scene-1')
  await page.waitForTimeout(700)
  await page.locator('[data-testid="whats-new"]').tap({ position: { x: 200, y: 640 } })
  checks.push(['a tap in scene 1 moves on to scene 2', await until(page, 'scene-2', 900)])
  await page.waitForTimeout(500)
  await page.locator('[data-testid="whats-new"]').tap({ position: { x: 200, y: 640 } })
  checks.push(['and a tap in scene 2 to scene 3', await until(page, 'scene-3', 900)])
  await untilGone(page)
  checks.push([`the rest plays out: ${(await played(page)).order}`, (await played(page)).order === ALL])
  await ctx.close()
  return checks
})

// ---------- lane 5: Reduce animation ----------
await lane(5, 'Reduce animation: still pages, each until tapped or its time runs out', async () => {
  const checks = []
  const { ctx, page } = await phone({ prefs: { ...READER, reduceMotion: true } })
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  checks.push(['the first page shows', await until(page, 'scene-1')])
  const t0 = Date.now()
  // every part of the overlay, where it is and how much of it shows
  const frame = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="whats-new"] *')].map(el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return `${s.opacity}|${s.transform}|${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}` }).join(';'))
  await page.waitForTimeout(700)
  const a = await frame()
  await page.waitForTimeout(900)
  const b = await frame()
  checks.push([`the page is still: nothing moved or faded in 900 ms (${a.split(';').length} parts)`, a === b && a.length > 0])
  const texts = await page.evaluate(() => document.querySelector('[data-testid="news-scene-0"]').innerText)
  checks.push(['all of scene 1 is there at once', ['Ask in your own words.', 'Verses', 'Related subjects', 'the new birth'].every(s => texts.includes(s))])
  await shot(page, 'still')
  await page.waitForTimeout(Math.max(0, 3500 - (Date.now() - t0)))
  checks.push(['untapped, it stays 3.5 s', await showing(page) === 'scene-1'])
  checks.push(['and gives way to the second when its time runs out', await until(page, 'scene-2', 1800)])
  const second = (await newsLog(page)).find(e => e.s === 'scene-2').t
  await page.waitForTimeout(800)
  await page.locator('[data-testid="whats-new"]').tap({ position: { x: 200, y: 640 } })
  const third = await until(page, 'scene-3', 1500)
  const dt = third ? Math.round((await newsLog(page)).find(e => e.s === 'scene-3').t - second) : -1
  checks.push([`a tap moves to the third before the second's time is out (${dt} ms)`, third && dt < 2500])
  await page.waitForTimeout(600)
  const c1 = await frame()
  await page.waitForTimeout(700)
  checks.push(['the third page is still too', c1 === await frame()])
  await shot(page, 'still-3')
  checks.push(['its time runs out and Home returns', await untilGone(page, 6000) && await home(page)])
  checks.push([`no closing flourish: ${(await played(page)).order}`, (await played(page)).order === 'scene-1 scene-2 scene-3'])
  await ctx.close()
  return checks
})

// ---------- lane 6: a shared link ----------
await lane(6, 'a shared link shows its page; the news waits for a launch on Home', async () => {
  const checks = []
  const { ctx, page } = await phone({ prefs: READER })
  await page.goto(base + '/read/43/3', { waitUntil: 'domcontentloaded' })
  checks.push(['the link’s chapter shows (John 3)', await page.getByText('Nicodemus').first().waitFor({ timeout: 20000 }).then(() => true, () => false)])
  checks.push(['with no news over it', await neverUp(page, 3000)])
  await shot(page, 'shared-link')
  checks.push([`nothing is marked seen (seenNew ${JSON.stringify((await stored(page))?.seenNew)})`, (await stored(page))?.seenNew !== VERSION])
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  checks.push(['the next launch, on Home, tells it', await until(page, 'scene-1')])
  await ctx.close()
  return checks
})

// ---------- lane 7: again from Settings ----------
await lane(7, 'Settings plays it again and leaves seenNew as it was', async () => {
  const checks = []
  // launched on Settings, so this launch tells no news and marks none: whatever the replay stored would show
  const { ctx, page } = await phone({ prefs: READER })
  await page.goto(base + '/settings', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'About', exact: true }).click()
  const row = page.getByRole('button', { name: 'Welcome and tour' })
  await row.waitFor(); await row.click(); await page.waitForTimeout(700)
  await shot(page, 'again-row')
  // a record saved before the pref existed has no such field: that and '' are both "none seen"
  const before = (await stored(page))?.seenNew ?? ''
  await page.getByRole('dialog').getByRole('button', { name: 'What is new', exact: true }).click()
  checks.push(['What is new, in Welcome and tour, plays it', await until(page, 'scene-1', 5000)])
  await page.waitForTimeout(3000)
  await shot(page, 'again')
  checks.push(['to the end', await untilGone(page)])
  checks.push([`in order: ${(await played(page)).order}`, (await played(page)).order === ALL])
  const after = (await stored(page))?.seenNew ?? ''
  checks.push([`seenNew is unchanged (${JSON.stringify(before)} before, ${JSON.stringify(after)} after)`, before === after && after !== VERSION])
  await ctx.close()
  return checks
})

// ---------- lane 8: French and German at 360 ----------
await lane(8, 'French and German at 360 px: no title or body cut off or overlapping', async () => {
  const checks = []
  const items = [['Ask in your own words.', 'A plain question finds verses, phrases and related subjects.'], ['Answers from the library.', 'Each sentence is marked with the paragraph it rests on.'], ['It can lend a hand.', 'Ask for a change, such as larger text. Undo puts it back.']]
  for (const lang of ['fr', 'de']) {
    const cat = JSON.parse(readFileSync(join(ROOT, `client/src/i18n/${lang}.json`), 'utf8'))
    const { ctx, page } = await phone({ prefs: { ...READER, lang }, view: NARROW })
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
    for (const k of [1, 2, 3]) {
      if (!(await until(page, `scene-${k}`))) { checks.push([`${lang} scene ${k} shows`, false]); continue }
      await page.waitForTimeout([3000, 3350, 2450][k - 1])
      const m = await page.evaluate(k => {
        // cut off: wider than its own box (a word that will not wrap), or its box wider than the column it is set in
        const box = id => { const el = document.querySelector(`[data-testid="${id}"]`), r = el.getBoundingClientRect(), col = el.parentElement.parentElement.getBoundingClientRect(); return { text: el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, clipped: el.scrollWidth > el.clientWidth + 1 || r.right > col.right + 0.5 || r.left < col.left - 0.5 } }
        // every piece of text in the scene, to see that none runs off the side
        const scene = document.querySelector(`[data-testid="news-scene-${k}"]`)
        const off = [...scene.querySelectorAll('*')].filter(el => el.children.length === 0 && el.textContent.trim()).map(el => el.getBoundingClientRect()).filter(r => r.left < -0.5 || r.right > innerWidth + 0.5).length
        return { title: box(`news-title-${k}`), body: box(`news-body-${k}`), vignette: box(`news-vignette-${k}`), off, h: innerHeight, w: innerWidth }
      }, k - 1)
      const [title, body] = items[k - 1]
      const words = m.title.text === cat[title] && m.body.text === cat[body]
      const inside = [m.title, m.body].every(b => b.left >= 0 && b.right <= m.w && !b.clipped)
      const apart = m.title.bottom <= m.body.top + 1 && m.body.bottom <= m.vignette.top + 1
      const r = Math.round
      checks.push([`${lang} scene ${k}: its own words (“${m.title.text}”)`, words])
      checks.push([`${lang} scene ${k}: title and body whole and inside the page (title ${r(m.title.left)} to ${r(m.title.right)}, body ${r(m.body.left)} to ${r(m.body.right)} of ${m.w})`, inside])
      checks.push([`${lang} scene ${k}: the title, the body and the vignette one under the other (title ends ${r(m.title.bottom)}, body ${r(m.body.top)} to ${r(m.body.bottom)}, vignette from ${r(m.vignette.top)})`, apart])
      checks.push([`${lang} scene ${k}: no text of the vignette runs off the side (${m.off}), and it ends above the foot (${r(m.vignette.bottom)} of ${m.h})`, m.off === 0 && m.vignette.bottom <= m.h - 30])
      const p = await placed(page, k), text = await sceneText(page, k)
      checks.push([`${lang} scene ${k}: centred between Skip and the dots, clear of both (${where(p)})`, centred(p)])
      if (k < 3) checks.push([`${lang} scene ${k}: the question stays as it was put to the library, in English`, text.includes(QUESTION)])
      if (k === 1) checks.push([`${lang} scene 1: so do its wordings and their counts`, FOUND.every(s => text.includes(s))])
      await shot(page, `${lang}-scene-${k}`)
      if (k === 3) await shot(page, lang)
    }
    await ctx.close()
  }
  return checks
})

// ---------- lane 9: Animation speed ----------
await lane(9, 'Animation speed at its slowest and fastest: in order, and the run ends', async () => {
  const checks = []
  for (const [name, speed, want] of [['slow', 0.5, 24000], ['fast', 1.5, 8000]]) {
    const { ctx, page } = await phone({ prefs: { ...READER, motionSpeed: speed } })
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
    await until(page, 'scene-2', 30000)
    await page.waitForTimeout(3000 / speed)
    await shot(page, name)
    const ended = await untilGone(page, 60000)
    const p = await played(page)
    checks.push([`${name} (${speed}×): ${p.order}`, p.order === ALL])
    checks.push([`${name}: the run ends, in ${p.ms} ms (about ${want})`, ended && Math.abs(p.ms - want) < want * 0.12 && await home(page)])
    await ctx.close()
  }
  return checks
})

// ---------- lane 10: offline ----------
await lane(10, 'offline: the scenes play, and no request is made for them', async () => {
  const checks = []
  // a launch on Settings first, online: it tells no news, and lets the service worker store the app
  const { ctx, page } = await phone({ prefs: READER, sw: true })
  await page.goto(base + '/settings', { waitUntil: 'load' })
  const cached = await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    for (let i = 0; i < 100; i++) {
      const keys = (await caches.keys()).filter(k => k.startsWith('berean-shell-'))
      if (keys.length && (await (await caches.open(keys[0])).keys()).length > 3 && navigator.serviceWorker.controller) return (await (await caches.open(keys[0])).keys()).length
      await new Promise(r => setTimeout(r, 200))
    }
    return 0
  })
  checks.push([`the service worker has the app stored (${cached} files)`, cached > 3])
  await ctx.setOffline(true)
  const launch = async () => {
    const reqs = new Map()
    const on = r => reqs.set(r.url().replace(base, ''), r)
    page.on('request', on)
    return { reqs, stop: () => page.off('request', on) }
  }
  const first = await launch()
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  checks.push(['offline, the news shows', await until(page, 'scene-1')])
  await page.waitForTimeout(3000)
  await shot(page, 'offline')
  const ended = await untilGone(page)
  const p = await played(page)
  checks.push([`and plays to the end: ${p.order}`, ended && p.order === ALL])
  checks.push(['Home returns', await home(page)])
  await page.waitForTimeout(1500)
  first.stop()
  // the same launch again, now with nothing to tell: what the first asked for and this does not was asked for the news
  const second = await launch()
  await page.reload({ waitUntil: 'domcontentloaded' })
  checks.push(['the next offline launch shows Home and no news', await home(page) && await neverUp(page, 4000)])
  second.stop()
  const extra = [...first.reqs.keys()].filter(u => !second.reqs.has(u))
  const code = extra.filter(u => /^\/_expo\/static\/js\/.+\.js$/.test(u))
  const fromCache = await Promise.all(code.map(async u => { const r = await first.reqs.get(u).response().catch(() => null); return !!r && r.fromServiceWorker() && r.ok() }))
  checks.push([`the news asked for nothing but its own code, ${code.length} file${code.length === 1 ? '' : 's'} (${code.map(u => u.split('/').pop()).join(', ') || 'none'}), from the stored app (other requests: ${extra.filter(u => !code.includes(u)).join(', ') || 'none'})`, extra.length === code.length && code.length >= 1 && fromCache.every(Boolean)])
  const chunk = scenesChunk(HEAD)
  const src = chunk ? readFileSync(join(HEAD, '_expo/static/js/web', chunk.file), 'utf8') : ''
  checks.push([`its code is one chunk (${chunk?.file}) that was among them`, !!chunk && code.some(u => u.endsWith(chunk.file))])
  checks.push(['and that chunk has no call to the network in it', !!chunk && !/\bfetch\(|XMLHttpRequest|\/api\//.test(src)])
  await ctx.close()
  // its code out of reach altogether (no network for it and no stored copy): Home is not taken down, and the news is
  // left for the next launch
  const lost = await phone({ prefs: READER })
  const itsCode = `**/${chunk?.file}`
  await lost.ctx.route(itsCode, r => r.abort())
  await lost.page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  const uncovered = await lost.page.getByRole('heading', { name: 'Library', exact: true }).first().click({ trial: true, timeout: 15000 }).then(() => true, () => false)
  checks.push(['with its code out of reach, Home shows with nothing over it', uncovered && await neverUp(lost.page, 1500)])
  checks.push([`and the version is not left marked seen (seenNew ${JSON.stringify((await stored(lost.page))?.seenNew)})`, (await stored(lost.page))?.seenNew !== VERSION])
  await lost.ctx.unroute(itsCode)
  await lost.page.reload({ waitUntil: 'domcontentloaded' })
  checks.push(['so the next launch tells it', await until(lost.page, 'scene-1')])
  await lost.ctx.close()
  return checks
})

await browser.close()
head.close()
const real = errors.filter(e => !/useNativeDriver|Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR_FAILED/.test(e))
console.log(real.length ? 'ERRORS: ' + [...new Set(real)].join(' | ') : 'no page errors')
const passed = results.filter(r => r.pass).length
console.log(`${passed} of ${results.length} lanes pass${results.length < 10 ? ` (${10 - results.length} not run)` : ''}`)
if (passed !== results.length || real.length) process.exitCode = 1
