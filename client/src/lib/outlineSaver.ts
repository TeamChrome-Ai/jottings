/**
 * What the outline editor holds and how it saves it (app/outlines/[id]/edit.tsx): the whole list of lines is PUT and
 * the title and settings PATCHed, a moment after the last change, each save waiting for the one before. It is kept
 * apart from the screen so that it can be tried without one, and so that a write from elsewhere in the app (Ask,
 * docs/ASSISTANT.md) can be made beside it (lib/outlineEditors.ts): for the moment such a write takes the editor takes
 * no input. It saves what it holds before, and takes what the writer read back, whole, after.
 *
 * Every save names the stamp (`updated_at`) this editor last saw of the outline (that of its load, then of an
 * answer, then of what a writer read back) and who this editor is, a name of its own making. The server makes the
 * save on the outline that still has that stamp, or whose last save was this editor's own (rs/src/outlines.rs
 * `changed_since`): the rule is that nobody else has saved since. So a save of this editor's whose answer never came,
 * or two of its saves on their way at once, are not in each other's way; and an editor that is behind, by whatever
 * path, cannot put its lines over a newer save. Refused, it saves nothing more and takes no input, with the reader's
 * words left on the screen, until the screen has loaded the outline again.
 */
import type { Outline, OutlineItem } from '@shared/types'
import { isLocalId, patchOutline, saveOutlineItems } from './library'
import { newWriter, saveOnItsWay, type LetGo, type OpenEditor } from './outlineEditors'

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'
export type Meta = Pick<Outline, 'title' | 'description' | 'visibility' | 'print_style'>
export const metaOf = (o: Outline): Meta => ({ title: o.title, description: o.description, visibility: o.visibility, print_style: o.print_style })

/** A line as it is saved: without its id and its place. */
const strip = (i: OutlineItem) => ({ kind: i.kind, book: i.book ?? null, chapter: i.chapter ?? null, v1: i.v1 ?? null, v2: i.v2 ?? null, text: i.text ?? null, url: i.url ?? null, depth: i.depth })

/** What the saver tells the screen. */
export interface EditorScreen {
  /** How the saving stands. */
  state: (s: SaveState) => void
  /** A write from elsewhere is about to take hold: a change the screen has on its way into the lines (a line being
   *  taken out) is made now, so that it is saved before the write. */
  holding: () => void
  /** Whether a write from elsewhere has hold of the editor: while it has, the screen takes no input. */
  held: (held: boolean) => void
  /** The outline as a write from elsewhere left it, to show in place of what was shown. */
  took: (o: Outline) => void
  /** It is not known how the outline stands: the screen loads it again, and with it a new editor. */
  stale: () => void
  /** A save was refused because the outline was changed somewhere else: the screen says so, takes no more input,
   *  keeps what the reader typed in sight, and offers to load the outline again. */
  changed: () => void
}

export class OutlineSaver implements OpenEditor {
  /** What the editor holds now, and what of it is not yet saved. `version` moves at every change the reader makes. */
  readonly latest: { items: OutlineItem[]; meta: Meta; itemsDirty: boolean; metaDirty: boolean; version: number }
  private timer: ReturnType<typeof setTimeout> | null = null
  /** The last save asked for: each waits for the one before, so an older whole list never lands after a newer one. */
  private saving: Promise<void> = Promise.resolve()
  /** Writers that have hold of this editor: while there is one it takes no input, so it has nothing to save. */
  private holds = 0
  private closed = false
  /** The outline's stamp as this editor last saw it, which its next save names. None for an outline that is on this
   *  device: the device keeps no stamp to compare. Such an outline is not moved to the account while this editor is
   *  mounted (lib/localLibrary.ts), and nothing of an editor of the device's copy goes to the account: lib/library.ts
   *  refuses it. */
  private seen: string | null
  /** Who this editor is to the server, on every save it makes. */
  private readonly writer = newWriter()
  /** A save was refused because someone else has saved since: this editor is behind, and saves nothing more. */
  private behind = false

  /** `updated`: the outline's `updated_at` as it was loaded. */
  constructor(private readonly id: number, items: OutlineItem[], meta: Meta, updated: string, private readonly on: EditorScreen, private readonly delay = 800) {
    this.latest = { items, meta, itemsDirty: false, metaDirty: false, version: 0 }
    this.seen = isLocalId(id) ? null : updated
  }

  /** Whether a write from elsewhere has hold of the editor. */
  get held(): boolean { return this.holds > 0 }
  /** Whether the editor takes no input: a write has hold of it, or it is behind. */
  get locked(): boolean { return this.holds > 0 || this.behind }

  /** Saves what is not yet saved: the lines and the title and settings, at once. Both name the same stamp, and the one
   *  that arrives second names a stamp the first has spent: it is this editor's own, and is made. */
  readonly send = async (keepalive: boolean): Promise<void> => {
    const l = this.latest
    if (this.behind || (!l.itemsDirty && !l.metaDirty)) return
    const version = l.version
    const doItems = l.itemsDirty, doMeta = l.metaDirty
    const by = { seen: this.seen ?? undefined, writer: this.writer }
    this.on.state('saving')
    try {
      const jobs: Promise<string | undefined>[] = []
      if (doItems) jobs.push(saveOutlineItems(this.id, l.items.map(strip), keepalive, by))
      // an empty title is rejected by the server (min 1): keep the last saved title until the user types one
      if (doMeta) jobs.push(patchOutline(this.id, { ...l.meta, title: l.meta.title.trim() || undefined }, keepalive, by))
      for (const now of await Promise.all(jobs)) this.stamp(now)
      if (l.version === version) {
        if (doItems) l.itemsDirty = false
        if (doMeta) l.metaDirty = false
        this.on.state(l.itemsDirty || l.metaDirty ? 'dirty' : 'saved')
      }
    } catch (e) {
      // someone else has saved the outline since: nothing of this editor's goes over it
      if ((e as { status?: number }).status === 409) { this.behind = true; this.stopTimer(); if (!this.closed) this.on.changed(); return }
      // edited since: the save of that edit, still to come, says how it went
      if (l.version === version) this.on.state('error')
    }
  }
  /** The stamp a save's answer carries is the one the next save names. (Of two answers to saves sent at once, either
   *  will do: the other's save was this editor's too.) After an answer without one the editor names the stamp it had:
   *  it never saves to the account without one. */
  private stamp(now: string | undefined) { if (this.seen !== null && now) this.seen = now }
  /** What is sent is read when its turn comes, so a save that waited sends the latest. Until it is over the save is
   *  on its way, for a screen that would load this outline meanwhile (lib/outlineEditors.ts `savesSettled`). */
  readonly flush = (keepalive = false): Promise<void> => {
    const turn = (this.saving = this.saving.then(() => this.send(keepalive)))
    return this.latest.itemsDirty || this.latest.metaDirty ? saveOnItsWay(this.id, turn) : turn
  }

  /** The reader changed the lines, or the title and settings: saved a moment after the last change. While a write
   *  from elsewhere has hold of the editor nothing is the reader's to change, and this says so (false). */
  touch(what: 'items' | 'meta'): boolean {
    if (this.locked) return false
    if (what === 'items') this.latest.itemsDirty = true; else this.latest.metaDirty = true
    this.latest.version++
    this.on.state('dirty')
    this.stopTimer()
    this.timer = setTimeout(() => { this.timer = null; void this.flush() }, this.delay)
    return true
  }
  private stopTimer() { if (this.timer) { clearTimeout(this.timer); this.timer = null } }

  /** Saves what is not yet saved, and waits for it. Whether nothing is left unsaved. */
  async settle(): Promise<boolean> {
    this.stopTimer()
    await this.flush()
    return !this.latest.itemsDirty && !this.latest.metaDirty
  }

  /** A write is to be made elsewhere: from here on the editor takes no input, and what it holds is saved before the
   *  write begins. So nothing is typed while the write is made, and nothing typed before it is lost. */
  async hold(): Promise<LetGo> {
    this.on.holding()
    const letGo = this.pause()
    if (!await this.settle()) {
      // it could not be saved: a write made now would be made beside words the server does not have
      letGo('unchanged')
      throw new Error('the editor could not save what it holds')
    }
    return letGo
  }
  /** Takes no input from now until the function returned is called. */
  pause(): LetGo {
    if (this.holds++ === 0) this.on.held(true)
    let done = false
    return now => {
      if (done) return
      done = true
      // not known how the outline stands: the editor stays as it is, taking nothing, until the screen has loaded the
      // outline again, so no key is ever struck in lines that may be those of before a write
      if (now === 'unknown') { if (!this.closed) this.on.stale(); return }
      if (now !== 'unchanged' && !this.closed) this.take(now)
      if (--this.holds === 0) this.on.held(false)
    }
  }
  /** Takes the outline as a write made elsewhere left it, whole: its lines under the server's own ids, its title and
   *  its settings. Nothing was typed while that write was made, so nothing here is unsaved after it. */
  private take(o: Outline) {
    const l = this.latest
    l.items = o.items ?? []
    l.meta = metaOf(o)
    if (this.seen !== null) this.seen = o.updated_at
    l.itemsDirty = false
    l.metaDirty = false
    l.version++
    this.on.took(o)
    this.on.state('saved')
  }

  /** The page is closing: what is not yet saved is sent at once, for this save cannot wait for one on its way. */
  unload() { if (this.latest.itemsDirty || this.latest.metaDirty) void this.send(true) }
  /** The screen is closing: what is not yet saved is saved, without the wait. */
  close() { this.closed = true; this.stopTimer(); void this.flush(true) }
  /** Nothing held is to be saved (the outline is being deleted). */
  discard() { this.latest.itemsDirty = false; this.latest.metaDirty = false; this.stopTimer() }
}
