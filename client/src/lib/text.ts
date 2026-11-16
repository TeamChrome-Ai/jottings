/**
 * The Bible the reader reads on this device (docs/LANGUAGES.md): the English Darby, in the edition the server serves
 * (editionCore.ts), or another: Darby's French, the Elberfelder, the King James Version or Young's Literal Translation.
 * The prefs (`bible`, `lang`) decide it in app/_layout.tsx; the rules of numbering live in @shared/texts, which
 * references read. Every Bible is kept in the English verses, so what the reader keeps is the same whichever they read.
 */
import { useSyncExternalStore } from 'react'
import { peekShownText, setShownText, setVerseMap, type BibleText, type OwnText, type VerseMap } from '@shared/texts'
import { onEditionChange, peekEdition, type Source } from './editionCore'
import frMap from '../../public/bible-fr/map.json'
import deMap from '../../public/bible-de/map.json'
import frMeta from '../../public/bible-fr/meta.json'
import deMeta from '../../public/bible-de/meta.json'
import kjv from './texts/kjv'
import ylt from './texts/ylt'

setVerseMap('fr', frMap as unknown as VerseMap)
setVerseMap('de', deMap as unknown as VerseMap)
/** The Bibles read beside Darby's, as this build carries them: null for one it leaves out (texts/none.ts). */
export const ADDED = { kjv, ylt } as const
for (const [id, x] of Object.entries(ADDED)) if (x) setVerseMap(id as OwnText, x.map)

/** Each other Bible's data version (client/public/bible-<id>/meta.json): in its URLs, and a change sweeps its stored
 *  chapters. A Bible this build leaves out has none. */
export const TEXT_VERSION: Partial<Record<OwnText, string>> = {
  fr: (frMeta as { v: string }).v, de: (deMeta as { v: string }).v,
  ...(kjv ? { kjv: kjv.v } : {}), ...(ylt ? { ylt: ylt.v } : {}),
}

const listeners = new Set<() => void>()
/** Sets the Bible shown; listeners hear a change only. */
export function setText(t: BibleText): void {
  if (t === peekShownText()) return
  setShownText(t)
  listeners.forEach(l => l())
}
export const peekText = (): BibleText => peekShownText()
/** Where the shown Bible's chapters come from: the English Darby in its edition, or the Bible's own files. */
export const sourceOf = (t: BibleText): Source => (t === 'en' ? peekEdition() : t)
export const peekSource = (): Source => sourceOf(peekShownText())
/** Hears a change of the Bible shown or of the English edition: what was held for one is not shown as the other. */
export function onSourceChange(l: () => void): () => void {
  listeners.add(l)
  const off = onEditionChange(() => l())
  return () => { listeners.delete(l); off() }
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
/** The Bible shown, live. */
export const useText = (): BibleText => useSyncExternalStore(subscribe, peekShownText, peekShownText)
