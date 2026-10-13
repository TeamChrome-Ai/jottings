import { describe, it, expect } from 'vitest'
import { jottingTitle, signInPromptBelowLibrary } from '../client/src/lib/jot'

describe('a jotting from the verse bar', () => {
  it('is titled by its passage, runs compressed, order and duplicates ignored', () => {
    expect(jottingTitle(19, 23, [1])).toBe('Psalms 23:1')
    expect(jottingTitle(19, 23, [1, 2, 3])).toBe('Psalms 23:1-3')
    expect(jottingTitle(1, 1, [4, 2, 1, 4])).toBe('Genesis 1:1-2, 4')
    expect(jottingTitle(43, 3, [])).toBe('John 3')
  })
  it('names a one-chapter book without a chapter number', () => {
    expect(jottingTitle(65, 1, [3])).toBe('Jude 3')
  })
})

describe('Home: the sign-in prompt below the library until trust', () => {
  it('sits below Library for a reader who is signed out and has never finished a chapter here', () => {
    expect(signInPromptBelowLibrary(false, false)).toBe(true)
  })
  it('keeps its place above once a chapter has been credited on this device', () => {
    expect(signInPromptBelowLibrary(false, true)).toBe(false)
  })
  it('keeps its place for a signed-in reader whatever this device has read', () => {
    expect(signInPromptBelowLibrary(true, false)).toBe(false)
    expect(signInPromptBelowLibrary(true, true)).toBe(false)
  })
})
