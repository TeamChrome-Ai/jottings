import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { NOUN } from '../shared/brand'
import { CHOICE, EMPTY_SCENE, EXTENDED, FINAL_TEXT, STEPS, demoNoteOf, progressText, sceneActions, stepsFor, easeOut, glideMs, lerpHole, pickOnScreen, placeLabel, sameRect, spotlight, union, veilPath, visibleShare } from '../client/src/lib/tour'

const VIEW = { x: 0, y: 0, w: 412, h: 915 }
const INSETS = { top: 24, bottom: 0 }

const ALL = [...STEPS, ...EXTENDED]
const CONTEXTS = [false, true].flatMap(wide => [false, true].flatMap(signedIn => [false, true].flatMap(inGroup => [false, true].map(hasFriends => ({ wide, signedIn, inGroup, hasFriends })))))

describe('steps', () => {
  it('is six steps, the Bible first: the book button, a note, a verse, word lookup, read aloud, then the tab bar', () => {
    const phone = stepsFor('short', { wide: false, signedIn: false, inGroup: false }).map(s => s.id)
    const tablet = stepsFor('short', { wide: true, signedIn: true, inGroup: true }).map(s => s.id)
    expect(phone).toEqual(['picker', 'note', 'verse', 'lookup', 'listen', 'tabs'])
    expect(tablet).toEqual(['picker', 'note', 'verse', 'lookup-wide', 'listen', 'tabs'])
    expect(STEPS.every(s => s.scene.route === 'reader')).toBe(true)
    // the tab bar is one step and the last, so nothing the tour points at is left behind by a move to another screen
    const tabSteps = STEPS.filter(s => s.targets.some(t => t.startsWith('tab-')))
    expect(tabSteps.map(s => s.id)).toEqual(['tabs'])
    expect(STEPS[STEPS.length - 1].targets).toEqual(['tab-home', 'tab-read', 'tab-search', 'tab-stats', 'tab-settings'])
  })
  it('says what each step shows: bookmarking in the picker, Ministry on a verse, both parts of word lookup', () => {
    const say = (id: string) => ALL.find(s => s.id === id)!.text
    expect(say('picker')).toMatch(/hold one to bookmark/)
    expect(say('verse')).toContain(`highlight, bookmark, ${NOUN.verbLower}, and Ministry`)
    expect(say('lookup')).toMatch(/Hebrew or Greek/)
    expect(say('lookup')).toMatch(/dictionary/)
    expect(say('lookup-wide')).toBe(say('lookup'))
    // the verse step shows the selection bar it describes, not the text with a request to tap it
    expect(STEPS.find(s => s.id === 'verse')!.scene.select).toBe(true)
  })
  it('speaks in the house voice: short, one clause, sentence case, typographic quotes, no exclamations', () => {
    for (const s of [...ALL.map(s => s.text), FINAL_TEXT, CHOICE.text, CHOICE.more, CHOICE.enough]) {
      expect(s).not.toMatch(/!|'|"/)
      expect(s[0]).toBe(s[0].toUpperCase())
      expect(s.length, s).toBeLessThanOrEqual(84)
    }
    // one sentence a step
    for (const s of ALL) expect(s.text.replace(/\b(Rom|Ps|jn) \d/g, '').split(/[.?]\s/).length, s.id).toBe(1)
    // the reference example must be one Search really understands, and nothing promises it reads a misspelling
    expect(EXTENDED.find(s => s.id === 'search-field')!.text).toContain('Rom 8:28')
    expect(ALL.map(s => s.text).join(' ')).not.toMatch(/misspell/i)
  })
  it('never asks for a tap it does not wait for: only a step whose spotlight takes taps says “Tap”', () => {
    for (const s of ALL) if (/^Tap\b/.test(s.text)) expect(s.interactive, s.id).toBe(true)
  })
})

describe('the registry', () => {
  // every element a step points at is registered where it is drawn: tourRef('…') or a tab icon's target
  const root = join(__dirname, '../client')
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('android') ? [] : files(join(dir, e.name))) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [])
  const registered = new Set<string>()
  for (const f of [...files(join(root, 'app')), ...files(join(root, 'src'))]) {
    if (f.endsWith('lib/tour.ts')) continue
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/tourRef\('([a-z-]+)'\)|target="([a-z-]+)"|icon\('[a-z]+', f, '([a-z-]+)'\)/g)) registered.add(m[1] ?? m[2] ?? m[3])
  }
  it('has every step’s target', () => {
    for (const s of ALL) for (const t of s.targets) expect(registered.has(t), `${s.id} → ${t}`).toBe(true)
  })
  it('registers nothing no step points at', () => {
    const used = new Set(ALL.flatMap(s => s.targets))
    expect([...registered].filter(t => !used.has(t))).toEqual([])
  })
})

describe('finding the element', () => {
  it('takes the copy that is on screen, not the neighbouring chapters kept off to the sides', () => {
    const left = { x: -400, y: 100, w: 380, h: 40 }, here = { x: 12, y: 100, w: 380, h: 40 }, right = { x: 424, y: 100, w: 380, h: 40 }
    expect(pickOnScreen([left, here, right], VIEW)).toBe(1)
    expect(pickOnScreen([left, right], VIEW)).toBe(-1)
    expect(pickOnScreen([{ x: 300, y: 100, w: 200, h: 40 }, here], VIEW)).toBe(1)
  })
  it('measures visibility as a share of the box', () => {
    expect(visibleShare({ x: 0, y: 0, w: 100, h: 100 }, VIEW)).toBe(1)
    expect(visibleShare({ x: -50, y: 0, w: 100, h: 100 }, VIEW)).toBe(0.5)
    expect(visibleShare({ x: 0, y: 0, w: 0, h: 10 }, VIEW)).toBe(0)
  })
  it('joins a note with the text that holds its letter', () => {
    expect(union({ x: 20, y: 300, w: 370, h: 90 }, { x: 30, y: 392, w: 360, h: 70 })).toEqual({ x: 20, y: 300, w: 370, h: 162 })
  })
  it('opens a lettered note of the opening verses, never a divine-name mark', () => {
    const verses = [{ v: 1, notes: [{ id: 1, marker: '·', text: 'El' }] }, { v: 2 }, { v: 3, notes: [{ id: 7, marker: '†', text: 'Eloah' }, { id: 8, marker: 'd', text: 'Or "revives."' }] }]
    expect(demoNoteOf(verses)).toBe(8)
    expect(demoNoteOf(verses, 2)).toBeNull()
    expect(demoNoteOf([])).toBeNull()
  })
  it('prefers one short enough to read at a glance (John 1’s first is a page long)', () => {
    const long = 'x'.repeat(600), mid = 'y'.repeat(300)
    expect(demoNoteOf([{ v: 2, notes: [{ id: 1, marker: 'c', text: long }] }, { v: 5, notes: [{ id: 2, marker: 'e', text: 'Or <i>overcome</i> it.' }] }])).toBe(2)
    expect(demoNoteOf([{ v: 2, notes: [{ id: 1, marker: 'c', text: long }] }, { v: 5, notes: [{ id: 2, marker: 'e', text: mid }] }])).toBe(2)
  })
})

describe('spotlight', () => {
  const tab = STEPS.find(s => s.id === 'tabs')!
  it('reaches from a tab icon down over its label, padded', () => {
    const icon = { x: 100, y: 857, w: 60, h: 32 }
    const h = spotlight(icon, tab, { ...VIEW, h: 915 + 40 })
    expect(h.x).toBe(100 - 4 - 4)
    expect(h.y).toBe(857 - 2 - 4)
    expect(h.y + h.h).toBe(857 + 32 + 22 + 4)
  })
  it('stays inside the screen and never rounds past half its size', () => {
    const h = spotlight({ x: -20, y: 890, w: 60, h: 60 }, tab, VIEW)
    expect(h.x).toBeGreaterThanOrEqual(4)
    expect(h.y + h.h).toBeLessThanOrEqual(VIEW.h - 4)
    expect(h.r).toBeLessThanOrEqual(Math.min(h.w, h.h) / 2)
    const pill = spotlight({ x: 10, y: 50, w: 150, h: 44 }, STEPS.find(s => s.id === 'picker')!, VIEW)
    expect(pill.r).toBe(pill.h / 2)
  })
  it('cuts a tall block to its opening lines', () => {
    const text = STEPS.find(s => s.id === 'note')!
    const h = spotlight({ x: 20, y: 200, w: 372, h: 900 }, text, VIEW)
    expect(h.h).toBeLessThanOrEqual(VIEW.h * text.maxShare! + 0.001)
  })
})

describe('label', () => {
  const label = { w: 340, h: 150 }
  const o = { gap: 14, margin: 16, insets: INSETS }
  it('sits above a tab, below the toolbar', () => {
    const tabHole = { x: 90, y: 850, w: 80, h: 64 }
    const a = placeLabel(tabHole, VIEW, label, o)
    expect(a.below).toBe(false)
    expect(a.y + label.h).toBe(tabHole.y - o.gap)
    const bar = { x: 8, y: 30, w: 170, h: 56 }
    const b = placeLabel(bar, VIEW, label, o)
    expect(b.below).toBe(true)
    expect(b.y).toBe(bar.y + bar.h + o.gap)
  })
  it('is centred on the spotlight but kept inside the margins', () => {
    const p = placeLabel({ x: 0, y: 100, w: 60, h: 40 }, VIEW, label, o)
    expect(p.x).toBe(16)
    const q = placeLabel({ x: 180, y: 100, w: 52, h: 40 }, VIEW, label, o)
    expect(q.x).toBe(206 - 170)
  })
  it('goes where there is more room when neither side fits, and stays on screen', () => {
    const tall = placeLabel({ x: 20, y: 300, w: 372, h: 500 }, VIEW, label, o)
    expect(tall.below).toBe(false)
    expect(tall.y).toBeGreaterThanOrEqual(INSETS.top + o.margin)
    expect(tall.y + label.h).toBeLessThanOrEqual(VIEW.h - o.margin)
  })
})

describe('glide', () => {
  it('takes the pager’s turn for a short hop and a little longer across the screen', () => {
    const a = { x: 100, y: 850, w: 80, h: 64 }
    expect(glideMs(a, a, VIEW)).toBe(300)
    const far = glideMs(a, { x: 8, y: 30, w: 170, h: 56 }, VIEW)
    expect(far).toBeGreaterThan(400)
    expect(far).toBeLessThanOrEqual(460)
  })
  it('eases out and lands exactly', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(0.5)).toBeGreaterThan(0.8)
    const a = { x: 0, y: 0, w: 10, h: 10, r: 5 }, b = { x: 100, y: 200, w: 50, h: 30, r: 15 }
    expect(lerpHole(a, b, 1)).toEqual(b)
    expect(lerpHole(a, b, 0.5)).toEqual({ x: 50, y: 100, w: 30, h: 20, r: 10 })
  })
  it('does not restart for a re-measure within a pixel', () => {
    expect(sameRect({ x: 1, y: 1, w: 10, h: 10 }, { x: 1.6, y: 0.5, w: 10.9, h: 10 })).toBe(true)
    expect(sameRect({ x: 1, y: 1, w: 10, h: 10 }, { x: 3, y: 1, w: 10, h: 10 })).toBe(false)
    expect(sameRect(null, { x: 1, y: 1, w: 10, h: 10 })).toBe(false)
  })
})

describe('veil', () => {
  it('is the screen with a rounded hole, for an even-odd fill', () => {
    const d = veilPath(412, 915, { x: 10, y: 20, w: 100, h: 40, r: 12 })
    expect(d.startsWith('M0 0H412V915H0Z')).toBe(true)
    expect(d).toContain('M22 20H98A12 12 0 0 1 110 32')
    expect(d.match(/A/g)).toHaveLength(4)
    expect(d.endsWith('Z')).toBe(true)
  })
  it('clamps the corner radius to the hole', () => {
    expect(veilPath(100, 100, { x: 0, y: 0, w: 20, h: 10, r: 99 })).toContain('A5 5')
  })
})

describe('the full tour', () => {
  const phone = { wide: false, signedIn: false, inGroup: false }
  it('is the short tour, then the rest', () => {
    for (const ctx of CONTEXTS) {
      const short = stepsFor('short', ctx), full = stepsFor('full', ctx)
      expect(short).toHaveLength(6)
      expect(full.slice(0, 6)).toEqual(short)
      expect(full.length).toBeGreaterThan(40)
      expect(new Set(full.map(s => s.id)).size).toBe(full.length)
    }
  })
  it('leaves no step unreachable', () => {
    const reached = new Set(CONTEXTS.flatMap(ctx => stepsFor('full', ctx).map(s => s.id)))
    expect(ALL.filter(s => !reached.has(s.id)).map(s => s.id)).toEqual([])
  })
  it('walks the screens in the order they are visited, never coming back to one it has left', () => {
    const order = (ctx: typeof phone & { hasFriends?: boolean }) => {
      const routes = stepsFor('full', ctx).map(s => s.scene.route).filter(r => r !== 'any')
      return routes.filter((r, i) => r !== routes[i - 1])
    }
    // the library is the work a verse's Ministry opens; outline-edit the outline screen's own page, the group page the
    // groups screen's
    expect(order(phone)).toEqual(['reader', 'library', 'home', 'outlines', 'outline-edit', 'friends', 'groups', 'search', 'stats', 'settings'])
    expect(order({ ...phone, signedIn: true, inGroup: true, hasFriends: true })).toEqual(['reader', 'library', 'home', 'outlines', 'outline-edit', 'friends', 'groups', 'group', 'search', 'stats', 'settings'])
    for (const ctx of CONTEXTS) expect(new Set(order(ctx)).size).toBe(order(ctx).length)
  })
  it('opens each sheet once after the short tour: its steps follow one another', () => {
    for (const ctx of CONTEXTS) {
      const keys = stepsFor('full', ctx).slice(6).map(s => s.scene.sheet ? `${s.scene.route}/${s.scene.sheet}` : '')
      const runs = keys.filter((k, i) => k && k !== keys[i - 1])
      expect(new Set(runs).size, JSON.stringify(ctx)).toBe(runs.length)
    }
  })
  it('does not repeat the short tour: what it showed is not a step again', () => {
    const fullOnly = EXTENDED.flatMap(s => s.targets)
    for (const t of ['reader-picker', 'reader-lookup', 'more-lookup', 'reader-listen', 'action-colours', 'action-buttons'] as const) expect(fullOnly).not.toContain(t)
  })
  it('shows what is new: Ministry three ways, the word sheet, bookmarks, the chapter’s end, friends, jottings', () => {
    const ids = (ctx: typeof phone & { hasFriends?: boolean }) => stepsFor('full', ctx).map(s => s.id)
    expect(ids(phone)).toEqual(expect.arrayContaining(['more-bookmark', 'more-ministry', 'ministry', 'library', 'library-back', 'word', 'end', 'bookmarks', 'ministry-library', 'outlines-new', 'friends-out']))
    expect(ids({ ...phone, wide: true })).toEqual(expect.arrayContaining(['chapter-ministry', 'size', 'paged']))
    expect(ids({ ...phone, signedIn: true, inGroup: true, hasFriends: true })).toEqual(expect.arrayContaining(['friends-add', 'friends-streak', 'group-streak', 'editor-share']))
    // the Ministry sheet is on the verse the tour selects; the word sheet on a word of the chapter
    expect(EXTENDED.find(s => s.id === 'ministry')!.scene).toEqual({ route: 'reader', select: true, sheet: 'ministry' })
    expect(EXTENDED.find(s => s.id === 'word')!.scene).toEqual({ route: 'reader', sheet: 'word' })
  })
  it('fits the screen: More-sheet steps on a phone, the toolbar on a tablet', () => {
    const ids = (ctx: typeof phone) => stepsFor('full', ctx).map(s => s.id)
    expect(ids(phone)).toContain('more-ministry')
    expect(ids(phone)).not.toContain('chapter-ministry')
    expect(ids({ ...phone, wide: true })).toContain('chapter-ministry')
    expect(ids({ ...phone, wide: true })).not.toContain('more')
  })
  it('fits the account: sign-in cards signed out, the real screens signed in, a group page and a friend streak only when there is one', () => {
    const ids = (ctx: typeof phone & { hasFriends?: boolean }) => stepsFor('full', ctx).map(s => s.id)
    expect(ids(phone)).toEqual(expect.arrayContaining(['groups-out', 'stats-out', 'friends-out', 'streak-out', 'settings-account-out']))
    expect(ids(phone)).not.toContain('badges')
    const inAccount = ids({ ...phone, signedIn: true })
    expect(inAccount).toEqual(expect.arrayContaining(['groups-create', 'groups-join', 'stats', 'badges', 'friends-add', 'settings-account']))
    expect(inAccount).not.toContain('group-feed')
    expect(inAccount).not.toContain('friends-streak')
    expect(ids({ ...phone, signedIn: true, inGroup: true })).toEqual(expect.arrayContaining(['group-streak', 'group-members', 'group-events', 'group-feed']))
  })
  it('says TTS and Morrish’s subject, and nothing recorded', () => {
    const all = ALL.map(s => s.text).join(' ')
    expect(STEPS.find(s => s.id === 'listen')!.text).toBe('Read aloud: TTS, each word lit as it is read.')
    expect(all).not.toMatch(/recorded/i)
    expect(all).not.toMatch(/Strong’s and Dictionary|Strong’s, Dictionary/)
  })
  it('offers the rest quietly where the short tour ends', () => {
    expect(CHOICE).toEqual({ text: 'That’s the short tour.', more: 'Keep going: the full tour', enough: 'That’s enough' })
    expect(progressText(11, 27)).toBe('12 of 27')
  })
})

describe('scenes', () => {
  it('opens the reader’s sheet on the screen, and closes it before leaving', () => {
    expect(sceneActions({ route: 'reader' }, { route: 'reader', sheet: 'more' })).toEqual([{ kind: 'sheet', open: 'more' }])
    expect(sceneActions({ route: 'reader', sheet: 'themes' }, { route: 'home' })).toEqual([{ kind: 'sheet', open: null }, { kind: 'route', to: 'home' }])
    expect(sceneActions({ route: 'reader', sheet: 'more' }, { route: 'reader', sheet: 'themes' })).toEqual([{ kind: 'sheet', open: null }, { kind: 'sheet', open: 'themes' }])
  })
  it('cues read aloud before its settings sheet, and stops it when the tour moves on', () => {
    expect(sceneActions({ route: 'reader', select: true }, { route: 'reader', player: true, sheet: 'listening' }))
      .toEqual([{ kind: 'select', on: false }, { kind: 'player', on: true }, { kind: 'sheet', open: 'listening' }])
    expect(sceneActions({ route: 'reader', player: true, sheet: 'listening' }, { route: 'home' }))
      .toEqual([{ kind: 'sheet', open: null }, { kind: 'player', on: false }, { kind: 'route', to: 'home' }])
  })
  it('makes the sample outline before showing it and deletes it after leaving', () => {
    expect(sceneActions({ route: 'home' }, { route: 'outlines', sample: true })).toEqual([{ kind: 'sample', on: true }, { kind: 'route', to: 'outlines' }])
    expect(sceneActions({ route: 'outline-edit', sample: true, sheet: 'print' }, { route: 'friends' }))
      .toEqual([{ kind: 'sheet', open: null }, { kind: 'route', to: 'friends' }, { kind: 'sample', on: false }])
    expect(sceneActions({ route: 'outlines', sample: true }, { route: 'outline-edit', sample: true })).toEqual([{ kind: 'route', to: 'outline-edit' }])
  })
  it('selects the verse before the Ministry sheet opens on it, and closes the sheet before leaving for the library', () => {
    expect(sceneActions({ route: 'reader', sheet: 'word' }, { route: 'reader', select: true, sheet: 'ministry' }))
      .toEqual([{ kind: 'sheet', open: null }, { kind: 'select', on: true }, { kind: 'sheet', open: 'ministry' }])
    expect(sceneActions({ route: 'reader', select: true, sheet: 'ministry' }, { route: 'library' }))
      .toEqual([{ kind: 'sheet', open: null }, { kind: 'select', on: false }, { kind: 'route', to: 'library' }])
  })
  it('scrolls the chapter back from its end before anything else happens there', () => {
    expect(sceneActions({ route: 'reader', end: true }, { route: 'reader', player: true })).toEqual([{ kind: 'end', on: false }, { kind: 'player', on: true }])
    expect(sceneActions({ route: 'reader', sheet: 'more' }, { route: 'reader', end: true })).toEqual([{ kind: 'sheet', open: null }, { kind: 'end', on: true }])
    expect(sceneActions({ route: 'reader', end: true }, EMPTY_SCENE)).toEqual([{ kind: 'end', on: false }])
  })
  it('stands still for the tab steps and leaves nothing open at the end', () => {
    expect(sceneActions({ route: 'settings' }, { route: 'any' })).toEqual([])
    expect(sceneActions({ route: 'reader', note: true, select: true }, EMPTY_SCENE)).toEqual([{ kind: 'note', on: false }, { kind: 'select', on: false }])
  })
  it('replays backwards through the same actions, so Back needs nothing of its own', () => {
    for (const ctx of CONTEXTS) {
    const full = stepsFor('full', ctx)
    // walk forward and back again through every scene: whatever is open at the end of the walk is only the first step's
    let cur = { route: 'home' } as import('../client/src/lib/tour').Scene
    const apply = (to: typeof cur) => {
      for (const a of sceneActions(cur, to)) {
        if (a.kind === 'route') cur = { route: a.to, sample: cur.sample }
        else if (a.kind === 'sheet') cur = { ...cur, sheet: a.open ?? undefined }
        else cur = { ...cur, [a.kind]: a.on || undefined }
      }
      if (to.route !== 'any') expect(cur.route).toBe(to.route)
      for (const k of ['sheet', 'select', 'player', 'note', 'end', 'sample'] as const) expect(!!cur[k]).toBe(!!to[k])
    }
    for (const s of full) apply(s.scene)
    for (const s of [...full].reverse()) apply(s.scene)
    apply(EMPTY_SCENE)
    }
  })
})
