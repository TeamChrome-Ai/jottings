import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Expansion } from '../shared/ministry'

vi.mock('../client/src/lib/api', () => ({ get: vi.fn() }))

import { get } from '../client/src/lib/api'
import { loadExpansion, shouldExpand } from '../client/src/lib/expandCore'

const QUESTION = 'how can I be sure I am saved'
const answer = (over: Partial<Expansion> = {}): Expansion => ({
  q: QUESTION.toLowerCase(), state: 'ok',
  phrases: [{ text: 'assurance of salvation', total: 33 }],
  verses: [{ book: 62, chapter: 5, verse: 13, total: 33 }],
  related: [{ text: 'the new birth', total: 299 }],
  ...over,
})

describe('a ministry search asks for other wordings', () => {
  it('for a plain question of three words or more that found fewer than five paragraphs', () => {
    expect(shouldExpand(QUESTION, 0)).toBe(true)
    expect(shouldExpand('sure I am', 4)).toBe(true)
    expect(shouldExpand('what did Darby teach about the 70 weeks', 0)).toBe(true)
  })

  it('never for fewer than three words, a possessive counting as one', () => {
    for (const q of ['', 'saved', '  assurance   salvation  ', 'God’s will', "God's will"]) expect(shouldExpand(q, 0), q).toBe(false)
  })

  it('never once the words search found five or more, or before it has answered', () => {
    expect(shouldExpand(QUESTION, 5)).toBe(false)
    expect(shouldExpand(QUESTION, 1200)).toBe(false)
    expect(shouldExpand(QUESTION, null)).toBe(false)
  })

  it('never for a Bible reference', () => {
    for (const q of ['1 John 5:13', 'Romans 8:28-30', 'Song of Solomon 2', 'first corinthians 13']) expect(shouldExpand(q, 0), q).toBe(false)
  })
})

describe('the other wordings for a question', () => {
  beforeEach(() => vi.mocked(get).mockReset())

  it('are asked of the server with the question as typed', async () => {
    vi.mocked(get).mockResolvedValue(answer())
    expect(await loadExpansion(` ${QUESTION}? `)).toEqual(answer())
    expect(get).toHaveBeenCalledWith(`/ministry/expand?q=${encodeURIComponent(`${QUESTION}?`)}`)
  })

  it('leave out an item that finds nothing', async () => {
    vi.mocked(get).mockResolvedValue(answer({ phrases: [{ text: 'free bitcoin', total: 0 }, { text: 'assurance of salvation', total: 33 }] }))
    expect((await loadExpansion(QUESTION))?.phrases).toEqual([{ text: 'assurance of salvation', total: 33 }])
  })

  it('are none when the server asks no model, is busy, finds nothing, answers something else or cannot be reached', async () => {
    const replies: (() => Promise<unknown>)[] = [
      async () => answer({ state: 'off', phrases: [], verses: [], related: [] }),
      async () => answer({ state: 'busy', phrases: [], verses: [], related: [] }),
      async () => answer({ phrases: [], verses: [], related: [] }),
      async () => answer({ phrases: [{ text: 'free bitcoin', total: 0 }], verses: [], related: [] }),
      async () => ({ ...answer(), state: 'maybe' }),
      async () => ({ ...answer(), verses: [{ book: 'John', chapter: 3, verse: 16, total: 2 }] }),
      async () => '<!doctype html>',
      async () => { throw Object.assign(new Error('HTTP 404'), { status: 404 }) },
      async () => { throw new Error('offline') },
    ]
    for (const reply of replies) {
      vi.mocked(get).mockImplementationOnce(reply)
      expect(await loadExpansion(QUESTION)).toBeNull()
    }
  })
})
