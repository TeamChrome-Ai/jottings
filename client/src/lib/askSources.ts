/**
 * The sources of one of Ask's answers (app/ask.tsx): the library paragraphs its sentences rest on, numbered as a
 * reader meets them, so a sentence carries a small number and the author and work are read once, in the list under
 * the answer. Read from the answer as it is kept (lib/assistant.ts `Shown`), so an answer already on the device is
 * numbered too. Pure.
 */
import type { Sentence } from '@shared/assistantTools'

/**
 * The paragraphs an answer rests on, in the order its sentences first name them: the nth is source n, and a paragraph
 * named again keeps its number. One the conversation cannot place (`placed`) is no source and takes no number: there
 * is nowhere to open it.
 */
export function sourcesOf(sentences: readonly Pick<Sentence, 'ids'>[], placed: (id: number) => boolean): number[] {
  const out: number[] = []
  for (const s of sentences) for (const id of s.ids) if (!out.includes(id) && placed(id)) out.push(id)
  return out
}
