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
    /// Verse ranges on screen since the previous beat (readthrough.rs). A beat that carries `seen` or `heard` is judged
    /// by the read-through rule; one with neither comes from an app older than it and keeps the end-and-time rule.
    #[serde(default)] pub seen: Option<crate::readthrough::Ranges>,
    /// Verse ranges the voice finished since the previous beat.
    #[serde(default)] pub heard: Option<crate::readthrough::Ranges>,
    /// The voice is reading this chapter: a beat with the screen off still brings the time the verses it finished take.
    #[serde(default)] pub listening: Option<bool>,
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
    pub incoming_invites: i64,
    /// Where the beat's chapter stands under the read-through rule; absent for a beat from an older app.
    #[serde(skip_serializing_if = "Option::is_none")] pub reading: Option<crate::readthrough::Standing> }

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
    // everything from reading the clock to moving it is one write transaction, taken at once: two beats sent together
    // queue here instead of each counting the same gap
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let sess: Option<(i64, String)> = tx.query_row("SELECT user_id, last_beat_at FROM activity_sessions WHERE id=?1", params![b.session_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    // the read-through rule's view of the chapter, read before the time is counted: a beat while the voice reads can
    // bring the time the verses it finished take, so the time depends on them
    let through = match (b.book, b.chapter) {
        (Some(book), Some(chapter)) if b.seen.is_some() || b.heard.is_some() => Some(Through::open(&tx, user_id, book, chapter, &date, now)?),
        _ => None,
    };
    // the reader's own clock: the last beat that counted time, from any of their sessions. A beat counts the time since
    // the later of that and its own session's last beat, so sessions or devices beating side by side never count the
    // same seconds twice (a chapter's time is the reader's, not the session's). A beat that counts nothing leaves the
    // clock alone, so a tab left open on another device does not eat into the one being read.
    let user_last: Option<String> = tx.query_row("SELECT last_beat_at FROM users WHERE id=?1", params![user_id], |r| r.get(0))?;
    let mut earned_ms = 0i64;
    match sess {
        None => { tx.execute("INSERT INTO activity_sessions (id, user_id, started_at, last_beat_at, device) VALUES (?1,?2,?3,?3,?4)", params![b.session_id, user_id, now_s, b.device])?; }
        Some((uid, _)) if uid != user_id => anyhow::bail!("session belongs to another user"),
        Some((_, last)) => {
            let from = [Some(last.as_str()), user_last.as_deref()].into_iter().flatten().filter_map(parse_iso).max();
            let elapsed_ms = from.map_or(0, |t| (now - t).whole_milliseconds() as i64).max(0);
            earned_ms = match &through {
                Some(t) => {
                    let cost = crate::readthrough::heard_cost_ms(&t.shape, b.heard.as_ref());
                    // the voice finishing a verse is the voice reading, whatever the flag says (it goes idle at the end)
                    let listening = b.listening.unwrap_or(false) || b.heard.as_ref().is_some_and(|h| !h.is_empty());
                    crate::readthrough::earned_ms(elapsed_ms, b.active, b.visible, listening, cost)
                }
                None if b.active && b.visible => elapsed_ms.min(MAX_BEAT_SECONDS * 1000),
                None => 0,
            };
            tx.execute("UPDATE activity_sessions SET last_beat_at=?1, active_seconds=active_seconds+?2 WHERE id=?3", params![now_s, earned_ms / 1000, b.session_id])?;
        }
    }
    if earned_ms > 0 { tx.execute("UPDATE users SET last_beat_at=?1 WHERE id=?2", params![now_s, user_id])?; }
    let earned = earned_ms / 1000;
    let mut credited = None;
    let mut chapter_new = 0i64;
    let mut reading = None;
    if let (Some(book), Some(chapter), Some(t)) = (b.book, b.chapter, through) {
        tx.execute("INSERT INTO chapter_dwell (session_id, book, chapter, active_seconds, max_progress, signal_events, reached_end) VALUES (?1,?2,?3,?4,?5,?6,?7)
            ON CONFLICT(session_id, book, chapter) DO UPDATE SET active_seconds=active_seconds+excluded.active_seconds, max_progress=max(max_progress, excluded.max_progress), signal_events=signal_events+excluded.signal_events, reached_end=max(reached_end, excluded.reached_end)",
            params![b.session_id, book, chapter, earned, b.progress.unwrap_or(0.0).clamp(0.0, 1.0), b.signals.unwrap_or(0).clamp(0, 50), b.reached_end.unwrap_or(false) as i64])?;
        let standing = t.beat(&tx, earned_ms, b.seen.as_ref(), b.heard.as_ref(), b.signals.unwrap_or(0), &now_s)?;
        if standing.judgement.read && !standing.credited_today {
            let (c, new) = credit(&tx, user_id, &b.session_id, book, chapter, &date, standing.through.active_ms / 1000, &now_s, offset)?;
            credited = c; chapter_new = new;
            t.close(&tx, &standing.through, &date, &now_s)?;
        }
        crate::readthrough::forget_old(&tx, user_id, now)?;
        reading = Some(crate::readthrough::Standing { credited_today: standing.credited_today || standing.judgement.read, ..standing });
    } else if let (Some(book), Some(chapter)) = (b.book, b.chapter) {
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
        // a chapter the text does not have is never credited (it was taken as 1000 words)
        let exists: bool = tx.query_row("SELECT 1 FROM chapters WHERE book=?1 AND chapter=?2", params![book, chapter], |_| Ok(true)).optional()?.unwrap_or(false);
        if cred == 0 && end && exists && dwell >= chapter_required_seconds(&tx, book, chapter) {
            (credited, chapter_new) = credit(&tx, user_id, &b.session_id, book, chapter, &date, dwell, &now_s, offset)?;
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
    Ok(BeatResult { active_seconds_today: ta, pages_today: tp, credited, streak: streak_info(conn, user_id, &date)?, new_badges, date, unseen_reactions, incoming_invites, reading })
}

/// Credits a chapter on `date`: the session's dwell row, the day's credit (once a day), the chapter's read count.
/// Returns the credit when it is new today, and 1 when the chapter was never read before.
#[allow(clippy::too_many_arguments)]
fn credit(tx: &rusqlite::Transaction, user_id: i64, session: &str, book: i64, chapter: i64, date: &str, dwell: i64, now_s: &str, offset: i64) -> rusqlite::Result<(Option<Credited>, i64)> {
    tx.execute("UPDATE chapter_dwell SET credited=1 WHERE session_id=?1 AND book=?2 AND chapter=?3", params![session, book, chapter])?;
    let n = tx.execute("INSERT OR IGNORE INTO page_credits (user_id, book, chapter, date, dwell_seconds, credited_at, tz_offset_min) VALUES (?1,?2,?3,?4,?5,?6,?7)", params![user_id, book, chapter, date, dwell, now_s, offset])?;
    if n == 0 { return Ok((None, 0)) }
    let before: Option<i64> = tx.query_row("SELECT 1 FROM chapters_read WHERE user_id=?1 AND book=?2 AND chapter=?3", params![user_id, book, chapter], |r| r.get(0)).optional()?;
    tx.execute("INSERT INTO chapters_read (user_id, book, chapter, first_read_at, last_read_at) VALUES (?1,?2,?3,?4,?4) ON CONFLICT(user_id, book, chapter) DO UPDATE SET times=times+1, last_read_at=excluded.last_read_at", params![user_id, book, chapter, now_s])?;
    Ok((Some(Credited { book, chapter }), before.is_none() as i64))
}

/// A beat's chapter under the read-through rule: its shape, and the reader's state on it as stored (None: credited
/// today already, nothing more counts until tomorrow; or a chapter the text does not have).
struct Through { user_id: i64, book: i64, chapter: i64, shape: std::sync::Arc<crate::readthrough::Shape>, state: Option<crate::readthrough::ReadThrough>, credited_today: bool }

impl Through {
    fn open(conn: &rusqlite::Connection, user_id: i64, book: i64, chapter: i64, date: &str, now: time::OffsetDateTime) -> anyhow::Result<Through> {
        use crate::readthrough as rt;
        let mut shape = rt::shape(conn, book, chapter)?;
        // the reader's own pace, once learned, sets the time a verse read asks
        if let Some(p) = rt::pace_ms_per_word(conn, user_id)? { shape = std::sync::Arc::new(rt::Shape { ms_per_word: Some(p), ..(*shape).clone() }); }
        let stored = rt::load(conn, user_id, book, chapter)?;
        let credited_today = stored.as_ref().and_then(|s| s.credited_date.as_deref()) == Some(date);
        // kept while read within the last two days and not credited since (a credit on an earlier day starts it again)
        let keep = |s: &rt::Stored| s.credited_date.is_none() && parse_iso(&s.updated_at).is_some_and(|t| now - t < time::Duration::hours(rt::KEEP_HOURS));
        let stale = stored.as_ref().is_some_and(|s| !credited_today && !keep(s));
        // a chapter starting again starts with no touches and no timing either
        if stale { rt::drop_row(conn, user_id, book, chapter)?; }
        let state = (!shape.words.is_empty() && !credited_today).then(|| rt::fit(stored.filter(keep).and_then(|s| s.through), &shape));
        Ok(Through { user_id, book, chapter, shape, state, credited_today })
    }
    /// Adds the beat to the chapter and stores it.
    fn beat(&self, tx: &rusqlite::Transaction, ms: i64, seen: Option<&crate::readthrough::Ranges>, heard: Option<&crate::readthrough::Ranges>, signals: i64, now_s: &str) -> rusqlite::Result<crate::readthrough::Standing> {
        use crate::readthrough as rt;
        let through = match &self.state {
            // stored only when it changed, so the two days run from the last reading, not the last look
            Some(st) => { let t = rt::apply(st, &self.shape, ms, seen, heard); if t != *st { rt::save(tx, self.user_id, self.book, self.chapter, &t, None, now_s)?; } t }
            None => rt::fresh(&self.shape),
        };
        let mut judgement = rt::judge(&through, &self.shape);
        // nothing to credit in a chapter the text does not have, nor twice in a day
        if self.state.is_none() { judgement.read = false; } else { rt::note_reading(tx, self.user_id, self.book, self.chapter, signals, judgement.covered, through.active_ms)?; }
        // the recordings' timings go with a chapter being listened to, so the device counts down as the server will
        let audio_ms = if through.heard.iter().any(|h| *h != 0) { self.shape.audio_ms.clone() } else { None };
        Ok(rt::Standing { book: self.book, chapter: self.chapter, through, judgement, credited_today: self.credited_today, audio_ms, ms_per_word: self.shape.ms_per_word })
    }
    /// Holds the chapter as credited on `date`: nothing more counts toward it until the next day starts it again. A chapter
    /// read through by the reader's own touches and scrolls teaches the server their pace.
    fn close(&self, tx: &rusqlite::Transaction, t: &crate::readthrough::ReadThrough, date: &str, now_s: &str) -> rusqlite::Result<()> {
        use crate::readthrough as rt;
        rt::learn_pace(tx, self.user_id, self.book, self.chapter, self.shape.words.iter().sum(), t.heard.iter().any(|h| *h != 0))?;
        rt::save(tx, self.user_id, self.book, self.chapter, t, Some(date), now_s)
    }
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
    fn backdate(c: &Conn, sid: &str) {
        c.execute("UPDATE activity_sessions SET last_beat_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 seconds') WHERE id=?1", params![sid]).unwrap();
        c.execute("UPDATE users SET last_beat_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 seconds')", []).unwrap();
    }
    fn b(sid: &str, active: bool, progress: f64, signals: i64) -> Beat { Beat { session_id: sid.into(), book: Some(65), chapter: Some(1), progress: Some(progress), signals: Some(signals), active, visible: true, device: None, local_date: None, tz_offset_min: None, reached_end: Some(progress >= 1.0), seen: None, heard: None, listening: None } }
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
        // 00:30 on the 28th in Kiritimati (UTC+14) is still the 27th at 10:30 UTC: a day ahead of UTC. (Sent after the
        // 11:30 beat, so the reader's clock is put back first: a server's own clock never runs backwards.)
        c.execute("UPDATE users SET last_beat_at=NULL WHERE id=1", []).unwrap();
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

    /// Read aloud (client/src/store/player.tsx, useActivity): each spoken verse counts as input, so every 15 s beat earns
    /// its time, and the end is reached when the voice finishes the chapter, `secs` after it began: the last beat says so.
    fn listened(c: &mut Conn, sid: &str, chapter: (i64, i64), secs: i64) -> Vec<bool> {
        let mut beats = vec![(15, NOT_END, 0.5); (secs / 15) as usize];
        beats.push((secs % 15, END, 1.0));
        visit(c, sid, chapter, "2026-09-26T12:00:00Z", &beats)
    }

    #[test]
    fn a_chapter_listened_to_its_end_is_credited_when_the_recording_outlasts_the_time_its_length_asks() {
        // John 3, 802 words: 192 s at 250 wpm. The three voices take 222 s to 266 s over it at 1× (167 to 217 wpm)
        let john3 = |secs: i64| { let mut c = fresh(); chapter(&c, 43, 3, 802); assert_eq!(chapter_required_seconds(&c, 43, 3), 192); listened(&mut c, "aloud", (43, 3), secs) };
        for secs in [222, 266] {
            let got = john3(secs);
            assert_eq!((got.iter().filter(|x| **x).count(), got.last()), (1, Some(&true)), "{secs} s at 1×: credited once, by the beat that ends it");
        }
        // at 1.5×, the fastest speed offered (client/src/lib/tts.ts SPEEDS), the same recordings last 148 s to 177 s, and
        // the half-second pauses between 36 verses add 17 s: all but the slowest end under the 192 s, uncredited
        for secs in [148, 148 + 17, 177] { assert!(john3(secs).iter().all(|x| !x), "{secs} s at 1.5×"); }
        assert_eq!(john3(177 + 17).last(), Some(&true), "the slowest voice with its pauses just meets it");
        // the rule is the same for a listener: staying at the end for the time still owing credits the chapter
        let mut c = fresh();
        chapter(&c, 43, 3, 802);
        assert!(listened(&mut c, "aloud", (43, 3), 165).iter().all(|x| !x));
        assert_eq!(visit(&mut c, "aloud", (43, 3), "2026-09-26T12:02:45Z", &[(15, END, 1.0), (12, END, 1.0)]), [false, true]);
        // a chapter shorter than the 45 s floor is not credited by its recording at any speed: Psalm 117 is 13 s to 18 s
        let mut c = fresh();
        chapter(&c, 19, 117, 27);
        assert!(listened(&mut c, "aloud", (19, 117), 18).iter().all(|x| !x));
    }

    // ---------------- the read-through rule (readthrough.rs): beats that say what went past the reader

    /// A chapter whose verses have these many words each.
    fn verses(c: &Conn, book: i64, chapter: i64, words: &[i64]) {
        c.execute("INSERT OR IGNORE INTO chapters (book, chapter, words, verse_count) VALUES (?1,?2,?3,?4)", params![book, chapter, words.iter().sum::<i64>(), words.len() as i64]).unwrap();
        for (i, w) in words.iter().enumerate() { c.execute("INSERT INTO verses (book, chapter, verse, text) VALUES (?1,?2,?3,?4)", params![book, chapter, i as i64 + 1, vec!["word"; *w as usize].join(" ")]).unwrap(); }
    }
    /// One beat `secs` after the last: the verses on screen and heard since it; `screen`: the reader is active on a
    /// showing screen (else the screen is off and only the voice can bring time).
    struct Step { secs: i64, seen: Vec<[i64; 2]>, heard: Vec<[i64; 2]>, screen: bool, listening: bool }
    fn on(secs: i64, a: i64, b: i64) -> Step { Step { secs, seen: vec![[a, b]], heard: vec![], screen: true, listening: false } }
    fn aloud(secs: i64, a: i64, b: i64) -> Step { Step { secs, seen: vec![], heard: vec![[a, b]], screen: false, listening: true } }
    /// Beats on chapter `ch` from session `sid`, the first (opening the session) at `start`; each beat's result.
    fn through(c: &mut Conn, sid: &str, ch: (i64, i64), start: time::OffsetDateTime, steps: &[Step]) -> Vec<BeatResult> {
        let mut t = start;
        let beat = |t, s: &Step| Beat { book: Some(ch.0), chapter: Some(ch.1), active: s.screen, visible: s.screen, seen: Some(s.seen.clone()), heard: Some(s.heard.clone()), listening: Some(s.listening), ..local_beat(sid, t, 0) };
        beat_at(c, 1, &beat(t, &on(0, 1, 1)), t).unwrap();
        steps.iter().map(|s| { t += time::Duration::seconds(s.secs); beat_at(c, 1, &beat(t, s), t).unwrap() }).collect()
    }
    impl Beat { fn with_session(self, sid: &str) -> Beat { Beat { session_id: sid.into(), ..self } } }
    fn credits(rs: &[BeatResult]) -> Vec<usize> { rs.iter().enumerate().filter(|(_, r)| r.credited.is_some()).map(|(i, _)| i).collect() }
    const PHLM: (i64, i64) = (57, 1);
    /// Six verses of 100 words: 600 words, 144 s at 250 words a minute.
    fn philemon(c: &Conn) { verses(c, PHLM.0, PHLM.1, &[100; 6]); }

    #[test]
    fn a_chapter_read_through_counts_wherever_the_reader_is_when_its_time_is_met() {
        let mut c = fresh();
        philemon(&c);
        // a screen at a time to the end in 90 s, then back up to verses 2 and 3 to read them again: the time is met there
        let mut steps: Vec<Step> = [(1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 6)].iter().map(|&(a, b)| on(15, a, b)).collect();
        steps.extend((0..6).map(|_| on(15, 2, 3)));
        let rs = through(&mut c, "s", PHLM, at("2026-10-14T12:00:00Z"), &steps);
        assert_eq!(credits(&rs), [9], "credited once, at 150 s, on the beat that met 144 s, away from the end");
        let r = rs[9].reading.as_ref().unwrap();
        assert!(r.credited_today && r.judgement.covered && r.judgement.required_ms == 144_000);
        assert!(rs[10].reading.as_ref().unwrap().credited_today);
        assert_eq!(rs[8].reading.as_ref().unwrap().judgement.owing_ms, 9_000, "the beat before says what is still owed");
    }

    #[test]
    fn a_chapter_flicked_through_is_not_read_however_long_the_reader_waits_at_its_end() {
        let mut c = fresh();
        philemon(&c);
        let mut steps = vec![on(5, 1, 6)];
        steps.extend((0..14).map(|_| on(15, 6, 6)));
        let rs = through(&mut c, "s", PHLM, at("2026-10-14T12:00:00Z"), &steps);
        assert!(credits(&rs).is_empty());
        let last = rs.last().unwrap().reading.as_ref().unwrap();
        assert!(last.through.active_ms >= 144_000);
        assert_eq!(last.judgement.gaps, vec![[1, 5]], "what is still to read: 600 words went by in 5 s, enough for 62 of them");
        // the old rule, still applied to the beats of an older app, credits the same visit
        let mut c = fresh();
        chapter(&c, 43, 3, 600);
        let mut beats = vec![(5, END, 1.0)];
        beats.extend(vec![(15, END, 1.0); 14]);
        assert!(visit(&mut c, "old", (43, 3), "2026-10-14T12:00:00Z", &beats).iter().any(|x| *x));
    }

    #[test]
    fn a_chapter_heard_with_the_screen_off_counts() {
        let mut c = fresh();
        philemon(&c);
        // the voice reads a verse every 30 s with the phone locked; the beats come late and say what it finished
        let steps: Vec<Step> = (1..=6).map(|v| aloud(30, v, v)).collect();
        let rs = through(&mut c, "s", PHLM, at("2026-10-14T12:00:00Z"), &steps);
        assert_eq!(credits(&rs), [5]);
        assert_eq!(rs[5].active_seconds_today, 180, "and the time counts toward the day");
        // a locked screen with no voice reading brings nothing
        let mut c = fresh();
        philemon(&c);
        let idle: Vec<Step> = (0..12).map(|_| Step { listening: false, heard: vec![], ..aloud(30, 1, 1) }).collect();
        let rs = through(&mut c, "s", PHLM, at("2026-10-14T12:00:00Z"), &idle);
        assert!(credits(&rs).is_empty());
        assert_eq!(rs.last().unwrap().active_seconds_today, 0);
    }

    #[test]
    fn listening_again_with_the_screen_off_still_counts_toward_the_day() {
        let mut c = fresh();
        philemon(&c);
        let steps: Vec<Step> = (1..=6).map(|v| aloud(30, v, v)).collect();
        assert_eq!(credits(&through(&mut c, "a", PHLM, at("2026-10-14T12:00:00Z"), &steps)), [5]);
        let rs = through(&mut c, "b", PHLM, at("2026-10-14T13:00:00Z"), &steps);
        assert!(credits(&rs).is_empty(), "once a day");
        assert_eq!(rs[5].active_seconds_today, 360, "the second listen counts toward the day as the first did");
    }

    #[test]
    fn sessions_side_by_side_count_the_same_seconds_once() {
        let mut c = fresh();
        philemon(&c);
        // eight sessions opened together, each beating 20 s later and claiming the whole chapter seen
        let t0 = at("2026-10-14T12:00:00Z");
        let beat = |sid: &str, t| Beat { book: Some(PHLM.0), chapter: Some(PHLM.1), seen: Some(vec![[1, 6]]), heard: Some(vec![]), listening: Some(false), ..local_beat(sid, t, 0) };
        for i in 0..8 { beat_at(&mut c, 1, &beat(&format!("s{i}"), t0), t0).unwrap(); }
        let t1 = t0 + time::Duration::seconds(20);
        let rs: Vec<BeatResult> = (0..8).map(|i| beat_at(&mut c, 1, &beat(&format!("s{i}"), t1), t1).unwrap()).collect();
        assert!(credits(&rs).is_empty());
        assert_eq!(rs[7].active_seconds_today, 20, "20 s passed, 20 s counted");
        assert_eq!(rs[7].reading.as_ref().unwrap().through.active_ms, 20_000);
        // two devices taking turns on one chapter: the time counted is the time that passed
        let mut c = fresh();
        philemon(&c);
        let mut t = t0;
        beat_at(&mut c, 1, &beat("phone", t), t).unwrap();
        beat_at(&mut c, 1, &beat("web", t), t).unwrap();
        for i in 0..8 { t += time::Duration::milliseconds(7_500); beat_at(&mut c, 1, &beat(if i % 2 == 0 { "phone" } else { "web" }, t), t).unwrap(); }
        let r = beat_at(&mut c, 1, &beat("phone", t), t).unwrap();
        assert_eq!(r.reading.unwrap().through.active_ms, 60_000);
    }

    #[test]
    fn two_beats_sent_at_once_count_the_gap_once() {
        let path = std::env::temp_dir().join(format!("berean-race-{}.db", crate::auth::random_token(6)));
        let pool = crate::db::open_pool(path.to_str().unwrap(), None).unwrap();
        {
            let c = pool.get().unwrap();
            c.execute("INSERT INTO users (handle, display_name, password_hash) VALUES ('t', 'T', 'x')", []).unwrap();
            verses(&c, PHLM.0, PHLM.1, &[100; 6]);
        }
        let t0 = at("2026-10-14T12:00:00Z");
        let beat = |t| Beat { book: Some(PHLM.0), chapter: Some(PHLM.1), seen: Some(vec![[1, 2]]), heard: Some(vec![]), listening: Some(false), ..local_beat("one", t, 0) };
        beat_at(&mut pool.get().unwrap(), 1, &beat(t0), t0).unwrap();
        let t1 = t0 + time::Duration::seconds(15);
        let gate = std::sync::Barrier::new(4);
        std::thread::scope(|s| {
            for _ in 0..4 { s.spawn(|| { let mut c = pool.get().unwrap(); gate.wait(); beat_at(&mut c, 1, &beat(t1), t1).unwrap(); }); }
        });
        let c = pool.get().unwrap();
        let day: i64 = c.query_row("SELECT active_seconds FROM activity_days WHERE user_id=1", [], |r| r.get(0)).unwrap();
        let state: String = c.query_row("SELECT state FROM read_throughs WHERE user_id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(day, 15, "four beats at once, one 15 s gap");
        assert!(state.contains("\"activeMs\":15000"), "{state}");
    }

    #[test]
    fn a_tab_left_open_elsewhere_does_not_eat_into_the_reading() {
        let mut c = fresh();
        philemon(&c);
        let t0 = at("2026-10-14T12:00:00Z");
        let reading = |t| Beat { book: Some(PHLM.0), chapter: Some(PHLM.1), seen: Some(vec![[1, 1]]), heard: Some(vec![]), listening: Some(false), ..local_beat("phone", t, 0) };
        let idle = |t| Beat { active: false, ..reading(t) }.with_session("web");
        beat_at(&mut c, 1, &reading(t0), t0).unwrap();
        beat_at(&mut c, 1, &idle(t0), t0).unwrap();
        let mut last = None;
        for i in 1..=4 {
            beat_at(&mut c, 1, &idle(t0 + time::Duration::seconds(15 * i - 7)), t0 + time::Duration::seconds(15 * i - 7)).unwrap();
            last = Some(beat_at(&mut c, 1, &reading(t0 + time::Duration::seconds(15 * i)), t0 + time::Duration::seconds(15 * i)).unwrap());
        }
        assert_eq!(last.unwrap().reading.unwrap().through.active_ms, 60_000);
    }

    #[test]
    fn the_voice_going_quiet_at_the_end_keeps_the_verses_it_read() {
        let mut c = fresh();
        philemon(&c);
        // the last verse ends as the voice stops: that beat says it was heard and no longer that the voice is reading
        let mut steps: Vec<Step> = (1..=5).map(|v| aloud(30, v, v)).collect();
        steps.push(Step { listening: false, ..aloud(30, 6, 6) });
        assert_eq!(credits(&through(&mut c, "s", PHLM, at("2026-10-14T12:00:00Z"), &steps)), [5]);
    }

    #[test]
    fn listening_again_to_verses_heard_before_still_counts_toward_the_day() {
        let mut c = fresh();
        philemon(&c);
        let first: Vec<Step> = (1..=3).map(|v| aloud(30, v, v)).collect();
        through(&mut c, "a", PHLM, at("2026-10-14T12:00:00Z"), &first);
        let rs = through(&mut c, "b", PHLM, at("2026-10-14T13:00:00Z"), &first);
        assert_eq!(rs[2].active_seconds_today, 180);
    }

    /// A chapter of 6 verses x 60 words (360 words, 86.4 s at 250 a minute) read a verse a beat, 10 s apart (360 a
    /// minute), touching once a beat, then waited on at its end until it counts. Returns the beat it was credited on.
    fn read_quickly(c: &mut Conn, ch: (i64, i64), start: time::OffsetDateTime, touches: i64) -> Option<usize> {
        let mut t = start;
        let beat = |t, a: i64, b: i64| Beat { book: Some(ch.0), chapter: Some(ch.1), seen: Some(vec![[a, b]]), heard: Some(vec![]), listening: Some(false), signals: Some(touches), ..local_beat(&format!("quick-{}-{}", ch.0, ch.1), t, 0) };
        beat_at(c, 1, &beat(t, 1, 1), t).unwrap();
        let mut steps: Vec<(i64, i64)> = (1..=6).map(|v| (v, v)).collect();
        steps.extend(vec![(6, 6); 12]);
        steps.iter().position(|&(a, b)| { t += time::Duration::seconds(10); beat_at(c, 1, &beat(t, a, b), t).unwrap().credited.is_some() })
    }

    #[test]
    fn a_reader_who_touches_and_scrolls_through_quickly_earns_a_quicker_pace() {
        let mut c = fresh();
        for ch in 1..=7 { verses(&c, 19, ch, &[60; 6]); }
        let day = at("2026-10-14T08:00:00Z");
        // the unhurried pace at first: 86.4 s, the 9th beat (90 s)
        for ch in 1..=5 { assert_eq!(read_quickly(&mut c, (19, ch), day + time::Duration::hours(ch), 1), Some(8), "chapter {ch}"); }
        // five chapters taken in at 360 a minute, touched all the way: 360 a minute is now theirs (60 s, the 6th beat)
        assert_eq!(crate::readthrough::pace_ms_per_word(&c, 1).unwrap(), Some(166));
        assert_eq!(read_quickly(&mut c, (19, 6), day + time::Duration::hours(6), 1), Some(5));
        // not touched: says nothing about the reader, and the pace stays what it was
        let mut c = fresh();
        for ch in 1..=7 { verses(&c, 19, ch, &[60; 6]); }
        for ch in 1..=6 { read_quickly(&mut c, (19, ch), day + time::Duration::hours(ch), 0); }
        assert_eq!(crate::readthrough::pace_ms_per_word(&c, 1).unwrap(), None);
    }

    #[test]
    fn a_pace_is_learned_only_from_reading_and_held_to_400_a_minute() {
        use crate::readthrough::{pace_of, pace_sample};
        assert_eq!(pace_sample(360, 60_000, 4, false), Some(360));
        assert_eq!(pace_sample(360, 60_000, 4, true), None, "heard: the voice set the pace");
        assert_eq!(pace_sample(150, 30_000, 4, false), None, "too short to say");
        assert_eq!(pace_sample(360, 60_000, 2, false), None, "a touch every 30 s: not read by hand");
        assert_eq!(pace_of(&[900, 900, 900, 900]), None, "four chapters are not enough");
        assert_eq!(pace_of(&[900, 900, 900, 900, 900]), Some(400));
        assert_eq!(pace_of(&[180, 200, 220, 240, 260]), Some(250), "never asks more than the unhurried pace");
        assert_eq!(pace_of(&[300, 1000, 310, 320, 1000, 330, 340]), Some(330), "the median, not the outliers");
    }

    #[test]
    fn a_beat_cannot_claim_a_whole_chapter_at_once() {
        let mut c = fresh();
        philemon(&c);
        let mut steps = vec![Step { secs: 20, seen: vec![[1, 6]], heard: vec![[1, 6]], screen: true, listening: true }];
        steps.extend((0..12).map(|_| on(15, 6, 6)));
        let rs = through(&mut c, "s", PHLM, at("2026-10-14T12:00:00Z"), &steps);
        assert!(credits(&rs).is_empty());
        let first = rs[0].reading.as_ref().unwrap();
        assert_eq!(first.through.heard, [0, 0, 0, 0, 0, 0], "20 s does not hold even one 100-word verse heard (24 s with no recording)");
        assert_eq!(first.through.seen, [100, 100, 50, 0, 0, 0], "and 250 words glanced, in order");
    }

    #[test]
    fn two_sittings_add_up_and_a_part_read_is_forgotten_after_two_days() {
        let mut c = fresh();
        philemon(&c);
        let start = at("2026-10-14T07:00:00Z");
        let first: Vec<Step> = [(1, 2), (2, 3), (3, 3), (3, 3), (3, 3)].iter().map(|&(a, b)| on(15, a, b)).collect();
        assert!(credits(&through(&mut c, "morning", PHLM, start, &first)).is_empty());
        let evening: Vec<Step> = [(4, 5), (5, 6), (6, 6), (6, 6), (6, 6)].iter().map(|&(a, b)| on(15, a, b)).collect();
        let rs = through(&mut c, "evening", PHLM, start + time::Duration::hours(10), &evening);
        assert_eq!(credits(&rs), [4], "75 s in the morning and 75 s in the evening make the 144 s");
        // the same halves two days and an hour apart: the first is forgotten
        let mut c = fresh();
        philemon(&c);
        through(&mut c, "monday", PHLM, start, &first);
        let rs = through(&mut c, "wednesday", PHLM, start + time::Duration::hours(49), &evening);
        assert!(credits(&rs).is_empty());
        assert_eq!(rs.last().unwrap().reading.as_ref().unwrap().judgement.gaps, vec![[1, 3]]);
    }

    #[test]
    fn a_chapter_read_through_is_credited_once_a_day_and_counts_again_the_next() {
        let mut c = fresh();
        philemon(&c);
        let read: Vec<Step> = [(1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 6), (6, 6), (6, 6), (6, 6), (6, 6)].iter().map(|&(a, b)| on(15, a, b)).collect();
        let day1 = at("2026-10-14T12:00:00Z");
        assert_eq!(credits(&through(&mut c, "a", PHLM, day1, &read)).len(), 1);
        assert!(credits(&through(&mut c, "b", PHLM, day1 + time::Duration::minutes(10), &read)).is_empty(), "read again the same day: once a day");
        assert_eq!(credits(&through(&mut c, "c", PHLM, day1 + time::Duration::days(1), &read)).len(), 1, "the next day it counts again, read in full");
        let n: i64 = c.query_row("SELECT count(*) FROM page_credits WHERE user_id=1", [], |r| r.get(0)).unwrap();
        let times: i64 = c.query_row("SELECT times FROM chapters_read WHERE user_id=1", [], |r| r.get(0)).unwrap();
        assert_eq!((n, times), (2, 2));
    }

    #[test]
    fn a_chapter_the_text_lacks_is_never_credited() {
        let mut c = fresh();
        let steps: Vec<Step> = (0..20).map(|_| on(15, 1, 1)).collect();
        let rs = through(&mut c, "s", (57, 99), at("2026-10-14T12:00:00Z"), &steps);
        assert!(credits(&rs).is_empty());
        let n: i64 = c.query_row("SELECT count(*) FROM read_throughs", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "and nothing is kept for it");
        // nor by the old rule, which took a chapter it did not know as 1000 words
        let mut c = fresh();
        assert!(visit(&mut c, "old", (65, 99), "2026-10-14T12:00:00Z", &vec![(20, END, 1.0); 40]).iter().all(|x| !x));
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
