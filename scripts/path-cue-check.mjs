// The reader on a path (docs/PATHS.md rule 3): with The Gospels started and nothing read, Matthew 1's end cue reads
// "Next on your path · Matthew 2", its end button goes to Matthew 2 and the book pill carries the path dot; John 21, the
// last of the path, offers the canonical next (Acts 1) with no path wording. BASE=http://127.0.0.1:8791 node scripts/path-cue-check.mjs
import { chromium } from 'playwright'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const W = 412, H = 860
const browser = await chromium.launch()
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++ }
const PREFS = JSON.stringify({ theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true, align: 'center', width: 'medium' })
const PATH = JSON.stringify({ path: { id: 'gospels', started_at: '2026-09-01T00:00:00.000Z', target_date: null, pace_per_week: null, with_ministry: false, custom: null }, history: [] })

const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(([p, path]) => { localStorage.setItem('berean_prefs', p); localStorage.setItem('berean_path', path); localStorage.setItem('berean_path_reads', '[]') }, [PREFS, PATH])
const page = await ctx.newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
/** A cue by its label: present in the pager (it is drawn whether or not a pull has opened it). */
const cue = label => page.evaluate(label => [...document.querySelectorAll('div')].some(d => d.childElementCount === 0 && d.textContent === label), label)
const hasText = t => page.evaluate(t => document.body.textContent.includes(t), t)

await page.goto(`${base}/read/40/1`, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Abraham'); await page.waitForTimeout(800)
check(await cue('Next on your path · Matthew 2'), 'Matthew 1: the cue reads “Next on your path · Matthew 2”')
check(!(await cue('Next: Matthew 2')), 'and not the canonical “Next: Matthew 2”')
check(await cue('Previous: Malachi 4'), 'the previous cue is the canonical “Previous: Malachi 4”')
check((await page.locator('[aria-label="On your path"]').count()) === 1, 'the book pill carries the path dot')
check(await hasText('Matt 2 →'), 'the end-of-chapter button goes to Matthew 2')

await page.goto(`${base}/read/43/21`, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Tiberias'); await page.waitForTimeout(800)
check(await cue('Next: Acts 1'), 'John 21, the last of the path: the cue offers the canonical “Next: Acts 1”')
check(!(await hasText('Next on your path')), 'with no path wording anywhere')
check((await page.locator('[aria-label="On your path"]').count()) === 1, 'the pill still shows the dot: John 21 is on the path')

await page.goto(`${base}/read/44/1`, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Theophilus'); await page.waitForTimeout(800)
check((await page.locator('[aria-label="On your path"]').count()) === 0, 'Acts 1, off the path: no dot')
check(await cue('Next: Acts 2'), 'and the canonical cue')

// a companion path: the portion's ministry is offered under the turn buttons, never required
const ctx2 = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx2.addInitScript(([p, path]) => { localStorage.setItem('berean_prefs', p); localStorage.setItem('berean_path', path); localStorage.setItem('berean_path_reads', '[]') }, [PREFS, PATH.replace('"gospels"', '"synopsis"').replace('"with_ministry":false', '"with_ministry":true')])
const page2 = await ctx2.newPage()
page2.on('pageerror', e => errors.push(e.message))
await page2.goto(`${base}/read/1/1`, { waitUntil: 'networkidle' })
await page2.waitForSelector('text=In the beginning'); await page2.waitForTimeout(1500)
check(await page2.evaluate(() => document.body.textContent.includes('then, if you like: Darby on Genesis 1')), 'With Darby’s Synopsis, Genesis 1 offers “then, if you like: Darby on Genesis 1”')
check(await page2.evaluate(() => [...document.querySelectorAll('div')].some(d => d.childElementCount === 0 && d.textContent === 'Next on your path · Genesis 2')), 'and the cue reads “Next on your path · Genesis 2”')
await page2.getByText('then, if you like: Darby on Genesis 1').click(); await page2.waitForTimeout(1500)
check(/\/companion\?/.test(page2.url()) && /from=1\.1\.\d+/.test(page2.url()), `the line opens the library reader with from set (${page2.url()})`)

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
