import { describe, it, expect, beforeEach } from 'vitest'
import { peekEdition, servedKey, setCleanseState, setEditionState } from '../client/src/lib/editionCore'

describe('what the ministry page is mounted by', () => {
  beforeEach(() => { setCleanseState(false); setEditionState('1961') })

  it('changes with the edition', () => {
    const before = servedKey()
    setEditionState('1890')
    expect(servedKey()).not.toBe(before)
  })

  it('changes when the 1890 edition is cleansed and when that is undone, the edition staying 1890', () => {
    setEditionState('1890')
    const plain = servedKey()
    setCleanseState(true)
    const cleansed = servedKey()
    setCleanseState(false)
    expect([peekEdition(), cleansed === plain, servedKey() === plain]).toEqual(['1890', false, true])
  })
})
