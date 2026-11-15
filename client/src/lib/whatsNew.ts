/**
 * The news of an update (shared/whatsNew.ts) as plain data: what each scene's vignette shows, and when every part of
 * it moves, as keyframe tracks for components/motion/track.ts. No React Native here, so it is tested on its own
 * (tests/whatsNew.test.ts). The keyframe helpers are the welcome's (lib/overture.ts).
 *
 * The vignettes are drawn, not fetched, so the scenes need no network and no model; what scene 1 shows was found by
 * the library search itself and is kept here as it answered.
 */
import { N_ } from '@shared/i18n'
import type { BibleText } from '@shared/texts'
import type { NewsScene } from '@shared/whatsNew'
import { inCubic, inOutCubic, join, keys, linear, tween, type Keys, type Track } from './overture'

/** Scene 1: a question typed into the library search, and the other wordings that rise under it, each with the
 *  paragraphs it finds (components/SearchExpansion.tsx, in its order). The library is in English, so the question and
 *  its wordings are shown as they are in every language; a verse is named as the reader's Bible names it. */
// a real search of the library on 2026-11-14: the question, and the count each wording found that day
export const ASK = {
  question: 'how can I be sure I am saved',
  verses: [{ book: 62, chapter: 5, verse: 13, total: 33 }, { book: 43, chapter: 5, verse: 24, total: 71 }],
  phrases: [{ words: 'assurance of salvation', total: 33 }, { words: 'the witness of the Spirit', total: 60 }],
  related: [{ words: 'the new birth', total: 299 }],
} as const

/** Scene 2: an answer to that question, a sentence at a time, each with its numbered marker; `opens` is the sentence
 *  whose marker opens the paragraph it rests on. The sentences are the scene's own, to show the shape of an answer:
 *  none is a writer's, and none is given to one. In English, as the question is. */
export const ANSWER = {
  sentences: ['Assurance rests on what God has said, not on feeling.', 'The work of Christ is finished.', 'And the Spirit bears witness to it.'],
  opens: 1,
} as const

/** Scene 3: the reader asks for larger text, and a line of the Bible shown grows from one size to the other: Psalm
 *  119:105 as each Bible the app shows has it (tests/whatsNew.test.ts holds every line to that Bible's own text of the
 *  verse, in both English editions). Darby's English of this verse happens to read word for word as the Authorised
 *  Version does; it is here because it is the app's own text, taken from it and not from memory. */
export const HAND = {
  request: N_('Make the text larger'),
  ref: { book: 19, chapter: 119, v1: 105 },
  sample: {
    en: 'Thy word is a lamp unto my feet, and a light unto my path.',
    fr: 'Ta parole est une lampe à mon pied, et une lumière à mon sentier.',
    de: 'Dein Wort ist Leuchte meinem Fuße und Licht für meinen Pfad.',
  } satisfies Record<BibleText, string>,
  from: 19, to: 22,
} as const

/** The scenes in the order they play, then the closing line. */
export const SCENES: readonly NewsScene[] = ['ask', 'answer', 'hand']
export type NewsStage = NewsScene | 'close'
export const STAGES: readonly NewsStage[] = [...SCENES, 'close']
/** Each stage's length at Animation speed 1, ms: twelve seconds in all. */
export const LENGTHS: Record<NewsStage, number> = { ask: 3900, answer: 4000, hand: 3100, close: 1000 }
/** Reduce animation: how long a still page stays unless tapped, and the crossfade to the next. */
export const STILL = { page: 4000, cross: 300 } as const
/** The overlay's own fade when it is left. */
export const LEAVE_MS = 320

/** What the timeline is cut to: the letters typed, the chips of each group, the sentences of the answer. */
export interface NewsShape { chars: number; groups: number[]; sentences: number; opens: number }
export const shapeOf = (question: string): NewsShape => ({
  chars: [...question].length,
  groups: [ASK.verses.length, ASK.phrases.length, ASK.related.length],
  sentences: ANSWER.sentences.length,
  opens: ANSWER.opens,
})

/** Opacity 0 → 1 with a rise of `dy` px, eased alike. */
const arrive = (t0: number, ms: number, dy: number): Track => ({ opacity: tween(t0, t0 + ms, 0, 1), y: tween(t0, t0 + ms, dy, 0) })
/** A small mark popping in: quick to appear, a little past its size, then settled. */
const pop = (t: number): Track => ({ opacity: tween(t, t + 120, 0, 1, linear), scale: keys([[t, 0.2], [t + 180, 1.3], [t + 320, 0.92], [t + 440, 1]]) })
/** A scene's own layer: in as its stage starts, out as it ends, so each stage leaves the page clear for the next. */
const layer = (length: number): Track => ({ opacity: join(tween(0, 320, 0, 1), tween(length - 340, length, 1, 0, inCubic)) })
const heading = () => ({ title: arrive(120, 500, 8), body: arrive(260, 500, 8) })

/** How long the question takes to type at most, and the longest gap between two letters: a long question (the German)
 *  types faster rather than later. */
const TYPING = { start: 700, window: 900, step: 45 }

function ask(shape: NewsShape) {
  const step = Math.min(TYPING.step, TYPING.window / Math.max(1, shape.chars))
  const chars = Array.from({ length: shape.chars }, (_, i): Track => ({ opacity: tween(TYPING.start + i * step, TYPING.start + i * step + 40, 0, 1, linear, 1) }))
  // the wordings arrive once the question stands: a group's title, then its chips one after another
  const typed = TYPING.start + shape.chars * step + 150
  const labels: Track[] = [], chips: Track[] = []
  shape.groups.forEach((n, g) => {
    const t = typed + g * 260
    labels.push(arrive(t, 300, 6))
    for (let j = 0; j < n; j++) chips.push(arrive(t + 90 + j * 90, 340, 10))
  })
  return { layer: layer(LENGTHS.ask), ...heading(), field: arrive(420, 400, 6), chars, labels, chips }
}

function answer(shape: NewsShape) {
  const onset = (k: number) => 800 + k * 520
  const sentences = Array.from({ length: shape.sentences }, (_, k) => arrive(onset(k), 420, 6))
  const markers = Array.from({ length: shape.sentences }, (_, k) => pop(onset(k) + 300))
  // when the last marker has settled, one of them is pressed (a ring) and its paragraph opens under the answer
  const press = onset(shape.sentences - 1) + 300 + 510
  const ring: Track = { opacity: keys([[press, 0], [press + 60, 0.8], [press + 600, 0]]), scale: tween(press, press + 600, 0.4, 2.2) }
  const open = press + 150
  const card: Track = { opacity: tween(open, open + 250, 0, 1, linear), y: tween(open, open + 320, -8, 0), scale: keys([[open, 0.9], [open + 320, 1.015], [open + 460, 1]]) }
  const tint: Track = { opacity: tween(open + 350, open + 650, 0, 1) }
  return { layer: layer(LENGTHS.answer), ...heading(), question: arrive(420, 380, 6), sentences, markers, ring, card, tint }
}

function hand() {
  const grow = HAND.to / HAND.from
  return {
    layer: layer(LENGTHS.hand), ...heading(),
    sample: arrive(420, 380, 6),
    request: arrive(700, 400, 8),
    grow: { scale: tween(1300, 1800, 1, grow, inOutCubic) } as Track,
    undo: arrive(1950, 350, 10),
  }
}

function close() {
  const L = LENGTHS.close
  return { line: { opacity: join(tween(0, 350, 0, 1), tween(L - 300, L, 1, 0, inCubic)), y: tween(0, 350, 6, 0) } as Track }
}

type Tracks = Record<string, Track | Track[]>
const faster = (k: Keys, speed: number): Keys => ({ input: k.input.map(t => t / speed), output: k.output })
const sped = (t: Track, speed: number) => Object.fromEntries(Object.entries(t).map(([channel, k]) => [channel, faster(k as Keys, speed)])) as Track
function atSpeed<T extends Tracks>(tracks: T, speed: number): T {
  return Object.fromEntries(Object.entries(tracks).map(([name, t]) => [name, Array.isArray(t) ? t.map(x => sped(x, speed)) : sped(t, speed)])) as T
}

/**
 * Every moving part of the news, by stage, with the stages' lengths: authored at Animation speed 1 and played `speed`
 * times as fast (the reader's setting, 0.5 to 1.5), by dividing every time. The driver then runs the numbers as given.
 */
export function newsMotion(shape: NewsShape, speed = 1) {
  const lengths = Object.fromEntries(STAGES.map(s => [s, LENGTHS[s] / speed])) as Record<NewsStage, number>
  return { lengths, ask: atSpeed(ask(shape), speed), answer: atSpeed(answer(shape), speed), hand: atSpeed(hand(), speed), close: atSpeed(close(), speed) }
}
export type NewsMotion = ReturnType<typeof newsMotion>
/** The whole run at `speed`, ms. */
export const newsLength = (speed = 1) => STAGES.reduce((n, s) => n + LENGTHS[s], 0) / speed
