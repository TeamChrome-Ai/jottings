/**
 * The editor open on an outline, for a write that comes from somewhere else in the app (Ask, docs/ASSISTANT.md). The
 * editor saves its whole list a moment after each change, so a write beside it would be overwritten by the list the
 * editor still holds, or would overwrite what the editor had not yet saved.
 *
 * So a writer takes hold of the editor for as long as its write takes (`holdEditor`), which is one save's round trip:
 * from that moment the editor takes no input, and it saves what it holds. The writer reads, writes and reads back, and
 * lets go with what it read back, which the editor takes whole. Nothing is typed while the write is made, so there is
 * nothing of the reader's to put into it, and after it the editor has nothing to save until the reader changes
 * something.
 */
import type { Outline } from '@shared/types'

/** How the outline stands when a writer lets go: as the writer read it back after its write; 'unchanged' when it
 *  wrote nothing; 'unknown' when it may have written and could not read back, or the outline is gone. */
export type After = Outline | 'unchanged' | 'unknown'
/** Lets the editor go: it takes an outline read back whole, goes on as it was when nothing was written, and loads the
 *  outline again before it takes any input when it is not known what was. */
export type LetGo = (now: After) => void
export interface OpenEditor {
  /** Takes no more input, saves what it holds that is not yet saved, and waits for that. When it cannot be saved the
   *  editor is not held: it takes input again, and this throws. */
  hold: () => Promise<LetGo>
  /** Takes no input from now until it is let go, and saves nothing first. */
  pause: () => LetGo
  /** Saves what it holds that is not yet saved, and waits for it. Whether nothing is left unsaved. */
  settle: () => Promise<boolean>
}

/** A name for one writer to an outline: an editor on a screen, or one write made for the reader. A save carries it
 *  (`writer`), and the server keeps the name of an outline's last writer: a save from the writer who saved last is
 *  that writer's own lines over its own, and is made though its stamp is old (rs/src/outlines.rs `changed_since`). */
export function newWriter(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID?.() ?? Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

/** The saves of each outline that editors of this app have on their way: sent and not yet answered, or waiting their
 *  turn behind one. An editor that has closed has its last save here until it is over. */
const saving = new Map<number, Set<Promise<unknown>>>()
/** A save of outline `id` is on its way until `save` settles. */
export function saveOnItsWay<T>(id: number, save: Promise<T>): Promise<T> {
  const all = saving.get(id) ?? new Set<Promise<unknown>>()
  saving.set(id, all.add(save))
  const over = () => { all.delete(save); if (all.size === 0 && saving.get(id) === all) saving.delete(id); freed(id) }
  save.then(over, over)
  return save
}
/** Whether a save of outline `id` from an editor of this app is on its way. */
export const savesPending = (id: number): boolean => (saving.get(id)?.size ?? 0) > 0
/** Before outline `id` is loaded for an editor: over when the saves of it now on their way are, or after `ms`,
 *  whichever comes first. The reader who leaves the editor with words still to be saved and opens it again at once
 *  would otherwise load the outline of before those words, and that editor, behind the one just left, would be
 *  refused at its first save. Only the saves this running app knows of: after a page is loaded anew there is nothing
 *  to wait for, and the server's rule decides, which keeps the words. */
export function savesSettled(id: number, ms: number): Promise<void> {
  const now = [...(saving.get(id) ?? [])]
  if (!now.length) return Promise.resolve()
  return new Promise(resolve => {
    const bound = setTimeout(resolve, ms)
    void Promise.allSettled(now).then(() => { clearTimeout(bound); resolve() })
  })
}

/** The editors mounted on each outline, by the id each loaded it under. There is one as a rule; a second can be
 *  mounted over the first (the stack of screens keeps the first beneath), and every one of them holds lines of its
 *  own. */
const open = new Map<number, Set<OpenEditor>>()
const editorsOf = (id: number): OpenEditor[] => [...(open.get(id) ?? [])]
/** Whether an editor of outline `id` is mounted, on screen or beneath it. */
export const editorMounted = (id: number): boolean => editorsOf(id).length > 0

/** The screens that are opening each outline for an editor: from before the outline is read. */
const openings = new Map<number, Set<object>>()
/** An edit screen is about to read outline `id`. Its claim on the outline begins here, before the read and before
 *  any wait, and lasts until the function returned is called: when the screen goes (its editor with it), or when it
 *  has given the outline up (its load failed). The screen reads, and only then mounts its editor; without the claim
 *  an outline could be moved to the account between the two, under an editor that had not yet said it was there. */
export function outlineOpening(id: number): () => void {
  const mine = {}
  const all = openings.get(id) ?? new Set<object>()
  openings.set(id, all.add(mine))
  let done = false
  return () => {
    if (done) return
    done = true
    all.delete(mine)
    if (all.size === 0 && openings.get(id) === all) openings.delete(id)
    freed(id)
  }
}
/** Whether a screen has outline `id` in hand: an editor is mounted on it, or a screen is opening it for one. */
export const outlineClaimed = (id: number): boolean => editorMounted(id) || (openings.get(id)?.size ?? 0) > 0
/** Whether outline `id` is in an editor's hands: a screen has it, or a save of an editor's is still on its way. An
 *  outline of this device is not moved to the account while it is (lib/localLibrary.ts): it is moved when it is
 *  free, so no editor ever has its outline change id beneath it. */
export const outlineBusy = (id: number): boolean => outlineClaimed(id) || savesPending(id)
const freeListeners = new Set<(id: number) => void>()
/** `fn` is told of an outline when no screen has it any more and no save of it is on its way. */
export const onOutlineFree = (fn: (id: number) => void): (() => void) => { freeListeners.add(fn); return () => { freeListeners.delete(fn) } }
/** The outlines whose look below is asked for and not yet taken. */
const looking = new Set<number>()
/** An editor of outline `id` has gone, a screen has given it up, or a save of it is over: if it is free now, say so.
 *  A moment later, so that the last save of an editor that is closing, asked for as it goes, is counted; and once
 *  for all that was given up in the same moment (a screen that goes gives up its editor and its own claim together:
 *  one leaving, one word). */
function freed(id: number) {
  if (looking.has(id)) return
  looking.add(id)
  queueMicrotask(() => { looking.delete(id); if (!outlineBusy(id)) for (const fn of [...freeListeners]) fn(id) })
}
/** The hold on each outline: one writer at a time. */
const held = new Map<number, Promise<void>>()
/** The editors a write has hold of now, by outline: those open when it began, and any opened since. */
const writing = new Map<number, LetGo[]>()
/** No hold lasts longer than this: an editor let go by nobody would take no input ever after. */
const LONGEST_MS = 120_000
/** The writes that may have been made to each outline: the holds let go otherwise than with nothing written. */
const written = new Map<number, number>()
/** A number that moves when a write may have been made to outline `id`. A screen notes it when it begins to load the
 *  outline for an editor, and gives it to `editorOpened`: an outline loaded while it moved may be that of before the
 *  write. */
export const writesOn = (id: number): number => written.get(id) ?? 0

/** The editor of outline `id` is on screen; the function returned says it has gone. `since`: `writesOn(id)` as it was
 *  when the outline the editor opens on began to load. */
export function editorOpened(id: number, editor: OpenEditor, since = writesOn(id)): () => void {
  const all = open.get(id) ?? new Set<OpenEditor>()
  open.set(id, all.add(editor))
  // a write was made, and let go, while the outline was loading: the editor may have opened on the lines of before
  // it, so it takes no input on them and loads again
  if (since !== writesOn(id)) editor.pause()('unknown')
  // opened while a write is on its way: it loaded the outline at some moment of that write, so it takes no input
  // until the write has been read back, and is let go with what was written
  else writing.get(id)?.push(editor.pause())
  // gone, it takes only itself out: another editor of the outline is still that outline's editor
  return () => { all.delete(editor); if (all.size === 0 && open.get(id) === all) open.delete(id); freed(id) }
}

/** Before outline `id` is read: a write on its way to it is over, and every editor open on it has saved what it holds,
 *  so what is read is what the reader sees. No editor is held: a reading changes nothing. Whether nothing is left
 *  unsaved: an editor that cannot save (no connection) does not keep the reading back. */
export async function settleEditor(id: number): Promise<boolean> {
  await held.get(id)
  return (await Promise.all(editorsOf(id).map(e => e.settle().catch(() => false)))).every(Boolean)
}
/** Before the outlines are listed or searched: the same for every outline with an editor open. The outlines whose
 *  editors could not save what they hold. */
export async function settleEditors(): Promise<number[]> {
  const ids = [...open.keys()]
  const saved = await Promise.all(ids.map(settleEditor))
  return ids.filter((_, k) => !saved[k])
}

/** Takes hold of outline `id` for a write: after the hold before it, if there is one. Every editor open on it takes no
 *  input from here on and has saved what it held, until the function returned is called, which must be, once, whatever
 *  comes of the write. Throws, with nothing held, when an editor could not save what it holds: a write made then
 *  would be made beside words of the reader's that the server does not have. Throws, too, when the hold ran out
 *  before the editors had saved: no write is made under a hold that is over. */
export async function holdEditor(id: number): Promise<LetGo> {
  const before = held.get(id)
  let free!: () => void
  const mine = new Promise<void>(r => { free = r })
  held.set(id, mine)
  await before
  const group: LetGo[] = []
  writing.set(id, group)
  let done = false
  /** How the hold ended, once it has: an editor that joins it after that is let go with the same. */
  let ended: After = 'unknown'
  const end: LetGo = now => {
    if (done) return
    done = true
    ended = now
    clearTimeout(longest)
    if (held.get(id) === mine) held.delete(id)
    if (writing.get(id) === group) writing.delete(id)
    if (now !== 'unchanged') written.set(id, writesOn(id) + 1)
    for (const each of group) each(now)
    free()
  }
  const longest = setTimeout(() => end('unknown'), LONGEST_MS)
  const took = await Promise.allSettled(editorsOf(id).map(e => e.hold()))
  // The hold may have ended while an editor was still saving (its two minutes ran out): that editor has only now
  // stopped taking input, for a hold that is over. It is let go here and now, as the others were, or it would be
  // let go by nobody.
  for (const t of took) if (t.status === 'fulfilled') { if (done) t.value(ended); else group.push(t.value) }
  const failed = took.find(t => t.status === 'rejected')
  if (failed) {
    end('unchanged')
    throw failed.reason
  }
  if (done) throw new Error('the hold was over before the editors had saved')
  return end
}
