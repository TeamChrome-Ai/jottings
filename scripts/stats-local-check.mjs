// Signed-out Stats from the device's own read set: tiles, the whole-Bible strip, progress by book, the sign-in card;
// and the calm zero state. BASE=http://127.0.0.1:8787 node scripts/stats-local-check.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const out = '/tmp/bdb-ui'
mkdirSync(out, { recursive: true })
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true, align: 'center', width: 'medium' }
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`) }

const browser = await chromium.launch()
async function open(reads) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(([p, r]) => {
    localStorage.setItem('berean_prefs', JSON.stringify(p))
    if (r) localStorage.setItem('berean_path_reads', JSON.stringify(r))
  }, [prefs, reads])
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(base + '/stats', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Sign in' }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(900)
  return { ctx, page, errors }
}
/** The number under a tile's label. */
const tile = (page, label) => page.getByText(label, { exact: true }).evaluate(el => el.parentElement.lastElementChild.textContent.trim())
const fills = page => page.getByTestId('path-strip-segment').evaluateAll(els => els.map(el => new DOMMatrix(getComputedStyle(el.firstElementChild).transform).a))

// 1. all 21 chapters of John and Psalm 23, read on this device
{
  const at = '2026-09-01T12:00:00.000Z'
  const reads = [...Array.from({ length: 21 }, (_, i) => [43, i + 1, at]), [19, 23, at]]
  const { ctx, page, errors } = await open(reads)
  check('Chapters read here: 22', await tile(page, 'Chapters read here') === '22', await tile(page, 'Chapters read here'))
  check('Books finished here: 1', await tile(page, 'Books finished here') === '1', await tile(page, 'Books finished here'))
  check('the strip has 66 segments', await page.getByTestId('path-strip-segment').count() === 66, String(await page.getByTestId('path-strip-segment').count()))
  const f = await fills(page)
  check('John is filled, Psalms in part, Genesis empty', f[42] > 0.99 && f[18] > 0 && f[18] < 0.05 && f[0] === 0, `John ${f[42]}, Psalms ${f[18]?.toFixed(4)}, Genesis ${f[0]}`)
  check('Progress by book lists John 21/21 and Psalms 1/150', await page.getByText('21/21', { exact: true }).isVisible() && await page.getByText('1/150', { exact: true }).isVisible())
  check('the sign-in card says what an account adds', await page.getByText('Sign in to keep a streak, badges and time, and to read with a group.').count() === 1 && await page.getByRole('button', { name: 'Sign in' }).count() === 1)
  check('no streak, time or badges are shown', !(await page.getByText(/^(Streak|Longest|Time|Badges|This week)$/).count()))
  check('no page errors', !errors.length, errors.join(' | '))
  await page.screenshot({ path: `${out}/stats-local-read.png` })
  await page.screenshot({ path: `${out}/stats-local-read-full.png`, fullPage: true })
  await ctx.close()
}
// 2. nothing read: a calm zero state, not an empty page
{
  const { ctx, page, errors } = await open(null)
  check('zero state says so', await page.getByText(/Nothing read on this device yet/).isVisible())
  check('the strip is there, 66 segments, all empty', await page.getByTestId('path-strip-segment').count() === 66 && (await fills(page)).every(x => x === 0))
  check('no tiles and no list of empty bars', !(await page.getByText('Chapters read here').count()) && !(await page.getByText('Progress by book').count()))
  check('the sign-in card is present', await page.getByText('Sign in to keep a streak, badges and time, and to read with a group.').isVisible() && await page.getByRole('button', { name: 'Sign in' }).isVisible())
  check('no page errors', !errors.length, errors.join(' | '))
  await page.screenshot({ path: `${out}/stats-local-empty.png` })
  await ctx.close()
}
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
