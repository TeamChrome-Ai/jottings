// Play Store graphics, "The Clean One" style: one story per screenshot, a title with an italic sub-line, the phone
// below on the theme's own background. Paper first, other themes gradually. Runs against a LOCAL server whose
// database is plaintext (no BEREAN_DB_KEY) so a demo reader with a streak can be seeded for the stats story.
//   BEREAN_DATA=/tmp/bdbtest node scripts/play-assets.mjs        (BASE defaults to http://127.0.0.1:8787)
// BEREAN_NEUTERED=1 makes the stripped release's set (docs/EDITION.md): no footnote or 1961-table story, run against a
// server with `berean cleanse` on.
import { chromium } from 'playwright'
import { mkdirSync, copyFileSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { BRAND, NOUN } from './brand.mjs'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const out = process.env.OUT ?? `${process.env.HOME}/exports/play`
const dataDir = process.env.BEREAN_DATA ?? '/tmp/bdbtest'
mkdirSync(out, { recursive: true })

// ---- demo reader: 12 days of reading so streaks, tiles, badges and book bars have something to show
async function seedDemo() {
  const json = { 'content-type': 'application/json' }
  const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: json, body: JSON.stringify({ handle: 'demo', display_name: 'Demo reader', password: 'demo-pw-12345' }) })
  const token = reg.ok ? (await reg.json()).token : (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ handle: 'demo', password: 'demo-pw-12345' }) })).json()).token
  const me = await (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } })).json()
  const uid = me.user.id
  const db = new DatabaseSync(`${dataDir}/berean.db`)
  const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
  const ins = db.prepare('INSERT OR REPLACE INTO activity_days (user_id, date, active_seconds, pages, chapters) VALUES (?, ?, ?, ?, ?)')
  const secs = [1140, 900, 1500, 780, 1320, 960, 1200, 840, 1500, 720, 1080, 660]
  secs.forEach((s, i) => ins.run(uid, day(i), s, Math.round(s / 240), Math.max(1, Math.round(s / 300))))
  const cr = db.prepare('INSERT OR REPLACE INTO chapters_read (user_id, book, chapter, first_read_at, times) VALUES (?, ?, ?, ?, 1)')
  const read = [[43, 1], [43, 2], [43, 3], [43, 4], [43, 5], [43, 6], [45, 8], [19, 23], [19, 1], [1, 1], [1, 2], [40, 5], [40, 6], [40, 7], [66, 21], [66, 22]]
  read.forEach(([b, c], i) => cr.run(uid, b, c, `${day(Math.min(11, i))}T09:00:00.000Z`))
  const bd = db.prepare('INSERT OR REPLACE INTO badges (user_id, code, earned_at) VALUES (?, ?, ?)')
  for (const [code, d] of [['first_page', 11], ['streak_3', 8], ['streak_7', 4], ['hour_1', 6]]) bd.run(uid, code, `${day(d)}T09:30:00.000Z`)
  db.close()
  return { token, user: me.user }
}

// bg, text, muted, accent per theme (mirrors client/src/theme.ts)
const THEMES = {
  paper: ['#faf7f2', '#221b16', '#6b5f55', '#7c2d12'], sepia: ['#f3e9d4', '#382b1c', '#6e5d45', '#8a3a0e'], mint: ['#ecf5ef', '#10302a', '#4f6d64', '#0b6b61'],
  lavender: ['#f3f0fb', '#221a3d', '#625a7d', '#6427cf'], slate: ['#1c1917', '#ebe6e1', '#a79f97', '#f6b17f'], midnight: ['#0e1628', '#e3e9f3', '#95a3ba', '#8ccbff'],
  forest: ['#0e1d16', '#dbf3e3', '#8db29c', '#72e0b3'], 'black-gold': ['#000000', '#e8e6e3', '#8f8f8f', '#fbbf24'],
}
// scroll the reading pane by `dy` px (mouse wheel is unreliable when the pointer sits over the toolbar)
const nudge = (p, dy) => p.evaluate(dy => { for (const el of document.querySelectorAll('div')) { const st = getComputedStyle(el); if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50) { el.scrollTop += dy; return } } }, dy)
const DARK = new Set(['slate', 'midnight', 'forest', 'black-gold'])
const prefs = theme => ({ theme, themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true, align: 'center', width: 'medium', wordLookup: 'strongs' })

// the stories, in order: basic Paper first, other themes gradually
const NEUTERED = process.env.BEREAN_NEUTERED === '1'
const ALL_STORIES = [
  NEUTERED ? { key: 'read', path: '/read/43/3', theme: 'paper', title: 'Read the Darby text', sub: 'the whole Bible, in paragraphs', wait: 'text=Nicodemus' } :
  { key: 'read', path: '/read/43/3', theme: 'paper', title: 'Read the Darby text', sub: 'with every footnote, in place', wait: 'text=Nicodemus',
    extra: async p => { await p.locator('[aria-label="Note h"]:visible').first().click(); await p.waitForTimeout(400); await p.mouse.wheel(0, 300); await p.waitForTimeout(300) } },
  { key: 'follow', path: '/read/43/3', theme: 'paper', title: 'Follow the references', sub: 'a footnote link lands on its verse', wait: 'text=Nicodemus',
    extra: async p => {
      // word lookup left the reader's toolbar for its More menu (build 34), so this shot no longer shows Strong's underlines
      await p.locator('[aria-label="Note c"]:visible').first().click({ timeout: 8000 }); await p.waitForTimeout(400)   // "as ver. 15."
      await p.locator('[role=link]:visible', { hasText: 'ver. 15' }).first().click({ timeout: 8000 }); await p.waitForTimeout(250)   // verse 15 flashes
      await p.mouse.wheel(0, -150); await p.waitForTimeout(250)                                   // show the whole verse
    } },
  { key: 'find', path: '/read/45/8?v=28', theme: 'paper', title: 'Find any verse', sub: '“Rom 8:28” resolving', wait: 'text=all things work together', extra: async p => { await nudge(p, -110); await p.waitForTimeout(250) } },
  { key: 'night', path: '/read/19/23', theme: 'black-gold', title: 'Read at night', sub: 'true black for OLED', wait: 'text=shepherd' },
  { key: 'anywhere', path: '/read/40/5', theme: 'sepia', title: 'Read anywhere', sub: 'works offline, always', wait: 'text=Blessed' },
  { key: 'kings', path: '/chronology', theme: 'forest', title: 'Kings and prophets', sub: 'the 1961 edition’s chronological table', wait: 'text=Rehoboam' },
  { key: 'place', path: '/stats', theme: 'mint', title: 'Keep your place', sub: 'streaks and stats', wait: 'text=Longest', signedIn: true, extra: async p => { await p.waitForTimeout(1200) } },
  { key: 'yours', path: '/themes', theme: 'lavender', title: 'Make it yours', sub: '25 themes, changed anywhere', wait: 'text=Follow the system' },
]
// the reader also renders the neighbouring chapters off-screen, so a marker's first match can be hidden: :visible
const STORIES = NEUTERED ? ALL_STORIES.filter(s => s.key !== 'follow' && s.key !== 'kings') : ALL_STORIES
const TABLET_KEYS = NEUTERED ? ['read', 'night', 'anywhere', 'yours'] : ['read', 'night', 'kings', 'yours']
const DEVICES = [
  { name: 'phone', view: [360, 700], scale: 3, frame: [1080, 1920], shot: [880, 1711], top: 260, title: 64, sub: 30, stories: STORIES },
  { name: 'tablet7', view: [600, 960], scale: 2, frame: [1200, 1920], shot: [1000, 1600], top: 220, title: 56, sub: 26, stories: STORIES.filter(s => TABLET_KEYS.includes(s.key)) },
  { name: 'tablet10', view: [800, 1280], scale: 2, frame: [1600, 2560], shot: [1320, 2112], top: 300, title: 72, sub: 34, stories: STORIES.filter(s => TABLET_KEYS.includes(s.key)) },
]

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})   // CHROME=… when the installed browser is not the one this Playwright wants
const demo = await seedDemo()
for (const dev of DEVICES) {
  let i = 0
  for (const s of dev.stories) {
    i++
    const [bg, fg, muted, accent] = THEMES[s.theme]
    const ctx = await browser.newContext({ viewport: { width: dev.view[0], height: dev.view[1] }, deviceScaleFactor: dev.scale, isMobile: true, hasTouch: true, colorScheme: DARK.has(s.theme) ? 'dark' : 'light' })
    await ctx.addInitScript(([p, d]) => { localStorage.setItem('berean_prefs', JSON.stringify(p)); if (d) { localStorage.setItem('berean_token', d.token); localStorage.setItem('berean_user', JSON.stringify(d.user)) } }, [prefs(s.theme), s.signedIn ? demo : null])
    const page = await ctx.newPage()
    await page.goto(base + s.path, { waitUntil: 'networkidle' })
    await page.waitForSelector(s.wait, { timeout: 30000 }).catch(() => console.log('  (wait failed)', s.key))
    await page.waitForTimeout(900)
    if (s.extra) { try { await s.extra(page) } catch (e) { console.log('  (extra failed)', s.key, e.message.split('\n')[0]) } }
    const raw = await page.screenshot({ type: 'png' })
    await ctx.close()
    const fctx = await browser.newContext({ viewport: { width: dev.frame[0], height: dev.frame[1] }, deviceScaleFactor: 1 })
    const fpage = await fctx.newPage()
    await fpage.setContent(`<html><body style="margin:0;width:${dev.frame[0]}px;height:${dev.frame[1]}px;background:${bg};display:flex;flex-direction:column;align-items:center;font-family:Georgia,serif;overflow:hidden">
      <div style="height:${dev.top}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 80px;gap:10px">
        <div style="font-size:${dev.title}px;line-height:1.1;font-weight:600;color:${fg};letter-spacing:-.01em">${s.title}</div>
        <div style="font-size:${dev.sub}px;line-height:1.3;font-style:italic;color:${muted}">${s.sub}</div>
      </div>
      <div style="width:6px;height:6px;border-radius:3px;background:${accent};margin-bottom:26px"></div>
      <img src="data:image/png;base64,${raw.toString('base64')}" style="width:${dev.shot[0]}px;height:${dev.shot[1]}px;border-radius:44px;box-shadow:0 40px 90px rgba(0,0,0,${DARK.has(s.theme) ? .6 : .18});border:1px solid rgba(0,0,0,${DARK.has(s.theme) ? .5 : .08})">
    </body></html>`)
    await fpage.waitForTimeout(400)
    await fpage.screenshot({ path: `${out}/${dev.name}-${i}-${s.key}.png` })
    await fctx.close()
    console.log(`${dev.name}-${i}`, s.key, s.theme)
  }
}
// feature graphic: icon glyph + wordmark on Paper cream with a row of theme chips
const icon = readFileSync(`${process.cwd()}/client/public/icon-512.png`).toString('base64')
const chips = Object.values(THEMES).map(([b, , , a]) => `<div style="width:54px;height:54px;border-radius:16px;background:${b};border:2px solid rgba(0,0,0,.08);display:flex;align-items:center;justify-content:center"><div style="width:18px;height:18px;border-radius:9px;background:${a}"></div></div>`).join('')
const ctx = await browser.newContext({ viewport: { width: 1024, height: 500 } })
const page = await ctx.newPage()
await page.setContent(`<html><body style="margin:0;width:1024px;height:500px;background:#faf7f2;display:flex;align-items:center;justify-content:center;font-family:Georgia,serif;color:#221b16">
<div style="display:flex;align-items:center;gap:44px"><img src="data:image/png;base64,${icon}" width="200" height="200" style="border-radius:48px">
<div><div style="font-size:62px;font-weight:600;letter-spacing:-.01em;line-height:1.05">${BRAND.name}</div><div style="font-size:24px;color:#6b5f55;margin-top:12px;font-family:system-ui,sans-serif">${NEUTERED ? `Darby’s New Translation · offline · read aloud · your ${NOUN.many}` : `Darby’s New Translation · every footnote · offline · your ${NOUN.many}`}</div>
<div style="display:flex;gap:10px;margin-top:26px">${chips}</div></div></div></body></html>`)
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/feature.png` })
await browser.close()
copyFileSync(`${process.cwd()}/client/public/icon-512.png`, `${out}/icon-512.png`)
console.log('play assets in', out)
