// A jotting begun signed out is kept on the device under a negative id, and sign-in's merge moves it to the account
// under an id of the server's (client/src/lib/localLibrary.ts `mergeLocalLibrary`). It is not moved under an editor:
// while an editor of it is mounted, or a save of it to the device's copy is on its way, the merge leaves it where it
// is, an ordinary jotting of the device, and moves it when the last editor has gone and its saves have settled. Until
// then it is not on the account, so nothing there can be written beside it. Here the device's storage and the server
// are stand-ins; the local library, the library's door to the routes, the registry of editors and the editor's saver
// are the app's.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Outline, OutlineItem } from '../shared/types'

type Body = { items?: Partial<OutlineItem>[]; title?: string; if_updated?: string; writer?: string } | undefined
type Row = Outline & { last_writer: string | null }

const device = vi.hoisted(() => ({
  store: new Map<string, string>(),
  /** The next write to the device's storage waits for this. */
  gate: null as Promise<void> | null,
  /** The next write to the device's storage that would take a jotting off it fails. */
  failDrop: false,
}))
vi.mock('../client/node_modules/@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => device.store.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      const g = device.gate
      device.gate = null
      if (g) await g
      const kept = (t: string) => (t.match(/"id":-\d+,"user_id"/g) ?? []).length
      if (device.failDrop && k === 'berean_local_outlines' && kept(v) < kept(device.store.get(k) ?? '')) { device.failDrop = false; throw new Error('the device could not write') }
      device.store.set(k, v)
    },
  },
}))
vi.mock('../client/src/lib/highlights', () => ({ adoptLocalHighlights: vi.fn(), localHighlightChapters: async () => [] }))

const server = vi.hoisted(() => {
  class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
  const s = {
    ApiError,
    token: null as string | null,
    /** The reader each session is of. */
    who: new Map<string, number>([['a session', 1]]),
    rows: new Map<number, Row>(), next: 100, item: 1000, clock: 0,
    /** Every request, as it came. */
    log: [] as { method: string; path: string; body: Body; token: string | null }[],
    /** The next save of lines is made and answered with nothing, as a server from before the fields might. */
    bare: false,
    /** The next making of a jotting waits here: `arrived` when it has come, and it goes on when `go` is called. */
    making: null as null | { arrived: () => void; go: Promise<void> },
    /** And the next save of lines, likewise, before it is made. */
    putting: null as null | { arrived: () => void; go: Promise<void> },
    /** While this is set, the making of a jotting fails, as with no connection. */
    offline: false,
    /** The making of a jotting that is waiting (`making`) fails when it is let go, as when the connection drops. */
    dropped: false,
    stamp: () => `2026-11-16T12:${String(Math.floor(s.clock / 60)).padStart(2, '0')}:${String(s.clock++ % 60).padStart(2, '0')}Z`,
    /** The rule of rs/src/outlines.rs: a save that names a stamp is made when it is the row's, or when the row's
     *  last save was this writer's; every save leaves its writer, or none. */
    save(o: Row, body: Body) {
      if (body?.if_updated !== undefined && body.if_updated !== o.updated_at && !(body.writer !== undefined && body.writer === o.last_writer)) throw new ApiError(409, 'changed since')
      o.last_writer = body?.writer ?? null
      o.updated_at = s.stamp()
    },
    async api(path: string, init: { method?: string; json?: unknown } = {}): Promise<unknown> {
      const method = (init.method ?? 'GET').toUpperCase(), body = init.json as Body
      s.log.push({ method, path, body, token: s.token })
      // as the server answers: nobody signed in is refused, and a jotting is there only for the reader whose it is
      // (the reader of the session the request was sent in, however long it is held here)
      const me = s.who.get(s.token ?? '')
      if (me === undefined) throw new ApiError(401, 'sign in')
      if (path === '/bookmarks') return []
      if (path === '/outlines' && method === 'GET') return [...s.rows.values()].filter(o => o.user_id === me).map(o => structuredClone(o))
      if (path === '/outlines' && method === 'POST') {
        if (s.offline) throw new Error('no connection')
        const m = s.making
        if (m) { s.making = null; m.arrived(); await m.go; if (s.dropped) { s.dropped = false; throw new Error('no connection') } }
        const id = s.next++
        const o: Row = { id, user_id: me, title: body?.title ?? '', description: null, visibility: 'private', share_code: 'code', print_style: 'verses-first', forked_from: null, created_at: s.stamp(), updated_at: s.stamp(), owner_handle: 'reader', items: [], last_writer: null } as unknown as Row
        s.rows.set(id, o)
        return structuredClone(o)
      }
      const lines = /^\/outlines\/(\d+)\/items$/.exec(path), one = /^\/outlines\/(\d+)$/.exec(path)
      const o = s.rows.get(Number((lines ?? one)?.[1]))
      if (!o || o.user_id !== me) throw new ApiError(404, 'not found')
      if (lines && method === 'PUT') {
        const p = s.putting
        if (p) { s.putting = null; p.arrived(); await p.go }
        s.save(o, body)
        o.items = (body?.items ?? []).map((it, k) => ({ book: null, chapter: null, v1: null, v2: null, text: null, url: null, depth: 0, ...it, id: s.item++, outline_id: o.id, position: k })) as OutlineItem[]
        if (s.bare) { s.bare = false; return {} }
        return structuredClone(o)
      }
      if (one && method === 'PATCH') { s.save(o, body); if (body?.title) o.title = body.title; return structuredClone(o) }
      if (one && method === 'DELETE') { s.rows.delete(o.id); return { ok: true } }
      if (one && method === 'GET') return structuredClone(o)
      throw new ApiError(404, 'not found')
    },
  }
  return s
})
vi.mock('../client/src/lib/api', () => ({
  ApiError: server.ApiError,
  DEFAULT_TIMEOUT_MS: 15_000,
  getToken: () => server.token,
  api: (path: string, init?: { method?: string; json?: unknown }) => server.api(path, init),
  get: (path: string) => server.api(path),
  post: (path: string, json?: unknown) => server.api(path, { method: 'POST', json }),
  put: (path: string, json?: unknown) => server.api(path, { method: 'PUT', json }),
  del: (path: string) => server.api(path, { method: 'DELETE' }),
}))

// `moveFreedOutline`: the move of one jotting that has become free (the merge hook calls it at the registry's word)
const { mergeLocalLibrary, movedTo, moveFreedOutline } = await import('../client/src/lib/localLibrary')
const { createOutline, deleteOutline, getOwnOutline, listOutlines, saveOutlineItems, patchOutline } = await import('../client/src/lib/library')
const { OutlineSaver, metaOf } = await import('../client/src/lib/outlineSaver')
// `outlineOpening`: a screen's claim on a jotting, from before it reads it for an editor: what the edit screen makes
// first of all. The function returned gives it up.
const { editorOpened, holdEditor, settleEditors, onOutlineFree, outlineOpening } = await import('../client/src/lib/outlineEditors')
/** As the app's merge hook does (client/src/hooks/useLocalLibraryMerge.ts): when a jotting of the device has no editor
 *  left, no screen opening it and no save on its way, and the reader is signed in, that jotting is moved. */
const reruns: Promise<unknown>[] = []
const freed: number[] = []
onOutlineFree(id => {
  freed.push(id)
  if (id < 0 && server.token) reruns.push(moveFreedOutline(id).catch(() => {}))
})
/** Every move the app has to make is made. */
const moves = async () => { for (let k = 0; k < 4; k++) { await new Promise(r => setTimeout(r, 15)); await Promise.all(reruns) } }

const note = (text: string) => ({ kind: 'note' as const, book: null, chapter: null, v1: null, v2: null, text, url: null, depth: 0 })
const lines = (id: number) => (server.rows.get(id)?.items ?? []).map(i => i.text)
/** The saves of lines and of titles the server has been sent, from the `from`th request on. */
const saves = (from = 0) => server.log.slice(from).filter(q => q.method === 'PUT' || q.method === 'PATCH')

/** The editor open on a jotting as its screen loaded it: what the screen is told, and the reader's hands on it. */
function editor(o: Outline) {
  const shown = { state: 'saved', held: false, stale: 0, changed: false }
  const saver = new OutlineSaver(o.id, o.items ?? [], metaOf(o), o.updated_at, {
    state: s => { shown.state = s },
    held: h => { shown.held = h },
    stale: () => { shown.stale++ },
    changed: () => { shown.changed = true },
    holding: () => {},
    took: () => {},
  }, 5)
  const gone = editorOpened(o.id, saver)
  return {
    saver, shown,
    texts: () => saver.latest.items.map(i => i.text),
    type: (was: string, now: string) => { if (saver.locked) return; saver.latest.items = saver.latest.items.map(i => (i.text === was ? { ...i, text: now } : i)); saver.touch('items') },
    rest: async () => { for (let k = 0; k < 6; k++) { await saver.settle(); await new Promise(r => setTimeout(r, 12)) } },
    close: () => { gone(); saver.close() },
  }
}
/** Signed out, a jotting is begun on this device with one note, and opened in the editor. */
async function begun(text = 'A') {
  server.token = null
  const made = await createOutline({ title: 'Begun on this device' })
  await saveOutlineItems(made.id, [note(text)])
  return { local: made.id, e: editor(await getOwnOutline(made.id)) }
}
/** The reader signs in, and the merge is run, as at every sign-in. Another `session` is another sign-in, and with
 *  another `uid` another reader's. */
async function signIn(session = 'a session', uid = 1) {
  server.who.set(session, uid)
  server.token = session
  return mergeLocalLibrary(uid)
}
/** A jotting begun on this device, its editor left, and the reader signed in: the id it has on the account. */
async function moved(text = 'A'): Promise<{ local: number; sid: number }> {
  const { local, e } = await begun(text)
  e.close()
  await signIn()
  await moves()
  return { local, sid: movedTo(local)! }
}
const texts = async (id: number) => ((await getOwnOutline(id)).items ?? []).map(i => i.text)

beforeEach(() => { device.store.clear(); device.gate = null; device.failDrop = false; server.rows.clear(); server.log.length = 0; server.token = null; server.bare = false; server.making = null; server.putting = null; server.offline = false; server.dropped = false; reruns.length = 0; freed.length = 0 })

describe('a jotting of this device with its editor open when the reader signs in', () => {
  it('is left on the device: its editor goes on as before, saving to the device, and the reader finds it in the list, once', async () => {
    const { local, e } = await begun()
    e.type('A', 'A typed before signing in')
    const r = await signIn()
    expect([r.outlines, movedTo(local), server.rows.size, e.saver.locked, e.shown.stale, e.shown.changed]).toEqual([0, undefined, 0, false, 0, false])
    e.type('A typed before signing in', 'A typed before signing in, and on')
    await e.rest()
    // saved, on the device, with nothing sent anywhere
    expect([await texts(local), server.log.filter(q => q.method !== 'GET').length, e.shown.state]).toEqual([['A typed before signing in, and on'], 0, 'saved'])
    expect((await listOutlines()).map(o => [o.id, o.title])).toEqual([[local, 'Begun on this device']])
    e.close()
    await moves()
  })
  it('moves when its editor has gone and its last save has landed, with every word typed before, while and after signing in', async () => {
    const { local, e } = await begun()
    e.type('A', 'A before')
    await signIn()
    e.type('A before', 'A before, while')
    await e.rest()
    e.type('A before, while', 'A before, while, and after signing in')
    // not yet saved when the reader leaves the editor
    e.close()
    await moves()
    const sid = movedTo(local)!
    expect([sid > 0, lines(sid)]).toEqual([true, ['A before, while, and after signing in']])
    // it is the account's now, and in the list once
    expect((await listOutlines()).map(o => [o.id, o.title])).toEqual([[sid, 'Begun on this device']])
    expect(device.store.get('berean_local_outlines')).toContain('"rows":[]')
  })
  it('with two editors of it mounted, moves when the last has gone', async () => {
    const { local, e } = await begun()
    const second = editor(await getOwnOutline(local))
    await signIn()
    e.close()
    await moves()
    expect(movedTo(local)).toBeUndefined()
    second.type('A', 'A from the editor that stayed')
    second.close()
    await moves()
    expect(lines(movedTo(local)!)).toEqual(['A from the editor that stayed'])
  })
  it('is moved in the same run as another of the device’s that has no editor, which does not wait for it', async () => {
    const { local, e } = await begun('A')
    const other = await createOutline({ title: 'Another, with no editor open' })
    await saveOutlineItems(other.id, [note('B')])
    const r = await signIn()
    expect([r.outlines, movedTo(local), lines(movedTo(other.id)!)]).toEqual([1, undefined, ['B']])
    e.close()
    await moves()
    expect(lines(movedTo(local)!)).toEqual(['A'])
  })
})

describe('a jotting of this device with a save to the device’s copy on its way when the merge runs', () => {
  it('is left until that save has landed, and then moves with its words', async () => {
    const { local, e } = await begun()
    let land!: () => void
    device.gate = new Promise<void>(r => { land = r })
    e.type('A', 'A, and the last words before the editor was left')
    e.close()
    const r = await signIn()
    expect([r.outlines, movedTo(local), server.rows.size]).toEqual([0, undefined, 0])
    land()
    await moves()
    expect(lines(movedTo(local)!)).toEqual(['A, and the last words before the editor was left'])
  })
  it('is not moved at all while that save has not landed, however long: the merge does not wait for it, and nothing is lost that was kept', async () => {
    const { local, e } = await begun()
    let land!: () => void
    device.gate = new Promise<void>(r => { land = r })
    e.type('A', 'A, and words that are a long time on their way')
    e.close()
    vi.useFakeTimers()
    try {
      const r = await signIn()
      // far longer than any wait the app has
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect([r.outlines, movedTo(local), server.rows.size]).toEqual([0, undefined, 0])
      expect(device.store.get('berean_local_outlines')).toContain('"text":"A"')
    } finally { vi.useRealTimers() }
    // (the device's storage is given back to the tests that follow)
    land()
    await moves()
    expect(lines(movedTo(local)!)).toEqual(['A, and words that are a long time on their way'])
  })
})

describe('the registry’s word that a jotting is free', () => {
  it('is given when its last editor has gone and no save of it is on its way, and not before', async () => {
    expect(typeof onOutlineFree).toBe('function')
    const { local, e } = await begun()
    const second = editor(await getOwnOutline(local))
    e.close()
    await new Promise(r => setTimeout(r, 15))
    expect(freed).toEqual([])
    let land!: () => void
    device.gate = new Promise<void>(r => { land = r })
    second.type('A', 'A1')
    second.close()
    await new Promise(r => setTimeout(r, 15))
    expect(freed).toEqual([])
    land()
    await new Promise(r => setTimeout(r, 15))
    expect(freed).toEqual([local])
    await deleteOutline(local)
  })
})

// A jotting is free when the merge begins to upload it, and in that moment something reaches for it: the reader opens
// it, or saves to it from elsewhere, or deletes it. It is still not moved under an editor, and nothing saved to the
// device's copy is left behind.
describe('a jotting of the device that the merge is uploading', () => {
  /** The merge is run and stopped where it is making the account's copy (`POST`) or putting its lines (`PUT`). */
  const stoppedAt = async (step: 'making' | 'putting') => {
    let arrived!: () => void, go!: () => void
    const there = new Promise<void>(r => { arrived = r })
    server[step] = { arrived, go: new Promise<void>(r => { go = r }) }
    const signing = signIn()
    await there
    return { go, signing }
  }
  it('with an editor opened on it all the same before its copy is dropped, is not moved: the account’s copy just made is taken away, and it moves when that editor has gone, with its words', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    const { go, signing } = await stoppedAt('putting')
    const late = editor(await getOwnOutline(local))
    go()
    const r = await signing
    // the device's still, with no copy left on the account, and its editor an ordinary editor of the device's copy
    expect([r.outlines, movedTo(local), server.rows.size, (await listOutlines()).map(o => o.id)]).toEqual([0, undefined, 0, [local]])
    late.type('A', 'A typed in the editor that opened in that moment')
    await late.rest()
    expect([late.shown.changed, late.shown.state, await texts(local)]).toEqual([false, 'saved', ['A typed in the editor that opened in that moment']])
    late.close()
    await moves()
    expect([lines(movedTo(local)!), server.rows.size]).toEqual([['A typed in the editor that opened in that moment'], 1])
  })
  it('saved to meanwhile, with no editor left on it (the reader’s sheet, an editor opened and closed): what was saved is uploaded too, lines and title', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    const { go, signing } = await stoppedAt('putting')
    await saveOutlineItems(local, [note('A'), note('A verse added while the copy was being uploaded')])
    await patchOutline(local, { title: 'Begun on this device, and retitled meanwhile' })
    go()
    await signing
    const sid = movedTo(local)!
    expect([lines(sid), server.rows.get(sid)!.title, device.store.get('berean_local_outlines')]).toEqual([['A', 'A verse added while the copy was being uploaded'], 'Begun on this device, and retitled meanwhile', expect.stringContaining('"rows":[]')])
  })
  it('retitled while the account’s copy was being made, before its lines were read: the account has the title', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    const { go, signing } = await stoppedAt('making')
    await patchOutline(local, { title: 'Retitled while the copy was being made' })
    go()
    await signing
    expect(server.rows.get(movedTo(local)!)!.title).toBe('Retitled while the copy was being made')
  })
  it('deleted by the reader meanwhile is not moved, and not left on the account either', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    const { go, signing } = await stoppedAt('putting')
    await deleteOutline(local)
    go()
    const r = await signing
    expect([r.outlines, movedTo(local), server.rows.size, await listOutlines()]).toEqual([0, undefined, 0, []])
  })
  it('that cannot be uploaded (no connection) is tried once, not again and again: the upload’s end is not the word that a jotting is free', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    server.offline = true
    server.log.length = 0
    await signIn().catch(() => {})
    await moves()
    await moves()
    expect([server.log.filter(q => q.method === 'POST').length, movedTo(local), freed]).toEqual([1, undefined, [local]])
    server.offline = false
    await signIn()
    expect(lines(movedTo(local)!)).toEqual(['A'])
  })
  it('whose new copy on the account someone else saves to while it is being uploaded: that save is not written over, the copy is theirs, and the device’s jotting is moved as one of its own', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    const { go, signing } = await stoppedAt('putting')
    const [theirs] = [...server.rows.values()]
    // the copy is a moment old, and already a jotting of the account's that another device, or Ask, can write to
    await server.api(`/outlines/${theirs.id}/items`, { method: 'PUT', json: { items: [note('Written to the new copy from somewhere else')], if_updated: theirs.updated_at, writer: 'someone-else-0123456789abcdef' } })
    go()
    const r = await signing
    // their save stands on the copy, which the upload's own save did not go over (it was refused, and sent nothing more)
    expect([r.outlines, movedTo(local), lines(theirs.id), server.log.filter(q => q.method === 'DELETE').length]).toEqual([0, undefined, ['Written to the new copy from somewhere else'], 0])
    // and the device's jotting is moved by the next run as one of its own
    await signIn()
    await moves()
    const sid = movedTo(local)!
    expect([sid !== theirs.id, lines(sid), lines(theirs.id), server.rows.size]).toEqual([true, ['A'], ['Written to the new copy from somewhere else'], 2])
  })
  it('given up with someone else’s save on its new copy: the copy is not taken away', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    const { go, signing } = await stoppedAt('putting')
    const late = editor(await getOwnOutline(local))
    // the lines are put, the drop finds the editor, and before the move is given up someone else saves to the copy
    let land!: () => void
    device.gate = new Promise<void>(r => { land = r })
    go()
    await new Promise(r => setTimeout(r, 20))
    const [theirs] = [...server.rows.values()]
    await server.api(`/outlines/${theirs.id}`, { method: 'PATCH', json: { title: 'Retitled from somewhere else', if_updated: theirs.updated_at, writer: 'someone-else-0123456789abcdef' } })
    land()
    const r = await signing
    expect([r.outlines, movedTo(local), server.rows.get(theirs.id)?.title, server.log.filter(q => q.method === 'DELETE').length]).toEqual([0, undefined, 'Retitled from somewhere else', 0])
    // the device's jotting is the device's still, and moves when its editor has gone, as one of its own
    late.close()
    await moves()
    expect([movedTo(local) !== theirs.id, lines(movedTo(local)!), server.rows.size]).toEqual([true, ['A'], 2])
  })
  it('given up because an editor had opened on it, whose editor is closed while the giving up is still on its way: it is moved all the same, without waiting for another launch', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    const { go, signing } = await stoppedAt('putting')
    const late = editor(await getOwnOutline(local))
    // the drop finds the editor; the move is given up, which takes a moment (the copy is read, and taken away)
    let land!: () => void
    device.gate = new Promise<void>(r => { land = r })
    go()
    await new Promise(r => setTimeout(r, 20))
    late.type('A', 'A typed in the editor that opened in that moment')
    late.close()
    land()
    await signing
    await moves()
    expect([lines(movedTo(local)!), server.rows.size]).toEqual([['A typed in the editor that opened in that moment'], 1])
  })
  it('deleted by the reader in the very moment its copy is dropped: the jotting it has just become on the account is deleted', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    const { go, signing } = await stoppedAt('putting')
    // the drop is entered, and the reader's delete comes behind it in the storage's queue
    let land!: () => void
    device.gate = new Promise<void>(r => { land = r })
    go()
    await new Promise(r => setTimeout(r, 20))
    const deleting = deleteOutline(local)
    land()
    await signing
    await deleting
    expect([server.rows.size, await listOutlines()]).toEqual([0, []])
  })
  it('left on the device by a run that could not drop it is, as it always was, a jotting of the device with a copy on the account: deleting the device’s leaves the account’s', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    device.failDrop = true
    await signIn().catch(() => {})
    expect([movedTo(local), server.rows.size]).toEqual([undefined, 1])
    await deleteOutline(local)
    expect([server.rows.size, (await listOutlines()).length]).toEqual([1, 1])
  })
  it('left on the device by a run that could not drop it, whose copy on the account has gone since, is uploaded as new', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    device.failDrop = true
    await signIn().catch(() => {})
    const [left] = [...server.rows.keys()]
    server.rows.delete(left)
    await signIn().catch(() => {})
    await signIn()
    await moves()
    const sid = movedTo(local)!
    expect([sid !== left, lines(sid), server.rows.size]).toEqual([true, ['A'], 1])
  })
  it('whose copy could not be dropped after its upload, and was emptied since, is emptied on the account by the next run', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    device.failDrop = true
    await signIn().catch(() => {})
    // on the account, with its line, and on the device still
    expect([movedTo(local), [...server.rows.values()].map(o => o.items?.length)]).toEqual([undefined, [1]])
    await saveOutlineItems(local, [])
    await signIn()
    await moves()
    expect([lines(movedTo(local)!), server.rows.size]).toEqual([[], 1])
  })
})

// A jotting was in an editor's hands when the merge began, so the run passed it by; the reader leaves the editor
// while the run is still on its way with the others. The move it is owed is its own: it does not depend on how that
// run ends, and it is one move, tried once.
describe('a jotting that becomes free while a merge is on its way with others', () => {
  const posts = () => server.log.filter(q => q.method === 'POST').length
  it('is moved in its turn though that run then fails: what it is owed is not thrown away with the run', async () => {
    const { local, e } = await begun('A')
    const other = await createOutline({ title: 'Another, uploading when the connection drops' })
    await saveOutlineItems(other.id, [note('B')])
    let arrived!: () => void, go!: () => void
    const there = new Promise<void>(r => { arrived = r })
    server.making = { arrived, go: new Promise<void>(r => { go = r }) }
    const signing = signIn().then(() => 'moved', () => 'failed')
    await there
    // the run has passed the first by and is making the other's copy: the reader leaves the editor of the first
    e.type('A', 'A, and the words typed before the editor was left')
    e.close()
    await new Promise(r => setTimeout(r, 20))
    server.dropped = true
    go()
    expect(await signing).toBe('failed')
    await moves()
    expect([lines(movedTo(local)!), movedTo(other.id)]).toEqual([['A, and the words typed before the editor was left'], undefined])
    // one move of the one that became free, and no more: the other waits for the next sign-in or launch, as it did
    await moves()
    expect(posts()).toBe(2)
    await signIn()
    expect(lines(movedTo(other.id)!)).toEqual(['B'])
  })
  it('and cannot be uploaded itself is tried once at that word, not again', async () => {
    const { local, e } = await begun()
    await signIn()
    server.offline = true
    e.close()
    await moves()
    await moves()
    expect([posts(), movedTo(local), freed]).toEqual([1, undefined, [local]])
    server.offline = false
    await signIn()
    expect(lines(movedTo(local)!)).toEqual(['A'])
  })
  // The screen goes: its editor's cleanup and its own run in the same moment, and each gives up a hold on the
  // jotting. That is one leaving, and one word that the jotting is free.
  it('left by a screen whose editor had nothing to save is free once, not once for the editor and once for the screen: one move is tried', async () => {
    server.token = null
    const made = await createOutline({ title: 'Opened and left' })
    await saveOutlineItems(made.id, [note('A')])
    const giveUp = outlineOpening(made.id)
    const e = editor(await getOwnOutline(made.id))
    await signIn()
    server.offline = true
    e.close()
    giveUp()
    await moves()
    await moves()
    expect([posts(), movedTo(made.id), freed]).toEqual([1, undefined, [made.id]])
    server.offline = false
    await signIn()
    expect(lines(movedTo(made.id)!)).toEqual(['A'])
  })
  // The word that it is free came while the reader was signed in, and its move waits its turn behind the run. Whether
  // there is an account to move it to is asked when the turn comes, not when the word came.
  it('whose turn comes after the reader has signed out is not moved and nothing is sent for it: it is the device’s, and moves at the next sign-in', async () => {
    const { local, e } = await begun('A')
    const other = await createOutline({ title: 'Another, uploading when the reader signs out' })
    await saveOutlineItems(other.id, [note('B')])
    let arrived!: () => void, go!: () => void
    const there = new Promise<void>(r => { arrived = r })
    server.making = { arrived, go: new Promise<void>(r => { go = r }) }
    const signing = signIn().then(() => 'moved', () => 'failed')
    await there
    e.close()
    await new Promise(r => setTimeout(r, 20))
    // the reader signs out, and the run's request fails, as a request without a session does
    server.token = null
    server.dropped = true
    go()
    expect(await signing).toBe('failed')
    const from = server.log.length
    await moves()
    expect([server.log.slice(from).map(q => `${q.method} ${q.path}`), movedTo(local), await texts(local)]).toEqual([[], undefined, ['A']])
    await signIn()
    await moves()
    expect(lines(movedTo(local)!)).toEqual(['A'])
  })
})

// A whole run reads the device's jottings once, as it begins. One asked for while a run is on its way is not that run:
// it is a run that begins after it was asked for, once, however the first ends. And a run is of the session it began
// in: when that has ended it sends nothing more and takes nothing more off the device.
describe('a sign-in that comes while an earlier run is still on its way', () => {
  it('is followed by a run of its own: a jotting the earlier run had passed by, freed while the reader was signed out, is moved', async () => {
    const { local, e } = await begun('A')
    const other = await createOutline({ title: 'Another, still uploading' })
    await saveOutlineItems(other.id, [note('B')])
    let arrived!: () => void, go!: () => void
    const there = new Promise<void>(r => { arrived = r })
    server.making = { arrived, go: new Promise<void>(r => { go = r }) }
    const first = signIn().then(() => 'moved', () => 'ended')
    await there
    // the run has passed the first by (its editor) and is making the other's copy: the reader signs out, leaves the
    // editor (signed out: nothing is asked for, there is no account to move it to), and signs in again
    server.token = null
    e.close()
    await new Promise(r => setTimeout(r, 20))
    expect(reruns).toEqual([])
    const second = signIn('a later session')
    go()
    await first
    await second
    await moves()
    expect([lines(movedTo(local)!), lines(movedTo(other.id)!)]).toEqual([['A'], ['B']])
    // each once on the account: the copy the first run had made of the other is the one the second took up
    expect(server.rows.size).toBe(2)
  })
  it('is not given the run of before, and the same sign-in asked twice is one run', async () => {
    const { local, e } = await begun('A')
    e.close()
    await moves()
    let arrived!: () => void, go!: () => void
    const there = new Promise<void>(r => { arrived = r })
    server.making = { arrived, go: new Promise<void>(r => { go = r }) }
    server.token = 'a session'
    const first = mergeLocalLibrary(1)
    await there
    // asked for twice more while the first is on its way: one run after it, for both
    const [second, third] = [mergeLocalLibrary(1), mergeLocalLibrary(1)]
    const same = [second === first, third === second]
    go()
    await Promise.all([first, second, third])
    expect(same).toEqual([false, true])
    expect([lines(movedTo(local)!), server.log.filter(q => q.method === 'POST').length]).toEqual([['A'], 1])
  })
  it('as another reader: the run of the reader before sends nothing more and takes nothing more off the device, and the other reader’s run is their own, after it', async () => {
    const { local, e } = await begun('A')
    e.close()
    await moves()
    const other = await createOutline({ title: 'Another of the device’s' })
    await saveOutlineItems(other.id, [note('B')])
    let arrived!: () => void, go!: () => void
    const there = new Promise<void>(r => { arrived = r })
    server.putting = { arrived, go: new Promise<void>(r => { go = r }) }
    const first = signIn('the first reader’s session', 1).then(() => 'moved', () => 'ended')
    await there
    // the first reader's run has made its copy of the first jotting and is saving its lines to it: they sign out, and
    // another reader signs in on this device
    server.token = null
    const sent = server.log.length
    const second = signIn('another reader’s session', 2)
    go()
    expect(await first).toBe('ended')
    await second
    await moves()
    // nothing was sent for the first reader's run once they had signed out, and nothing under the other's session
    // was of that run: the first jotting is still the device's, not recorded as moved to a jotting the other reader
    // cannot read
    const firsts = [...server.rows.values()].filter(o => o.user_id === 1)
    expect(firsts.map(o => (o.items ?? []).map(i => i.text))).toEqual([['A']])
    expect(server.log.slice(sent).every(q => q.token === 'another reader’s session')).toBe(true)
    // the other reader's own run moved both, in that one run (nothing else asks for a run while they stay signed in):
    // the second jotting, and the first, whose copy on the first reader's account is no jotting of theirs, so it is
    // uploaded as new for them
    expect(lines(movedTo(other.id)!)).toEqual(['B'])
    const theirs = server.rows.get(movedTo(local) ?? 0)
    expect([theirs?.user_id, (theirs?.items ?? []).map(i => i.text), [...server.rows.values()].filter(o => o.user_id === 2).length]).toEqual([2, ['A'], 2])
  })
})

// The edit screen reads a jotting, and only then mounts its editor. Its claim on the jotting begins before the read:
// from then on the jotting is in its hands as much as if the editor were mounted.
describe('a screen that is opening a jotting of the device for its editor', () => {
  it('has the jotting from before it reads it: the merge passes it by, though no editor is mounted yet', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    const giveUp = outlineOpening(local)
    const r = await signIn()
    expect([r.outlines, movedTo(local), server.rows.size]).toEqual([0, undefined, 0])
    // it reads, and its editor mounts: the device's, saving to the device
    const mounted = editor(await getOwnOutline(local))
    mounted.type('A', 'A typed in the editor the screen went on to mount')
    await mounted.rest()
    expect([mounted.shown.changed, await texts(local), server.rows.size]).toEqual([false, ['A typed in the editor the screen went on to mount'], 0])
    // the screen goes: its editor first, and its claim with it
    mounted.close()
    giveUp()
    await moves()
    expect(lines(movedTo(local)!)).toEqual(['A typed in the editor the screen went on to mount'])
  })
  it('that claims it while its upload is on its way, before any editor is mounted: the upload gives the move up at its drop', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    let arrived!: () => void, go!: () => void
    const there = new Promise<void>(r => { arrived = r })
    server.putting = { arrived, go: new Promise<void>(r => { go = r }) }
    const signing = signIn()
    await there
    const giveUp = outlineOpening(local)
    go()
    const r = await signing
    // not moved, and nothing of the move left on the account; the screen reads the device's copy and mounts its editor
    expect([r.outlines, movedTo(local), server.rows.size]).toEqual([0, undefined, 0])
    const loaded = await getOwnOutline(local)
    expect(loaded.id).toBe(local)
    const mounted = editor(loaded)
    mounted.type('A', 'A typed in the editor that opened while the upload was on its way')
    await mounted.rest()
    expect([mounted.shown.changed, mounted.shown.state]).toEqual([false, 'saved'])
    mounted.close()
    giveUp()
    await moves()
    expect(lines(movedTo(local)!)).toEqual(['A typed in the editor that opened while the upload was on its way'])
  })
  it('that reads it in the very moment its copy is being dropped is given the account’s jotting: not the copy that is going, and not word that there is none', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    let arrived!: () => void, go!: () => void
    const there = new Promise<void>(r => { arrived = r })
    server.putting = { arrived, go: new Promise<void>(r => { go = r }) }
    const signing = signIn()
    await there
    // the lines are put, and the drop has been decided and is being written to the device's storage
    let land!: () => void
    device.gate = new Promise<void>(r => { land = r })
    go()
    await new Promise(r => setTimeout(r, 20))
    const giveUp = outlineOpening(local)
    let read: Outline | 'not on this device' | null = null
    void getOwnOutline(local).then(o => { read = o }, () => { read = 'not on this device' })
    await new Promise(r => setTimeout(r, 20))
    land()
    await signing
    await new Promise(r => setTimeout(r, 20))
    const sid = movedTo(local)!
    expect([sid > 0, (read as Outline | null)?.id]).toEqual([true, sid])
    // the editor that mounts on it is the account's jotting's, and what is typed there is saved
    const mounted = editor(read as unknown as Outline)
    mounted.type('A', 'A typed in the editor of the account’s jotting')
    await mounted.rest()
    expect([lines(sid), mounted.shown.changed]).toEqual([['A typed in the editor of the account’s jotting'], false])
    mounted.close()
    giveUp()
  })
  // What is not an editor saves whole lists too (verses added from the reader's sheet, the tour, a restore), and names
  // nothing. Its lines were worked out from the device's copy as it read it. If that copy has gone to the account by
  // the time the save's turn comes, those lines are of a copy that is no more: they are not sent to the account over
  // whatever the jotting had become. The save fails, as it did before a jotting could move beneath one, and the
  // reader is told.
  it('is not alone in reaching for it: a save from what is not an editor, worked out from the copy as it was read earlier and on its way when the copy is dropped, is not sent to the account over what the jotting had become', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    // the sheet reads the jotting, [A]; then the jotting gains a line from elsewhere, and is uploaded with it
    const read = await getOwnOutline(local)
    await saveOutlineItems(local, [note('A'), note('C')])
    let arrived!: () => void, go!: () => void
    const there = new Promise<void>(r => { arrived = r })
    server.putting = { arrived, go: new Promise<void>(r => { go = r }) }
    const signing = signIn()
    await there
    let land!: () => void
    device.gate = new Promise<void>(r => { land = r })
    go()
    await new Promise(r => setTimeout(r, 20))
    // the drop is being written; the sheet saves the lines it read, with a verse added, and a title is set likewise
    const sent = server.log.length
    const adding = saveOutlineItems(local, [...(read.items ?? []).map(i => note(i.text ?? '')), note('A verse added from the reader')]).then(() => 'saved', (err: Error) => err.message)
    const naming = patchOutline(local, { title: 'A title set from what is not an editor' }).then(() => 'saved', (err: Error) => err.message)
    land()
    await signing
    // (told by the brand's word for it)
    expect([await adding, await naming]).toEqual([expect.stringMatching(/ is no longer on this device$/), expect.stringMatching(/ is no longer on this device$/)])
    const sid = movedTo(local)!
    expect([lines(sid), server.rows.get(sid)!.title, server.log.slice(sent).map(q => `${q.method} ${q.path}`)]).toEqual([['A', 'C'], 'Begun on this device', []])
    // asked again, it is the account's jotting that is read and added to
    const again = await getOwnOutline(local)
    await saveOutlineItems(local, [...(again.items ?? []).map(i => note(i.text ?? '')), note('A verse added from the reader')])
    expect(lines(sid)).toEqual(['A', 'C', 'A verse added from the reader'])
  })
  it('that gives it up without ever mounting an editor (its load failed, the reader went back) leaves it free: it is moved', async () => {
    const { local, e } = await begun()
    e.close()
    await moves()
    const giveUp = outlineOpening(local)
    await signIn()
    expect(movedTo(local)).toBeUndefined()
    giveUp()
    giveUp()
    await moves()
    expect([lines(movedTo(local)!), freed.filter(id => id === local).length]).toEqual([['A'], 2])
  })
})

describe('the editor of a jotting that has moved to the account', () => {
  it('opened by the id the device had for it, is the account’s jotting’s: found under its id by a write, and saving with its stamp and its name', async () => {
    const { local, sid } = await moved()
    const loaded = await getOwnOutline(local)
    expect(loaded.id).toBe(sid)
    const again = editor(loaded)
    const letGo = await holdEditor(sid)
    expect(again.shown.held).toBe(true)
    letGo('unchanged')
    expect(await settleEditors()).toEqual([])
    const before = server.log.length
    again.type('A', 'A typed in the account’s editor')
    await again.rest()
    again.saver.latest.meta = { ...again.saver.latest.meta, title: 'Begun on this device, and retitled' }
    again.saver.touch('meta')
    await again.rest()
    expect(lines(sid)).toEqual(['A typed in the account’s editor'])
    expect(saves(before).map(q => [q.method, typeof q.body?.if_updated, typeof q.body?.writer])).toEqual([['PUT', 'string', 'string'], ['PATCH', 'string', 'string']])
    again.close()
  })
})

// No save from an editor reaches the account's copy of a jotting without the stamp the editor last saw: that is what
// lets the server refuse it when someone else has saved since. The one door to the two routes holds to it.
describe('a save to the account’s copy of a jotting', () => {
  it('from an editor names its stamp and its writer; from an editor that has no stamp it is not sent at all', async () => {
    const { local, sid } = await moved()
    const before = server.log.length
    // an editor of the device's copy has no stamp of the account's: its save is refused here, as by the server
    await expect(saveOutlineItems(local, [note('From an editor of the device’s copy')], false, { writer: 'an-editor-0123456789abcdef' })).rejects.toMatchObject({ status: 409 })
    await expect(patchOutline(local, { title: 'From an editor of the device’s copy' }, false, { writer: 'an-editor-0123456789abcdef' })).rejects.toMatchObject({ status: 409 })
    await expect(saveOutlineItems(sid, [note('From an editor with no stamp')], false, { writer: 'an-editor-0123456789abcdef' })).rejects.toMatchObject({ status: 409 })
    expect([saves(before).length, lines(sid)]).toEqual([0, ['A']])
    // with its stamp, both are named, by the device's id as by the account's
    const seen = server.rows.get(sid)!.updated_at
    await saveOutlineItems(local, [note('From an editor of the account’s jotting')], false, { seen, writer: 'an-editor-0123456789abcdef' })
    expect([saves(before).map(q => [q.path, q.body?.if_updated, q.body?.writer]), lines(sid)]).toEqual([[[`/outlines/${sid}/items`, seen, 'an-editor-0123456789abcdef']], ['From an editor of the account’s jotting']])
  })
  it('from what is not an editor (verses added from the reader, the tour, a restore) names nothing, as before', async () => {
    const { sid } = await moved()
    const before = server.log.length
    await saveOutlineItems(sid, [note('A'), note('A verse added from the reader')])
    expect([saves(before).map(q => [q.body?.if_updated, q.body?.writer]), lines(sid), server.rows.get(sid)!.last_writer]).toEqual([[[undefined, undefined]], ['A', 'A verse added from the reader'], null])
  })
  it('from an editor of the account’s jotting goes on naming a stamp after an answer that carried none', async () => {
    const { sid } = await moved()
    const again = editor(await getOwnOutline(sid))
    const before = server.log.length
    server.bare = true
    again.type('A', 'A1')
    await again.rest()
    again.type('A1', 'A12')
    await again.rest()
    expect([saves(before).map(q => typeof q.body?.if_updated), lines(sid), again.shown.changed]).toEqual([['string', 'string'], ['A12'], false])
    again.close()
  })
  it('on this device, signed out, is the device’s own: nothing is sent', async () => {
    const { local, e } = await begun()
    e.type('A', 'A1')
    await e.rest()
    expect([server.log.length, await texts(local)]).toEqual([0, ['A1']])
    e.close()
    await deleteOutline(local)
  })
})
