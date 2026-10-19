import { describe, it, expect } from 'vitest'
import { createHold } from '../client/src/lib/readAloudHold'

/** A hand-wound timer: `run()` fires what is due, as the grace period ending would. */
function clock() {
  const due: { fn: () => void; live: boolean }[] = []
  const after = (fn: () => void, _ms: number) => { const t = { fn, live: true }; due.push(t); return () => { t.live = false } }
  const run = () => { for (const t of due.splice(0)) if (t.live) t.fn() }
  return { after, run, pending: () => due.filter(t => t.live).length }
}
const settled = async (p: Promise<void>) => { let done = false; void p.then(() => { done = true }); await Promise.resolve(); await Promise.resolve(); return done }

describe('the read-aloud task', () => {
  it('opens one task when a reading starts, however often the status changes while it reads', () => {
    let opened = 0
    const h = createHold(() => { opened++; return true }, clock().after, 30_000)
    h.set(true); h.set(true); h.set(true)
    expect(opened).toBe(1)
    expect(h.held).toBe(true)
  })

  it('keeps the task open while the reading is on, and lets it go once the grace period after it has passed', async () => {
    const c = clock()
    const h = createHold(() => true, c.after, 30_000)
    h.set(true)
    const task = h.task()
    expect(await settled(task)).toBe(false)
    h.set(false)
    expect(await settled(task)).toBe(false)   // still held: the next chapter is about to start
    c.run()
    expect(await settled(task)).toBe(true)
    expect(h.held).toBe(false)
  })

  it('keeps the same task across a chapter ending and the next one starting', async () => {
    let opened = 0
    const c = clock()
    const h = createHold(() => { opened++; return true }, c.after, 30_000)
    h.set(true)
    const task = h.task()
    h.set(false)
    h.set(true)
    c.run()   // the cancelled grace timer must not let go
    expect(opened).toBe(1)
    expect(await settled(task)).toBe(false)
    expect(c.pending()).toBe(0)
  })

  it('starts one grace period, not one per idle status', () => {
    const c = clock()
    const h = createHold(() => true, c.after, 30_000)
    h.set(true); h.set(false); h.set(false)
    expect(c.pending()).toBe(1)
  })

  it('settles at once when Android runs the task after the reading has ended', async () => {
    const c = clock()
    const h = createHold(() => true, c.after, 30_000)
    h.set(true); h.set(false); c.run()
    expect(await settled(h.task())).toBe(true)
  })

  it('holds nothing where the task cannot be opened (the web, iOS, an older build)', async () => {
    const c = clock()
    const h = createHold(() => false, c.after, 30_000)
    h.set(true)
    expect(h.held).toBe(false)
    expect(await settled(h.task())).toBe(true)
    h.set(false)
    expect(c.pending()).toBe(0)
  })

  it('opens a fresh task for a reading started after the last one was let go', async () => {
    let opened = 0
    const c = clock()
    const h = createHold(() => { opened++; return true }, c.after, 30_000)
    h.set(true); h.set(false); c.run()
    h.set(true)
    expect(opened).toBe(2)
    expect(await settled(h.task())).toBe(false)
  })
})
