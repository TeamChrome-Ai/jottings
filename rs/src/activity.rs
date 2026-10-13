//! Active-time + page-credit engine (rules in README).
use crate::bible::chapter_required_seconds;
use crate::db::Conn;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

const MAX_BEAT_SECONDS: i64 = 20;
const DAILY_GOAL_SECONDS: i64 = 600;

#[derive(Deserialize)]
pub struct Beat {
    pub session_id: String, pub book: Option<i64>, pub chapter: Option<i64>, pub progress: Option<f64>, pub signals: Option<i64>, pub active: bool, pub visible: bool, pub device: Option<String>,
    /// The device's calendar date (YYYY-MM-DD) when it sent the beat.
    #[serde(default)] pub local_date: Option<String>,
    /// The device's UTC offset in minutes EAST of UTC (Denver in summer: -360), i.e. JavaScript's `-getTimezoneOffset()`.
    #[serde(default)] pub tz_offset_min: Option<i64>,
    /// The reader is at the chapter's end as this beat is sent (scrolled to the bottom or it fits, the last page, the
    /// voice finishing it). Absent from clients older than the rule, which `LEGACY_END_PROGRESS` stands in for.
    #[serde(default)] pub reached_end: Option<bool>,
}

/// A beat without `reached_end` counts as the end when its scroll progress is this far.
const LEGACY_END_PROGRESS: f64 = 0.98;

#[derive(Serialize)]
pub struct Credited { pub book: i64, pub chapter: i64 }
#[derive(Serialize)]
pub struct BeatResult { pub date: String, pub active_seconds_today: i64, pub pages_today: i64, #[serde(skip_serializing_if = "Option::is_none")] pub credited: Option<Credited>, pub streak: StreakInfo, pub new_badges: Vec<crate::badges::Badge>,
    /// Reactions from friends not yet seen on the Stats tab (friends.rs); the client may raise a quiet local notice.
    pub unseen_reactions: i64,
    /// Friend invites waiting (friends.rs, none while invites are off); a larger number than last time sends the app to
    /// `GET /friends/invites/incoming` for the new ones.
    pub incoming_invites: i64 }

#[derive(Serialize, Clone)]
pub struct Day { pub date: String, pub active_seconds: i64, pub pages: i64, pub met: u8 }
#[derive(Serialize, Clone)]
pub struct StreakInfo { pub today: String, pub current: i64, pub longest: i64, pub today_active_seconds: i64, pub today_goal_seconds: i64, pub days: Vec<Day> }

fn parse_iso(s: &str) -> Option<time::OffsetDateTime> { time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok() }

// ---------------- reader-local days ----------------
// A day is the reader's own calendar day. The device names it on every beat; the server keeps only the latest UTC
// offset per user (`users.tz_offset_min`, NULL = never reported = UTC) to say which day "today" is for reads.

/// Real zones run from UTC-12 to UTC+14.
pub const MAX_OFFSET_MIN: i64 = 14 * 60;
const DAY_FMT: &[time::format_description::FormatItem<'static>] = time::macros::format_description!("[year]-[month]-[day]");

pub fn day_key(d: time::Date) -> String { format!("{:04}-{:02}-{:02}", d.year(), u8::from(d.month()), d.day()) }
pub fn parse_day(s: &str) -> Option<time::Date> { time::Date::parse(s, DAY_FMT).ok() }
/// An offset a real zone can have; anything else is ignored rather than refused, so a beat is never lost to it.
pub fn valid_offset(o: Option<i64>) -> Option<i64> { o.filter(|o| (-MAX_OFFSET_MIN..=MAX_OFFSET_MIN).contains(o)) }
/// The calendar date `offset_min` east of UTC at `now`.
pub fn local_date(now: time::OffsetDateTime, offset_min: i64) -> time::Date { (now + time::Duration::minutes(offset_min)).date() }

pub fn user_offset(conn: &rusqlite::Connection, user_id: i64) -> i64 {
    conn.query_row("SELECT tz_offset_min FROM users WHERE id=?1", params![user_id], |r| r.get::<_, Option<i64>>(0)).optional().ok().flatten().flatten().and_then(|o| valid_offset(Some(o))).unwrap_or(0)
}
/// Keeps the reader's latest offset; a no-op when it has not changed.
pub fn remember_offset(conn: &rusqlite::Connection, user_id: i64, offset: Option<i64>) -> rusqlite::Result<()> {
    if let Some(o) = valid_offset(offset) { conn.prepare_cached("UPDATE users SET tz_offset_min=?1 WHERE id=?2 AND tz_offset_min IS NOT ?1")?.execute(params![o, user_id])?; }
    Ok(())
}
/// The reader's today by the server clock and their latest offset: what reads (stats, calendar, badges) judge by.
pub fn user_today(conn: &rusqlite::Connection, user_id: i64) -> String { day_key(local_date(time::OffsetDateTime::now_utc(), user_offset(conn, user_id))) }

/// The day a beat is credited to. The device's own date is taken when it lies within one day of the server's UTC date
/// (every real zone does); otherwise the device clock is wrong and the day comes from the server clock and the offset.
/// `latest` is the reader's most recent credited day: a beat never lands before it, so turning a clock back (or
/// flying west) cannot fill in a day already past.
pub fn resolve_day(now: time::OffsetDateTime, claimed: Option<&str>, offset: Option<i64>, latest: Option<&str>) -> String {
    let utc = now.date();
    let day = claimed.and_then(parse_day).filter(|d| (*d - utc).whole_days().abs() <= 1).unwrap_or_else(|| local_date(now, valid_offset(offset).unwrap_or(0)));
    let day = day_key(day);
    match latest { Some(l) if l > day.as_str() => l.to_string(), _ => day }
}

pub fn beat(conn: &mut Conn, user_id: i64, b: &Beat) -> anyhow::Result<BeatResult> { beat_at(conn, user_id, b, time::OffsetDateTime::now_utc()) }

pub fn beat_at(conn: &mut Conn, user_id: i64, b: &Beat, now: time::OffsetDateTime) -> anyhow::Result<BeatResult> {
    // the same shape as the columns' SQLite defaults, so strftime reads them alike
    let now_s = now.format(time::macros::format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z")).unwrap_or_default();
    remember_offset(conn, user_id, b.tz_offset_min)?;
    // an old client sends neither field: its day comes from the offset another device of the reader reported
    let offset = valid_offset(b.tz_offset_min).unwrap_or_else(|| user_offset(conn, user_id));
    let latest: Option<String> = conn.query_row("SELECT max(date) FROM activity_days WHERE user_id=?1", params![user_id], |r| r.get(0))?;
    let date = resolve_day(now, b.local_date.as_deref(), Some(offset), latest.as_deref());
    let mut earned = 0i64;
    let sess: Option<(i64, String)> = conn.query_row("SELECT user_id, last_beat_at FROM activity_sessions WHERE id=?1", params![b.session_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    match sess {
        None => { conn.execute("INSERT INTO activity_sessions (id, user_id, started_at, last_beat_at, device) VALUES (?1,?2,?3,?3,?4)", params![b.session_id, user_id, now_s, b.device])?; }
        Some((uid, _)) if uid != user_id => anyhow::bail!("session belongs to another user"),
        Some((_, last)) => {
            let elapsed = parse_iso(&last).map(|t| (now - t).whole_seconds()).unwrap_or(0);
            if b.active && b.visible && elapsed > 0 { earned = elapsed.min(MAX_BEAT_SECONDS); }
            conn.execute("UPDATE activity_sessions SET last_beat_at=?1, active_seconds=active_seconds+?2 WHERE id=?3", params![now_s, earned, b.session_id])?;
        }
    }
    let mut credited = None;
    let mut chapter_new = 0i64;
    let tx = conn.transaction()?;
    if let (Some(book), Some(chapter)) = (b.book, b.chapter) {
        let progress = b.progress.unwrap_or(0.0).clamp(0.0, 1.0);
        let signals = b.signals.unwrap_or(0).clamp(0, 50);
        let end = b.reached_end.unwrap_or(progress >= LEGACY_END_PROGRESS);
        tx.execute("INSERT INTO chapter_dwell (session_id, book, chapter, active_seconds, max_progress, signal_events, reached_end) VALUES (?1,?2,?3,?4,?5,?6,?7)
            ON CONFLICT(session_id, book, chapter) DO UPDATE SET active_seconds=active_seconds+excluded.active_seconds, max_progress=max(max_progress, excluded.max_progress), signal_events=signal_events+excluded.signal_events, reached_end=max(reached_end, excluded.reached_end)",
            params![b.session_id, book, chapter, earned, progress, signals, end as i64])?;
        let (dwell, reached, cred): (i64, i64, i64) = tx.query_row("SELECT active_seconds, reached_end, credited FROM chapter_dwell WHERE session_id=?1 AND book=?2 AND chapter=?3", params![b.session_id, book, chapter], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        // read = the reader is at the end ON THIS BEAT and the server's own tally of time on the chapter matches its
        // length. Not "the end was touched once": a scroll to the bottom and back, then time spent halfway, was being
        // credited (the owner, build 31). The stored `reached_end` stays for the stats; it no longer credits by itself.
        let _ = reached;
        if cred == 0 && end && dwell >= chapter_required_seconds(&tx, book, chapter) {
            tx.execute("UPDATE chapter_dwell SET credited=1 WHERE session_id=?1 AND book=?2 AND chapter=?3", params![b.session_id, book, chapter])?;
            let n = tx.execute("INSERT OR IGNORE INTO page_credits (user_id, book, chapter, date, dwell_seconds, credited_at, tz_offset_min) VALUES (?1,?2,?3,?4,?5,?6,?7)", params![user_id, book, chapter, date, dwell, now_s, offset])?;
            if n > 0 {
                credited = Some(Credited { book, chapter });
                let before: Option<i64> = tx.query_row("SELECT 1 FROM chapters_read WHERE user_id=?1 AND book=?2 AND chapter=?3", params![user_id, book, chapter], |r| r.get(0)).optional()?;
                tx.execute("INSERT INTO chapters_read (user_id, book, chapter, first_read_at, last_read_at) VALUES (?1,?2,?3,?4,?4) ON CONFLICT(user_id, book, chapter) DO UPDATE SET times=times+1, last_read_at=excluded.last_read_at", params![user_id, book, chapter, now_s])?;
                if before.is_none() { chapter_new = 1; }
            }
        }
    }
    if earned > 0 || credited.is_some() {
        tx.execute("INSERT INTO activity_days (user_id, date, active_seconds, pages, chapters) VALUES (?1,?2,?3,?4,?5)
            ON CONFLICT(user_id, date) DO UPDATE SET active_seconds=active_seconds+excluded.active_seconds, pages=pages+excluded.pages, chapters=chapters+excluded.chapters",
            params![user_id, date, earned, credited.is_some() as i64, chapter_new])?;
    }
    tx.commit()?;
    let (ta, tp): (i64, i64) = conn.query_row("SELECT active_seconds, pages FROM activity_days WHERE user_id=?1 AND date=?2", params![user_id, date], |r| Ok((r.get(0)?, r.get(1)?))).optional()?.unwrap_or((0, 0));
    let new_badges = crate::badges::check_badges_on(conn, user_id, &date)?;
    // the beat that meets the day may complete a friend streak for the friend as well as for this reader
    let goal = daily_goal_seconds(conn, user_id);
    if day_met(ta, goal) && !day_met(ta - earned, goal) { crate::friends::on_day_met(conn, user_id)?; crate::groups::on_day_met(conn, user_id)?; }
    let unseen_reactions = crate::friends::unseen_reactions(conn, user_id)?;
    let incoming_invites = crate::friends::incoming_count(conn, user_id)?;
    Ok(BeatResult { active_seconds_today: ta, pages_today: tp, credited, streak: streak_info(conn, user_id, &date)?, new_badges, date, unseen_reactions, incoming_invites })
}


/// A day keeps the streak when the reader's own daily goal of minutes is met. A chapter read in less time does not
/// (it used to: John 3 in under five minutes kept a 10-minute day; the owner, build 35); chapters count toward progress.
pub fn day_met(active_seconds: i64, goal: i64) -> bool { active_seconds >= goal }

pub fn daily_goal_seconds(conn: &rusqlite::Connection, user_id: i64) -> i64 {
    let s: Option<String> = conn.query_row("SELECT settings FROM users WHERE id=?1", params![user_id], |r| r.get(0)).optional().ok().flatten();
    s.and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()).and_then(|v| v.get("daily_goal_minutes").and_then(|g| g.as_f64())).filter(|g| *g > 0.0).map(|g| (g * 60.0) as i64).unwrap_or(DAILY_GOAL_SECONDS)
}

fn shift(date: &str, days: i64) -> String { parse_day(date).map(|d| day_key(d + time::Duration::days(days))).unwrap_or_else(|| date.to_string()) }

/// The Lord's day (Sunday) that begins the week holding `d`, a reader-local day. Streaks count consecutive days and need no week.
pub fn week_start(d: time::Date) -> time::Date { d - time::Duration::days(d.weekday().number_days_from_sunday() as i64) }

/// The streak as of `today`, the reader's local day: alive while `today` or the day before met the goal (`day_met`).
pub fn streak_info(conn: &rusqlite::Connection, user_id: i64, today: &str) -> rusqlite::Result<StreakInfo> {
    let goal = daily_goal_seconds(conn, user_id);
    let mut st = conn.prepare_cached("SELECT date, active_seconds, pages FROM activity_days WHERE user_id=?1 ORDER BY date DESC LIMIT 371")?;
    let rows: Vec<(String, i64, i64)> = st.query_map(params![user_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
    let met = |d: &str| rows.iter().find(|r| r.0 == d).map(|r| day_met(r.1, goal)).unwrap_or(false);
    let t = today.to_string();
    // a day credited ahead of `today` (the device's day went back, see `resolve_day`) still holds the run
    let mut d = rows.first().filter(|r| r.0 > t && met(&r.0)).map(|r| r.0.clone()).unwrap_or_else(|| if met(&t) { t.clone() } else { shift(&t, -1) });
    let mut current = 0;
    while met(&d) { current += 1; d = shift(&d, -1); }
    let mut longest = 0; let mut run = 0; let mut prev: Option<String> = None;
    for r in rows.iter().rev() {
        let ok = day_met(r.1, goal);
        if !ok { run = 0; prev = Some(r.0.clone()); continue; }
        run = match &prev { Some(p) if shift(p, 1) == r.0 && met(p) => run + 1, _ => 1 };
        prev = Some(r.0.clone());
        longest = longest.max(run);
    }
    longest = longest.max(current);
    let today_row = rows.iter().find(|r| r.0 == t);
    Ok(StreakInfo {
        today: t, current, longest,
        today_active_seconds: today_row.map(|r| r.1).unwrap_or(0), today_goal_seconds: goal,
        days: rows.iter().map(|r| Day { date: r.0.clone(), active_seconds: r.1, pages: r.2, met: day_met(r.1, goal) as u8 }).collect(),
    })
}

#[derive(Serialize)]
pub struct Stats { pub total_active_seconds: i64, pub total_pages: i64, pub chapters_read: i64, pub verses_read: i64, pub books_completed: i64, pub streak: StreakInfo }

pub fn stats(conn: &rusqlite::Connection, user_id: i64) -> rusqlite::Result<Stats> {
    let (s, p): (i64, i64) = conn.query_row("SELECT coalesce(sum(active_seconds),0), coalesce(sum(pages),0) FROM activity_days WHERE user_id=?1", params![user_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let chapters: i64 = conn.query_row("SELECT count(*) FROM chapters_read WHERE user_id=?1", params![user_id], |r| r.get(0))?;
    let verses: i64 = conn.query_row("SELECT coalesce(sum(c.verse_count),0) FROM chapters_read r JOIN chapters c ON c.book=r.book AND c.chapter=r.chapter WHERE r.user_id=?1", params![user_id], |r| r.get(0))?;
    let books: i64 = conn.query_row("SELECT count(*) FROM (SELECT r.book FROM chapters_read r WHERE r.user_id=?1 GROUP BY r.book HAVING count(*) >= (SELECT count(*) FROM chapters c WHERE c.book=r.book))", params![user_id], |r| r.get(0))?;
    Ok(Stats { total_active_seconds: s, total_pages: p, chapters_read: chapters, verses_read: verses, books_completed: books, streak: streak_info(conn, user_id, &user_today(conn, user_id))? })
}

pub fn progress_map(conn: &rusqlite::Connection, user_id: i64) -> rusqlite::Result<std::collections::BTreeMap<i64, Vec<i64>>> {
    let mut st = conn.prepare_cached("SELECT book, chapter FROM chapters_read WHERE user_id=?1 ORDER BY book, chapter")?;
    let mut out = std::collections::BTreeMap::new();
    for r in st.query_map(params![user_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? { let (b, c) = r?; out.entry(b).or_insert_with(Vec::new).push(c); }
    Ok(out)
}

#[derive(Serialize)]
pub struct CalDay { pub date: String, pub active_seconds: i64, pub pages: i64, pub chapters: i64 }
pub fn calendar(conn: &rusqlite::Connection, user_id: i64, from: &str, to: &str) -> rusqlite::Result<Vec<CalDay>> {
    let mut st = conn.prepare_cached("SELECT date, active_seconds, pages, chapters FROM activity_days WHERE user_id=?1 AND date BETWEEN ?2 AND ?3 ORDER BY date")?;
    let rows_ = st.query_map(params![user_id, from, to], |r| Ok(CalDay { date: r.get(0)?, active_seconds: r.get(1)?, pages: r.get(2)?, chapters: r.get(3)? }))?.collect(); rows_
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fresh() -> Conn {
        let dir = std::env::temp_dir().join(format!("berean-test-{}.db", crate::auth::random_token(6)));
        let pool = crate::db::open_pool(dir.to_str().unwrap(), None).unwrap();
        let c = pool.get().unwrap();
        c.execute("INSERT INTO chapters (book, chapter, words, verse_count) VALUES (65, 1, 600, 25)", []).unwrap();
        c.execute("INSERT INTO users (handle, display_name, password_hash) VALUES ('t', 'T', 'x')", []).unwrap();
        c
    }
    fn backdate(c: &Conn, sid: &str) { c.execute("UPDATE activity_sessions SET last_beat_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 seconds') WHERE id=?1", params![sid]).unwrap(); }
    fn b(sid: &str, active: bool, progress: f64, signals: i64) -> Beat { Beat { session_id: sid.into(), book: Some(65), chapter: Some(1), progress: Some(progress), signals: Some(signals), active, visible: true, device: None, local_date: None, tz_offset_min: None, reached_end: Some(progress >= 1.0) } }
    fn at(s: &str) -> time::OffsetDateTime { time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).unwrap() }
    fn date(s: &str) -> time::Date { parse_day(s).unwrap() }
    /// A reading beat from a device at `offset`: the local date is what that device's clock shows at `now`.
    fn local_beat(sid: &str, now: time::OffsetDateTime, offset: i64) -> Beat {
        Beat { local_date: Some(day_key(local_date(now, offset))), tz_offset_min: Some(offset), ..b(sid, true, 0.5, 1) }
    }
    /// Two beats `secs` apart at `now`: the second earns min(secs, 20) seconds on the day it resolves to.
    fn read_at(c: &mut Conn, sid: &str, now: time::OffsetDateTime, offset: i64, secs: i64) -> BeatResult {
        beat_at(c, 1, &local_beat(sid, now - time::Duration::seconds(secs), offset), now - time::Duration::seconds(secs)).unwrap();
        beat_at(c, 1, &local_beat(sid, now, offset), now).unwrap()
    }
    fn small_goal(c: &Conn) { c.execute("UPDATE users SET settings='{\"daily_goal_minutes\":0.25}' WHERE id=1", []).unwrap(); }
    #[test]
    fn week_starts_on_the_lords_day() {
        let d = |y, m, day| time::Date::from_calendar_date(y, time::Month::try_from(m).unwrap(), day).unwrap();
        assert_eq!(week_start(d(2026, 9, 25)), d(2026, 9, 20)); // Friday
        assert_eq!(week_start(d(2026, 9, 20)), d(2026, 9, 20)); // the Lord's day itself
        assert_eq!(week_start(d(2026, 9, 26)), d(2026, 9, 20)); // Saturday closes the week
        assert_eq!(week_start(d(2026, 1, 1)), d(2025, 12, 28)); // across a year
    }
    #[test]
    fn caps_time_and_requires_activity() {
        let mut c = fresh();
        beat(&mut c, 1, &b("s1", true, 0.1, 1)).unwrap();
        backdate(&c, "s1");
        let r = beat(&mut c, 1, &b("s1", true, 0.5, 1)).unwrap();
        assert_eq!(r.active_seconds_today, 20);
        backdate(&c, "s1");
        let r = beat(&mut c, 1, &b("s1", false, 0.9, 0)).unwrap();
        assert_eq!(r.active_seconds_today, 20);
        assert!(r.credited.is_none());
    }
    #[test]
    fn credits_chapter_once_per_day() {
        let mut c = fresh();
        let mut credited = None;
        for _ in 0..20 { if credited.is_some() { break; } backdate(&c, "s2"); let r = beat(&mut c, 1, &b("s2", true, 1.0, 1)).unwrap(); credited = r.credited; if r.active_seconds_today == 0 { backdate(&c, "s2"); } }
        assert!(credited.is_some());
        // a chapter read short of the day's minutes counts as read but does not keep the day (`day_met`)
        let s = streak_info(&c, 1, &user_today(&c, 1)).unwrap();
        assert!(s.today_active_seconds < s.today_goal_seconds);
        assert_eq!((s.current, s.days[0].pages, s.days[0].met), (0, 1, 0));
        let n: i64 = c.query_row("SELECT count(*) FROM page_credits WHERE user_id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        c.execute("UPDATE chapter_dwell SET credited=0 WHERE session_id='s2'", []).unwrap();
        backdate(&c, "s2");
        assert!(beat(&mut c, 1, &b("s2", true, 1.0, 1)).unwrap().credited.is_none());
    }

    #[test]
    fn evening_beats_land_on_the_readers_own_day() {
        let mut c = fresh();
        // 20:30 in Denver (UTC-6 in summer) is 02:30 UTC the next day
        let r = read_at(&mut c, "den", at("2026-09-27T02:30:00Z"), -360, 20);
        assert_eq!(r.date, "2026-09-26");
        assert_eq!(r.streak.today, "2026-09-26");
        assert_eq!(r.active_seconds_today, 20);
        // 23:30 in Auckland (UTC+12) on the 27th is 11:30 UTC on the 27th: same date
        let r = read_at(&mut c, "akl", at("2026-09-27T11:30:00Z"), 720, 20);
        assert_eq!(r.date, "2026-09-27");
        // 00:30 on the 28th in Kiritimati (UTC+14) is still the 27th at 10:30 UTC: a day ahead of UTC
        let r = read_at(&mut c, "kir", at("2026-09-27T10:30:00Z"), 840, 20);
        assert_eq!(r.date, "2026-09-28");
        let days: Vec<String> = c.prepare("SELECT date FROM activity_days WHERE user_id=1 ORDER BY date").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(days, ["2026-09-26", "2026-09-27", "2026-09-28"]);
        // the latest offset is kept for reads
        assert_eq!(user_offset(&c, 1), 840);
    }

    #[test]
    fn a_claimed_day_is_held_within_one_day_of_utc() {
        let now = at("2026-09-27T12:00:00Z");
        assert_eq!(resolve_day(now, Some("2026-09-26"), Some(-360), None), "2026-09-26");
        assert_eq!(resolve_day(now, Some("2026-09-28"), Some(840), None), "2026-09-28");
        // two days off: the device clock is wrong, so the server clock and the offset name the day
        assert_eq!(resolve_day(now, Some("2026-09-25"), Some(-360), None), "2026-09-27");
        assert_eq!(resolve_day(now, Some("2026-09-29"), None, None), "2026-09-27");
        assert_eq!(resolve_day(at("2026-09-27T03:00:00Z"), Some("2027-01-01"), Some(-420), None), "2026-09-26");
        // not a date, or an offset no zone has: the same fallback, and an absurd offset counts as UTC
        assert_eq!(resolve_day(now, Some("yesterday"), Some(-360), None), "2026-09-27");
        assert_eq!(resolve_day(at("2026-09-27T23:00:00Z"), None, Some(5000), None), "2026-09-27");
        // never before the latest credited day: a clock turned back (or a flight west) cannot refill a past day
        assert_eq!(resolve_day(now, Some("2026-09-26"), Some(-360), Some("2026-09-27")), "2026-09-27");
        assert_eq!(resolve_day(now, Some("2026-09-28"), Some(840), Some("2026-09-27")), "2026-09-28");
        assert!(valid_offset(Some(-721)).is_some() && valid_offset(Some(841)).is_none() && valid_offset(Some(-841)).is_none());
    }

    #[test]
    fn a_beat_never_moves_a_credited_day_backwards() {
        let mut c = fresh();
        small_goal(&c);
        // read on the 27th in Tokyo, fly to Honolulu and read on what the phone now calls the 26th
        read_at(&mut c, "tyo", at("2026-09-27T01:00:00Z"), 540, 20);
        let r = read_at(&mut c, "hnl", at("2026-09-27T04:00:00Z"), -600, 20);
        assert_eq!(r.date, "2026-09-27");
        assert_eq!(r.active_seconds_today, 40);
        let n: i64 = c.query_row("SELECT count(*) FROM activity_days WHERE user_id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        // the run stays alive on a day the device has not reached yet
        assert_eq!(r.streak.current, 1);
        assert_eq!(streak_info(&c, 1, "2026-09-26").unwrap().current, 1);
    }

    #[test]
    fn a_utc_minus_7_streak_survives_utc_midnight_and_ends_at_its_own() {
        let mut c = fresh();
        small_goal(&c);
        const PDT: i64 = -420;
        // evenings in Los Angeles: every one of these is past midnight UTC
        for (i, now) in ["2026-09-24T03:30:00Z", "2026-09-25T03:30:00Z", "2026-09-26T04:45:00Z"].iter().enumerate() {
            let r = read_at(&mut c, &format!("la{i}"), at(now), PDT, 20);
            assert_eq!(r.streak.current, i as i64 + 1, "evening {i}");
        }
        let dates: Vec<String> = c.prepare("SELECT date FROM activity_days WHERE user_id=1 ORDER BY date").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(dates, ["2026-09-23", "2026-09-24", "2026-09-25"]);
        // the next local morning, before reading: the streak is still alive (yesterday met), today not yet met
        let s = streak_info(&c, 1, &day_key(local_date(at("2026-09-26T15:00:00Z"), PDT))).unwrap();
        assert_eq!((s.today.as_str(), s.current, s.today_active_seconds), ("2026-09-26", 3, 0));
        // late on the 26th local (already the 27th in UTC) with nothing read: alive until the reader's own midnight
        assert_eq!(streak_info(&c, 1, &day_key(local_date(at("2026-09-27T06:59:00Z"), PDT))).unwrap().current, 3);
        // a minute past it the 26th is over unmet
        assert_eq!(streak_info(&c, 1, &day_key(local_date(at("2026-09-27T07:01:00Z"), PDT))).unwrap().current, 0);
        // reads without a date judge by the stored offset
        assert_eq!(user_offset(&c, 1), PDT);
    }

    #[test]
    fn the_week_is_the_readers_week() {
        // Saturday 21:30 in Denver is already the Lord's day in UTC: the week is still the one that began on the 20th
        let now = at("2026-09-27T03:30:00Z");
        assert_eq!(week_start(now.date()), date("2026-09-27"));
        assert_eq!(week_start(local_date(now, -360)), date("2026-09-20"));
        // the Lord's day morning in Sydney is Saturday evening in UTC: the new week has begun there
        let now = at("2026-09-26T21:00:00Z");
        assert_eq!(week_start(now.date()), date("2026-09-20"));
        assert_eq!(week_start(local_date(now, 600)), date("2026-09-27"));
    }

    #[test]
    fn hour_badges_read_the_readers_clock() {
        let mut c = fresh();
        // 23:40 UTC is past 11 pm by UTC, but 17:40 in Denver: no night owl for that reader
        let codes = credit_at(&mut c, at("2026-09-26T23:40:00Z"), -360);
        assert!(!codes.iter().any(|b| b == "night_owl" || b == "early_bird"), "{codes:?}");
        let hour_badges = |c: &Conn, offset: i64| {
            c.execute("UPDATE page_credits SET tz_offset_min=?1", params![offset]).unwrap();
            c.execute("DELETE FROM badges", []).unwrap();
            crate::badges::check_badges(c, 1).unwrap().iter().map(|b| b.code).filter(|c| *c == "night_owl" || *c == "early_bird").collect::<Vec<_>>()
        };
        assert_eq!(hour_badges(&c, 300), ["early_bird"]); // 04:3x the next morning at UTC+5
        assert_eq!(hour_badges(&c, -30), ["night_owl"]); // 23:0x at UTC-0:30
        assert_eq!(hour_badges(&c, 0), ["night_owl"]); // credits from before the column: UTC, as they were judged
    }
    /// A visit to `book` `chapter`: an opening beat at `start`, then one beat per `(seconds after the previous, reached_end)`.
    /// Whether a beat credited the chapter, per beat.
    fn visit(c: &mut Conn, sid: &str, chapter: (i64, i64), start: &str, beats: &[(i64, Option<bool>, f64)]) -> Vec<bool> {
        let mut t = at(start);
        let beat = |t, reached_end, progress| Beat { book: Some(chapter.0), chapter: Some(chapter.1), reached_end, progress: Some(progress), ..local_beat(sid, t, 0) };
        beat_at(c, 1, &beat(t, Some(false), 0.0), t).unwrap();
        beats.iter().map(|&(secs, end, progress)| { t += time::Duration::seconds(secs); beat_at(c, 1, &beat(t, end, progress), t).unwrap().credited.is_some() }).collect()
    }
    fn chapter(c: &Conn, book: i64, chapter: i64, words: i64) { c.execute("INSERT INTO chapters (book, chapter, words, verse_count) VALUES (?1,?2,?3,10)", params![book, chapter, words]).unwrap(); }
    const END: Option<bool> = Some(true);
    const NOT_END: Option<bool> = Some(false);

    #[test]
    fn required_time_is_a_250_wpm_read_held_to_45_s_and_10_min() {
        assert_eq!(crate::bible::required_seconds(0), 45);
        assert_eq!(crate::bible::required_seconds(100), 45); // 24 s at 250 wpm: the floor
        assert_eq!(crate::bible::required_seconds(600), 144);
        assert_eq!(crate::bible::required_seconds(2000), 480);
        assert_eq!(crate::bible::required_seconds(5000), 600); // 20 min: the cap
    }

    #[test]
    fn a_short_chapter_credits_once_its_end_is_reached_and_the_floor_is_met() {
        let mut c = fresh();
        chapter(&c, 19, 117, 27); // Psalm 117: 6 s at 250 wpm, held to 45 s
        // it fits the screen, so the end is reached from the first beat; 40 s is under the floor
        assert_eq!(visit(&mut c, "ps", (19, 117), "2026-09-26T12:00:00Z", &[(15, END, 1.0), (20, END, 1.0), (5, END, 1.0), (5, END, 1.0)]), [false, false, false, true]);
        let (dwell, n): (i64, i64) = c.query_row("SELECT dwell_seconds, count(*) FROM page_credits WHERE book=19 AND chapter=117", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((dwell, n), (45, 1));
    }

    #[test]
    fn a_long_chapter_needs_its_own_threshold() {
        let mut c = fresh();
        chapter(&c, 19, 119, 2000); // 480 s
        let mut beats = vec![(20, NOT_END, 0.5); 10];
        beats.extend([(20, END, 1.0); 14]); // 480 s in all, at the end from 220 s on
        let got = visit(&mut c, "long", (19, 119), "2026-09-26T12:00:00Z", &beats);
        assert_eq!(got.iter().position(|x| *x), Some(23), "{got:?}");
        assert_eq!(got.iter().filter(|x| **x).count(), 1);
    }

    #[test]
    fn a_scroll_blast_to_the_end_earns_nothing_until_the_time_is_spent() {
        let mut c = fresh();
        chapter(&c, 19, 119, 2000);
        // straight to the bottom, then 60 s: the end is reached but the time is not
        assert_eq!(visit(&mut c, "blast", (19, 119), "2026-09-26T12:00:00Z", &[(5, END, 1.0), (20, END, 1.0), (20, END, 1.0), (15, END, 1.0)]), [false; 4]);
        // time spent away from the end never credits by itself (the blast-then-halfway case)...
        let more = visit(&mut c, "blast", (19, 119), "2026-09-26T12:01:00Z", &[(20, NOT_END, 0.3); 21]);
        assert!(more.iter().all(|x| !x), "{more:?}");
        // ...but a beat at the end, once 480 s are on the chapter, does
        assert_eq!(visit(&mut c, "blast", (19, 119), "2026-09-26T12:09:00Z", &[(20, END, 1.0)]), [true]);
    }

    #[test]
    fn no_credit_without_reaching_the_end() {
        let mut c = fresh();
        // Revelation 1 (600 words, 144 s): ten minutes on it, never at the end
        assert!(visit(&mut c, "stay", (65, 1), "2026-09-26T12:00:00Z", &[(20, NOT_END, 0.97); 30]).iter().all(|x| !x));
        // a later beat at the end credits at once: the time is already there
        assert_eq!(visit(&mut c, "stay", (65, 1), "2026-09-26T12:11:00Z", &[(20, END, 1.0)]), [true]);
    }

    #[test]
    fn a_client_without_reached_end_counts_the_bottom_of_the_scroll() {
        let mut c = fresh();
        assert!(visit(&mut c, "old1", (65, 1), "2026-09-26T12:00:00Z", &[(20, None, 0.9); 6]).iter().all(|x| !x));
        let got = visit(&mut c, "old2", (65, 1), "2026-09-26T12:10:00Z", &[(20, None, 1.0); 10]);
        assert_eq!(got.iter().position(|x| *x), Some(7), "{got:?}"); // 160 s ≥ 144 s
    }

    /// Credits Revelation 1 by beats ending at `now` from a device at `offset`; the codes of the badges it earned.
    fn credit_at(c: &mut Conn, now: time::OffsetDateTime, offset: i64) -> Vec<String> {
        let mut codes = Vec::new();
        for i in (0..20).rev() {
            let t = now - time::Duration::seconds(i * 20);
            let r = beat_at(c, 1, &Beat { progress: Some(1.0), reached_end: Some(true), ..local_beat("cr", t, offset) }, t).unwrap();
            codes.extend(r.new_badges.iter().map(|b| b.code.to_string()));
            if r.credited.is_some() { return codes; }
        }
        panic!("never credited");
    }
}
