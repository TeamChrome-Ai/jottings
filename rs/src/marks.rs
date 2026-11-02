//! A reader's own "read" marks (docs/PATHS.md rule 1, docs/READING.md "Chapters read elsewhere"): a chapter ticked by
//! hand, read outside the app. A tick counts as a chapter read (the owner, 2026-10-31): the mark writes the same
//! credit a reading does, on the reader's day, flagged `ticked` (`activity::credit_day`), so it counts wherever a
//! chapter read counts and nowhere a minute is counted. It costs no time: the streak, the daily goal, reading time and
//! the badges and boards made of minutes hold still (the tests below hold each of them). One tick per chapter; an undo
//! takes its credit back exactly (`uncredit_tick`), a badge once given aside. `chapter_marks` itself is the toggle:
//! read here, by the reader's own `GET /me/path` and by their export.
use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::{extract::{Path, State}, Json};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

/// A bulk set holds at most every chapter of the Bible.
pub const MAX_BULK: usize = 1189;
/// A reader ticking through a book and undoing; a restore or a sign-in is one bulk.
const MARK_LIMITS: &[(i64, i64)] = &[(60, 600), (600, 86_400)];
const BULK_LIMITS: &[(i64, i64)] = &[(6, 600), (30, 86_400)];

/// A chapter the Bible has, by the book table (the same in both editions; the texts database is not asked).
fn is_chapter(book: i64, chapter: i64) -> bool { crate::books::book(book).is_some_and(|b| (1..=i64::from(b.chapters)).contains(&chapter)) }

/// When a mark was made: a time a device gives is kept when it can be read and is not ahead of the clock; otherwise
/// the mark is made now.
fn mark_at(at: Option<&str>, now: time::OffsetDateTime) -> time::OffsetDateTime {
    at.and_then(|s| time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()).filter(|t| *t <= now).unwrap_or(now)
}
/// A time in the shape a device writes (`toISOString`) and `credited_at` keeps, so marks from both compare as text.
fn iso(t: time::OffsetDateTime) -> String { t.to_offset(time::UtcOffset::UTC).format(time::macros::format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z")).unwrap_or_default() }
/// The reader's day a mark made at `t` is credited on, by their latest offset.
fn day_of(conn: &Connection, uid: i64, t: time::OffsetDateTime) -> (String, i64) {
    let offset = crate::activity::user_offset(conn, uid);
    (crate::activity::day_key(crate::activity::local_date(t, offset)), offset)
}

/// The chapters a reader has marked at or after `since`, by book and chapter: their own path's place and no one else's.
pub fn marked_since(conn: &Connection, uid: i64, since: &str) -> rusqlite::Result<Vec<(i64, i64)>> {
    let mut st = conn.prepare_cached("SELECT book, chapter FROM chapter_marks WHERE user_id=?1 AND marked_at >= ?2 ORDER BY book, chapter")?;
    let v = st.query_map(params![uid, since], |r| Ok((r.get(0)?, r.get(1)?)))?.collect(); v
}

/// `{ marks: [[book, chapter, marked_at], …] }`, every mark of the reader's.
pub async fn list(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    let mut st = conn.prepare_cached("SELECT book, chapter, marked_at FROM chapter_marks WHERE user_id=?1 ORDER BY book, chapter")?;
    let marks: Vec<(i64, i64, String)> = st.query_map(params![u.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
    Ok(Json(json!({ "marks": marks })))
}
/// Marks the chapter now and credits it on the reader's today, in one transaction; the badges that gives come back as
/// a beat's do. A chapter marked already is marked afresh: its time moves, so a path begun since counts it; its one
/// tick credit stays where it was.
pub async fn set(State(s): State<AppState>, AuthUser(u): AuthUser, Path((book, chapter)): Path<(i64, i64)>) -> ApiResult<Json<Value>> {
    if !is_chapter(book, chapter) { return Err(ApiError::bad("no such chapter")); }
    let (at, new_badges) = s.db(move |conn| {
        crate::friends::limit(conn, u.id, "mark", MARK_LIMITS)?;
        let now = time::OffsetDateTime::now_utc();
        let (at, (today, offset)) = (iso(now), day_of(conn, u.id, now));
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        tx.execute("INSERT INTO chapter_marks (user_id, book, chapter, marked_at) VALUES (?1,?2,?3,?4) ON CONFLICT(user_id, book, chapter) DO UPDATE SET marked_at=excluded.marked_at", params![u.id, book, chapter, at])?;
        crate::activity::credit_day(&tx, u.id, book, chapter, &today, 0, &at, offset, true)?;
        tx.commit()?;
        Ok((at, crate::badges::check_badges_on(conn, u.id, &today)?))
    }).await?;
    Ok(Json(json!({ "ok": true, "marked_at": at, "new_badges": new_badges })))
}
/// Undoes the mark and takes its credit back; a chapter the app credited on the tick's day keeps that reading.
pub async fn clear(State(s): State<AppState>, AuthUser(u): AuthUser, Path((book, chapter)): Path<(i64, i64)>) -> ApiResult<Json<Value>> {
    if !is_chapter(book, chapter) { return Err(ApiError::bad("no such chapter")); }
    s.db(move |conn| {
        crate::friends::limit(conn, u.id, "mark", MARK_LIMITS)?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        tx.execute("DELETE FROM chapter_marks WHERE user_id=?1 AND book=?2 AND chapter=?3", params![u.id, book, chapter])?;
        crate::activity::uncredit_tick(&tx, u.id, book, chapter)?;
        tx.commit()?;
        Ok(())
    }).await?;
    Ok(Json(json!({ "ok": true })))
}

/// `[book, chapter]` or `[book, chapter, marked_at]` (a mark made on a device before it reached the account).
#[derive(Deserialize)] #[serde(untagged)] enum MarkIn { At(i64, i64, String), Plain(i64, i64) }
#[derive(Deserialize)] pub struct BulkIn { marks: Vec<MarkIn> }
/// Many at once: a backup restored, or a device's marks carried into the account at sign-in. Only ever adds: a
/// chapter marked already stays marked and keeps the later of its two times, and credits nothing. Each mark added is
/// credited on its own day (a mark made signed out keeps its day, so signing in during an event does not pour them
/// into it), the badges checked once after. One chapter the Bible has not refuses the whole list.
pub async fn bulk(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<BulkIn>) -> ApiResult<Json<Value>> {
    if b.marks.len() > MAX_BULK { return Err(ApiError::bad("marks: at most 1,189, the chapters of the Bible")); }
    let now = time::OffsetDateTime::now_utc();
    let rows: Vec<(i64, i64, time::OffsetDateTime)> = b.marks.iter().map(|m| match m { MarkIn::At(b, c, at) => (*b, *c, mark_at(Some(at), now)), MarkIn::Plain(b, c) => (*b, *c, now) }).collect();
    if rows.iter().any(|(b, c, _)| !is_chapter(*b, *c)) { return Err(ApiError::bad("marks: no such chapter")); }
    let (added, new_badges) = s.db(move |conn| {
        crate::friends::limit(conn, u.id, "mark_bulk", BULK_LIMITS)?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut added = 0;
        {
            let mut new = tx.prepare_cached("INSERT OR IGNORE INTO chapter_marks (user_id, book, chapter, marked_at) VALUES (?1,?2,?3,?4)")?;
            let mut later = tx.prepare_cached("UPDATE chapter_marks SET marked_at=?4 WHERE user_id=?1 AND book=?2 AND chapter=?3 AND marked_at < ?4")?;
            for (book, chapter, t) in &rows {
                let at = iso(*t);
                if new.execute(params![u.id, book, chapter, at])? == 0 { later.execute(params![u.id, book, chapter, at])?; continue }
                added += 1;
                let (date, offset) = day_of(&tx, u.id, *t);
                crate::activity::credit_day(&tx, u.id, *book, *chapter, &date, 0, &at, offset, true)?;
            }
        }
        tx.commit()?;
        Ok((added, crate::badges::check_badges(conn, u.id)?))
    }).await?;
    Ok(Json(json!({ "ok": true, "added": added, "new_badges": new_badges })))
}

/// Once, on the first start after ticks began to count (the owner, 2026-10-31): every mark made before becomes its
/// chapter's tick credit on the reader's day by their latest offset, and the badges that gives are given. Remembered
/// in `meta` as db.rs remembers `outlines_public_reset`; it lives here because db.rs is also the data build's, which
/// has no ledger. The number of credits written.
pub fn backfill(conn: &mut Connection) -> anyhow::Result<usize> {
    if conn.query_row("SELECT 1 FROM meta WHERE key='ticks_credited'", [], |_| Ok(())).optional()?.is_some() { return Ok(0) }
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let marks: Vec<(i64, i64, i64, String)> = {
        let mut st = tx.prepare("SELECT user_id, book, chapter, marked_at FROM chapter_marks ORDER BY user_id, marked_at")?;
        let v = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<_, _>>()?; v
    };
    let (mut n, mut readers) = (0, std::collections::BTreeSet::new());
    for (uid, book, chapter, at) in marks {
        let Ok(t) = time::OffsetDateTime::parse(&at, &time::format_description::well_known::Rfc3339) else { continue };
        let (date, offset) = day_of(&tx, uid, t);
        if crate::activity::credit_day(&tx, uid, book, chapter, &date, 0, &at, offset, true)? == crate::activity::Credit::New { n += 1; readers.insert(uid); }
    }
    for uid in readers { crate::badges::check_badges(&tx, uid)?; }
    tx.execute("INSERT INTO meta (key, value) VALUES ('ticks_credited', ?1)", [n.to_string()])?;
    tx.commit()?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::{app, call, user};
    use axum::Router;
    const NULL: Value = Value::Null;

    async fn marks(app: &Router, token: &str) -> Vec<(i64, i64)> {
        let (st, v) = call(app, "GET", "/me/marks", Some(token), NULL).await;
        assert_eq!(st, 200, "{v}");
        v["marks"].as_array().unwrap().iter().map(|m| (m[0].as_i64().unwrap(), m[1].as_i64().unwrap())).collect()
    }

    #[test]
    fn a_devices_time_is_kept_unless_it_cannot_be_read_or_is_ahead_of_the_clock() {
        let now = time::macros::datetime!(2026-10-13 12:00:00 UTC);
        let mark_time = |at: Option<&str>, now| iso(mark_at(at, now));
        assert_eq!(mark_time(None, now), "2026-10-13T12:00:00.000Z");
        assert_eq!(mark_time(Some("2026-10-01T08:30:00.250Z"), now), "2026-10-01T08:30:00.250Z");
        assert_eq!(mark_time(Some("2026-10-01T10:30:00+02:00"), now), "2026-10-01T08:30:00.000Z");
        assert_eq!(mark_time(Some("2027-01-01T00:00:00Z"), now), "2026-10-13T12:00:00.000Z");
        assert_eq!(mark_time(Some("last week"), now), "2026-10-13T12:00:00.000Z");
    }

    #[tokio::test]
    async fn a_chapter_is_marked_once_listed_and_unmarked_and_only_by_its_reader() {
        let (app, pool) = app();
        let (_, anna) = user(&pool, "anna");
        let (_, ben) = user(&pool, "ben");
        assert_eq!(call(&app, "GET", "/me/marks", None, NULL).await.0, 401);
        assert_eq!(call(&app, "PUT", "/me/marks/43/3", None, NULL).await.0, 401);
        assert_eq!(marks(&app, &anna).await, []);
        let (st, v) = call(&app, "PUT", "/me/marks/43/3", Some(&anna), NULL).await;
        assert_eq!((st, v["ok"].as_bool()), (200, Some(true)), "{v}");
        let first = v["marked_at"].as_str().unwrap().to_string();
        assert_eq!(first.len(), 24, "{first}");
        call(&app, "PUT", "/me/marks/40/1", Some(&anna), NULL).await;
        // again: still one mark, its time not earlier
        let (_, v) = call(&app, "PUT", "/me/marks/43/3", Some(&anna), NULL).await;
        assert!(v["marked_at"].as_str().unwrap() >= first.as_str());
        assert_eq!(marks(&app, &anna).await, [(40, 1), (43, 3)]);
        assert_eq!(marks(&app, &ben).await, [], "a mark is its reader's alone");
        // ben's undo of the same chapter touches nothing of anna's
        assert_eq!(call(&app, "DELETE", "/me/marks/43/3", Some(&ben), NULL).await.0, 200);
        assert_eq!(marks(&app, &anna).await, [(40, 1), (43, 3)]);
        assert_eq!(call(&app, "DELETE", "/me/marks/43/3", Some(&anna), NULL).await.0, 200);
        assert_eq!(call(&app, "DELETE", "/me/marks/43/3", Some(&anna), NULL).await.0, 200, "an undo twice is no error");
        assert_eq!(marks(&app, &anna).await, [(40, 1)]);
    }

    #[tokio::test]
    async fn only_a_chapter_the_bible_has_can_be_marked() {
        let (app, pool) = app();
        let (_, anna) = user(&pool, "anna");
        // John has 21 chapters, Psalms 150, Obadiah 1; there is no book 0 or 67
        for path in ["/me/marks/43/22", "/me/marks/43/0", "/me/marks/43/-1", "/me/marks/0/1", "/me/marks/67/1", "/me/marks/19/151", "/me/marks/31/2"] {
            assert_eq!(call(&app, "PUT", path, Some(&anna), NULL).await.0, 400, "PUT {path}");
            assert_eq!(call(&app, "DELETE", path, Some(&anna), NULL).await.0, 400, "DELETE {path}");
        }
        assert_eq!(call(&app, "PUT", "/me/marks/john/3", Some(&anna), NULL).await.0, 400);
        for path in ["/me/marks/43/21", "/me/marks/19/150", "/me/marks/31/1", "/me/marks/1/1", "/me/marks/66/22"] { assert_eq!(call(&app, "PUT", path, Some(&anna), NULL).await.0, 200, "{path}"); }
        // one bad chapter refuses the whole list
        let (st, v) = call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": [[40, 1], [40, 29]] })).await;
        assert_eq!(st, 400, "{v}");
        assert_eq!(marks(&app, &anna).await.len(), 5);
    }

    #[tokio::test]
    async fn a_bulk_set_only_adds_keeps_the_later_time_and_holds_no_more_than_the_bible() {
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        call(&app, "PUT", "/me/marks/40/2", Some(&anna), NULL).await;
        let (st, v) = call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": [[40, 1, "2026-01-05T09:00:00.000Z"], [40, 2, "2026-01-05T09:00:00.000Z"], [40, 3], [40, 1]] })).await;
        assert_eq!((st, v["added"].as_i64()), (200, Some(2)), "{v}");
        let at = |c: i64| pool.get().unwrap().query_row("SELECT marked_at FROM chapter_marks WHERE user_id=?1 AND book=40 AND chapter=?2", params![id, c], |r| r.get::<_, String>(0)).unwrap();
        // Matthew 1 came with a time and then without: the later (now) is kept; Matthew 2 keeps its own later time
        assert!(at(1).as_str() > "2026-01-05T09:00:00.000Z" && at(2).as_str() > "2026-01-05T09:00:00.000Z" && at(3).as_str() > "2026-10");
        // the same list again adds nothing
        let (_, v) = call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": [[40, 1], [40, 2], [40, 3]] })).await;
        assert_eq!(v["added"], 0);
        assert_eq!(marks(&app, &anna).await, [(40, 1), (40, 2), (40, 3)]);
        // every chapter of the Bible is the most a list holds
        let all: Vec<Value> = crate::paths::chapters_of("bible").unwrap().iter().map(|(b, c)| json!([b, c])).collect();
        assert_eq!(all.len(), MAX_BULK);
        let mut over = all.clone();
        over.push(json!([1, 1]));
        assert_eq!(call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": over })).await.0, 400);
        let (st, v) = call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": all })).await;
        assert_eq!((st, v["added"].as_i64()), (200, Some(1186)), "{v}");
        assert_eq!(marks(&app, &anna).await.len(), 1189);
        assert_eq!(call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": "all" })).await.0, 422);
    }

    #[tokio::test]
    async fn marking_is_held_to_a_modest_rate() {
        let (app, pool) = app();
        let (_, anna) = user(&pool, "anna");
        let (_, ben) = user(&pool, "ben");
        for i in 0..60 { assert_eq!(call(&app, if i % 2 == 0 { "PUT" } else { "DELETE" }, "/me/marks/19/1", Some(&anna), NULL).await.0, 200, "{i}"); }
        assert_eq!(call(&app, "PUT", "/me/marks/19/2", Some(&anna), NULL).await.0, 429);
        assert_eq!(call(&app, "DELETE", "/me/marks/19/1", Some(&anna), NULL).await.0, 429);
        assert_eq!(call(&app, "PUT", "/me/marks/19/2", Some(&ben), NULL).await.0, 200, "the tally is each reader's own");
        // a bulk has its own, smaller tally
        for i in 0..6 { assert_eq!(call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": [[19, 3]] })).await.0, 200, "{i}"); }
        assert_eq!(call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": [[19, 4]] })).await.0, 429);
        assert_eq!(marks(&app, &anna).await, [(19, 3)]);
    }

    // ---------------- a tick counts as a chapter read, and costs no time ----------------

    /// Everything that is earned or that another reader sees of `anna`, as the API and the tables give it: her stats,
    /// streak, calendar, progress and badges, her public profile, what her friend ben sees, the group's path places and
    /// event board, the signed reading history of her export, and the rows themselves.
    async fn earned(app: &Router, pool: &crate::db::DbPool, anna: (i64, &str), ben: &str, slug: &str) -> Value {
        let get = |uri: String, token: Option<String>| async move { let (st, v) = call(app, "GET", &uri, token.as_deref(), NULL).await; assert_eq!(st, 200, "{uri}: {v}"); v };
        let (id, token) = anna;
        let export = get("/me/export".into(), Some(token.into())).await;
        let group = get(format!("/groups/{slug}"), Some(ben.into())).await;
        let mut boards = Vec::new();
        for ev in group["events"].as_array().unwrap() { boards.push(get(format!("/groups/{slug}/events/{}/leaderboard", ev["id"]), Some(ben.into())).await["rows"].clone()); }
        assert_eq!(boards.len(), crate::groups::METRICS.len());
        let table = |sql: &str| -> Vec<String> {
            let c = pool.get().unwrap();
            let mut st = c.prepare(sql).unwrap();
            let n = st.column_count();
            let cell = |v: rusqlite::types::ValueRef| match v { rusqlite::types::ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned(), rusqlite::types::ValueRef::Integer(n) => n.to_string(), v => format!("{v:?}") };
            let v = st.query_map(params![id], |r| Ok((0..n).map(|i| cell(r.get_ref(i).unwrap())).collect::<Vec<_>>().join("|"))).unwrap().collect::<Result<_, _>>().unwrap(); v
        };
        json!({
            "stats": get("/stats".into(), Some(token.into())).await,
            "streak": get("/stats/streak".into(), Some(token.into())).await,
            "calendar": get("/stats/calendar?from=2000-01-01&to=2100-01-01".into(), Some(token.into())).await,
            "progress": get("/stats/progress".into(), Some(token.into())).await,
            "reads": get("/stats/reads".into(), Some(token.into())).await,
            "profile as a stranger sees it": get("/users/anna".into(), None).await,
            "profile as ben sees it": get("/users/anna".into(), Some(ben.into())).await,
            "friends as ben sees them": get("/friends".into(), Some(ben.into())).await,
            "group as ben sees it": [&group["path"], &group["events"], &group["members"], &group["streak"]],
            "event boards as ben sees them": boards,
            "groups list as ben sees it": get("/groups".into(), Some(ben.into())).await,
            "signed history": [&export["activity_days"], &export["page_credits"], &export["chapters_read"], &export["badges"]],
            "rows": {
                "page_credits": table("SELECT book, chapter, date, dwell_seconds, credited_at, ticked FROM page_credits WHERE user_id=?1 ORDER BY id"),
                "activity_days": table("SELECT date, active_seconds, pages, chapters FROM activity_days WHERE user_id=?1 ORDER BY date"),
                "chapters_read": table("SELECT book, chapter, first_read_at, last_read_at, times FROM chapters_read WHERE user_id=?1 ORDER BY book, chapter"),
                "badges": table("SELECT code, earned_at FROM badges WHERE user_id=?1 ORDER BY code"),
                "activity_sessions": table("SELECT id, active_seconds FROM activity_sessions WHERE user_id=?1 ORDER BY id"),
            },
        })
    }

    /// anna and ben: friends who share everything, in one group that walks the Gospels and runs an event; anna has read
    /// Matthew 1 for real (a credit, time on a day, the badges that gives) and her profile is public.
    async fn world(app: &Router, pool: &crate::db::DbPool) -> ((i64, String), (i64, String), String) {
        {
            // every chapter is in the texts table (100 words: the 45 s floor), so no badge for a whole book, a testament
            // or the Bible is given for nothing, as the empty table of a test database gives them
            let c = pool.get().unwrap();
            for (b, ch) in crate::paths::chapters_of("bible").unwrap() { c.execute("INSERT INTO chapters (book, chapter, words, verse_count) VALUES (?1, ?2, 100, 10)", params![b, ch]).unwrap(); }
        }
        let (anna_id, anna) = user(pool, "anna");
        let (ben_id, ben) = user(pool, "ben");
        let (_, g) = call(app, "POST", "/groups", Some(&anna), json!({ "name": "Gospels together" })).await;
        let slug = g["slug"].as_str().unwrap().to_string();
        call(app, "POST", "/groups/join", Some(&ben), json!({ "invite_code": g["invite_code"] })).await;
        let (st, v) = call(app, "PUT", &format!("/groups/{slug}/path"), Some(&anna), json!({ "path_id": "gospels" })).await;
        assert_eq!(st, 200, "{v}");
        // one event per way of scoring, over a span that holds the reading below whichever side of midnight it falls
        let day = |d: i64| crate::activity::day_key((time::OffsetDateTime::now_utc() + time::Duration::days(d)).date());
        for metric in crate::groups::METRICS {
            let (st, v) = call(app, "POST", &format!("/groups/{slug}/events"), Some(&anna), json!({ "name": metric, "metric": metric, "starts_at": day(-2), "ends_at": day(2) })).await;
            assert_eq!(st, 200, "{v}");
        }
        {
            let c = pool.get().unwrap();
            // the group set out before the reading below, so that reading is on its path
            c.execute("UPDATE groups SET path_started_at='2026-01-01T00:00:00.000Z'", []).unwrap();
            let (a, b) = if anna_id < ben_id { (anna_id, ben_id) } else { (ben_id, anna_id) };
            c.execute("INSERT INTO friendships (a, b) VALUES (?1, ?2)", params![a, b]).unwrap();
        }
        for (t, s) in [(&anna, json!({ "public_profile": true, "friends": { "share_streak": true, "share_reading": true, "share_badges": true } })), (&ben, json!({ "friends": { "share_streak": true, "share_reading": true, "share_badges": true } }))] {
            assert_eq!(call(app, "PATCH", "/me", Some(t), json!({ "settings": s })).await.0, 200);
        }
        // Matthew 1 read to its end: 100 words is the 45 s floor
        {
            let mut c = pool.get().unwrap();
            let mut t = time::OffsetDateTime::now_utc() - time::Duration::seconds(80);
            let mut credited = false;
            for _ in 0..5 {
                let b = crate::activity::Beat { session_id: "s-anna-matthew".into(), book: Some(40), chapter: Some(1), progress: Some(1.0), signals: Some(1), active: true, visible: true, device: None, local_date: None, tz_offset_min: None, reached_end: Some(true), seen: None, heard: None, listening: None, with_group: None };
                credited |= crate::activity::beat_at(&mut c, anna_id, &b, t).unwrap().credited.is_some();
                t += time::Duration::seconds(20);
            }
            assert!(credited, "the reading that the marks are compared with");
        }
        ((anna_id, anna), (ben_id, ben), slug)
    }

    /// The parts of `earned` that are measured in time, which no tick may move: the minutes, the streak and the goal,
    /// each day's seconds, the sessions, the minute and streak boards, the group's streak, what a friend and a
    /// stranger see of the streak.
    fn in_time(v: &Value) -> Value {
        let secs: Vec<Value> = v["calendar"].as_array().unwrap().iter().map(|d| json!([d["date"], d["active_seconds"]])).collect();
        let friend = v["friends as ben sees them"]["friends"].as_array().unwrap().iter().find(|f| f["handle"] == "anna").cloned().unwrap();
        let s = &v["stats"];
        // a board's rows carry every figure; what the minute and streak boards rank by is `value`
        let board = |i: usize| v["event boards as ben sees them"][i].as_array().unwrap().iter().map(|r| json!([r["user_id"], r["value"], r["active_seconds"], r["rank"]])).collect::<Vec<_>>();
        json!([s["total_active_seconds"], s["streak"]["current"], s["streak"]["longest"], s["streak"]["today_active_seconds"], s["streak"]["today_goal_seconds"],
            v["streak"]["current"], v["streak"]["longest"], secs, v["rows"]["activity_sessions"],
            board(0), board(4), v["group as ben sees it"][3],
            friend["streak"], friend["friend_streak"], v["profile as a stranger sees it"]["stats"]["total_active_seconds"], v["profile as a stranger sees it"]["stats"]["streak"]["current"]])
    }
    fn codes(v: &Value) -> Vec<String> { v["rows"]["badges"].as_array().unwrap().iter().map(|b| b.as_str().unwrap().split('|').next().unwrap().to_string()).collect() }
    /// `(pages, chapters, seconds)` summed over the reader's days.
    fn days(v: &Value) -> (i64, i64, i64) {
        v["rows"]["activity_days"].as_array().unwrap().iter().fold((0, 0, 0), |acc, d| { let f: Vec<i64> = d.as_str().unwrap().split('|').skip(1).map(|n| n.parse().unwrap()).collect(); (acc.0 + f[1], acc.1 + f[2], acc.2 + f[0]) })
    }
    /// The chapters whose reading a tick gives, as the group's chapter boards score them (pages, chapters, score).
    fn boards(v: &Value, anna_id: i64) -> Vec<f64> {
        [1, 2, 3].iter().map(|i| v["event boards as ben sees them"][*i].as_array().unwrap().iter().find(|r| r["user_id"] == anna_id).unwrap()["value"].as_f64().unwrap()).collect()
    }

    #[tokio::test]
    async fn a_tick_counts_as_a_chapter_read_everywhere_costs_no_time_and_an_undo_takes_it_back() {
        let (app, pool) = app();
        let ((anna_id, anna), (_, ben), slug) = world(&app, &pool).await;
        call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "gospels", "started_at": "2026-01-01T00:00:00.000Z" })).await;
        let before = earned(&app, &pool, (anna_id, &anna), &ben, &slug).await;
        // the figures are real ones, so "unchanged" below is not "empty before and after"
        assert_eq!((before["stats"]["chapters_read"].as_i64(), before["stats"]["total_pages"].as_i64(), before["progress"]["40"].clone()), (Some(1), Some(1), json!([1])));
        assert_eq!((before["reads"]["40"][0].as_i64(), before["reads"]["40"].as_array().map(Vec::len), before["reads"].as_object().map(|o| o.len())), (Some(1), Some(28), Some(1)));
        assert!(before["stats"]["total_active_seconds"].as_i64().unwrap() >= 45);
        assert!(codes(&before).contains(&"first_page".to_string()), "{:?}", codes(&before));
        for whole in ["bible", "nt", "ot", "gospels", "book_1", "pages_50"] { assert!(!codes(&before).contains(&whole.to_string()), "{whole} before any tick: {:?}", codes(&before)); }
        let place = |v: &Value| v["group as ben sees it"][0]["members"].as_array().unwrap().iter().find(|m| m["user_id"] == anna_id).cloned().unwrap();
        assert_eq!(place(&before), json!({ "user_id": anna_id, "done": 1, "position": 2 }));
        let friend = |v: &Value| v["friends as ben sees them"]["friends"].as_array().unwrap().iter().find(|f| f["handle"] == "anna").cloned().unwrap();
        assert_eq!((friend(&before)["chapters_week"].as_i64(), days(&before), boards(&before, anna_id)[..2].to_vec()), (Some(1), (1, 1, before["stats"]["total_active_seconds"].as_i64().unwrap()), vec![1.0, 1.0]));

        // Matthew 2 ticked: one chapter more wherever a chapter read counts, and nothing where a minute is counted
        let (st, v) = call(&app, "PUT", "/me/marks/40/2", Some(&anna), NULL).await;
        assert_eq!((st, v["ok"].as_bool(), v["new_badges"].as_array().map(Vec::len)), (200, Some(true), Some(0)), "{v}");
        let ticked = earned(&app, &pool, (anna_id, &anna), &ben, &slug).await;
        assert_eq!(in_time(&ticked), in_time(&before), "a tick costs no time");
        assert_eq!((ticked["stats"]["chapters_read"].as_i64(), ticked["stats"]["total_pages"].as_i64(), ticked["stats"]["verses_read"].as_i64()), (Some(2), Some(2), Some(before["stats"]["verses_read"].as_i64().unwrap() + 10)));
        assert_eq!((ticked["progress"]["40"].clone(), ticked["reads"]["40"][1].as_i64(), ticked["profile as a stranger sees it"]["stats"]["total_pages"].as_i64(), ticked["profile as ben sees it"]["stats"]["chapters_read"].as_i64()), (json!([1, 2]), Some(1), Some(2), Some(2)));
        assert_eq!((friend(&ticked)["chapters_week"].as_i64(), place(&ticked), days(&ticked).0, days(&ticked).1), (Some(2), json!({ "user_id": anna_id, "done": 2, "position": 3 }), 2, 2));
        let (b0, b1) = (boards(&before, anna_id), boards(&ticked, anna_id));
        assert_eq!((b1[0], b1[1], ((b1[2] - b0[2]) * 10.0).round() / 10.0), (2.0, 2.0, 4.0), "pages, chapters and the page part of score: {b0:?} -> {b1:?}");
        assert_eq!(ticked["rows"]["page_credits"].as_array().unwrap().len(), 2);
        assert!(ticked["rows"]["page_credits"][1].as_str().unwrap().starts_with("40|2|") && ticked["rows"]["page_credits"][1].as_str().unwrap().ends_with("|1"), "a tick credit, flagged: {}", ticked["rows"]["page_credits"][1]);
        assert_eq!(ticked["signed history"][1][1]["ticked"], json!(true), "{}", ticked["signed history"][1]);
        assert_eq!(codes(&ticked), codes(&before));

        // Matthew 1 ticked, which the app credited today: the mark owns nothing, and its undo leaves the reading
        assert_eq!(call(&app, "PUT", "/me/marks/40/1", Some(&anna), NULL).await.0, 200);
        assert_eq!(earned(&app, &pool, (anna_id, &anna), &ben, &slug).await, ticked, "a tick on a chapter read today");
        assert_eq!(call(&app, "DELETE", "/me/marks/40/1", Some(&anna), NULL).await.0, 200);
        assert_eq!(earned(&app, &pool, (anna_id, &anna), &ben, &slug).await, ticked, "its undo");
        // the undo of Matthew 2 puts every count back
        assert_eq!(call(&app, "DELETE", "/me/marks/40/2", Some(&anna), NULL).await.0, 200);
        assert_eq!(earned(&app, &pool, (anna_id, &anna), &ben, &slug).await, before, "after a tick and its undo");

        // every chapter of the Bible at once: a Bible read, by her word, and the badges for it; the hour badges are not
        // among them (a tick's time is the tap), and nothing in time moves
        let all: Vec<Value> = crate::paths::chapters_of("bible").unwrap().iter().map(|(b, c)| json!([b, c])).collect();
        let (st, v) = call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": all })).await;
        assert_eq!((st, v["added"].as_i64()), (200, Some(1189)), "{v}");
        let mut given: Vec<&str> = v["new_badges"].as_array().unwrap().iter().map(|b| b["code"].as_str().unwrap()).collect();
        given.sort();
        assert_eq!(given, ["bible", "book_1", "gospels", "nt", "ot", "pages_100", "pages_50", "pages_500", "pentateuch", "psalms"], "{v}");
        assert_eq!(call(&app, "POST", "/stats/recheck", Some(&anna), NULL).await.1, json!([]), "nothing left to give");
        let whole = earned(&app, &pool, (anna_id, &anna), &ben, &slug).await;
        assert_eq!(in_time(&whole), in_time(&before), "a Bible ticked costs no time");
        assert_eq!((whole["stats"]["chapters_read"].as_i64(), whole["stats"]["total_pages"].as_i64(), whole["stats"]["books_completed"].as_i64(), whole["progress"].as_object().map(|o| o.len())), (Some(1189), Some(1189), Some(66), Some(66)));
        assert_eq!((boards(&whole, anna_id)[0], boards(&whole, anna_id)[1], place(&whole)["done"].as_i64(), friend(&whole)["chapters_week"].as_i64()), (1189.0, 1189.0, Some(89), Some(1189)));
        let mut rest = codes(&whole); rest.retain(|c| !given.contains(&c.as_str()));
        assert_eq!(rest, codes(&before), "the hour and streak badges are as they were");

        // a reading in the app of a chapter ticked today takes the tick's credit as its own: no second page, and the
        // mark's undo then leaves the reading
        {
            let mut c = pool.get().unwrap();
            let t = time::OffsetDateTime::now_utc();
            let beat = || crate::activity::Beat { session_id: "s-anna-mark".into(), book: Some(40), chapter: Some(2), progress: Some(1.0), signals: Some(1), active: true, visible: true, device: None, local_date: None, tz_offset_min: None, reached_end: Some(true), seen: None, heard: None, listening: None, with_group: None };
            let mut credited = false;
            for i in 0..4 { credited |= crate::activity::beat_at(&mut c, anna_id, &beat(), t + time::Duration::seconds(20 * i)).unwrap().credited.is_some(); }
            assert!(credited, "the reading is credited, the tick's row made its own");
        }
        let read = earned(&app, &pool, (anna_id, &anna), &ben, &slug).await;
        assert_eq!((read["stats"]["total_pages"].as_i64(), read["stats"]["chapters_read"].as_i64(), read["reads"]["40"][1].as_i64()), (Some(1189), Some(1189), Some(1)), "no second page");
        let row = read["rows"]["page_credits"].as_array().unwrap().iter().find(|r| r.as_str().unwrap().starts_with("40|2|")).unwrap().as_str().unwrap().to_string();
        assert!(row.ends_with("|0") && row.split('|').nth(3).unwrap().parse::<i64>().unwrap() >= 45, "the reading's dwell and flag: {row}");
        assert_eq!(call(&app, "DELETE", "/me/marks/40/2", Some(&anna), NULL).await.0, 200);
        assert_eq!(earned(&app, &pool, (anna_id, &anna), &ben, &slug).await, read, "the undo of a mark the app has read leaves the reading");
        let (_, mine) = call(&app, "GET", "/me/path", Some(&anna), NULL).await;
        assert_eq!((mine["read"].as_array().map(Vec::len), mine["marked"].as_array().map(Vec::len)), (Some(1189), Some(1188)));
    }

    /// The ledger as a tick moves it: `(book, chapter, date, ticked)` of every credit, `(date, seconds, pages,
    /// chapters)` of every day, `(book, chapter, times)` of every chapter read.
    #[allow(clippy::type_complexity)]
    fn ledger(pool: &crate::db::DbPool, uid: i64) -> (Vec<(i64, i64, String, i64)>, Vec<(String, i64, i64, i64)>, Vec<(i64, i64, i64)>) {
        let c = pool.get().unwrap();
        let credits = c.prepare("SELECT book, chapter, date, ticked FROM page_credits WHERE user_id=?1 ORDER BY book, chapter, date").unwrap().query_map([uid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().collect::<Result<_, _>>().unwrap();
        let days = c.prepare("SELECT date, active_seconds, pages, chapters FROM activity_days WHERE user_id=?1 ORDER BY date").unwrap().query_map([uid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().collect::<Result<_, _>>().unwrap();
        let read = c.prepare("SELECT book, chapter, times FROM chapters_read WHERE user_id=?1 ORDER BY book, chapter").unwrap().query_map([uid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().collect::<Result<_, _>>().unwrap();
        (credits, days, read)
    }

    #[tokio::test]
    async fn a_bulk_credits_each_mark_it_adds_on_its_own_day_by_the_readers_clock_and_nothing_twice() {
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        pool.get().unwrap().execute("UPDATE users SET tz_offset_min=-300 WHERE id=?1", [id]).unwrap();
        let today = crate::activity::user_today(&pool.get().unwrap(), id);
        // 03:30 UTC on the 2nd is the evening of the 1st five hours west; a mark without a time is made now
        let (st, v) = call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": [[40, 1, "2026-03-02T03:30:00.000Z"], [19, 23, "2026-03-02T03:30:00.000Z"], [40, 2]] })).await;
        assert_eq!((st, v["added"].as_i64(), v["new_badges"][0]["code"].as_str()), (200, Some(3), Some("first_page")), "{v}");
        let (credits, days, read) = ledger(&pool, id);
        assert_eq!(credits, [(19, 23, "2026-03-01".into(), 1), (40, 1, "2026-03-01".into(), 1), (40, 2, today.clone(), 1)]);
        assert_eq!(days, [("2026-03-01".into(), 0, 2, 2), (today.clone(), 0, 1, 1)]);
        assert_eq!(read, [(19, 23, 1), (40, 1, 1), (40, 2, 1)]);
        let at: String = pool.get().unwrap().query_row("SELECT credited_at || ' ' || tz_offset_min || ' ' || dwell_seconds FROM page_credits WHERE user_id=?1 AND book=40 AND chapter=1", [id], |r| r.get(0)).unwrap();
        assert_eq!(at, "2026-03-02T03:30:00.000Z -300 0");
        // the same list again, and a later time for a chapter marked already: nothing added, nothing credited
        let (_, v) = call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": [[40, 1], [19, 23, "2026-03-09T03:30:00.000Z"], [40, 2]] })).await;
        assert_eq!((v["added"].as_i64(), v["new_badges"].as_array().map(Vec::len)), (Some(0), Some(0)), "{v}");
        assert_eq!(ledger(&pool, id), (credits, days, read));
        // an undo takes the back-dated day's credit from it, and the day itself once nothing is left
        call(&app, "DELETE", "/me/marks/40/1", Some(&anna), NULL).await;
        assert_eq!(ledger(&pool, id).1, [("2026-03-01".into(), 0, 1, 1), (today.clone(), 0, 1, 1)]);
        call(&app, "DELETE", "/me/marks/19/23", Some(&anna), NULL).await;
        assert_eq!(ledger(&pool, id), (vec![(40, 2, today.clone(), 1)], vec![(today, 0, 1, 1)], vec![(40, 2, 1)]));
    }

    #[tokio::test]
    async fn an_export_with_tick_credits_restored_beside_its_marks_does_not_double() {
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        call(&app, "PUT", "/me/marks/40/1", Some(&anna), NULL).await;
        call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": [[40, 2, "2026-03-02T10:00:00.000Z"], [43, 3, "2026-03-05T10:00:00.000Z"]] })).await;
        let (_, doc) = call(&app, "GET", "/me/export", Some(&anna), NULL).await;
        assert!(doc["page_credits"].as_array().unwrap().iter().all(|p| p["ticked"] == json!(true)), "{}", doc["page_credits"]);
        let before = ledger(&pool, id);
        assert_eq!((before.0.len(), before.1.len(), before.2.len()), (3, 3, 3));
        let marks: Vec<Value> = doc["chapter_marks"].as_array().unwrap().iter().map(|m| json!([m["book"], m["chapter"], m["marked_at"]])).collect();
        let wipe = || async { assert_eq!(call(&app, "DELETE", "/me/data", Some(&anna), json!({ "categories": ["activity"] })).await.0, 200); assert_eq!(ledger(&pool, id), (vec![], vec![], vec![])); };
        // the signed history first (its tick credits come back as they were), then the marks: each finds its credit there
        wipe().await;
        let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&anna), doc.clone()).await;
        assert_eq!((st, v["restored"]["credits"].as_i64()), (200, Some(3)), "{v}");
        assert_eq!(ledger(&pool, id), before);
        let (st, v) = call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": marks })).await;
        assert_eq!((st, v["added"].as_i64()), (200, Some(3)), "{v}");
        assert_eq!(ledger(&pool, id), before, "a mark whose chapter has its tick credit adds none");
        let (_, v) = call(&app, "POST", "/me/restore-activity", Some(&anna), doc.clone()).await;
        assert_eq!((v["restored"]["credits"].as_i64(), ledger(&pool, id)), (Some(0), before.clone()), "the file again");
        // the other way round, the marks before the history: the index refuses a second tick of a chapter
        wipe().await;
        let (_, v) = call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": marks })).await;
        assert_eq!((v["added"].as_i64(), ledger(&pool, id)), (Some(3), before.clone()));
        let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&anna), doc).await;
        assert_eq!((st, v["restored"]["credits"].as_i64(), ledger(&pool, id)), (200, Some(0), before), "{v}");
        // and a restored tick is still the mark's to undo
        call(&app, "DELETE", "/me/marks/43/3", Some(&anna), NULL).await;
        assert_eq!(ledger(&pool, id).0.len(), 2);
    }

    #[tokio::test]
    async fn marks_from_before_ticks_counted_are_credited_once_on_the_first_start() {
        let (app, pool) = app();
        let (anna_id, anna) = user(&pool, "anna");
        let (ben_id, _) = user(&pool, "ben");
        {
            let c = pool.get().unwrap();
            c.execute("UPDATE users SET tz_offset_min=-300 WHERE id=?1", [anna_id]).unwrap();
            for (uid, b, ch, at) in [(anna_id, 40, 1, "2026-03-02T03:30:00.000Z"), (anna_id, 40, 2, "2026-03-05T12:00:00.000Z"), (ben_id, 1, 1, "2026-02-01T00:00:00.000Z"), (ben_id, 1, 2, "not a time")] {
                c.execute("INSERT INTO chapter_marks (user_id, book, chapter, marked_at) VALUES (?1,?2,?3,?4)", params![uid, b, ch, at]).unwrap();
            }
            // anna read Matthew 2 in the app on the day she marked it: that day keeps its reading
            c.execute("INSERT INTO page_credits (user_id, book, chapter, date, dwell_seconds, credited_at) VALUES (?1, 40, 2, '2026-03-05', 200, '2026-03-05T20:00:00.000Z')", [anna_id]).unwrap();
            c.execute("INSERT INTO chapters_read (user_id, book, chapter, first_read_at, last_read_at) VALUES (?1, 40, 2, '2026-03-05T20:00:00.000Z', '2026-03-05T20:00:00.000Z')", [anna_id]).unwrap();
            c.execute("INSERT INTO activity_days (user_id, date, active_seconds, pages, chapters) VALUES (?1, '2026-03-05', 200, 1, 1)", [anna_id]).unwrap();
        }
        fn fill(pool: &crate::db::DbPool) -> usize { let mut c = pool.get().unwrap(); backfill(&mut c).unwrap() }
        assert_eq!(fill(&pool), 2);
        assert_eq!(ledger(&pool, anna_id), (vec![(40, 1, "2026-03-01".into(), 1), (40, 2, "2026-03-05".into(), 0)], vec![("2026-03-01".into(), 0, 1, 1), ("2026-03-05".into(), 200, 1, 1)], vec![(40, 1, 1), (40, 2, 1)]));
        assert_eq!(ledger(&pool, ben_id), (vec![(1, 1, "2026-02-01".into(), 1)], vec![("2026-02-01".into(), 0, 1, 1)], vec![(1, 1, 1)]));
        let badge = |uid: i64| pool.get().unwrap().query_row("SELECT count(*) FROM badges WHERE user_id=?1 AND code='first_page'", [uid], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!((badge(anna_id), badge(ben_id)), (1, 1));
        // once: a later start finds the record and leaves everything; a mark made since was credited by its own tap
        assert_eq!(fill(&pool), 0);
        call(&app, "PUT", "/me/marks/40/3", Some(&anna), NULL).await;
        assert_eq!((fill(&pool), ledger(&pool, anna_id).0.len()), (0, 3));
    }

    #[tokio::test]
    async fn the_readers_own_path_counts_marks_made_since_its_start_beside_the_credits() {
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        // marked before the path began: like a credit before it, it does not count
        pool.get().unwrap().execute("INSERT INTO chapter_marks (user_id, book, chapter, marked_at) VALUES (?1, 40, 1, '2026-01-01T00:00:00.000Z')", [id]).unwrap();
        let (st, v) = call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "gospels", "started_at": "2026-02-01T00:00:00.000Z" })).await;
        assert_eq!((st, v["read"].clone(), v["marked"].clone()), (200, json!([]), json!([])), "{v}");
        // marked again (now, after the start) it counts, and so does one made on a device after the start; each tick
        // is a credit on its own day, so an app from before marks sees them in `read` too
        call(&app, "PUT", "/me/marks/40/1", Some(&anna), NULL).await;
        call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": [[40, 2, "2026-02-03T00:00:00.000Z"], [19, 23, "2026-01-15T00:00:00.000Z"]] })).await;
        let (_, v) = call(&app, "GET", "/me/path", Some(&anna), NULL).await;
        assert_eq!((v["read"].clone(), v["marked"].clone()), (json!([[40, 1], [40, 2]]), json!([[40, 1], [40, 2]])), "{v}");
        let both: Vec<crate::paths::Ch> = v["marked"].as_array().unwrap().iter().map(|c| (c[0].as_i64().unwrap(), c[1].as_i64().unwrap())).collect();
        assert_eq!(crate::paths::place(&crate::paths::chapters_of("gospels").unwrap(), &both), (2, 3));
        // undone: the path goes back
        call(&app, "DELETE", "/me/marks/40/1", Some(&anna), NULL).await;
        let (_, v) = call(&app, "GET", "/me/path", Some(&anna), NULL).await;
        assert_eq!((v["read"].clone(), v["marked"].clone()), (json!([[40, 2]]), json!([[40, 2]])));
        // without a path there is nothing to count
        call(&app, "DELETE", "/me/path", Some(&anna), NULL).await;
        assert_eq!(call(&app, "GET", "/me/path", Some(&anna), NULL).await.1, json!({ "path": null, "history": [], "read": [], "marked": [] }));
    }

    #[tokio::test]
    async fn marks_are_exported_unsigned_and_go_with_the_activity_or_the_account() {
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        let (ben_id, ben) = user(&pool, "ben");
        call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": [[43, 3, "2026-03-01T10:00:00.000Z"], [40, 1, "2026-02-01T10:00:00.000Z"]] })).await;
        call(&app, "PUT", "/me/marks/1/1", Some(&ben), NULL).await;
        let (_, doc) = call(&app, "GET", "/me/export", Some(&anna), NULL).await;
        assert_eq!(doc["chapter_marks"], json!([{ "book": 40, "chapter": 1, "marked_at": "2026-02-01T10:00:00.000Z" }, { "book": 43, "chapter": 3, "marked_at": "2026-03-01T10:00:00.000Z" }]));
        // not part of what is signed: the same file with the marks edited still restores its history, and restoring adds no mark
        let mut edited = doc.clone();
        edited["chapter_marks"] = json!([{ "book": 1, "chapter": 1, "marked_at": "2026-01-01T00:00:00.000Z" }]);
        let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&anna), edited).await;
        assert_eq!(st, 200, "{v}");
        assert_eq!(marks(&app, &anna).await, [(40, 1), (43, 3)]);
        // another category leaves them; the activity category takes them, and only hers
        call(&app, "DELETE", "/me/data", Some(&anna), json!({ "categories": ["path", "bookmarks"] })).await;
        assert_eq!(marks(&app, &anna).await.len(), 2);
        let (st, v) = call(&app, "DELETE", "/me/data", Some(&anna), json!({ "categories": ["activity"] })).await;
        // the two marks among whatever else the category held (the test database gives badges for its empty books)
        assert!(st == 200 && v["deleted"]["activity"].as_i64().unwrap() >= 2, "{v}");
        assert_eq!(marks(&app, &anna).await, []);
        assert_eq!(call(&app, "GET", "/me/export", Some(&anna), NULL).await.1["chapter_marks"], json!([]));
        assert_eq!(marks(&app, &ben).await, [(1, 1)]);
        // and they go with the account
        assert_eq!(call(&app, "DELETE", "/me", Some(&ben), json!({ "confirm": "delete" })).await.0, 200);
        assert_eq!(pool.get().unwrap().query_row("SELECT count(*) FROM chapter_marks WHERE user_id IN (?1, ?2)", params![id, ben_id], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }
}
