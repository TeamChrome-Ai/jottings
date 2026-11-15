import { BRAND } from '@shared/brand'
import { onLangChange, peekLang, t } from '@shared/i18n'
import { formatRef } from '@shared/ref'
import { textOf } from '@shared/texts'
import { langOf, loadLanguage } from '../i18n'
import { localPosition } from '../hooks/usePosition'
import { playerEngine, type PlayerState } from '../store/player'
import { loadPrefs, prefsStore } from '../store/prefs'
import { loadApiBase } from './api'
import { nextChapter, prevChapter } from './bible'
import { carCatalogue, carFind, carSearch, catalogueKey, chapterId, continueItem, placeOf, type Place } from './carCatalogue'
import { loadEdition } from './edition'
import { mediaArt } from './mediaArt'
import { mediaLibrary, type CarCommand, type Described } from './mediaLibrary'
import { wakeClock } from './readAloudClock'
import { onSourceChange, setText } from './text'
import { SPEEDS } from './tts'

const REWRITE_MS = 500

/**
 * Read-aloud for whatever drives it from outside the screens: Android Auto, the lock screen, a headset. The phone's
 * media session (modules/media-library) sends what it is asked for, and is told what the player is doing; the tree a
 * car browses and the place to continue from are written for it here. A car can ask with the app not open: Android
 * then starts JavaScript with no screen, so nothing here waits for one, and the first command does what the root
 * layout would have done (the stored settings, the language, the Bible shown, the server's address).
 */
export function registerCar(): void {
  const native = mediaLibrary
  if (!native) return
  const engine = playerEngine()
  let ack = 0
  let art: string | undefined
  let told = ''
  let placed = ''

  let ready: Promise<void> | null = null
  const boot = () => (ready ??= (async () => {
    await Promise.all([loadPrefs(), loadApiBase(), loadEdition().catch(() => {}), mediaArt().then(a => { art = a })])
    const lang = langOf(prefsStore.get().lang)
    if (peekLang() !== lang) await loadLanguage(lang)
    setText(textOf(prefsStore.get().bible, peekLang()))
  })())

  const describe = () => {
    const s = engine.getState()
    const speed = prefsStore.get().ttsSpeed
    // the chapter and what the player is doing with it, never how far in it is: the reading goes by verses with their
    // pauses and their numbers, and a clock for it shown to a driver would be a guess
    const d: Described = {
      on: s.status !== 'idle', status: s.status, art, speed, speedLabel: `${t('Speed')} ${speed}×`, ack,
      ...(s.book ? { id: chapterId(s.book, s.chapter), title: formatRef({ book: s.book, chapter: s.chapter }), subtitle: `${BRAND.name} · Darby` } : {}),
      ...(s.error ? { error: s.error } : {}),
    }
    const json = JSON.stringify(d)
    if (json === told) return
    told = json
    native.describe(d)
  }
  /** The verse being read is where Continue listening picks up; a spoken heading counts as the chapter's top. */
  const place = (s: PlayerState) => {
    if (!s.spoken) return
    const at = { book: s.spoken.book, chapter: s.spoken.chapter, verse: Math.max(1, s.spoken.v) }
    const key = chapterId(at.book, at.chapter, at.verse)
    if (key === placed) return
    placed = key
    native.setPlace(JSON.stringify(continueItem(at)), 'continue')
  }
  const publish = () => { const key = catalogueKey(); if (native.catalogueKey() !== key) native.publish(key, JSON.stringify(carCatalogue())) }
  /** Where a Play that names nothing begins: the place the reading last reached, else where the reader last read. */
  const resume = async (): Promise<Place> => {
    const saved = native.place()
    const at = saved ? placeOf((JSON.parse(saved) as { id: string }).id) : null
    if (at) return at
    const read = await localPosition()
    return read ? { book: read.book, chapter: read.chapter, verse: 1 } : { book: 43, chapter: 1, verse: 1 }
  }
  const begin = (at: Place) => { engine.heldOutside(); void engine.start(at.book, at.chapter, at.verse) }

  const run = async (c: CarCommand) => {
    // the app may not be on screen, or open: its timers run for the work a command starts
    wakeClock()
    await boot()
    const s = engine.getState()
    if (c.type === 'tree') publish()
    else if (c.type === 'find') native.found(c.query ?? '', JSON.stringify(carFind(c.query ?? '')))
    else if (c.type === 'play') {
      const asked = c.id !== undefined ? placeOf(c.id) : c.query ? carSearch(c.query) : null
      if (asked) begin(asked)
      else if (s.status === 'paused') engine.toggle()
      else if (s.status === 'idle' || s.status === 'error') begin(await resume())
    } else if (c.type === 'pause') {
      if (s.status === 'playing') engine.toggle()
      else if (s.status === 'loading') engine.stop()
    } else if (c.type === 'stop') engine.stop()
    else if (c.type === 'gone') {
      // the drive is over: what the car asked for waits where it is; the screens' own reading was never the car's
      if (engine.isHeldOutside() && s.status === 'playing') engine.toggle()
      else if (engine.isHeldOutside() && s.status === 'loading') engine.stop()
    }
    else if (c.type === 'next' || c.type === 'previous') {
      const to = s.book ? (c.type === 'next' ? nextChapter : prevChapter)(s.book, s.chapter) : null
      if (to) begin({ ...to, verse: 1 })
    } else if (c.type === 'speed') {
      const now = prefsStore.get().ttsSpeed
      const nearest = (x: number) => SPEEDS.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a))
      prefsStore.set({ ttsSpeed: c.speed !== undefined ? nearest(c.speed) : SPEEDS[(SPEEDS.indexOf(nearest(now)) + 1) % SPEEDS.length] })
    }
    ack = Math.max(ack, c.seq)
    describe()
  }
  // one at a time, in the order they came
  let queue: Promise<void> = Promise.resolve()
  native.addListener('onCommand', c => { queue = queue.then(() => run(c)).catch(() => {}) })

  // the screens' own Listen comes here too: the picture beside the controls is fetched on the first one
  engine.onSettled(s => { if (!ready) void boot().then(describe); describe(); place(s) })
  prefsStore.subscribe(() => { if (ready) describe() })
  // a tree already written follows the app's language and Bible (set one after the other: it waits for both); one
  // never asked for is not built
  let due = false
  const rewrite = () => {
    if (due || native.catalogueKey() === null) return
    due = true
    setTimeout(() => { due = false; void boot().then(publish) }, REWRITE_MS)
  }
  onLangChange(rewrite)
  onSourceChange(rewrite)
  native.listen()
}
