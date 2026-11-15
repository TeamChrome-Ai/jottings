import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { TEXTS } from '../shared/texts'
import { WHATS_NEW, newsDue, type Launch } from '../shared/whatsNew'
import { ANSWER, ASK, HAND, LENGTHS, SCENES, STAGES, newsLength, newsMotion, shapeOf } from '../client/src/lib/whatsNew'
import type { Keys, Track } from '../client/src/lib/overture'

const V = WHATS_NEW.version
/** An update: someone who has been reading opens the app on Home, and has seen no news of this version. */
const UPDATE: Launch = { loaded: true, onboarded: true, seenNew: '', path: '/', popup: false, welcome: false }

describe('when the news is due', () => {
  it('is told on the first open after an update, and of a later version after an earlier one', () => {
    expect(newsDue(UPDATE)).toBe(true)
    expect(newsDue({ ...UPDATE, seenNew: '1.9' })).toBe(true)
  })
  it('is not told to a new install: the welcome is, and it marks the version seen', () => {
    const fresh: Launch = { ...UPDATE, onboarded: false, welcome: true }
    expect(newsDue(fresh)).toBe(false)
    // not even once the welcome has set `onboarded` in the same launch, while it is still on screen
    expect(newsDue({ ...fresh, onboarded: true })).toBe(false)
    // what the welcome stores (components/FirstRun.tsx), read at the next launch
    expect(newsDue({ ...UPDATE, seenNew: V })).toBe(false)
  })
  it('is not told at the second launch', () => {
    expect(newsDue({ ...UPDATE, seenNew: V })).toBe(false)
  })
  it('waits for a launch on Home when the app opens on a shared link', () => {
    expect(newsDue({ ...UPDATE, path: '/read/43/3' })).toBe(false)
    expect(newsDue({ ...UPDATE, path: '/library' })).toBe(false)
    // nothing was marked seen, so the next launch on Home tells it
    expect(newsDue({ ...UPDATE, path: '/' })).toBe(true)
  })
  it('is not told in a sign-in popup, nor before the stored settings are read', () => {
    expect(newsDue({ ...UPDATE, popup: true })).toBe(false)
    expect(newsDue({ ...UPDATE, loaded: false })).toBe(false)
  })
  it('asks about the release it is given', () => {
    expect(newsDue({ ...UPDATE, seenNew: V }, { version: '2.1', items: [] })).toBe(true)
    expect(newsDue({ ...UPDATE, seenNew: '2.1' }, { version: '2.1', items: [] })).toBe(false)
  })
})

describe('the release', () => {
  it('has three items for 2.0, each with its own id, a title and a body', () => {
    expect(V).toBe('2.0')
    expect(WHATS_NEW.items).toHaveLength(3)
    expect(new Set(WHATS_NEW.items.map(i => i.id)).size).toBe(3)
    for (const i of WHATS_NEW.items) { expect(i.title.length).toBeGreaterThan(0); expect(i.body.length).toBeGreaterThan(0) }
  })
  it('has one scene for each item, in the items’ order, and a timeline for each', () => {
    expect(WHATS_NEW.items.map(i => i.scene)).toEqual([...SCENES])
    expect(new Set(SCENES).size).toBe(SCENES.length)
    expect(STAGES).toEqual([...SCENES, 'close'])
    const m = newsMotion(shapeOf(ASK.question))
    for (const s of SCENES) {
      expect(Object.keys(m[s])).toEqual(expect.arrayContaining(['layer', 'title', 'body']))
      expect(m.lengths[s]).toBeGreaterThan(0)
    }
  })
  it('speaks plainly: sentence case, a full stop, no exclamations, straight quotes or dashes', () => {
    for (const s of WHATS_NEW.items.flatMap(i => [i.title, i.body])) {
      expect(s).not.toMatch(/[!'"—–]/)
      expect(s[0]).toBe(s[0].toUpperCase())
      expect(s.endsWith('.')).toBe(true)
      expect(s.length, s).toBeLessThanOrEqual(64)
    }
  })
})

const LANGS = ['fr', 'fr-CA', 'de', 'it', 'nl', 'sv'] as const
type Catalogue = Record<string, unknown>
const file = (l: string) => JSON.parse(readFileSync(`client/src/i18n/${l}.json`, 'utf8')) as Catalogue
/** The catalogue a reader of `l` is shown: Canadian French is the French one with Canada's own words over it. */
const catalogue = (l: string): Catalogue => (l === 'fr-CA' ? { ...file('fr'), ...file('fr-CA') } : file(l))
/** Every phrase the scenes show in the reader's language, and the ones around them (the skip pill, the row in Settings). */
const PHRASES = [
  ...WHATS_NEW.items.flatMap(i => [i.title, i.body]),
  HAND.request,
  'Verses', 'In the writers’ own words', 'Related subjects', 'Text size', 'Undo', 'Skip',
  'What is new', 'Skip what is new', 'The three scenes of version {version}',
]
/** What scenes 1 and 2 show of the library: a question put to it, what it found and what it answered. */
const OF_THE_LIBRARY = [ASK.question, ...ASK.phrases.map(p => p.words), ...ASK.related.map(p => p.words), ...ANSWER.sentences]

describe('the words', () => {
  it.each(LANGS)('has every title, body and vignette phrase in the %s catalogue', l => {
    const c = catalogue(l)
    for (const p of PHRASES) expect(typeof c[p] === 'string' && (c[p] as string).trim() !== '', `${l}: ${p}`).toBe(true)
  })
  it('keeps {version} in the Settings line of every language', () => {
    for (const l of LANGS) expect(catalogue(l)['The three scenes of version {version}']).toContain('{version}')
  })
  it('shows a real search of the library, as the library released with 2.0 answers: nothing in scene 1 is made up', () => {
    expect(ASK.question).toBe('how can I be sure I am saved')
    expect(ASK.verses).toEqual([{ book: 62, chapter: 5, verse: 13, total: 35 }, { book: 43, chapter: 5, verse: 24, total: 73 }])
    expect(ASK.phrases).toEqual([{ words: 'assurance of salvation', total: 33 }, { words: 'the witness of the Spirit', total: 60 }])
    expect(ASK.related).toEqual([{ words: 'the new birth', total: 308 }])
  })
  it.each(LANGS)('leaves the question, its wordings and the answer in English in %s: the library is in English', l => {
    const c = catalogue(l)
    for (const p of OF_THE_LIBRARY) expect(c[p], `${l}: ${p}`).toBeUndefined()
    // nor do the catalogues keep the invented example this one replaced
    for (const p of ['What does it mean to walk by faith?', 'the path of faith', 'walking with God', 'dependence', 'obedience', 'Faith rests on what God has said.']) expect(c[p], `${l}: ${p}`).toBeUndefined()
  })
  it('answers in three short sentences of its own, none given to a writer', () => {
    expect(ANSWER.sentences).toHaveLength(3)
    for (const s of ANSWER.sentences) {
      expect(s.length, s).toBeLessThanOrEqual(56)
      expect(s).not.toMatch(/[“”"‘]|\b(Darby|Raven|Bellett|Wigram|Stoney|Coates|says|writes|wrote)\b/)
    }
  })
  // each Bible the app can show, by the folder its chapters are served from; the English one has two editions
  const BIBLES = [['en', 'bible'], ['en', 'bible1890'], ['fr', 'bible-fr'], ['de', 'bible-de']] as const
  it.each(BIBLES)('shows Psalm 119:105 for the %s Bible exactly as %s has it', (text, dir) => {
    // no skipping when the file is away: a line typed by hand must not pass for want of the text to hold it to
    const ch = JSON.parse(readFileSync(`client/public/${dir}/19/119.json`, 'utf8')) as { verses: { v: number; t: string }[] }
    expect(HAND.ref).toEqual({ book: 19, chapter: 119, v1: 105 })
    expect(HAND.sample[text]).toBe(ch.verses.find(v => v.v === HAND.ref.v1)!.t)
  })
  it('has a line for every Bible the app can show, and no other', () => {
    expect(Object.keys(HAND.sample).sort()).toEqual([...TEXTS].sort())
  })
})

const increasing = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1])
const channels = (t: Track) => [t.opacity, t.x, t.y, t.scale].filter((k): k is Keys => !!k)
const tracksOf = (stage: Record<string, Track | Track[]>) => Object.entries(stage).flatMap(([name, t]) => (Array.isArray(t) ? t : [t]).map((track, i) => ({ name: `${name}[${i}]`, track })))
/** The question typed, and a shorter and a longer one the timeline must also hold for. */
const QUESTIONS = [ASK.question, 'why', 'x'.repeat(60)]

describe('the timeline', () => {
  it('is twelve seconds at the authored speed, and scales with Animation speed', () => {
    expect(newsLength()).toBe(12000)
    expect(newsLength(1.5)).toBe(8000)
    expect(newsLength(0.5)).toBe(24000)
    const m = newsMotion(shapeOf(ASK.question), 0.5)
    for (const s of STAGES) expect(m.lengths[s]).toBe(LENGTHS[s] * 2)
  })
  it.each([0.5, 1, 1.5])('has keyframes in time order for every track, inside its stage, at speed %s', speed => {
    for (const q of QUESTIONS) {
      const m = newsMotion(shapeOf(q), speed)
      for (const stage of STAGES) {
        const all = tracksOf(m[stage])
        expect(all.length).toBeGreaterThan(0)
        for (const { name, track } of all) {
          const ks = channels(track)
          expect(ks.length, `${stage}.${name}`).toBeGreaterThan(0)
          for (const k of ks) {
            expect(k.input.length, `${stage}.${name}`).toBe(k.output.length)
            expect(increasing(k.input), `${stage}.${name} at ${speed}: ${k.input.join(' ')}`).toBe(true)
            expect(k.input[0], `${stage}.${name}`).toBeGreaterThanOrEqual(0)
            expect(k.input[k.input.length - 1], `${stage}.${name}`).toBeLessThanOrEqual(m.lengths[stage] + 1e-6)
          }
        }
      }
    }
  })
  it('has a track for every letter, chip, sentence and marker', () => {
    const shape = shapeOf(ASK.question)
    const m = newsMotion(shape)
    expect(m.ask.chars).toHaveLength([...ASK.question].length)
    expect(m.ask.labels).toHaveLength(3)
    expect(m.ask.chips).toHaveLength(ASK.verses.length + ASK.phrases.length + ASK.related.length)
    expect(m.answer.sentences).toHaveLength(ANSWER.sentences.length)
    expect(m.answer.markers).toHaveLength(ANSWER.sentences.length)
    expect(ANSWER.opens).toBeLessThan(ANSWER.sentences.length)
  })
  it('lets each scene arrive, rest and clear before the next: a layer goes from unseen to unseen', () => {
    const m = newsMotion(shapeOf(ASK.question))
    for (const s of SCENES) {
      const o = (m[s].layer as Track).opacity!
      expect(o.output[0]).toBe(0)
      expect(Math.max(...o.output)).toBe(1)
      expect(o.output[o.output.length - 1]).toBe(0)
      expect(o.input[o.input.length - 1]).toBe(LENGTHS[s])
    }
  })
  it('types a long question faster, not later: the wordings still land before the scene clears', () => {
    for (const q of [...QUESTIONS, 'x'.repeat(90)]) {
      const m = newsMotion(shapeOf(q))
      const lastChip = m.ask.chips[m.ask.chips.length - 1].opacity!
      const out = (m.ask.layer as Track).opacity!
      // the fade-out starts at the first time the layer leaves full opacity for good
      const fadeOut = out.input[out.output.lastIndexOf(1)]
      expect(lastChip.input[lastChip.input.length - 1], q).toBeLessThanOrEqual(fadeOut - 300)
      // every letter is typed before the first wording shows
      const lastChar = m.ask.chars[m.ask.chars.length - 1].opacity!
      expect(lastChar.input[lastChar.input.length - 1]).toBeLessThan(m.ask.labels[0].opacity!.input[0])
    }
  })
  it('opens the paragraph only once every sentence has its marker, and grows the text after it is asked', () => {
    const m = newsMotion(shapeOf(ASK.question))
    const end = (t: Track) => Math.max(...channels(t).map(k => k.input[k.input.length - 1]))
    const start = (t: Track) => Math.min(...channels(t).map(k => k.input[0]))
    expect(start(m.answer.ring)).toBeGreaterThanOrEqual(Math.max(...m.answer.markers.map(end)))
    expect(start(m.answer.card)).toBeGreaterThan(start(m.answer.ring))
    expect(start(m.hand.grow)).toBeGreaterThan(end(m.hand.request))
    expect(start(m.hand.undo)).toBeGreaterThan(end(m.hand.grow))
    const g = m.hand.grow.scale!
    expect(g.output[0]).toBe(1)
    expect(g.output[g.output.length - 1]).toBeCloseTo(HAND.to / HAND.from)
  })
})
