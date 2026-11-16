// The assistant's tool table (shared/assistantTools.json): every app row has the app's executor, change_settings can set
// only what the backup restore's validator lets through, every change comes with its Undo, and docs/GUIDE.md has a
// section for every settings row and every routed screen.
import { describe, it, expect, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

vi.mock('../client/node_modules/react-native', () => ({ Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android }, AppState: { addEventListener: () => ({ remove() {} }) }, I18nManager: {}, NativeModules: {} }))
vi.mock('../client/node_modules/@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {} } }))
const { TOOLS, toolRow } = await import('../shared/assistantTools')
const { APP_TOOLS, undo, changeText } = await import('../client/src/lib/assistantActions')
const { readPrefs } = await import('../client/src/lib/backupFile')
const { DEFAULTS } = await import('../client/src/store/prefs')
const { GROUPS, SETTINGS_PAGES } = await import('../client/src/lib/settingsIndex')
const { THEMES } = await import('../client/src/theme')
type Prefs = import('../client/src/store/prefs').Prefs
type ActionContext = import('../client/src/lib/assistantActions').ActionContext

function context(start: Partial<Prefs> = {}) {
  let prefs: Prefs = { ...DEFAULTS, ...start }
  const seen = { routes: [] as unknown[], played: [] as unknown[], stopped: 0, bookmarks: new Map<number, unknown>(), highlights: new Map<number, string>(), feedback: [] as string[] }
  let next = 1
  const ctx: ActionContext = {
    prefs: { get: () => prefs, isLoaded: () => true, set: p => { prefs = { ...prefs, ...p } }, reset: () => {}, subscribe: () => () => {} },
    navigate: href => { seen.routes.push(href) },
    player: { start: (book, chapter, verse) => { seen.played.push([book, chapter, verse]) }, stop: () => { seen.stopped++ }, now: () => null },
    place: async () => ({ book: 43, chapter: 3, verse: 1 }),
    // as the app's own: a place already bookmarked answers with the bookmark it has
    bookmarks: {
      find: async b => [...seen.bookmarks].find(([, x]) => JSON.stringify(x) === JSON.stringify(b))?.[0] ?? null,
      add: async b => { const had = [...seen.bookmarks].find(([, x]) => JSON.stringify(x) === JSON.stringify(b)); if (had) return had[0]; const id = next++; seen.bookmarks.set(id, b); return id },
      remove: async id => { seen.bookmarks.delete(id) },
    },
    highlights: { get: async ids => new Map(ids.flatMap(id => seen.highlights.has(id) ? [[id, seen.highlights.get(id)!] as const] : [])), set: async (id, c) => { if (c) seen.highlights.set(id, c); else seen.highlights.delete(id) } },
    feedback: m => { seen.feedback.push(m) },
    paragraph: id => id === 12345 ? { id, author: 'darby', work: { id: 'cw-1', title: 'Collected Writings 1', collection: 'cw' }, n: 2, para: 3, section: 'On grace' } : undefined,
    // nobody signed in: the tools for the reader's own jottings have tests/assistantOutlines.test.ts
    jottings: { uid: () => null, list: async () => [], get: async () => { throw new Error('signed out') }, create: async () => { throw new Error('signed out') }, save: async () => undefined, rename: async () => undefined, remove: async () => {}, settle: async () => true, settleAll: async () => [], hold: async () => () => {} },
  }
  return { ctx, seen, prefs: () => prefs }
}

describe('the table', () => {
  it('names each tool once, with an object input, a side and whether it changes anything', () => {
    expect(new Set(TOOLS.map(r => r.name)).size).toBe(TOOLS.length)
    for (const r of TOOLS) {
      expect(r.name, r.name).toMatch(/^[a-z_]+$/)
      expect(r.description.length, r.name).toBeGreaterThan(10)
      expect(r.input.type, r.name).toBe('object')
      expect(r.input.additionalProperties, r.name).toBe(false)
      expect(['server', 'app'], r.name).toContain(r.runs)
      expect(typeof r.changes, r.name).toBe('boolean')
    }
  })
  it('has no tool that signs out, deletes, concerns another person or spends money', () => {
    for (const r of TOOLS) expect(r.name, r.name).not.toMatch(/sign|log_?out|delete|remove|erase|account|friend|group|report|block|moderat|ban|buy|pay|purchase|donat|subscri/)
  })
  it('gives every app row the app’s executor, and the app no executor without a row', () => {
    const app = TOOLS.filter(r => r.runs === 'app').map(r => r.name).sort()
    expect(Object.keys(APP_TOOLS).sort()).toEqual(app)
  })
  it('lists in change_settings exactly the settings a backup restores, and the themes the app has', () => {
    const props = toolRow('change_settings')!.input.properties
    expect(Object.keys(props).sort()).toEqual(Object.keys(readPrefs({ ...DEFAULTS }) ?? {}).sort())
    const ids = THEMES.map(th => th.id)
    expect(props.theme.enum).toEqual(['system', ...ids])
    expect([...props.themeLight.enum!, ...props.themeDark.enum!].sort()).toEqual([...ids].sort())
  })
  it('names the themes in change_settings once, in the fields that take them, not again in its description', () => {
    const said = toolRow('change_settings')!.description
    // the two a reader gets by default, and the word the true black ones begin with
    expect(THEMES.map(th => th.id).filter(id => new RegExp(`\\b${id}\\b`).test(said))).toEqual(['paper', 'slate', 'black'])
    expect(said).toContain('system follows the device between themeLight and themeDark')
  })
  it('gives change_settings the ranges the validator holds to', () => {
    for (const [key, p] of Object.entries(toolRow('change_settings')!.input.properties)) {
      const ok = (v: unknown) => readPrefs({ [key]: v })?.[key as keyof ReturnType<typeof readPrefs>] !== undefined
      if (p.minimum !== undefined) expect([ok(p.minimum), ok(p.maximum), ok(p.minimum - 0.01), ok(p.maximum! + 0.01)], key).toEqual([true, true, false, false])
      if (p.enum && key !== 'theme' && key !== 'themeLight' && key !== 'themeDark') { for (const v of p.enum) expect(ok(v), `${key} ${v}`).toBe(true); expect(ok('none of these'), key).toBe(false) }
      if (p.type === 'boolean') expect([ok(true), ok('yes')], key).toEqual([true, false])
    }
  })
})

describe('change_settings', () => {
  it('sets what it is asked, one line with Undo for each, and Undo puts each back', async () => {
    const { ctx, prefs } = context({ fontSize: 19, theme: 'paper' })
    const out = await APP_TOOLS.change_settings({ fontSize: 22, theme: 'slate' }, ctx)
    expect([prefs().fontSize, prefs().theme]).toEqual([22, 'slate'])
    expect(out.changes.map(c => c.line)).toEqual([{ kind: 'setting', key: 'fontSize', from: 19, to: 22 }, { kind: 'setting', key: 'theme', from: 'paper', to: 'slate' }])
    expect(out.changes.map(c => changeText(c.line))).toEqual(['Text size: 19 → 22', 'Theme: Paper → Slate'])
    for (const c of out.changes) await undo(c.undo, ctx)
    expect([prefs().fontSize, prefs().theme]).toEqual([19, 'paper'])
  })
  it('refuses what the validator refuses, says the range, and changes nothing', async () => {
    const { ctx, prefs } = context({ fontSize: 19 })
    const out = await APP_TOOLS.change_settings({ fontSize: 400, theme: 'neon', lineHeight: 'tall', onboarded: false, customFonts: [] }, ctx)
    expect(prefs()).toEqual({ ...DEFAULTS, fontSize: 19 })
    expect(out.changes).toEqual([])
    expect(out.result).toEqual({ changed: {}, refused: { fontSize: 'from 14 to 32', theme: 'one of system, paper, sepia, linen, sand, mint, sky, rose, lavender, olive, slate, midnight, forest, wine, nord, plum, graphite, ocean, black, black-ember, black-jade, black-ice, black-rose, black-gold, black-lilac, black-white', lineHeight: 'from 1.2 to 2.4', onboarded: 'not a setting Ask can change', customFonts: 'not a setting Ask can change' } })
  })
  it('makes no line for a value already set', async () => {
    const { ctx } = context({ fontSize: 19 })
    expect((await APP_TOOLS.change_settings({ fontSize: 19 }, ctx)).changes).toEqual([])
  })
})

describe('get_settings', () => {
  it('returns the settings change_settings takes, nothing else', async () => {
    const { ctx } = context({ fontSize: 21 })
    const { result } = await APP_TOOLS.get_settings({}, ctx)
    expect(Object.keys(result as object).sort()).toEqual(Object.keys(toolRow('change_settings')!.input.properties).sort())
    expect((result as Prefs).fontSize).toBe(21)
  })
})

describe('navigation', () => {
  it('opens a verse, a paragraph of this conversation, a screen, an article and the bookmarks', async () => {
    const { ctx, seen } = context()
    await APP_TOOLS.open_chapter({ reference: 'John 3:16' }, ctx)
    await APP_TOOLS.open_paragraph({ id: 12345 }, ctx)
    await APP_TOOLS.open_screen({ screen: 'settings/text' }, ctx)
    await APP_TOOLS.open_dictionary_entry({ id: 'grace' }, ctx)
    await APP_TOOLS.show_bookmarks({}, ctx)
    expect(seen.routes).toEqual([
      { pathname: '/read/[book]/[chapter]', params: { book: '43', chapter: '3', v: '16' } },
      { pathname: '/companion', params: { author: 'darby', work: 'cw-1', n: '2', p: '3' } },
      '/settings/text', { pathname: '/dictionary', params: { id: 'grace' } }, '/bookmarks',
    ])
  })
  it('opens a screen for every name the table offers', async () => {
    const { ctx, seen } = context()
    for (const screen of toolRow('open_screen')!.input.properties.screen.enum!) await APP_TOOLS.open_screen({ screen }, ctx)
    expect(seen.routes.length).toBe(toolRow('open_screen')!.input.properties.screen.enum!.length)
  })
  it('tells the model nothing of the library when it opens a paragraph: only the reader’s own words and the app’s own state go back', async () => {
    const { ctx } = context()
    expect((await APP_TOOLS.open_paragraph({ id: 12345 }, ctx)).result).toEqual({ opened: 12345 })
  })
  it('says so, and goes nowhere, for a place there is not', async () => {
    const { ctx, seen } = context()
    const outs = [await APP_TOOLS.open_chapter({ reference: 'Hezekiah 3' }, ctx), await APP_TOOLS.open_paragraph({ id: 1 }, ctx), await APP_TOOLS.open_screen({ screen: 'admin' }, ctx)]
    expect(outs.map(o => typeof (o.result as { error?: string }).error)).toEqual(['string', 'string', 'string'])
    expect(seen.routes).toEqual([])
  })
})

describe('listening, marks and feedback', () => {
  it('starts and stops reading aloud, each with Undo', async () => {
    const { ctx, seen } = context()
    const started = await APP_TOOLS.start_listening({ reference: 'Psalm 23' }, ctx)
    expect(seen.played).toEqual([[19, 23, 1]])
    await undo(started.changes[0].undo, ctx)
    expect(seen.stopped).toBe(1)
  })
  it('adds a bookmark and a highlight, and Undo removes each', async () => {
    const { ctx, seen } = context()
    const b = await APP_TOOLS.add_bookmark({ reference: 'John 3:16' }, ctx)
    const h = await APP_TOOLS.add_highlight({ reference: 'John 3:16-17', colour: 'green' }, ctx)
    expect([seen.bookmarks.size, [...seen.highlights]]).toEqual([1, [[43003016, 'green'], [43003017, 'green']]])
    expect([b.changes.length, h.changes.length]).toEqual([1, 1])
    await undo(b.changes[0].undo, ctx)
    await undo(h.changes[0].undo, ctx)
    expect([seen.bookmarks.size, seen.highlights.size]).toEqual([0, 0])
  })
  it('makes no line for a bookmark the reader already had, so no Undo can remove it', async () => {
    const { ctx, seen } = context()
    seen.bookmarks.set(7, { book: 43, chapter: 3, verse: 16 })
    const out = await APP_TOOLS.add_bookmark({ reference: 'John 3:16' }, ctx)
    expect([out.changes, [...seen.bookmarks.keys()]]).toEqual([[], [7]])
  })
  it('promises no Undo for a highlight when what the verse had cannot be read, and colours nothing', async () => {
    const { ctx, seen } = context()
    ctx.highlights.get = async () => null
    const out = await APP_TOOLS.add_highlight({ reference: 'John 3:16', colour: 'green' }, ctx)
    expect([typeof (out.result as { error?: string }).error, out.changes, seen.highlights.size]).toEqual(['string', [], 0])
  })
  it('stops reading aloud while a chapter is still loading', async () => {
    const { ctx, seen } = context()
    await APP_TOOLS.stop_listening({}, ctx)
    expect(seen.stopped).toBe(1)
  })
  it('opens the feedback form with the draft and sends nothing', async () => {
    const { ctx, seen } = context()
    const out = await APP_TOOLS.draft_feedback({ message: 'The text is too small on my tablet.' }, ctx)
    expect([seen.feedback, out.changes]).toEqual([['The text is too small on my tablet.'], []])
  })
  it('makes a line with Undo for every row that changes something, and none for the rest', () => {
    for (const r of TOOLS.filter(r => r.runs === 'app')) expect(r.changes, r.name).toBe(['change_settings', 'start_listening', 'stop_listening', 'add_bookmark', 'add_highlight', 'create_jotting', 'edit_jotting'].includes(r.name))
  })
})

describe('docs/GUIDE.md', () => {
  const guide = existsSync(join(__dirname, '../docs/GUIDE.md')) ? readFileSync(join(__dirname, '../docs/GUIDE.md'), 'utf8') : ''
  const marked = (kind: string) => new Set([...guide.matchAll(new RegExp(`<!-- ${kind}: ([^>]+) -->`, 'g'))].flatMap(m => m[1].trim().split(/\s+/)))
  const app = join(__dirname, '../client/app')
  const files = (d: string): string[] => readdirSync(d).flatMap(f => statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)])
  const routes = files(app).filter(f => f.endsWith('.tsx') && !/_layout|\+not-found/.test(f) && !readFileSync(f, 'utf8').includes('<Alias'))
    .map(f => '/' + relative(app, f).replace(/\.tsx$/, '').split('/').filter(p => !/^\(.*\)$/.test(p)).join('/').replace(/(^|\/)index$/, '')).map(r => r.replace(/\/$/, '') || '/')
  it('has a section for every routed screen', () => {
    const covered = marked('route')
    expect(routes.length).toBeGreaterThan(30)
    expect(routes.filter(r => !covered.has(r))).toEqual([])
  })
  it('has a section for every row of Settings and every page it pushes', () => {
    const covered = marked('setting')
    expect([...GROUPS.map(g => g.id), ...SETTINGS_PAGES].filter(id => !covered.has(id))).toEqual([])
  })
  it('marks only screens and settings there are', () => {
    expect([...marked('route')].filter(r => !routes.includes(r))).toEqual([])
    expect([...marked('setting')].filter(id => !GROUPS.some(g => g.id === id) && !(SETTINGS_PAGES as readonly string[]).includes(id))).toEqual([])
  })
})
