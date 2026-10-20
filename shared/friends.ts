/**
 * Friends, as the screens present them (the rules are the server's: rs/src/friends.rs, docs/API.md). Pure: shared by the
 * client and the tests.
 */
import { SCHEMES } from './brand.js'
import { t, tn } from './i18n.js'

export type FriendStreakState = 'kept' | 'waiting' | 'lapsed' | 'none'
/** A friend streak as the server sends it: days on which both friends met their own goal on the same date. */
export interface FriendStreak {
  current: number; longest: number
  /** The pair's day: the earlier of the two friends' todays. */
  day: string
  kept: boolean; mine_met: boolean; theirs_met: boolean
  run_start: string | null
  state: FriendStreakState
}

export type ReactionKind = 'heart' | 'smile' | 'clap' | 'seal'
export const REACTION_KINDS: readonly ReactionKind[] = ['heart', 'smile', 'clap', 'seal']
/** How a reaction is named, in the reader's language: the button's label, the count in a summary line ("a heart",
 *  "3 hearts"), and the note that one was sent. */
export const REACTION_WORDS: Record<ReactionKind, { label: string; count: (n: number) => string; sent: (name: string) => string }> = {
  heart: { get label() { return t('Heart') }, count: n => tn(n, 'a heart', '{n} hearts'), sent: name => t('{name} sent a heart', { name }) },
  smile: { get label() { return t('Smile') }, count: n => tn(n, 'a smile', '{n} smiles'), sent: name => t('{name} sent a smile', { name }) },
  clap: { get label() { return t('Applause') }, count: n => tn(n, 'a round of applause', '{n} rounds of applause'), sent: name => t('{name} sent a round of applause', { name }) },
  seal: { get label() { return t('Well done') }, count: n => tn(n, 'a well-done seal', '{n} well-done seals'), sent: name => t('{name} sent a well-done seal', { name }) },
}
export const isReactionKind = (s: string): s is ReactionKind => (REACTION_KINDS as readonly string[]).includes(s)

/** Friend-streak lengths that carry a milestone (the badges are the first three). */
export const STREAK_MILESTONES = [7, 30, 100, 365] as const

export interface StreakPresentation {
  show: boolean
  tone: FriendStreakState
  /** The number on the seal: the running streak, or the best one once it has lapsed. */
  count: number
  headline: string
  line: string
  /** Screen readers: the headline and line as one sentence. */
  label: string
}

const together = (n: number) => tn(n, '{n} day together', '{n} days together')

/**
 * The seal's words for a friend streak with `name`. Never guilt: a lapse is only a lapse, and the one still to read is
 * named plainly ("Your turn", "Waiting for Anna").
 */
export function presentFriendStreak(fs: FriendStreak | null | undefined, name: string): StreakPresentation {
  if (!fs) return { show: false, tone: 'none', count: 0, headline: '', line: '', label: '' }
  let headline: string, line: string, count = fs.current
  switch (fs.state) {
    case 'kept':
      headline = together(fs.current)
      line = fs.current === 1 ? t('Started today') : t('Kept today')
      break
    case 'waiting':
      headline = together(fs.current)
      line = fs.mine_met && !fs.theirs_met ? t('Waiting for {name}', { name }) : !fs.mine_met && fs.theirs_met ? t('{name} has read today. Your turn', { name }) : t('Read today to keep it going')
      break
    case 'lapsed':
      count = fs.longest
      headline = t('Lapsed')
      line = tn(fs.longest, 'Start again today. Your best was {n} day', 'Start again today. Your best was {n} days')
      break
    default:
      headline = t('No friend streak yet')
      line = t('Both read on the same day to start one')
  }
  return { show: true, tone: fs.state, count, headline, line, label: `${headline}. ${line}` }
}

/** The friend-streak milestone of the running streak a reaction can be left on, if one has been reached. */
export function streakMilestone(fs: FriendStreak | null | undefined): { days: number; target: string } | null {
  if (!fs || fs.current <= 0 || !fs.run_start) return null
  const m = [...STREAK_MILESTONES].reverse().find(n => fs.current >= n)
  return m ? { days: m, target: `streak:${m}:${fs.run_start}` } : null
}

/** A reaction target's own name: a badge's (looked up), or a friend-streak milestone's. */
export function targetName(target: string, badgeName: (code: string) => string | undefined): string {
  if (target.startsWith('badge:')) { const code = target.slice(6); return badgeName(code) ?? code }
  const m = /^streak:(\d+):/.exec(target)
  return m ? tn(Number(m[1]), '{n}-day friend streak', '{n}-day friend streak') : target
}

const list = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : names.length === 2 ? t('{list} and {last}', { list: names[0], last: names[1] }) : tn(names.length - 1, '{name} and {n} other', '{name} and {n} others', { name: names[0] })

/**
 * One line for a stack of reactions on one thing: "A heart from Anna", "3 hearts from Anna and 2 others",
 * "2 hearts and a smile from Anna and 2 others". Newest first in, the first name is the newest sender.
 */
export function summariseReactions(rs: readonly { kind: ReactionKind; from: { display_name: string; handle: string } }[]): string {
  if (!rs.length) return ''
  const counts = REACTION_KINDS.map(k => [k, rs.filter(r => r.kind === k).length] as const).filter(([, n]) => n > 0)
  const parts = counts.map(([k, n]) => REACTION_WORDS[k].count(n))
  const what = parts.length === 1 ? parts[0] : t('{list} and {last}', { list: parts.slice(0, -1).join(', '), last: parts[parts.length - 1] })
  const names = [...new Set(rs.map(r => r.from.display_name || r.from.handle))]
  const text = t('{what} from {names}', { what, names: list(names) })
  return text[0].toUpperCase() + text.slice(1)
}

/** What this device last showed for a friend streak, so the kept moment plays once per kept day. */
export interface SeenStreak { day: string; kept: boolean; count: number }
/** The kept moment plays the first time a day is seen kept; the count then ticks up from what was last shown. */
export function keptMoment(seen: SeenStreak | undefined, fs: FriendStreak | null | undefined): { play: boolean; from: number } {
  if (!fs || !fs.kept) return { play: false, from: fs?.current ?? 0 }
  const already = seen?.kept && seen.day === fs.day
  return { play: !already, from: already ? fs.current : Math.min(seen?.count ?? Math.max(0, fs.current - 1), fs.current) }
}

const TOKEN = /^[A-Za-z0-9]{16,40}$/
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** How an invite link starts: any web address, or one of the app's own schemes (shared/brand.json). */
const INVITE_LINK = new RegExp(`^(?:https?://[^/?#\\s]+|${SCHEMES.map(s => `${escapeRe(s)}://`).join('|')})/?friends/?\\?(?:[^#\\s]*&)?t=([A-Za-z0-9]+)(?:[&#]|$)`)
/**
 * The invite token in a scanned code or an opened link: `https://<host>/friends?t=…`, `<scheme>://friends?t=…`, or the
 * bare token. Anything else (another QR code entirely) is null.
 */
export function inviteToken(text: string): string | null {
  const s = text.trim()
  if (TOKEN.test(s)) return s
  const m = INVITE_LINK.exec(s)
  return m && TOKEN.test(m[1]) ? m[1] : null
}

/** A reading group's shared streak as the server sends it (rs/src/groups.rs): every member, each on their own day. */
export interface GroupStreak {
  current: number; longest: number; day: string; kept: boolean; run_start: string | null; state: FriendStreakState
  today: { id: number; met: boolean }[]; met_today: number; members: number
}

/** The group streak in the seal's shape (the seal, its kept moment and its milestones read it alike). */
export const groupAsStreak = (g: GroupStreak, meId: number): FriendStreak => ({
  current: g.current, longest: g.longest, day: g.day, kept: g.kept, run_start: g.run_start, state: g.state,
  mine_met: g.today.some(t => t.id === meId && t.met), theirs_met: g.met_today > 0,
})

/**
 * The group streak's words. Nobody is named or singled out: the count of who has read today is the whole story
 * ("3 of 5 have read today").
 */
export function presentGroupStreak(g: GroupStreak | null | undefined): StreakPresentation {
  if (!g) return { show: false, tone: 'none', count: 0, headline: '', line: '', label: '' }
  const who = g.met_today === g.members ? (g.members === 1 ? t('You have read today') : g.members === 2 ? t('Both have read today') : t('All {n} have read today', { n: g.members })) : tn(g.met_today, '{n} of {members} have read today', '{n} of {members} have read today', { members: g.members })
  let headline: string, line: string, count = g.current
  switch (g.state) {
    case 'kept': headline = together(g.current); line = who; break
    case 'waiting': headline = together(g.current); line = who; break
    case 'lapsed': count = g.longest; headline = t('Lapsed'); line = tn(g.longest, 'Start again today. The group’s best was {n} day', 'Start again today. The group’s best was {n} days'); break
    default: headline = t('No group streak yet'); line = t('A day on which everyone reads starts one. {who}', { who })
  }
  return { show: true, tone: g.state, count, headline, line, label: `${headline}. ${line}` }
}
