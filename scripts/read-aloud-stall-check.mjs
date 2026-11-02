// Read aloud when the app's timers are held back (Android stops them with the app off screen, reports #21 and #28): the
// page's timers are held from 0.8 s before a verse ends, so the stop at that verse comes late. Nothing may be heard
// twice (a seek back over audio already played, or an ended recording started again), and no stop may cut into the
// next verse, with a pause between verses and without. Romans 16 is a reader's report (1.2.2), held where silence in
// the recording parts two verses and where none does; Psalm 117 is held past its end. Needs a server with
// tts/alec/45-16.* and 19-117.*; BASE=<the brand's site> (shared/brand.json `site`) has them, and DIST=client/dist
// serves this build's files in place of the site's own.
import { chromium } from 'playwright'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const dist = process.env.DIST
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2' }
const marksOf = async (book, chapter) => (await fetch(`${base}/api/tts/alec/${book}/${chapter}`)).json()
// the first verse followed by silence in the recording before the next, then the first after it that runs straight on
const boundaries = m => {
  const gap = m.verses.findIndex((v, i) => m.verses[i + 1]?.start - v.end > 200)
  const tight = m.verses.findIndex((v, i) => i > gap + 1 && m.verses[i + 1]?.start === v.end)
  return { gap, tight }
}
const romans = { book: 45, chapter: 16, heldMs: 3000, holds: m => [m.verses[boundaries(m).gap].end, m.verses[boundaries(m).tight].end], until: m => m.verses[boundaries(m).tight + 2].start }

const scenarios = [
  { name: 'Romans 16, a pause between verses', pause: 'short', ...romans },
  { name: 'Romans 16, no pause', pause: 'none', ...romans },
  { name: 'Psalm 117, held past its end', book: 19, chapter: 117, pause: 'short', heldMs: 16000, holds: m => [m.heading[1]], until: null },
]

async function listen(s) {
  const marks = await marksOf(s.book, s.chapter)
  const ends = [...(marks.heading ? [marks.heading[1]] : []), ...marks.verses.map(v => v.end)]
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
  if (dist) await ctx.route(`${base}/**`, route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname)
    if (path.startsWith('/api/')) return route.continue()
    const file = existsSync(join(dist, path)) && statSync(join(dist, path)).isFile() ? join(dist, path) : join(dist, 'index.html')
    return route.fulfill({ contentType: types[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) })
  })
  await ctx.addInitScript(({ pause, holds, heldMs }) => {
    localStorage.setItem('berean_prefs', JSON.stringify({ reduceMotion: true, onboarded: true, toured: true, lang: 'en', bible: 'en', ttsVoice: 'alec', ttsSpeed: 1, ttsNumbers: false, ttsHeading: true, ttsPause: pause, ttsWord: true, ttsAutoNext: false, ttsDevice: false }))
    const log = (window.__media = [])
    const recording = el => /\/api\/tts\/[^/]+\/\d+\/\d+\/audio/.test(el.currentSrc || el.src)
    const P = HTMLMediaElement.prototype, play = P.play, pauseFn = P.pause, time = Object.getOwnPropertyDescriptor(P, 'currentTime')
    let audio = null
    P.play = function () { if (recording(this)) { audio = this; log.push({ kind: 'play', t: time.get.call(this) * 1000, ended: this.ended }) } return play.call(this) }
    P.pause = function () { if (recording(this)) log.push({ kind: 'pause', t: time.get.call(this) * 1000 }); return pauseFn.call(this) }
    Object.defineProperty(P, 'currentTime', { get() { return time.get.call(this) }, set(v) { if (recording(this)) log.push({ kind: 'seek', t: time.get.call(this) * 1000, to: v * 1000 }); time.set.call(this, v) }, configurable: true })
    const realSetTimeout = window.setTimeout.bind(window)
    let heldUntil = 0
    window.setTimeout = (fn, ms, ...a) => realSetTimeout(function held() { const left = heldUntil - performance.now(); if (left > 0) return realSetTimeout(held, left); fn(...a) }, ms)
    const watch = () => {
      const t = audio ? time.get.call(audio) * 1000 : 0
      if (holds.length && t >= holds[0] - 800) { holds.shift(); heldUntil = performance.now() + heldMs; log.push({ kind: 'held', t }) }
      if (holds.length) realSetTimeout(watch, 20)
    }
    watch()
  }, { pause: s.pause, holds: s.holds(marks), heldMs: s.heldMs })
  const page = await ctx.newPage()
  await page.goto(`${base}/read/${s.book}/${s.chapter}`, { waitUntil: 'networkidle' })
  await page.getByLabel('Read aloud').first().click()
  const holds = s.holds(marks).length
  await page.waitForFunction(n => window.__media.filter(e => e.kind === 'held').length === n, holds, { timeout: 120_000, polling: 250 })
  if (s.until) await page.waitForFunction(end => window.__media.some(e => e.t > end), s.until(marks), { timeout: 120_000, polling: 250 })
  else await page.waitForTimeout(s.heldMs + 4000)
  const media = await page.evaluate(() => window.__media)
  await browser.close()
  const twice = [
    ...media.filter((e, i) => e.kind === 'seek' && i > 0 && e.to < e.t - 60).map(e => `seek ${Math.round(e.t)} → ${Math.round(e.to)} ms`),
    ...media.filter(e => e.kind === 'play' && e.ended).map(e => `play() at the end (${Math.round(e.t)} ms) starts it again`),
  ]
  const cuts = media.filter(e => e.kind === 'pause' && !ends.some(end => e.t <= end && end - e.t < 400) && e.t < marks.duration - 100).map(e => `${Math.round(e.t)} ms`)
  return { held: media.filter(e => e.kind === 'held').length, holds, twice, cuts }
}

let failed = false
for (const s of scenarios) {
  const r = await listen(s)
  const ok = r.held === r.holds && !r.twice.length && !r.cuts.length
  failed ||= !ok
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${s.name}: timers held ${r.held} of ${r.holds} times · heard twice: ${r.twice.join(', ') || 'nothing'} · stops inside a verse: ${r.cuts.join(', ') || 'none'}`)
}
process.exit(failed ? 1 : 0)
