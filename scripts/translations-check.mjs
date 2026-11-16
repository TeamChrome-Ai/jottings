// The Bibles read beside Darby's (docs/LANGUAGES.md) in the web build against a server: the King James Version and
// Young's Literal Translation as the Bible read and as the second Bible, verse for verse; where their numbers differ
// (Revelation 12:18); search, the device's voice, a highlight kept across Bibles, word lookup, Credits, and a chapter
// of each with the network off. Each check reads the words it expects from the server's own chapter files.
//   BASE=http://127.0.0.1:8796 SHOTS=/tmp/swarm-v2-11 node scripts/translations-check.mjs
//   FILM=<directory> also films choosing a second Bible and reading side by side (a .webm in that directory)
//   WITHOUT=kjv (or ylt): the server was built with that text left out (BEREAN_WITHOUT_KJV=1): the checks then are
//   that it is nowhere, and that the other is as before
import { chromium } from 'playwright'
import fs from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const shots = process.env.SHOTS ?? '/tmp/translations-shots'
const without = process.env.WITHOUT ?? ''
fs.mkdirSync(shots, { recursive: true })
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
let failed = 0
const check = (ok, what, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${ok || got === undefined ? '' : `  (got ${JSON.stringify(got).slice(0, 240)})`}`); if (!ok) failed++ }
const PREFS = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, verseNumbers: true, paragraphs: false, showNotes: false, reduceMotion: true, onboarded: true, toured: true, seenNew: '99.0.0' }
const NAMES = { kjv: 'King James Version', ylt: 'Young’s Literal Translation' }
const PHONE = { width: 412, height: 900 }

async function open(prefs, path, until = null, { viewport = PHONE, init = null, video = null } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...(video ? { recordVideo: { dir: video, size: viewport } } : {}) })
  await ctx.addInitScript(v => { if (!localStorage.getItem('berean_prefs')) localStorage.setItem('berean_prefs', JSON.stringify(v)) }, { ...PREFS, ...prefs })
  if (init) await ctx.addInitScript(init)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(base + path, { waitUntil: 'networkidle' })
  await drawn(page, until)
  return { ctx, page, errors }
}
/** Drawn: the screen has the words waited for (a busy machine can take seconds over a Bible's first load). */
async function drawn(page, until) {
  await page.waitForFunction(u => u ? document.body.innerText.includes(u) : document.body.innerText.trim().length > 80, until, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(700)
}
const text = page => page.evaluate(() => document.body.innerText)
const prefsOf = page => page.evaluate(() => JSON.parse(localStorage.getItem('berean_prefs') ?? '{}'))
/** A chapter as the server has it: the English Darby's (1961) or another Bible's by its id. */
const chapters = new Map()
async function chapter(id, b, c) {
  const k = `${id}.${b}.${c}`
  if (!chapters.has(k)) chapters.set(k, await (await fetch(`${base}/${id === 'en' ? 'bible' : `bible-${id}`}/${b}/${c}.json`)).json())
  return chapters.get(k)
}
/** The opening of a verse as the screen writes it: enough of it to be that verse and no other on the page. */
const opening = v => v.t.slice(0, 34).trim()
/** Each verse of `first` followed by the same verse of `second`, in order down the page; returns the verses that are not. */
async function pairs(page, first, second) {
  const body = await text(page)
  const out = []
  let at = -1
  for (const v of first.verses) {
    const w = second.verses.find(x => x.v === v.v)
    if (!v.t || !w?.t) { if (!w?.t) out.push(`${v.v}: the second has nothing`); continue }
    const i = body.indexOf(opening(v), at + 1)
    const j = i < 0 ? -1 : body.indexOf(opening(w), i + 1)
    if (i < 0 || j < 0) { out.push(`${v.v}: ${i < 0 ? 'first' : 'second'} not on the page in its place`); continue }
    at = j
  }
  return out
}
/** Taps a verse by its number in the margin of the text (plain words share a text node, so element locators miss). */
const tapVerse = (page, n) => page.evaluate(n => {
  const el = [...document.querySelectorAll('span')].find(e => e.firstChild?.nodeType === 3 && (e.firstChild.textContent || '').trim() === String(n) && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().width < 60 && e.getBoundingClientRect().y > 80 && e.getBoundingClientRect().y < innerHeight - 160)
  if (!el) return false
  el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true
}, n)
/** Brings a verse to the middle of the screen by its number in the margin (no `?v=`: a linked verse is tinted, and a
 *  tint is not a highlight). */
const showVerse = async (page, n) => {
  // the reader settles its own scroll as a chapter opens: asked again until the verse stays in the middle
  for (let i = 0; i < 6; i++) {
    const y = await page.evaluate(n => {
      // the chapters either side are laid out off the screen's edge, with verses of the same number: this page's only
      const el = [...document.querySelectorAll('span')].find(e => { const r = e.getBoundingClientRect(); return e.firstChild?.nodeType === 3 && (e.firstChild.textContent || '').trim() === String(n) && r.width > 0 && r.width < 60 && r.x >= 0 && r.x < innerWidth })
      el?.scrollIntoView({ block: 'center' })
      return el ? el.getBoundingClientRect().y : -1
    }, n)
    await page.waitForTimeout(500)
    if (y > 120 && y < 700 && i > 0) break
  }
}
/** The yellow highlighter on a light page (client/src/theme.ts HL_LIGHT). */
const YELLOW = 'rgb(253, 230, 138)'
/** The fill behind the words `words` on the page (a highlight), or "none". */
const fillBehind = (page, words) => page.evaluate(words => {
  const el = [...document.querySelectorAll('span')].find(s => (s.textContent || '').includes(words) && s.getBoundingClientRect().width > 0)
  let e = el
  while (e && getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)') e = e.parentElement
  return el && e && e !== document.body && e.tagName !== 'HTML' ? getComputedStyle(e).backgroundColor : 'none'
}, words)
/** The recorded voices by name, and the two lines the Listening sheet has about another Bible: the one it always had
 *  for Darby's French and the Elberfelder, and the one for an English Bible beside Darby's. */
const VOICES = ['Alec', 'Beatrice', 'Dominic']
const STATED = 'These voices read the English Darby. The Bible you read is read by your device’s own voice, in its language.'
const DEVICE_ONLY = 'Your device’s own voice reads this Bible. The recorded voices read Darby’s words, so they are offered only with his.'
/** Opens Settings → Listening and returns the sheet's words. */
const listeningSheet = async page => {
  await page.goto(base + '/settings', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Listening/ }).first().click()
  await page.waitForTimeout(900)
  const body = await text(page)
  return body.slice(body.lastIndexOf('Listening'))
}
const openLanguageSheet = async page => {
  await page.goto(base + '/settings', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Language/ }).first().click()
  await page.waitForTimeout(900)
}

const here = ['kjv', 'ylt'].filter(id => id !== without)

// ---------- the language sheet: under English, Darby still the Bible read ----------
{
  const { ctx, page, errors } = await open({}, '/settings')
  await page.getByRole('button', { name: /Language/ }).first().click(); await page.waitForTimeout(900)
  const body = await text(page)
  const bible = body.slice(body.indexOf('The Bible'), body.indexOf('Side by side'))
  // line by line: each language's name, then its Bibles under it
  const lines = bible.split('\n').map(s => s.trim()).filter(Boolean)
  const want = ['The Bible', 'With the language (Darby (English))', 'English', 'Darby (English)', ...here.map(id => NAMES[id]), 'Français', 'Darby (français)', 'Deutsch', 'Elberfelder (Deutsch)']
  check(JSON.stringify(lines) === JSON.stringify(want), `the Language sheet lists ${here.map(id => NAMES[id]).join(' and ')} under English, after Darby, and each other Bible under its language`, lines)
  if (without) check(!body.includes(NAMES[without]), `${NAMES[without]}, left out of this build, is not offered`, body.includes(NAMES[without]))
  // the choice made in each list is the row with the tick
  const chosen = await page.evaluate(() => [...document.querySelectorAll('[role=radio]')].filter(e => e.querySelector('svg')).map(e => e.getAttribute('aria-label')))
  check(JSON.stringify(chosen) === JSON.stringify(['As the device (English)', 'With the language (Darby (English))', 'Off']), 'Darby is the Bible read, and nothing beside it, until a reader chooses otherwise', chosen)
  await page.screenshot({ path: `${shots}/language-sheet.png` })
  // the sheet scrolls: the Bibles under their languages, then the same list for the second Bible
  await page.getByRole('radio', { name: 'Darby (français)' }).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(400)
  await page.screenshot({ path: `${shots}/language-sheet-bibles.png` })
  await page.getByText('Your highlights, notes and reading stay').scrollIntoViewIfNeeded(); await page.waitForTimeout(400)
  await page.screenshot({ path: `${shots}/language-sheet-side.png` })
  check(!errors.length, 'no page errors (Language sheet)', errors)
  await ctx.close()
}
// a reader who never chose a Bible reads Darby; one who chose a text this build leaves out reads Darby and keeps the choice
{
  const { ctx, page } = await open({}, '/read/43/3?v=16', 'For God so loved')
  check((await text(page)).includes('may not perish, but have life eternal'), 'with nothing chosen John 3:16 is Darby’s')
  await ctx.close()
}
if (without) {
  const { ctx, page, errors } = await open({ bible: without, bible2: without === 'kjv' ? 'ylt' : 'kjv' }, '/read/43/3?v=16', 'For God so loved')
  const body = await text(page)
  check(body.includes('may not perish, but have life eternal'), `a reader who had chosen ${NAMES[without]} reads Darby in a build without it`, body.slice(0, 200))
  check((await prefsOf(page)).bible === without, 'and their choice is kept as it was stored', await prefsOf(page))
  check(!errors.length, 'no page errors (a choice left out)', errors)
  const gone = await fetch(`${base}/bible-${without}/43/3.json`)
  check(!(gone.headers.get('content-type') ?? '').includes('json'), `the server has no chapter file of ${NAMES[without]}`, gone.headers.get('content-type'))
  const s = await (await fetch(`${base}/api/search?q=begotten&tx=${without}&limit=3`)).json()
  const darby = new Set((await (await fetch(`${base}/bible/all.json`)).json()).chapters.flatMap(ch => ch.verses.map(v => v.t)))
  check(s.hits?.length > 0 && s.hits.every(r => darby.has(r.text)), 'a search asked of it is answered from Darby', s.hits?.[0])
  await ctx.close()
}

for (const id of here) {
  const name = NAMES[id]
  // ---------- lane 2: the Bible read ----------
  {
    const john = await chapter(id, 43, 3)
    const { ctx, page, errors } = await open({ bible: id }, '/read/43/3?v=16', opening(john.verses[15]))
    const body = await text(page)
    check(body.includes(john.verses[15].t), `${name} read: John 3:16 is the source’s verse`, body.match(/.{0,30}so love.{0,60}/)?.[0])
    check(/John 3 ▾/.test(body), 'the header names the chapter in English', body.slice(0, 80))
    check(!body.includes('have life eternal'), 'and Darby’s verse is not on the page')
    await page.screenshot({ path: `${shots}/${id}-john3.png` })
    check(!errors.length, `no page errors (${name} reader)`, errors)
    await ctx.close()
  }
  // ---------- lanes 3 and 4: beside Darby, verse for verse ----------
  for (const [b, c, v, shot, until] of [[43, 3, 16, id === 'kjv' ? 'parallel.png' : 'parallel-john3-ylt.png', 'For God so loved'], [19, 23, 1, id === 'ylt' ? 'parallel-ylt.png' : 'parallel-psalm23-kjv.png', 'Jehovah is my shepherd']]) {
    const [darby, own] = [await chapter('en', b, c), await chapter(id, b, c)]
    const { ctx, page, errors } = await open({ bible: 'en', bible2: id }, `/read/${b}/${c}?v=${v}`, opening(own.verses[v - 1]))
    const bad = await pairs(page, darby, own)
    check(!bad.length, `Darby with ${name} beside it, ${b === 43 ? 'John 3' : 'Psalm 23'}: all ${darby.verses.length} verses show both, Darby’s first, in order`, bad)
    const body = await text(page)
    if (b === 43) check(body.includes('may not perish, but have life eternal') && body.includes(own.verses[15].t.slice(-40)), `John 3:16: Darby’s “may not perish, but have life eternal” with “${own.verses[15].t.slice(-40)}” under it`)
    else check(body.includes(own.verses[0].t), `Psalm 23:1 of the second reads as its source does: “${own.verses[0].t}”`, body.match(/.{0,20}shepherd.{0,40}/g))
    await page.screenshot({ path: `${shots}/${shot}` })
    check(!errors.length, `no page errors (Darby + ${name})`, errors)
    await ctx.close()
  }
  // ---------- lane 5: where the numbers differ ----------
  {
    for (const [b, c, v, label, shot] of [[64, 1, 14, '3 John', 'versification-3john'], [66, 12, 18, 'Revelation 12', 'versification'], [66, 13, 1, 'Revelation 13', 'versification-rev13']]) {
      const [darby, own] = [await chapter('en', b, c), await chapter(id, b, c)]
      const { ctx, page, errors } = await open({ bible: 'en', bible2: id }, `/read/${b}/${c}?v=${v}`, opening(own.verses[v - 1]))
      const bad = await pairs(page, darby, own)
      check(!bad.length && own.verses.every(x => x.t), `${label}, Darby with ${name}: every one of its ${darby.verses.length} verses has its fellow, none blank`, bad)
      const body = await text(page)
      if (c === 12) {
        const at = body.indexOf('And I stood upon the sand of the sea;')
        check(at >= 0 && /^\s*13:1\s+And I stood upon the sand of the sea,/.test(body.slice(at + 'And I stood upon the sand of the sea;'.length)), `Darby’s 12:18 has ${name}’s “And I stood upon the sand of the sea,” under it, numbered 13:1`, body.slice(at, at + 120))
      }
      if (c === 13) check(body.includes(opening(own.verses[0])) && own.verses[0].nv === undefined, `Darby’s 13:1 has the rest of ${name}’s 13:1 under it, under its own number`)
      if (id === 'kjv') await page.screenshot({ path: `${shots}/${shot}.png` })
      check(!errors.length, `no page errors (${label}, Darby + ${name})`, errors)
      await ctx.close()
    }
    // read as the Bible: its own chapter 13 begins inside Darby's 12, under a heading, and a reference says 13:1
    const { ctx, page } = await open({ bible: id }, '/read/66/12?v=18', 'And I stood upon the sand')
    const body = await text(page)
    check(/Chapter 13\s+1\s*And I stood upon the sand of the sea,/.test(body), `${name} read: “Chapter 13” stands over its verse 1 in Darby’s chapter 12`, body.match(/.{0,60}And I stood upon the sand.{0,10}/)?.[0])
    if (id === 'kjv') await page.screenshot({ path: `${shots}/versification-read.png` })
    await ctx.close()
  }
  // ---------- lane 6: search ----------
  {
    const all = await (await fetch(`${base}/bible-${id}/all.json`)).json()
    const expected = all.chapters.flatMap(ch => ch.verses).filter(v => /\bbegotten\b/i.test(v.t)).length
    const { ctx, page, errors } = await open({ bible: id }, '/search')
    const box = page.getByPlaceholder('jn 3:16, words, or G1320')
    await box.fill('begotten'); await box.press('Enter')
    await drawn(page, 'begotten')
    await page.waitForFunction(() => /\d+ verses? · \d+ ms/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {})
    const body = await text(page)
    const shown = Number(body.match(/([\d,]+) verses? · \d+ ms/)?.[1]?.replace(/,/g, ''))
    check(shown === expected, `searching “begotten” in ${name}: ${expected} verses, the count of the text itself`, { shown, expected })
    const api = await (await fetch(`${base}/api/search?q=begotten&tx=${id}&limit=100`)).json()
    const own = new Set(all.chapters.flatMap(ch => ch.verses.map(v => v.t)))
    const texts = (api.hits ?? []).map(r => r.text ?? '')
    check(api.total === expected && texts.length === expected && texts.every(t => own.has(t)), `and every one of the ${expected} verses the server finds is one of its verses, word for word`, texts.find(t => !own.has(t)) ?? { total: api.total, hits: texts.length })
    await page.screenshot({ path: `${shots}/${id === 'kjv' ? 'search' : 'search-ylt'}.png` })
    check(!errors.length, `no page errors (search, ${name})`, errors)
    await ctx.close()
  }
  // ---------- lane 7: read aloud ----------
  {
    const psalm = await chapter(id, 19, 117)
    // the device's voice on the web is the browser's speech: stand in for it and keep what it is given to say
    const stub = () => {
      window.__said = []
      const speak = u => { window.__said.push({ text: u.text, lang: u.lang }); setTimeout(() => { u.onstart?.({}); u.dispatchEvent?.(new Event('start')) }, 5); setTimeout(() => { u.onend?.({}); u.dispatchEvent?.(new Event('end')) }, 60) }
      const synth = { speak, cancel() {}, pause() {}, resume() {}, getVoices: () => [], speaking: false, pending: false, paused: false, addEventListener() {}, removeEventListener() {} }
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => synth })
    }
    const { ctx, page, errors } = await open({ bible: id, ttsDevice: false, ttsHeading: true, ttsNumbers: false, ttsPause: 'none', ttsAutoNext: false }, '/read/19/117', opening(psalm.verses[0]), { init: stub })
    const recordings = []
    page.on('request', r => { if (/\/api\/tts|\/tts\/|\.mp3|\.m4a|\.ogg|\.opus/.test(r.url())) recordings.push(r.url()) })
    await page.getByLabel('Read aloud').first().click()
    await page.waitForFunction(n => (window.__said ?? []).length >= n, psalm.verses.length + 1, { timeout: 20000 }).catch(() => {})
    const said = await page.evaluate(() => window.__said ?? [])
    // (the player takes the brackets off Young's supplied words before a voice reads them, as it does off Darby's)
    check(said.some(s => s.text === 'Psalms, chapter 117.') && psalm.verses.every(v => said.some(s => s.text === v.t.replace(/[[\]]/g, ''))), `listening with ${name} read: the device’s voice is given its heading in English and its ${psalm.verses.length} verses, word for word`, said.map(s => s.text.slice(0, 50)))
    check(said.every(s => !s.lang || /^en/.test(s.lang)), 'in English, not in a language named after the Bible’s id', said.map(s => s.lang))
    check(recordings.length === 0, 'and no recording of the English Darby is asked for', recordings)
    await page.waitForTimeout(400)
    if (id === 'kjv') await page.screenshot({ path: `${shots}/listen.png` })
    // the recorded voices read Darby's words: with this Bible read they are not offered as if they read it
    const sheet = await listeningSheet(page)
    check(!VOICES.some(v => sheet.includes(v)) && !sheet.includes('AI voices') && !/Hear \w+/.test(sheet) && !sheet.includes('Use the device voice'), `the Listening sheet, with ${name} read, offers no recorded voice: no name, no sample, no switch between them and the device’s`, sheet.slice(0, 260))
    check(sheet.includes(DEVICE_ONLY), 'and says in one line that the device’s own voice reads this Bible, the recorded ones Darby’s words', sheet.slice(0, 260))
    check(['Speed', 'Pause between verses', 'Say verse numbers', 'Continue into the next chapter'].every(w => sheet.includes(w)), 'what is set for the device’s voice is still there')
    if (id === 'kjv') await page.screenshot({ path: `${shots}/listen-sheet.png` })
    check(!errors.length, `no page errors (listening, ${name})`, errors)
    await ctx.close()
  }
  // ---------- lane 8: a highlight stays with its verse ----------
  {
    const [darby, own] = [await chapter('en', 43, 3), await chapter(id, 43, 3)]
    const { ctx, page, errors } = await open({ bible: id }, '/read/43/3', opening(own.verses[0]))
    await showVerse(page, 16)
    check(await tapVerse(page, 16), 'verse 16 is on the page to tap')
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'Highlight yellow' }).click(); await page.waitForTimeout(900)
    const before = await fillBehind(page, opening(own.verses[15]))
    check(before === YELLOW, `John 3:16 highlighted yellow in ${name}`, before)
    await openLanguageSheet(page)
    await page.getByRole('radio', { name: 'Darby (English)', exact: true }).first().click(); await page.waitForTimeout(900)
    check((await prefsOf(page)).bible === 'en', 'Darby chosen in the Language sheet', (await prefsOf(page)).bible)
    await page.goto(base + '/read/43/3', { waitUntil: 'networkidle' })
    await drawn(page, opening(darby.verses[0]))
    await showVerse(page, 16)
    const after = await fillBehind(page, opening(darby.verses[15]))
    const others = await Promise.all([15, 17].map(v => fillBehind(page, opening(darby.verses[v - 1]))))
    check(after === YELLOW && others.every(o => o !== YELLOW), 'in Darby the yellow is on John 3:16, and on that verse alone', { before, after, others })
    if (id === 'kjv') await page.screenshot({ path: `${shots}/marks.png` })
    check(!errors.length, `no page errors (highlight, ${name})`, errors)
    await ctx.close()
  }
  // ---------- lane 9: word lookup ----------
  {
    const own = await chapter(id, 43, 3)
    const { ctx, page, errors } = await open({ bible: id }, '/read/43/3', opening(own.verses[0]))
    await page.getByLabel('More').first().click(); await page.waitForTimeout(600)
    // on a phone the switch is in the More sheet, and its own line says why it stays off; the toast says it too
    const row = page.getByRole('switch', { name: 'Word lookup' }).first()
    const said = await page.evaluate(() => { const at = document.body.innerText.indexOf('Word lookup\n'); return document.body.innerText.slice(at, at + 60) })
    check(said.includes('Word lookup follows Darby’s text') && !said.includes('Strong’s'), `word lookup with ${name} read says plainly, in its own row, that it follows Darby’s text`, said)
    await row.click(); await page.waitForTimeout(600)
    const body = await text(page)
    check(body.split('Word lookup follows Darby’s text').length >= 3, 'tapped, it says so again and stays off', body.split('Word lookup follows Darby’s text').length - 1)
    if (id === 'kjv') await page.screenshot({ path: `${shots}/word.png` })
    check(await page.locator('[aria-label*="Strong’s"]').count() === 0, 'and no word of it is offered as a Strong’s word')
    check(!errors.length, `no page errors (word lookup, ${name})`, errors)
    await ctx.close()
  }
  // About: what is still Darby's
  {
    const { ctx, page } = await open({ bible: id }, '/about', 'About this translation')
    const body = await text(page)
    check(body.includes(id === 'kjv' ? 'You are reading the King James Version' : 'You are reading Young’s Literal Translation') && body.includes('they follow his text whichever Bible you read'), `About, with ${name} read: what is read, and that footnotes, word lookup, the voices and the ministry’s links follow Darby’s text`, body.slice(0, 400))
    if (id === 'kjv') await page.screenshot({ path: `${shots}/about.png` })
    await ctx.close()
  }
}

// ---------- lane 11: the Listening sheet with Darby's own Bibles, as it has always been ----------
for (const [prefs, what, line] of [[{}, 'the English Darby', false], [{ lang: 'en', bible: 'fr' }, 'Darby’s French', true], [{ lang: 'en', bible: 'de' }, 'the Elberfelder', true]]) {
  const { ctx, page, errors } = await open(prefs, '/settings')
  const sheet = await listeningSheet(page)
  check(VOICES.every(v => sheet.includes(v)) && sheet.includes('AI voices, powered by Speechify') && sheet.includes('Hear Alec') && sheet.includes('Use the device voice'), `the Listening sheet with ${what} read lists the three recorded voices, their sample and the device-voice switch`, sheet.slice(0, 260))
  check(sheet.includes(STATED) === line && !sheet.includes(DEVICE_ONLY), line ? 'and says, as before, that they read the English Darby' : 'and has no line about another Bible', sheet.slice(0, 260))
  if (prefs.bible === 'fr') await page.screenshot({ path: `${shots}/listen-sheet-fr.png` })
  check(!errors.length, `no page errors (Listening sheet, ${what})`, errors)
  await ctx.close()
}

// ---------- lane 10: Credits, and a chapter of each with the network off ----------
{
  const { ctx, page, errors } = await open({}, '/credits', 'Elberfelder')
  const body = await text(page)
  const rows = { kjv: ['King James Version (the standardized text of 1769)', 'eBible.org’s text (eng-kjv2006)'], ylt: ['Robert Young, Young’s Literal Translation of the Holy Bible', 'eBible.org’s text (engylt)'] }
  for (const id of here) {
    const at = body.indexOf(rows[id][0]), row = body.slice(at, at + 420)
    check(at >= 0 && row.includes(rows[id][1]) && /Public domain/.test(row), `Credits: ${NAMES[id]} with its source and “Public domain”`, row)
  }
  if (without) check(!body.includes(rows[without][0]), `Credits does not name ${NAMES[without]}`)
  if (here.includes('kjv')) { await page.getByText(rows.kjv[0]).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(300) }
  await page.screenshot({ path: `${shots}/credits.png` })
  check(!errors.length, 'no page errors (Credits)', errors)
  await ctx.close()
}
for (const id of here) {
  const own = await chapter(id, 49, 2)
  const { ctx, page, errors } = await open({ bible: id }, '/read/49/2', opening(own.verses[0]))
  // the service worker registers when the page is idle, then keeps each chapter read
  await page.waitForFunction(async () => !!(await navigator.serviceWorker?.getRegistration()), null, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(4000)
  await page.goto(base + '/read/49/2?v=8', { waitUntil: 'networkidle' }); await drawn(page, opening(own.verses[7]))
  await ctx.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await drawn(page, opening(own.verses[7]))
  const body = await text(page)
  check(own.verses.every(v => body.includes(opening(v))), `with the network off, Ephesians 2 of ${NAMES[id]} is all there (${own.verses.length} verses)`, body.slice(0, 200))
  await page.screenshot({ path: `${shots}/${id === 'kjv' ? 'offline' : 'offline-ylt'}.png` })
  check(!errors.length, `no page errors (offline, ${NAMES[id]})`, errors)
  await ctx.close()
}

// ---------- the review film: choosing a second Bible, reading side by side ----------
if (process.env.FILM && here.length === 2) {
  const { ctx, page } = await open({ reduceMotion: false }, '/read/43/3?v=14', 'For God so loved', { video: process.env.FILM })
  const rest = ms => page.waitForTimeout(ms)
  const scroll = async (dy, steps = 24) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await rest(60) } }
  await rest(2500)
  await page.goto(base + '/settings', { waitUntil: 'networkidle' }); await rest(1200)
  await page.getByRole('button', { name: /Language/ }).first().click(); await rest(1800)
  const side = page.getByRole('radio', { name: NAMES.kjv }).last()
  await side.scrollIntoViewIfNeeded(); await rest(1500)
  await side.click(); await rest(1800)
  await page.goto(base + '/read/43/3?v=14', { waitUntil: 'networkidle' }); await drawn(page, 'should not perish'); await rest(3500)
  await scroll(520); await rest(3500)
  await scroll(520); await rest(3000)
  await openLanguageSheet(page); await rest(800)
  const ylt = page.getByRole('radio', { name: NAMES.ylt }).last()
  await ylt.scrollIntoViewIfNeeded(); await rest(1200)
  await ylt.click(); await rest(1500)
  await page.goto(base + '/read/19/23', { waitUntil: 'networkidle' }); await drawn(page, 'I do not lack'); await rest(4500)
  await scroll(420); await rest(4000)
  await ctx.close()
  console.log(`film: ${fs.readdirSync(process.env.FILM).filter(f => f.endsWith('.webm')).map(f => `${process.env.FILM}/${f}`).join(', ')}`)
}
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
