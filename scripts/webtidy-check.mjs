// Five web tidy-ups, on the built web app:
//   1. plurals: the dictionary's letter tabs say "1 article", never "1 articles";
//   2. second addresses: /ministry, /chronological, /jottings, /jottings/<id> and /plans are served the app shell (200)
//      and land on /companion, /chronology, /outlines, /outlines/<id> and /paths with their query kept;
//   3. tabs: each tab has one accessible name ("Home", not "Home Home"), in the bottom bar and in the desktop rail;
//   4. the reading face: on a cold load with the cache off, Literata is loaded before the first serif text is in the
//      page (Home's title and verse, the reader's numeral): document.fonts.check is true and a canvas measure of a test
//      string is already the loaded font's at first sight, so no frame is drawn in the browser's serif;
//   5. hidden tabs: under Read, Home's text is out of the page's text and its accessibility tree (aria-hidden, inert,
//      visibility hidden once the fade has played), there is one main region, the tab crossfade still plays through
//      intermediate opacities, and under Reduce animation every tab comes back at full opacity.
//   BASE=http://127.0.0.1:8794 node scripts/webtidy-check.mjs      (ONLY=fonts,tabs,… to pick)
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8794'
const only = (process.env.ONLY ?? '').split(',').filter(Boolean)
const want = k => !only.length || only.includes(k)
const PREFS = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false, align: 'center', width: 'medium', onboarded: true, toured: true }
const browser = await chromium.launch()
const errors = []
let failed = 0
const ok = (label, cond, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`); if (!cond) failed++ }

async function open({ width = 412, height = 915, prefs = PREFS, init } = {}) {
  const touch = width < 720
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, serviceWorkers: 'block' })
  await ctx.addInitScript(p => { if (!sessionStorage.getItem('primed')) { localStorage.setItem('berean_prefs', JSON.stringify(p)); sessionStorage.setItem('primed', '1') } }, prefs)
  if (init) await ctx.addInitScript(init)
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${e.message}`))
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|status of 40\d|when fetching the script/.test(m.text())) errors.push(`console: ${m.text()}`) })
  return { ctx, page }
}
const tab = (page, name) => page.getByRole('tab', { name, exact: true })
const HOME_TEXT = 'Today’s verse'

// 1. plurals
if (want('plural')) {
  const { ctx, page } = await open()
  await page.goto(base + '/dictionary', { waitUntil: 'networkidle' })
  await page.getByLabel(/^A, \d+ articles?$/).first().waitFor({ timeout: 30000 })
  const labels = await page.locator('[role=tab][aria-label]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')).filter(l => /^[A-Z], \d+ article/.test(l)))
  const ones = labels.filter(l => /, 1 /.test(l))
  ok(`dictionary: ${labels.length} letter tabs, each "<letter>, <n> article(s)"`, labels.length >= 20 && labels.every(l => /^[A-Z], \d+ articles?$/.test(l)))
  ok('dictionary: a letter with one article says "1 article"', ones.every(l => /, 1 article$/.test(l)) && labels.every(l => /, 1 article$/.test(l) || / articles$/.test(l)), ones.length ? ones.join('; ') : 'no letter has exactly one in this data; none says "1 articles"')
  await ctx.close()
}

// 2. second addresses
if (want('links')) {
  const cases = [
    ['/ministry', '/companion', ''], ['/ministry?author=jnd', '/companion', '?author=jnd'], ['/chronological', '/chronology', ''],
    ['/jottings', '/outlines', ''], ['/jottings/abc123?x=1', '/outlines/abc123', '?x=1'], ['/plans', '/paths', ''],
  ]
  const { ctx, page } = await open()
  for (const [from, to, query] of cases) {
    const res = await ctx.request.get(base + from)
    const html = await res.text()
    ok(`${from}: served the app shell (200)`, res.status() === 200 && html.includes('<div id="root">'), `status ${res.status()}`)
    await page.goto(base + from, { waitUntil: 'domcontentloaded' })
    const landed = await page.waitForURL(u => u.pathname === to, { timeout: 20000 }).then(() => true, () => false)
    const u = new URL(page.url())
    await page.waitForTimeout(600)
    const text = await page.locator('body').innerText()
    ok(`${from} → ${to}${query}`, landed && u.search === query && !/Nothing here|Unmatched Route/.test(text), `at ${u.pathname}${u.search}`)
  }
  await page.goto(base + '/ministry', { waitUntil: 'domcontentloaded' })
  ok('/ministry shows Ministry', await page.getByText('Ministry', { exact: true }).first().waitFor({ timeout: 20000 }).then(() => true, () => false))
  await ctx.close()
}

// 3. one name per tab
if (want('tabs')) {
  for (const [width, height, where] of [[412, 915, 'bottom bar'], [1280, 800, 'desktop rail']]) {
    const { ctx, page } = await open({ width, height })
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
    await page.getByRole('tab').first().waitFor({ timeout: 30000 })
    await page.waitForTimeout(800)
    const names = ['Home', 'Read', 'Search', 'Stats', 'Settings']
    const counts = []
    for (const n of names) counts.push(await tab(page, n).count())
    ok(`${where}: one tab named exactly Home, Read, Search, Stats, Settings`, counts.every(c => c === 1), counts.join(','))
    // the accessibility tree's own words for the bar
    const snap = await page.getByRole('tablist').first().ariaSnapshot()
    const lines = snap.split('\n').map(l => l.trim()).filter(l => l.startsWith('- tab "'))
    ok(`${where}: the tree reads five tabs, each named once and holding no second name`, lines.length === 5 && names.every((n, i) => new RegExp(`^- tab "${n}"( \\[selected\\])?$`).test(lines[i])) && !/Home[^"]*Home/.test(snap), snap.replace(/\s*\n\s*/g, ' | '))
    const computed = await page.getByRole('tab').evaluateAll(els => els.map(e => e.computedName ?? null))
    if (computed.every(Boolean)) ok(`${where}: computed names`, computed.join(',') === names.join(','), computed.join(','))
    await ctx.close()
  }
}

// 4. the reading face is in before any serif text
if (want('fonts')) {
  /** Records every element with serif text the moment it enters the page (a mutation callback runs before the paint). */
  const init = () => {
    const seen = new WeakSet(), log = []
    const canvas = document.createElement('canvas').getContext('2d')
    const measure = font => { canvas.font = font; return canvas.measureText('Be careful about nothing; Handgloves 0123').width }
    window.__wt = { log, measure, fonts: [] }
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (/\.(woff2?|ttf|otf)(\?|$)/.test(e.name)) window.__wt.fonts.push({ url: new URL(e.name).pathname, start: e.startTime, end: e.responseEnd }) }).observe({ type: 'resource', buffered: true }) } catch {}
    const probe = () => {
      if (!document.body || log.length > 4000) return
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const el = n.parentElement
        if (!el || seen.has(el) || !n.data.trim()) continue
        seen.add(el)
        const cs = getComputedStyle(el)
        if (!/^"?Literata/.test(cs.fontFamily)) continue
        const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} Literata`
        log.push({ t: performance.now(), text: n.data.slice(0, 28), font, family: cs.fontFamily, check: document.fonts.check(font), width: measure(font), el })
      }
    }
    new MutationObserver(probe).observe(document, { childList: true, subtree: true, characterData: true })
  }
  for (const [path, needle, label] of [['/', 'normal 400 22px', 'Home’s verse'], ['/read/43/3', 'normal 700 [67]\\dpx', 'the reader’s numeral']]) {
    const { ctx, page } = await open({ init })
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await page.goto(base + path, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(n => window.__wt.log.some(e => new RegExp(n).test(e.font)), needle, { timeout: 30000 }).catch(() => {})
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(500)
    const r = await page.evaluate(() => {
      const { log, measure, fonts } = window.__wt
      return {
        fonts,
        fallback: measure('400 22px serif'),
        faces: [...document.fonts].filter(f => f.family.replace(/"/g, '') === 'Literata').map(f => `${f.weight} ${f.style} ${f.status}`),
        log: log.map(e => ({ t: Math.round(e.t), text: e.text, font: e.font, family: e.family, check: e.check, width: e.width, now: measure(e.font), connected: e.el.isConnected, familyNow: e.el.isConnected ? getComputedStyle(e.el).fontFamily : null })),
      }
    })
    const target = r.log.find(e => new RegExp(needle).test(e.font))
    ok(`${path}: ${label} is set in Literata`, !!target && /^"?Literata/.test(target.family), target ? `${target.font} “${target.text}” at ${target.t} ms` : 'not found')
    ok(`${path}: every serif text (${r.log.length}) found its face loaded when it entered the page (fonts.check)`, r.log.length > 0 && r.log.every(e => e.check), r.log.filter(e => !e.check).map(e => `${e.font} “${e.text}”`).join('; '))
    ok(`${path}: its glyph widths at first sight are the loaded font's (no fallback frame)`, r.log.length > 0 && r.log.every(e => Math.abs(e.width - e.now) < 0.01), r.log.filter(e => Math.abs(e.width - e.now) >= 0.01).map(e => `${e.font}: ${e.width.toFixed(1)} then ${e.now.toFixed(1)}`).join('; '))
    const literata = await page.evaluate(() => window.__wt.measure('400 22px Literata'))
    ok(`${path}: the measure tells Literata from the browser's serif`, Math.abs(literata - r.fallback) > 1, `Literata ${literata.toFixed(1)} px, serif ${r.fallback.toFixed(1)} px`)
    const first = Math.min(...r.log.map(e => e.t))
    const woff = r.fonts.filter(f => /^\/fonts\/Literata-(Regular|Bold)\.woff2$/.test(f.url))
    ok(`${path}: Regular and Bold came from /fonts/ and had arrived before the first serif text (${Math.round(first)} ms)`, woff.length >= 2 && woff.every(f => f.end < first), r.fonts.map(f => `${f.url} ${Math.round(f.start)}–${Math.round(f.end)}`).join('; '))
    ok(`${path}: the faces are loaded (${r.faces.join(', ')})`, r.faces.filter(f => / loaded$/.test(f)).length >= 2)
    await ctx.close()
  }
  const html = await (await fetch(base + '/')).text()
  ok('the head preloads the Regular and Bold woff2', ['Regular', 'Bold'].every(n => new RegExp(`<link[^>]+rel="preload"[^>]+/fonts/Literata-${n}\\.woff2[^>]+as="font"[^>]+type="font/woff2"[^>]+crossorigin`).test(html)))
  ok('the head declares the family with font-display: block', (html.match(/@font-face\s*\{[^}]*font-family:\s*Literata[^}]*font-display:\s*block/g) ?? []).length === 3)
  const sw = await (await fetch(base + '/sw.js')).text()
  ok('the service worker precaches the three faces', ['Regular', 'Italic', 'Bold'].every(n => sw.includes(`"/fonts/Literata-${n}.woff2"`)))
}

// 5. hidden tabs are out of the page for readers and assistive tech; the crossfade still plays
if (want('hidden')) {
  /** Every mounted tab scene: the wrapper (main, or aria-hidden), its text, and the navigator's fading ancestor. */
  const scenes = page => page.evaluate(() => [...document.querySelectorAll('[role=main]')].map(el => {
    let fade = el; while (fade && fade.parentElement && getComputedStyle(fade).opacity === '1' && !fade.style.opacity) fade = fade.parentElement
    return { main: el.getAttribute('aria-hidden') !== 'true', hidden: el.getAttribute('aria-hidden') === 'true', inert: el.hasAttribute('inert'), visibility: getComputedStyle(el).visibility, opacity: +getComputedStyle(fade ?? el).opacity, text: (el.textContent ?? '').slice(0, 40) }
  }))
  const mains = async page => ((await page.locator('body').ariaSnapshot()).match(/^\s*- main\b/gm) ?? []).length
  const { ctx, page } = await open()
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await page.getByText(HOME_TEXT).first().waitFor({ timeout: 30000 })
  ok('Home: its text is in the page, one main region', (await page.locator('body').innerText()).includes(HOME_TEXT) && await mains(page) === 1)
  await page.goto(base + '/read/43/3', { waitUntil: 'domcontentloaded' })
  await page.getByText('Nicodemus').first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(800)
  ok('/read/43/3 opened cold: no Home text, one main region', !(await page.locator('body').innerText()).includes(HOME_TEXT) && await mains(page) === 1)
  // the reviewer's case: Home has been open, then Read. The reader is marked first: it must be the same mounted screen after
  await page.evaluate(() => { document.querySelector('[role=main] [dir=auto]').dataset.wt = 'kept' })
  await tab(page, 'Home').click()
  await page.getByText(HOME_TEXT).first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(900)
  // the fade, sampled per frame from the tap: both scenes pass through part-way opacities, and the one leaving stays visible until it is out
  const fade = await page.evaluate(() => new Promise(res => {
    const sc = [...document.querySelectorAll('[role=main]')]
    const fader = el => { let f = el; while (f.parentElement && !f.style.opacity) f = f.parentElement; return f }
    const home = sc.find(e => e.textContent.includes('Today’s verse')), read = sc.find(e => e !== home && e.textContent.includes('Nicodemus'))
    const hf = fader(home), rf = fader(read), frames = []
    const t0 = performance.now()
    const tick = () => {
      frames.push({ t: performance.now() - t0, home: +getComputedStyle(hf).opacity, read: +getComputedStyle(rf).opacity, homeVis: getComputedStyle(home).visibility, readVis: getComputedStyle(read).visibility, homeHidden: home.getAttribute('aria-hidden') })
      if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else res(frames)
    }
    ;[...document.querySelectorAll('[role=tab]')].find(e => /Read/.test(e.textContent || e.getAttribute('aria-label') || '')).click()
    requestAnimationFrame(tick)
  }))
  const mid = fade.filter(f => f.home > 0.02 && f.home < 0.98), last = fade[fade.length - 1]
  ok('Home → Read crossfades: part-way frames on both scenes', mid.length >= 5 && fade.some(f => f.read > 0.02 && f.read < 0.98), `${mid.length} part-way frames over ${Math.round((mid[mid.length - 1]?.t ?? 0) - (mid[0]?.t ?? 0))} ms`)
  ok('Home stays visible while it fades, then goes', mid.every(f => f.homeVis === 'visible') && last.homeVis === 'hidden' && last.home < 0.02, `ends opacity ${last.home}, visibility ${last.homeVis}`)
  ok('Read is visible and opaque at the end', last.readVis === 'visible' && last.read > 0.98)
  ok('Home is aria-hidden from the first frame of the switch', fade.slice(1).every(f => f.homeHidden === 'true'))
  ok('the reader was kept mounted behind Home (same nodes, same address)', await page.locator('[data-wt=kept]').count() === 1 && new URL(page.url()).pathname + new URL(page.url()).search === '/read/43/3', page.url())
  const text = await page.locator('body').innerText()
  ok('under Read: the page text has no Home text', !text.includes(HOME_TEXT) && text.includes('Nicodemus'))
  ok('under Read: one main region in the accessibility tree, and no Home in it', await mains(page) === 1 && !(await page.locator('body').ariaSnapshot()).includes(HOME_TEXT))
  const s = await scenes(page)
  ok('under Read: every other tab is aria-hidden, inert and not visible', s.filter(x => x.main).length === 1 && s.filter(x => !x.main).length >= 1 && s.filter(x => !x.main).every(x => x.hidden && x.inert && x.visibility === 'hidden'), JSON.stringify(s.map(x => [x.main ? 'main' : 'hidden', x.visibility, x.opacity])))
  ok('under Read: Home takes no keyboard focus', await page.evaluate(() => { const b = [...document.querySelectorAll('[role=main][inert] [role=button], [role=main][inert] [tabindex="0"]')][0]; if (!b) return false; b.focus(); return document.activeElement !== b }))
  // and back, to a tab on either side
  for (const name of ['Settings', 'Home', 'Read']) {
    await tab(page, name).click(); await page.waitForTimeout(1000)
    const now = await scenes(page)
    ok(`back and forth, ${name}: one visible opaque main, the rest hidden`, now.filter(x => x.main && x.visibility === 'visible' && x.opacity > 0.98).length === 1 && now.filter(x => !x.main).every(x => x.visibility === 'hidden'), JSON.stringify(now.map(x => [x.main ? 'main' : 'hidden', x.visibility, x.opacity])))
  }
  await ctx.close()

  // Reduce animation (the 1 ms fade): every tab comes back whole, switched while mounted (build 28's blank tab)
  const r = await open({ prefs: { ...PREFS, reduceMotion: true } })
  await r.page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await r.page.getByText(HOME_TEXT).first().waitFor({ timeout: 30000 })
  for (const name of ['Read', 'Home', 'Settings', 'Read', 'Home']) {
    await tab(r.page, name).click(); await r.page.waitForTimeout(350)
    const now = await scenes(r.page)
    ok(`Reduce animation, ${name}: shown at full opacity, the rest hidden`, now.filter(x => x.main && x.visibility === 'visible' && x.opacity > 0.98).length === 1 && now.filter(x => !x.main).every(x => x.visibility === 'hidden' && x.hidden && x.inert), JSON.stringify(now.map(x => [x.main ? 'main' : 'hidden', x.visibility, x.opacity])))
  }
  ok('Reduce animation: Home is readable again', (await r.page.locator('body').innerText()).includes(HOME_TEXT))
  await r.ctx.close()
}

await browser.close()
if (errors.length) { console.log('page errors:'); for (const e of [...new Set(errors)]) console.log('  ' + e) }
console.log(failed || errors.length ? `\n${failed} failed, ${errors.length} page errors` : '\nall passed')
process.exit(failed || errors.length ? 1 : 0)
