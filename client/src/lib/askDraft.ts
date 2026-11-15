/**
 * The Ask bubble on Search (components/AskBubble.tsx) and the draft it carries: where a tap goes, which words of the
 * search field go with it, and how Ask takes them off its route (app/ask.tsx). The words arrive in Ask's field and are
 * never sent from here: sending is the reader's act, since each message counts against their day. Pure.
 */
import { readField } from './searchField'

/** The longest message Ask's field takes; a draft is cut to it. */
export const ASK_MAX = 2000

/** The words of the search field the bubble carries: all of them, unless Search would open them itself (a reference, a
 *  Strong's number) or there are none. */
export function askDraft(field: string): string {
  return readField(field).kind === 'words' ? field.trim().slice(0, ASK_MAX) : ''
}

export type AskTarget = '/login' | '/ask' | { pathname: '/ask'; params: { draft: string } }
/** Where the bubble goes: sign-in for a reader with no account (as Ask's row on Home does, and nothing is carried),
 *  else Ask, with the field's words as its draft when it has any to carry. */
export function askTarget(signedIn: boolean, field: string): AskTarget {
  if (!signedIn) return '/login'
  const draft = askDraft(field)
  return draft ? { pathname: '/ask', params: { draft } } : '/ask'
}

/** The draft in Ask's route param: its words, or none for anything that is not text. */
export function draftOf(param: unknown): string {
  return typeof param === 'string' ? param.trim().slice(0, ASK_MAX) : ''
}
/** Takes the draft off Ask's route: its words, and the param cleared (`clear`), so it is read once. A reload, a return
 *  to the screen or another account signing in finds none, and nothing brings back words already sent. */
export function takeDraft(param: unknown, clear: () => void): string {
  if (param !== undefined) clear()
  return draftOf(param)
}
