import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { formatRef } from '../shared/ref'
import { TEMPLE_REF } from '../client/src/lib/acknowledgments'

// feedback.ts talks to the server through api.ts (AsyncStorage); only its pure helpers are under test
vi.mock('../client/src/lib/api', () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }))
const { MESSAGE_MAX, appVersionLabel, feedbackBody } = await import('../client/src/lib/feedback')

const root = resolve(__dirname, '..')


describe('feedback body', () => {
  it('trims, leaves out a blank email, and refuses empty or oversized messages', () => {
    expect(feedbackBody('  hello  ', '  ', '1.0.0 (25)', 'android')).toEqual({ message: 'hello', app_version: '1.0.0 (25)', platform: 'android' })
    expect(feedbackBody('hi', ' a@b.org ', '', 'web')).toEqual({ message: 'hi', email: 'a@b.org', platform: 'web' })
    expect(feedbackBody('   ', '', '1', 'web')).toBeNull()
    expect(feedbackBody('x'.repeat(MESSAGE_MAX + 1), '', '1', 'web')).toBeNull()
    expect(feedbackBody('x'.repeat(MESSAGE_MAX), '', '1', 'web')).not.toBeNull()
  })

  it('caps messages where the server does', () => {
    const server = readFileSync(resolve(root, 'rs/src/feedback.rs'), 'utf8').match(/pub const MESSAGE_MAX: usize = (\d+);/)
    expect(Number(server?.[1])).toBe(MESSAGE_MAX)
  })

  it('label the version as the Settings footer does', () => {
    expect(appVersionLabel('1.0.0', 25)).toBe('1.0.0 (25)')
    expect(appVersionLabel('1.0.0', undefined)).toBe('1.0.0')
    expect(appVersionLabel(undefined, undefined)).toBe('')
  })
})

describe('acknowledgments', () => {
  it('point at the temple passage', () => {
    expect(formatRef(TEMPLE_REF)).toBe('Mark 11:15-17')
  })
})
