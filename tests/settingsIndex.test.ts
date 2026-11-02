// The Settings index: which rows each reader gets, in which cards, and the line under each title, on the stored
// defaults and the settings that change it.
import { describe, it, expect, vi } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

// the prefs store and verseNotifyPlan's widgets/model reach react-native and AsyncStorage at import; nothing here calls them
vi.mock('../client/node_modules/react-native', () => ({ Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android }, AppState: { addEventListener: () => ({ remove() {} }) }, I18nManager: {}, NativeModules: {} }))
vi.mock('../client/node_modules/@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {} } }))
const { DEFAULTS } = await import('../client/src/store/prefs')
const { GROUPS, RESET_HINT, SETTINGS_PAGES, cards } = await import('../client/src/lib/settingsIndex')
type Facts = import('../client/src/lib/settingsIndex').Facts
type Prefs = import('../client/src/store/prefs').Prefs

const facts = (prefs: Partial<Prefs> = {}, more: Partial<Facts> = {}): Facts =>
  ({ prefs: { ...DEFAULTS, ...prefs }, signedIn: true, native: true, themeName: 'Paper', voiceName: 'Alec', lang: 'en', text: 'en', ...more })
const say = (id: string, f: Facts) => GROUPS.find(g => g.id === id)!.summary(f)
const rows = (f: Facts) => cards(f).map(c => c.map(g => g.id))
const CONTEXTS = [true, false].flatMap(native => [true, false].map(signedIn => ({ native, signedIn })))

describe('the rows', () => {
  it('push the pages there are: one file in client/app/settings/ for each', () => {
    expect(readdirSync(join(__dirname, '../client/app/settings')).map(f => f.replace(/\.tsx$/, '')).sort()).toEqual([...SETTINGS_PAGES].sort())
  })
  it('are three cards in the owner’s order on a phone, signed in or out', () => {
    const all = [['text', 'page', 'theme'], ['listening', 'daily', 'language'], ['motion', 'offline', 'about']]
    expect(rows(facts())).toEqual(all)
    expect(rows(facts({}, { signedIn: false }))).toEqual(all)
  })
  it('leave out a page that would be empty: Offline on the web, Daily on the web signed out', () => {
    expect(rows(facts({}, { native: false }))).toEqual([['text', 'page', 'theme'], ['listening', 'daily', 'language'], ['motion', 'about']])
    expect(rows(facts({}, { native: false, signedIn: false }))).toEqual([['text', 'page', 'theme'], ['listening', 'language'], ['motion', 'about']])
  })
  it('open a page, the theme gallery or a sheet, each one way', () => {
    expect(Object.fromEntries(GROUPS.map(g => [g.id, g.open.kind === 'page' ? g.open.page : g.open.kind === 'sheet' ? `sheet:${g.open.sheet}` : g.open.kind])))
      .toEqual({ text: 'text', page: 'page', theme: 'themes', listening: 'sheet:listening', daily: 'daily', language: 'sheet:language', motion: 'motion', offline: 'offline', about: 'about' })
  })
})

describe('the summaries', () => {
  it('say the defaults in a line each, short enough for one line at 360 px', () => {
    const f = facts()
    expect(GROUPS.map(g => g.summary(f))).toEqual([
      'Serif · 19 px · line 1.60', 'Verse numbers, footnotes', 'Paper · follows the system',
      'Alec at 1×, short pauses', '10 min, reminder at 20:00', 'English · Darby (English)',
      '1.0× speed', 'Bible, dictionary and ministry', 'Credits, feedback, the tour',
    ])
    for (const ctx of CONTEXTS) for (const g of cards(facts({}, ctx)).flat()) expect(g.summary(facts({}, ctx)).length, `${g.id} ${JSON.stringify(ctx)}`).toBeLessThanOrEqual(30)
  })
  it('name the font, an added one by its own name', () => {
    expect(say('text', facts({ font: 'dyslexic', fontSize: 24, lineHeight: 1.85 }))).toBe('Dyslexic · 24 px · line 1.85')
    const added = { id: 'atk', name: 'Atkinson Hyperlegible', source: 'google' as const, faces: { regular: 'atk.ttf' } }
    expect(say('text', facts({ font: 'custom:atk', customFonts: [added] }))).toBe('Atkinson Hyperlegible · 19 px · line 1.60')
  })
  it('list what is on the page, with a line for none', () => {
    expect(say('page', facts({ paragraphs: true, verseNumbers: true, showNotes: true }))).toBe('Paragraphs, verse numbers, footnotes')
    expect(say('page', facts({ paragraphs: true, verseNumbers: false, showNotes: false }))).toBe('Paragraphs')
    expect(say('page', facts({ paragraphs: false, verseNumbers: false, showNotes: false }))).toBe('Every verse on its own line')
  })
  it('say whether the theme follows the system', () => {
    expect(say('theme', facts({ theme: 'system' }, { themeName: 'Slate' }))).toBe('Slate · follows the system')
    expect(say('theme', facts({ theme: 'sepia' }, { themeName: 'Sepia' }))).toBe('Sepia')
  })
  it('say the voice, its speed and pauses, and the device voice', () => {
    expect(say('listening', facts({ ttsSpeed: 1.25, ttsPause: 'long', ttsDevice: true }, { voiceName: 'Beatrice' }))).toBe('Beatrice at 1.25×, long pauses, device voice')
  })
  it('give the language and both Bibles when there is a second', () => {
    expect(say('language', facts({ bible2: 'fr' }, { lang: 'de', text: 'de' }))).toBe('Deutsch · Elberfelder (Deutsch) + Darby (français)')
  })
  it('say reduced motion, or the speed', () => {
    expect(say('motion', facts({ reduceMotion: true, motionSpeed: 1.3 }))).toBe('Reduced')
    expect(say('motion', facts({ motionSpeed: 1.3 }))).toBe('1.3× speed')
  })
  it('say the daily goal signed in, the reminder only where it can show, and the morning verse signed out on a phone', () => {
    const verse = { items: [{ book: 19, hour: 6, minute: 30 }] }
    expect(say('daily', facts({ dailyGoal: 20 }))).toBe('20 min, reminder at 20:00')
    expect(say('daily', facts({ dailyGoal: 20, streakReminder: { enabled: false, hour: 20, minute: 0 } }))).toBe('20 min a day')
    expect(say('daily', facts({ dailyGoal: 20 }, { native: false }))).toBe('20 min a day')
    expect(say('daily', facts({ verseNotify: verse }, { signedIn: false }))).toBe('Verse of the day: Psalms at 06:30')
    expect(say('daily', facts({}, { signedIn: false }))).toBe('No verse of the day')
  })
})

describe('the reset hint', () => {
  it('names what goes back and, true to reset(), what stays', () => {
    for (const w of ['Text', 'page', 'theme', 'motion', 'listening', 'language', 'Bible', 'added fonts', 'daily goal', 'notifications', 'name']) expect(RESET_HINT).toContain(w)
  })
})
