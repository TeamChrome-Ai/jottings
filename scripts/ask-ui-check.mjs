// Ask's screen as a conversation (docs/ASSISTANT.md, "The screen"), at 412 px against a server that talks to a local
// stand-in for chat completions: an answer's sources as numbers with a list under it, a sentence that rests on
// nothing, the box to write in pinned at the foot with Send beside it, New conversation in the header, and the
// conversation following its newest words unless the reader has scrolled up. No real model is asked.
//
//   BIN=rs/target/release/berean [MINISTRY_DB=data/ministry.db] [OUT=…] [WORK=…] [TAG=before] [VIDEO=1] node scripts/ask-ui-check.mjs
//
// BIN must have been built after `npm run build`, which embeds the web app. OUT gets the screenshots, in the light
// theme and a dark one, named ask-ui-<slug>-<theme>[-TAG].png, and the server's log; with VIDEO a film of a question
// asked and a source tapped (ask-ui-review.webm, and .mp4 where there is an ffmpeg).
//
// The keyboard is a stand-in too: a browser on a phone keeps the window's height and shows less of it
// (window.visualViewport), and that is what is done to the page here. No keyboard of a phone is driven.
import http from 'node:http'
import net from 'node:net'
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, openSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const BIN = resolve(process.env.BIN ?? 'rs/target/release/berean')
const MINISTRY_DB = resolve(process.env.MINISTRY_DB ?? 'data/ministry.db')
const OUT = resolve(process.env.OUT ?? '/tmp/ask-ui-check')
const WORK = resolve(process.env.WORK ?? `${OUT}/work`)
const TAG = process.env.TAG ? `-${process.env.TAG}` : ''
const W = 412, H = 915
const KEYBOARD = 320
const sleep = ms => new Promise(r => setTimeout(r, ms))
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)) }) })
let passed = 0, failed = 0
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (cond) passed++; else failed++ }
/** A group of checks that goes on to the next group if the screen is not what it reads. */
const lane = async (name, run) => { try { await run() } catch (e) { ok(`${name}: ran to its end (${String(e.message ?? e).split('\n')[0]})`, false) } }

// ---------- the stand-in ----------

const SONS = 'Who are the sons of God in Genesis 6?'
const GRACE = 'What is it for grace to reign?'
const LONG = 'Tell me how to read a chapter slowly.'
const MORE = 'And what then?'
const BIGGER = 'Make the text a little bigger.'
const LAST = 'That is the whole of it.'
const LACKS = 'The library does not say whether these are all the passages that bear on it.'
const SLOWLY = ['Read the chapter through once without stopping, to see where it begins and where it ends.', 'Then read it again a paragraph at a time, and say in your own words what each one adds.',
  'Mark the words that come more than once, for a writer repeats what he will not have missed.', 'Look up each passage the chapter quotes, and read what stands round it there.',
  'Ask what the chapter says of God before you ask what it says of you.', 'Write one line for the whole of it, and keep the line where you will find it again.']
/** A long answer: enough sentences to fill three screens of a phone. */
const long = closing => [...Array.from({ length: 36 }, (_, i) => SLOWLY[i % SLOWLY.length]), closing].join(' ')
/** What the stand-in model does for a conversation: calls to tools, or words (`pace`: ms between two pieces). */
function script(messages) {
  const u = messages.map(m => m.role).lastIndexOf('user')
  const asked = messages[u].content
  const after = messages.slice(u + 1)
  const step = after.filter(m => m.role === 'assistant').length
  // a tool's result as the model is shown it: JSON, or a library result's plain lines (`[id] author, work, section`,
  // the text under it, a blank line between two), as scripts/assistant-check.mjs reads them
  const shown = content => { try { return JSON.parse(content) } catch { return { paragraphs: content.split('\n\n').map(b => /^\[(\d+)\] ([^\n]*)\n/.exec(b)).filter(Boolean).map(([, id, from]) => ({ id: Number(id), from })) } } }
  const results = after.filter(m => m.role === 'tool').map(m => shown(m.content))
  const last = results[results.length - 1] ?? {}
  const call = (...calls) => ({ calls })
  const text = (t, pace = 15) => ({ text: t, pace })
  if (/sons of God/i.test(asked)) {
    if (step === 0) return call(['search_library', { question: asked }])
    // three paragraphs of three works where the library gave as many, as the answer on the owner's phone had
    const found = last.paragraphs ?? []
    const work = p => p.from.split(', ').slice(0, 2).join(', ')
    const picked = []
    for (const p of found) if (picked.length < 3 && !picked.some(q => work(q) === work(p))) picked.push(p)
    for (const p of found) if (picked.length < 3 && !picked.includes(p)) picked.push(p)
    const [a, b, c] = picked.map(p => p.id)
    return text(`Darby identifies the “sons of God” in Genesis 6:2 as angels, and compares them with the sons of God in Job [${a}]. He specifically cites Job 1:6 and Job 38:7, and points to Jude in support of that interpretation [${b}]. For the connection with angels kept in darkness, Darby refers to Jude’s account of angels who left their own habitation, while Coates points to 2 Peter 2’s account of angels who sinned and were cast into the deepest pit of gloom [${a}, ${c}]. Darby also says that Jude and Peter seem to identify the sons of God in Genesis 6 with angels [${b}]. ${LACKS}`, Number(process.env.PACE ?? 15))
  }
  if (/grace to reign/i.test(asked)) {
    if (step === 0) return call(['search_library', { question: asked }])
    const [a] = (last.paragraphs ?? []).map(p => p.id)
    return text(`Grace reigns through righteousness, unto eternal life [${a}]. It is God acting in what he is, where sin had reigned unto death [${a}]. It never fails.`)
  }
  if (/read a chapter slowly/i.test(asked)) return text(long(LAST), 25)
  if (/what then/i.test(asked)) return text(long('Then begin the next chapter.'), 25)
  if (/bigger/i.test(asked)) {
    if (step === 0) return call(['get_settings', {}])
    if (step === 1) return call(['change_settings', { fontSize: last.fontSize + 1 }])
    return text('The text is one size larger.')
  }
  return text('Hello.')
}
const EXPANSION = { phrases: ['the sons of God', 'angels which kept not their first estate', 'grace reigns through righteousness'], verses: ['Genesis 6:2', 'Job 1:6', 'Jude 6', '2 Peter 2:4', 'Romans 5:21'], related: ['the angels that sinned'] }
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
    chats.push({ messages: b.messages, said })
    const n = chats.length
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = v => res.write(`data: ${JSON.stringify(v)}\n\n`)
    if (said.text) {
      for (const piece of said.text.match(/.{1,24}/gs)) { send({ choices: [{ index: 0, delta: { content: piece } }] }); await sleep(said.pace) }
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
  const r = await fetch(`${ROOT}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle, display_name: 'Ask reader', password: 'ask-ui-12345' }) })
  return r.json()
}
const stamp = Date.now().toString(36).slice(-5)
const readers = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map(k => register(`aui${stamp}${k}`)))
const [sourced, writer, follower, light, dark, filmed] = readers
ok('six readers signed up', readers.every(r => r.token))

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
const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${TAG}.png` }); console.log(`shot ${OUT}/${name}${TAG}.png`) }
const box = page => page.getByPlaceholder('Ask about the Bible or the app')
const sendButton = page => page.getByRole('button', { name: 'Send', exact: true }).filter({ visible: true })
const stopButton = page => page.getByRole('button', { name: 'Stop', exact: true }).filter({ visible: true })
const fresh = page => page.getByRole('button', { name: 'New conversation', exact: true }).filter({ visible: true })
const said = (page, words) => page.getByText(words).filter({ visible: true })
const kept = page => page.evaluate(() => JSON.parse(localStorage.getItem('berean_assistant') ?? '{}'))
const answers = async page => ((await kept(page)).shown ?? []).filter(s => s.kind === 'answer').length
/** Writes `text` in the box, sends it, and waits for its answer to be kept and the words that end it to be on the screen. */
async function send(page, text, ends) {
  const before = await answers(page)
  await box(page).fill(text)
  await sendButton(page).click()
  for (let i = 0; i < 600 && (await answers(page)) === before; i++) await page.waitForTimeout(100)
  await said(page, ends).last().waitFor({ timeout: 10000 }).catch(() => {})
  await stopButton(page).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(500)
}
const rect = loc => loc.first().evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } })
const rects = loc => loc.evaluateAll(els => els.flatMap(el => [...el.getClientRects()].map(r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }))))
const colour = loc => loc.first().evaluate(el => getComputedStyle(el).color)
/** The colour of the sentence that reads `text` (its words and its links together). */
const sentenceColour = (page, text) => page.evaluate(t => { const el = [...document.querySelectorAll('div, span')].filter(e => e.textContent.trim().startsWith(t)).pop(); return el ? getComputedStyle(el).color : null }, text)
const DISCLOSURE = 'Answers come from an AI model reading the library. What you write here is sent to the model’s provider, and so is a jotting of yours when you ask Ask about it.'
/** The scroll the conversation is in: where it is, how far it goes, and where it stands on the screen. */
const scroller = page => page.getByText(DISCLOSURE).first().evaluate(el => { let s = el.parentElement; while (s && !/auto|scroll/.test(getComputedStyle(s).overflowY)) s = s.parentElement; if (!s) return null; const r = s.getBoundingClientRect(); return { top: Math.round(s.scrollTop), room: Math.round(s.scrollHeight - s.clientHeight), from: r.top, to: r.bottom } })
const scrollTo = (page, y) => page.getByText(DISCLOSURE).first().evaluate((el, y) => { let s = el.parentElement; while (s && !/auto|scroll/.test(getComputedStyle(s).overflowY)) s = s.parentElement; if (s) s.scrollTop = y === 'end' ? s.scrollHeight : y }, y)
/** The reader moves up to `y` to read, as a finger does: in steps, each a scroll event of its own, not one jump. A
 *  single jump can be lost when the answer grows between it and its event (the screen has not yet heard of it and
 *  moves to the new end); a finger's next move is heard. */
const scrollUp = async (page, y) => { for (let k = 0; k < 8; k++) { await page.getByText(DISCLOSURE).first().evaluate((el, [y, left]) => { let s = el.parentElement; while (s && !/auto|scroll/.test(getComputedStyle(s).overflowY)) s = s.parentElement; if (s) s.scrollTop = Math.max(y, Math.round(s.scrollTop - (s.scrollTop - y) / left)) }, [y, 8 - k]); await page.waitForTimeout(40) } }
/** The keyboard, as a phone's browser shows it: the window keeps its height and less of it shows. */
const keyboard = (page, up) => page.evaluate(([up, k]) => { const v = window.visualViewport; if (up) Object.defineProperty(v, 'height', { configurable: true, get: () => window.innerHeight - k }); else delete v.height; v.dispatchEvent(new Event('resize')) }, [up, KEYBOARD])
const SUPERIOR = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const figure = s => Number([...s.trim()].map(ch => SUPERIOR.indexOf(ch)).join(''))
const ACCENT = 'rgb(124, 45, 18)'
const AUTHORS = { darby: 'Darby', coates: 'Coates', kelly: 'Kelly', mackintosh: 'Mackintosh' }

// ---------- an answer and its sources ----------
await lane('sources', async () => {
  const page = await open('/ask', sourced)
  ok('first use: New conversation is not shown while there is no conversation', (await fresh(page).count()) === 0)
  // while the answer streams, the screen is read every 60 ms: no id may ever be on it
  await box(page).fill(SONS)
  await sendButton(page).click()
  const seen = []
  for (let i = 0; i < 400 && (i < 5 || (await stopButton(page).count()) > 0); i++) { seen.push(await page.evaluate(() => document.body.innerText)); await page.waitForTimeout(60) }
  await said(page, LACKS).last().waitFor({ timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(500)
  const conv = await kept(page)
  const answer = conv.shown?.findLast(s => s.kind === 'answer')?.sentences ?? []
  const place = id => conv.places?.[String(id)]
  const [a, b, c] = [answer[0]?.ids[0], answer[1]?.ids[0], answer[2]?.ids[1]]
  ok(`the answer rests on three paragraphs, the first and the second each twice (${answer.map(s => `[${s.ids}]`).join(' ')}), and its last sentence on none (${answer.map(s => s.supported)})`,
    answer.length === 5 && [a, b, c].every(Number.isInteger) && new Set([a, b, c]).size === 3 && answer.map(s => s.ids.join()).join('|') === `${a}|${b}|${a},${c}|${b}|` && answer.map(s => s.supported).join() === 'true,true,true,true,false')
  const streamed = seen.filter(t => t.includes('Darby identifies'))
  ok(`while it streamed the screen showed no id and no bracket of ids (${streamed.length} readings of the answer on its way)`, streamed.length > 3 && seen.every(t => !/\[\s*\d/.test(t) && ![a, b, c].some(id => t.includes(String(id)))))

  const label = id => `Open ${AUTHORS[place(id)?.author] ?? place(id)?.author}, ${place(id)?.work.title}`
  const line = id => `${AUTHORS[place(id)?.author] ?? place(id)?.author}, ${place(id)?.work.title}`
  const numbers = page.getByTestId('ask-cite').filter({ visible: true })
  const figures = await numbers.allTextContents()
  ok(`after its sentences stand the numbers of their paragraphs, by first appearance, the same paragraph the same number (${figures.join(' ')})`, figures.map(figure).join() === '1,2,1,3,2' && figures.every(f => [...f.trim()].every(ch => SUPERIOR.includes(ch))))
  ok(`a number is a superior figure in the accent (${await colour(numbers).catch(() => null)})`, (await numbers.count()) === 5 && (await colour(numbers)) === ACCENT)
  const numberLabels = await numbers.evaluateAll(els => els.map(e => [e.getAttribute('role'), e.getAttribute('aria-label')]))
  ok(`each number is a link a screen reader hears as its author and work (${numberLabels[0]?.[1]})`, numberLabels.length === 5 && [a, b, a, c, b].every((id, i) => numberLabels[i][0] === 'link' && numberLabels[i][1] === label(id)))
  const rows = page.getByTestId('ask-source').filter({ visible: true })
  const lines = (await rows.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim())
  ok(`under the answer its sources are listed, one line each, in the order of their numbers (${lines.join(' | ')})`, lines.length === 3 && [a, b, c].every((id, i) => lines[i] === `${i + 1} ${line(id)}`))
  const rowLabels = await rows.evaluateAll(els => els.map(e => [e.getAttribute('role'), e.getAttribute('aria-label')]))
  ok('each line of the list is a link with the same name', rowLabels.length === 3 && [a, b, c].every((id, i) => rowLabels[i][0] === 'link' && rowLabels[i][1] === label(id)))
  // the sentences themselves: no author and work printed among them
  const prose = await page.evaluate(t => { const el = [...document.querySelectorAll('div, span')].filter(e => e.textContent.trim().startsWith(t)).pop(); return el?.parentElement?.textContent ?? '' }, 'Darby identifies')
  ok(`no work’s title stands among the sentences (${prose.length} characters of prose)`, prose.includes(LACKS) && [a, b, c].every(id => place(id) && !prose.includes(place(id).work.title)))
  const [numberRects, rowRects, composer] = [await rects(numbers), await rects(rows), await rect(box(page))]
  ok('the numbers and the list are inside the phone’s width, and the list is under the answer', [...numberRects, ...rowRects].every(r => r.left >= 0 && r.right <= W) && rowRects.length >= 3 && Math.min(...rowRects.map(r => r.top)) >= Math.max(...numberRects.map(r => r.bottom)) - 1 && Math.max(...rowRects.map(r => r.bottom)) <= composer.top)
  ok(`a line of the list is tall enough to tap (${Math.round(Math.min(...(await rows.evaluateAll(els => els.map(e => e.getBoundingClientRect().height)))))} px)`, (await rows.evaluateAll(els => els.every(e => e.getBoundingClientRect().height >= 36))) && (await rows.count()) === 3)

  // the sentence that rests on nothing
  const tags = page.getByTestId('ask-no-source').filter({ visible: true })
  const [lacks, rests] = [await sentenceColour(page, LACKS), await sentenceColour(page, 'He specifically cites')]
  ok(`a sentence that rests on nothing is in the ink of the others (${lacks}, as ${rests}), not greyed`, !!lacks && lacks === rests)
  const tagAt = await rects(tags), lacksAt = await rects(said(page, LACKS).last())
  ok(`… and is marked “no source”, once, after it (${await tags.allTextContents()})`, (await tags.count()) === 1 && (await tags.first().textContent()).replace(/\s+/g, ' ').trim() === 'no source' && tagAt[0].top >= lacksAt[0].top - 2)
  // the two faults the first pictures showed: 1 and 3 after one sentence read as 13, and “no source” broke after “no”
  const [one, three] = [(await rects(numbers.nth(2)))[0], (await rects(numbers.nth(3)))[0]]
  ok(`two numbers after one sentence stand apart, by a space that does not break (${one && three ? Math.round((three.left - one.right) * 10) / 10 : '?'} px between them, on one line)`, !!one && !!three && Math.abs(one.top - three.top) < 2 && three.left - one.right >= 4)
  ok(`“no source” is on one line, whole (${tagAt.length} box)`, tagAt.length === 1)
  ok(`nothing wider than the phone (${await page.evaluate(() => document.documentElement.scrollWidth)} px)`, (await page.evaluate(() => document.documentElement.scrollWidth)) <= W)

  // a number opens its paragraph, and Back returns to the conversation
  await numbers.nth(3).click()
  await page.waitForURL(/\/companion\?/, { timeout: 10000 }).catch(() => {})
  let u = new URL(page.url())
  ok(`a number opens its paragraph in the library (${u.pathname}${u.search})`, u.pathname === '/companion' && u.searchParams.get('author') === place(c).author && u.searchParams.get('work') === place(c).work.id && u.searchParams.get('p') === String(place(c).para))
  await page.goBack()
  await page.waitForURL(v => v.pathname === '/ask', { timeout: 10000 }).catch(() => {})
  ok('… and Back returns to the conversation', (await said(page, LACKS).last().waitFor({ timeout: 10000 }).then(() => true, () => false)) && (await numbers.count()) === 5)
  await rows.nth(1).click()
  await page.waitForURL(/\/companion\?/, { timeout: 10000 }).catch(() => {})
  u = new URL(page.url())
  ok(`a line of the list opens its paragraph (${u.pathname}${u.search})`, u.pathname === '/companion' && u.searchParams.get('author') === place(b).author && u.searchParams.get('work') === place(b).work.id && u.searchParams.get('p') === String(place(b).para))
  await page.goBack()
  await page.waitForURL(v => v.pathname === '/ask', { timeout: 10000 }).catch(() => {})
  ok('… and Back returns to the conversation', (await rows.first().waitFor({ timeout: 10000 }).then(() => true, () => false)) && (await rows.count()) === 3)

  // an answer kept on the device is drawn the same way when Ask is opened again
  await page.reload({ waitUntil: 'networkidle' })
  await said(page, LACKS).last().waitFor({ timeout: 15000 }).catch(() => {})
  ok('an answer already kept on the device shows its numbers, its list and its mark when Ask is opened again', (await numbers.allTextContents()).map(figure).join() === '1,2,1,3,2' && (await rows.count()) === 3 && (await tags.count()) === 1)
  // a second answer numbers its own sources from 1
  await send(page, GRACE, 'It never fails.')
  ok(`a second answer numbers its own sources from 1 (${(await numbers.allTextContents()).map(figure)})`, (await numbers.allTextContents()).map(figure).join() === '1,2,1,3,2,1,1' && (await rows.count()) === 4 && (await tags.count()) === 2)
  await page.context().close()
})

// ---------- the box to write in ----------
await lane('composer', async () => {
  const page = await open('/ask', writer)
  const empty = await rect(box(page)), button = await rect(sendButton(page))
  ok(`empty, the box is one line tall (${empty.height} px) and at the foot of the screen (${Math.round(empty.bottom)} of ${H})`, empty.height <= 52 && empty.bottom <= H && empty.bottom >= H - 40)
  ok(`Send is beside it, on its right (${Math.round(button.left)} px after the box’s ${Math.round(empty.right)}), and waits for words`, button.left >= empty.right && button.top < empty.bottom && button.bottom > empty.top && button.right <= W && await sendButton(page).isDisabled())
  ok('first use: the screen says what Ask is for', (await page.getByTestId('ask-empty').filter({ visible: true }).count()) === 1)
  await box(page).fill('one\ntwo\nthree\nfour')
  await page.waitForTimeout(200)
  const four = await rect(box(page))
  await box(page).fill(Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n'))
  await page.waitForTimeout(200)
  const many = await rect(box(page)), beside = await rect(sendButton(page))
  ok(`the box grows with what is written (${empty.height} → ${four.height} px for four lines), to a limit (${many.height} px for forty), and stays on the screen with Send beside it`,
    four.height > empty.height + 40 && many.height > four.height && many.height <= 200 && many.top > 0 && many.bottom <= H && beside.left >= many.right && beside.bottom <= H && beside.bottom > many.bottom - 60)
  await box(page).fill('')
  await page.waitForTimeout(200)
  ok(`emptied, it is one line again (${(await rect(box(page))).height} px)`, (await rect(box(page))).height === empty.height)

  // a long conversation: it scrolls, and the box stays where it is
  await send(page, LONG, LAST)
  const at = await scroller(page), boxAt = await rect(box(page)), newAt = await rect(fresh(page))
  ok(`in a long conversation the page does not scroll (${await page.evaluate(() => document.documentElement.scrollHeight)} px), the conversation does (${at?.room} px of it out of sight)`, (await page.evaluate(() => document.documentElement.scrollHeight)) <= H && !!at && at.room > H)
  ok(`… and the box stays at the foot of the screen (${Math.round(boxAt.top)} to ${Math.round(boxAt.bottom)}), under the conversation (which ends at ${Math.round(at?.to)})`, boxAt.bottom <= H && boxAt.bottom >= H - 40 && boxAt.height === empty.height && !!at && at.to <= boxAt.top)
  await scrollTo(page, 0)
  await page.waitForTimeout(300)
  const still = await rect(box(page))
  ok(`… wherever the conversation is scrolled to (${Math.round(still.top)} at its top)`, still.top === boxAt.top && (await scroller(page)).top === 0)
  ok(`New conversation is in the screen’s header (${Math.round(newAt.top)} to ${Math.round(newAt.bottom)}, the conversation begins at ${Math.round(at?.from)}), not beside Send`, !!at && newAt.bottom <= at.from && newAt.right <= W && newAt.left > W / 3 && (await page.getByRole('button', { name: 'New conversation', exact: true }).count()) === 1)
  await shot(page, 'ask-ui-check-long')

  // Stop stands where Send does while an answer streams
  await box(page).fill(MORE)
  await sendButton(page).click()
  await stopButton(page).waitFor({ timeout: 10000 }).catch(() => {})
  const stopAt = await rect(stopButton(page)), during = await rect(box(page))
  ok(`while an answer streams Stop is beside the box, where Send was (${Math.round(stopAt.left)} px)`, stopAt.left >= during.right && stopAt.bottom <= H && stopAt.bottom > during.top && (await sendButton(page).count()) === 0)
  await stopButton(page).click()
  await sendButton(page).waitFor({ timeout: 10000 }).catch(() => {})
  ok('Stop ends the answer and Send is back', (await sendButton(page).count()) === 1 && (await stopButton(page).count()) === 0)

  // the keyboard (a stand-in: less of the window shows)
  await send(page, 'hello', 'Hello.')
  const down = await rect(box(page))
  await keyboard(page, true)
  await page.waitForTimeout(400)
  const upAt = await rect(box(page)), upSend = await rect(sendButton(page)), upConv = await scroller(page), words = await rect(said(page, 'Hello.').last())
  ok(`with the keyboard up (a stand-in, ${KEYBOARD} px) the box is above it (${Math.round(upAt.bottom)} of ${H - KEYBOARD}) with Send`, upAt.bottom <= H - KEYBOARD && upAt.bottom >= H - KEYBOARD - 40 && upSend.bottom <= H - KEYBOARD && upAt.height === down.height && Math.abs(upAt.top - (down.top - KEYBOARD)) <= 8)
  ok(`… and the newest words are still in view above it (they end at ${Math.round(words.bottom)}, the box begins at ${Math.round(upAt.top)})`, words.bottom <= upAt.top && words.top >= (upConv?.from ?? 0) && !!upConv && upConv.top >= upConv.room - 2)
  await page.evaluate(k => { const d = document.createElement('div'); d.id = 'stand-in-keyboard'; d.textContent = 'keyboard (a stand-in)'; d.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${k}px;background:#8a8f98;color:#fff;font:16px system-ui;display:flex;align-items:center;justify-content:center;z-index:99999`; document.body.appendChild(d) }, KEYBOARD)
  await shot(page, 'ask-ui-check-keyboard')
  await page.evaluate(() => document.getElementById('stand-in-keyboard')?.remove())
  await keyboard(page, false)
  await page.waitForTimeout(400)
  ok(`… and back at the foot when the keyboard goes (${Math.round((await rect(box(page))).top)})`, (await rect(box(page))).top === down.top)

  // New conversation
  await fresh(page).click()
  await page.waitForTimeout(400)
  ok('New conversation clears the conversation from the screen and the device, and is itself gone', !(await page.evaluate(() => localStorage.getItem('berean_assistant'))) && (await said(page, 'Hello.').count()) === 0 && (await fresh(page).count()) === 0 && (await page.getByTestId('ask-empty').filter({ visible: true }).count()) === 1)
  await page.context().close()
})

// ---------- the newest words in view ----------
await lane('following', async () => {
  const page = await open('/ask', follower)
  /** Reads where the conversation stands every 120 ms until the answer has ended. */
  const watch = async () => { const seen = []; for (let i = 0; i < 300 && (i < 4 || (await stopButton(page).count()) > 0); i++) { const s = await scroller(page); if (s) seen.push(s); await page.waitForTimeout(120) } return seen }
  await box(page).fill(LONG)
  await sendButton(page).click()
  const first = await watch()
  await said(page, LAST).last().waitFor({ timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(500)
  const grew = first.filter(s => s.room > 0)
  const behind = Math.max(0, ...grew.map(s => s.room - s.top))
  ok(`while an answer streams the conversation follows its newest words (${grew.length} readings as it grew from ${grew[0]?.room} to ${grew[grew.length - 1]?.room} px out of sight; never more than ${behind} px behind)`, grew.length > 8 && grew[grew.length - 1].room > H && behind <= 60)
  const end = await scroller(page), lastWords = await rect(said(page, LAST).last()), boxAt = await rect(box(page))
  ok(`when it ends its last words are in view, above the box (they end at ${Math.round(lastWords.bottom)}, the box begins at ${Math.round(boxAt.top)})`, !!end && end.top >= end.room - 2 && lastWords.bottom <= boxAt.top && lastWords.top >= end.from)

  // the reader scrolls up to read while the next answer streams: left alone
  await box(page).fill(MORE)
  await sendButton(page).click()
  await stopButton(page).waitFor({ timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(600)
  const mine = await rect(said(page, MORE).last()), then = await scroller(page)
  ok(`when the reader sends a message it is in view (${Math.round(mine.top)} to ${Math.round(mine.bottom)} of ${Math.round(then?.from)} to ${Math.round(then?.to)})`, !!then && mine.top >= then.from && mine.bottom <= then.to)
  await scrollUp(page, 300)
  const second = await watch()
  await page.waitForTimeout(500)
  const after = await scroller(page)
  ok(`a reader who has scrolled up to read is left alone while the answer streams (${second.length} readings, all at ${[...new Set(second.map(s => s.top))]}; the conversation grew to ${after?.room} px out of sight) and when it ends (${after?.top})`,
    second.length >= 8 && second.every(s => s.top === 300) && !!after && after.top === 300 && after.room > second[0].room && (await said(page, 'Then begin the next chapter.').count()) === 1)

  // back at the end, and it follows again
  await scrollTo(page, 'end')
  await page.waitForTimeout(300)
  await send(page, 'hello', 'Hello.')
  const again = await scroller(page), hello = await rect(said(page, 'Hello.').last())
  ok(`back at the end, the next answer is followed again (${again?.top} of ${again?.room})`, !!again && again.top >= again.room - 2 && hello.bottom <= (await rect(box(page))).top)
  // and a reader who scrolled up and then sends: their own message brings the conversation to its end
  await scrollTo(page, 200)
  await page.waitForTimeout(300)
  await send(page, 'hello again', 'Hello.')
  const sent = await scroller(page)
  ok(`a reader who had scrolled up and then sends a message is brought to it (${sent?.top} of ${sent?.room})`, !!sent && sent.top >= sent.room - 2)
  await page.context().close()
})

// ---------- the pictures: the light theme and a dark one ----------
for (const [who, theme] of [[light, 'paper'], [dark, 'slate']]) {
  await lane(`pictures, ${theme}`, async () => {
    const name = theme === 'paper' ? 'light' : 'dark'
    const page = await open('/ask', who, { prefs: { theme } })
    await box(page).waitFor({ timeout: 15000 }).catch(() => {})
    await shot(page, `ask-ui-empty-${name}`)
    await send(page, GRACE, 'It never fails.')
    await shot(page, `ask-ui-unsupported-${name}`)
    await send(page, SONS, LACKS)
    // the question at the top of the screen, as far as the conversation goes
    await said(page, SONS).last().evaluate(el => { let s = el.parentElement; while (s && !/auto|scroll/.test(getComputedStyle(s).overflowY)) s = s.parentElement; if (s) s.scrollTop += el.getBoundingClientRect().top - s.getBoundingClientRect().top - 32 })
    await shot(page, `ask-ui-sources-${name}`)
    await send(page, BIGGER, 'one size larger.')
    await shot(page, `ask-ui-change-${name}`)
    await page.getByRole('button', { name: 'Undo', exact: true }).filter({ visible: true }).first().click().catch(() => {})
    await send(page, LONG, LAST)
    await shot(page, `ask-ui-long-${name}`)
    await box(page).fill('And how is the next chapter begun, when the first has been read in this way?')
    await keyboard(page, true)
    await page.waitForTimeout(400)
    await page.evaluate(k => { const d = document.createElement('div'); d.textContent = 'keyboard (a stand-in)'; d.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${k}px;background:#8a8f98;color:#fff;font:16px system-ui;display:flex;align-items:center;justify-content:center;z-index:99999`; document.body.appendChild(d) }, KEYBOARD)
    await shot(page, `ask-ui-keyboard-${name}`)
    await page.context().close()
  })
}

// ---------- the film: a question asked, the answer with its numbers, a source tapped, the paragraph, and back ----------
if (process.env.VIDEO) {
  await lane('film', async () => {
    const page = await open('/ask', filmed, { prefs: { reduceMotion: false }, video: true })
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
    await box(page).waitFor({ timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(1800)
    await box(page).click()
    await box(page).pressSequentially(SONS, { delay: 60 })
    await page.waitForTimeout(600)
    await finger(sendButton(page))
    await sendButton(page).click()
    await said(page, LACKS).last().waitFor({ timeout: 40000 }).catch(() => {})
    await stopButton(page).waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(3500)
    const row = page.getByTestId('ask-source').filter({ visible: true }).first()
    await finger(row)
    await row.click()
    await page.waitForURL(/\/companion\?/, { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(5000)
    await page.goBack()
    await page.waitForURL(u => u.pathname === '/ask', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(2200)
    const number = page.getByTestId('ask-cite').filter({ visible: true }).nth(3)
    await finger(number)
    await number.click()
    await page.waitForURL(/\/companion\?/, { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(3500)
    await page.goBack()
    await page.waitForURL(u => u.pathname === '/ask', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(2000)
    const film = await page.video().path()
    await page.context().close()
    copyFileSync(film, `${OUT}/ask-ui-review.webm`)
    rmSync(`${OUT}/video`, { recursive: true, force: true })
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${OUT}/ask-ui-review.webm`, '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p', '-movflags', '+faststart', `${OUT}/ask-ui-review.mp4`])
      const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${OUT}/ask-ui-review.mp4`]).toString())
      ok(`the film is 20 to 40 seconds (${seconds.toFixed(1)} s, ${OUT}/ask-ui-review.mp4)`, seconds >= 20 && seconds <= 40)
    } catch (e) {
      // a machine with no ffmpeg keeps the recording: `ffmpeg -i ask-ui-review.webm -vf "pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p" ask-ui-review.mp4`
      if (e.code !== 'ENOENT') ok(`the film was made (${e.message.split('\n')[0]})`, false)
      else console.log(`note the film is recorded and not converted: there is no ffmpeg here (${OUT}/ask-ui-review.webm)`)
    }
  })
}

ok(`no page error (${errors.join(' | ')})`, errors.length === 0)
await browser.close()
stub.close()
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
