// BASE=http://127.0.0.1:8862 OUT=/tmp/wt-harmony node scripts/harmony-check.mjs
// Playwright pass over the synoptic harmony: 360, 412, 1280 px in Paper and Black; the parallel view, its sticky
// header, "As printed", a tap on a Mark cell into the reader, and a landing on Mark 6:30–44's slot (scroll + wash).
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const BASE = process.env.BASE ?? 'http://127.0.0.1:8862', OUT = process.env.OUT ?? '/tmp/wt-harmony'
const sec = JSON.parse(readFileSync(new URL('../data/ministry/darby/cw-expository-4.json', import.meta.url), 'utf8')).sections.find(s => s.title === 'Relative order of three synoptical Gospels')
const paras = sec.text.split(/\n{2,}/).filter(p => p.trim()).length
const order = sec.figures[0].items.filter(it => 'n' in it).map(e => e.n)
const slot94 = paras + order.indexOf(94)
const URL0 = `${BASE}/companion?author=darby&work=cw-expository-4&n=2`
const b = await chromium.launch()
const errors = [], res = {}
async function open(width, theme, url = URL0) {
  const mobile = width < 800
  const ctx = await b.newContext({ viewport: { width, height: mobile ? 800 : 900 }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile })
  await ctx.addInitScript(t => { if (!sessionStorage.getItem('primed')) { localStorage.setItem('berean_prefs', JSON.stringify({ onboarded: true, toured: true, theme: t, themeLight: t === 'black' ? 'paper' : t, themeDark: t === 'black' ? 'black' : 'slate' })); sessionStorage.setItem('primed', '1') } }, theme)
  const p = await ctx.newPage()
  p.on('pageerror', e => errors.push(`${width} ${theme}: ${e.message}`))
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|404/.test(m.text())) errors.push(`${width} ${theme}: console ${m.text()}`) })
  await p.goto(url, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2500)
  return { ctx, p }
}
const scroller = p => p.evaluateHandle(() => [...document.querySelectorAll('div')].find(d => /auto|scroll/.test(getComputedStyle(d).overflowY) && d.scrollHeight > d.clientHeight + 10 && d.getBoundingClientRect().width > 300 && d.checkVisibility()))
async function scrollTo(p, text, off = 160) {
  const ok = await p.evaluate(([t, off]) => {
    const el = (() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent?.includes(t) || [...n.children].some(c => c.textContent?.includes(t))) continue; if (n.checkVisibility()) return n } return null })()
    if (!el) return false
    let s = el.parentElement
    while (s && !(s.scrollHeight > s.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement
    if (!s) return false
    s.scrollTop += el.getBoundingClientRect().top - off
    return true
  }, [text, off])
  await p.waitForTimeout(700)
  return ok
}
for (const theme of ['paper', 'black']) for (const w of [360, 412, 1280]) {
  const tag = `${w}-${theme}`
  const { ctx, p } = await open(w, theme)
  res[`${tag} top`] = await scrollTo(p, 'Genealogy to David and Abraham', 260)
  await p.screenshot({ path: `${OUT}/${tag}-1-top.png` })
  res[`${tag} feeding`] = await scrollTo(p, 'goes into desert—feeds 5,000', 330)
  await p.screenshot({ path: `${OUT}/${tag}-2-five-thousand.png` })
  // the header held at the top of the scroll area while the rows pass under it
  res[`${tag} sticky`] = await p.evaluate(() => {
    const h = [...document.querySelectorAll('div')].find(d => getComputedStyle(d).position === 'sticky')
    if (!h) return 'no sticky'
    let s = h.parentElement; while (s && !/auto|scroll/.test(getComputedStyle(s).overflowY)) s = s.parentElement
    return Math.round(h.getBoundingClientRect().top - s.getBoundingClientRect().top)
  })
  res[`${tag} no sideways scroll`] = await p.evaluate(() => [...document.querySelectorAll('div')].every(d => d.scrollWidth <= d.clientWidth + 1 || getComputedStyle(d).overflowX === 'hidden' || !d.checkVisibility() || d.getBoundingClientRect().width < 50))
  res[`${tag} doc width`] = await p.evaluate(() => document.documentElement.scrollWidth)
  if (theme === 'paper' || w === 360) {
    await scrollTo(p, 'People come together, friends treat', 330)
    await p.screenshot({ path: `${OUT}/${tag}-3-ambiguous.png` })
    await scrollTo(p, 'Only in Luke', 300)
    await p.screenshot({ path: `${OUT}/${tag}-4-journey.png` })
  }
  if (theme === 'paper') {
    // "As printed", one tap away
    await p.getByRole('radio', { name: 'As printed' }).click()
    await p.waitForTimeout(900)
    await scrollTo(p, 'Account of 5,000 fed.', 260)
    await p.screenshot({ path: `${OUT}/${tag}-5-as-printed.png` })
    res[`${tag} as printed`] = await p.getByText('Account of 5,000 fed.').first().isVisible()
    await p.getByRole('radio', { name: 'In parallel' }).click()
    await p.waitForTimeout(900)
    // tap the Mark cell of the feeding into the reader
    await scrollTo(p, 'goes into desert—feeds 5,000', 330)
    const link = p.getByRole('link', { name: 'Mark 6:30–44' }).first()
    res[`${tag} mark cell visible`] = await link.isVisible()
    await link.click()
    await p.waitForTimeout(2500)
    res[`${tag} after tap`] = p.url().replace(BASE, '')
    await p.screenshot({ path: `${OUT}/${tag}-6-reader.png` })
  }
  await ctx.close()
}
// the verse index's landing: Mark 6:30–44's slot, from Mark 6:35
for (const w of [360, 1280]) {
  const { ctx, p } = await open(w, 'paper', `${URL0}&p=${slot94}&from=41.6.35`)
  await p.screenshot({ path: `${OUT}/${w}-paper-7-landing.png` })
  res[`${w} landing row on screen`] = await p.evaluate(() => {
    const t = 'goes into desert—feeds 5,000', w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT); let el = null; for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent?.includes(t) || [...n.children].some(c => c.textContent?.includes(t))) continue; if (n.checkVisibility()) { el = n; break } }
    const r = el?.getBoundingClientRect()
    const h = [...document.querySelectorAll('div')].find(d => getComputedStyle(d).position === 'sticky')?.getBoundingClientRect()
    // the landed row stands under the held header, in view
    return r && h ? { rowTop: Math.round(r.top), headerBottom: Math.round(h.bottom), clear: r.top > h.bottom && r.bottom < innerHeight } : null
  })
  await ctx.close()
}
console.log(JSON.stringify({ slot94, res, errors: errors.slice(0, 20) }, null, 1))
await b.close()
