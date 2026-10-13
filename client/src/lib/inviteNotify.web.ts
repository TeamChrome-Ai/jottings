import type { InviteLite } from './inviteNoticePlan'

/** The web build has no local notifications: invites show as a toast and on the Friends card only. */
export const INVITES_ROUTE = '/friends'
export async function ensureInviteChannel() {}
export const notifyAllowed = (): Promise<boolean> => Promise.resolve(false)
export async function postInviteNotices(_fresh: InviteLite[]) {}
