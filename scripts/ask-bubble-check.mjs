// Ask's bubble on Search (client/src/components/AskBubble.tsx) at 412 px and on the desktop, against servers that talk
// to a local stand-in for chat completions instead of a real model, as scripts/assistant-check.mjs does. The script
// starts the stand-in and two servers itself (one with Ask on, one with no chat key) and signs a reader in:
//
//   BIN=rs/target/release/berean [MINISTRY_DB=data/ministry.db] [OUT=…] [WORK=…] [VIDEO=1] node scripts/ask-bubble-check.mjs
//
// BIN must have been built after `npm run build`, which embeds the web app. The stand-in only counts: no lane here
// sends a message, and the count of model calls must end where it began. Every check prints ok or FAIL; the stills
// (ask-bubble-search, -draft, -signed-out, -desktop and one per other lane) and the servers' logs go in OUT, and
// VIDEO=1 adds the film (a question typed, the bubble tapped, Ask open with the words): ask-bubble.webm, and
// ask-bubble.mp4 where there is an ffmpeg to make it.
import http from 'node:http'
import net from 'node:net'
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const BIN = resolve(process.env.BIN ?? 'rs/target/release/berean')
const MINISTRY_DB = resolve(process.env.MINISTRY_DB ?? 'data/ministry.db')
const OUT = resolve(process.env.OUT ?? '/tmp/ask-bubble-check')
const WORK = resolve(process.env.WORK ?? `${OUT}/work`)
const PHONE = { width: 412, height: 915 }, DESKTOP = { width: 1280, height: 800 }
const QUESTION = 'how can I be sure I am saved'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)) }) })
let passed = 0, failed = 0
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (cond) passed++; else failed++ }

// ---------- the stand-in: it answers "Hello." and keeps every call it was sent ----------

const chats = []
const stub = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/calls') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(chats)) }
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    const b = JSON.parse(raw || '{}')
    chats.push({ url: req.url, messages: b.messages })
    if (req.url === '/v1/messages') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: '{"phrases":[],"verses":[],"related":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }))
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = v => res.write(`data: ${JSON.stringify(v)}\n\n`)
    send({ choices: [{ index: 0, delta: { content: 'Hello.' } }] })
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    send({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } })
    res.end('data: [DONE]\n\n')
  })
})
const stubPort = await freePort()
await new Promise(r => stub.listen(stubPort, '127.0.0.1', r))
const STUB = `http://127.0.0.1:${stubPort}`

for (const d of [OUT, WORK]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }) }

// ---------- the servers ----------

const servers = []
process.on('exit', () => { for (const s of servers) s.kill() })
async function start(name, env) {
  const port = await freePort()
  const log = `${OUT}/${name}.log`
  const vars = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), NO_COLOR: '1', BEREAN_DB: `${WORK}/${name}.db`, BEREAN_MINISTRY_DB: MINISTRY_DB, BEREAN_MINISTRY_VEC: `${WORK}/none.bin`,
    BEREAN_AI_KEY: 'test-key', BEREAN_EXPAND_URL: STUB, BEREAN_CHAT_KEY: 'test-chat-key', BEREAN_CHAT_URL: STUB, ...env }
  const child = spawn(BIN, [], { env: Object.fromEntries(Object.entries(vars).filter(([, v]) => v !== undefined)), stdio: ['ignore', openSync(log, 'w'), openSync(log, 'a')] })
  servers.push(child)
  const root = `http://127.0.0.1:${port}`
  let up = false
  for (let i = 0; i < 240 && !up && child.exitCode === null; i++) { try { up = (await fetch(`${root}/api/edition`)).ok } catch {} if (!up) await sleep(250) }
  ok(`${name}: the server is up`, up)
  return { root, log }
}
const [on, off] = await Promise.all([start('on', {}), start('off', { BEREAN_CHAT_KEY: undefined })])
const states = await Promise.all([on, off].map(async s => (await (await fetch(`${s.root}/api/assistant`)).json()).on))
ok(`one server has Ask on and the other has it off (${states})`, states[0] === true && states[1] === false)
/** Model calls so far: what the stand-in was sent, and what the server with Ask on logged. */
const modelCalls = () => chats.length + readFileSync(on.log, 'utf8').split('\n').filter(l => l.includes('chat call')).length

async function register(root, handle) {
  const r = await fetch(`${root}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle, display_name: 'Bubble reader', password: 'ask-bubble-12345' }) })
  return r.json()
}
const stamp = Date.now().toString(36).slice(-5)
const reader = await register(on.root, `bub${stamp}a`)
const elsewhere = await register(off.root, `bub${stamp}b`)
ok('two readers signed up', !!(reader.token && elsewhere.token))
const callsAtStart = modelCalls()

// ---------- the browser ----------

const { chromium } = await import('playwright')
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const errors = []
const PREFS = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true, align: 'center', width: 'medium', onboarded: true, toured: true }
/**
 * A page at `path` of `root`, signed in as `who` (or not): a phone unless `view` is the desktop. Before anything of the
 * app runs, the page is set to note how the bubble arrives: how many animations hold it in the commit that mounts it.
 */
async function open(root, path, who, { view = PHONE, prefs = {}, video = false } = {}) {
  const phone = view.width < 1024
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(video ? { recordVideo: { dir: `${OUT}/video`, size: view } } : {}) })
  await ctx.addInitScript(([p, w]) => {
    if (!sessionStorage.getItem('primed')) {
      localStorage.setItem('berean_prefs', p)
      if (w) { localStorage.setItem('berean_token', w.token); localStorage.setItem('berean_user', JSON.stringify(w.user)) }
      sessionStorage.setItem('primed', '1')
    }
    // the document has no root yet when this runs
    const watch = () => new MutationObserver(() => {
      const el = document.querySelector('[data-testid="ask-bubble"]')
      if (!el) { window.__bubbleHere = false; return }
      if (window.__bubbleHere) return
      window.__bubbleHere = true
      const held = document.getAnimations().filter(a => a.effect?.target?.contains(el))
      window.__bubbleArrival = { animations: held.length, opacity: Math.min(...[el, ...held.map(a => a.effect.target)].map(e => Number(getComputedStyle(e).opacity))) }
    }).observe(document.documentElement, { childList: true, subtree: true })
    if (document.documentElement) watch(); else document.addEventListener('DOMContentLoaded', watch)
  }, [JSON.stringify({ ...PREFS, ...prefs }), who ? { token: who.token, user: who.user } : null])
  const page = await ctx.newPage()
  page.on('pageerror', e => { errors.push(`${path}: ${e.message}`); console.log(`page error at ${page.url()}: ${e.message}`) })
  await page.goto(`${root}${path}`, { waitUntil: 'networkidle' })
  return page
}
const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}.png` }); console.log(`shot ${OUT}/${name}.png`) }
const bubble = page => page.getByTestId('ask-bubble').filter({ visible: true })
const there = async page => { await bubble(page).first().waitFor({ timeout: 15000 }).catch(() => {}); return (await bubble(page).count()) === 1 }
const field = page => page.getByPlaceholder('jn 3:16, words, or G1320')
const box = page => page.getByPlaceholder('Ask about the Bible or the app')
/** What Ask's box holds, or null when there is no box on the screen. */
const boxHolds = page => box(page).inputValue({ timeout: 8000 }).catch(() => null)
const go = page => page.getByRole('button', { name: 'Go', exact: true })
const rect = loc => loc.first().evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } })
const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
const near = (a, b, by = 1) => Math.abs(a - b) <= by
/** Searches `words` and waits for the verse count. */
async function search(page, words) {
  await field(page).fill(words)
  await go(page).click()
  await page.getByText(/^\d[\d,]* verses? · \d+ ms/).filter({ visible: true }).first().waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(500)
}
/** Taps the bubble and waits for the screen it opens. */
async function tap(page, path) {
  await bubble(page).click()
  await page.waitForURL(u => u.pathname === path, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(600)
  return new URL(page.url())
}
/** The scroll that holds the results, at its very end; what is topmost at an element's centre. */
const toEnd = page => page.getByRole('link').filter({ visible: true }).last().evaluate(el => { let s = el.parentElement; while (s && !(s.scrollHeight > s.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement; if (s) s.scrollTop = s.scrollHeight; return !!s })
const covered = page => bubble(page).evaluate(el => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && !el.contains(top) && !top.contains(el) })
const pressScale = async page => {
  const r = await rect(bubble(page))
  await page.mouse.move(r.left + r.width / 2, r.top + r.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(260)
  const scale = await bubble(page).evaluate(el => { const t = getComputedStyle(el).transform; return t === 'none' ? 1 : new DOMMatrixReadOnly(t).a })
  // let go off the bubble: a press that opens nothing
  await page.mouse.move(r.left - 150, r.top - 200)
  await page.mouse.up()
  await page.waitForTimeout(500)
  return scale
}

// ---------- 412 px, signed in, Reduce animation on (the stills are of the screen at rest) ----------
{
  const page = await open(on.root, '/search', reader)
  ok('412: the bubble is on Search when the server has Ask on', await there(page))
  // the open tab's screen (the page's main) ends where the tab bar begins
  const b = await rect(bubble(page)), g = await rect(go(page)), bar = { top: (await rect(page.getByRole('main').filter({ visible: true }))).bottom }
  const look = await bubble(page).evaluate(el => { const s = getComputedStyle(el); return { bg: s.backgroundColor, radius: parseFloat(s.borderRadius), text: el.textContent, svg: el.querySelectorAll('svg').length } })
  const accent = await go(page).evaluate(el => getComputedStyle(el).backgroundColor)
  ok(`412: it is a pill with an icon and the word Ask, in the accent (${look.text}, ${look.svg} icon, ${look.bg}, radius ${look.radius} of ${b.height} high)`, look.text === 'Ask' && look.svg === 1 && look.bg === accent && look.radius >= b.height / 2 && b.height === 44)
  ok(`412: pinned at the bottom right: its right edge under Go’s (${b.right} / ${g.right}), 16 above the tab bar (${b.bottom} / ${bar.top})`, near(b.right, g.right) && near(bar.top - b.bottom, 16) && near(bar.top, PHONE.height - 68) && b.right <= PHONE.width - 20 + 1)
  ok('412: signed in, it is named Ask and nothing more', (await bubble(page).getAttribute('aria-label')) === null && (await page.getByRole('button', { name: 'Ask', exact: true }).filter({ visible: true }).count()) === 1)
  const arrival = await page.evaluate(() => window.__bubbleArrival)
  const scale = await pressScale(page)
  ok(`Reduce animation: it arrives with no motion (${JSON.stringify(arrival)}) and a press does not move it (scale ${scale})`, arrival?.animations === 0 && arrival?.opacity === 1 && scale === 1 && new URL(page.url()).pathname === '/search')

  // an empty field: Ask, with nothing in its box
  const empty = await tap(page, '/ask')
  ok(`412: with an empty field it opens Ask (${empty.pathname}${empty.search}), its box empty`, empty.pathname === '/ask' && empty.search === '' && (await boxHolds(page)) === '')
  await page.goBack()
  await there(page)

  // results: it stays put while they scroll, and the last one scrolls clear of it
  await search(page, 'grace')
  const rows = await page.getByRole('link').filter({ visible: true }).count()
  const before = await rect(bubble(page))
  await shot(page, 'ask-bubble-search')
  const scrolled = await toEnd(page)
  await page.waitForTimeout(400)
  const after = await rect(bubble(page)), last = await rect(page.getByRole('link').filter({ visible: true }).last())
  ok(`412: it stays put while the ${rows} results scroll (${before.top} → ${after.top})`, scrolled && rows > 20 && before.top === after.top && before.left === after.left)
  ok(`412: the last result can be scrolled clear of it (the row ends at ${last.bottom}, the bubble begins at ${after.top})`, last.bottom + 8 <= after.top && last.bottom > 0)
  await shot(page, 'scrolled-to-the-end')
  ok(`412: nothing wider than the phone (${await page.evaluate(() => document.documentElement.scrollWidth)} px)`, (await page.evaluate(() => document.documentElement.scrollWidth)) <= PHONE.width)

  // the suggestions: the last searches under an empty field, and a misspelt book's "Did you mean"
  await page.getByRole('button', { name: 'Clear the search' }).click()
  await page.getByRole('button', { name: 'Recent searches' }).click()
  await page.waitForTimeout(300)
  const recent = page.getByRole('link', { name: /^Search / }).filter({ visible: true })
  const recents = await recent.evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }))
  ok(`412: it does not sit on the recent searches (${recents.length} shown)`, recents.length > 0 && recents.every(r => apart(r, after)))
  await field(page).fill('Pslams')
  await go(page).click()
  await page.getByText('Did you mean').waitFor({ timeout: 15000 }).catch(() => {})
  ok('412: … nor on “Did you mean”', apart(await rect(page.getByRole('button', { name: 'Psalms', exact: true })), await rect(bubble(page))))
  await shot(page, 'did-you-mean')

  // the keyboard, as a phone's browser shows it: the window keeps its height and less of it shows
  await page.evaluate(() => { const v = window.visualViewport; Object.defineProperty(v, 'height', { configurable: true, get: () => window.innerHeight - 320 }); v.dispatchEvent(new Event('resize')) })
  await page.waitForTimeout(300)
  const hidden = (await bubble(page).count()) === 0
  await page.evaluate(() => { const v = window.visualViewport; delete v.height; v.dispatchEvent(new Event('resize')) })
  ok('412: while the keyboard is up it is not there, and it is back when the keyboard goes', hidden && await there(page))

  // a question: carried into Ask's box, and not sent
  const calls = modelCalls()
  await field(page).fill(QUESTION)
  const asked = await tap(page, '/ask')
  await page.waitForTimeout(800)
  await shot(page, 'question-carried')
  ok(`412: with “${QUESTION}” typed it opens Ask with those words in the box (“${await boxHolds(page)}”)`, asked.pathname === '/ask' && (await boxHolds(page)) === QUESTION)
  // the words are in the box and nowhere else on the screen: no reader's message was made of them
  const said = await page.evaluate(q => [...document.querySelectorAll('div, span')].filter(e => e.children.length === 0 && e.textContent.trim() === q).length, QUESTION)
  ok(`412: … and nothing is sent: no message in the conversation (${said}), Send waiting, no model call (${modelCalls() - calls})`, modelCalls() === calls && said === 0 && await page.getByRole('button', { name: 'Send', exact: true }).isEnabled({ timeout: 8000 }).catch(() => false) && (await page.getByRole('button', { name: 'Stop' }).count()) === 0 && !(await page.evaluate(() => localStorage.getItem('berean_assistant'))))
  ok(`412: the draft is off the route once it is in the box (${new URL(page.url()).search || 'no query'})`, new URL(page.url()).search === '')
  await shot(page, 'ask-bubble-draft')
  await page.reload({ waitUntil: 'networkidle' })
  await box(page).waitFor({ timeout: 15000 }).catch(() => {})
  ok('412: read once: Ask opened again has an empty box', (await boxHolds(page)) === '')
  await page.goto(`${on.root}/ask?draft=${encodeURIComponent(QUESTION)}`, { waitUntil: 'networkidle' })
  await box(page).waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(600)
  ok('412: the draft is a route param of Ask, taken off the address as it is read', (await boxHolds(page)) === QUESTION && new URL(page.url()).search === '' && modelCalls() === calls)

  // a reference and a Strong's number are Search's own: nothing is carried
  for (const typed of ['jn 3:16', 'G1320']) {
    await page.goto(`${on.root}/search`, { waitUntil: 'networkidle' })
    await there(page)
    await field(page).fill(typed)
    const u = await tap(page, '/ask')
    ok(`412: with “${typed}” typed it carries nothing (${u.pathname}${u.search}, the box “${await boxHolds(page)}”)`, u.pathname === '/ask' && u.search === '' && (await boxHolds(page)) === '')
  }

  // a sheet: the word sheet a Strong's number opens
  await page.goto(`${on.root}/search`, { waitUntil: 'networkidle' })
  await there(page)
  await field(page).fill('g1320')
  await go(page).click()
  await page.getByRole('dialog').getByText('G1320', { exact: true }).first().waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(500)
  ok('412: it is not shown over an open sheet (the sheet is what is there)', (await page.getByTestId('sheet-panel').count()) === 1 && await covered(page))
  await shot(page, 'sheet')
  await page.context().close()
}

// ---------- 412 px, signed out ----------
{
  const calls = modelCalls()
  const page = await open(on.root, '/search', null)
  ok('signed out: the bubble is there', await there(page))
  const label = await bubble(page).getAttribute('aria-label')
  ok(`signed out: its label says Ask needs an account (“${label}”)`, label === 'Ask. Needs an account. Sign in to ask')
  await field(page).fill(QUESTION)
  await shot(page, 'signed-out-search')
  const u = await tap(page, '/login')
  ok(`signed out: it opens sign-in (${u.pathname}${u.search}), and no words go with it`, u.pathname === '/login' && u.search === '')
  await shot(page, 'ask-bubble-signed-out')
  ok(`signed out: no model call (${modelCalls() - calls})`, modelCalls() === calls)
  await page.context().close()
}

// ---------- 412 px, the server with Ask off ----------
{
  const page = await open(off.root, '/search', elsewhere)
  await field(page).waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)
  ok('Ask off: the bubble is absent from Search', (await page.getByTestId('ask-bubble').count()) === 0 && await field(page).isVisible())
  await search(page, 'grace')
  ok('Ask off: … and stays absent over results', (await page.getByTestId('ask-bubble').count()) === 0 && (await page.getByRole('link').filter({ visible: true }).count()) > 20)
  await shot(page, 'off')
  await page.context().close()
}

// ---------- 412 px, French ----------
{
  const page = await open(on.root, '/search', reader, { prefs: { lang: 'fr' } })
  ok('French: the bubble is there', await there(page))
  const b = await rect(bubble(page))
  const word = await bubble(page).evaluate(el => { const t = [...el.querySelectorAll('div, span')].find(e => e.children.length === 0 && e.textContent); return { text: t?.textContent, cut: !t || t.scrollWidth > t.clientWidth + 1 } })
  ok(`French: the label is translated and not cut off (“${word.text}”, ${Math.round(b.width)} px wide, ${b.height} high)`, word.text === 'Demander' && !word.cut && b.height === 44 && b.left >= 20 && b.right <= PHONE.width - 20 + 1)
  await shot(page, 'french')
  await page.context().close()
  const out = await open(on.root, '/search', null, { prefs: { lang: 'fr' } })
  await there(out)
  const label = await bubble(out).getAttribute('aria-label')
  ok(`French: signed out, its label is French too (“${label}”)`, !!label && label.startsWith('Demander. ') && !/Sign in|account/.test(label))
  await out.context().close()
}

// ---------- 412 px, animation on: what Reduce animation turns off is there to turn off ----------
{
  const page = await open(on.root, '/search', reader, { prefs: { reduceMotion: false } })
  await there(page)
  const arrival = await page.evaluate(() => window.__bubbleArrival)
  await page.waitForTimeout(900)
  const rest = await bubble(page).evaluate(el => document.getAnimations().filter(a => a.effect?.target?.contains(el)).length)
  const scale = await pressScale(page)
  ok(`animation on: it arrives with the house entrance (${JSON.stringify(arrival)}, ${rest} running at rest) and a press scales it (${scale.toFixed(3)})`, arrival?.animations === 1 && arrival.opacity < 1 && rest === 0 && near(scale, 0.94, 0.011))
  await page.context().close()
}

// ---------- the desktop ----------
{
  const page = await open(on.root, '/search', reader, { view: DESKTOP })
  ok('desktop: the bubble is on Search', await there(page))
  await search(page, 'grace')
  const b = await rect(bubble(page)), g = await rect(go(page)), rail = await rect(page.getByRole('tablist'))
  ok(`desktop: under Go at the right edge of the screen’s column (${b.right} / ${g.right}), 16 above the window’s foot (${b.bottom} of ${DESKTOP.height}), clear of the rail (${rail.right} < ${b.left})`, near(b.right, g.right) && near(DESKTOP.height - b.bottom, 16) && rail.right < b.left && rail.width === 80)
  await shot(page, 'ask-bubble-desktop')
  await toEnd(page)
  await page.waitForTimeout(400)
  const after = await rect(bubble(page)), last = await rect(page.getByRole('link').filter({ visible: true }).last())
  ok(`desktop: it stays put, and the last result scrolls clear of it (${last.bottom} / ${after.top})`, after.top === b.top && last.bottom + 8 <= after.top && last.bottom > 0)
  await field(page).fill('g1320')
  await go(page).click()
  await page.getByRole('dialog').getByText('G1320', { exact: true }).first().waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(500)
  ok('desktop: it is not shown over the dialog a sheet is there (the scrim is over it)', (await page.getByTestId('sheet-dialog').count()) === 1 && await covered(page))
  await shot(page, 'desktop-dialog')
  await page.keyboard.press('Escape')
  await page.getByTestId('sheet-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  const calls = modelCalls()
  await field(page).fill(QUESTION)
  const u = await tap(page, '/ask')
  ok(`desktop: the question goes into Ask’s box unsent (“${await boxHolds(page)}”, ${modelCalls() - calls} model calls)`, u.pathname === '/ask' && (await boxHolds(page)) === QUESTION && modelCalls() === calls)
  await shot(page, 'desktop-draft')
  await page.context().close()
}

// ---------- the film: a question typed, the bubble tapped, Ask open with the words ----------
if (process.env.VIDEO) {
  const page = await open(on.root, '/search', reader, { prefs: { reduceMotion: false }, video: true })
  // a mark where the finger lands, for whoever watches
  const finger = async loc => {
    const r = await rect(loc)
    await page.evaluate(([x, y]) => {
      const d = document.createElement('div')
      d.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:22px;background:rgba(0,0,0,0.28);z-index:99999;pointer-events:none;transition:opacity 500ms`
      document.body.appendChild(d)
      setTimeout(() => { d.style.opacity = '0' }, 350)
      setTimeout(() => d.remove(), 900)
    }, [r.left + r.width / 2, r.top + r.height / 2])
    await page.waitForTimeout(250)
  }
  await there(page)
  await page.waitForTimeout(2200)
  await finger(field(page))
  await field(page).click()
  await field(page).pressSequentially(QUESTION, { delay: 120 })
  await page.waitForTimeout(1200)
  await finger(go(page))
  await go(page).click()
  await page.waitForTimeout(3200)
  await finger(bubble(page))
  await bubble(page).click()
  await page.waitForURL(u => u.pathname === '/ask', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(4500)
  const film = await page.video().path()
  await page.context().close()
  copyFileSync(film, `${OUT}/ask-bubble.webm`)
  rmSync(`${OUT}/video`, { recursive: true, force: true })
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${OUT}/ask-bubble.webm`, '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p', '-movflags', '+faststart', `${OUT}/ask-bubble.mp4`])
    const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${OUT}/ask-bubble.mp4`]).toString())
    ok(`the film is 15 to 25 seconds (${seconds.toFixed(1)} s, ${OUT}/ask-bubble.mp4)`, seconds >= 15 && seconds <= 25)
  } catch (e) {
    // a machine with no ffmpeg keeps the recording: `ffmpeg -i ask-bubble.webm -vf "pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p" ask-bubble.mp4`
    if (e.code !== 'ENOENT') ok(`the film was made (${e.message.split('\n')[0]})`, false)
    else console.log(`note the film is recorded and not converted: there is no ffmpeg here (${OUT}/ask-bubble.webm)`)
  }
}

ok(`no lane made a model call (${modelCalls() - callsAtStart}: ${chats.length} at the stand-in)`, modelCalls() === callsAtStart && chats.length === 0)
ok(`no page error (${errors.join(' | ')})`, errors.length === 0)
await browser.close()
stub.close()
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
