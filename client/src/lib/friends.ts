/** Friends: the API (rs/src/friends.rs, docs/API.md → Friends) and the little the screens share. */
import type { Badge } from '@shared/types'
import type { FriendStreak, ReactionKind } from '@shared/friends'
import { cachedGet, del, get, getApiBase, post, put } from './api'
import { withTz } from './localDay'

export interface FriendPrefs { invites: boolean; share_streak: boolean; share_badges: boolean; share_reading: boolean; reactions: boolean }
export interface Person { id: number; handle: string; display_name: string; avatar?: string }
export interface ReactionRef { target: string; kind: ReactionKind; created_at: string }
/** A friend as they share themselves: a part they keep to themselves is null. */
export interface Friend extends Person {
  since: string
  streak: { current: number; longest: number; today: string; week: string[]; today_met: boolean } | null
  chapters_week: number | null
  badges: Badge[] | null
  /** Only when both friends share their streak. */
  friend_streak: FriendStreak | null
  reactions: { open: boolean; sent: ReactionRef[]; received: ReactionRef[] }
}
export type InviteVia = 'handle' | 'qr' | 'contacts'
export interface IncomingInvite { id: number; from: Person; via: InviteVia; created_at: string }
/** The sender's own record: the handle as typed, never whether it arrived. */
export interface OutgoingInvite { id: number; handle: string; via: InviteVia; created_at: string }
export interface FriendsOverview {
  settings: FriendPrefs; discoverable: boolean; invite_days: number; today: string
  friends: Friend[]; incoming: IncomingInvite[]; outgoing: OutgoingInvite[]; unseen_reactions: number
}
export interface ReceivedReaction { id: number; target: string; kind: ReactionKind; created_at: string; seen: boolean; from: Person }
export interface InviteToken { token: string; expires_at: string; ttl_secs: number; path: string }

export const loadFriends = () => get<FriendsOverview>(withTz('/friends'))
/** Home's read: shared with a repeat inside 30 s, dropped by any write. */
export const loadFriendsCached = () => cachedGet<FriendsOverview>(withTz('/friends'))
export const loadFriend = (id: number) => get<Friend>(withTz(`/friends/${id}`))
export const sendInvite = (handle: string) => post<{ status: 'sent' | 'friends'; friend?: Person }>('/friends/invite', { handle })
export const acceptInvite = (id: number) => post<{ status: 'friends'; friend: Person }>(`/friends/invites/${id}/accept`)
export const declineInvite = (id: number) => post<{ ok: true }>(`/friends/invites/${id}/decline`)
export const cancelInvite = (id: number) => del<{ ok: true }>(`/friends/invites/${id}`)
export const removeFriend = (id: number) => del<{ ok: true }>(`/friends/${id}`)
export const saveFriendPrefs = (p: Partial<FriendPrefs>) => put<FriendPrefs>('/friends/settings', p)

export const newToken = () => post<InviteToken>('/friends/token')
export const peekToken = (t: string) => get<{ handle: string; display_name: string; avatar?: string; friends: boolean }>(`/friends/token/${encodeURIComponent(t)}`)
export const redeemToken = (t: string) => post<{ status: 'sent' | 'friends'; friend: Person }>('/friends/token/redeem', { token: t })
export const tokenStatus = (t: string) => get<{ used: boolean; expired: boolean; friends: boolean; invite: { id: number; from: Person } | null }>(`/friends/token/${encodeURIComponent(t)}/status`)
/** The link a code stands for: the web app's Friends page with the token, which also opens the app where it is set up. */
export const inviteUrl = (path: string) => `${getApiBase() || (typeof location !== 'undefined' ? location.origin : '')}${path}`

export const react = (to: number, target: string, kind: ReactionKind) => post<{ created: boolean; reaction: ReactionRef }>('/friends/reactions', { to, target, kind })
export const loadReactions = () => get<{ open: boolean; reactions: ReceivedReaction[] }>('/friends/reactions')
export const markReactionsSeen = () => post<{ ok: true }>('/friends/reactions/seen')

export const setDiscoverable = (hashes: string[]) => put<{ discoverable: true; count: number }>('/friends/discoverable', { hashes })
export const clearDiscoverable = () => del<{ discoverable: false }>('/friends/discoverable')
export const matchContacts = (hashes: string[]) => post<{ matches: { handle: string; display_name: string; avatar?: string }[] }>('/friends/contacts/match', { hashes })
export const inviteContact = (handle: string) => post<{ status: 'sent' | 'friends'; friend?: Person }>('/friends/contacts/invite', { handle })

/** A friend's first name for running text ("Waiting for Anna"). */
export const firstName = (p: { display_name: string; handle: string }) => (p.display_name || p.handle).trim().split(/\s+/)[0]
