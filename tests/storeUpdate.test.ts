import { describe, it, expect } from 'vitest'
import { noticeFor } from '../client/src/lib/storeUpdateCore'

describe('the update line', () => {
  it('speaks of a newer build the moment Play offers it', () => {
    expect(noticeFor({ available: true, versionCode: 60, staleDays: null }, 59, null)).toBe(60)
    expect(noticeFor({ available: true, versionCode: 60, staleDays: 0 }, 59, null)).toBe(60)
  })

  it('says nothing when Play has nothing newer, or no answer', () => {
    expect(noticeFor(null, 59, null)).toBeNull()
    expect(noticeFor({ available: false, versionCode: 0, staleDays: 9 }, 59, null)).toBeNull()
    expect(noticeFor({ available: true, versionCode: 59, staleDays: 9 }, 59, null)).toBeNull()
  })

  it('stays closed for the build it was closed for, and comes back for the next one', () => {
    expect(noticeFor({ available: true, versionCode: 60, staleDays: 9 }, 59, 60)).toBeNull()
    expect(noticeFor({ available: true, versionCode: 61, staleDays: 9 }, 59, 60)).toBe(61)
  })
})
