import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../client/src/lib/api', () => ({ get: vi.fn() }))
import { get } from '../client/src/lib/api'
import { isWebUrl, loadLinkPreview, previewOf } from '../client/src/lib/linkPreview'

beforeEach(() => { vi.mocked(get).mockReset() })

describe('a link\'s preview', () => {
  it('needs a title and a host, tidies the words and drops www', () => {
    expect(previewOf({ url: 'https://www.example.org/a', host: 'www.example.org', title: '  The   Synopsis\n of the Books ', description: ' Genesis to  Revelation ' }))
      .toEqual({ host: 'example.org', title: 'The Synopsis of the Books', description: 'Genesis to Revelation' })
    expect(previewOf({ host: 'example.org', title: 'T', description: null })).toEqual({ host: 'example.org', title: 'T', description: null })
    for (const none of [null, 'x', {}, { host: 'example.org', title: null }, { host: 'example.org', title: '   ' }, { title: 'T' }, { host: 5, title: 'T' }]) expect(previewOf(none)).toBeNull()
    expect(previewOf({ host: 'example.org', title: 'x'.repeat(500), description: 'y'.repeat(500) })).toMatchObject({ title: 'x'.repeat(160), description: 'y'.repeat(280) })
  })
  it('is asked for web links only, once each, and a failure is asked again', async () => {
    expect([isWebUrl('https://example.org/x'), isWebUrl('HTTP://example.org'), isWebUrl('mailto:a@b.c'), isWebUrl('javascript:alert(1)'), isWebUrl('https://')]).toEqual([true, true, false, false, false])
    expect(await loadLinkPreview('mailto:a@b.c')).toBeNull()
    expect(get).not.toHaveBeenCalled()
    vi.mocked(get).mockResolvedValue({ host: 'example.org', title: 'A page', description: null })
    const a = await loadLinkPreview('https://example.org/a?x=1&y=2'), again = await loadLinkPreview('https://example.org/a?x=1&y=2')
    expect([a, again]).toEqual([{ host: 'example.org', title: 'A page', description: null }, { host: 'example.org', title: 'A page', description: null }])
    expect(vi.mocked(get).mock.calls).toEqual([['/link-preview?url=https%3A%2F%2Fexample.org%2Fa%3Fx%3D1%26y%3D2']])
    // not allowed (a link kept on this device), unreachable, or no title: none, and the next showing asks again
    vi.mocked(get).mockRejectedValueOnce(new Error('403'))
    expect(await loadLinkPreview('https://example.org/b')).toBeNull()
    vi.mocked(get).mockResolvedValueOnce({ host: 'example.org', title: 'Now there', description: 'd' })
    expect(await loadLinkPreview('https://example.org/b')).toEqual({ host: 'example.org', title: 'Now there', description: 'd' })
  })
})
