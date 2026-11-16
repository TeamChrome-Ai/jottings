// The outline editor's saves (client/src/lib/outlineSaver.ts) beside a write from elsewhere in the app: Ask's edit of a
// jotting, and Ask's Undo, while the jotting is open in the editor (docs/ASSISTANT.md, "An editor open on the
// jotting"). The editor's own saver, Ask's own host and Ask's own write and Undo run here against a stand-in for the
// server whose answers can be held back, so a key can be struck while one is on its way.
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Line = { kind: string; book: number | null; chapter: number | null; v1: number | null; v2: number | null; text: string | null; url: string | null; depth: number }
type Row = Line & { id: number; outline_id: number; position: number }
type Stored = { id: number; user_id: number; title: string; description: null; visibility: 'private'; share_code: string; print_style: 'verses-first'; created_at: string; updated_at: string; items: Row[]; /** who made its last save, when that save said */ writer?: string | null }
/** What a save names: the stamp its sender last saw, and who the sender is. */
type By = { seen?: string; writer?: string } | undefined

const server = vi.hoisted(() => {
  const s = {
    rows: new Map<number, Stored>(), next: 10, row: 100, clock: 0, calls: [] as string[],
    /** A call named here fails when it next comes, as it does with no connection. */
    fails: new Set<string>(),
    /** A call named here is made when it next comes, and its answer never arrives. */
    lost: new Set<string>(),
    /** The stamp each save named (`if_updated`), in the order they came; and the writer each named. */
    named: [] as [string, string | undefined][],
    writers: [] as (string | undefined)[],
    /** A save names the stamp it last saw, and who it is. It is made on the row that still has that stamp, or whose
     *  last save was this writer's own; otherwise nothing is changed, and the answer is 409. A save that names no
     *  stamp is made whatever the row's. Every save leaves its writer on the row, or none. */
    stale(o: { updated_at: string; writer?: string | null }, name: string, by: By) {
      const { seen, writer } = by ?? {}
      s.named.push([name, seen])
      s.writers.push(writer)
      if (seen !== undefined && seen !== o.updated_at && !(writer !== undefined && writer === o.writer)) throw Object.assign(new Error('changed since'), { status: 409 })
      o.writer = writer ?? null
    },
    /** A call named here waits until it is let go: `held.get(name)` resolves when it has arrived. */
    gates: new Map<string, { arrived: () => void; go: Promise<void> }>(),
    stamp: () => `2026-11-16T10:${String(Math.floor(s.clock / 60)).padStart(2, '0')}:${String(s.clock++ % 60).padStart(2, '0')}Z`,
    async at(name: string) {
      s.calls.push(name)
      const g = s.gates.get(name)
      if (g) { s.gates.delete(name); g.arrived(); await g.go }
      if (s.fails.delete(name)) throw new Error('no connection')
    },
    number: (id: number, items: readonly Line[]): Row[] => items.map((it, k) => ({ ...it, id: s.row++, outline_id: id, position: k })),
  }
  return s
})
vi.mock('../client/src/lib/library', () => ({
  isLocalId: (id: number | string) => Number(id) < 0,
  listOutlines: async () => [...server.rows.values()],
  getOwnOutline: async (id: number) => { await server.at('get'); const o = server.rows.get(id); if (!o) throw Object.assign(new Error('not found'), { status: 404 }); return structuredClone(o) },
  createOutline: async (meta: { title: string }) => { await server.at('create'); const id = server.next++; const o: Stored = { id, user_id: 1, title: meta.title, description: null, visibility: 'private', share_code: 'code', print_style: 'verses-first', created_at: server.stamp(), updated_at: server.stamp(), items: [] }; server.rows.set(id, o); return structuredClone(o) },
  saveOutlineItems: async (id: number, items: readonly Line[], _keepalive?: boolean, seen?: By) => {
    const sent = structuredClone(items)
    await server.at('save')
    const o = server.rows.get(id)
    if (!o) throw Object.assign(new Error('not found'), { status: 404 })
    server.stale(o, 'save', seen)
    o.items = server.number(id, sent)
    o.updated_at = server.stamp()
    if (server.lost.delete('save')) throw new Error('the server did not answer in time')
    return id < 0 ? undefined : o.updated_at
  },
  patchOutline: async (id: number, meta: { title?: string }, _keepalive?: boolean, seen?: By) => {
    await server.at('patch')
    const o = server.rows.get(id)!
    server.stale(o, 'patch', seen)
    if (meta.title) o.title = meta.title
    o.updated_at = server.stamp()
    return id < 0 ? undefined : o.updated_at
  },
  deleteOutline: async (id: number) => { await server.at('delete'); server.rows.delete(id) },
}))
vi.mock('../client/src/lib/api', () => ({ get: async () => [] }))

const { OutlineSaver } = await import('../client/src/lib/outlineSaver')
// `savesPending`, `savesSettled`: as the edit screen uses them before it loads a jotting
const { editorOpened, holdEditor, writesOn, savesPending, savesSettled } = await import('../client/src/lib/outlineEditors')
/** The app gives a request this long (client/src/lib/api.ts `DEFAULT_TIMEOUT_MS`), and the screen its wait. */
const BOUND = 15_000
const { outlinesHost } = await import('../client/src/lib/assistantOutlinesHost')
const { applyPlan, planWrite, undoJotting, JOTTING_TOOLS } = await import('../client/src/lib/assistantOutlines')
type ActionContext = import('../client/src/lib/assistantActions').ActionContext
type Saver = InstanceType<typeof OutlineSaver>

const NONE = { book: null, chapter: null, v1: null, v2: null, url: null }
const note = (text: string): Line => ({ ...NONE, kind: 'note', text, depth: 0 })
const never = () => { throw new Error('not an outline’s tool') }
const ctx = { prefs: { get: never }, navigate: never, player: {}, place: never, bookmarks: {}, highlights: {}, feedback: never, paragraph: () => undefined, jottings: outlinesHost(() => 1) } as unknown as ActionContext

/** A jotting on the server with these notes. */
function seed(title: string, texts: string[]): number {
  const id = server.next++
  server.rows.set(id, { id, user_id: 1, title, description: null, visibility: 'private', share_code: 'code', print_style: 'verses-first', created_at: server.stamp(), updated_at: server.stamp(), items: server.number(id, texts.map(note)) })
  return id
}
const lines = (id: number) => (server.rows.get(id)?.items ?? []).map(i => i.text)
/** The call named is held when it next comes: `arrived` once it has, `go()` lets it on. */
function hold(name: string) {
  let arrived!: () => void, go!: () => void
  const there = new Promise<void>(r => { arrived = r })
  server.gates.set(name, { arrived, go: new Promise<void>(r => { go = r }) })
  return { arrived: there, go }
}
/** The editor open on the jotting, as the screen opens it: what it shows, and the reader's hands on it. `loaded`: the
 *  jotting as its screen loaded it, and the writes there had been on it when that load began, when the load was slow. */
function editor(id: number, loaded?: { outline: Stored; since: number }) {
  const o = loaded?.outline ?? structuredClone(server.rows.get(id)!)
  const shown = { items: o.items as Row[], title: o.title, state: 'saved', held: false, stale: 0, updated: o.updated_at, changed: false }
  /** A line the reader has taken out, still closing on the screen: it leaves the lines when it has closed. */
  let leaving: string | null = null
  const saver: Saver = new OutlineSaver(id, o.items as never, { title: o.title, description: null, visibility: 'private', print_style: 'verses-first' }, o.updated_at, {
    state: s => { shown.state = s },
    held: h => { shown.held = h },
    stale: () => { shown.stale++ },
    changed: () => { shown.changed = true },
    holding: () => { if (leaving !== null) { const text = leaving; leaving = null; set((saver.latest.items as unknown as Row[]).filter(i => i.text !== text)) } },
    took: now => { shown.items = (now.items ?? []) as never; shown.title = now.title; shown.updated = now.updated_at },
  }, 5)
  const closed = editorOpened(id, saver, loaded?.since)
  let temp = -1
  /** While a write has hold of the editor its fields take nothing, as the screen has them. */
  const off = () => saver.locked
  const set = (items: Row[]) => { if (off()) return; saver.latest.items = items as never; shown.items = items; saver.touch('items') }
  return {
    saver, shown,
    texts: () => saver.latest.items.map(i => i.text),
    /** The reader types in the line that reads `was`. */
    type: (was: string, now: string) => set((saver.latest.items as unknown as Row[]).map(i => (i.text === was ? { ...i, text: now } : i))),
    /** The reader adds a note at the end. */
    add: (text: string) => set([...(saver.latest.items as unknown as Row[]), { ...note(text), id: temp--, outline_id: id, position: saver.latest.items.length }]),
    remove: (text: string) => set((saver.latest.items as unknown as Row[]).filter(i => i.text !== text)),
    /** The reader taps a line out: it closes on the screen first, and is out of the lines a moment later. */
    tapOut: (text: string) => { if (!off()) leaving = text },
    rename: (title: string) => { if (off()) return; saver.latest.meta = { ...saver.latest.meta, title }; shown.title = title; saver.touch('meta') },
    /** The page closes, as the screen tells the saver of it. */
    unload: () => saver.unload(),
    /** Every save the editor has to make is made. */
    rest: async () => { for (let k = 0; k < 6; k++) { await saver.settle(); await new Promise(r => setTimeout(r, 12)) } },
    close: () => { closed(); saver.close() },
  }
}

beforeEach(() => { server.rows.clear(); server.calls.length = 0; server.gates.clear(); server.fails.clear(); server.lost.clear(); server.named.length = 0; server.writers.length = 0 })

describe('the editor’s own saves', () => {
  it('are made a moment after the last change, the whole list at once', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = editor(id)
    e.type('B', 'B and more')
    expect([e.shown.state, lines(id)]).toEqual(['dirty', ['A', 'B']])
    await new Promise(r => setTimeout(r, 30))
    expect([e.shown.state, lines(id), server.calls]).toEqual(['saved', ['A', 'B and more'], ['save']])
    e.close()
  })
  it('send the latest when a key is struck while a save is on its way, and that one waits for the first', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    const first = hold('save')
    e.type('A', 'A1')
    void e.saver.settle()
    await first.arrived
    e.type('A1', 'A12')
    first.go()
    await e.rest()
    expect([lines(id), e.shown.state, server.calls.filter(c => c === 'save').length]).toEqual([['A12'], 'saved', 2])
    e.close()
  })
  it('take a write made elsewhere when nothing here is unsaved: Ask’s line shows in the editor, and the next save keeps it', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = editor(id)
    const planned = await planWrite('edit_jotting', { id, add: [{ line: { kind: 'note', text: 'From Ask' } }] }, ctx)
    if (!('plan' in planned)) throw new Error('refused')
    const out = await applyPlan(planned.plan, ctx, 'once')
    expect([(out.result as { applied?: string }).applied, e.texts(), e.shown.items.map(i => i.text), e.shown.state]).toEqual(['at once', ['A', 'B', 'From Ask'], ['A', 'B', 'From Ask'], 'saved'])
    e.type('A', 'A typed after')
    await e.rest()
    expect(lines(id)).toEqual(['A typed after', 'B', 'From Ask'])
    e.close()
  })
})

/** Ask adds a note to the jotting, as its tool does: worked out, then written. */
async function planned(id: number, text = 'From Ask') {
  const p = await planWrite('edit_jotting', { id, add: [{ line: { kind: 'note', text } }] }, ctx)
  if (!('plan' in p)) throw new Error('refused')
  return p.plan
}
const applied = (out: { result: unknown }) => (out.result as { applied?: string }).applied
const error = (out: { result: unknown }) => (out.result as { error?: string }).error

// "Applied" and "undone" are said of what is read back, not of a save that was sent
describe('what a write and an Undo say of themselves', () => {
  it('a write is not called applied when the jotting read back is not what was written', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const plan = await planned(id)
    const save = hold('save')
    const writing = applyPlan(plan, ctx, 'once')
    await save.arrived
    const back = hold('get')
    save.go()
    await back.arrived
    // written over from another device before it was read back
    const o = server.rows.get(id)!
    o.items = server.number(id, [note('From another device')])
    o.updated_at = server.stamp()
    back.go()
    const out = await writing
    expect([applied(out), typeof error(out)]).toEqual([undefined, 'string'])
  })
  it('an Undo is not called undone when the jotting read back is not as it was before', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const out = await applyPlan(await planned(id), ctx, 'once')
    const save = hold('save')
    const undoing = undoJotting(out.changes[0].undo as never, ctx)
    await save.arrived
    const back = hold('get')
    save.go()
    await back.arrived
    const o = server.rows.get(id)!
    o.items = server.number(id, [note('From another device')])
    o.updated_at = server.stamp()
    back.go()
    expect((await undoing).did).not.toBe('undone')
  })
})


// No putting together of what the reader typed and what Ask wrote: for the moment a write, or an Undo, takes, the
// editor takes no input. It saves what it holds before, and takes what was read back, whole, after; and then it has
// nothing to save until the reader changes something.
describe('the editor for the moment a write has hold of it', () => {
  const saves = () => server.calls.filter(c => c === 'save' || c === 'patch')
  it('saves nothing after the hold when the reader typed nothing, though the title was typed with a space after it', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = editor(id)
    e.rename('Prayer ')
    await e.rest()
    expect([server.rows.get(id)!.title, saves()]).toEqual(['Prayer', ['patch']])
    server.calls.length = 0
    const out = await applyPlan(await planned(id), ctx, 'once')
    await e.rest()
    await new Promise(r => setTimeout(r, 30))
    // Ask's one save, and none of the editor's after it
    expect([applied(out), saves(), e.shown.state, e.saver.latest.itemsDirty, e.saver.latest.metaDirty]).toEqual(['at once', ['save'], 'saved', false, false])
    // so the jotting is still as Ask left it, and its Undo undoes
    expect((await undoJotting(out.changes[0].undo as never, ctx)).did).toBe('undone')
    e.close()
  })
  it('leaves Ask’s new title standing, though the title was typed with a space after it', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    e.rename('Prayer ')
    await e.rest()
    const p = await planWrite('edit_jotting', { id, title: 'Asking', add: [{ line: { kind: 'note', text: 'From Ask' } }] }, ctx)
    if (!('plan' in p)) throw new Error('refused')
    expect(applied(await applyPlan(p.plan, ctx, 'once'))).toBe('at once')
    await e.rest()
    await new Promise(r => setTimeout(r, 30))
    expect([server.rows.get(id)!.title, e.shown.title, e.saver.latest.meta.title, lines(id)]).toEqual(['Asking', 'Asking', 'Asking', ['A', 'From Ask']])
    e.close()
  })
  it('takes no input: keys struck, a line added, a line taken out and a title typed change nothing, and nothing is saved for them', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = editor(id)
    const plan = await planned(id)
    const save = hold('save')
    const writing = applyPlan(plan, ctx, 'once')
    await save.arrived
    expect(e.shown.held).toBe(true)
    e.type('B', 'B typed meanwhile')
    e.add('A line of the reader’s own')
    e.remove('A')
    e.rename('A title of the reader’s own')
    expect([e.texts(), e.shown.items.map(i => i.text), e.shown.title, e.shown.state]).toEqual([['A', 'B'], ['A', 'B'], 'Prayer', 'saved'])
    // longer than the editor waits before it saves
    await new Promise(r => setTimeout(r, 40))
    expect(saves()).toEqual(['save'])
    save.go()
    expect(applied(await writing)).toBe('at once')
    await e.rest()
    await new Promise(r => setTimeout(r, 30))
    expect([lines(id), e.texts(), e.shown.title, server.rows.get(id)!.title, saves(), e.shown.held]).toEqual([['A', 'B', 'From Ask'], ['A', 'B', 'From Ask'], 'Prayer', 'Prayer', ['save'], false])
    // and afterwards the reader's keys are theirs again
    e.type('B', 'B typed afterwards')
    await e.rest()
    expect(lines(id)).toEqual(['A', 'B typed afterwards', 'From Ask'])
    e.close()
  })
  it('sends nothing when the page closes: Ask’s write is not written over by the lines of before it', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = editor(id)
    const plan = await planned(id)
    const save = hold('save')
    const writing = applyPlan(plan, ctx, 'once')
    await save.arrived
    const back = hold('get')
    save.go()
    await back.arrived
    // Ask's lines are saved and not yet read back: the reader strikes a key, and the page closes
    e.type('B', 'B typed meanwhile')
    e.unload()
    await new Promise(r => setTimeout(r, 20))
    expect([lines(id), saves()]).toEqual([['A', 'B', 'From Ask'], ['save']])
    back.go()
    expect(applied(await writing)).toBe('at once')
    e.close()
    await new Promise(r => setTimeout(r, 30))
    expect([lines(id), saves()]).toEqual([['A', 'B', 'From Ask'], ['save']])
  })
  it('let go, has what was read back, whole: the lines as the server has them, the title, the stamp, and nothing to save', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = editor(id)
    const p = await planWrite('edit_jotting', { id, title: 'Asking', add: [{ line: { kind: 'note', text: 'From Ask' } }] }, ctx)
    if (!('plan' in p)) throw new Error('refused')
    expect(applied(await applyPlan(p.plan, ctx, 'once'))).toBe('at once')
    const now = server.rows.get(id)!
    expect(e.saver.latest.items).toEqual(now.items)
    expect(e.shown.items).toEqual(now.items)
    expect([e.saver.latest.meta.title, e.shown.title, e.shown.updated, e.saver.latest.itemsDirty, e.saver.latest.metaDirty, e.shown.state]).toEqual(['Asking', 'Asking', now.updated_at, false, false, 'saved'])
    e.close()
  })
  it('saves what it holds before the write: nothing typed before is lost', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = editor(id)
    // typed, and not yet saved, when Ask works its edit out: the reading saves it first, and Ask writes onto it
    e.type('A', 'A typed a moment before')
    expect(applied(await applyPlan(await planned(id), ctx, 'once'))).toBe('at once')
    expect([lines(id), e.texts()]).toEqual([['A typed a moment before', 'B', 'From Ask'], ['A typed a moment before', 'B', 'From Ask']])
    // typed after an edit was worked out and before it is written: the write finds the jotting changed, and is not made
    const plan = await planned(id, 'From Ask again')
    e.type('B', 'B typed a moment before')
    expect(error(await applyPlan(plan, ctx, 'once'))).toMatch(/has changed since this edit was worked out/)
    await e.rest()
    expect([lines(id), e.texts()]).toEqual([['A typed a moment before', 'B typed a moment before', 'From Ask'], ['A typed a moment before', 'B typed a moment before', 'From Ask']])
    e.close()
  })
  it('that cannot save what it holds is not written beside: the write is not made, and the reader’s words stay', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = editor(id)
    const plan = await planned(id)
    server.fails.add('save')
    e.type('B', 'B typed with no connection')
    const out = await applyPlan(plan, ctx, 'once')
    expect([typeof error(out), applied(out), lines(id), e.texts(), e.shown.state, e.shown.held]).toEqual(['string', undefined, ['A', 'B'], ['A', 'B typed with no connection'], 'error', false])
    // the connection is back: the editor's own save goes through, as its Retry would send it
    await e.rest()
    expect(lines(id)).toEqual(['A', 'B typed with no connection'])
    e.close()
  })
  it('closed during the hold, has nothing to save', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = editor(id)
    e.type('A', 'A typed before')
    const plan = await planned(id)
    const save = hold('save')
    const writing = applyPlan(plan, ctx, 'once')
    await save.arrived
    server.calls.length = 0
    e.type('B', 'B typed meanwhile')
    e.close()
    save.go()
    expect(applied(await writing)).toBe('at once')
    await new Promise(r => setTimeout(r, 30))
    expect([lines(id), saves()]).toEqual([['A typed before', 'B', 'From Ask'], []])
  })
  it('opened during the hold, takes no input until it is let go, and then has what was read back', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const save = hold('save')
    const writing = applyPlan(await planned(id), ctx, 'once')
    await save.arrived
    const e = editor(id)
    expect(e.shown.held).toBe(true)
    e.type('B', 'B typed in an editor opened meanwhile')
    await new Promise(r => setTimeout(r, 40))
    expect([e.texts(), saves()]).toEqual([['A', 'B'], ['save']])
    save.go()
    expect(applied(await writing)).toBe('at once')
    await e.rest()
    expect([lines(id), e.texts(), e.shown.held, saves()]).toEqual([['A', 'B', 'From Ask'], ['A', 'B', 'From Ask'], false, ['save']])
    e.close()
  })
  it('held by an Undo, takes no input, and then has the lines of before the write', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = editor(id)
    const out = await applyPlan(await planned(id), ctx, 'once')
    server.calls.length = 0
    const save = hold('save')
    const undoing = undoJotting(out.changes[0].undo as never, ctx)
    await save.arrived
    e.type('A', 'A typed during Undo')
    e.unload()
    save.go()
    expect((await undoing).did).toBe('undone')
    await e.rest()
    await new Promise(r => setTimeout(r, 30))
    expect([lines(id), e.texts(), saves(), e.shown.held]).toEqual([['A', 'B'], ['A', 'B'], ['save'], false])
    e.close()
  })
  it('let go by nobody for two minutes, is told to load the jotting again, and takes no input on the lines it has', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    vi.useFakeTimers()
    try {
      const letGo = await holdEditor(id)
      await vi.advanceTimersByTimeAsync(119_000)
      expect([e.shown.held, e.shown.stale]).toEqual([true, 0])
      await vi.advanceTimersByTimeAsync(2_000)
      expect(e.shown.stale).toBe(1)
      e.type('A', 'A typed on lines that may be of before the write')
      expect(e.texts()).toEqual(['A'])
      await vi.advanceTimersByTimeAsync(1_000)
      expect(saves()).toEqual([])
      // the writer, when it comes back at last, has nobody to let go
      letGo('unchanged')
      expect([e.shown.held, e.shown.stale]).toEqual([true, 1])
    } finally { vi.useRealTimers() }
    e.close()
  })
  it('with a line on its way out when the write takes hold: the line is out, and saved so, before the write', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = editor(id)
    const plan = await planned(id)
    e.tapOut('B')
    // the jotting the write finds is without the line: it has changed since the edit was worked out
    expect(error(await applyPlan(plan, ctx, 'once'))).toMatch(/has changed since this edit was worked out/)
    expect([lines(id), e.texts(), e.shown.held]).toEqual([['A'], ['A'], false])
    expect(applied(await applyPlan(await planned(id), ctx, 'once'))).toBe('at once')
    expect([lines(id), e.texts()]).toEqual([['A', 'From Ask'], ['A', 'From Ask']])
    e.close()
  })
  it('whose save before the hold is still on its way when the hold has run out is let go as soon as it has saved, and the write is not made', async () => {
    const id = seed('Prayer', ['A', 'B'])
    vi.useFakeTimers()
    try {
      const e = editor(id)
      const plan = await planned(id)
      const save = hold('save')
      e.type('B', 'B, in a save that takes longer than any hold')
      const writing = applyPlan(plan, ctx, 'once')
      await save.arrived
      expect(e.shown.held).toBe(true)
      // two minutes, and the editor's own save has still not been answered: the hold is over
      await vi.advanceTimersByTimeAsync(121_000)
      save.go()
      const out = await writing
      await vi.advanceTimersByTimeAsync(50)
      // the editor joined a hold that had ended: it is let go there and then, to load the jotting again, and no write
      // is made beside it
      expect([e.shown.stale, typeof error(out), applied(out), lines(id)]).toEqual([1, 'string', undefined, ['A', 'B, in a save that takes longer than any hold']])
      e.close()
      // and the jotting is not left held: the next write takes hold of it
      const after = editor(id)
      expect(applied(await applyPlan(await planned(id), ctx, 'once'))).toBe('at once')
      expect(after.texts()).toEqual(['A', 'B, in a save that takes longer than any hold', 'From Ask'])
      after.close()
    } finally { vi.useRealTimers() }
  })
  it('is held by one write at a time: a second waits for the first to let go', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    const first = await holdEditor(id)
    let second: ((now: 'unchanged') => void) | null = null
    void holdEditor(id).then(letGo => { second = letGo })
    await new Promise(r => setTimeout(r, 10))
    expect([second, e.shown.held]).toEqual([null, true])
    first('unchanged')
    await new Promise(r => setTimeout(r, 10))
    expect([second === null, e.shown.held]).toEqual([false, true])
    second!('unchanged')
    expect(e.shown.held).toBe(false)
    e.close()
  })
  it('let go by a write that was refused, goes on as it was, with nothing loaded and nothing saved', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    const plan = await planned(id)
    // changed from elsewhere since the plan: refused
    const o = server.rows.get(id)!
    o.items = server.number(id, [note('A'), note('From another device')])
    o.updated_at = server.stamp()
    const rows = e.saver.latest.items
    expect(error(await applyPlan(plan, ctx, 'once'))).toMatch(/has changed since this edit was worked out/)
    expect([e.saver.latest.items === rows, e.shown.held, e.shown.stale, saves()]).toEqual([true, false, 0, []])
    e.close()
  })
  it('let go by a write that could not be read back, is told to load the jotting again, and takes no input meanwhile', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    const plan = await planned(id)
    const save = hold('save')
    const writing = applyPlan(plan, ctx, 'once')
    await save.arrived
    server.fails.add('get')
    save.go()
    expect(error(await writing)).toMatch(/could not be read back/)
    expect([lines(id), e.shown.stale, e.shown.held]).toEqual([['A', 'From Ask'], 1, true])
    e.type('A', 'A typed on the lines of before the write')
    await new Promise(r => setTimeout(r, 30))
    expect([e.texts(), lines(id)]).toEqual([['A'], ['A', 'From Ask']])
    // the screen loads the jotting again, and with it a new editor
    e.close()
    const again = editor(id)
    expect([again.texts(), again.shown.held]).toEqual([['A', 'From Ask'], false])
    again.close()
  })
  it('on a jotting whose making is undone, is told to load it again', async () => {
    const made = await planWrite('create_jotting', { title: 'Made by Ask', lines: [{ kind: 'note', text: 'A' }] }, ctx)
    if (!('plan' in made)) throw new Error('refused')
    const out = await applyPlan(made.plan, ctx, 'once')
    const id = (out.result as { id: number }).id
    const e = editor(id)
    expect((await undoJotting(out.changes[0].undo as never, ctx)).did).toBe('undone')
    expect([server.rows.has(id), e.shown.stale, e.shown.held]).toEqual([false, 1, true])
    e.close()
    await new Promise(r => setTimeout(r, 20))
    expect(saves()).toEqual(['save'])
  })
  it('whose load was on its way through the whole of a write, opens on the lines of before it: it takes no input, and is told to load again', async () => {
    const id = seed('Prayer', ['A', 'B'])
    // the screen begins to load the jotting, and the answer, which is the jotting as it is now, is slow to come
    const loaded = { outline: structuredClone(server.rows.get(id)!), since: writesOn(id) }
    // meanwhile Ask writes to it, and has read its write back before the editor opens
    expect(applied(await applyPlan(await planned(id), ctx, 'once'))).toBe('at once')
    const e = editor(id, loaded)
    expect(e.texts()).toEqual(['A', 'B'])
    e.type('B', 'B typed on the lines of before the write')
    await e.rest()
    expect([lines(id), e.shown.stale, e.shown.held]).toEqual([['A', 'B', 'From Ask'], 1, true])
    // the screen loads the jotting again, and the editor that opens then has Ask's line
    e.close()
    const again = editor(id, { outline: structuredClone(server.rows.get(id)!), since: writesOn(id) })
    expect([again.texts(), again.shown.held, again.shown.stale]).toEqual([['A', 'B', 'From Ask'], false, 0])
    again.close()
  })
  it('whose load was on its way while a write was refused, or only read, opens as any editor does', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const plan = await planned(id)
    const o = server.rows.get(id)!
    o.items = server.number(id, [note('A'), note('From another device')])
    o.updated_at = server.stamp()
    const loaded = { outline: structuredClone(server.rows.get(id)!), since: writesOn(id) }
    expect(error(await applyPlan(plan, ctx, 'once'))).toMatch(/has changed since this edit was worked out/)
    await JOTTING_TOOLS.read_jotting({ id }, ctx)
    const e = editor(id, loaded)
    expect([e.shown.held, e.shown.stale]).toEqual([false, 0])
    e.close()
  })
  it('is not held for a reading, which waits only for the editor to save what it holds', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = editor(id)
    const seen: boolean[] = []
    const read = hold('get')
    e.type('B', 'B as the reader has it')
    const reading = JOTTING_TOOLS.read_jotting({ id }, ctx)
    await read.arrived
    seen.push(e.shown.held)
    e.type('A', 'A typed while Ask read')
    read.go()
    const out = await reading
    expect([(out.result as { lines: { text: string }[] }).lines.map(l => l.text), seen, e.shown.stale]).toEqual([['A', 'B as the reader has it'], [false], 0])
    await e.rest()
    expect(lines(id)).toEqual(['A typed while Ask read', 'B as the reader has it'])
    e.close()
  })
})

// Two editors of one jotting can be mounted at once: from the editor, View opens the jotting over it, and Edit there
// opened a second editor over that, with the first still mounted beneath. A write must find both.
describe('two editors of one jotting, mounted at once', () => {
  const saves = () => server.calls.filter(c => c === 'save' || c === 'patch')
  it('are both held by a write: the one beneath takes no input either, saves nothing over the write, and has the read-back', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const beneath = editor(id), above = editor(id)
    const plan = await planned(id)
    const save = hold('save')
    const writing = applyPlan(plan, ctx, 'once')
    await save.arrived
    expect([beneath.shown.held, above.shown.held]).toEqual([true, true])
    beneath.type('A', 'A typed in the editor beneath')
    save.go()
    expect(applied(await writing)).toBe('at once')
    await beneath.rest()
    await new Promise(r => setTimeout(r, 30))
    expect([lines(id), beneath.texts(), above.texts(), saves()]).toEqual([['A', 'B', 'From Ask'], ['A', 'B', 'From Ask'], ['A', 'B', 'From Ask'], ['save']])
    expect([beneath.shown.held, above.shown.held]).toEqual([false, false])
    above.close(); beneath.close()
  })
  it('the one beneath, with a save of its own waiting when the write comes, saves it before the write and not over it', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const beneath = editor(id)
    const plan = await planned(id)
    const above = editor(id)
    const first = hold('save')
    beneath.type('B', 'B typed beneath a moment before')
    // the write comes while those words are still to be saved
    const writing = applyPlan(plan, ctx, 'once')
    await first.arrived
    first.go()
    // the words reached the server before the write read the jotting, which it then finds changed: it is not made
    expect(error(await writing)).toMatch(/has changed since this edit was worked out/)
    await beneath.rest()
    expect([lines(id), beneath.shown.held, above.shown.held]).toEqual([['A', 'B typed beneath a moment before'], false, false])
    above.close(); beneath.close()
  })
  it('the one beneath is still the jotting’s editor when the one above has gone: a later write holds it', async () => {
    const id = seed('Prayer', ['A'])
    const beneath = editor(id), above = editor(id)
    above.close()
    const save = hold('save')
    const writing = applyPlan(await planned(id), ctx, 'once')
    await save.arrived
    expect(beneath.shown.held).toBe(true)
    beneath.type('A', 'A typed while Ask writes')
    save.go()
    expect(applied(await writing)).toBe('at once')
    await beneath.rest()
    expect([lines(id), beneath.texts()]).toEqual([['A', 'From Ask'], ['A', 'From Ask']])
    beneath.close()
  })
  it('the one above going leaves the one beneath where it was, and the one beneath going leaves the one above', async () => {
    const id = seed('Prayer', ['A'])
    const beneath = editor(id), above = editor(id)
    beneath.close()
    const letGo = await holdEditor(id)
    expect([above.shown.held, beneath.shown.held]).toEqual([true, false])
    letGo('unchanged')
    above.close()
    // nobody is left: a hold has nobody to wait for
    ;(await holdEditor(id))('unchanged')
  })
})

// list_jottings reads the server, which does not have what the reader has typed in an open editor until it is saved
describe('Ask’s list of the jottings, beside an open editor', () => {
  const titles = (out: { result: unknown }) => (out.result as { jottings: { title: string }[] }).jottings.map(j => j.title)
  it('has the title the reader has just typed: every open editor saves first', async () => {
    const one = seed('Prayer', ['A']), two = seed('Grace', ['B'])
    const a = editor(one), b = editor(two)
    a.rename('Prayer, as just renamed')
    b.rename('Grace, as just renamed')
    expect(titles(await JOTTING_TOOLS.list_jottings({}, ctx)).sort()).toEqual(['Grace, as just renamed', 'Prayer, as just renamed'])
    a.close(); b.close()
  })
  it('waits for a write on its way to one of them', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    const p = await planWrite('edit_jotting', { id, title: 'Asking' }, ctx)
    if (!('plan' in p)) throw new Error('refused')
    const patch = hold('patch')
    const writing = applyPlan(p.plan, ctx, 'once')
    await patch.arrived
    const listing = JOTTING_TOOLS.list_jottings({}, ctx)
    patch.go()
    await writing
    expect(titles(await listing)).toEqual(['Asking'])
    e.close()
  })
  it('is not kept back by a save that fails: it is given as the server has it, and the model is told which may be behind', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    server.fails.add('patch')
    e.rename('Prayer, typed with no connection')
    const out = await JOTTING_TOOLS.list_jottings({}, ctx)
    expect(titles(out)).toEqual(['Prayer'])
    expect((out.result as { note?: string }).note).toMatch(new RegExp(`${id}\\b.*could not be saved`))
    e.close()
  })
  it('says nothing of the kind when every editor has saved', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    e.rename('Prayer, renamed')
    expect((await JOTTING_TOOLS.list_jottings({}, ctx)).result).not.toHaveProperty('note')
    e.close()
  })
})

// The server is the one place that can tell, for every path, that an editor is behind. The rule is not "your stamp is
// old" but "someone other than you has saved since you last saw it": a save names the stamp (`updated_at`) its sender
// last saw and who the sender is, and is made on the jotting that still has that stamp, or whose last save was the
// sender's own. An editor's own earlier save, whose answer it never had, is not a change from elsewhere.
describe('the stamp a save names', () => {
  const saves = () => server.calls.filter(c => c === 'save' || c === 'patch')
  const at = (id: number) => server.rows.get(id)!.updated_at
  /** The jotting is saved from somewhere else: by another editor (`writer`), or by a save that names nobody (verses
   *  added from the reader, an app from before the field). */
  const elsewhere = (id: number, texts: string[], writer: string | null = null) => { const o = server.rows.get(id)!; o.items = server.number(id, texts.map(note)); o.updated_at = server.stamp(); o.writer = writer }
  /** An editor that no write of Ask's knows of: nobody holds it, and nobody gives it a read-back. */
  const stray = (id: number) => {
    const o = structuredClone(server.rows.get(id)!)
    const saver = new OutlineSaver(id, o.items as never, { title: o.title, description: null, visibility: 'private', print_style: 'verses-first' }, o.updated_at, { state: () => {}, held: () => {}, stale: () => {}, changed: () => {}, holding: () => {}, took: () => {} }, 5)
    return { saver, type: (was: string, now: string) => { saver.latest.items = (saver.latest.items as unknown as Row[]).map(i => (i.text === was ? { ...i, text: now } : i)) as never; saver.touch('items') } }
  }
  it('is the one the editor last saw: that of its load, and then of each answer', async () => {
    const id = seed('Prayer', ['A'])
    const loaded = at(id)
    const e = editor(id)
    e.type('A', 'A1')
    await e.rest()
    const first = at(id)
    e.type('A1', 'A12')
    await e.rest()
    expect([server.named, lines(id), e.shown.state, e.shown.changed]).toEqual([[['save', loaded], ['save', first]], ['A12'], 'saved', false])
    e.close()
  })
  it('with it, who the editor is: one name for the editor’s life, another for another editor', async () => {
    const id = seed('Prayer', ['A']), other = seed('Grace', ['B'])
    const e = editor(id), f = editor(other)
    e.type('A', 'A1')
    await e.rest()
    e.rename('Prayer and more')
    await e.rest()
    f.type('B', 'B1')
    await f.rest()
    const [first, second, third] = server.writers
    expect([typeof first, first === second, third !== first, typeof third]).toEqual(['string', true, true, 'string'])
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
    e.close(); f.close()
  })
  it('lines and a title changed together go at once, as they always did: both name the same stamp, and both are made', async () => {
    const id = seed('Prayer', ['A'])
    const loaded = at(id)
    const e = editor(id)
    e.type('A', 'A1')
    e.rename('Prayer and more')
    const put = hold('save'), patch = hold('patch')
    void e.saver.settle()
    await Promise.all([put.arrived, patch.arrived])
    // the title lands first, and the lines, which name the stamp it has spent, are this editor's own all the same
    patch.go()
    await new Promise(r => setTimeout(r, 10))
    put.go()
    await e.rest()
    expect([server.named, lines(id), server.rows.get(id)!.title, e.shown.state, e.shown.changed, saves()]).toEqual([[['patch', loaded], ['save', loaded]], ['A1'], 'Prayer and more', 'saved', false, ['save', 'patch']])
    // and the save after them is made too, whichever of the two stamps the editor kept
    e.type('A1', 'A12')
    await e.rest()
    expect([lines(id), e.shown.changed]).toEqual([['A12'], false])
    e.close()
  })
  it('from an editor that is behind is refused: the editor saves no more, takes no input, keeps the reader’s words, and says so', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = editor(id)
    elsewhere(id, ['A', 'B', 'From another device'])
    e.type('B', 'B typed on this device')
    await e.rest()
    expect([lines(id), e.texts(), e.shown.changed, saves()]).toEqual([['A', 'B', 'From another device'], ['A', 'B typed on this device'], true, ['save']])
    // nothing more is typed, and nothing more is sent: not a moment later, not when the page or the screen closes
    e.type('A', 'A typed after the refusal')
    e.rename('A title typed after the refusal')
    await e.rest()
    e.unload()
    e.close()
    await new Promise(r => setTimeout(r, 30))
    expect([lines(id), e.texts(), server.rows.get(id)!.title, saves()]).toEqual([['A', 'B', 'From another device'], ['A', 'B typed on this device'], 'Prayer', ['save']])
  })
  it('for a title is refused the same way', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    elsewhere(id, ['From another device'])
    e.rename('Prayer, renamed on this device')
    await e.rest()
    expect([server.rows.get(id)!.title, e.shown.title, e.shown.changed, saves()]).toEqual(['Prayer', 'Prayer, renamed on this device', true, ['patch']])
    e.close()
  })
  it('from an editor that saved, and then never had a write of Ask’s read back to it, is refused: the last to save was Ask', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = stray(id)
    e.type('A', 'A from the editor')
    await e.saver.settle()
    expect(applied(await applyPlan(await planned(id), ctx, 'once'))).toBe('at once')
    e.type('B', 'B from the editor left behind')
    await e.saver.settle()
    expect([lines(id), e.saver.locked]).toEqual([['A from the editor', 'B', 'From Ask'], true])
    // Ask's write named a writer of its own, which is no editor's
    expect([new Set(server.writers).size, server.writers.every(w => typeof w === 'string')]).toEqual([2, true])
    e.saver.close()
  })
  it('from an editor that saved, after another editor has saved since, is refused', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = editor(id)
    e.type('A', 'A from this editor')
    await e.rest()
    elsewhere(id, ['A from this editor', 'B', 'From another editor'], 'another editor')
    e.type('B', 'B typed here afterwards')
    await e.rest()
    expect([lines(id), e.shown.changed, e.texts()]).toEqual([['A from this editor', 'B', 'From another editor'], true, ['A from this editor', 'B typed here afterwards']])
    e.close()
  })
  it('from an editor that saved, after a save that named nobody (verses added from the reader), is refused', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    e.type('A', 'A from this editor')
    await e.rest()
    elsewhere(id, ['A from this editor', 'A verse added from the reader'])
    e.type('A from this editor', 'A typed here afterwards')
    await e.rest()
    expect([lines(id), e.shown.changed]).toEqual([['A from this editor', 'A verse added from the reader'], true])
    e.close()
  })
  it('after a write of Ask’s is that of the read-back: what the reader types then is saved', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    expect(applied(await applyPlan(await planned(id), ctx, 'once'))).toBe('at once')
    const left = at(id)
    e.type('A', 'A typed after Ask wrote')
    await e.rest()
    expect([server.named.at(-1), lines(id), e.shown.changed]).toEqual([['save', left], ['A typed after Ask wrote', 'From Ask'], false])
    e.close()
  })
  it('is none for a jotting kept on this device', async () => {
    server.rows.set(-3, { id: -3, user_id: 1, title: 'On this device', description: null, visibility: 'private', share_code: 'code', print_style: 'verses-first', created_at: server.stamp(), updated_at: server.stamp(), items: server.number(-3, [note('A')]) })
    const e = editor(-3)
    e.type('A', 'A1')
    await e.rest()
    e.type('A1', 'A12')
    await e.rest()
    expect([server.named, lines(-3), e.shown.changed]).toEqual([[['save', undefined], ['save', undefined]], ['A12'], false])
    e.close()
  })
  it('of a write of Ask’s is the one it read: changed from elsewhere between its reading and its save, the write is not made', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const e = editor(id)
    const plan = await planned(id)
    const save = hold('save')
    const writing = applyPlan(plan, ctx, 'once')
    await save.arrived
    elsewhere(id, ['A', 'B', 'From another device'])
    save.go()
    const out = await writing
    expect([error(out), applied(out), out.changes, lines(id)]).toEqual([expect.stringMatching(/has changed since this edit was worked out/), undefined, [], ['A', 'B', 'From another device']])
    // the editor has the jotting as it is now, and its next save is not behind
    expect([e.texts(), e.shown.held]).toEqual([['A', 'B', 'From another device'], false])
    e.type('A', 'A typed afterwards')
    await e.rest()
    expect([lines(id), e.shown.changed]).toEqual([['A typed afterwards', 'B', 'From another device'], false])
    e.close()
  })
  it('of Ask’s rename after its save is the stamp of that save', async () => {
    const id = seed('Prayer', ['A'])
    const loaded = at(id)
    const p = await planWrite('edit_jotting', { id, title: 'Asking', add: [{ line: { kind: 'note', text: 'From Ask' } }] }, ctx)
    if (!('plan' in p)) throw new Error('refused')
    expect(applied(await applyPlan(p.plan, ctx, 'once'))).toBe('at once')
    expect(server.named.length).toBe(2)
    expect([server.named[0], server.named[1][0], typeof server.named[1][1], server.named[1][1] !== loaded, server.rows.get(id)!.title, lines(id)]).toEqual([['save', loaded], 'patch', 'string', true, 'Asking', ['A', 'From Ask']])
    // one writer for the write, and another for the next
    expect([typeof server.writers[0], server.writers[0] === server.writers[1]]).toEqual(['string', true])
    expect(applied(await applyPlan(await planned(id, 'From Ask again'), ctx, 'once'))).toBe('at once')
    expect(server.writers[2]).not.toBe(server.writers[0])
  })
  // A save of the editor's own that reached the server is not a change from elsewhere, though its answer never came
  // and the editor still names the stamp of before it: the jotting's last save was this editor's.
  it('after a save of its own that was made and never answered, is the old one, and the save is made: the last to save was this editor', async () => {
    const id = seed('Prayer', ['A'])
    const loaded = at(id)
    const e = editor(id)
    server.lost.add('save')
    e.type('A', 'A typed on a poor connection')
    await e.saver.settle()
    // the words are on the server, and the editor was told the save failed
    expect([lines(id), e.shown.state, e.shown.changed]).toEqual([['A typed on a poor connection'], 'error', false])
    // its Retry
    await e.saver.settle()
    expect([server.named, e.shown.changed, e.shown.state, e.saver.locked, lines(id)]).toEqual([[['save', loaded], ['save', loaded]], false, 'saved', false, ['A typed on a poor connection']])
    // and it goes on from the stamp that save left
    const now = at(id)
    e.type('A typed on a poor connection', 'A typed afterwards')
    await e.rest()
    expect([server.named.at(-1), lines(id), e.shown.changed]).toEqual([['save', now], ['A typed afterwards'], false])
    e.close()
  })
  it('after a save of its own that was never answered, and a save from elsewhere since, is refused: the last to save was not this editor', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    server.lost.add('save')
    e.type('A', 'A typed on a poor connection')
    await e.saver.settle()
    elsewhere(id, ['A typed on a poor connection', 'From another editor'], 'another editor')
    await e.saver.settle()
    expect([lines(id), e.shown.changed, e.texts()]).toEqual([['A typed on a poor connection', 'From another editor'], true, ['A typed on a poor connection']])
    e.close()
  })
  // The save a closing page sends cannot wait for one on its way, so both name the same stamp. Both are this editor's.
  it('sent by a closing page while a save is on its way names the same stamp: both are made, and the jotting has the last words', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    const first = hold('save')
    e.type('A', 'A1')
    void e.saver.settle()
    await first.arrived
    const last = hold('save')
    e.type('A1', 'A1 and the last words before the page closed')
    e.unload()
    await last.arrived
    // the page is gone: nothing more of it runs, so the save its timer would have made next never reaches the server
    hold('save')
    first.go()
    await new Promise(r => setTimeout(r, 10))
    last.go()
    await new Promise(r => setTimeout(r, 10))
    expect([lines(id), server.named.map(n => n[1] === server.named[0][1]), server.writers[0] === server.writers[1]]).toEqual([['A1 and the last words before the page closed'], [true, true], true])
  })
  // What the rule does not cover, set down so that it is known: of two saves of one editor on their way at once, the
  // one that arrives second is made whichever it is. It was so before the stamp, and it is the price of the case above.
  it('of an editor’s own older save that arrives after its newer one does not stop it: the older words are the jotting’s, as they always were', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    const older = hold('save')
    e.type('A', 'A1')
    void e.saver.settle()
    await older.arrived
    e.type('A1', 'A1 and the last words before the page closed')
    e.unload()
    await new Promise(r => setTimeout(r, 10))
    expect(lines(id)).toEqual(['A1 and the last words before the page closed'])
    hold('save')
    older.go()
    await new Promise(r => setTimeout(r, 10))
    expect(lines(id)).toEqual(['A1'])
  })
  it('sent by a closing page from an editor that is behind is refused all the same', async () => {
    const id = seed('Prayer', ['A'])
    const e = editor(id)
    e.type('A', 'A1')
    await e.rest()
    elsewhere(id, ['A1', 'From another editor'], 'another editor')
    e.type('A1', 'A1 and the last words before the page closed')
    e.unload()
    await new Promise(r => setTimeout(r, 20))
    expect(lines(id)).toEqual(['A1', 'From another editor'])
  })
  // The reader leaves the editor with words still to be saved and opens it again before that save has landed. Loaded
  // at once, the new editor would have the jotting of before those words, under a name of its own: behind the editor
  // before it, and refused at its first save. So the screen waits for the saves of that jotting this app has on their
  // way, and then loads.
  describe('a new editor, opened while the closing save of the one before it is on its way', () => {
    /** The edit screen opening on a jotting: it waits for the saves on their way, then loads, and the editor mounts. */
    const reopen = async (id: number) => { if (savesPending(id)) await savesSettled(id, BOUND); return editor(id) }
    it('opens when that save has landed, on the last words, and its first save is made', async () => {
      const id = seed('Prayer', ['A'])
      const before = editor(id)
      const closing = hold('save')
      before.type('A', 'A and the last words before leaving')
      before.close()
      await closing.arrived
      let again: ReturnType<typeof editor> | null = null
      const opening = reopen(id).then(e => { again = e })
      await new Promise(r => setTimeout(r, 30))
      expect([again, savesPending(id), lines(id)]).toEqual([null, true, ['A']])
      closing.go()
      await opening
      expect([again!.texts(), savesPending(id)]).toEqual([['A and the last words before leaving'], false])
      again!.type('A and the last words before leaving', 'A, the last words, and more in the new editor')
      await again!.rest()
      expect([lines(id), again!.shown.changed, again!.shown.state]).toEqual([['A, the last words, and more in the new editor'], false, 'saved'])
      again!.close()
    })
    it('waits for a save that is waiting its turn behind another, too', async () => {
      const id = seed('Prayer', ['A'])
      const before = editor(id)
      const first = hold('save')
      before.type('A', 'A1')
      void before.saver.settle()
      await first.arrived
      before.type('A1', 'A1 and the last words before leaving')
      before.close()
      const opening = reopen(id)
      first.go()
      const again = await opening
      expect(again.texts()).toEqual(['A1 and the last words before leaving'])
      again.close()
    })
    it('does not wait when no save of that jotting is on its way: not for a save of another, nor for one that is over', async () => {
      const id = seed('Prayer', ['A']), other = seed('Grace', ['B'])
      const far = editor(other)
      const slow = hold('save')
      far.type('B', 'B1')
      far.close()
      await slow.arrived
      expect([savesPending(id), savesPending(other)]).toEqual([false, true])
      const e = await reopen(id)
      e.type('A', 'A1')
      await e.rest()
      expect([savesPending(id), lines(id)]).toEqual([false, ['A1']])
      slow.go()
      await new Promise(r => setTimeout(r, 10))
      expect(savesPending(other)).toBe(false)
      e.close()
    })
    it('waits no longer than the app gives a request: then it loads all the same, and the server’s rule decides', async () => {
      const id = seed('Prayer', ['A'])
      const before = editor(id)
      const closing = hold('save')
      before.type('A', 'A and the last words before leaving')
      before.close()
      await closing.arrived
      vi.useFakeTimers()
      try {
        let again: ReturnType<typeof editor> | null = null
        void reopen(id).then(e => { again = e })
        await vi.advanceTimersByTimeAsync(BOUND - 1_000)
        expect(again).toBeNull()
        await vi.advanceTimersByTimeAsync(1_500)
        // loaded without those words, which have still not landed
        expect([again!.texts(), lines(id)]).toEqual([['A'], ['A']])
        // they land at last: the new editor is behind them, and its save is refused rather than made over them
        closing.go()
        await vi.advanceTimersByTimeAsync(50)
        again!.type('A', 'A typed in the new editor')
        await again!.saver.settle()
        expect([lines(id), again!.shown.changed]).toEqual([['A and the last words before leaving'], true])
        again!.close()
      } finally { vi.useRealTimers() }
    })
  })
  it('of an Undo is the one it read: changed from elsewhere between its reading and its save, nothing is undone', async () => {
    const id = seed('Prayer', ['A', 'B'])
    const out = await applyPlan(await planned(id), ctx, 'once')
    const save = hold('save')
    const undoing = undoJotting(out.changes[0].undo as never, ctx)
    await save.arrived
    elsewhere(id, ['A', 'B', 'From Ask', 'From another device'])
    save.go()
    expect([(await undoing).did, lines(id)]).toEqual(['changed', ['A', 'B', 'From Ask', 'From another device']])
  })
})
