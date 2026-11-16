/**
 * Ask's reach into the reader's own outlines (lib/assistantOutlines.ts `OutlinesHost`): the account's own, through
 * the functions their screens load and save with. One kept only on this device (a local id) is not the account's, and
 * is left out.
 */
import type { Outline } from '@shared/types'
import { get } from './api'
import type { OutlinesHost } from './assistantOutlines'
import { createOutline, deleteOutline, getOwnOutline, isLocalId, listOutlines, patchOutline, saveOutlineItems } from './library'
import { holdEditor, settleEditor, settleEditors } from './outlineEditors'

export const outlinesHost = (uid: () => number | null): OutlinesHost => ({
  uid,
  list: async words => (words
    ? await get<Pick<Outline, 'id' | 'title' | 'updated_at'>[]>(`/outlines/search?q=${encodeURIComponent(words)}&limit=50`)
    : (await listOutlines()).filter(o => !isLocalId(o.id))).map(o => ({ id: o.id, title: o.title, updated_at: o.updated_at })),
  get: getOwnOutline,
  // an editor open on it holds lines of its own (lib/outlineEditors.ts): they are saved before the outline is read,
  // and for the moment a write takes the editor takes no input, then shows what was written
  settle: settleEditor,
  settleAll: settleEditors,
  hold: holdEditor,
  create: title => createOutline({ title, visibility: 'private' }),
  save: (id, items, by) => saveOutlineItems(id, items, false, by),
  rename: (id, title, by) => patchOutline(id, { title }, false, by),
  remove: deleteOutline,
})
