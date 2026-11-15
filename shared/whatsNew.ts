/**
 * What an update brought, told once when the app first opens after it (client/src/components/WhatsNew.tsx): one
 * release and its items, each drawn as a scene, and the rule for when it is told. Nothing here needs React Native,
 * and nothing of it leaves the device.
 */
import { N_ } from './i18n'

/** The vignette an item is shown with (client/src/lib/whatsNew.ts has each one's timeline). */
export type NewsScene = 'ask' | 'answer' | 'hand'
export interface NewsItem { id: string; title: string; body: string; scene: NewsScene }
export interface Release { version: string; items: NewsItem[] }

export const WHATS_NEW: Release = {
  version: '2.0',
  items: [
    { id: 'own-words', title: N_('Ask in your own words.'), body: N_('A plain question finds verses, phrases and related subjects.'), scene: 'ask' },
    { id: 'cited-answers', title: N_('Answers from the library.'), body: N_('Each sentence is marked with the paragraph it rests on.'), scene: 'answer' },
    { id: 'lends-a-hand', title: N_('It can lend a hand.'), body: N_('Ask for a change, such as larger text. Undo puts it back.'), scene: 'hand' },
  ],
}

export interface Launch {
  /** The stored settings have been read. */
  loaded: boolean
  /** The welcome had been seen before this launch: a new install is not told the news of the version it installed. */
  onboarded: boolean
  /** The version whose news this device has seen ('' for none). */
  seenNew: string
  /** Where the app opened: the news is for a launch on Home, never over a shared link's page. */
  path: string
  /** The page is a sign-in popup on its way back to its opener (web). */
  popup: boolean
  /** The welcome is on screen. */
  welcome: boolean
}
/** Whether this launch tells the news of `release`. */
export function newsDue(l: Launch, release: Release = WHATS_NEW): boolean {
  return l.loaded && l.onboarded && l.seenNew !== release.version && l.path === '/' && !l.popup && !l.welcome
}
