// Draws the Android home-screen widgets from their real layout code (src/widgets/layouts.tsx) in Chromium: the widget
// picker's previews (assets/widgets/verse.png, streak.png and their -dark siblings, which plugins/withWidgets.js puts
// in drawable-nodpi and drawable-night-nodpi) and one sheet of every state for review. Rerun after changing a layout.
//   usage, from client/: node scripts/widget-previews.mjs [sheet.png]   (default: $TMPDIR/widget-previews.png)
// An approximation of Android's drawing: CSS flexbox stands in for LinearLayout and Nimbus Sans for Roboto; Literata
// is the file the widgets use.
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const client = resolve(import.meta.dirname, '..')
const sheetFile = process.argv[2] ?? join(tmpdir(), 'widget-previews.png')

// the layouts reach react-native only for the library's native bindings, which a drawing never calls
const STUB = '\0native-stub'
const vite = await createServer({
  root: client, configFile: false, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  resolve: { alias: { '@shared': resolve(client, '../shared') } },
  // not handed to Node as they are: the library is bundled, and react-native (from it, the theme and the icons) stubbed
  ssr: { noExternal: ['react-native-android-widget', 'react-native', 'react-native-svg'] },
  plugins: [{
    name: 'native-stub', enforce: 'pre',
    resolveId: id => (id === 'react-native' || id === 'react-native-svg' ? STUB : null),
    load: id => (id === STUB ? `export const Platform = { OS: 'android', select: o => o.android ?? o.native ?? o.default }
export const TurboModuleRegistry = { get: () => null, getEnforcing: () => ({}) }
export const NativeModules = {}
export const StyleSheet = { create: s => s }
export default {}` : null),
  }],
})
const load = path => vite.ssrLoadModule(resolve(client, path))
const { VerseWidget, StreakWidget } = await load('src/widgets/layouts.tsx')
const { verseCard, streakCard } = await load('src/widgets/model.ts')
const { THEME_MAP } = await load('src/theme.ts')
const { votdFor } = await load('../shared/votd.ts')
await vite.close()

// ---------------- the layout tree as HTML ----------------

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
const px = n => `${n}px`
const SANS = `Roboto, 'Nimbus Sans', Arial, sans-serif`

function box(s = {}) {
  const css = { 'box-sizing': 'border-box', 'flex-shrink': 0 }
  for (const k of ['width', 'height']) {
    if (s[k] === 'match_parent') css[k] = '100%'
    else if (typeof s[k] === 'number') css[k] = px(s[k])
  }
  if (s.flex) Object.assign(css, { flex: `${s.flex} 1 0`, 'min-width': 0, 'flex-shrink': 1 })
  const side = (base, v, h, t, r, b, l) => [s[t] ?? s[v] ?? s[base] ?? 0, s[r] ?? s[h] ?? s[base] ?? 0, s[b] ?? s[v] ?? s[base] ?? 0, s[l] ?? s[h] ?? s[base] ?? 0].map(px).join(' ')
  css.padding = side('padding', 'paddingVertical', 'paddingHorizontal', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft')
  css.margin = side('margin', 'marginVertical', 'marginHorizontal', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft')
  if (s.backgroundColor) css.background = s.backgroundColor
  if (s.borderRadius) css['border-radius'] = px(s.borderRadius)
  if (s.borderWidth) css.border = `${px(s.borderWidth)} solid ${s.borderColor ?? 'transparent'}`
  return css
}
const style = css => Object.entries(css).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}:${v}`).join(';')

/** Function components are called through, as the library does, down to its own widgets. */
function html(el) {
  if (el == null || el === false) return ''
  if (Array.isArray(el)) return el.map(html).join('')
  while (!el.type.__name__) { el = el.type(el.props); if (el == null) return '' }
  const { children, style: s = {}, ...p } = el.props
  switch (el.type.__name__) {
    case 'LinearLayoutWidget':
      return `<div style="${style({ ...box(s), display: 'flex', 'flex-direction': s.flexDirection ?? 'column', 'align-items': s.alignItems ?? 'flex-start', 'justify-content': s.justifyContent ?? 'flex-start', gap: s.flexGap ? px(s.flexGap) : undefined })}">${html(children)}</div>`
    case 'TextWidget': {
      const clamp = p.maxLines === 1
        ? { 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' }
        : p.maxLines ? { display: '-webkit-box', '-webkit-box-orient': 'vertical', '-webkit-line-clamp': p.maxLines, overflow: 'hidden' } : {}
      // a TextView is measured within its parent, as max-width does here
      return `<div style="${style({ ...box(s), 'max-width': '100%', ...clamp, 'font-size': px(s.fontSize ?? 12), 'line-height': s.lineHeight ? px(s.lineHeight) : 'normal', 'font-family': s.fontFamily ? `'${s.fontFamily}'` : SANS, 'font-weight': s.fontWeight === 'bold' ? 700 : s.fontWeight ?? 400, color: s.color, 'text-align': s.textAlign })}">${esc(p.text)}</div>`
    }
    case 'SvgWidget':
      return `<div style="${style(box(s))}">${p.svg}</div>`
    default:
      throw new Error(`no drawing for ${el.type.__name__}`)
  }
}

// ---------------- what to draw ----------------

const chapter = (b, c) => JSON.parse(readFileSync(resolve(client, `public/bible/${b}/${c}.json`), 'utf8'))
function dayOf(ref) {
  for (let d = new Date(2026, 0, 1); d.getFullYear() === 2026; d.setDate(d.getDate() + 1)) {
    const r = votdFor(d)
    if (`${r.book}:${r.chapter}:${r.v1}${r.v2 ? `-${r.v2}` : ''}` === ref) return new Date(d)
  }
  throw new Error(`${ref} is no day's verse in 2026`)
}
// Thursday 24 September 2026, evening: the Lord's day to Wednesday read, Friday and Saturday to come
const THURSDAY = new Date(2026, 8, 24, 19, 30)
const met = d => ({ date: d, active_seconds: 700, pages: 0, met: 1 })
const run = { today: '2026-09-24', current: 12, longest: 12, today_active_seconds: 700, today_goal_seconds: 600, days: ['2026-09-24', '2026-09-23', '2026-09-22', '2026-09-21', '2026-09-20', '2026-09-19'].map(met) }
const waiting = { ...run, today_active_seconds: 0, days: run.days.slice(1) }
const lapsed = { ...run, today: '2026-09-21', current: 3, days: run.days.slice(3) }

const verse = at => verseCard(dayOf(at), chapter)
const light = THEME_MAP.paper, dark = THEME_MAP.slate
const V = (card, c, width, height) => ({ el: { type: VerseWidget, props: { card, c, width, height } }, width, height })
const S = (card, c, width, height) => ({ el: { type: StreakWidget, props: { card, c, width, height } }, width, height })

const pickers = {
  'verse.png': V(verse('19:119:105'), light, 340, 170),
  'verse-dark.png': V(verse('19:119:105'), dark, 340, 170),
  'streak.png': S(streakCard(run, THURSDAY), light, 170, 170),
  'streak-dark.png': S(streakCard(run, THURSDAY), dark, 170, 170),
}
const sheet = [
  ['Verse of the day, 4 × 2', [V(verse('43:3:16'), light, 340, 170), V(verse('43:3:16'), dark, 340, 170), V(verse('43:3:16'), THEME_MAP['black-ember'], 340, 170)]],
  ['3 × 2 with a long reading, and larger', [V(verse('46:13:4-7'), light, 250, 170), V(verse('46:13:4-7'), THEME_MAP.sepia, 250, 110), V(verse('23:40:28-29'), dark, 340, 260)]],
  ['Reading streak, 2 × 2: kept, still to read, lapsed, signed out', [S(streakCard(run, THURSDAY), light, 170, 170), S(streakCard({ ...waiting, today_active_seconds: 290 }, THURSDAY), light, 170, 170), S(streakCard(lapsed, THURSDAY), dark, 170, 170), S(streakCard(null, THURSDAY), dark, 170, 170)]],
  ['4 × 1 strip, and 2 × 1', [S(streakCard(waiting, THURSDAY), light, 340, 80), S(streakCard(run, THURSDAY), dark, 340, 80), S(streakCard(run, THURSDAY), light, 170, 80), S(streakCard(null, THURSDAY), light, 340, 80)]],
]

// ---------------- draw ----------------

const literata = readFileSync(resolve(client, 'assets/fonts/Literata-Regular.ttf')).toString('base64')
const page = body => `<!doctype html><html><head><style>
@font-face { font-family: 'Literata-Regular'; src: url(data:font/ttf;base64,${literata}); }
body { margin: 0; font-family: ${SANS}; -webkit-font-smoothing: antialiased; }
.w { position: relative; overflow: hidden; }
</style></head><body>${body}</body></html>`
const widget = (w, id = '') => `<div class="w" ${id} style="width:${px(w.width)};height:${px(w.height)}">${html(w.el)}</div>`

const browser = await chromium.launch()
const tab = await browser.newPage({ deviceScaleFactor: 3 })
const assets = resolve(client, 'assets/widgets')
mkdirSync(assets, { recursive: true })
for (const [file, w] of Object.entries(pickers)) {
  await tab.setContent(page(widget(w, 'id="w"')))
  await tab.evaluate(() => document.fonts.ready)
  await tab.locator('#w').screenshot({ path: join(assets, file), omitBackground: true })
}
await tab.setContent(page(`<div style="background:#8d949c;padding:24px;display:flex;flex-direction:column;gap:20px;width:max-content">${sheet.map(([title, ws]) =>
  `<div style="color:#fff;font-size:13px">${esc(title)}</div><div style="display:flex;gap:16px;align-items:flex-start">${ws.map(w => widget(w)).join('')}</div>`).join('')}</div>`))
await tab.evaluate(() => document.fonts.ready)
await tab.screenshot({ path: sheetFile, fullPage: true })
await browser.close()
console.log(`previews in ${assets}; sheet at ${sheetFile}`)
