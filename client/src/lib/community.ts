/** Shared helpers for the groups / profile / leaderboard screens: API shapes, a loader hook, formatting, event metrics. */
import { useCallback, useState } from 'react'
import { Alert, Platform } from 'react-native'
import { useFocusEffect } from 'expo-router'
import type { Badge, Group, GroupEvent, LeaderboardRow, Stats, User } from '@shared/types'
import type { EventStatus } from './events'
import type { GroupPath } from '@shared/paths'
import type { GroupStreak } from '@shared/friends'
import { ApiError, getApiBase } from './api'
import { localDay } from './localDay'
import { N_, t, tc } from '@shared/i18n'
import { dateLocale } from '../i18n'

// ---------------- API response shapes (mirror rs/src/groups.rs + rs/src/routes.rs) ----------------
/** `supporter` is sent to site admins only (the flag behind the secret Supporter badge). */
export type PublicUser = Pick<User, 'id' | 'handle' | 'display_name' | 'created_at' | 'avatar'> & { supporter?: boolean; staff?: boolean }
/** A site admin with Admin mode on: the Developer badge by their name, every group open to them (rs/src/auth.rs admin_mode). */
export const adminMode = (u: User | null | undefined): boolean => u?.is_admin === 1 && u.settings?.admin_mode === true
/** Others see the streak's current and longest only; the per-day history is the owner's. */
export type ProfileStats = Omit<Stats, 'badges' | 'streak'> & { streak: Pick<Stats['streak'], 'current' | 'longest'> }
/**
 * A private profile (the default) reaches only its owner in full, and friends, group-mates and the admin as `private`;
 * anyone else gets 404. `public` is sent to the owner only: whether others can see it.
 */
export type ProfileResponse =
  | { user: PublicUser; private: true }
  | { user: PublicUser; stats: ProfileStats; badges: Badge[]; public?: boolean }

export type GroupRole = 'admin' | 'member'
export interface GroupMember { id: number; handle: string; display_name: string; role: GroupRole; joined_at: string; avatar?: string | null; /** a site admin in Admin mode: the Developer badge */ staff?: boolean }
/** group_events rows also carry the optional book range and created_at that shared/types omits. */
export type GroupEventFull = GroupEvent & { book_from?: number | null; book_to?: number | null; created_at?: string }
/** `streak`: the group's shared streak, null while its owner has it off (`streak_enabled`). */
export type GroupDetail = Group & { role: GroupRole; /** here as a site admin in Admin mode, not as a member */ site_admin?: boolean; members: GroupMember[]; events: GroupEventFull[]; streak_enabled?: boolean; streak?: GroupStreak | null; /** the group's path with each member's place (shared/paths.ts GroupPath); null while it walks none */ path?: GroupPath | null }
/** `private`: the board was cut to my own row (event visibility `private_admin`, I am not an admin). */
export interface EventLeaderboard { event: GroupEventFull; rows: LeaderboardRow[]; private?: boolean }
export interface FeedPost {
  id: number; body: string; created_at: string; outline_id: number | null
  handle: string; display_name: string; outline_title: string | null; share_code: string | null; avatar?: string | null
  /** A site admin's notice: `body` is its text. `staff`: the author wears the Developer badge. `hidden`: hidden by moderation, seen by its author and by a site admin in Admin mode. */
  notice?: boolean; staff?: boolean; hidden?: number
}
export type GlobalPeriod = 'week' | 'month' | 'all'
export const GLOBAL_PERIODS: { value: GlobalPeriod; label: string }[] = [{ value: 'week', label: N_('This week') }, { value: 'month', label: N_('This month') }, { value: 'all', label: N_('All time') }]

// ---------------- loader ----------------
export type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: T }

export const errMsg = (e: unknown): string =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : t('Something went wrong')

/**
 * Runs `load` on focus and whenever `deps` change. The result is a discriminated union so callers switch on `kind`.
 * `reload` re-runs the loader without flashing the loading state away; `mutate` patches ready data in place.
 * Pass `enabled: false` to hold in the loading state (e.g. until the user is known).
 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[], enabled = true) {
  const [state, setState] = useState<Load<T>>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  useFocusEffect(useCallback(() => {
    if (!enabled) return
    let live = true
    load().then(data => { if (live) setState({ kind: 'ready', data }) }).catch((e: unknown) => { if (live) setState({ kind: 'error', message: errMsg(e) }) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]))
  const reload = useCallback(() => setTick(t => t + 1), [])
  const mutate = useCallback((fn: (d: T) => T) => setState(s => s.kind === 'ready' ? { kind: 'ready', data: fn(s.data) } : s), [])
  return { state, reload, mutate }
}

/** Yes/no prompt that works on web (window.confirm) and native (Alert). */
export function confirmAsync(title: string, message?: string, okLabel = t('OK')): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(typeof window !== 'undefined' && window.confirm(message ? `${title}\n\n${message}` : title))
  return new Promise(resolve => Alert.alert(title, message, [
    { text: t('Cancel'), style: 'cancel', onPress: () => resolve(false) },
    { text: okLabel, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }))
}

// ---------------- formatting ----------------
export { addDays, isDay, utcDay } from './events'
/** Calendar day (YYYY-MM-DD, rendered in UTC so it never shifts a day) or a full timestamp. */
export const fmtDay = (iso: string): string => {
  const day = iso.length === 10
  const t = Date.parse(day ? `${iso}T00:00:00Z` : iso)
  return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString(dateLocale(), { year: 'numeric', month: 'short', day: 'numeric', timeZone: day ? 'UTC' : undefined })
}
/** SQLite CURRENT_TIMESTAMP is UTC without a zone marker; treat zone-less stamps as UTC. */
export const fmtWhen = (iso: string): string => {
  const at = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) || iso.length === 10 ? iso : `${iso.replace(' ', 'T')}Z`)
  if (Number.isNaN(at)) return iso
  const mins = Math.round((Date.now() - at) / 60_000)
  if (mins < 1) return t('just now')
  if (mins < 60) return t('{n} min ago', { n: mins })
  if (mins < 60 * 24) return t('{n} h ago', { n: Math.round(mins / 60) })
  return new Date(at).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' })
}
/** English only: the admin screens' counts. */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
/** A group role as a label: "Owner", "Admin" ("Member" too, though the screens show no tag for it: every group you see you are in). */
export const roleLabel = (role: string) => (role === 'owner' ? t('Owner') : role === 'admin' ? tc('group role', 'Admin') : role === 'member' ? t('Member') : role.charAt(0).toUpperCase() + role.slice(1))
export const displayName = (u: { display_name: string; handle: string }) => u.display_name || u.handle

/** Invite link that lands on /groups with the code prefilled: the page's own origin on the web (the API base is empty
 *  there), the API origin in the apps, so it opens the web app. */
export const inviteLink = (code: string) => {
  const origin = Platform.OS === 'web' && typeof window !== 'undefined' && window.location ? window.location.origin : getApiBase()
  return `${origin}/groups?join=${encodeURIComponent(code)}`
}

// ---------------- event metrics: client/src/lib/events.ts, re-exported for the screens ----------------
export { METRICS, fmtValue, isMetric, metricLabel, metricUnit, numOrNull, type EventStatus, type MetricInfo } from './events'
import { eventStatus as statusOn } from './events'
export function eventStatus(ev: Pick<GroupEvent, 'starts_at' | 'ends_at'>, today = localDay()): EventStatus { return statusOn(ev, today) }
