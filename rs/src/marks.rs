//! A reader's own "read" marks (docs/PATHS.md rule 1): a chapter ticked by hand. A mark is not a credit and earns
//! nothing: it feeds the reader's own view (the read tick, their own path's place) and nothing that is earned or that
//! another reader sees. `chapter_marks` is read here, by the reader's own `GET /me/path` and by their export; the
//! streak, reading time, `page_credits`, `chapters_read`, badges, group events and paths and friends' views never
//! look at it (the tests below hold every one of them still while chapters are marked).
use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::{extract::{Path, State}, Json};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};

/// A bulk set holds at most every chapter of the Bible.
pub const MAX_BULK: usize = 1189;
/// A reader ticking through a book and undoing; a restore or a sign-in is one bulk.
const MARK_LIMITS: &[(i64, i64)] = &[(60, 600), (600, 86_400)];
const BULK_LIMITS: &[(i64, i64)] = &[(6, 600), (30, 86_400)];

/// A chapter the Bible has, by the book table (the same in both editions; the texts database is not asked).
fn is_chapter(book: i64, chapter: i64) -> bool { crate::books::book(book).is_some_and(|b| (1..=i64::from(b.chapters)).contains(&chapter)) }

/// The time of a mark in the shape a device writes (`toISOString`), so marks from both compare as text. A time a
/// device gives is kept when it can be read and is not ahead of the clock; otherwise the mark is made now.
fn mark_time(at: Option<&str>, now: time::OffsetDateTime) -> String {
    let t = at.and_then(|s| time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()).filter(|t| *t <= now).unwrap_or(now);
    t.to_offset(time::UtcOffset::UTC).format(time::macros::format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z")).unwrap_or_default()
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
/// Marks the chapter now. A chapter marked already is marked afresh: its time moves, so a path begun since counts it.
pub async fn set(State(s): State<AppState>, AuthUser(u): AuthUser, Path((book, chapter)): Path<(i64, i64)>) -> ApiResult<Json<Value>> {
    if !is_chapter(book, chapter) { return Err(ApiError::bad("no such chapter")); }
    let conn = s.pool.get()?;
    crate::friends::limit(&conn, u.id, "mark", MARK_LIMITS)?;
    let at = mark_time(None, time::OffsetDateTime::now_utc());
    conn.execute("INSERT INTO chapter_marks (user_id, book, chapter, marked_at) VALUES (?1,?2,?3,?4) ON CONFLICT(user_id, book, chapter) DO UPDATE SET marked_at=excluded.marked_at", params![u.id, book, chapter, at])?;
    Ok(Json(json!({ "ok": true, "marked_at": at })))
}
pub async fn clear(State(s): State<AppState>, AuthUser(u): AuthUser, Path((book, chapter)): Path<(i64, i64)>) -> ApiResult<Json<Value>> {
    if !is_chapter(book, chapter) { return Err(ApiError::bad("no such chapter")); }
    let conn = s.pool.get()?;
    crate::friends::limit(&conn, u.id, "mark", MARK_LIMITS)?;
    conn.execute("DELETE FROM chapter_marks WHERE user_id=?1 AND book=?2 AND chapter=?3", params![u.id, book, chapter])?;
    Ok(Json(json!({ "ok": true })))
}

/// `[book, chapter]` or `[book, chapter, marked_at]` (a mark made on a device before it reached the account).
#[derive(Deserialize)] #[serde(untagged)] enum MarkIn { At(i64, i64, String), Plain(i64, i64) }
#[derive(Deserialize)] pub struct BulkIn { marks: Vec<MarkIn> }
/// Many at once: a backup restored, or a device's marks carried into the account at sign-in. Only ever adds: a
/// chapter marked already stays marked and keeps the later of its two times. One chapter the Bible has not refuses
/// the whole list.
pub async fn bulk(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<BulkIn>) -> ApiResult<Json<Value>> {
    if b.marks.len() > MAX_BULK { return Err(ApiError::bad("marks: at most 1,189, the chapters of the Bible")); }
    let now = time::OffsetDateTime::now_utc();
    let rows: Vec<(i64, i64, String)> = b.marks.iter().map(|m| match m { MarkIn::At(b, c, at) => (*b, *c, mark_time(Some(at), now)), MarkIn::Plain(b, c) => (*b, *c, mark_time(None, now)) }).collect();
    if rows.iter().any(|(b, c, _)| !is_chapter(*b, *c)) { return Err(ApiError::bad("marks: no such chapter")); }
    let added = s.db(move |conn| {
        crate::friends::limit(conn, u.id, "mark_bulk", BULK_LIMITS)?;
        let tx = conn.transaction()?;
        let mut added = 0;
        {
            let mut new = tx.prepare_cached("INSERT OR IGNORE INTO chapter_marks (user_id, book, chapter, marked_at) VALUES (?1,?2,?3,?4)")?;
            let mut later = tx.prepare_cached("UPDATE chapter_marks SET marked_at=?4 WHERE user_id=?1 AND book=?2 AND chapter=?3 AND marked_at < ?4")?;
            for (book, chapter, at) in &rows {
                let n = new.execute(params![u.id, book, chapter, at])?;
                if n == 0 { later.execute(params![u.id, book, chapter, at])?; }
                added += n;
            }
        }
        tx.commit()?;
        Ok(added)
    }).await?;
    Ok(Json(json!({ "ok": true, "added": added })))
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

    // ---------------- a mark earns nothing ----------------

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
            "profile as a stranger sees it": get("/users/anna".into(), None).await,
            "profile as ben sees it": get("/users/anna".into(), Some(ben.into())).await,
            "friends as ben sees them": get("/friends".into(), Some(ben.into())).await,
            "group as ben sees it": [&group["path"], &group["events"], &group["members"], &group["streak"]],
            "event boards as ben sees them": boards,
            "groups list as ben sees it": get("/groups".into(), Some(ben.into())).await,
            "signed history": [&export["activity_days"], &export["page_credits"], &export["chapters_read"], &export["badges"]],
            "rows": {
                "page_credits": table("SELECT book, chapter, date, dwell_seconds, credited_at FROM page_credits WHERE user_id=?1 ORDER BY id"),
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
                let b = crate::activity::Beat { session_id: "s-anna-matthew".into(), book: Some(40), chapter: Some(1), progress: Some(1.0), signals: Some(1), active: true, visible: true, device: None, local_date: None, tz_offset_min: None, reached_end: Some(true), seen: None, heard: None, listening: None };
                credited |= crate::activity::beat_at(&mut c, anna_id, &b, t).unwrap().credited.is_some();
                t += time::Duration::seconds(20);
            }
            assert!(credited, "the reading that the marks are compared with");
        }
        ((anna_id, anna), (ben_id, ben), slug)
    }

    #[tokio::test]
    async fn a_mark_earns_nothing_and_shows_nothing_to_anyone_else() {
        let (app, pool) = app();
        let ((anna_id, anna), (_, ben), slug) = world(&app, &pool).await;
        call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "gospels", "started_at": "2026-01-01T00:00:00.000Z" })).await;
        let before = earned(&app, &pool, (anna_id, &anna), &ben, &slug).await;
        // the figures are real ones, so "unchanged" below is not "empty before and after"
        assert_eq!((before["stats"]["chapters_read"].as_i64(), before["stats"]["total_pages"].as_i64(), before["progress"]["40"].clone()), (Some(1), Some(1), json!([1])));
        assert!(before["stats"]["total_active_seconds"].as_i64().unwrap() >= 45);
        let codes = |v: &Value| v["rows"]["badges"].as_array().unwrap().iter().map(|b| b.as_str().unwrap().split('|').next().unwrap().to_string()).collect::<Vec<_>>();
        assert!(codes(&before).contains(&"first_page".to_string()), "{:?}", codes(&before));
        for whole in ["bible", "nt", "ot", "gospels", "book_1"] { assert!(!codes(&before).contains(&whole.to_string()), "{whole} before any mark: {:?}", codes(&before)); }
        let place = |v: &Value| v["group as ben sees it"][0]["members"].as_array().unwrap().iter().find(|m| m["user_id"] == anna_id).cloned().unwrap();
        assert_eq!(place(&before), json!({ "user_id": anna_id, "done": 1, "position": 2 }));

        // one by hand, the one she has credited marked too, an undo, and then every chapter of the Bible at once
        for path in ["/me/marks/40/2", "/me/marks/40/1", "/me/marks/43/3"] { assert_eq!(call(&app, "PUT", path, Some(&anna), NULL).await.0, 200); }
        assert_eq!(call(&app, "DELETE", "/me/marks/43/3", Some(&anna), NULL).await.0, 200);
        assert_eq!(earned(&app, &pool, (anna_id, &anna), &ben, &slug).await, before, "after three marks and an undo");
        let all: Vec<Value> = crate::paths::chapters_of("bible").unwrap().iter().map(|(b, c)| json!([b, c])).collect();
        let (st, v) = call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": all })).await;
        assert_eq!((st, v["added"].as_i64()), (200, Some(1187)), "{v}");
        // no badge is waiting to be given for them either (a whole Bible marked is not a Bible read)
        let (st, v) = call(&app, "POST", "/stats/recheck", Some(&anna), NULL).await;
        assert_eq!(st, 200, "{v}");
        let after = earned(&app, &pool, (anna_id, &anna), &ben, &slug).await;
        for (k, was) in before.as_object().unwrap() { assert_eq!(&after[k], was, "{k} moved when chapters were marked"); }
        assert_eq!(after, before);

        // a beat after the marks earns exactly what it would have: time, and no credit for a chapter only marked
        {
            let mut c = pool.get().unwrap();
            let t = time::OffsetDateTime::now_utc();
            let beat = || crate::activity::Beat { session_id: "s-anna-mark".into(), book: Some(40), chapter: Some(2), progress: Some(1.0), signals: Some(1), active: true, visible: true, device: None, local_date: None, tz_offset_min: None, reached_end: Some(true), seen: None, heard: None, listening: None };
            crate::activity::beat_at(&mut c, anna_id, &beat(), t).unwrap();
            let r = crate::activity::beat_at(&mut c, anna_id, &beat(), t + time::Duration::seconds(15)).unwrap();
            assert!(r.credited.is_none() && r.new_badges.is_empty(), "a marked chapter still needs its time");
            assert_eq!(c.query_row("SELECT count(*) FROM chapters_read WHERE user_id=?1", [anna_id], |r| r.get::<_, i64>(0)).unwrap(), 1);
        }

        // what the marks do move: her own path, and only for her
        let (_, mine) = call(&app, "GET", "/me/path", Some(&anna), NULL).await;
        assert_eq!((mine["read"].clone(), mine["marked"].as_array().map(Vec::len)), (json!([[40, 1]]), Some(1189)));
        let (_, group) = call(&app, "GET", &format!("/groups/{slug}"), Some(&ben), NULL).await;
        assert_eq!(group["path"]["members"].as_array().unwrap().iter().find(|m| m["user_id"] == anna_id).unwrap(), &json!({ "user_id": anna_id, "done": 1, "position": 2 }), "a group places its members by credits alone");
    }

    #[tokio::test]
    async fn the_readers_own_path_counts_marks_made_since_its_start_beside_the_credits() {
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        // marked before the path began: like a credit before it, it does not count
        pool.get().unwrap().execute("INSERT INTO chapter_marks (user_id, book, chapter, marked_at) VALUES (?1, 40, 1, '2026-01-01T00:00:00.000Z')", [id]).unwrap();
        let (st, v) = call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "gospels", "started_at": "2026-02-01T00:00:00.000Z" })).await;
        assert_eq!((st, v["read"].clone(), v["marked"].clone()), (200, json!([]), json!([])), "{v}");
        // marked again (now, after the start) it counts, and so does one made on a device after the start
        call(&app, "PUT", "/me/marks/40/1", Some(&anna), NULL).await;
        call(&app, "POST", "/me/marks", Some(&anna), json!({ "marks": [[40, 2, "2026-02-03T00:00:00.000Z"], [19, 23, "2026-01-15T00:00:00.000Z"]] })).await;
        let (_, v) = call(&app, "GET", "/me/path", Some(&anna), NULL).await;
        assert_eq!((v["read"].clone(), v["marked"].clone()), (json!([]), json!([[40, 1], [40, 2]])), "the credits' list is the credits' alone, for an app from before marks");
        let both: Vec<crate::paths::Ch> = v["marked"].as_array().unwrap().iter().map(|c| (c[0].as_i64().unwrap(), c[1].as_i64().unwrap())).collect();
        assert_eq!(crate::paths::place(&crate::paths::chapters_of("gospels").unwrap(), &both), (2, 3));
        // undone: the path goes back
        call(&app, "DELETE", "/me/marks/40/1", Some(&anna), NULL).await;
        assert_eq!(call(&app, "GET", "/me/path", Some(&anna), NULL).await.1["marked"], json!([[40, 2]]));
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
