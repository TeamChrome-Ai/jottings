import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ASK_MAX } from '../client/src/lib/askDraft'

// Ask's window is kept on both sides, in the server's Rust and the app's TypeScript, and only comments tied the two:
// these read each number from its own source and hold the pairs together.
const source = (file: string) => readFileSync(path.resolve(__dirname, '..', file), 'utf8')
const number = (src: string, name: string): number => {
  const found = new RegExp(`\\bconst ${name}(?:: usize)? = ([\\d_]+)`).exec(src)
  if (!found) throw new Error(`no ${name}`)
  return Number(found[1].replace(/_/g, ''))
}
const server = source('rs/src/assistant.rs'), app = source('client/src/lib/assistant.ts')

describe('the numbers Ask keeps on both sides', () => {
  it('the app sends no more of the reader’s messages than the server reads', () => {
    expect(number(app, 'SENT')).toBeLessThanOrEqual(number(app, 'SENT_MOST'))
    expect(number(app, 'SENT_MOST')).toBeLessThanOrEqual(number(server, 'HISTORY'))
  })
  it('a message is as long in the app’s box as the server takes', () => {
    expect(ASK_MAX).toBe(number(server, 'MESSAGE_CHARS'))
  })
})
