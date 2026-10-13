//! Friends: mutual, and only ever started by someone who already knows you (your exact handle, a QR code or link you
//! showed them, or contact hashes you both opted in to). No messages, no search, no feed. Rules in docs/API.md, Friends:
//! - an invite by handle answers `sent` and leaves the same row in the sender's list whether the handle exists, has
//!   invites off, has blocked the sender or declined before; only a deliverable invite ever reaches anyone;
//! - a declined invite stays "sent" to its sender until it lapses (INVITE_DAYS), so a decline is never seen;
//! - friends see each other's streak, week, badges and chapters this week, each as the owner allows;
//! - a block severs the friendship and everything shared along it, and tells the blocked person nothing new.
use crate::activity::{self, day_key, parse_day, StreakInfo};
use crate::auth::{random_token, AuthUser, User};
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::{extract::{Path, Query, State}, routing::{get, post, put}, Json, Router};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

/// An invite nobody answered lapses after this long, for its sender too.
pub const INVITE_DAYS: i64 = 30;
/// A QR or link token lives this long and redeems once.
pub const TOKEN_SECS: i64 = 600;
pub const MAX_FRIENDS: i64 = 200;
pub const MAX_PENDING_OUT: i64 = 50;
/// A reader's own phone numbers and emails, hashed, for "Let contacts find me".
pub const MAX_OWN_HASHES: usize = 4;
/// Hashed contacts in one "Find friends from my contacts" request.
pub const MAX_MATCH_HASHES: usize = 2000;
pub const REACTIONS: &[&str] = &["heart", "smile", "clap", "seal"];
/// Friend-streak lengths a friend can react to; the badges are 7, 30 and 100.
pub const STREAK_MILESTONES: &[i64] = &[7, 30, 100, 365];

const NOT_OPEN: &str = "That invite is no longer open";
const BAD_TOKEN: &str = "That code has expired or has been used. Ask for a fresh one.";

// ---------------- settings ----------------

/// What a reader shares with friends and whether they can be reached. Kept in `users.settings.friends`; a missing key
/// takes its default, so everything reads as today's app until the reader has a friend.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Prefs { pub invites: bool, pub share_streak: bool, pub share_badges: bool, pub share_reading: bool, pub reactions: bool }
impl Default for Prefs { fn default() -> Self { Self { invites: true, share_streak: true, share_badges: true, share_reading: true, reactions: true } } }

fn prefs_of(settings: &Value) -> Prefs {
    let f = settings.get("friends");
    let b = |k: &str, d: bool| f.and_then(|f| f.get(k)).and_then(|v| v.as_bool()).unwrap_or(d);
    let d = Prefs::default();
    Prefs { invites: b("invites", d.invites), share_streak: b("share_streak", d.share_streak), share_badges: b("share_badges", d.share_badges), share_reading: b("share_reading", d.share_reading), reactions: b("reactions", d.reactions) }
}
pub fn prefs(conn: &Connection, uid: i64) -> Prefs {
    let s: Option<String> = conn.query_row("SELECT settings FROM users WHERE id=?1", params![uid], |r| r.get(0)).optional().ok().flatten();
    prefs_of(&s.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null))
}

// ---------------- limits ----------------

/// Counts `kind` events of `uid` against each (max, seconds) window and records one more when all have room. Kept in
/// the database (a day at most) so every test database and every server restart has its own tally. link_preview.rs
/// counts its fetches here too.
pub(crate) fn limit(conn: &Connection, uid: i64, kind: &str, rules: &[(i64, i64)]) -> ApiResult<()> {
    conn.execute("DELETE FROM friend_events WHERE user_id=?1 AND at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')", params![uid])?;
    for &(max, secs) in rules {
        let n: i64 = conn.query_row("SELECT count(*) FROM friend_events WHERE user_id=?1 AND kind=?2 AND at > strftime('%Y-%m-%dT%H:%M:%fZ','now',?3)", params![uid, kind, format!("-{secs} seconds")], |r| r.get(0))?;
        if n >= max { return Err(ApiError::new(429, "That is a lot at once. Please try again later.")); }
    }
    conn.execute("INSERT INTO friend_events (user_id, kind) VALUES (?1, ?2)", params![uid, kind])?;
    Ok(())
}
const INVITE_LIMITS: &[(i64, i64)] = &[(10, 600), (40, 86_400)];
const TOKEN_LIMITS: &[(i64, i64)] = &[(20, 3600)];
const REDEEM_LIMITS: &[(i64, i64)] = &[(20, 600)];
const REACT_LIMITS: &[(i64, i64)] = &[(60, 3600)];
const MATCH_LIMITS: &[(i64, i64)] = &[(2, 60), (5, 86_400)];
const DISCOVER_LIMITS: &[(i64, i64)] = &[(10, 86_400)];
/// The phone's check for new invites: a background run about every 15 minutes plus the app coming forward.
const POLL_LIMITS: &[(i64, i64)] = &[(60, 3600)];

// ---------------- relations ----------------

fn pair(a: i64, b: i64) -> (i64, i64) { if a < b { (a, b) } else { (b, a) } }
pub fn are_friends(conn: &Connection, a: i64, b: i64) -> rusqlite::Result<bool> {
    let (x, y) = pair(a, b);
    Ok(conn.query_row("SELECT 1 FROM friendships WHERE a=?1 AND b=?2", params![x, y], |_| Ok(())).optional()?.is_some())
}
fn blocked_either(conn: &Connection, a: i64, b: i64) -> rusqlite::Result<bool> {
    Ok(conn.query_row("SELECT 1 FROM blocks WHERE (user_id=?1 AND blocked_id=?2) OR (user_id=?2 AND blocked_id=?1)", params![a, b], |_| Ok(())).optional()?.is_some())
}
/// Friends of `uid` with the day each friendship began; a disabled account or a block in either direction drops out.
pub fn friends_of(conn: &Connection, uid: i64) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut st = conn.prepare_cached("SELECT CASE WHEN f.a=?1 THEN f.b ELSE f.a END AS fid, f.created_at FROM friendships f JOIN users u ON u.id = CASE WHEN f.a=?1 THEN f.b ELSE f.a END
        WHERE (f.a=?1 OR f.b=?1) AND u.disabled=0 AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id=?1 AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?1))")?;
    let v = st.query_map(params![uid], |r| Ok((r.get(0)?, r.get(1)?)))?.collect(); v
}
fn friend_count(conn: &Connection, uid: i64) -> rusqlite::Result<i64> { conn.query_row("SELECT count(*) FROM friendships WHERE a=?1 OR b=?1", params![uid], |r| r.get(0)) }

/// Everything shared along a friendship goes, both ways. The invites the blocked person sent stay in their own list as
/// they were (undelivered from now on) so that nothing changes on their side but the friendship itself.
pub fn sever(conn: &Connection, me: i64, other: i64) -> rusqlite::Result<()> {
    let (a, b) = pair(me, other);
    conn.execute("DELETE FROM friendships WHERE a=?1 AND b=?2", params![a, b])?;
    conn.execute("DELETE FROM friend_reactions WHERE (from_id=?1 AND to_id=?2) OR (from_id=?2 AND to_id=?1)", params![me, other])?;
    conn.execute("UPDATE friend_invites SET cancelled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE from_id=?1 AND to_id=?2 AND cancelled_at IS NULL", params![me, other])?;
    conn.execute("UPDATE friend_invites SET delivered=0 WHERE from_id=?1 AND to_id=?2", params![other, me])?;
    Ok(())
}

/// A live invite: neither cancelled nor lapsed (INVITE_DAYS; the literal is pinned by a test).
const LIVE: &str = "cancelled_at IS NULL AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')";
const LIVE_I: &str = "i.cancelled_at IS NULL AND i.created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')";
fn prune(conn: &Connection, uid: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM friend_invites WHERE (from_id=?1 OR to_id=?1) AND created_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')", params![uid])?;
    conn.execute("DELETE FROM friend_tokens WHERE user_id=?1 AND expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')", params![uid])?;
    Ok(())
}
/// The open invite `from` sent `to` that `to` can see, if any.
fn open_invite(conn: &Connection, from: i64, to: i64) -> rusqlite::Result<Option<i64>> {
    conn.query_row(&format!("SELECT id FROM friend_invites WHERE from_id=?1 AND to_id=?2 AND delivered=1 AND declined_at IS NULL AND {LIVE} ORDER BY id DESC LIMIT 1"), params![from, to], |r| r.get(0)).optional()
}

pub fn clean_handle(raw: &str) -> Option<String> {
    let h = raw.trim().trim_start_matches('@').to_lowercase();
    (h.len() >= 3 && h.len() <= 24 && h.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')).then_some(h)
}

#[derive(Serialize, Clone, Debug)]
pub struct Person { pub id: i64, pub handle: String, pub display_name: String, pub avatar: String }
fn person(conn: &Connection, id: i64) -> rusqlite::Result<Option<Person>> {
    conn.query_row("SELECT id, handle, display_name, avatar FROM users WHERE id=?1 AND disabled=0", params![id], |r| Ok(Person { id: r.get(0)?, handle: r.get(1)?, display_name: r.get(2)?, avatar: crate::avatars::effective(r.get(0)?, r.get::<_, Option<String>>(3)?.as_deref()) })).optional()
}

/// Sends `me`'s invite to `handle`. The reply and the sender's own record are the same whatever the handle turns out to
/// be; the row is delivered only to a real account that takes invites, has no block either way with `me`, and has not
/// declined `me` within INVITE_DAYS. Inviting someone whose invite to `me` is open accepts it instead.
pub fn send_invite(conn: &mut Connection, me: &User, handle: &str, via: &str) -> ApiResult<Value> {
    limit(conn, me.id, "invite", INVITE_LIMITS)?;
    prune(conn, me.id)?;
    let target: Option<i64> = conn.query_row("SELECT id FROM users WHERE handle=?1 AND disabled=0 AND id<>0", params![handle], |r| r.get(0)).optional()?;
    if let Some(t) = target {
        if !blocked_either(conn, me.id, t)? {
            if are_friends(conn, me.id, t)? { return Ok(json!({ "status": "friends", "friend": person(conn, t)? })); }
            if let Some(inv) = open_invite(conn, t, me.id)? { return Ok(json!({ "status": "friends", "friend": accept(conn, me.id, inv)? })); }
        }
    }
    let live: Option<i64> = conn.query_row(&format!("SELECT id FROM friend_invites WHERE from_id=?1 AND to_handle=?2 AND {LIVE}"), params![me.id, handle], |r| r.get(0)).optional()?;
    if live.is_some() { return Ok(json!({ "status": "sent" })); }
    let pending: i64 = conn.query_row(&format!("SELECT count(*) FROM friend_invites WHERE from_id=?1 AND {LIVE}"), params![me.id], |r| r.get(0))?;
    if pending >= MAX_PENDING_OUT { return Err(ApiError::new(429, format!("You have {MAX_PENDING_OUT} invites waiting. Cancel some before sending more."))); }
    let deliver = match target {
        Some(t) => {
            let declined: bool = conn.query_row("SELECT 1 FROM friend_invites WHERE from_id=?1 AND to_id=?2 AND declined_at IS NOT NULL AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')", params![me.id, t], |_| Ok(())).optional()?.is_some();
            prefs(conn, t).invites && !blocked_either(conn, me.id, t)? && !declined
        }
        None => false,
    };
    conn.execute("INSERT INTO friend_invites (from_id, to_handle, to_id, delivered, via) VALUES (?1,?2,?3,?4,?5)", params![me.id, handle, target, deliver as i64, via])?;
    Ok(json!({ "status": "sent" }))
}

/// Turns the open invite `invite` (to `me`) into a friendship and closes every open invite between the two.
fn accept(conn: &mut Connection, me: i64, invite: i64) -> ApiResult<Person> {
    let from: Option<i64> = conn.query_row(&format!("SELECT from_id FROM friend_invites WHERE id=?1 AND to_id=?2 AND delivered=1 AND declined_at IS NULL AND {LIVE}"), params![invite, me], |r| r.get(0)).optional()?;
    let Some(from) = from else { return Err(ApiError::not_found(NOT_OPEN)) };
    let Some(p) = person(conn, from)? else { return Err(ApiError::not_found(NOT_OPEN)) };
    if blocked_either(conn, me, from)? { return Err(ApiError::not_found(NOT_OPEN)); }
    if friend_count(conn, me)? >= MAX_FRIENDS || friend_count(conn, from)? >= MAX_FRIENDS { return Err(ApiError::new(409, format!("A friends list holds {MAX_FRIENDS} people at most"))); }
    let (a, b) = pair(me, from);
    let tx = conn.transaction()?;
    tx.execute("INSERT OR IGNORE INTO friendships (a, b) VALUES (?1, ?2)", params![a, b])?;
    tx.execute("UPDATE friend_invites SET cancelled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE cancelled_at IS NULL AND ((from_id=?1 AND to_id=?2) OR (from_id=?2 AND to_id=?1))", params![me, from])?;
    tx.commit()?;
    Ok(p)
}

// ---------------- friend streaks ----------------

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct PairStreak {
    /// Consecutive shared days (both met their own goal on the same date) ending on the latest shared day, while that is
    /// the pair's day or the one before; else 0.
    pub current: i64,
    pub longest: i64,
    /// The pair's day: the earlier of the two readers' todays, the one day still open for at least one of them.
    pub day: String,
    /// `day` is kept: both met it.
    pub kept: bool,
    pub mine_met: bool,
    pub theirs_met: bool,
    /// The first day of the running streak (reactions to a milestone name it, so a new run is a new milestone).
    pub run_start: Option<String>,
    /// kept, waiting (running, today not kept yet), lapsed (none running, one has been) or none.
    pub state: &'static str,
}

fn shift(d: &str, n: i64) -> String { parse_day(d).map(|x| day_key(x + time::Duration::days(n))).unwrap_or_else(|| d.to_string()) }
fn met_set(s: &StreakInfo) -> BTreeSet<String> { s.days.iter().filter(|d| d.met == 1).map(|d| d.date.clone()).collect() }

/// The friend streak of two readers from their own streaks, each judged on its own local day (`StreakInfo::today`).
pub fn pair_streak(mine: &StreakInfo, theirs: &StreakInfo) -> PairStreak {
    let (a, b) = (met_set(mine), met_set(theirs));
    let shared: BTreeSet<&String> = a.intersection(&b).collect();
    let day = if mine.today <= theirs.today { mine.today.clone() } else { theirs.today.clone() };
    let mut longest = 0; let mut run = 0; let mut prev: Option<String> = None;
    for d in &shared {
        run = match &prev { Some(p) if shift(p, 1) == **d => run + 1, _ => 1 };
        longest = longest.max(run);
        prev = Some((*d).clone());
    }
    let last = shared.iter().next_back().map(|d| (*d).clone());
    let (current, run_start) = match &last {
        Some(l) if *l >= shift(&day, -1) => {
            let mut n = 0; let mut d = l.clone();
            while shared.contains(&d) { n += 1; d = shift(&d, -1); }
            (n, Some(shift(l, 1 - n)))
        }
        _ => (0, None),
    };
    let kept = current > 0 && last.as_deref().is_some_and(|l| l >= day.as_str());
    let state = if kept { "kept" } else if current > 0 { "waiting" } else if longest > 0 { "lapsed" } else { "none" };
    PairStreak { current, longest, kept, mine_met: a.contains(&day), theirs_met: b.contains(&day), run_start, state, day }
}

fn streak_now(conn: &Connection, uid: i64) -> rusqlite::Result<StreakInfo> { activity::streak_info(conn, uid, &activity::user_today(conn, uid)) }

/// The longest friend streak running for `uid` (judged on `today`), over friends who share their streak both ways.
pub fn best_pair_streak(conn: &Connection, uid: i64, today: &str) -> i64 {
    let run = || -> rusqlite::Result<i64> {
        if !prefs(conn, uid).share_streak { return Ok(0); }
        let fs = friends_of(conn, uid)?;
        if fs.is_empty() { return Ok(0); }
        let mine = activity::streak_info(conn, uid, today)?;
        let mut best = 0;
        for (fid, _) in fs {
            if !prefs(conn, fid).share_streak { continue; }
            best = best.max(pair_streak(&mine, &streak_now(conn, fid)?).current);
        }
        Ok(best)
    };
    run().unwrap_or(0)
}

/// A beat has just met `uid`'s day: friends whose shared streak now reaches a badge get it too, at once, rather than on
/// their own next beat.
pub fn on_day_met(conn: &Connection, uid: i64) -> rusqlite::Result<()> {
    for (fid, _) in friends_of(conn, uid)? { crate::badges::check_badges_prefixed(conn, fid, &activity::user_today(conn, fid), "friend_streak_")?; }
    Ok(())
}

// ---------------- views ----------------

fn week_met(s: &StreakInfo) -> Vec<String> {
    let Some(t) = parse_day(&s.today) else { return Vec::new() };
    let start = day_key(activity::week_start(t));
    let mut v: Vec<String> = s.days.iter().filter(|d| d.met == 1 && d.date >= start && d.date <= s.today).map(|d| d.date.clone()).collect();
    v.sort();
    v
}

/// What `me` sees of friend `fid`: each part as `fid` shares it; the friend streak only when both share their streak.
fn friend_view(conn: &Connection, me: i64, mine: &StreakInfo, my_prefs: Prefs, fid: i64, since: &str) -> ApiResult<Option<Value>> {
    let Some(p) = person(conn, fid)? else { return Ok(None) };
    let fp = prefs(conn, fid);
    let theirs = streak_now(conn, fid)?;
    let streak = fp.share_streak.then(|| json!({ "current": theirs.current, "longest": theirs.longest, "today": theirs.today, "week": week_met(&theirs), "today_met": theirs.days.iter().any(|d| d.date == theirs.today && d.met == 1) }));
    let chapters_week = if fp.share_reading {
        let start = parse_day(&theirs.today).map(|t| day_key(activity::week_start(t))).unwrap_or_default();
        Some(conn.query_row("SELECT count(DISTINCT book * 1000 + chapter) FROM page_credits WHERE user_id=?1 AND date >= ?2", params![fid, start], |r| r.get::<_, i64>(0))?)
    } else { None };
    let badges = if fp.share_badges { Some(crate::badges::user_badges(conn, fid)?.into_iter().filter(|b| b.earned_at.is_some()).collect::<Vec<_>>()) } else { None };
    let pair = (fp.share_streak && my_prefs.share_streak).then(|| pair_streak(mine, &theirs));
    let reactions = |from: i64, to: i64| -> rusqlite::Result<Vec<Value>> {
        let mut st = conn.prepare_cached("SELECT target, kind, created_at FROM friend_reactions WHERE from_id=?1 AND to_id=?2 ORDER BY created_at")?;
        let v = st.query_map(params![from, to], |r| Ok(json!({ "target": r.get::<_, String>(0)?, "kind": r.get::<_, String>(1)?, "created_at": r.get::<_, String>(2)? })))?.collect(); v
    };
    Ok(Some(json!({
        "id": p.id, "handle": p.handle, "display_name": p.display_name, "avatar": p.avatar, "since": since,
        "streak": streak, "chapters_week": chapters_week, "badges": badges, "friend_streak": pair,
        "reactions": { "open": fp.reactions && my_prefs.reactions, "sent": reactions(me, fid)?, "received": reactions(fid, me)? },
    })))
}

/// Invites waiting for `me`, newest first; with `since` (normalized by `strftime`), only those sent after it.
fn incoming_since(conn: &Connection, me: i64, since: Option<&str>) -> rusqlite::Result<Vec<Value>> {
    let mut st = conn.prepare_cached(&format!("SELECT i.id, u.id, u.handle, u.display_name, i.via, i.created_at, u.avatar FROM friend_invites i JOIN users u ON u.id=i.from_id
        WHERE i.to_id=?1 AND i.delivered=1 AND i.declined_at IS NULL AND {LIVE_I} AND u.disabled=0 AND (?2 IS NULL OR i.created_at > ?2)
          AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id=?1 AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?1))
        ORDER BY i.created_at DESC, i.id DESC"))?;
    let v = st.query_map(params![me, since], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "from": { "id": r.get::<_, i64>(1)?, "handle": r.get::<_, String>(2)?, "display_name": r.get::<_, String>(3)?, "avatar": crate::avatars::effective(r.get(1)?, r.get::<_, Option<String>>(6)?.as_deref()) }, "via": r.get::<_, String>(4)?, "created_at": r.get::<_, String>(5)? })))?.collect(); v
}
fn incoming(conn: &Connection, me: i64) -> rusqlite::Result<Vec<Value>> { incoming_since(conn, me, None) }
/// How many invites are waiting for `me` (none while invites are off): rides on every beat, so the app asks for the
/// invites themselves only when the number grows.
pub fn incoming_count(conn: &Connection, me: i64) -> rusqlite::Result<i64> {
    if !prefs(conn, me).invites { return Ok(0); }
    conn.query_row(&format!("SELECT count(*) FROM friend_invites i JOIN users u ON u.id=i.from_id WHERE i.to_id=?1 AND i.delivered=1 AND i.declined_at IS NULL AND {LIVE_I} AND u.disabled=0
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id=?1 AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?1))"), params![me], |r| r.get(0))
}
/// The sender's own record: the handle as typed and when. Never whether it arrived, was declined or exists.
fn outgoing(conn: &Connection, me: i64) -> rusqlite::Result<Vec<Value>> {
    let mut st = conn.prepare_cached(&format!("SELECT id, to_handle, via, created_at FROM friend_invites WHERE from_id=?1 AND {LIVE} ORDER BY created_at DESC"))?;
    let v = st.query_map(params![me], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "handle": r.get::<_, String>(1)?, "via": r.get::<_, String>(2)?, "created_at": r.get::<_, String>(3)? })))?.collect(); v
}

pub fn unseen_reactions(conn: &Connection, me: i64) -> rusqlite::Result<i64> {
    conn.query_row("SELECT count(*) FROM friend_reactions r WHERE r.to_id=?1 AND r.seen_at IS NULL AND EXISTS (SELECT 1 FROM friendships f WHERE (f.a=r.from_id AND f.b=?1) OR (f.b=r.from_id AND f.a=?1))", params![me], |r| r.get(0))
}

pub fn overview(conn: &Connection, me: i64) -> ApiResult<Value> {
    prune(conn, me)?;
    let my_prefs = prefs(conn, me);
    let mine = streak_now(conn, me)?;
    let mut friends = Vec::new();
    for (fid, since) in friends_of(conn, me)? { if let Some(v) = friend_view(conn, me, &mine, my_prefs, fid, &since)? { friends.push(v); } }
    // the longest friend streaks first, then by name
    friends.sort_by(|a, b| {
        let n = |v: &Value| v["friend_streak"]["current"].as_i64().unwrap_or(0);
        n(b).cmp(&n(a)).then_with(|| a["display_name"].as_str().unwrap_or("").to_lowercase().cmp(&b["display_name"].as_str().unwrap_or("").to_lowercase()))
    });
    let discoverable: bool = conn.query_row("SELECT count(*) > 0 FROM contact_hashes WHERE user_id=?1", params![me], |r| r.get(0))?;
    Ok(json!({ "settings": my_prefs, "discoverable": discoverable, "invite_days": INVITE_DAYS, "today": mine.today, "friends": friends, "incoming": incoming(conn, me)?, "outgoing": outgoing(conn, me)?, "unseen_reactions": unseen_reactions(conn, me)? }))
}

// ---------------- handlers ----------------

#[derive(Deserialize)] struct TzQ { tz: Option<i64> }
async fn list(State(s): State<AppState>, AuthUser(u): AuthUser, Query(q): Query<TzQ>) -> ApiResult<Json<Value>> {
    Ok(Json(s.db(move |conn| { activity::remember_offset(conn, u.id, q.tz)?; overview(conn, u.id) }).await?))
}
async fn one(State(s): State<AppState>, AuthUser(u): AuthUser, Path(fid): Path<i64>, Query(q): Query<TzQ>) -> ApiResult<Json<Value>> {
    Ok(Json(s.db(move |conn| {
        activity::remember_offset(conn, u.id, q.tz)?;
        let Some((_, since)) = friends_of(conn, u.id)?.into_iter().find(|f| f.0 == fid) else { return Err(ApiError::not_found("Not in your friends")) };
        friend_view(conn, u.id, &streak_now(conn, u.id)?, prefs(conn, u.id), fid, &since)?.ok_or_else(|| ApiError::not_found("Not in your friends"))
    }).await?))
}

#[derive(Deserialize)] struct InviteIn { handle: String }
async fn invite(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<InviteIn>) -> ApiResult<Json<Value>> {
    let Some(handle) = clean_handle(&b.handle) else { return Err(ApiError::bad("A handle is 3 to 24 letters, digits or _")) };
    if handle == u.handle.to_lowercase() { return Err(ApiError::bad("That is your own handle")); }
    Ok(Json(s.db(move |conn| send_invite(conn, &u, &handle, "handle")).await?))
}
async fn invite_accept(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    Ok(Json(s.db(move |conn| Ok(json!({ "status": "friends", "friend": accept(conn, u.id, id)? }))).await?))
}
async fn invite_decline(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    s.db(move |conn| {
        let n = conn.execute(&format!("UPDATE friend_invites SET declined_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND to_id=?2 AND delivered=1 AND declined_at IS NULL AND {LIVE}"), params![id, u.id])?;
        if n == 0 { return Err(ApiError::not_found(NOT_OPEN)); }
        Ok(())
    }).await?;
    Ok(Json(json!({ "ok": true })))
}
async fn invite_cancel(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    s.db(move |conn| { conn.execute("UPDATE friend_invites SET cancelled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND from_id=?2 AND cancelled_at IS NULL", params![id, u.id])?; Ok(()) }).await?;
    Ok(Json(json!({ "ok": true })))
}
async fn unfriend(State(s): State<AppState>, AuthUser(u): AuthUser, Path(fid): Path<i64>) -> ApiResult<Json<Value>> {
    s.db(move |conn| Ok(sever(conn, u.id, fid)?)).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)] struct PrefsIn { invites: Option<bool>, share_streak: Option<bool>, share_badges: Option<bool>, share_reading: Option<bool>, reactions: Option<bool> }
async fn put_settings(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<PrefsIn>) -> ApiResult<Json<Prefs>> {
    Ok(Json(s.db(move |conn| {
        let raw: String = conn.query_row("SELECT settings FROM users WHERE id=?1", params![u.id], |r| r.get(0))?;
        let mut all: Value = serde_json::from_str(&raw).unwrap_or(json!({}));
        if !all.is_object() { all = json!({}); }
        let cur = prefs_of(&all);
        let next = Prefs { invites: b.invites.unwrap_or(cur.invites), share_streak: b.share_streak.unwrap_or(cur.share_streak), share_badges: b.share_badges.unwrap_or(cur.share_badges), share_reading: b.share_reading.unwrap_or(cur.share_reading), reactions: b.reactions.unwrap_or(cur.reactions) };
        all["friends"] = serde_json::to_value(next).unwrap();
        conn.execute("UPDATE users SET settings=?1 WHERE id=?2", params![all.to_string(), u.id])?;
        // tokens are invites: switching invites off withdraws the ones out there
        if !next.invites { conn.execute("UPDATE friend_tokens SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second') WHERE user_id=?1 AND used_at IS NULL", params![u.id])?; }
        Ok(next)
    }).await?))
}

#[derive(Deserialize)] struct SinceQ { since: Option<String> }
/// New invites to me since `since` (an ISO 8601 time; without it, every one waiting), for a phone's notification with
/// no push service: the app polls this in the background and when it comes forward. `now` is the server's clock, the
/// next `since` when nothing new came. None while my invites are off; blocks and declines as in `GET /friends`.
async fn invites_incoming(State(s): State<AppState>, AuthUser(u): AuthUser, Query(q): Query<SinceQ>) -> ApiResult<Json<Value>> {
    let raw = q.since.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    if raw.as_ref().is_some_and(|s| s.len() > 40) { return Err(ApiError::bad("since: an ISO 8601 time")); }
    Ok(Json(s.db(move |conn| {
        limit(conn, u.id, "poll", POLL_LIMITS)?;
        let since: Option<String> = match raw {
            Some(r) => Some(conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', ?1)", params![r], |r| r.get::<_, Option<String>>(0))?.ok_or_else(|| ApiError::bad("since: an ISO 8601 time"))?),
            None => None,
        };
        let now: String = conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |r| r.get(0))?;
        if !prefs(conn, u.id).invites { return Ok(json!({ "open": false, "now": now, "invites": [] })); }
        Ok(json!({ "open": true, "now": now, "invites": incoming_since(conn, u.id, since.as_deref())? }))
    }).await?))
}

// ---------------- QR and link tokens ----------------

/// A fresh token for the QR code and the share link. It stands for "an invite to me": opaque, random (about 119 bits),
/// kept server-side, single-use and gone in TOKEN_SECS. Making one withdraws any earlier unused one.
async fn token_new(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Value>> {
    Ok(Json(s.db(move |conn| {
        if !prefs(conn, u.id).invites { return Err(ApiError::new(409, "Invites are off in your friends settings")); }
        limit(conn, u.id, "token", TOKEN_LIMITS)?;
        prune(conn, u.id)?;
        conn.execute("UPDATE friend_tokens SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second') WHERE user_id=?1 AND used_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')", params![u.id])?;
        let token = random_token(20);
        conn.execute("INSERT INTO friend_tokens (token, user_id, expires_at) VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now',?3))", params![token, u.id, format!("+{TOKEN_SECS} seconds")])?;
        let expires_at: String = conn.query_row("SELECT expires_at FROM friend_tokens WHERE token=?1", params![token], |r| r.get(0))?;
        Ok(json!({ "token": token, "expires_at": expires_at, "ttl_secs": TOKEN_SECS, "path": format!("/friends?t={token}") }))
    }).await?))
}
/// The owner of a live token that `me` may use: unused, unexpired, owner takes invites, no block, not `me`.
fn token_owner(conn: &Connection, me: i64, token: &str) -> ApiResult<Person> {
    let owner: Option<i64> = conn.query_row("SELECT user_id FROM friend_tokens WHERE token=?1 AND used_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')", params![token], |r| r.get(0)).optional()?;
    let Some(owner) = owner else { return Err(ApiError::not_found(BAD_TOKEN)) };
    if owner == me { return Err(ApiError::bad("That is your own code")); }
    if !prefs(conn, owner).invites || blocked_either(conn, me, owner)? { return Err(ApiError::not_found(BAD_TOKEN)); }
    person(conn, owner)?.ok_or_else(|| ApiError::not_found(BAD_TOKEN))
}
fn valid_token_shape(t: &str) -> bool { (16..=40).contains(&t.len()) && t.chars().all(|c| c.is_ascii_alphanumeric()) }
async fn token_peek(State(s): State<AppState>, AuthUser(u): AuthUser, Path(t): Path<String>) -> ApiResult<Json<Value>> {
    Ok(Json(s.db(move |conn| {
        limit(conn, u.id, "redeem", REDEEM_LIMITS)?;
        if !valid_token_shape(&t) { return Err(ApiError::not_found(BAD_TOKEN)); }
        let p = token_owner(conn, u.id, &t)?;
        let friends = are_friends(conn, u.id, p.id)?;
        Ok(json!({ "handle": p.handle, "display_name": p.display_name, "avatar": p.avatar, "friends": friends }))
    }).await?))
}
#[derive(Deserialize)] struct RedeemIn { token: String }
/// Scanning a code (or opening a link) sends its owner an invite from the scanner, as typing their handle would; the
/// owner still accepts. An open invite from the owner to the scanner is accepted instead.
async fn token_redeem(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<RedeemIn>) -> ApiResult<Json<Value>> {
    Ok(Json(s.db(move |conn| {
        limit(conn, u.id, "redeem", REDEEM_LIMITS)?;
        if !valid_token_shape(&b.token) { return Err(ApiError::not_found(BAD_TOKEN)); }
        let p = token_owner(conn, u.id, &b.token)?;
        let n = conn.execute("UPDATE friend_tokens SET used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), used_by=?2 WHERE token=?1 AND used_at IS NULL", params![b.token, u.id])?;
        if n == 0 { return Err(ApiError::not_found(BAD_TOKEN)); }
        let who = json!({ "id": p.id, "handle": p.handle, "display_name": p.display_name, "avatar": p.avatar });
        if are_friends(conn, u.id, p.id)? { return Ok(json!({ "status": "friends", "friend": who })); }
        if let Some(inv) = open_invite(conn, p.id, u.id)? { accept(conn, u.id, inv)?; return Ok(json!({ "status": "friends", "friend": who })); }
        prune(conn, u.id)?;
        // a live invite already out to them (typed earlier) is delivered now, as sent now (so a phone's check for new invites
        // sees it): they showed the code themselves
        let live: Option<i64> = conn.query_row(&format!("SELECT id FROM friend_invites WHERE from_id=?1 AND to_handle=?2 AND {LIVE}"), params![u.id, p.handle], |r| r.get(0)).optional()?;
        match live {
            Some(id) => { conn.execute("UPDATE friend_invites SET to_id=?2, delivered=1, declined_at=NULL, via='qr', created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1", params![id, p.id])?; }
            None => { conn.execute("INSERT INTO friend_invites (from_id, to_handle, to_id, delivered, via) VALUES (?1,?2,?3,1,'qr')", params![u.id, p.handle, p.id])?; }
        }
        Ok(json!({ "status": "sent", "friend": who }))
    }).await?))
}
/// The owner's view of one of their tokens, polled while the code is on screen: whether it has been used, and the
/// invite it produced while that is still open.
async fn token_status(State(s): State<AppState>, AuthUser(u): AuthUser, Path(t): Path<String>) -> ApiResult<Json<Value>> {
    Ok(Json(s.db(move |conn| {
        let row: Option<(Option<i64>, bool)> = conn.query_row("SELECT used_by, expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM friend_tokens WHERE token=?1 AND user_id=?2", params![t, u.id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        let Some((used_by, expired)) = row else { return Err(ApiError::not_found(BAD_TOKEN)) };
        let invite = match used_by {
            Some(by) => match open_invite(conn, by, u.id)? {
                Some(id) => person(conn, by)?.map(|p| json!({ "id": id, "from": p })),
                None => None,
            },
            None => None,
        };
        let friends = match used_by { Some(by) => are_friends(conn, u.id, by)?, None => false };
        Ok(json!({ "used": used_by.is_some(), "expired": expired, "invite": invite, "friends": friends }))
    }).await?))
}

// ---------------- reactions ----------------

#[derive(Deserialize)] struct ReactIn { to: i64, target: String, kind: String }
/// Whether `target` names something of `to`'s that `from` may react to now.
fn target_ok(conn: &Connection, from: i64, to: i64, target: &str) -> ApiResult<bool> {
    if let Some(code) = target.strip_prefix("badge:") {
        if !prefs(conn, to).share_badges { return Ok(false); }
        return Ok(conn.query_row("SELECT 1 FROM badges WHERE user_id=?1 AND code=?2", params![to, code], |_| Ok(())).optional()?.is_some());
    }
    if let Some(rest) = target.strip_prefix("streak:") {
        let Some((n, start)) = rest.split_once(':') else { return Ok(false) };
        let Ok(n) = n.parse::<i64>() else { return Ok(false) };
        if !STREAK_MILESTONES.contains(&n) || !prefs(conn, from).share_streak || !prefs(conn, to).share_streak { return Ok(false); }
        let p = pair_streak(&streak_now(conn, from)?, &streak_now(conn, to)?);
        return Ok(p.current >= n && p.run_start.as_deref() == Some(start));
    }
    Ok(false)
}
async fn react(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<ReactIn>) -> ApiResult<Json<Value>> {
    if !REACTIONS.contains(&b.kind.as_str()) { return Err(ApiError::bad("kind: heart, smile, clap or seal")); }
    if b.target.len() > 64 { return Err(ApiError::bad("target")); }
    Ok(Json(s.db(move |conn| {
        if !are_friends(conn, u.id, b.to)? || blocked_either(conn, u.id, b.to)? { return Err(ApiError::not_found("Not in your friends")); }
        if !prefs(conn, u.id).reactions { return Err(ApiError::new(409, "Reactions are off in your friends settings")); }
        if !prefs(conn, b.to).reactions { return Err(ApiError::new(409, "This friend is not taking reactions")); }
        if !target_ok(conn, u.id, b.to, &b.target)? { return Err(ApiError::not_found("Nothing to react to there")); }
        let existing: Option<(String, String)> = conn.query_row("SELECT kind, created_at FROM friend_reactions WHERE from_id=?1 AND to_id=?2 AND target=?3", params![u.id, b.to, b.target], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        if let Some((kind, at)) = existing { return Ok(json!({ "created": false, "reaction": { "target": b.target, "kind": kind, "created_at": at } })); }
        limit(conn, u.id, "react", REACT_LIMITS)?;
        conn.execute("INSERT INTO friend_reactions (from_id, to_id, target, kind) VALUES (?1,?2,?3,?4)", params![u.id, b.to, b.target, b.kind])?;
        let at: String = conn.query_row("SELECT created_at FROM friend_reactions WHERE id=?1", params![conn.last_insert_rowid()], |r| r.get(0))?;
        Ok(json!({ "created": true, "reaction": { "target": b.target, "kind": b.kind, "created_at": at } }))
    }).await?))
}
/// Reactions friends have left on my badges and our friend streaks, newest first. From friends only: a removal or a
/// block takes theirs away.
async fn reactions(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Value>> {
    Ok(Json(s.db(move |conn| {
        let mut st = conn.prepare_cached("SELECT r.id, r.target, r.kind, r.created_at, r.seen_at IS NOT NULL, u.id, u.handle, u.display_name, u.avatar FROM friend_reactions r JOIN users u ON u.id=r.from_id
            WHERE r.to_id=?1 AND u.disabled=0 AND EXISTS (SELECT 1 FROM friendships f WHERE (f.a=r.from_id AND f.b=?1) OR (f.b=r.from_id AND f.a=?1)) ORDER BY r.created_at DESC, r.id DESC LIMIT 300")?;
        let v: Vec<Value> = st.query_map(params![u.id], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "target": r.get::<_, String>(1)?, "kind": r.get::<_, String>(2)?, "created_at": r.get::<_, String>(3)?, "seen": r.get::<_, bool>(4)?, "from": { "id": r.get::<_, i64>(5)?, "handle": r.get::<_, String>(6)?, "display_name": r.get::<_, String>(7)?, "avatar": crate::avatars::effective(r.get(5)?, r.get::<_, Option<String>>(8)?.as_deref()) } })))?.collect::<Result<_, _>>()?;
        Ok(json!({ "open": prefs(conn, u.id).reactions, "reactions": v }))
    }).await?))
}
async fn reactions_seen(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Value>> {
    s.db(move |conn| { conn.execute("UPDATE friend_reactions SET seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE to_id=?1 AND seen_at IS NULL", params![u.id])?; Ok(()) }).await?;
    Ok(Json(json!({ "ok": true })))
}

// ---------------- contacts ----------------

fn is_hash(h: &str) -> bool { h.len() == 64 && h.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) }
#[derive(Deserialize)] struct HashesIn { hashes: Vec<String> }
/// "Let contacts find me": the reader's OWN phone numbers and emails, hashed on the device; never their contacts.
async fn discoverable_put(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<HashesIn>) -> ApiResult<Json<Value>> {
    let hashes: BTreeSet<String> = b.hashes.iter().map(|h| h.to_lowercase()).collect();
    if hashes.is_empty() || hashes.len() > MAX_OWN_HASHES || !hashes.iter().all(|h| is_hash(h)) { return Err(ApiError::bad(format!("hashes: 1 to {MAX_OWN_HASHES} SHA-256 hex strings"))); }
    Ok(Json(s.db(move |conn| {
        limit(conn, u.id, "discover", DISCOVER_LIMITS)?;
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM contact_hashes WHERE user_id=?1", params![u.id])?;
        for h in &hashes { tx.execute("INSERT OR IGNORE INTO contact_hashes (user_id, hash) VALUES (?1, ?2)", params![u.id, h])?; }
        tx.commit()?;
        // a banned person's own phone number or email on this account is ban evasion (bans.rs)
        let marks: Vec<(&'static str, String)> = hashes.iter().map(|h| ("contact", h.clone())).collect();
        if !crate::bans::evasion(conn, u.id, &marks)? { return Err(ApiError::forbidden("this account has been suspended")); }
        Ok(json!({ "discoverable": true, "count": hashes.len() }))
    }).await?))
}
async fn discoverable_delete(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Value>> {
    s.db(move |conn| { conn.execute("DELETE FROM contact_hashes WHERE user_id=?1", params![u.id])?; Ok(()) }).await?;
    Ok(Json(json!({ "discoverable": false })))
}
/// "Find friends from my contacts": the hashes are matched in memory and dropped; nothing of the request is stored but a
/// rate-limit tick. Only readers who opted in to being found, who take invites, with no block either way and not
/// already friends, come back, as handle and display name.
async fn contacts_match(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<HashesIn>) -> ApiResult<Json<Value>> {
    if b.hashes.len() > MAX_MATCH_HASHES { return Err(ApiError::bad(format!("at most {MAX_MATCH_HASHES} hashes at once"))); }
    let hashes: BTreeSet<String> = b.hashes.iter().map(|h| h.to_lowercase()).collect();
    if !hashes.iter().all(|h| is_hash(h)) { return Err(ApiError::bad("hashes: SHA-256 hex strings")); }
    Ok(Json(s.db(move |conn| {
        limit(conn, u.id, "match", MATCH_LIMITS)?;
        let list = serde_json::to_string(&hashes).unwrap();
        let mut st = conn.prepare("SELECT DISTINCT u.id, u.handle, u.display_name, u.avatar FROM contact_hashes h JOIN users u ON u.id=h.user_id
            WHERE h.hash IN (SELECT value FROM json_each(?1)) AND u.id<>?2 AND u.disabled=0
              AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id=?2 AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?2))
              AND NOT EXISTS (SELECT 1 FROM friendships f WHERE (f.a=?2 AND f.b=u.id) OR (f.a=u.id AND f.b=?2))
            ORDER BY u.handle")?;
        let rows: Vec<(i64, String, String, Option<String>)> = st.query_map(params![list, u.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<_, _>>()?;
        let matches: Vec<Value> = rows.into_iter().filter(|(id, _, _, _)| prefs(conn, *id).invites).map(|(id, h, d, a)| json!({ "handle": h, "display_name": d, "avatar": crate::avatars::effective(id, a.as_deref()) })).collect();
        Ok(json!({ "matches": matches }))
    }).await?))
}
#[derive(Deserialize)] struct ContactInviteIn { handle: String }
/// An invite to a contacts match: the same as by handle, marked as found through contacts.
async fn contacts_invite(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<ContactInviteIn>) -> ApiResult<Json<Value>> {
    let Some(handle) = clean_handle(&b.handle) else { return Err(ApiError::bad("A handle is 3 to 24 letters, digits or _")) };
    if handle == u.handle.to_lowercase() { return Err(ApiError::bad("That is your own handle")); }
    Ok(Json(s.db(move |conn| send_invite(conn, &u, &handle, "contacts")).await?))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list))
        .route("/settings", put(put_settings))
        .route("/invite", post(invite))
        .route("/invites/incoming", get(invites_incoming))
        .route("/invites/{id}/accept", post(invite_accept))
        .route("/invites/{id}/decline", post(invite_decline))
        .route("/invites/{id}", axum::routing::delete(invite_cancel))
        .route("/token", post(token_new))
        .route("/token/redeem", post(token_redeem))
        .route("/token/{t}", get(token_peek))
        .route("/token/{t}/status", get(token_status))
        .route("/reactions", get(reactions).post(react))
        .route("/reactions/seen", post(reactions_seen))
        .route("/discoverable", put(discoverable_put).delete(discoverable_delete))
        .route("/contacts/match", post(contacts_match))
        .route("/contacts/invite", post(contacts_invite))
        .route("/{id}", get(one).delete(unfriend))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity::Day;
    use crate::testkit::{app, call, user};
    use serde_json::Value;

    const NULL: Value = Value::Null;
    fn met(pool: &crate::db::DbPool, uid: i64, days: &[&str]) {
        let c = pool.get().unwrap();
        for d in days { c.execute("INSERT OR REPLACE INTO activity_days (user_id, date, active_seconds, pages, chapters) VALUES (?1, ?2, 700, 1, 1)", params![uid, d]).unwrap(); }
    }
    fn today(pool: &crate::db::DbPool, uid: i64) -> String { activity::user_today(&pool.get().unwrap(), uid) }
    fn back(d: &str, n: i64) -> String { shift(d, -n) }
    async fn befriend(app: &axum::Router, a: &(i64, String), b: &(i64, String), b_handle: &str) {
        assert_eq!(call(app, "POST", "/friends/invite", Some(&a.1), json!({ "handle": b_handle })).await.1["status"], "sent");
        let (_, v) = call(app, "GET", "/friends", Some(&b.1), NULL).await;
        let id = v["incoming"][0]["id"].as_i64().unwrap();
        assert_eq!(call(app, "POST", &format!("/friends/invites/{id}/accept"), Some(&b.1), NULL).await.0, 200);
    }
    fn set_prefs(pool: &crate::db::DbPool, uid: i64, v: Value) { pool.get().unwrap().execute("UPDATE users SET settings=?1 WHERE id=?2", params![json!({ "friends": v }).to_string(), uid]).unwrap(); }

    #[test]
    fn the_live_window_is_invite_days() { for l in [LIVE, LIVE_I] { assert!(l.contains(&format!("-{INVITE_DAYS} days"))); } }

    #[tokio::test]
    async fn an_invite_answers_alike_whatever_the_handle_is() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        let ben = user(&pool, "ben");
        let cara = user(&pool, "cara");
        let dan = user(&pool, "dan");
        set_prefs(&pool, cara.0, json!({ "invites": false }));
        pool.get().unwrap().execute("INSERT INTO blocks (user_id, blocked_id) VALUES (?1, ?2)", params![dan.0, anna.0]).unwrap();
        // a real account, one that does not exist, one with invites off, one that blocked the sender
        let mut replies = Vec::new();
        for h in ["ben", "no_such_one", "cara", "@Dan"] { replies.push(call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": h })).await); }
        assert!(replies.iter().all(|r| *r == (200, json!({ "status": "sent" }))), "{replies:?}");
        // asking again changes nothing and says the same
        assert_eq!(call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": "no_such_one" })).await, (200, json!({ "status": "sent" })));
        // the sender's own list holds the four alike: the handle as typed and when, nothing more
        let (_, v) = call(&app, "GET", "/friends", Some(&anna.1), NULL).await;
        let out = v["outgoing"].as_array().unwrap();
        assert_eq!(out.len(), 4);
        for o in out { let mut keys: Vec<&str> = o.as_object().unwrap().keys().map(|k| k.as_str()).collect(); keys.sort(); assert_eq!(keys, ["created_at", "handle", "id", "via"]); }
        // only the one who takes invites and has not blocked the sender sees it
        let incoming = |t: &String| { let t = t.clone(); let app = app.clone(); async move { call(&app, "GET", "/friends", Some(&t), NULL).await.1["incoming"].as_array().unwrap().len() } };
        assert_eq!((incoming(&ben.1).await, incoming(&cara.1).await, incoming(&dan.1).await), (1, 0, 0));
        let (_, v) = call(&app, "GET", "/friends", Some(&ben.1), NULL).await;
        assert_eq!(v["incoming"][0]["from"]["handle"], "anna");
        // a malformed handle cannot exist, so it may say so; one's own handle too
        assert_eq!(call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": "x" })).await.0, 400);
        assert_eq!(call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": "Anna" })).await.0, 400);
    }

    #[tokio::test]
    async fn invites_are_rate_limited_before_any_lookup() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        user(&pool, "ben");
        for i in 0..10 { assert_eq!(call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": format!("probe_{i}") })).await.0, 200); }
        // the eleventh within ten minutes is refused, a real handle exactly as a missing one
        assert_eq!(call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": "ben" })).await.0, 429);
        assert_eq!(call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": "probe_x" })).await.0, 429);
        let cara = user(&pool, "cara");
        assert_eq!(call(&app, "POST", "/friends/invite", Some(&cara.1), json!({ "handle": "ben" })).await.0, 200);
        // the day's allowance: 40 across the day, however spaced out
        let age = || pool.get().unwrap().execute("UPDATE friend_events SET at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 hours') WHERE user_id=?1", params![anna.0]).unwrap();
        for i in 0..30 { age(); assert_eq!(call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": format!("later_{i}") })).await.0, 200, "invite {i}"); }
        age();
        assert_eq!(call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": "one_more" })).await.0, 429);
    }

    #[tokio::test]
    async fn accepting_declining_and_what_the_sender_sees() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        let ben = user(&pool, "ben");
        let cara = user(&pool, "cara");
        // before anything, nobody can see anybody
        assert_eq!(call(&app, "GET", &format!("/friends/{}", ben.0), Some(&anna.1), NULL).await.0, 404);
        befriend(&app, &anna, &ben, "ben").await;
        let (_, a) = call(&app, "GET", "/friends", Some(&anna.1), NULL).await;
        let (_, b) = call(&app, "GET", "/friends", Some(&ben.1), NULL).await;
        assert_eq!((a["friends"][0]["handle"].as_str(), b["friends"][0]["handle"].as_str()), (Some("ben"), Some("anna")));
        assert_eq!(a["outgoing"].as_array().unwrap().len(), 0, "an accepted invite leaves the list");
        assert_eq!(call(&app, "GET", &format!("/friends/{}", ben.0), Some(&anna.1), NULL).await.0, 200);
        // a decline: gone for the one who declined, unchanged for the sender
        call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": "cara" })).await;
        let before = call(&app, "GET", "/friends", Some(&anna.1), NULL).await.1["outgoing"].clone();
        let id = call(&app, "GET", "/friends", Some(&cara.1), NULL).await.1["incoming"][0]["id"].as_i64().unwrap();
        assert_eq!(call(&app, "POST", &format!("/friends/invites/{id}/decline"), Some(&cara.1), NULL).await.0, 200);
        assert_eq!(call(&app, "GET", "/friends", Some(&cara.1), NULL).await.1["incoming"].as_array().unwrap().len(), 0);
        assert_eq!(call(&app, "GET", "/friends", Some(&anna.1), NULL).await.1["outgoing"], before);
        // a declined invite cannot be accepted later, nor re-delivered by cancelling and sending again
        assert_eq!(call(&app, "POST", &format!("/friends/invites/{id}/accept"), Some(&cara.1), NULL).await.0, 404);
        call(&app, "DELETE", &format!("/friends/invites/{id}"), Some(&anna.1), NULL).await;
        assert_eq!(call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": "cara" })).await.1["status"], "sent");
        assert_eq!(call(&app, "GET", "/friends", Some(&cara.1), NULL).await.1["incoming"].as_array().unwrap().len(), 0);
        // someone else's invite cannot be accepted by a third party
        let dan = user(&pool, "dan");
        call(&app, "POST", "/friends/invite", Some(&dan.1), json!({ "handle": "ben" })).await;
        let id = call(&app, "GET", "/friends", Some(&ben.1), NULL).await.1["incoming"][0]["id"].as_i64().unwrap();
        assert_eq!(call(&app, "POST", &format!("/friends/invites/{id}/accept"), Some(&anna.1), NULL).await.0, 404);
        // an invite lapses for both sides after INVITE_DAYS
        pool.get().unwrap().execute("UPDATE friend_invites SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-31 days') WHERE id=?1", params![id]).unwrap();
        assert_eq!(call(&app, "GET", "/friends", Some(&ben.1), NULL).await.1["incoming"].as_array().unwrap().len(), 0);
        assert_eq!(call(&app, "GET", "/friends", Some(&dan.1), NULL).await.1["outgoing"].as_array().unwrap().len(), 0);
        // removing a friend ends it for both
        assert_eq!(call(&app, "DELETE", &format!("/friends/{}", ben.0), Some(&anna.1), NULL).await.0, 200);
        assert_eq!(call(&app, "GET", "/friends", Some(&ben.1), NULL).await.1["friends"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn new_invites_since_a_time_for_the_phone_to_poll() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        let ben = user(&pool, "ben");
        let cara = user(&pool, "cara");
        let poll = |t: &String, q: &str| { let (t, q, app) = (t.clone(), q.to_string(), app.clone()); async move { call(&app, "GET", &format!("/friends/invites/incoming{q}"), Some(&t), NULL).await } };
        let handles = |v: &Value| v["invites"].as_array().unwrap().iter().map(|i| i["from"]["handle"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        // signed out: nothing
        assert_eq!(call(&app, "GET", "/friends/invites/incoming", None, NULL).await.0, 401);
        // nothing yet; `now` is the next `since`
        let (st, v) = poll(&ben.1, "").await;
        assert_eq!((st, v["open"].as_bool(), v["invites"].as_array().map(|a| a.len())), (200, Some(true), Some(0)));
        let mark = v["now"].as_str().unwrap().to_string();
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        // an invite after the mark is new, with who sent it; one before it is not
        call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": "ben" })).await;
        pool.get().unwrap().execute("UPDATE friend_invites SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour') WHERE from_id=?1", params![anna.0]).unwrap();
        call(&app, "POST", "/friends/invite", Some(&cara.1), json!({ "handle": "ben" })).await;
        let (_, v) = poll(&ben.1, &format!("?since={mark}")).await;
        assert_eq!(handles(&v), ["cara"]);
        let inv = &v["invites"][0];
        assert_eq!((inv["from"]["display_name"].as_str(), inv["via"].as_str()), (Some("Cara"), Some("handle")));
        assert!(inv["id"].as_i64().is_some() && inv["created_at"].as_str().is_some() && inv["from"]["avatar"].as_str().is_some());
        // since the newest one seen: nothing more; without `since`, every invite waiting, newest first
        let (_, v) = poll(&ben.1, &format!("?since={}", inv["created_at"].as_str().unwrap())).await;
        assert_eq!(v["invites"].as_array().unwrap().len(), 0);
        assert_eq!(handles(&poll(&ben.1, "").await.1), ["cara", "anna"]);
        // another offset spelling of a time reads the same; something that is not a time is a 400
        assert_eq!(handles(&poll(&ben.1, "?since=2000-01-01T01:00:00%2B01:00").await.1), ["cara", "anna"]);
        assert_eq!(poll(&ben.1, "?since=yesterday").await.0, 400);
        // the sender never sees their own invite here
        assert_eq!(poll(&cara.1, "").await.1["invites"].as_array().unwrap().len(), 0);
        // a block either way takes an invite out; a declined one is gone too
        pool.get().unwrap().execute("INSERT INTO blocks (user_id, blocked_id) VALUES (?1, ?2)", params![cara.0, ben.0]).unwrap();
        assert_eq!(handles(&poll(&ben.1, "").await.1), ["anna"]);
        let id = v_id(&poll(&ben.1, "").await.1);
        call(&app, "POST", &format!("/friends/invites/{id}/decline"), Some(&ben.1), NULL).await;
        assert_eq!(poll(&ben.1, "").await.1["invites"].as_array().unwrap().len(), 0);
        // invites off: none at all, even one delivered before
        let dan = user(&pool, "dan");
        call(&app, "POST", "/friends/invite", Some(&dan.1), json!({ "handle": "ben" })).await;
        assert_eq!(handles(&poll(&ben.1, "").await.1), ["dan"]);
        call(&app, "PUT", "/friends/settings", Some(&ben.1), json!({ "invites": false })).await;
        let (st, v) = poll(&ben.1, "").await;
        assert_eq!((st, v["open"].as_bool(), v["invites"].as_array().map(|a| a.len())), (200, Some(false), Some(0)));
        assert_eq!(incoming_count(&pool.get().unwrap(), ben.0).unwrap(), 0);
        call(&app, "PUT", "/friends/settings", Some(&ben.1), json!({ "invites": true })).await;
        assert_eq!(incoming_count(&pool.get().unwrap(), ben.0).unwrap(), 1);
    }
    fn v_id(v: &Value) -> i64 { v["invites"][0]["id"].as_i64().unwrap() }

    #[tokio::test]
    async fn the_beat_carries_the_invites_waiting_and_polling_is_rate_limited() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        let ben = user(&pool, "ben");
        let beat = || { let (app, t) = (app.clone(), ben.1.clone()); async move { call(&app, "POST", "/activity/beat", Some(&t), json!({ "session_id": "session-1234", "active": false, "visible": true })).await.1["incoming_invites"].as_i64() } };
        assert_eq!(beat().await, Some(0));
        call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": "ben" })).await;
        assert_eq!(beat().await, Some(1));
        for i in 0..60 { assert_eq!(call(&app, "GET", "/friends/invites/incoming", Some(&ben.1), NULL).await.0, 200, "poll {i}"); }
        assert_eq!(call(&app, "GET", "/friends/invites/incoming", Some(&ben.1), NULL).await.0, 429);
    }

    #[tokio::test]
    async fn a_code_scanned_after_a_typed_invite_arrives_as_new() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        let ben = user(&pool, "ben");
        // Ben has invites off when Anna types his handle: recorded for her, never delivered
        call(&app, "PUT", "/friends/settings", Some(&ben.1), json!({ "invites": false })).await;
        call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": "ben" })).await;
        pool.get().unwrap().execute("UPDATE friend_invites SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')", []).unwrap();
        call(&app, "PUT", "/friends/settings", Some(&ben.1), json!({ "invites": true })).await;
        let mark = call(&app, "GET", "/friends/invites/incoming", Some(&ben.1), NULL).await.1["now"].as_str().unwrap().to_string();
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        let t = call(&app, "POST", "/friends/token", Some(&ben.1), NULL).await.1["token"].as_str().unwrap().to_string();
        assert_eq!(call(&app, "POST", "/friends/token/redeem", Some(&anna.1), json!({ "token": t })).await.1["status"], "sent");
        let (_, v) = call(&app, "GET", &format!("/friends/invites/incoming?since={mark}"), Some(&ben.1), NULL).await;
        assert_eq!((v["invites"].as_array().unwrap().len(), v["invites"][0]["via"].as_str()), (1, Some("qr")));
    }

    #[tokio::test]
    async fn inviting_someone_who_invited_you_accepts() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        let ben = user(&pool, "ben");
        call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": "ben" })).await;
        let (st, v) = call(&app, "POST", "/friends/invite", Some(&ben.1), json!({ "handle": "anna" })).await;
        assert_eq!((st, v["status"].as_str(), v["friend"]["handle"].as_str()), (200, Some("friends"), Some("anna")));
        assert_eq!(call(&app, "GET", "/friends", Some(&anna.1), NULL).await.1["friends"][0]["handle"], "ben");
    }

    #[tokio::test]
    async fn friends_see_only_what_each_shares() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        let ben = user(&pool, "ben");
        befriend(&app, &anna, &ben, "ben").await;
        let t = today(&pool, ben.0);
        met(&pool, ben.0, &[&t, &back(&t, 1)]);
        pool.get().unwrap().execute("INSERT INTO page_credits (user_id, book, chapter, date, dwell_seconds) VALUES (?1, 43, 3, ?2, 100)", params![ben.0, t]).unwrap();
        pool.get().unwrap().execute("INSERT INTO badges (user_id, code) VALUES (?1, 'first_page')", params![ben.0]).unwrap();
        pool.get().unwrap().execute("INSERT INTO reading_positions (user_id, book, chapter, verse) VALUES (?1, 43, 3, 16)", params![ben.0]).unwrap();
        let (_, v) = call(&app, "GET", &format!("/friends/{}", ben.0), Some(&anna.1), NULL).await;
        assert_eq!(v["streak"]["current"], 2);
        assert!(v["streak"]["week"].as_array().unwrap().iter().any(|d| d == &json!(t)));
        assert_eq!(v["chapters_week"], 1);
        assert_eq!(v["badges"][0]["code"], "first_page");
        // never the reading position, outlines or groups
        let text = v.to_string();
        for k in ["position", "outline", "group", "verse"] { assert!(!text.contains(k), "{k} in {text}"); }
        // each switch hides its part
        assert_eq!(call(&app, "PUT", "/friends/settings", Some(&ben.1), json!({ "share_streak": false, "share_badges": false, "share_reading": false })).await.0, 200);
        let (_, v) = call(&app, "GET", &format!("/friends/{}", ben.0), Some(&anna.1), NULL).await;
        assert!(v["streak"].is_null() && v["badges"].is_null() && v["chapters_week"].is_null() && v["friend_streak"].is_null(), "{v}");
        let (_, mine) = call(&app, "GET", "/friends", Some(&ben.1), NULL).await;
        assert_eq!(mine["settings"], json!({ "invites": true, "share_streak": false, "share_badges": false, "share_reading": false, "reactions": true }));
    }

    fn info(today: &str, met_days: &[&str]) -> StreakInfo {
        StreakInfo { today: today.into(), current: 0, longest: 0, today_active_seconds: 0, today_goal_seconds: 600, days: met_days.iter().map(|d| Day { date: d.to_string(), active_seconds: 700, pages: 1, met: 1 }).collect() }
    }

    #[test]
    fn a_friend_streak_counts_days_both_met_on_the_same_date() {
        let a = info("2026-09-26", &["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"]);
        let b = info("2026-09-26", &["2026-09-21", "2026-09-23", "2026-09-24", "2026-09-25"]);
        let p = pair_streak(&a, &b);
        // 23, 24, 25 shared; the 26th is still open for b
        assert_eq!((p.current, p.longest, p.kept, p.state, p.mine_met, p.theirs_met), (3, 3, false, "waiting", true, false));
        assert_eq!(p.run_start.as_deref(), Some("2026-09-23"));
        let b = info("2026-09-26", &["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"]);
        let p = pair_streak(&a, &b);
        assert_eq!((p.current, p.kept, p.state), (4, true, "kept"));
        // symmetric
        assert_eq!(pair_streak(&b, &a).current, 4);
    }

    #[test]
    fn a_friend_streak_lapses_gently_and_starts_again() {
        let a = info("2026-09-26", &["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-24"]);
        let b = info("2026-09-26", &["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-25"]);
        let p = pair_streak(&a, &b);
        assert_eq!((p.current, p.longest, p.state, p.run_start), (0, 3, "lapsed", None));
        let a = info("2026-09-26", &["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-26"]);
        let b = info("2026-09-26", &["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-26"]);
        let p = pair_streak(&a, &b);
        assert_eq!((p.current, p.longest, p.state), (1, 3, "kept"));
        assert_eq!(pair_streak(&info("2026-09-26", &[]), &info("2026-09-26", &["2026-09-26"])).state, "none");
    }

    #[test]
    fn a_friend_streak_waits_for_the_friend_still_on_yesterday() {
        // Anna in Sydney is on the 27th, Ben in Denver still on the 26th: the pair's day is the 26th
        let anna = info("2026-09-27", &["2026-09-25", "2026-09-26", "2026-09-27"]);
        let ben = info("2026-09-26", &["2026-09-25", "2026-09-26"]);
        let p = pair_streak(&anna, &ben);
        assert_eq!((p.day.as_str(), p.current, p.kept), ("2026-09-26", 2, true));
        // Denver reaches the 27th: kept until Ben reads, and alive meanwhile
        let ben = info("2026-09-27", &["2026-09-25", "2026-09-26"]);
        let p = pair_streak(&anna, &ben);
        assert_eq!((p.day.as_str(), p.current, p.kept, p.state, p.mine_met, p.theirs_met), ("2026-09-27", 2, false, "waiting", true, false));
        // Sydney on the 28th, Denver still the 27th with nothing read: the run holds until Denver's midnight
        let anna = info("2026-09-28", &["2026-09-25", "2026-09-26", "2026-09-27"]);
        assert_eq!(pair_streak(&anna, &ben).current, 2);
        // Denver on the 28th with the 27th unmet: over
        let ben = info("2026-09-28", &["2026-09-25", "2026-09-26"]);
        assert_eq!(pair_streak(&anna, &ben).state, "lapsed");
    }

    #[tokio::test]
    async fn friend_streak_badges_reach_both_friends() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        let ben = user(&pool, "ben");
        befriend(&app, &anna, &ben, "ben").await;
        let t = today(&pool, anna.0);
        let week: Vec<String> = (0..7).map(|i| back(&t, i)).collect();
        let week: Vec<&str> = week.iter().map(|s| s.as_str()).collect();
        met(&pool, anna.0, &week);
        met(&pool, ben.0, &week[1..]);
        let (_, v) = call(&app, "GET", "/friends", Some(&anna.1), NULL).await;
        assert_eq!((v["friends"][0]["friend_streak"]["current"].as_i64(), v["friends"][0]["friend_streak"]["state"].as_str()), (Some(6), Some("waiting")));
        met(&pool, ben.0, &[week[0]]);
        let (_, v) = call(&app, "GET", "/friends", Some(&anna.1), NULL).await;
        assert_eq!((v["friends"][0]["friend_streak"]["current"].as_i64(), v["friends"][0]["friend_streak"]["kept"].as_bool()), (Some(7), Some(true)));
        // Ben's reading met the day: the badge is his, and Anna's with it
        on_day_met(&pool.get().unwrap(), ben.0).unwrap();
        let has = |uid: i64| pool.get().unwrap().query_row("SELECT count(*) FROM badges WHERE user_id=?1 AND code='friend_streak_7'", params![uid], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!(has(anna.0), 1);
        assert_eq!(crate::badges::check_badges(&pool.get().unwrap(), ben.0).unwrap().iter().filter(|b| b.code == "friend_streak_7").count(), 1);
        assert_eq!(has(ben.0), 1);
        // not while either keeps their streak to themselves
        let (app2, pool2) = crate::testkit::app();
        let c = user(&pool2, "cara"); let d = user(&pool2, "dan");
        befriend(&app2, &c, &d, "dan").await;
        met(&pool2, c.0, &week); met(&pool2, d.0, &week);
        set_prefs(&pool2, d.0, json!({ "share_streak": false }));
        assert_eq!(best_pair_streak(&pool2.get().unwrap(), c.0, &t), 0);
    }

    #[tokio::test]
    async fn one_reaction_per_friend_per_badge() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        let ben = user(&pool, "ben");
        let cara = user(&pool, "cara");
        befriend(&app, &anna, &ben, "ben").await;
        pool.get().unwrap().execute("INSERT INTO badges (user_id, code) VALUES (?1, 'streak_7')", params![ben.0]).unwrap();
        let r = |kind: &'static str, target: &'static str, to: i64, t: String| { let app = app.clone(); async move { call(&app, "POST", "/friends/reactions", Some(&t), json!({ "to": to, "target": target, "kind": kind })).await } };
        let (st, v) = r("heart", "badge:streak_7", ben.0, anna.1.clone()).await;
        assert_eq!((st, v["created"].as_bool()), (200, Some(true)));
        // a second is no second: the first stands
        let (st, v) = r("clap", "badge:streak_7", ben.0, anna.1.clone()).await;
        assert_eq!((st, v["created"].as_bool(), v["reaction"]["kind"].as_str()), (200, Some(false), Some("heart")));
        assert_eq!(r("wave", "badge:streak_7", ben.0, anna.1.clone()).await.0, 400);
        assert_eq!(r("heart", "badge:streak_30", ben.0, anna.1.clone()).await.0, 404, "a badge not earned");
        assert_eq!(r("heart", "badge:streak_7", ben.0, cara.1.clone()).await.0, 404, "not a friend");
        let (_, v) = call(&app, "GET", "/friends/reactions", Some(&ben.1), NULL).await;
        assert_eq!((v["reactions"][0]["kind"].as_str(), v["reactions"][0]["from"]["handle"].as_str(), v["reactions"][0]["seen"].as_bool()), (Some("heart"), Some("anna"), Some(false)));
        assert_eq!(call(&app, "GET", "/friends", Some(&ben.1), NULL).await.1["unseen_reactions"], 1);
        call(&app, "POST", "/friends/reactions/seen", Some(&ben.1), NULL).await;
        assert_eq!(call(&app, "GET", "/friends", Some(&ben.1), NULL).await.1["unseen_reactions"], 0);
        // switched off: none received
        pool.get().unwrap().execute("INSERT INTO badges (user_id, code) VALUES (?1, 'first_page')", params![ben.0]).unwrap();
        call(&app, "PUT", "/friends/settings", Some(&ben.1), json!({ "reactions": false })).await;
        assert_eq!(r("smile", "badge:first_page", ben.0, anna.1.clone()).await.0, 409);
        call(&app, "PUT", "/friends/settings", Some(&ben.1), json!({ "reactions": true, "share_badges": false })).await;
        assert_eq!(r("smile", "badge:first_page", ben.0, anna.1.clone()).await.0, 404, "badges not shared");
    }

    #[tokio::test]
    async fn a_friend_streak_milestone_takes_a_reaction_for_its_own_run() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        let ben = user(&pool, "ben");
        befriend(&app, &anna, &ben, "ben").await;
        let t = today(&pool, anna.0);
        let days: Vec<String> = (0..7).map(|i| back(&t, i)).collect();
        let days: Vec<&str> = days.iter().map(|s| s.as_str()).collect();
        met(&pool, anna.0, &days); met(&pool, ben.0, &days);
        let start = back(&t, 6);
        let go = |target: String| { let app = app.clone(); let tk = ben.1.clone(); async move { call(&app, "POST", "/friends/reactions", Some(&tk), json!({ "to": anna.0, "target": target, "kind": "seal" })).await.0 } };
        assert_eq!(go(format!("streak:7:{}", back(&t, 7))).await, 404, "another run");
        assert_eq!(go(format!("streak:30:{start}")).await, 404, "not reached");
        assert_eq!(go(format!("streak:7:{start}")).await, 200);
        let (_, v) = call(&app, "GET", "/friends", Some(&anna.1), NULL).await;
        assert_eq!(v["friends"][0]["reactions"]["received"][0]["target"], json!(format!("streak:7:{start}")));
    }

    #[tokio::test]
    async fn reactions_are_rate_limited() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        let mut last = 0;
        for i in 0..61 {
            let f = user(&pool, &format!("friend{i}"));
            befriend(&app, &anna, &f, &format!("friend{i}")).await;
            pool.get().unwrap().execute("INSERT INTO badges (user_id, code) VALUES (?1, 'first_page')", params![f.0]).unwrap();
            // the invite limit is not what is being tested here
            pool.get().unwrap().execute("DELETE FROM friend_events WHERE kind='invite'", []).unwrap();
            last = call(&app, "POST", "/friends/reactions", Some(&anna.1), json!({ "to": f.0, "target": "badge:first_page", "kind": "heart" })).await.0;
            if i < 60 { assert_eq!(last, 200, "reaction {i}"); }
        }
        assert_eq!(last, 429);
    }

    #[tokio::test]
    async fn a_block_severs_everything_and_tells_the_blocked_nothing_new() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        let ben = user(&pool, "ben");
        befriend(&app, &anna, &ben, "ben").await;
        pool.get().unwrap().execute("INSERT INTO badges (user_id, code) VALUES (?1, 'first_page')", params![anna.0]).unwrap();
        call(&app, "POST", "/friends/reactions", Some(&ben.1), json!({ "to": anna.0, "target": "badge:first_page", "kind": "heart" })).await;
        assert_eq!(call(&app, "POST", "/blocks", Some(&anna.1), json!({ "user_id": ben.0 })).await.0, 200);
        for t in [&anna.1, &ben.1] { assert_eq!(call(&app, "GET", "/friends", Some(t), NULL).await.1["friends"].as_array().unwrap().len(), 0); }
        assert_eq!(call(&app, "GET", "/friends/reactions", Some(&anna.1), NULL).await.1["reactions"].as_array().unwrap().len(), 0);
        let n: i64 = pool.get().unwrap().query_row("SELECT count(*) FROM friend_reactions", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
        // Ben can still "invite" Anna and hears what anyone hears; it never reaches her
        assert_eq!(call(&app, "POST", "/friends/invite", Some(&ben.1), json!({ "handle": "anna" })).await, (200, json!({ "status": "sent" })));
        assert_eq!(call(&app, "GET", "/friends", Some(&anna.1), NULL).await.1["incoming"].as_array().unwrap().len(), 0);
        assert_eq!(call(&app, "GET", &format!("/friends/{}", anna.0), Some(&ben.1), NULL).await.0, 404);
        // an invite Ben sent before the block stays in his list as it was
        let (app, pool) = crate::testkit::app();
        let anna = user(&pool, "anna"); let ben = user(&pool, "ben");
        call(&app, "POST", "/friends/invite", Some(&ben.1), json!({ "handle": "anna" })).await;
        let before = call(&app, "GET", "/friends", Some(&ben.1), NULL).await.1["outgoing"].clone();
        call(&app, "POST", "/blocks", Some(&anna.1), json!({ "user_id": ben.0 })).await;
        assert_eq!(call(&app, "GET", "/friends", Some(&ben.1), NULL).await.1["outgoing"], before);
        assert_eq!(call(&app, "GET", "/friends", Some(&anna.1), NULL).await.1["incoming"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn a_code_redeems_once_within_ten_minutes() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        let ben = user(&pool, "ben");
        let cara = user(&pool, "cara");
        let (st, tok) = call(&app, "POST", "/friends/token", Some(&anna.1), NULL).await;
        assert_eq!((st, tok["ttl_secs"].as_i64()), (200, Some(600)));
        let t = tok["token"].as_str().unwrap().to_string();
        assert!(!tok.to_string().contains("anna"), "the code carries no handle");
        assert_eq!(call(&app, "GET", &format!("/friends/token/{t}"), Some(&anna.1), NULL).await.0, 400);
        let (_, peek) = call(&app, "GET", &format!("/friends/token/{t}"), Some(&ben.1), NULL).await;
        assert_eq!(peek["handle"], "anna");
        let (st, v) = call(&app, "POST", "/friends/token/redeem", Some(&ben.1), json!({ "token": t })).await;
        assert_eq!((st, v["status"].as_str()), (200, Some("sent")));
        // the owner sees the scanner's invite, on the code's status too, and accepts as ever
        let (_, s) = call(&app, "GET", &format!("/friends/token/{t}/status"), Some(&anna.1), NULL).await;
        assert_eq!((s["used"].as_bool(), s["invite"]["from"]["handle"].as_str()), (Some(true), Some("ben")));
        let (_, v) = call(&app, "GET", "/friends", Some(&anna.1), NULL).await;
        assert_eq!((v["incoming"][0]["from"]["handle"].as_str(), v["incoming"][0]["via"].as_str()), (Some("ben"), Some("qr")));
        // single use
        assert_eq!(call(&app, "POST", "/friends/token/redeem", Some(&cara.1), json!({ "token": t })).await.0, 404);
        // expired
        let t2 = call(&app, "POST", "/friends/token", Some(&anna.1), NULL).await.1["token"].as_str().unwrap().to_string();
        pool.get().unwrap().execute("UPDATE friend_tokens SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second') WHERE token=?1", params![t2]).unwrap();
        assert_eq!(call(&app, "POST", "/friends/token/redeem", Some(&cara.1), json!({ "token": t2 })).await.0, 404);
        // a new code withdraws the one before it
        let t3 = call(&app, "POST", "/friends/token", Some(&anna.1), NULL).await.1["token"].as_str().unwrap().to_string();
        let t4 = call(&app, "POST", "/friends/token", Some(&anna.1), NULL).await.1["token"].as_str().unwrap().to_string();
        assert_eq!(call(&app, "GET", &format!("/friends/token/{t3}"), Some(&cara.1), NULL).await.0, 404);
        assert_eq!(call(&app, "GET", &format!("/friends/token/{t4}"), Some(&cara.1), NULL).await.0, 200);
        // invites off: codes are refused, the live one included
        call(&app, "PUT", "/friends/settings", Some(&anna.1), json!({ "invites": false })).await;
        assert_eq!(call(&app, "POST", "/friends/token/redeem", Some(&cara.1), json!({ "token": t4 })).await.0, 404);
        assert_eq!(call(&app, "POST", "/friends/token", Some(&anna.1), NULL).await.0, 409);
        // guessing is limited: 20 tries in ten minutes, peeks and redeems together
        // five used above
        for _ in 0..15 { assert_eq!(call(&app, "GET", "/friends/token/AAAAAAAAAAAAAAAAAAAA", Some(&cara.1), NULL).await.0, 404); }
        assert_eq!(call(&app, "GET", "/friends/token/AAAAAAAAAAAAAAAAAAAA", Some(&cara.1), NULL).await.0, 429);
    }

    /// A stand-in 64-hex value per string (the server never hashes; it only compares).
    fn h(s: &str) -> String { let mut out = String::new(); let b = s.as_bytes(); for i in 0..32 { out.push_str(&format!("{:02x}", b.get(i % b.len().max(1)).copied().unwrap_or(0) ^ (i as u8))); } out }

    #[tokio::test]
    async fn contacts_match_only_those_who_opted_in_and_keep_nothing_of_the_query() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        let ben = user(&pool, "ben");
        let cara = user(&pool, "cara");
        let dan = user(&pool, "dan");
        // Ben and Dan let contacts find them; Cara has the same number in her address book but did not opt in
        assert_eq!(call(&app, "PUT", "/friends/discoverable", Some(&ben.1), json!({ "hashes": [h("+447700900123"), h("ben@example.org")] })).await.0, 200);
        assert_eq!(call(&app, "PUT", "/friends/discoverable", Some(&dan.1), json!({ "hashes": [h("+13035550142")] })).await.0, 200);
        assert_eq!(call(&app, "PUT", "/friends/discoverable", Some(&dan.1), json!({ "hashes": ["zz"] })).await.0, 400);
        assert_eq!(call(&app, "PUT", "/friends/discoverable", Some(&dan.1), json!({ "hashes": (0..5).map(|i| h(&format!("x{i}"))).collect::<Vec<_>>() })).await.0, 400);
        pool.get().unwrap().execute("INSERT INTO blocks (user_id, blocked_id) VALUES (?1, ?2)", params![dan.0, anna.0]).unwrap();
        let query = vec![h("+447700900123"), h("+13035550142"), h("cara@example.org"), h("+61412345678")];
        let (st, v) = call(&app, "POST", "/friends/contacts/match", Some(&anna.1), json!({ "hashes": query })).await;
        assert_eq!(st, 200);
        assert_eq!(v, json!({ "matches": [{ "handle": "ben", "display_name": "Ben", "avatar": crate::avatars::default_for(ben.0) }] }), "Dan blocked Anna; Cara never opted in");
        // nothing of the query is kept: only the opted-in hashes are in the database, and one rate-limit tick
        let stored: Vec<String> = pool.get().unwrap().prepare("SELECT hash FROM contact_hashes").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(stored.len(), 3);
        assert!(!stored.contains(&h("+61412345678")));
        let dump: String = pool.get().unwrap().query_row("SELECT group_concat(kind) FROM friend_events WHERE user_id=?1", params![anna.0], |r| r.get(0)).unwrap();
        assert_eq!(dump, "match");
        // switching discoverability off removes the hashes; the match then finds nobody
        call(&app, "DELETE", "/friends/discoverable", Some(&ben.1), NULL).await;
        let (_, v) = call(&app, "POST", "/friends/contacts/match", Some(&anna.1), json!({ "hashes": [h("+447700900123")] })).await;
        assert_eq!(v["matches"].as_array().unwrap().len(), 0);
        // two a minute, and a cap on the list
        assert_eq!(call(&app, "POST", "/friends/contacts/match", Some(&anna.1), json!({ "hashes": [h("a")] })).await.0, 429);
        assert_eq!(call(&app, "POST", "/friends/contacts/match", Some(&cara.1), json!({ "hashes": (0..2001).map(|i| h(&format!("n{i}"))).collect::<Vec<_>>() })).await.0, 400);
        // a match already a friend or with invites off is left out
        let (app, pool) = crate::testkit::app();
        let a = user(&pool, "anna"); let b = user(&pool, "ben"); let c = user(&pool, "cara");
        call(&app, "PUT", "/friends/discoverable", Some(&b.1), json!({ "hashes": [h("b")] })).await;
        call(&app, "PUT", "/friends/discoverable", Some(&c.1), json!({ "hashes": [h("c")] })).await;
        set_prefs(&pool, c.0, json!({ "invites": false }));
        befriend(&app, &a, &b, "ben").await;
        let (_, v) = call(&app, "POST", "/friends/contacts/match", Some(&a.1), json!({ "hashes": [h("b"), h("c")] })).await;
        assert_eq!(v["matches"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn export_deletion_and_account_removal() {
        let (app, pool) = app();
        let anna = user(&pool, "anna");
        let ben = user(&pool, "ben");
        user(&pool, "cara");
        befriend(&app, &anna, &ben, "ben").await;
        call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": "cara" })).await;
        call(&app, "POST", "/friends/invite", Some(&anna.1), json!({ "handle": "nobody_here" })).await;
        call(&app, "PUT", "/friends/discoverable", Some(&anna.1), json!({ "hashes": [h("anna@example.org")] })).await;
        call(&app, "PUT", "/friends/settings", Some(&anna.1), json!({ "share_reading": false })).await;
        let (_, x) = call(&app, "GET", "/me/export", Some(&anna.1), NULL).await;
        assert_eq!(x["friends"][0]["handle"], "ben");
        assert_eq!(x["friend_invites_sent"].as_array().unwrap().len(), 3);
        assert!(x["friend_invites_sent"].as_array().unwrap().iter().all(|i| i.get("delivered").is_none() && i.get("declined_at").is_none()), "the export must not say which handles exist");
        assert_eq!(x["contact_hashes"][0]["hash"], json!(h("anna@example.org")));
        assert_eq!(x["user"]["settings"]["friends"]["share_reading"], false);
        let (_, d) = call(&app, "DELETE", "/me/data", Some(&anna.1), json!({ "categories": ["friends"] })).await;
        assert!(d["deleted"]["friends"].as_i64().unwrap() >= 5, "{d}");
        assert_eq!(call(&app, "GET", "/friends", Some(&ben.1), NULL).await.1["friends"].as_array().unwrap().len(), 0);
        // an account going: its friendships go; an invite to it stays unchanged in its sender's list
        let (app, pool) = crate::testkit::app();
        let a = user(&pool, "anna"); let b = user(&pool, "ben"); let c = user(&pool, "cara");
        befriend(&app, &a, &b, "ben").await;
        call(&app, "POST", "/friends/invite", Some(&c.1), json!({ "handle": "anna" })).await;
        let before = call(&app, "GET", "/friends", Some(&c.1), NULL).await.1["outgoing"].clone();
        assert_eq!(call(&app, "DELETE", "/me", Some(&a.1), json!({ "confirm": "delete" })).await.0, 200);
        assert_eq!(call(&app, "GET", "/friends", Some(&b.1), NULL).await.1["friends"].as_array().unwrap().len(), 0);
        assert_eq!(call(&app, "GET", "/friends", Some(&c.1), NULL).await.1["outgoing"], before);
        let left: i64 = pool.get().unwrap().query_row("SELECT count(*) FROM friendships", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }
}
