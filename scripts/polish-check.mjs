// Motion polish at 412 px. The theme change must never flash: every painted frame of the change is sampled (CDP
// screencast, each frame's mean luminance) and must stay between the steady screen before and the steady screen after,
// on Home's strip and in the reader's theme sheet, both directions. The web runs the same veil as native
// (components/ThemeVeil.tsx), so this is the Android path too. Then the strip's dot → ring at 4x slow motion (frames, a contact sheet and a video), stills
// of other motions, and frame pacing at 4x CPU throttle.
//   BASE = a throwaway server (BEFORE = another, e.g. main's, for the same numbers); OUT = where it all goes.
//   ONLY=flash|reveal|tabs|picker|media|ring|stills|pacing|checks|lists (comma-separated)
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8799'
const before = process.env.BEFORE
const out = process.env.OUT ?? '/tmp/wt-polish3/out'
const only = process.env.ONLY
const want = k => !only || only.split(',').includes(k)
for (const d of ['video', 'ring', 'stills', 'flash', 'seq', 'reveal']) mkdirSync(`${out}/${d}`, { recursive: true })
const VIEW = { width: 412, height: 915 }
const browser = await chromium.launch()
const errors = []
const check = (label, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`); if (!ok) process.exitCode = 1 }
const PREFS = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false, align: 'center', width: 'medium', onboarded: true, toured: true, readerName: '' }

/** Slows every clock the page animates by (Date, performance, rAF) while `__setRate(r)` is below 1. */
const WARP = () => {
  const rD = Date.now.bind(Date), rP = performance.now.bind(performance), rR = window.requestAnimationFrame.bind(window)
  let rate = 1, aR = rP(), aV = aR
  const off = rD() - rP()
  const v = r => aV + (r - aR) * rate
  window.__setRate = r => { const n = rP(); aV = v(n); aR = n; rate = r }
  performance.now = () => v(rP())
  Date.now = () => Math.round(v(rP()) + off)
  window.requestAnimationFrame = cb => rR(t => cb(v(t)))
}

const phone = async ({ prefs = PREFS, video = null, warp = false, cpu = 1, server = base, touch = true } = {}) => {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch, ...(video ? { recordVideo: { dir: `${out}/video/${video}`, size: VIEW } } : {}) })
  await ctx.addInitScript(p => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('berean_prefs', JSON.stringify(p)); sessionStorage.setItem('seeded', '1') } }, prefs)
  if (warp) await ctx.addInitScript(WARP)
  // no service worker: every run loads this server's bundle
  await ctx.route('**/sw.js', r => r.fulfill({ status: 404, body: '' }))
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|status of 40[14]|bad HTTP response code \(404\)/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)) })
  const cdp = await ctx.newCDPSession(page)
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  page.goHome = async () => { await page.goto(server + '/', { waitUntil: 'networkidle' }); await page.getByLabel('All themes').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200) }
  page.goReader = async () => { await page.goto(server + '/read/43/3', { waitUntil: 'networkidle' }); await page.waitForSelector('text=Nicodemus', { timeout: 30000 }); await page.waitForTimeout(900) }
  return { ctx, page, cdp }
}

// one analyser page decodes screencast frames and measures them
const actx = await browser.newContext()
const analyser = await actx.newPage()
await analyser.setContent('<canvas id=c></canvas>')
/** Mean relative luminance (0-255, on the encoded values, so a crossfade's frames are exact blends) and its spread. */
const measure = b64 => analyser.evaluate(async b => {
  const img = new Image(); img.src = 'data:image/jpeg;base64,' + b; await img.decode()
  const c = document.getElementById('c'); c.width = img.width; c.height = img.height
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0)
  const d = g.getImageData(0, 0, c.width, c.height).data
  let s = 0, s2 = 0; const n = d.length / 4
  for (let i = 0; i < d.length; i += 4) { const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += y; s2 += y * y }
  const mean = s / n
  return { mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)) }
}, b64)

/** The same, over one region of the frame (CSS px of the 412-wide viewport). */
const measureRegion = (b64, r) => analyser.evaluate(async ([b, r]) => {
  const img = new Image(); img.src = 'data:image/jpeg;base64,' + b; await img.decode()
  const k = img.width / 412
  const c = document.getElementById('c'); c.width = Math.max(1, Math.round(r.w * k)); c.height = Math.max(1, Math.round(r.h * k))
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, r.x * k, r.y * k, r.w * k, r.h * k, 0, 0, c.width, c.height)
  const d = g.getImageData(0, 0, c.width, c.height).data
  let s = 0; const n = d.length / 4
  for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
  return s / n
}, [b64, r])

/** Every frame the compositor paints from `ms` before `act` to `ms` after it, with its time from the tap. */
async function film(page, cdp, act, { ms = 700, lead = 250, width = 412 } = {}) {
  const frames = []
  const on = f => { frames.push({ data: f.data, t: f.metadata.timestamp * 1000 }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}) }
  cdp.on('Page.screencastFrame', on)
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width * 2, maxHeight: 2000, everyNthFrame: 1 })
  await page.waitForTimeout(lead)
  const t0 = Date.now()
  await act()
  await page.waitForTimeout(ms)
  await cdp.send('Page.stopScreencast')
  cdp.off('Page.screencastFrame', on)
  return frames.map(f => ({ ...f, t: f.t - t0 }))
}

/** The luminance story of one theme change: steady before, every frame during, steady after. */
async function lumaRun(label, page, cdp, act) {
  const frames = await film(page, cdp, act)
  const pre = frames.filter(f => f.t < 0)
  const post = frames.filter(f => f.t >= 0)
  if (!pre.length) pre.push(post.shift())
  const m = []
  for (const f of [...pre.slice(-1), ...post]) m.push({ t: Math.round(f.t), ...(await measure(f.data)) })
  // the screen after: a still once everything has settled
  const still = await page.screenshot({ type: 'jpeg', quality: 92 })
  const after = await measure(still.toString('base64'))
  const start = m[0]
  const lo = Math.min(start.mean, after.mean), hi = Math.max(start.mean, after.mean)
  const during = m.slice(1)
  const worst = Math.max(0, ...during.map(x => Math.max(lo - x.mean, x.mean - hi)))
  const sdFloor = Math.min(...during.map(x => x.sd)) / Math.min(start.sd, after.sd)
  const bigStep = Math.max(0, ...during.map((x, i) => Math.abs(x.mean - (i ? during[i - 1] : start).mean)))
  const changed = during.find(x => Math.abs(x.mean - start.mean) > 0.5)
  const settledAt = [...during].reverse().find(x => Math.abs(x.mean - after.mean) > 0.5)
  writeFileSync(`${out}/flash/${label}.json`, JSON.stringify({ before: start, after, frames: m }, null, 1))
  // the frames themselves, the steady one before and the first eight painted after the tap, side by side
  const dir = `${out}/flash/${label}`
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const keep = [...pre.slice(-1), ...post.slice(0, 8)]
  keep.forEach((f, i) => writeFileSync(`${dir}/f${i}-${Math.round(f.t)}ms.jpg`, Buffer.from(f.data, 'base64')))
  try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-pattern_type', 'glob', '-i', `${dir}/f*.jpg`, '-vf', `scale=206:-1,tile=${keep.length}x1:padding=4:color=gray`, '-frames:v', '1', `${out}/stills/flash-${label}.png`]) } catch (e) { errors.push('ffmpeg: ' + e.message.split('\n')[0]) }
  const r = { label, before: +start.mean.toFixed(1), after: +after.mean.toFixed(1), frames: during.length, outside: +worst.toFixed(2), sdFloor: +sdFloor.toFixed(2), biggestStep: +bigStep.toFixed(1), firstChangeMs: changed?.t ?? null, settledMs: settledAt?.t ?? 0 }
  console.log('luma', JSON.stringify(r))
  return r
}

const chip = (page, name) => page.getByRole('radio', { name: `${name} theme` }).first()
const tapChip = async (page, name) => { await chip(page, name).scrollIntoViewIfNeeded(); const b = await chip(page, name).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2) }

async function flashSuite(server, tag) {
  const rows = []
  {
    const mode = 'veil'
    // Home's strip, both directions, a close pair, dark to dark and a black-to-black accent change
    const { ctx, page, cdp } = await phone({ server })
    await page.goHome()
    await chip(page, 'Black').scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    for (const [from, to] of [['Paper', 'Black'], ['Black', 'Paper'], ['Paper', 'Sepia'], ['Sepia', 'Slate'], ['Slate', 'Midnight'], ['Midnight', 'Black'], ['Black', 'Gold'], ['Gold', 'Paper']]) {
      await chip(page, to).scrollIntoViewIfNeeded(); await page.waitForTimeout(300)
      rows.push(await lumaRun(`${tag}-${mode}-home-${from}-${to}`, page, cdp, () => tapChip(page, to)))
      await page.waitForTimeout(250)
    }
    await ctx.close()
    // the reader's theme sheet: the sheet (a Modal) and the page under its scrim
    const r = await phone({ server })
    await r.page.goReader()
    await r.page.getByLabel('Theme').first().click()
    await r.page.waitForTimeout(700)
    for (const [from, to] of [['Paper', 'Forest'], ['Forest', 'Paper'], ['Paper', 'Black']]) {
      rows.push(await lumaRun(`${tag}-${mode}-sheet-${from}-${to}`, r.page, r.cdp, () => tapChip(r.page, to)))
      await r.page.waitForTimeout(250)
    }
    await r.ctx.close()
  }
  return rows
}

if (want('flash')) {
  const rows = await flashSuite(base, 'after')
  for (const r of rows) {
    check(`no flash: ${r.label}`, r.outside <= 3, `outside [before, after] by ${r.outside} (of 255; main flashed by 11 to 18)`)
    if (/Paper-Sepia|Slate-Midnight|Black-Gold/.test(r.label)) check(`words stay: ${r.label}`, r.sdFloor >= 0.6, `text contrast floor ${r.sdFloor}`)
    // from the first changed frame: the tap-to-commit time before it is the render, reported under pacing
    const fade = r.firstChangeMs === null ? 0 : r.settledMs - r.firstChangeMs
    // the sheet's pick blooms (the reveal section measures it); everything else is the quick crossfade
    const cap = /sheet/.test(r.label) ? 720 : 340
    check(`change done within ${cap} ms of its first frame: ${r.label}`, fade <= cap, `${fade} ms`)
  }
  const report = { after: rows }
  if (before) {
    const b = await flashSuite(before, 'before')
    report.before = b
    for (const r of b) console.log(`before: ${r.label} outside=${r.outside} sdFloor=${r.sdFloor} biggestStep=${r.biggestStep}`)
  }
  writeFileSync(`${out}/flash/report.json`, JSON.stringify(report, null, 2))
}

/**
 * The Themes screen's bloom: every painted frame, whole and in two regions (under the tapped swatch, and the far
 * corner). Each must stay between its own steady before and after; the near region must settle before the far one.
 */
const BG = { paper: '#faf7f2', sepia: '#f3e9d4', black: '#000000', slate: '#1c1917', midnight: '#0e1628', forest: '#0e1d16', gold: '#000000' }
const lumHex = h => { const n = parseInt(h.slice(1), 16); return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) }
async function revealRun(label, page, cdp, name, { box, from }) {
  const sw = chip(page, name)
  await sw.scrollIntoViewIfNeeded(); await page.waitForTimeout(400)
  const b = await sw.boundingBox()
  const tap = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  // patches along the line from the tap to the farthest corner of the box: each settles when the edge passes it
  const cx = tap.x < box.x + box.w / 2 ? box.x + box.w - 20 : box.x + 20, cy = tap.y < box.y + box.h / 2 ? box.y + box.h - 20 : box.y + 20
  const patches = [0.2, 0.35, 0.5, 0.65, 0.8, 0.95].map(f => ({ f, x: tap.x + (cx - tap.x) * f - 16, y: tap.y + (cy - tap.y) * f - 16, w: 32, h: 32 }))
  const frames = await film(page, cdp, () => page.mouse.click(tap.x, tap.y), { ms: 900 })
  const still = (await page.screenshot({ type: 'jpeg', quality: 92 })).toString('base64')
  const pre = frames.filter(f => f.t < 0).slice(-1)[0] ?? frames[0]
  const post = frames.filter(f => f.t >= 0)
  const at = async d => ({ all: await measure(d), p: await Promise.all(patches.map(r => measureRegion(d, r))) })
  const series = []
  for (const f of post) series.push({ t: Math.round(f.t), ...(await at(f.data)) })
  const s0 = await at(pre.data), s1 = await at(still)
  // every pixel is a blend of the old page colour and the new screen: bounded by the steady screens and both page colours
  const bgs = [lumHex(BG[from]), lumHex(BG[name.toLowerCase()])]
  const out1 = (v, a, z) => Math.max(Math.min(a, z, ...bgs) - v, v - Math.max(a, z, ...bgs))
  const outsideAll = Math.max(0, ...series.map(x => out1(x.all.mean, s0.all.mean, s1.all.mean)))
  const outsidePatch = Math.max(0, ...series.flatMap(x => x.p.map((v, k) => out1(v, s0.p[k], s1.p[k]))))
  const settled = patches.map((_, k) => { const a = s0.p[k], z = s1.p[k]; if (Math.abs(z - a) < 6) return null; const last = [...series].reverse().find(x => Math.abs(x.p[k] - z) > 0.1 * Math.abs(z - a)); return last ? last.t : 0 })
  const sdFloor = Math.min(...series.map(x => x.all.sd)) / Math.min(s0.all.sd, s1.all.sd)
  const r = { label, outsideAll: +outsideAll.toFixed(2), outsidePatch: +outsidePatch.toFixed(2), settledByDistance: settled, sdFloor: +sdFloor.toFixed(2), frames: series.length }
  writeFileSync(`${out}/reveal/${label}.json`, JSON.stringify({ tap, patches, s0, s1, series }, null, 1))
  const dir = `${out}/reveal/${label}`
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const keep = [pre, ...post.filter((_, i) => i % 2 === 0).slice(0, 11)]
  keep.forEach((f, i) => writeFileSync(`${dir}/f${String(i).padStart(2, '0')}-${Math.round(f.t)}ms.jpg`, Buffer.from(f.data, 'base64')))
  try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-pattern_type', 'glob', '-i', `${dir}/f*.jpg`, '-vf', `scale=206:-1,tile=${keep.length}x1:padding=4:color=gray`, '-frames:v', '1', `${out}/stills/reveal-${label}.png`]) } catch (e) { errors.push('ffmpeg: ' + e.message.split('\n')[0]) }
  console.log('reveal', JSON.stringify(r))
  return r
}

if (want('reveal')) {
  const rows = []
  const screen = { x: 0, y: 0, w: VIEW.width, h: VIEW.height }
  for (const [from, to] of [['paper', 'Black'], ['black', 'Sepia'], ['paper', 'Sepia'], ['slate', 'Midnight'], ['black', 'Gold']]) {
    const { ctx, page, cdp } = await phone({ prefs: { ...PREFS, theme: from, themeDark: from === 'black' ? 'black' : 'slate' } })
    await page.goto(base + '/themes', { waitUntil: 'networkidle' });
    await chip(page, 'Paper').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200)
    rows.push(await revealRun(`themes-${from}-${to}`, page, cdp, to, { box: screen, from }))
    await ctx.close()
  }
  // the reader's theme sheet: the bloom spreads across the sheet; the page under the scrim crossfades
  {
    const { ctx, page, cdp } = await phone()
    await page.goReader()
    await page.getByLabel('Theme').first().click(); await page.waitForTimeout(900)
    // the sheet's panel: from its title to the bottom of the screen
    const top = (await page.getByRole('heading', { name: 'Theme', exact: true }).last().boundingBox()).y - 30
    rows.push(await revealRun('sheet-paper-Forest', page, cdp, 'Forest', { box: { x: 0, y: top, w: VIEW.width, h: VIEW.height - top }, from: 'paper' }))
    await ctx.close()
  }
  for (const r of rows) {
    check(`bloom never leaves the two themes: ${r.label}`, Math.max(r.outsideAll, r.outsidePatch) <= 3, `whole ${r.outsideAll}, patches ${r.outsidePatch}`)
    const d = r.settledByDistance.filter(x => x !== null)
    if (d.length >= 3) {
      const rising = d.every((x, i) => i === 0 || x >= d[i - 1] - 34)
      check(`spreads from the tap: ${r.label}`, rising && d[d.length - 1] - d[0] >= 60, `settled by distance ${JSON.stringify(r.settledByDistance)} ms`)
    }
    if (d.length) check(`settled within ~700 ms of the tap plus the render: ${r.label}`, Math.max(...d) <= 950, `${Math.max(...d)} ms`)
  }
  // Reduce animation: the calm crossfade instead (no mask on any element)
  {
    const { ctx, page } = await phone({ prefs: { ...PREFS, reduceMotion: true } })
    await page.goto(base + '/themes', { waitUntil: 'networkidle' }); await chip(page, 'Paper').waitFor({ timeout: 30000 }); await page.waitForTimeout(900)
    await page.evaluate(() => { window.__masked = false; const o = new MutationObserver(() => { if ([...document.querySelectorAll('div')].some(d => d.style.maskImage || d.style.webkitMaskImage)) window.__masked = true }); o.observe(document.body, { attributes: true, subtree: true, childList: true }) })
    await tapChip(page, 'Black'); await page.waitForTimeout(600)
    check('Reduce animation: the Themes screen crossfades, no bloom', !(await page.evaluate(() => window.__masked)))
    await ctx.close()
  }
  // 4x slow motion of the bloom, for the eye
  {
    const { ctx, page } = await phone({ warp: true })
    await page.goto(base + '/themes', { waitUntil: 'networkidle' }); await chip(page, 'Paper').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200)
    await chip(page, 'Black').scrollIntoViewIfNeeded(); await page.waitForTimeout(300)
    await sequence(page, 'reveal-4x-paper-black', { x: 0, y: 0, width: VIEW.width, height: VIEW.height }, () => tapChip(page, 'Black'), { ms: 2600, n: 10 })
    await ctx.close()
  }
  const v = await phone({ video: 'reveal' })
  await v.page.goto(base + '/themes', { waitUntil: 'networkidle' }); await chip(v.page, 'Paper').waitFor({ timeout: 30000 }); await v.page.waitForTimeout(1000)
  for (const t of ['Black', 'Sepia', 'Midnight', 'Paper', 'Gold']) { await tapChip(v.page, t); await v.page.waitForTimeout(900) }
  await v.ctx.close()
  writeFileSync(`${out}/reveal/report.json`, JSON.stringify(rows, null, 2))
}

// The first switch to each tab, on a fresh load: no frame may leave the range of the two screens and the page colour
// (the navigators' own #f2f2f2 used to show while a tab's first screen mounted, glaring in Black).
if (want('tabs')) {
  const pages = { paper: '#faf7f2', black: '#000000', slate: '#1c1917' }
  const rows = []
  for (const theme of ['black', 'paper', 'slate']) for (const tab of ['Read', 'Search', 'Stats', 'Settings']) {
    const { ctx, page, cdp } = await phone({ prefs: { ...PREFS, theme, themeDark: theme === 'paper' ? 'slate' : theme } })
    await page.goHome()
    const frames = await film(page, cdp, () => page.getByRole('tab', { name: new RegExp(tab) }).first().click(), { ms: 1300, lead: 200 })
    await page.waitForTimeout(600)
    const still = (await page.screenshot({ type: 'jpeg', quality: 92 })).toString('base64')
    // the screen above the tab bar, where the scenes crossfade
    const body = { x: 0, y: 0, w: 412, h: VIEW.height - 80 }
    const pre = frames.filter(f => f.t < 0).slice(-1)[0] ?? frames[0]
    const s0 = await measureRegion(pre.data, body), s1 = await measureRegion(still, body), bg = lumHex(pages[theme])
    const lo = Math.min(s0, s1, bg), hi = Math.max(s0, s1, bg)
    let worst = 0, at = null
    for (const f of frames.filter(f => f.t >= 0)) { const v = await measureRegion(f.data, body); const o = Math.max(lo - v, v - hi); if (o > worst) { worst = o; at = Math.round(f.t) } }
    rows.push({ theme, tab, before: +s0.toFixed(1), after: +s1.toFixed(1), outside: +worst.toFixed(1), at })
    check(`first switch to ${tab} in ${theme}: no frame outside the two screens and the page`, worst <= 3, `outside by ${worst.toFixed(1)}${at !== null ? ` at ${at} ms` : ''}`)
    await ctx.close()
  }
  writeFileSync(`${out}/tabs-first-switch.json`, JSON.stringify(rows, null, 1))
}

// The picker's waves: the books grid pops in once the sheet is up, however the picker opened, and each grid again
// when it replaces the other, never on a re-render.
if (want('picker')) {
  const { ctx, page } = await phone()
  await page.goReader()
  const probe = label => page.evaluate(l => new Promise(res => {
    const out = []; const t0 = performance.now()
    const tick = () => {
      const el = document.querySelector(`[aria-label="${l}"]`)
      const w = el?.parentElement
      out.push([Math.round(performance.now() - t0), w ? +getComputedStyle(w).opacity : null, el ? Math.round(el.getBoundingClientRect().y) : null])
      if (performance.now() - t0 < 1400) requestAnimationFrame(tick); else res(out)
    }
    requestAnimationFrame(tick)
  }), label)
  const settled = tr => { const last = tr[tr.length - 1][2]; return tr.find(([, , y]) => y !== null && Math.abs(y - last) < 60)?.[0] ?? null }
  const firstSeen = tr => tr.find(([, o]) => o !== null && o > 0.05)?.[0] ?? null
  let p = probe('Gen'); await page.getByRole('button', { name: /John 3/ }).first().click(); const a = await p
  check('the books wave plays once the sheet is up (opened from the book button)', firstSeen(a) !== null && firstSeen(a) >= settled(a) - 250 && a.some(([, o]) => o !== null && o < 0.5 && o > 0.05), `Gen appears at ${firstSeen(a)} ms, the sheet is up by ${settled(a)} ms`)
  await page.getByRole('button', { name: 'Gen', exact: true }).click(); await page.waitForTimeout(150)
  p = probe('1'); const b = await p
  check('the chapter wave plays when the chapters replace the books', b.some(([, o]) => o !== null && o < 0.9 && o > 0.05), `first chapter's opacity: ${b.slice(0, 8).map(x => x[1]).join(' ')}`)
  p = probe('Gen'); await page.getByRole('button', { name: 'All books', exact: true }).click(); const c = await p
  check('and the books wave again on All books', c.some(([, o]) => o !== null && o < 0.9 && o > 0.05))
  // a re-render (the window resizing under the open picker) does not replay it
  await page.waitForTimeout(600)
  p = probe('Gen'); await page.setViewportSize({ width: 400, height: 915 }); await page.waitForTimeout(100); await page.setViewportSize(VIEW); const d = await p
  check('no replay on a re-render', d.every(([, o]) => o === null || o > 0.99))
  await ctx.close()
}

// Short videos at real speed: the slower ring on Home's strip, a few tab crossfades, a vertical chapter turn
if (want('media')) {
  {
    const { ctx, page } = await phone({ video: 'ring-1x' })
    await page.goHome()
    for (const t of ['Sepia', 'Slate', 'Paper']) { await tapChip(page, t); await page.waitForTimeout(1000) }
    await ctx.close()
  }
  {
    const { ctx, page } = await phone({ video: 'tabs-1x', prefs: { ...PREFS, theme: 'black', themeDark: 'black' } })
    await page.goHome()
    for (const t of ['Read', 'Search', 'Stats', 'Settings', 'Home', 'Stats']) { await page.getByRole('tab', { name: new RegExp(t) }).first().click(); await page.waitForTimeout(1100) }
    await ctx.close()
  }
  {
    const { ctx, page } = await phone({ video: 'vertical-turn-1x', touch: false })
    await page.goto(base + '/read/1/1', { waitUntil: 'networkidle' }); await page.waitForSelector('text=In the beginning'); await page.waitForTimeout(900)
    await page.mouse.move(206, 500)
    for (let i = 0; i < 160; i++) { await page.mouse.wheel(0, 60); await page.waitForTimeout(12) }
    await page.waitForTimeout(600)
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(50) }
    await page.waitForTimeout(1500)
    check('the vertical turn landed on Genesis 2', /\/read\/1\/2/.test(page.url()), page.url())
    // and a sideways one, from the Next button
    await page.getByRole('button', { name: /Gen 3/ }).first().click().catch(() => {})
    await page.waitForTimeout(1500)
    await ctx.close()
  }
}

// the dot opening into a ring, and the old ring closing into a dot, at 4x slow motion: frames, a sheet, a video
if (want('ring')) {
  for (const [from, to] of [['Paper', 'Sepia'], ['Olive', 'Slate'], ['Slate', 'Midnight'], ['Black', 'Gold']]) {
    const { ctx, page } = await phone({ warp: true, prefs: { ...PREFS, theme: from.toLowerCase().replace('gold', 'black-gold') } })
    await page.goHome()
    await chip(page, to).scrollIntoViewIfNeeded(); await chip(page, from).scrollIntoViewIfNeeded(); await page.waitForTimeout(400)
    const box = await chip(page, from).boundingBox()
    const name = `${from}-${to}`
    const dir = `${out}/ring/${name}`
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    // the strip at device resolution, shot back to back while the clocks run at a quarter speed
    const clip = { x: 0, y: Math.max(0, box.y - 12), width: VIEW.width, height: box.height + 24 }
    await page.evaluate(() => window.__setRate(0.25))
    const t0 = Date.now()
    await tapChip(page, to)
    const frames = []
    while (Date.now() - t0 < 1400) frames.push(await page.screenshot({ clip, scale: 'device', type: 'png' }))
    const real = (Date.now() - t0) / 1000
    await page.evaluate(() => window.__setRate(1))
    frames.forEach((f, i) => writeFileSync(`${dir}/f${String(i).padStart(3, '0')}.png`, f))
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', (frames.length / real).toFixed(2), '-pattern_type', 'glob', '-i', `${dir}/f*.png`, '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p', '-c:v', 'libvpx-vp9', '-b:v', '2M', `${out}/video/ring-4x-${name}.webm`])
      const n = Math.min(frames.length, 14)
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-pattern_type', 'glob', '-i', `${dir}/f*.png`, '-vf', `select='lt(n\,${n})',tile=1x${n}:padding=2:color=gray`, '-frames:v', '1', `${out}/stills/ring-sheet-${name}.png`])
    } catch (e) { errors.push('ffmpeg: ' + e.message.split('\n')[0]) }
    console.log('ring', name, frames.length, 'frames')
    await ctx.close()
  }
  // a plain-speed video of a few theme taps on Home, for the eye
  const { ctx, page } = await phone({ video: 'themes' })
  await page.goHome()
  for (const t of ['Sepia', 'Slate', 'Black', 'Gold', 'Paper']) { await chip(page, t).scrollIntoViewIfNeeded(); await page.waitForTimeout(250); await tapChip(page, t); await page.waitForTimeout(700) }
  await ctx.close()
}

// the strip's marks at rest, a burst of taps, and Reduce animation
if (want('checks')) {
  const scales = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[role="radio"][aria-label$=" theme"]')].slice(0, 25).map(el => {
    const discs = [...el.querySelectorAll('div')].filter(d => getComputedStyle(d).position === 'absolute')
    const s = d => { const m = getComputedStyle(d).transform; return m === 'none' ? 1 : +new DOMMatrix(m).a.toFixed(3) }
    return [el.getAttribute('aria-label').replace(' theme', ''), discs.slice(-2).map(s)]
  })))
  const { ctx, page } = await phone()
  await page.goHome()
  let s = await scales(page)
  check('selected chip rests as the ring', s.Paper?.[0] === 1 && s.Paper?.[1] === 1, JSON.stringify(s.Paper))
  check('other chips rest as the dot', s.Sepia?.[0] === 0.321 && s.Sepia?.[1] === 0, JSON.stringify(s.Sepia))
  // a burst: three taps 60 ms apart end on the last, with every mark at rest
  for (const t of ['Sepia', 'Linen', 'Sand']) { await tapChip(page, t); await page.waitForTimeout(60) }
  await page.waitForTimeout(900)
  s = await scales(page)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('berean_prefs') ?? '{}').theme)
  check('a burst of taps lands on the last', stored === 'sand' && s.Sand?.[0] === 1 && s.Linen?.[0] === 0.321 && s.Sepia?.[0] === 0.321, `${stored} ${JSON.stringify([s.Sepia, s.Linen, s.Sand])}`)
  const meta = await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))
  check('browser bar takes the page colour', meta === '#faf3e3', meta)
  // the ring: the accent's outer edge leads, the clearing hole trails it (both as progress 0..1, frame by frame)
  await chip(page, 'Mint').scrollIntoViewIfNeeded(); await page.waitForTimeout(300)
  await page.evaluate(() => {
    const el = document.querySelector('[role="radio"][aria-label="Mint theme"]')
    const discs = [...el.querySelectorAll('div')].filter(d => getComputedStyle(d).position === 'absolute').slice(-2)
    const k = d => { const m = getComputedStyle(d).transform; return m === 'none' ? 1 : new DOMMatrix(m).a }
    window.__ring = []
    const t0 = performance.now()
    const tick = () => { window.__ring.push([Math.round(performance.now() - t0), (k(discs[0]) - 18 / 56) / (1 - 18 / 56), k(discs[1])]); if (performance.now() - t0 < 600) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  await tapChip(page, 'Mint'); await page.waitForTimeout(700)
  const ring = await page.evaluate(() => window.__ring)
  const lead = Math.max(...ring.map(([, o, h]) => o - h))
  const settledRing = ring.find(([, o, h], i) => ring.slice(i).every(([, o2, h2]) => Math.abs(o2 - 1) < 0.01 && Math.abs(h2 - 1) < 0.01))
  writeFileSync(`${out}/ring-trace.json`, JSON.stringify(ring))
  check('the ring opens outer edge first, the hole trailing', lead > 0.12, `largest lead ${lead.toFixed(2)} of the travel`)
  check('the ring (at half speed) is settled within ~450 ms of its first frame', settledRing && settledRing[0] - ring.find(([, o]) => o > 0.01)[0] <= 470, `${settledRing ? settledRing[0] - ring.find(([, o]) => o > 0.01)[0] : '?'} ms`)
  // a button's release wobbles (WOBBLE_SPRING) and a segmented choice's does not (crisp): the scale, frame by frame
  const trace = (loc, label) => traceOn(page, loc, label)
  async function traceOn(page, loc, label) {
    const b = await loc.boundingBox()
    await page.evaluate(l => {
      const el = document.querySelector(`[aria-label="${l}"]`)
      window.__sc = []
      const t0 = performance.now()
      const tick = () => { const m = getComputedStyle(el).transform; window.__sc.push([Math.round(performance.now() - t0), m === 'none' ? 1 : new DOMMatrix(m).a]); if (performance.now() - t0 < 1300) requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
    }, label)
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(250)
    const up = await page.evaluate(() => performance.now())
    await page.mouse.up(); await page.waitForTimeout(1100)
    const sc = await page.evaluate(() => window.__sc)
    const t0 = sc[0]?.[0] ?? 0
    const after = sc.filter(([t]) => t > 260)
    return { min: Math.min(...sc.map(x => x[1])), peak: Math.max(...after.map(x => x[1])), stillBy: (after.find(([t], i) => after.slice(i).every(x => Math.abs(x[1] - 1) < 0.002)) ?? [NaN])[0] - 260 - t0, up }
  }
  await page.goto(base + '/dictionary', { waitUntil: 'networkidle' }); await page.getByLabel(/^Ab, \d+ headwords$/).waitFor({ timeout: 20000 })
  const chipLabel = await page.getByLabel(/^Ac, \d+ headwords?$/).first().getAttribute('aria-label')
  const w = await trace(page.getByLabel(chipLabel).first(), chipLabel)
  writeFileSync(`${out}/wobble.json`, JSON.stringify(w))
  check('a chip releases with a wobble past rest, and is still in ~330 ms', w.peak > 1.005 && w.stillBy < 380, `pressed to ${w.min.toFixed(3)}, peak ${w.peak.toFixed(4)}, still by ${Math.round(w.stillBy)} ms`)
  await page.goto(base + '/settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(900)
  const seg = page.getByRole('radio', { name: 'Sans', exact: true }).first()
  // the choice carries no label of its own: name it for the trace
  await seg.evaluate(el => el.setAttribute('aria-label', 'Sans'))
  const cr = await trace(seg, 'Sans')
  check('a segmented choice releases crisply (no wobble under its thumb)', cr.peak < 1.004, `peak ${cr.peak.toFixed(4)}`)
  await ctx.close()
  // Animation speed 0.5x: the same wobble takes about twice as long
  {
    const slow = await phone({ prefs: { ...PREFS, motionSpeed: 0.5 } })
    await slow.page.goto(base + '/dictionary', { waitUntil: 'networkidle' }); await slow.page.getByLabel(/^Ab, \d+ headwords$/).waitFor({ timeout: 20000 })
    const lbl = await slow.page.getByLabel(/^Ac, \d+ headwords?$/).first().getAttribute('aria-label')
    const t2 = await traceOn(slow.page, slow.page.getByLabel(lbl).first(), lbl)
    check('Animation speed 0.5x plays the wobble at half speed', t2.stillBy > w.stillBy * 1.6 && t2.peak > 1.005, `still by ${Math.round(t2.stillBy)} ms (1x: ${Math.round(w.stillBy)} ms)`)
    await slow.ctx.close()
  }
  // Reduce animation: no crossfade, no veil, the ring in place on the next frame
  const r = await phone({ prefs: { ...PREFS, reduceMotion: true } })
  await r.page.goHome()
  await tapChip(r.page, 'Mint')
  const early = await r.page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(document.getAnimations().length)))))
  s = await scales(r.page)
  check('Reduce animation: ring at once, nothing animating', s.Mint?.[0] === 1 && s.Mint?.[1] === 1 && s.Paper?.[0] === 0.321 && early === 0, `${JSON.stringify(s.Mint)} animations=${early}`)
  await r.ctx.close()
}

/**
 * A motion as a strip of stills: the clocks at a quarter speed, the clip shot back to back from the act for `ms` of real
 * time, eight frames picked evenly into one image. `act` runs after the warp is on.
 */
async function sequence(page, name, clip, act, { ms = 1200, n = 8, dir = 'row' } = {}) {
  await page.evaluate(() => window.__setRate(0.25))
  const t0 = Date.now()
  await act()
  const frames = []
  const scale = clip.width * clip.height > 200000 ? 'css' : 'device'
  while (Date.now() - t0 < ms) frames.push(await page.screenshot({ clip, scale, type: 'jpeg', quality: 90 }))
  await page.evaluate(() => window.__setRate(1))
  const d = `${out}/seq/${name}`
  rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true })
  const pick = Array.from({ length: Math.min(n, frames.length) }, (_, i) => frames[Math.round(i * (frames.length - 1) / Math.max(1, Math.min(n, frames.length) - 1))])
  pick.forEach((f, i) => writeFileSync(`${d}/f${i}.jpg`, f))
  const tile = dir === 'row' ? `${pick.length}x1` : `1x${pick.length}`
  try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-pattern_type', 'glob', '-i', `${d}/f*.jpg`, '-vf', `tile=${tile}:padding=4:color=gray`, '-frames:v', '1', `${out}/stills/${name}.png`]) } catch (e) { errors.push('ffmpeg: ' + e.message.split('\n')[0]) }
  console.log('seq', name, frames.length, 'frames')
}

if (want('stills')) {
  mkdirSync(`${out}/seq`, { recursive: true })
  const { ctx, page } = await phone({ warp: true })
  await page.goHome()
  // the tab bar: Home to Search, the pill growing under the new glyph as the old one lets go
  const bar = { x: 0, y: VIEW.height - 68, width: VIEW.width, height: 68 }
  await sequence(page, 'tab-switch', bar, () => page.getByRole('tab', { name: /Search/ }).first().click(), { dir: 'col' })
  await sequence(page, 'tab-switch-back', bar, () => page.getByRole('tab', { name: /Home/ }).first().click(), { dir: 'col' })
  // Settings: the segmented thumb, a switch, a slider held
  await page.goto(base + '/settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(900)
  const group = page.getByRole('radiogroup').nth(1)
  const seg = group.getByRole('radio').nth(2)
  await seg.scrollIntoViewIfNeeded(); await page.waitForTimeout(300)
  const sb = await group.boundingBox()
  await sequence(page, 'segmented', { x: 0, y: sb.y - 6, width: VIEW.width, height: sb.height + 12 }, () => seg.click(), { dir: 'col' })
  await sequence(page, 'segmented-back', { x: 0, y: sb.y - 6, width: VIEW.width, height: sb.height + 12 }, () => group.getByRole('radio').nth(0).click(), { dir: 'col' })
  const sw = page.getByRole('switch', { name: 'Verse numbers' }).filter({ visible: true }).first()
  await sw.scrollIntoViewIfNeeded(); await page.waitForTimeout(300)
  const wb = await sw.boundingBox()
  await sequence(page, 'switch', { x: wb.x - 10, y: wb.y - 8, width: wb.width + 20, height: wb.height + 16 }, () => sw.click())
  await sw.click(); await page.waitForTimeout(400)   // verse numbers back on: the selection still below taps one
  const sl = page.getByRole('slider').first()
  await sl.scrollIntoViewIfNeeded(); await page.waitForTimeout(300)
  const lb = await sl.boundingBox()
  await sequence(page, 'slider-hold', { x: 0, y: lb.y - 6, width: VIEW.width, height: lb.height + 12 }, async () => { await page.mouse.move(lb.x + lb.width * 0.3, lb.y + lb.height / 2); await page.mouse.down() }, { ms: 700, n: 5, dir: 'col' })
  await page.mouse.up()
  // Settings: letter and word spacing open in place, and close
  await page.evaluate(() => window.scrollTo(0, 0))
  const dis = page.getByRole('button', { name: 'Letter and word spacing' })
  await dis.scrollIntoViewIfNeeded(); await page.waitForTimeout(300)
  const db = await dis.boundingBox()
  await sequence(page, 'disclosure-open', { x: 0, y: db.y - 8, width: VIEW.width, height: 230 }, () => dis.click(), { ms: 1300, dir: 'col' })
  await sequence(page, 'disclosure-close', { x: 0, y: db.y - 8, width: VIEW.width, height: 230 }, () => dis.click(), { ms: 1100, dir: 'col' })
  // a tab switch: the screens crossfade
  await sequence(page, 'tab-fade', { x: 0, y: 0, width: VIEW.width, height: VIEW.height }, () => page.getByRole('tab', { name: /Home/ }).first().click(), { ms: 1000 })
  // the selection bar docking under a tapped verse, and leaving
  await page.goReader()
  const verse = () => page.evaluate(() => { const el = [...document.querySelectorAll('span')].find(e => e.firstChild?.nodeType === 3 && (e.firstChild.textContent || '').trim() === '3' && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().width < 60 && getComputedStyle(e).visibility !== 'hidden'); el?.click() })
  const foot = { x: 0, y: VIEW.height - 260, width: VIEW.width, height: 260 }
  await sequence(page, 'action-bar-in', foot, verse, { ms: 1000, dir: 'col' })
  await page.waitForTimeout(300)
  await sequence(page, 'action-bar-out', foot, () => page.getByRole('button', { name: 'Deselect' }).click(), { ms: 800, dir: 'col' })
  // search: a second query replaces the first in place (no blank frame between)
  await page.goto(base + '/search', { waitUntil: 'networkidle' }); await page.waitForTimeout(600)
  const field = page.getByPlaceholder('jn 3:16, or words to find')
  await field.fill('love'); await field.press('Enter'); await page.waitForTimeout(1500)
  await field.fill('grace')
  await sequence(page, 'search-swap', { x: 0, y: 0, width: VIEW.width, height: VIEW.height }, () => field.press('Enter'), { ms: 1400 })
  // the dictionary's Next page leads in from the right
  // a chip's release wobble: the letter B, pressed, held and let go, at a quarter speed
  await page.goto(base + '/dictionary', { waitUntil: 'networkidle' }); await page.waitForTimeout(900)
  await page.getByLabel(/^Ab, \d+ headwords$/).waitFor({ timeout: 20000 }).catch(() => {})
  const bee = page.getByLabel(/^Ac, \d+ headwords?$/).first()
  if (await bee.isVisible().catch(() => false)) {
    const bb = await bee.boundingBox()
    await sequence(page, 'chip-wobble', { x: bb.x - 16, y: bb.y - 12, width: bb.width + 32, height: bb.height + 24 }, async () => { await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.waitForTimeout(450); await page.mouse.up() }, { ms: 2000, n: 14 })
  } else errors.push('stills: no letter chip for the wobble')
  await page.goto(base + '/dictionary', { waitUntil: 'networkidle' }); await page.waitForTimeout(900)
  await page.getByLabel('Next page').first().scrollIntoViewIfNeeded().catch(() => {})
  const next = page.getByLabel('Next page').first()
  if (await next.isVisible().catch(() => false)) {
    await page.evaluate(() => window.scrollTo(0, 0))
    await sequence(page, 'dictionary-next', { x: 0, y: 0, width: VIEW.width, height: VIEW.height }, () => next.click(), { ms: 1000 })
  } else errors.push('dictionary: no Next page button')
  // a sheet rising over the reader, and leaving
  await page.goReader()
  await page.evaluate(() => window.__setRate(1))
  await sequence(page, 'sheet-open', { x: 0, y: 0, width: VIEW.width, height: VIEW.height }, () => page.getByLabel('Theme').first().click(), { ms: 1800 })
  await page.waitForTimeout(400)
  await sequence(page, 'sheet-close', { x: 0, y: 0, width: VIEW.width, height: VIEW.height }, () => page.mouse.click(VIEW.width / 2, 40), { ms: 1000 })
  await ctx.close()
}

if (want('pacing')) {
  const pacing = {}
  for (const cpu of [1, 4]) {
    for (const where of ['home', 'reader']) {
      const { ctx, page, cdp } = await phone({ cpu })
      if (where === 'home') await page.goHome(); else { await page.goReader(); await page.getByLabel('Theme').first().click(); await page.waitForTimeout(900) }
      const runs = []
      for (const t of ['Slate', 'Paper', 'Sepia', 'Black']) {
        if (where === 'home') { await chip(page, t).scrollIntoViewIfNeeded(); await page.waitForTimeout(300) }
        await page.evaluate(() => { const f = window.__pf = []; const tick = t => { f.push(t); if (f.length < 400) requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
        const frames = await film(page, cdp, () => tapChip(page, t), { ms: 600, lead: 120 })
        const raf = await page.evaluate(() => window.__pf)
        const gaps = raf.slice(1).map((x, i) => x - raf[i]).filter(g => g < 1000)
        const painted = frames.filter(f => f.t >= 0 && f.t <= 400)
        const fgaps = painted.slice(1).map((f, i) => f.t - painted[i].t)
        runs.push({ to: t, firstPaintMs: Math.round(painted[0]?.t ?? -1), paintedFrames: painted.length, worstPaintGapMs: Math.round(Math.max(0, ...fgaps)), rafP95: +pct(gaps, 0.95).toFixed(1), rafWorst: +Math.max(...gaps).toFixed(1), over20: gaps.filter(g => g > 20).length })
        await page.waitForTimeout(300)
      }
      pacing[`${where}-cpu${cpu}`] = runs
      console.log('pacing', where, `cpu${cpu}`, JSON.stringify(runs))
      await ctx.close()
    }
  }
  writeFileSync(`${out}/pacing.json`, JSON.stringify(pacing, null, 2))
}
function pct(a, p) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0 }

// Every list enters with the house stagger, each row in turn (34 ms apart as written, 0.7 tempo), on a first load, a page
// turn and a segment switch alike, and a re-render does not replay it: rows 1-5 are sampled from the frame they appear
// in, over 400 ms. Signed in as a reader with friends, a group, bookmarks and outlines, seeded through the API.
if (want('lists')) {
  const api = async (path, init = {}, token) => {
    const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }
    const r = await fetch(base + '/api' + path, { ...init, headers })
    return r.json().catch(() => null)
  }
  const stamp = Date.now() % 100000
  const mk = async h => api('/auth/register', { method: 'POST', body: JSON.stringify({ handle: h, password: 'lists-pw-1', display_name: h }) })
  const me = await mk(`lists${stamp}`), ids = []
  for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const f = await mk(`lists${stamp}${n}`)
    const inv = await api('/friends/invite', { method: 'POST', body: JSON.stringify({ handle: me.user.handle }) }, f.token)
    ids.push(inv)
  }
  for (const inv of (await api('/friends', {}, me.token)).incoming ?? []) await api(`/friends/invites/${inv.id}/accept`, { method: 'POST' }, me.token)
  for (let i = 1; i <= 6; i++) await api('/groups', { method: 'POST', body: JSON.stringify({ name: `Group ${i} ${stamp}` }) }, me.token)
  for (let v = 1; v <= 7; v++) await api('/bookmarks', { method: 'POST', body: JSON.stringify({ book: 43, chapter: 3, verse: v, label: null }) }, me.token)
  for (let i = 1; i <= 6; i++) await api('/outlines', { method: 'POST', body: JSON.stringify({ title: `Outline ${i}`, description: '' }) }, me.token)

  /** From `act`, the first five new rows' opacity per frame, for 400 ms from the frame the first of them starts to show
   *  (a list in a sheet waits for the sheet). In the page, so it also runs on a fresh document after a navigation. */
  const SAMPLER = () => {
    const seen = new Set(document.querySelectorAll('[data-entrance="row"]'))
    window.__rows = null
    let t0 = 0
    const tick = () => {
      const fresh = [...document.querySelectorAll('[data-entrance="row"]')].filter(e => !seen.has(e) && e.getBoundingClientRect().height > 0)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).slice(0, 5)
      const ops = fresh.map(e => +getComputedStyle(e).opacity)
      if (!window.__rows && ops.some(o => o > 0.02)) { window.__rows = []; t0 = performance.now() }
      if (window.__rows) window.__rows.push([Math.round(performance.now() - t0), ops])
      if (!window.__rows || performance.now() - t0 < 400) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
  const sample = async (page, act) => {
    await page.evaluate(SAMPLER)
    await act()
    await page.waitForTimeout(1600)
    return page.evaluate(() => window.__rows)
  }
  /** Each of the first rows starts hidden and they reach half opacity in order. */
  const judge = (label, rows) => {
    if (!rows || !rows.length) { check(`${label}: rows appear`, false, 'no rows'); return }
    const n = Math.max(...rows.map(r => r[1].length))
    const first = rows.find(r => r[1].length === n) ?? rows[0]
    const half = [...Array(n).keys()].map(k => rows.find(r => r[1][k] >= 0.5)?.[0] ?? Infinity)
    const hidden = first[1].every(o => o < 0.5)
    const inTurn = half.every((t, k) => k === 0 || t >= half[k - 1])
    const spread = half[n - 1] - half[0]
    check(`${label}: rows 1-${n} enter in turn, none already shown`, hidden && inTurn && n >= 2 && spread >= (n - 1) * 30 && half[n - 1] <= 400, `first ${JSON.stringify(first[1].map(o => +o.toFixed(2)))}, half-way at ${JSON.stringify(half)} ms`)
  }
  const signedIn = async () => {
    const r = await phone()
    await r.ctx.addInitScript(u => { localStorage.setItem('berean_token', u.token); localStorage.setItem('berean_user', JSON.stringify(u.user)) }, me)
    return r
  }
  const { ctx, page } = await signedIn()
  // a navigation starts a new document: the sampler goes in with it, armed for this one load
  await ctx.addInitScript(fn => { if (sessionStorage.getItem('sampleRows')) { sessionStorage.removeItem('sampleRows'); addEventListener('DOMContentLoaded', () => (0, eval)(`(${fn})`)()) } }, SAMPLER.toString())
  await page.goto(base + '/'); await page.waitForTimeout(1500)
  const go = async path => {
    await page.evaluate(() => sessionStorage.setItem('sampleRows', '1'))
    await page.goto(base + path)
    await page.waitForTimeout(3500)
    return page.evaluate(() => window.__rows)
  }
  judge('bookmarks', await go('/bookmarks'))
  judge('outlines', await go('/outlines'))
  judge('reading groups', await go('/groups'))
  judge('friends', await go('/friends'))
  judge('dictionary list', await go('/dictionary'))
  judge('dictionary page turn', await sample(page, () => page.getByLabel(/^Next page|^Page 2/).first().click()))
  judge('dictionary letter', await sample(page, () => page.getByLabel(/^B, /).click()))
  judge('ministry library', await go('/companion'))
  judge('an author\'s collections', await go('/companion?author=darby'))
  // the Ministry sheet on John 3:16, then its other author
  await page.goReader()
  await page.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let x = w.nextNode(); x; x = w.nextNode()) if (x.data.includes('loved the world')) { x.parentElement.scrollIntoView({ block: 'center' }); break } })
  await page.waitForTimeout(500)
  const at = await page.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let x = w.nextNode(); x; x = w.nextNode()) if (x.data.includes('loved the world')) { const r = document.createRange(); r.selectNodeContents(x); const b = r.getClientRects()[0]; return { x: b.x + 10, y: b.y + b.height / 2 } } })
  await page.mouse.click(at.x, at.y)
  await page.locator('[aria-label^="Ministry on"]').first().waitFor({ timeout: 15000 })
  judge('ministry sheet', await sample(page, () => page.locator('[aria-label^="Ministry on"]').first().click()))
  judge('ministry segment switch', await sample(page, () => page.getByRole('radio').filter({ hasText: /Coates/ }).first().click()))
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  // the word sheet's occurrences: a tagged word (word lookup on)
  await page.getByLabel('More').first().click(); await page.waitForTimeout(700)
  await page.getByText('Word lookup', { exact: true }).first().click(); await page.waitForTimeout(300)
  await page.keyboard.press('Escape'); await page.waitForTimeout(1500)
  judge('word sheet occurrences', await sample(page, () => page.locator('[aria-label*="Strong’s"]').first().click()))
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  // the chapter picker's books and a work's contents are cells (PopIn), not rows: not sampled here
  await ctx.close()
}

await actx.close()
await browser.close()
console.log(errors.length ? `ERRORS:\n${[...new Set(errors)].join('\n')}` : 'no page errors')
if (errors.length) process.exitCode = 1
