import type { Ref } from './ref.js'

export interface Verse { v: number; t: string; h?: string; p?: 1; s?: 1; hd?: string; notes?: Note[] }
export interface Note { id: number; marker: string; text: string; pos?: number }
/** `ed`: a chapter of the 1890 edition says so (docs/EDITION.md); a 1961 chapter carries none. */
export interface Chapter { c: number; title?: string; division?: 1; verses: Verse[]; ed?: '1890' }
export interface BookData { n: number; name: string; abbr: string; osis: string; testament: 'OT' | 'NT'; chapters: Chapter[] }

export interface SearchHit { book: number; chapter: number; verse: number; text: string; snippet: string; rank: number }
/** How text hits are ordered: canonical (book, chapter, verse), or bm25 best match first. */
export type SearchOrder = 'bible' | 'match'
/**
 * `order`: the order the text hits came in (asked for, or the default for the query); absent for a reference.
 * `book`: on text hits for a query that is also a book's name ("song", "mark"), that book at chapter 1, to offer.
 */
export interface SearchResponse { kind: 'ref' | 'text'; ref?: Ref; hits: SearchHit[]; total: number; query: string; took_ms: number; order?: SearchOrder; book?: Ref
  /** One bare word in Bible order: the first `exact` hits hold the word itself (or its plural), the rest a longer word it begins. Absent when all or none do. */
  exact?: number }

/** `avatar`: the preset picture shown (theirs, or the default for the id); `avatar_chosen`: whether they picked it. */
export interface User { id: number; handle: string; display_name: string; created_at: string; is_admin?: 0 | 1; avatar?: string; avatar_chosen?: boolean
  /** The account's synced settings; `admin_mode` is a site admin's Admin mode (Settings → Admin). */
  settings?: { admin_mode?: boolean; [key: string]: unknown }
  /** The admin took this account's name away: the app asks for a new display name and handle first. */
  must_rename?: boolean }
/** A verse, a chapter (`verse` null) or a whole book (`chapter` and `verse` null); client/src/lib/bookmarks.ts. */
export interface Bookmark { id: number; book: number; chapter: number | null; verse?: number | null; label?: string | null; color?: string | null; created_at: string }

export type OutlineItemKind = 'verse' | 'note' | 'link' | 'heading'
export interface OutlineItem {
  id: number; outline_id: number; position: number; kind: OutlineItemKind
  book?: number | null; chapter?: number | null; v1?: number | null; v2?: number | null
  text?: string | null; url?: string | null; depth: number
}
export interface Outline {
  id: number; user_id: number; title: string; description: string | null
  visibility: 'private' | 'link' | 'public'; share_code: string | null
  print_style: 'verses-first' | 'inline' | 'refs-only'
  created_at: string; updated_at: string; items?: OutlineItem[]; owner_handle?: string
  /** Set while published (visibility `public`): listed in the public outlines under the author's handle. */
  published_at?: string | null; owner_display_name?: string; owner_avatar?: string | null
}

/** `today`: the reader-local day the figures describe (the device's day when the request carried its offset); absent
 *  from servers before versionCode 26. Every `date` is a reader-local day (rows from before then are UTC days). */
export interface StreakInfo { today?: string; current: number; longest: number; today_active_seconds: number; today_goal_seconds: number; days: { date: string; active_seconds: number; pages: number; met: 0 | 1 }[] }
export interface Badge { code: string; name: string; description: string; icon: string; earned_at?: string }
export interface Stats { total_active_seconds: number; total_pages: number; chapters_read: number; verses_read: number; books_completed: number; streak: StreakInfo; badges: Badge[] }

export interface Group { id: number; name: string; slug: string; description: string | null; owner_id: number; member_count: number; role?: 'admin' | 'member'; created_at: string; invite_code?: string
  /** The path the group walks together (shared/paths.ts), when it set out and its target; null while it walks none. */
  path_id?: string | null; path_started_at?: string | null; path_target_date?: string | null }
export type EventMetric = 'active_minutes' | 'pages' | 'chapters' | 'score' | 'streak'
/** Who sees the leaderboard: every member, or admins (a member sees their own row). */
export type EventVisibility = 'members' | 'private_admin'
/** Where a member's counting starts: the event's first day, or the day they joined the group when that is earlier. */
export type EventCountsFrom = 'event_start' | 'group_join'
/** The server makes the next window (same name and options) when the event ends. */
export type EventRepeat = 'none' | 'weekly' | 'monthly'
/**
 * `books`: the book numbers that count for the chapter-based metrics (null = every book); servers before versionCode 32
 * send only `book_from`/`book_to` (client/src/lib/community.ts, GroupEventFull). `late_join` false leaves members who
 * joined after `starts_at` off the board.
 */
export interface GroupEvent {
  id: number; group_id: number; name: string; metric: EventMetric; starts_at: string; ends_at: string
  time_weight: number; page_weight: number; goal?: number | null; created_by: number
  description?: string | null; books?: number[] | null
  visibility?: EventVisibility; counts_from?: EventCountsFrom; repeat?: EventRepeat; late_join?: boolean; renewed_at?: string | null
}
/** `rank`: the place on the full board, kept when a private board is cut down to the reader's own row. */
export interface LeaderboardRow { user_id: number; handle: string; display_name: string; value: number; active_seconds: number; pages: number; chapters: number; rank?: number; staff?: boolean }
