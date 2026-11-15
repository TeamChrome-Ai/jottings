// The background task (client/src/lib/inviteTask.ts) wakes the app headless, with nothing else loaded: the morning
// verses it tops up follow the path as the app shows it, so under the edition and cleanse the app last stored
// (docs/EDITION.md), not the build's default.
import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({ store: new Map<string, string>() }))
vi.mock('../client/node_modules/@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => h.store.get(k) ?? null, setItem: async (k: string, v: string) => { h.store.set(k, v) },
    removeItem: async (k: string) => { h.store.delete(k) }, multiGet: async (ks: string[]) => ks.map(k => [k, h.store.get(k) ?? null]),
  },
}))
vi.mock('../client/node_modules/expo-secure-store', () => ({ getItemAsync: async () => null }))
vi.mock('../client/node_modules/expo-background-task', () => ({}))
vi.mock('../client/node_modules/expo-task-manager', () => ({}))
vi.mock('../client/node_modules/react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android }, AppState: { addEventListener: () => ({ remove: () => {} }) },
}))
vi.mock('../client/src/lib/config', () => ({ defaultApiBase: () => 'https://srv' }))
vi.mock('../client/src/lib/device', () => ({ deviceId: async () => null }))
vi.mock('../client/src/lib/inviteMark', () => ({ checkInvitesOnce: vi.fn() }))
vi.mock('../client/src/lib/inviteNotify', () => ({ notifyAllowed: async () => false, postInviteNotices: vi.fn() }))
vi.mock('../client/src/i18n', () => ({ ensureStoredLanguage: async () => {} }))
vi.mock('../client/src/lib/verseNotify', () => ({ topUpVerseNotify: vi.fn() }))

import { backgroundCheck } from '../client/src/lib/inviteTask'
import { topUpVerseNotify } from '../client/src/lib/verseNotify'
import { peekCleanse, peekEdition } from '../client/src/lib/editionCore'

describe('the background task', () => {
  it('tops up the morning verses under the edition and cleanse the app stored', async () => {
    h.store.set('berean_prefs', JSON.stringify({ inviteNotify: false, verseNotify: { items: [{ book: -1, hour: 6, minute: 0 }] } }))
    h.store.set('berean_edition', '1890'); h.store.set('berean_cleanse', '1')
    const under: unknown[] = []
    vi.mocked(topUpVerseNotify).mockImplementation(async () => { under.push([peekEdition(), peekCleanse()]) })
    await backgroundCheck()
    expect(under).toEqual([['1890', true]])
  })
})
