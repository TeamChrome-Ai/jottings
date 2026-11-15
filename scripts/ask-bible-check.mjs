// Ask searching the Bible, and the references in its answers as links to their verses (docs/ASSISTANT.md), at 412 px
// against a server that talks to a local stand-in for chat completions instead of a real model, as
// scripts/assistant-check.mjs does. The script starts the stand-in and the server itself and signs a reader in:
//
//   BIN=rs/target/release/berean [MINISTRY_DB=data/ministry.db] [OUT=…] [WORK=…] [VIDEO=1] node scripts/ask-bible-check.mjs
//
// BIN must have been built after `npm run build`, which embeds the web app. The stand-in is scripted per lane from the
// reader's latest message and the tools' results since it: it calls search_bible as a model would and answers with the
// references the search gave. Every check prints ok or FAIL; the stills (ask-bible-links, ask-bible-opened and one per
// other lane) and the server's log go in OUT, and VIDEO=1 adds the film: ask-bible.webm, and ask-bible.mp4 where there
// is an ffmpeg to make it.
import http from 'node:http'
import net from 'node:net'
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, openSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const BIN = resolve(process.env.BIN ?? 'rs/target/release/berean')
const MINISTRY_DB = resolve(process.env.MINISTRY_DB ?? 'data/ministry.db')
const OUT = resolve(process.env.OUT ?? '/tmp/ask-bible-check')
const WORK = resolve(process.env.WORK ?? `${OUT}/work`)
const W = 412, H = 915
const sleep = ms => new Promise(r => setTimeout(r, ms))
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)) }) })
let passed = 0, failed = 0
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (cond) passed++; else failed++ }

// ---------- the stand-in ----------

const WHERE = 'Where does the Bible speak of the good shepherd?'
const WHERE_AND_THEME = 'Where does the Bible speak of the good shepherd? And use a dark theme.'
const GRACE = 'What is it for grace to reign?'
const BERGER = 'Où la Bible parle-t-elle du bon berger ?'
const REGNE = 'Que veut dire que la grâce règne ?'
/** What the stand-in model does for a conversation: calls to tools, or words. */
function script(messages) {
  const u = messages.map(m => m.role).lastIndexOf('user')
  const asked = messages[u].content
  const after = messages.slice(u + 1)
  const step = after.filter(m => m.role === 'assistant').length
  // a tool's result as the model is shown it: JSON, or a library result's plain lines (`[id] author, work, section`,
  // the text under it, a blank line between two), as scripts/assistant-check.mjs reads them
  const shown = content => { try { return JSON.parse(content) } catch { return { paragraphs: content.split('\n\n').map(b => /^\[(\d+)\] /.exec(b)).filter(Boolean).map(([, id]) => ({ id: Number(id) })) } } }
  const results = after.filter(m => m.role === 'tool').map(m => shown(m.content))
  const found = results.find(r => Array.isArray(r.verses))?.verses ?? []
  const para = results.find(r => Array.isArray(r.paragraphs))?.paragraphs?.[0]?.id
  const call = (...calls) => ({ calls })
  const text = t => ({ text: t })
  const [a, b] = found.map(v => v.reference)
  if (/dark theme/i.test(asked)) {
    if (step === 0) return call(['search_bible', { query: '"good shepherd"' }])
    if (step === 1) return call(['change_settings', { theme: 'slate' }])
    return text(`The Lord calls himself the good shepherd in ${a}. I have not changed the theme: ask for it in a message of its own.`)
  }
  if (/good shepherd/i.test(asked)) {
    if (step === 0) return call(['search_bible', { query: '"good shepherd"' }])
    return text(`The Lord calls himself the good shepherd in ${a}, and again in ${b}. John 10:99 is no verse of the Bible, and John 22:1 no chapter.`)
  }
  if (/bon berger/i.test(asked)) {
    if (step === 0) return call(['search_bible', { query: '"good shepherd"', scope: 'John' }])
    return text(`Le Seigneur se nomme le bon berger en ${a.replace('John', 'Jean')} et en ${b.replace('John', 'Jean')}.`)
  }
  if (/grâce règne/i.test(asked)) {
    if (step === 0) return call(['search_library', { question: 'grace reigns through righteousness' }], ['search_bible', { query: 'grace reign righteousness', scope: 'Romans' }])
    return text(`La grâce règne par la justice, selon ${a.replace('Romans', 'Romains')} [${para}]. ${a.replace('Romans', 'Romains')} parle de la vie éternelle. Elle ne manque jamais.`)
  }
  if (/grace to reign/i.test(asked)) {
    if (step === 0) return call(['search_library', { question: 'grace reigns through righteousness' }], ['search_bible', { query: 'grace reign righteousness', scope: 'Romans' }])
    return text(`Grace reigns through righteousness, as ${a} says [${para}]. ${a} speaks of eternal life. It never fails.`)
  }
  return text('Hello.')
}
const EXPANSION = { phrases: ['the grace of God', 'grace reigns', 'by grace are ye saved'], verses: ['Ephesians 2:8', 'Romans 5:21', 'Titus 2:11'], related: ['the God of all grace'] }
const chats = []
const stub = http.createServer((req, res) => {
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', async () => {
    const b = JSON.parse(raw || '{}')
    if (req.url === '/v1/messages') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: JSON.stringify(EXPANSION) }], stop_reason: 'end_turn', usage: { input_tokens: 437, output_tokens: 164 } }))
    }
    const said = script(b.messages)
    chats.push({ messages: b.messages, tools: (b.tools ?? []).map(t => t.function.name), said })
    const n = chats.length
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = v => res.write(`data: ${JSON.stringify(v)}\n\n`)
    if (said.text) {
      for (const piece of said.text.match(/.{1,12}/gs)) { send({ choices: [{ index: 0, delta: { content: piece } }] }); await sleep(Number(process.env.PACE ?? 15)) }
    } else {
      said.calls.forEach(([name, args], k) => send({ choices: [{ index: 0, delta: { tool_calls: [{ index: k, id: `call_${n}_${k}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }))
    }
    send({ choices: [{ index: 0, delta: {}, finish_reason: said.text ? 'stop' : 'tool_calls' }] })
    send({ choices: [], usage: { prompt_tokens: 2400, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1920 } } })
    res.end('data: [DONE]\n\n')
  })
})
const stubPort = await freePort()
await new Promise(r => stub.listen(stubPort, '127.0.0.1', r))
const STUB = `http://127.0.0.1:${stubPort}`

for (const d of [OUT, WORK]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }) }

// ---------- the server ----------

const port = await freePort()
const ROOT = `http://127.0.0.1:${port}`
const server = spawn(BIN, [], { env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), NO_COLOR: '1', BEREAN_DB: `${WORK}/on.db`, BEREAN_MINISTRY_DB: MINISTRY_DB, BEREAN_MINISTRY_VEC: `${WORK}/none.bin`,
  BEREAN_AI_KEY: 'test-key', BEREAN_EXPAND_URL: STUB, BEREAN_CHAT_KEY: 'test-chat-key', BEREAN_CHAT_URL: STUB }, stdio: ['ignore', openSync(`${OUT}/on.log`, 'w'), openSync(`${OUT}/on.log`, 'a')] })
process.on('exit', () => server.kill())
let up = false
for (let i = 0; i < 240 && !up && server.exitCode === null; i++) { try { up = (await fetch(`${ROOT}/api/edition`)).ok } catch {} if (!up) await sleep(250) }
ok('the server is up, with Ask on', up && (await (await fetch(`${ROOT}/api/assistant`)).json()).on === true)

async function register(handle) {
  const r = await fetch(`${ROOT}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle, display_name: 'Bible reader', password: 'ask-bible-12345' }) })
  return r.json()
}
const stamp = Date.now().toString(36).slice(-5)
const [english, french, filmed] = await Promise.all(['a', 'b', 'c'].map(k => register(`bib${stamp}${k}`)))
ok('three readers signed up', !!(english.token && french.token && filmed.token))

// ---------- the browser ----------

const { chromium } = await import('playwright')
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const errors = []
const PREFS = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true, align: 'center', width: 'medium', onboarded: true, toured: true }
/** A phone-sized page at `path`, signed in as `who`. */
async function open(path, who, { prefs = {}, video = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', ...(video ? { recordVideo: { dir: `${OUT}/video`, size: { width: W, height: H } } } : {}) })
  await ctx.addInitScript(([p, w]) => {
    if (sessionStorage.getItem('primed')) return
    localStorage.setItem('berean_prefs', p)
    localStorage.setItem('berean_token', w.token); localStorage.setItem('berean_user', JSON.stringify(w.user))
    sessionStorage.setItem('primed', '1')
  }, [JSON.stringify({ ...PREFS, ...prefs }), { token: who.token, user: who.user }])
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${path}: ${e.message}`))
  await page.goto(`${ROOT}${path}`, { waitUntil: 'networkidle' })
  return page
}
const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}.png` }); console.log(`shot ${OUT}/${name}.png`) }
const box = page => page.getByRole('textbox').filter({ visible: true })
/** Writes `text` in the box, sends it (the box's Enter is a new line, so the last button of the screen), and waits for
 *  words that end the answer. */
async function send(page, text, ends) {
  await box(page).fill(text)
  await page.getByRole('button', { name: /^(Send|Envoyer)$/ }).click()
  await page.getByText(ends).filter({ visible: true }).first().waitFor({ timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(700)
}
const link = (page, name) => page.getByRole('link', { name, exact: true }).filter({ visible: true })
const rects = loc => loc.evaluateAll(els => els.flatMap(el => [...el.getClientRects()].map(r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }))))
const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
const colour = loc => loc.first().evaluate(el => getComputedStyle(el).color)
/** The colour of the sentence that reads `text` (its words and its links together). */
const sentenceColour = (page, text) => page.evaluate(t => { const el = [...document.querySelectorAll('div, span')].find(e => e.textContent.trim().startsWith(t) && e.textContent.trim().length < t.length + 80 && !e.querySelector('textarea')); return el ? getComputedStyle(el).color : null }, text)
/** The scroll the conversation is in (the box to write in is under it, not in it), found from an answer's first link. */
const scroller = (page, y) => page.getByRole('link').filter({ visible: true }).first().evaluate((el, y) => { let s = el.parentElement; while (s && !(s.scrollHeight > s.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement; if (s && y !== null) s.scrollTop = y; return s ? { top: s.scrollTop, room: s.scrollHeight - s.clientHeight } : null }, y ?? null)
/** The sentences that are marked as resting on nothing: each one's words, without the mark. */
const unsourced = page => page.getByTestId('ask-no-source').filter({ visible: true }).evaluateAll(els => els.map(e => e.parentElement.textContent.replace(e.textContent, '').trim()))
const prefsOf = page => page.evaluate(() => JSON.parse(localStorage.getItem('berean_prefs') ?? '{}'))
const kept = page => page.evaluate(() => JSON.parse(localStorage.getItem('berean_assistant') ?? '{}'))
const ACCENT = 'rgb(124, 45, 18)'

// ---------- English ----------
{
  const page = await open('/ask', english)
  const before = chats.length
  await send(page, WHERE, 'no chapter.')
  const calls = chats.slice(before)
  const found = JSON.parse(calls[1]?.messages.findLast(m => m.role === 'tool')?.content ?? '{}')
  ok(`asked where the Bible speaks of a thing, the model calls search_bible (${JSON.stringify(calls[0]?.said.calls)}), a tool it was offered`, calls[0]?.said.calls?.[0]?.[0] === 'search_bible' && calls[0].tools.includes('search_bible'))
  ok(`search_bible gave verses with reference, book, chapter, verse and text, and the total (${found.total}: ${(found.verses ?? []).map(v => v.reference).join(', ')})`, found.total >= 2 && found.verses.length === found.total && found.verses.length <= 10 && found.verses.every(v => v.reference && Number.isInteger(v.book) && Number.isInteger(v.chapter) && Number.isInteger(v.verse) && /good shepherd/i.test(v.text)))
  const [a, b] = found.verses.map(v => v.reference)
  ok(`the answer gives two references, and both are links (${a}: ${await link(page, a).count()}, ${b}: ${await link(page, b).count()})`, a === 'John 10:11' && b === 'John 10:14' && (await link(page, a).count()) === 1 && (await link(page, b).count()) === 1)
  ok(`the links are in the accent (${await colour(link(page, a))})`, (await colour(link(page, a))) === ACCENT && (await colour(link(page, b))) === ACCENT)
  ok('a reference to a verse that does not exist is plain text, and so is one to a chapter that does not', (await link(page, 'John 10:99').count()) === 0 && (await link(page, 'John 22:1').count()) === 0 && (await page.getByText(/John 10:99 is no verse of the Bible, and John 22:1 no chapter\./).filter({ visible: true }).count()) === 1)
  ok(`nothing wider than the phone (${await page.evaluate(() => document.documentElement.scrollWidth)} px)`, (await page.evaluate(() => document.documentElement.scrollWidth)) <= W)
  await shot(page, 'ask-bible-links')

  // the library and the Bible in one answer: a citation and a reference in one sentence, and a sentence resting on a verse
  await send(page, GRACE, 'It never fails.')
  const answer = (await kept(page)).shown?.findLast(s => s.kind === 'answer')?.sentences ?? []
  // the citation is the number after the sentence; the author and the work are in the list under the answer
  const cite = page.getByTestId('ask-cite').filter({ visible: true })
  const ref = link(page, 'Romans 5:21')
  ok(`one sentence has a citation and a reference: one citation (${await cite.count()}: ${await cite.first().getAttribute('aria-label').catch(() => null)}), and Romans 5:21 linked in both sentences that give it (${await ref.count()})`, (await cite.count()) === 1 && (await cite.first().textContent()) === '¹' && /^Open \S/.test(await cite.first().getAttribute('aria-label')) && (await page.getByTestId('ask-source').filter({ visible: true }).count()) === 1 && (await ref.count()) === 2 && answer[0]?.ids.length === 1)
  const [citeRects, refRects] = [await rects(cite), await rects(ref)]
  ok(`the citation and the references do not collide (${citeRects.length} and ${refRects.length} boxes, all inside the screen)`, citeRects.length > 0 && refRects.length >= 2 && citeRects.every(c => refRects.every(r => apart(c, r))) && [...citeRects, ...refRects].every(r => r.left >= 0 && r.right <= W))
  const [onVerse, onNothing, plain] = [await sentenceColour(page, 'Romans 5:21 speaks of eternal life.'), await sentenceColour(page, 'It never fails.'), await sentenceColour(page, 'The Lord calls himself the good shepherd')]
  const bare = await unsourced(page)
  ok(`a sentence that gives a verse the search supplied is not marked as having no source; one that rests on nothing still is (${bare.join(' | ')}), and all three are in one ink (${onVerse}, ${onNothing}, ${plain})`, bare.join('|') === 'It never fails.' && !!onVerse && onVerse === plain && onNothing === plain && answer.map(s => s.supported).join() === 'true,true,false')
  await shot(page, 'citation-and-reference')

  // a link opens the reader at the verse, and Back returns to the conversation where it was
  const sent = chats.length
  await page.reload({ waitUntil: 'networkidle' })
  await link(page, a).waitFor({ timeout: 15000 }).catch(() => {})
  ok('answers already in the conversation are linked too (Ask opened again)', (await link(page, a).count()) === 1 && (await link(page, b).count()) === 1 && (await ref.count()) === 2)
  // on a short screen the conversation is longer than the screen, so it has a place to be scrolled to and found at
  await page.setViewportSize({ width: W, height: 560 })
  await page.waitForTimeout(300)
  // 40 px down, of the little there is to scroll: near enough its end that the next answer would be followed, and
  // still Back must find it where it was
  await scroller(page, 40)
  await page.waitForTimeout(300)
  const was = await scroller(page)
  const turns = []
  page.on('framenavigated', f => { if (f === page.mainFrame()) turns.push(new URL(f.url())) })
  await link(page, b).click()
  await page.waitForURL(u => u.pathname === '/read/43/10', { timeout: 15000 }).catch(() => {})
  await page.getByText(/I am the good shepherd/).first().waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const opened = turns.find(u => u.pathname === '/read/43/10')
  ok(`tapping a reference opens the reader at that verse (${opened?.pathname}${opened?.search})`, !!opened && opened.searchParams.get('v') === '14' && new URL(page.url()).pathname === '/read/43/10')
  const verse = await page.evaluate(() => { const el = [...document.querySelectorAll('div, span')].filter(e => /^14\s*I am the good shepherd/.test(e.textContent.trim())).pop(); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } })
  ok(`the verse is on the screen (${JSON.stringify(verse)})`, !!verse && verse.top >= 0 && verse.top < 560)
  await page.setViewportSize({ width: W, height: H })
  await shot(page, 'ask-bible-opened')
  await page.setViewportSize({ width: W, height: 560 })
  await page.goBack()
  await page.waitForURL(u => u.pathname === '/ask', { timeout: 15000 }).catch(() => {})
  await link(page, a).waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(500)
  const now = await scroller(page)
  ok(`Back returns to the conversation where it was (scrolled ${was?.top} → ${now?.top} of ${was?.room}), and nothing was asked of the model for any of it (${chats.length - sent} calls)`, new URL(page.url()).pathname === '/ask' && (await link(page, b).count()) === 1 && !!was && !!now && was.top > 0 && was.top === now.top && chats.length === sent)
  await shot(page, 'back-in-the-conversation')
  await page.setViewportSize({ width: W, height: H })

  // a change asked for in the same message, after the search has read the Bible, is refused
  const t0 = chats.length
  await send(page, WHERE_AND_THEME, 'a message of its own.')
  const round = chats.slice(t0)
  const refused = round[2]?.messages.findLast(m => m.role === 'tool')?.content ?? ''
  const p = await prefsOf(page)
  ok(`a settings change asked for in the same message after the search is refused (${refused.slice(0, 60)}…), and nothing changes (${p.theme})`, round[0]?.said.calls?.[0]?.[0] === 'search_bible' && round[1]?.said.calls?.[0]?.[0] === 'change_settings' && refused.startsWith('{"error":"Refused') && p.theme === 'paper' && (await page.getByRole('button', { name: 'Undo' }).count()) === 0)
  ok('… and the answer still links its verse', (await link(page, 'John 10:11').count()) === 2)
  await shot(page, 'change-refused')
  await page.context().close()
}

// ---------- French ----------
{
  const page = await open('/ask', french, { prefs: { lang: 'fr' } })
  await send(page, BERGER, /en Jean 10:14\./)
  ok(`French: the reader’s book names are read, and both references are links (${await link(page, 'Jean 10:11').count()}, ${await link(page, 'Jean 10:14').count()})`, (await link(page, 'Jean 10:11').count()) === 1 && (await link(page, 'Jean 10:14').count()) === 1 && (await colour(link(page, 'Jean 10:11'))) === ACCENT)
  await send(page, REGNE, 'Elle ne manque jamais.')
  const cite = page.getByTestId('ask-cite').filter({ visible: true })
  const listed = page.getByTestId('ask-source').filter({ visible: true, hasText: /Darby|Coates|Kelly|Bellett|Wigram|Stoney|Raven|Taylor|Mackintosh/ })
  const ref = link(page, 'Romains 5:21')
  const [citeRects, refRects] = [await rects(cite), await rects(ref)]
  ok(`French: a citation and a reference in one sentence do not collide (${await cite.count()} citation, its source listed under the answer (${await listed.count()}), ${await ref.count()} references)`, (await cite.count()) === 1 && (await listed.count()) === 1 && (await ref.count()) === 2 && citeRects.every(c => refRects.every(r => apart(c, r))) && [...citeRects, ...refRects].every(r => r.left >= 0 && r.right <= W))
  const [onVerse, onNothing] = [await sentenceColour(page, 'Romains 5:21 parle de la vie éternelle.'), await sentenceColour(page, 'Elle ne manque jamais.')]
  const bare = await unsourced(page)
  ok(`French: the sentence resting on the verse is not marked as having no source, the one resting on nothing is (${bare.join(' | ')}; one ink: ${onVerse}, ${onNothing})`, bare.join('|') === 'Elle ne manque jamais.' && !!onVerse && onVerse === onNothing)
  await shot(page, 'french')
  await link(page, 'Jean 10:11').click()
  await page.waitForURL(u => u.pathname === '/read/43/10', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1000)
  ok(`French: tapping one opens the reader at John 10 (${new URL(page.url()).pathname})`, new URL(page.url()).pathname === '/read/43/10')
  await shot(page, 'french-opened')
  await page.goBack()
  await page.waitForURL(u => u.pathname === '/ask', { timeout: 15000 }).catch(() => {})
  ok('French: Back returns to the conversation', (await link(page, 'Jean 10:11').waitFor({ timeout: 15000 }).then(() => true, () => false)))
  await page.context().close()
}

// ---------- the film: the question, the answer with its links, a tap, the verse, and back ----------
if (process.env.VIDEO) {
  const page = await open('/ask', filmed, { prefs: { reduceMotion: false }, video: true })
  // a mark where the finger lands, for whoever watches
  const finger = async loc => {
    const r = (await rects(loc))[0]
    await page.evaluate(([x, y]) => {
      const d = document.createElement('div')
      d.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:22px;background:rgba(0,0,0,0.28);z-index:99999;pointer-events:none;transition:opacity 500ms`
      document.body.appendChild(d)
      setTimeout(() => { d.style.opacity = '0' }, 350)
      setTimeout(() => d.remove(), 900)
    }, [(r.left + r.right) / 2, (r.top + r.bottom) / 2])
    await page.waitForTimeout(250)
  }
  await box(page).waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await box(page).click()
  await box(page).pressSequentially(WHERE, { delay: 70 })
  await page.waitForTimeout(700)
  const sendButton = page.getByRole('button', { name: 'Send', exact: true })
  await finger(sendButton)
  await sendButton.click()
  await link(page, 'John 10:14').waitFor({ timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(2600)
  await finger(link(page, 'John 10:11'))
  await link(page, 'John 10:11').click()
  await page.waitForURL(u => u.pathname === '/read/43/10', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(4200)
  await page.goBack()
  await page.waitForURL(u => u.pathname === '/ask', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(2600)
  const film = await page.video().path()
  await page.context().close()
  copyFileSync(film, `${OUT}/ask-bible.webm`)
  rmSync(`${OUT}/video`, { recursive: true, force: true })
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${OUT}/ask-bible.webm`, '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p', '-movflags', '+faststart', `${OUT}/ask-bible.mp4`])
    const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${OUT}/ask-bible.mp4`]).toString())
    ok(`the film is 15 to 25 seconds (${seconds.toFixed(1)} s, ${OUT}/ask-bible.mp4)`, seconds >= 15 && seconds <= 25)
  } catch (e) {
    // a machine with no ffmpeg keeps the recording: `ffmpeg -i ask-bible.webm -vf "pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p" ask-bible.mp4`
    if (e.code !== 'ENOENT') ok(`the film was made (${e.message.split('\n')[0]})`, false)
    else console.log(`note the film is recorded and not converted: there is no ffmpeg here (${OUT}/ask-bible.webm)`)
  }
}

ok(`no page error (${errors.join(' | ')})`, errors.length === 0)
await browser.close()
stub.close()
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
