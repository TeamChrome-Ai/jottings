// Where each tour step's spotlight must land, found the way a reader would find it (by role, name or words), not
// through the tour's own registry: the check is that the hole in the veil is round the thing the step's copy names.
// Shared by tour-check.mjs and tour-full-check.mjs. The step is recognised by its words (lib/tour.ts, loaded as
// TypeScript by Node's type stripping, after scripts/brand.mjs has taught node the app's imports).
import { NOUN } from './brand.mjs'
const { EXTENDED, STEPS } = await import('../client/src/lib/tour.ts')

const dialog = page => page.getByRole('dialog').last()
const btn = (page, name) => page.getByRole('button', { name, exact: typeof name === 'string' })
const text = (page, t) => page.getByText(t, { exact: typeof t === 'string' })

/** Per step id: the elements that must sit inside the spotlight (at least their centres, most of their box). */
export const SPOTS = {
  picker: p => [btn(p, /▾$/)],
  note: p => [btn(p, 'Close note')],
  verse: p => [btn(p, 'Highlight yellow'), btn(p, 'Copy'), btn(p, 'Listen')],
  lookup: p => [dialog(p).getByText('Word lookup', { exact: true })],
  'lookup-wide': p => [btn(p, 'Word lookup')],
  listen: p => [btn(p, 'Read aloud')],
  // each tab's glyph: a tab's own box (and its label's) runs the whole width of its share of the bar
  tabs: p => ['Home', 'Read', 'Search', 'Stats', 'Settings'].map(n => p.getByRole('tab', { name: new RegExp(`^${n}`) }).locator('svg').first()),
  theme: p => [btn(p, 'Theme')],
  'theme-pick': p => [dialog(p).getByRole('radio').first()],
  more: p => [btn(p, 'More')],
  'more-size': p => [dialog(p).getByRole('button', { name: 'Larger text' })],
  'more-bookmark': p => [dialog(p).getByRole('button', { name: /chapter bookmark|Bookmark this chapter/ })],
  'more-ministry': p => [dialog(p).getByRole('button', { name: 'Ministry on this chapter' })],
  'more-paged': p => [dialog(p).getByRole('button', { name: 'Paged mode' })],
  size: p => [btn(p, 'Smaller text'), btn(p, 'Larger text')],
  'chapter-ministry': p => [btn(p, 'Ministry on this chapter')],
  paged: p => [btn(p, 'Paged mode')],
  end: p => [btn(p, /→$/)],
  player: p => [btn(p, /^(Pause|Play)$/), btn(p, 'Previous verse'), btn(p, 'Next verse')],
  listening: p => [dialog(p).getByText('Speed', { exact: true })],
  word: p => [dialog(p).getByRole('radio', { name: 'Concordance' })],
  ministry: p => [dialog(p).getByRole('link').first()],
  library: p => [p.getByRole('heading').filter({ visible: true }).first()],
  'library-back': p => [btn(p, /^Back to the verse/)],
  votd: p => [text(p, 'Today’s verse'), text(p, 'Read the chapter')],
  streak: p => [p.getByText(/streak/i).first()],
  'streak-out': p => [text(p, 'Keep a daily reading streak')],
  bookmarks: p => [text(p, 'Bookmarks')],
  chronology: p => [text(p, 'Chronological table')],
  dictionary: p => [text(p, 'Morrish’s dictionary, Strong’s concordance')],
  'ministry-library': p => [text(p, 'Darby and Coates')],
  together: p => [text(p, 'Together'), text(p, 'Reading groups')],
  'together-out': p => [text(p, 'Together'), text(p, 'Reading groups')],
  'outlines-public': p => [text(p, `Public ${NOUN.many}`)],
  'outlines-new': p => [p.getByPlaceholder(`New ${NOUN.one} title`), btn(p, `New ${NOUN.one}`)],
  'outlines-open': p => [text(p, `Sample ${NOUN.one}`)],
  'editor-add': p => [p.getByPlaceholder(/^Add a passage/)],
  'editor-items': p => [p.getByPlaceholder('Heading').first()],
  'editor-share': p => [text(p, 'Visibility')],
  'editor-share-out': p => [text(p, 'Visibility')],
  'editor-print': p => [dialog(p).getByText(/^\d+ pages?$/)],
  'friends-out': p => [text(p, 'Read alongside friends')],
  'friends-add': p => [p.getByLabel('Their handle, exactly')],
  'friends-streak': p => [p.getByRole('button', { name: /@/ }).first()],
  'groups-out': p => [text(p, 'Read together')],
  'groups-create': p => [p.getByText(/Start a group|Create/).first()],
  'groups-join': p => [p.getByText(/Join/).first()],
  'group-streak': p => [p.getByText(/have read today|streak/i).first()],
  'group-members': p => [p.getByText(/Members?/).first()],
  'group-events': p => [p.getByText(/Events?/).first()],
  'group-feed': p => [p.getByText(/Feed|Post/).first()],
  'search-field': p => [p.getByPlaceholder('jn 3:16, words, or G1320')],
  'search-scope': p => [text(p, 'Old Testament'), text(p, 'New Testament')],
  stats: p => [text(p, 'Streak'), text(p, 'Longest')],
  badges: p => [p.getByRole('heading', { name: 'Badges' }).first()],
  'stats-out': p => [p.getByText(/Sign in to keep a streak/).first()],
  'settings-text': p => [p.getByLabel('Preview of the reading text')],
  'settings-reading': p => [text(p, 'Paragraphs'), text(p, 'Reduce animation')],
  'settings-listening': p => [text(p, 'Voice, speed and pauses')],
  'settings-again': p => [text(p, 'Welcome and tour')],
  'settings-account': p => [btn(p, 'Choose your picture')],
  'settings-account-out': p => [text(p, 'Not signed in')],
  'settings-reset': p => [btn(p, 'Reset all settings')],
}

const ALL = [...STEPS, ...EXTENDED]
/** The step whose words the label shows (the tablet's word lookup has the phone's words: `wide` tells them apart). */
export const stepByText = (words, wide) => ALL.filter(s => s.text === words).find(s => !s.when || (s.when === 'wide') === wide) ?? null

/** The spotlight as drawn: the veil's hole, read from its path (lib/tour.ts veilPath: the second subpath). */
export async function holeOf(page) {
  const d = await page.evaluate(() => [...document.querySelectorAll('svg path[fill-rule="evenodd"]')].map(p => p.getAttribute('d')).find(d => d && d.split('Z').length > 2) ?? null)
  if (!d) return null
  const inner = d.slice(d.indexOf('Z') + 1)
  const n = inner.match(/-?\d+(\.\d+)?/g).map(Number)
  // M x+r y H x2-r A r r 0 0 1 x2 y+r V y2-r A r r 0 0 1 x2-r y2 H x+r A r r 0 0 1 x y2-r V y+r A …
  return { x: n[24], y: n[1], w: n[8] - n[24], h: n[17] - n[1] }
}

/** The on-screen copy of a locator's matches (the reader keeps the chapters either side mounted off to the side). */
async function onScreen(loc, view) {
  const n = await loc.count()
  for (let i = 0; i < n; i++) {
    const b = await loc.nth(i).boundingBox().catch(() => null)
    if (b && b.width > 0 && b.x + b.width / 2 > 0 && b.x + b.width / 2 < view.width && b.y + b.height / 2 > 0 && b.y + b.height / 2 < view.height) return b
  }
  return null
}

/**
 * Whether the spotlight is round what step `id` names: every expected element found on screen, its centre inside the
 * hole and at least 70% of its box inside.
 */
export async function landed(page, id, view) {
  const spots = SPOTS[id]
  if (!spots) return { ok: false, why: `no expectation for ${id}` }
  const hole = await holeOf(page)
  if (!hole) return { ok: false, why: 'no spotlight' }
  const boxes = []
  for (const loc of spots(page)) {
    const b = await onScreen(loc, view)
    if (!b) return { ok: false, why: `${id}: an expected element is not on screen (${loc})`, hole }
    boxes.push(b)
  }
  for (const b of boxes) {
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2
    const ix = Math.max(0, Math.min(b.x + b.width, hole.x + hole.w) - Math.max(b.x, hole.x)), iy = Math.max(0, Math.min(b.y + b.height, hole.y + hole.h) - Math.max(b.y, hole.y))
    const share = (ix * iy) / (b.width * b.height)
    if (!(cx >= hole.x && cx <= hole.x + hole.w && cy >= hole.y && cy <= hole.y + hole.h) || share < 0.7)
      return { ok: false, why: `${id}: element at ${fmt(b)} is ${Math.round(share * 100)}% inside the hole ${fmt(hole)}`, hole }
  }
  return { ok: true, hole, boxes }
}
const fmt = b => `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width ?? b.w)}x${Math.round(b.height ?? b.h)}`
