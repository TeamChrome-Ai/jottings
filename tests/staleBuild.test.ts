import { describe, it, expect, vi, afterEach } from 'vitest'
import { isStaleBuild, reloadForNewVersion } from '../client/src/lib/staleBuild'

describe('a page older than the site', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('is told by the failed load of a screen’s code', () => {
    const e = Object.assign(new Error('Loading module https://example.org/_expo/static/js/web/[handle]-499d.js failed.'), { name: 'AsyncRequireError' })
    expect(isStaleBuild(e)).toBe(true)
    expect(isStaleBuild(new Error('Loading module /x.js failed.'))).toBe(true)
    expect(isStaleBuild(new TypeError('x is undefined'))).toBe(false)
    expect(isStaleBuild(null)).toBe(false)
  })
  it('reloads into the new version once a minute at most, and only on the web', () => {
    const store = new Map<string, string>()
    const reload = vi.fn()
    expect(reloadForNewVersion(Object.assign(new Error('x'), { name: 'AsyncRequireError' }))).toBe(false)
    vi.stubGlobal('document', {})
    vi.stubGlobal('window', { location: { reload }, sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } } })
    const stale = Object.assign(new Error('x'), { name: 'AsyncRequireError' })
    expect(reloadForNewVersion(stale, 1_000_000)).toBe(true)
    expect(reloadForNewVersion(stale, 1_030_000)).toBe(false)
    expect(reloadForNewVersion(stale, 1_070_000)).toBe(true)
    expect(reloadForNewVersion(new Error('render failed'), 2_000_000)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
