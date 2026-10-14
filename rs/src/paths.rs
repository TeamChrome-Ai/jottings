//! Paths (docs/PATHS.md): a reader's reading plan as an order of chapters and a pace, never a calendar. The server keeps
//! the state (`user_paths`) and answers with the chapters credited since the start and, apart, the ones the reader
//! marked by hand since then (marks.rs); the client derives progress with shared/paths.ts. The chapter orders live here as well, for a group's per-member places: the contiguous ones from the
//! book table, the two data-driven ones from shared/pathOrders.json (tools/path_orders.ts writes it; the TypeScript side
//! reads the same file), Coates's from the companion index. Custom paths (whole books, a reader's own order) are the
//! reader's alone; a group walks a built-in path.
use crate::auth::AuthUser;
use crate::db::now_iso;
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::{extract::State, Json};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

pub const BUILT_IN: [&str; 8] = ["gospels", "life-of-christ", "psalms-proverbs", "new-testament", "bible", "in-order", "synopsis", "coates"];
pub const CUSTOM: &str = "custom";
/// The largest pace a reader can set: ten chapters a day.
const MAX_PACE: i64 = 70;

pub type Ch = (i64, i64);
fn book_chapters(books: impl IntoIterator<Item = i64>) -> Vec<Ch> {
    books.into_iter().filter_map(|b| crate::books::book(b)).flat_map(|b| (1..=b.chapters as i64).map(move |c| (b.n as i64, c))).collect()
}
fn orders() -> &'static HashMap<String, Vec<Ch>> {
    static ORDERS: OnceLock<HashMap<String, Vec<Ch>>> = OnceLock::new();
    ORDERS.get_or_init(|| serde_json::from_str::<HashMap<String, Vec<(i64, i64)>>>(include_str!("../../shared/pathOrders.json")).expect("shared/pathOrders.json"))
}
/// A built-in path's chapters in order; None for an id that is not one (a custom path has no server-side order).
pub fn chapters_of(id: &str) -> Option<Vec<Ch>> {
    Some(match id {
        "gospels" => book_chapters(40..=43),
        "psalms-proverbs" => book_chapters([19, 20]),
        "new-testament" => book_chapters(40..=66),
        "bible" | "synopsis" => book_chapters(1..=66),
        "coates" => book_chapters(crate::companion::outlined_books("coates")),
        "life-of-christ" | "in-order" => orders().get(id)?.clone(),
        _ => return None,
    })
}
/// The chapters a reader has credited at or after `since` (ISO instants compare as text), by book and chapter.
pub fn read_since(conn: &Connection, uid: i64, since: &str) -> rusqlite::Result<Vec<Ch>> {
    let mut st = conn.prepare_cached("SELECT book, chapter FROM chapters_read WHERE user_id=?1 AND last_read_at >= ?2 ORDER BY book, chapter")?;
    let v = st.query_map(params![uid, since], |r| Ok((r.get(0)?, r.get(1)?)))?.collect(); v
}
/// Where a reader stands on `chapters`: portions read, and the 1-based place of the first unread one (the length once
/// all are read). shared/paths.ts `progress` says the same.
pub fn place(chapters: &[Ch], read: &[Ch]) -> (i64, i64) {
    let set: HashSet<&Ch> = read.iter().collect();
    let done = chapters.iter().filter(|c| set.contains(c)).count() as i64;
    let position = chapters.iter().position(|c| !set.contains(c)).map(|i| i as i64 + 1).unwrap_or(chapters.len() as i64);
    (done, position)
}

// ---------------- the reader's own path ----------------

struct Row { path_id: String, started_at: String, target: Option<String>, pace: Option<i64>, with_ministry: bool, custom: Option<Value>, history: Vec<Value> }
fn load(conn: &Connection, uid: i64) -> rusqlite::Result<Option<Row>> {
    conn.query_row("SELECT path_id, started_at, target_date, pace_per_week, with_ministry, custom_json, history_json FROM user_paths WHERE user_id=?1", params![uid], |r| {
        let custom: Option<String> = r.get(5)?;
        let history: String = r.get(6)?;
        Ok(Row { path_id: r.get(0)?, started_at: r.get(1)?, target: r.get(2)?, pace: r.get(3)?, with_ministry: r.get::<_, i64>(4)? != 0, custom: custom.and_then(|s| serde_json::from_str(&s).ok()), history: serde_json::from_str::<Vec<Value>>(&history).unwrap_or_default() })
    }).optional()
}
/// The pairing starts on for the two companion paths (shared/paths.ts defaultWithMinistry).
pub fn default_with_ministry(id: &str) -> bool { matches!(id, "synopsis" | "coates") }
/// A calendar day as the client writes it: YYYY-MM-DD.
pub fn is_day(s: &str) -> bool { s.len() == 10 && s.as_bytes()[4] == b'-' && s.as_bytes()[7] == b'-' && s.chars().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()) && crate::activity::parse_day(s).is_some() }
fn answer(conn: &Connection, uid: i64) -> ApiResult<Json<Value>> {
    Ok(Json(match load(conn, uid)? {
        None => json!({ "path": null, "history": [], "read": [], "marked": [] }),
        Some(r) => json!({
            "path": { "id": r.path_id, "started_at": r.started_at, "target_date": r.target, "pace_per_week": r.pace, "with_ministry": r.with_ministry, "custom": r.custom },
            "history": r.history,
            "read": read_since(conn, uid, &r.started_at)?,
            // the reader's own marks since the start (marks.rs), beside the credits and never among them: an app from
            // before marks reads `read` alone, and a group's places (groups.rs) are counted from credits only
            "marked": crate::marks::marked_since(conn, uid, &r.started_at)?,
        }),
    }))
}
pub async fn get_mine(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Value>> { let conn = s.pool.get()?; answer(&conn, u.id) }

/// A custom path as the client sends it: a title and whole books in the chosen order.
#[derive(Deserialize, Clone, PartialEq)] struct Custom { title: String, books: Vec<i64> }
fn some<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> { T::deserialize(d).map(Some) }
#[derive(Deserialize)]
pub struct PutIn {
    /// Start or switch to this path. Absent: only the pace (or the custom books) change.
    id: Option<String>,
    /// null clears the pace; absent leaves it.
    #[serde(default, deserialize_with = "some")] pace_per_week: Option<Option<i64>>,
    /// YYYY-MM-DD, the reader's own day; null clears it; absent leaves it.
    #[serde(default, deserialize_with = "some")] target_date: Option<Option<String>>,
    /// Pair the chapters with the companion's sections (the synopsis / coates paths); absent on a start takes the path's default.
    with_ministry: Option<bool>,
    custom: Option<Custom>,
    /// A start to keep (a path begun signed out and merged on sign-in); ignored unless `id` starts or switches.
    started_at: Option<String>,
}
fn is_iso(s: &str) -> bool { time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).is_ok() }
fn same_custom(a: &Option<Value>, b: &Option<Custom>) -> bool {
    match (a, b) { (Some(a), Some(b)) => a["books"].as_array().map(|v| v.iter().filter_map(Value::as_i64).collect::<Vec<_>>()) == Some(b.books.clone()), (None, None) => true, _ => false }
}

pub async fn put_mine(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<PutIn>) -> ApiResult<Json<Value>> {
    if let Some(Some(p)) = b.pace_per_week { if !(1..=MAX_PACE).contains(&p) { return Err(ApiError::bad(format!("pace_per_week: 1 to {MAX_PACE} chapters a week, or null"))); } }
    if let Some(Some(d)) = &b.target_date { if !is_day(d) { return Err(ApiError::bad("target_date: a day as YYYY-MM-DD, or null")); } }
    if let Some(c) = &b.custom {
        if c.title.chars().count() > 60 { return Err(ApiError::bad("custom.title: up to 60 characters")); }
        if c.books.is_empty() || c.books.len() > 66 || c.books.iter().any(|b| !(1..=66).contains(b)) { return Err(ApiError::bad("custom.books: 1 to 66 books, each 1 to 66")); }
    }
    let ed = s.edition().await;
    if let Some(id) = &b.id {
        if !BUILT_IN.contains(&id.as_str()) && id != CUSTOM { return Err(ApiError::bad("id: not a path")); }
        if id == CUSTOM && b.custom.is_none() { return Err(ApiError::bad("custom: a custom path needs its books")); }
        if let Some(t) = &b.started_at { if !is_iso(t) { return Err(ApiError::bad("started_at: an ISO instant")); } }
    }
    let mut conn = s.pool.get()?;
    let tx = conn.transaction()?;
    let now = now_iso();
    let current = load(&tx, u.id)?;
    let custom_json = |c: &Option<Custom>| c.as_ref().map(|c| json!({ "title": c.title.trim(), "books": c.books }).to_string());
    let switching = b.id.as_ref().is_some_and(|id| current.as_ref().is_none_or(|c| &c.path_id != id || (id == CUSTOM && !same_custom(&c.custom, &b.custom))));
    // a path the edition does not offer (the Coates path in 1890) is not started; a reader already on it keeps it
    if switching && b.id.as_deref().is_some_and(|id| crate::edition::shown_path(ed, id) != id) { return Err(ApiError::bad("id: not a path")); }
    match (&b.id, current) {
        // switching: the path left goes into history with its start; the one taken up resumes from its own start if it is there
        (Some(id), cur) if switching => {
            let mut history = cur.as_ref().map(|c| c.history.clone()).unwrap_or_default();
            if let Some(c) = &cur { history.push(json!({ "id": c.path_id, "started_at": c.started_at, "ended_at": now, "custom": c.custom })); }
            let resumed = history.iter().position(|h| h["id"] == json!(id) && (id != CUSTOM || same_custom(&Some(h["custom"].clone()), &b.custom)));
            let started_at = match (resumed, &b.started_at) { (Some(i), _) => history.remove(i)["started_at"].as_str().unwrap_or(&now).to_string(), (None, Some(t)) => t.clone(), (None, None) => now.clone() };
            // the pace carries over to the next path; a target date is the old path's own
            let pace = b.pace_per_week.unwrap_or_else(|| cur.as_ref().and_then(|c| c.pace));
            let target = b.target_date.clone().flatten();
            let with_ministry = b.with_ministry.unwrap_or_else(|| default_with_ministry(id));
            tx.execute("INSERT INTO user_paths (user_id, path_id, started_at, target_date, pace_per_week, with_ministry, custom_json, history_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
                ON CONFLICT(user_id) DO UPDATE SET path_id=excluded.path_id, started_at=excluded.started_at, target_date=excluded.target_date, pace_per_week=excluded.pace_per_week, with_ministry=excluded.with_ministry, custom_json=excluded.custom_json, history_json=excluded.history_json",
                params![u.id, id, started_at, target, pace, with_ministry as i64, if id == CUSTOM { custom_json(&b.custom) } else { None }, json!(history).to_string()])?;
        }
        (_, Some(cur)) => {
            let custom = if cur.path_id == CUSTOM && b.custom.is_some() { custom_json(&b.custom) } else { cur.custom.as_ref().map(Value::to_string) };
            tx.execute("UPDATE user_paths SET pace_per_week=?1, target_date=?2, with_ministry=?3, custom_json=?4 WHERE user_id=?5",
                params![b.pace_per_week.unwrap_or(cur.pace), b.target_date.clone().unwrap_or(cur.target), b.with_ministry.unwrap_or(cur.with_ministry) as i64, custom, u.id])?;
        }
        (_, None) => return Err(ApiError::bad("id: no path to change; start one")),
    }
    tx.commit()?;
    answer(&conn, u.id)
}
/// Stop: the path and its history go; progress (chapters_read) is untouched.
pub async fn delete_mine(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    conn.execute("DELETE FROM user_paths WHERE user_id=?1", params![u.id])?;
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::books::BOOKS;
    use crate::testkit::{app, call, user};

    #[test]
    fn every_built_in_order_is_whole_and_agrees_with_the_book_table() {
        let lens: Vec<usize> = BUILT_IN.iter().map(|id| chapters_of(id).unwrap().len()).collect();
        assert_eq!(lens[..7], [89, 89, 181, 260, 1189, 1189, 1189]);
        assert_eq!(lens[7], crate::companion::outlined_books("coates").iter().map(|b| crate::books::book(*b).unwrap().chapters as usize).sum::<usize>());
        for id in BUILT_IN {
            let chs = chapters_of(id).unwrap();
            assert_eq!(chs.iter().collect::<HashSet<_>>().len(), chs.len(), "{id}: a chapter twice");
            assert!(chs.iter().all(|(b, c)| crate::books::book(*b).is_some_and(|bk| (1..=bk.chapters as i64).contains(c))), "{id}: a chapter the Bible has not");
        }
        assert_eq!(chapters_of("in-order").unwrap().iter().filter(|(b, _)| *b == 18).count(), 42);
        assert_eq!(&chapters_of("life-of-christ").unwrap()[..3], &[(40, 1), (40, 2), (42, 1)]);
        assert!(chapters_of("custom").is_none());
        assert!(chapters_of("nope").is_none());
        assert!(BOOKS.iter().map(|b| b.chapters as usize).sum::<usize>() == 1189);
    }

    #[test]
    fn place_counts_read_portions_and_points_at_the_first_unread() {
        let chs = chapters_of("gospels").unwrap();
        assert_eq!(place(&chs, &[]), (0, 1));
        assert_eq!(place(&chs, &[(40, 1), (40, 2), (40, 4), (19, 23)]), (3, 3));
        assert_eq!(place(&chs, &chs), (89, 89));
    }

    #[test]
    fn a_database_from_before_paths_gains_last_read_at_backfilled_from_the_first_read() {
        let path = std::env::temp_dir().join(format!("berean-test-paths-{}.db", crate::auth::random_token(6)));
        Connection::open(&path).unwrap().execute_batch("
            CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, handle TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
              is_admin INTEGER NOT NULL DEFAULT 0, settings TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
            INSERT INTO users (id, handle, display_name, password_hash) VALUES (7, 'anna', 'Anna', 'x');
            CREATE TABLE chapters_read (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, book INTEGER NOT NULL, chapter INTEGER NOT NULL,
              first_read_at TEXT NOT NULL, times INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (user_id, book, chapter));
            INSERT INTO chapters_read VALUES (7, 40, 1, '2026-01-02T03:04:05.000Z', 3);
            CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT, owner_id INTEGER NOT NULL REFERENCES users(id),
              invite_code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
            INSERT INTO groups (name, slug, owner_id, invite_code) VALUES ('Psalms', 'psalms', 7, 'abc');
        ").unwrap();
        let pool = crate::db::open_pool(path.to_str().unwrap(), None).unwrap();
        let c = pool.get().unwrap();
        let (first, last, times): (String, String, i64) = c.query_row("SELECT first_read_at, last_read_at, times FROM chapters_read WHERE user_id=7", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!((first.as_str(), last.as_str(), times), ("2026-01-02T03:04:05.000Z", "2026-01-02T03:04:05.000Z", 3));
        let g: (Option<String>, Option<String>) = c.query_row("SELECT path_id, path_started_at FROM groups WHERE slug='psalms'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(g, (None, None));
        assert_eq!(c.query_row("SELECT count(*) FROM user_paths", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        // a second open leaves the backfill alone
        drop(c); drop(pool);
        let pool = crate::db::open_pool(path.to_str().unwrap(), None).unwrap();
        pool.get().unwrap().execute("UPDATE chapters_read SET last_read_at='2026-05-05T00:00:00.000Z'", []).unwrap();
        drop(pool);
        let pool = crate::db::open_pool(path.to_str().unwrap(), None).unwrap();
        assert_eq!(pool.get().unwrap().query_row("SELECT last_read_at FROM chapters_read", [], |r| r.get::<_, String>(0)).unwrap(), "2026-05-05T00:00:00.000Z");
        drop(pool);
        let _ = std::fs::remove_file(path);
    }

    /// A credit on `book` `chapter` at `at` (what activity::beat_at writes on a credit).
    fn credit(pool: &crate::db::DbPool, uid: i64, book: i64, chapter: i64, at: &str) {
        pool.get().unwrap().execute("INSERT INTO chapters_read (user_id, book, chapter, first_read_at, last_read_at) VALUES (?1,?2,?3,?4,?4) ON CONFLICT(user_id, book, chapter) DO UPDATE SET times=times+1, last_read_at=excluded.last_read_at", params![uid, book, chapter, at]).unwrap();
    }

    #[tokio::test]
    async fn the_path_answers_with_the_chapters_credited_since_its_start_and_switching_keeps_the_old_start() {
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        let (st, v) = call(&app, "GET", "/me/path", Some(&anna), Value::Null).await;
        assert_eq!((st, v), (200, json!({ "path": null, "history": [], "read": [], "marked": [] })));
        // reads before the start do not count; a re-read after it does
        credit(&pool, id, 40, 1, "2026-01-01T00:00:00.000Z");
        credit(&pool, id, 40, 2, "2026-01-01T00:00:00.000Z");
        let (st, v) = call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "gospels", "started_at": "2026-02-01T00:00:00.000Z", "pace_per_week": 7 })).await;
        assert_eq!(st, 200, "{v}");
        assert_eq!(v["path"], json!({ "id": "gospels", "started_at": "2026-02-01T00:00:00.000Z", "target_date": null, "pace_per_week": 7, "with_ministry": false, "custom": null }));
        assert_eq!(v["read"], json!([]));
        credit(&pool, id, 40, 2, "2026-02-03T00:00:00.000Z");
        credit(&pool, id, 40, 3, "2026-02-04T00:00:00.000Z");
        credit(&pool, id, 19, 23, "2026-02-04T00:00:00.000Z");   // the client filters to the path; the server hands every chapter since the start
        let (_, v) = call(&app, "GET", "/me/path", Some(&anna), Value::Null).await;
        assert_eq!(v["read"], json!([[19, 23], [40, 2], [40, 3]]));
        let (done, position) = place(&chapters_of("gospels").unwrap(), &v["read"].as_array().unwrap().iter().map(|c| (c[0].as_i64().unwrap(), c[1].as_i64().unwrap())).collect::<Vec<_>>());
        assert_eq!((done, position), (2, 1));
        // the pace alone
        let (st, v) = call(&app, "PUT", "/me/path", Some(&anna), json!({ "pace_per_week": null })).await;
        assert_eq!((st, v["path"]["pace_per_week"].clone(), v["path"]["started_at"].as_str()), (200, Value::Null, Some("2026-02-01T00:00:00.000Z")));
        assert_eq!(call(&app, "PUT", "/me/path", Some(&anna), json!({ "pace_per_week": 71 })).await.0, 400);
        // a target date, the reader's own day; the pairing switch is kept whatever the path
        assert_eq!(call(&app, "PUT", "/me/path", Some(&anna), json!({ "target_date": "2026-13-01" })).await.0, 400);
        assert_eq!(call(&app, "PUT", "/me/path", Some(&anna), json!({ "target_date": "next week" })).await.0, 400);
        let (_, v) = call(&app, "PUT", "/me/path", Some(&anna), json!({ "target_date": "2026-12-31", "with_ministry": true })).await;
        assert_eq!((v["path"]["target_date"].as_str(), v["path"]["with_ministry"].as_bool()), (Some("2026-12-31"), Some(true)));
        let (_, v) = call(&app, "PUT", "/me/path", Some(&anna), json!({ "target_date": null })).await;
        assert_eq!((v["path"]["target_date"].clone(), v["path"]["with_ministry"].as_bool()), (Value::Null, Some(true)));
        assert_eq!(call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "marathon" })).await.0, 400);
        // switching: the Gospels go into history with their start; the new path starts now (a later start than the reads)
        let (_, v) = call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "psalms-proverbs", "target_date": "2026-11-30" })).await;
        assert_eq!(v["path"]["id"], "psalms-proverbs");
        assert_eq!((v["path"]["target_date"].as_str(), v["path"]["with_ministry"].as_bool()), (Some("2026-11-30"), Some(false)));
        assert!(v["path"]["started_at"].as_str().unwrap() > "2026-02-04");
        assert_eq!(v["history"].as_array().unwrap().len(), 1);
        assert_eq!((v["history"][0]["id"].as_str(), v["history"][0]["started_at"].as_str()), (Some("gospels"), Some("2026-02-01T00:00:00.000Z")));
        assert_eq!(v["read"], json!([]));
        // the same id again is not a switch
        let (_, v) = call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "psalms-proverbs", "pace_per_week": 3 })).await;
        assert_eq!((v["history"].as_array().unwrap().len(), v["path"]["pace_per_week"].as_i64()), (1, Some(3)));
        // coming back resumes the Gospels from their own start, with the reads since it
        let (_, v) = call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "gospels" })).await;
        assert_eq!(v["path"]["started_at"], "2026-02-01T00:00:00.000Z");
        assert_eq!(v["path"]["target_date"], Value::Null, "a target is the path's own; the pace carries over");
        assert_eq!(v["path"]["pace_per_week"], 3);
        assert_eq!(v["history"].as_array().unwrap().len(), 1);
        assert_eq!(v["history"][0]["id"], "psalms-proverbs");
        assert_eq!(v["read"], json!([[19, 23], [40, 2], [40, 3]]));
        // a custom path needs books; two custom paths with different books are different paths
        assert_eq!(call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "custom" })).await.0, 400);
        assert_eq!(call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "custom", "custom": { "title": "x", "books": [67] } })).await.0, 400);
        let (st, v) = call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "custom", "custom": { "title": " Prison letters ", "books": [49, 50, 51, 57] } })).await;
        assert_eq!((st, v["path"]["custom"].clone()), (200, json!({ "title": "Prison letters", "books": [49, 50, 51, 57] })));
        // the paired paths start with the pairing on unless told otherwise
        let (_, v) = call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "synopsis" })).await;
        assert_eq!(v["path"]["with_ministry"], true);
        let (_, v) = call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "coates", "with_ministry": false })).await;
        assert_eq!(v["path"]["with_ministry"], false);
        let (st, v) = call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "custom", "custom": { "title": " Prison letters ", "books": [49, 50, 51, 57] } })).await;
        // the custom path was left once already (gospels, psalms, synopsis, coates behind it) and comes back resumed
        assert_eq!((st, v["path"]["started_at"].as_str().is_some(), v["history"].as_array().unwrap().len()), (200, true, 4));
        let (_, v) = call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "custom", "custom": { "title": "Prison letters", "books": [49, 50, 51] } })).await;
        assert_eq!((v["history"].as_array().unwrap().len(), v["path"]["custom"]["books"].clone()), (5, json!([49, 50, 51])));
        // stop: everything about the path goes, the reads stay
        let (st, _) = call(&app, "DELETE", "/me/path", Some(&anna), Value::Null).await;
        assert_eq!(st, 200);
        let (_, v) = call(&app, "GET", "/me/path", Some(&anna), Value::Null).await;
        assert_eq!(v, json!({ "path": null, "history": [], "read": [], "marked": [] }));
        assert_eq!(pool.get().unwrap().query_row("SELECT count(*) FROM chapters_read WHERE user_id=?1", params![id], |r| r.get::<_, i64>(0)).unwrap(), 4);
        assert_eq!(call(&app, "PUT", "/me/path", Some(&anna), json!({ "pace_per_week": 3 })).await.0, 400);
        assert_eq!(call(&app, "GET", "/me/path", None, Value::Null).await.0, 401);
    }

    #[tokio::test]
    async fn a_group_walks_a_built_in_path_and_each_member_stands_by_their_own_reads_since_its_start() {
        let (app, pool) = app();
        let (anna_id, anna) = user(&pool, "anna");
        let (ben_id, ben) = user(&pool, "ben");
        let (_, g) = call(&app, "POST", "/groups", Some(&anna), json!({ "name": "Gospels together" })).await;
        let slug = g["slug"].as_str().unwrap().to_string();
        call(&app, "POST", "/groups/join", Some(&ben), json!({ "invite_code": g["invite_code"] })).await;
        let (_, v) = call(&app, "GET", &format!("/groups/{slug}"), Some(&ben), Value::Null).await;
        assert_eq!(v["path"], Value::Null);
        assert_eq!(call(&app, "PUT", &format!("/groups/{slug}/path"), Some(&ben), json!({ "path_id": "gospels" })).await.0, 403, "members do not set the path");
        assert_eq!(call(&app, "PUT", &format!("/groups/{slug}/path"), Some(&anna), json!({ "path_id": "custom" })).await.0, 400, "a group walks a built-in path");
        credit(&pool, ben_id, 40, 1, "2026-01-01T00:00:00.000Z");   // before the group set out
        let (st, v) = call(&app, "PUT", &format!("/groups/{slug}/path"), Some(&anna), json!({ "path_id": "gospels" })).await;
        assert_eq!(st, 200, "{v}");
        assert_eq!(v["path"]["id"], "gospels");
        let started = v["path"]["started_at"].as_str().unwrap().to_string();
        assert_eq!(v["path"]["members"], json!([{ "user_id": anna_id, "done": 0, "position": 1 }, { "user_id": ben_id, "done": 0, "position": 1 }]));
        assert_eq!(v["path"]["target_date"], Value::Null);
        let (_, v) = call(&app, "PUT", &format!("/groups/{slug}/path"), Some(&anna), json!({ "path_id": "gospels", "target_date": "2026-12-31" })).await;
        assert_eq!((v["path"]["target_date"].as_str(), v["path"]["started_at"].as_str()), (Some("2026-12-31"), Some(started.as_str())), "a target alone is not a restart");
        assert_eq!(call(&app, "PUT", &format!("/groups/{slug}/path"), Some(&anna), json!({ "path_id": "gospels", "target_date": "soon" })).await.0, 400);
        credit(&pool, ben_id, 40, 1, "2099-01-01T00:00:00.000Z");
        credit(&pool, ben_id, 40, 3, "2099-01-01T00:00:00.000Z");
        credit(&pool, anna_id, 19, 23, "2099-01-01T00:00:00.000Z");
        let (_, v) = call(&app, "GET", &format!("/groups/{slug}"), Some(&ben), Value::Null).await;
        assert_eq!(v["path"]["members"], json!([{ "user_id": anna_id, "done": 0, "position": 1 }, { "user_id": ben_id, "done": 2, "position": 2 }]));
        assert_eq!((v["path_id"].as_str(), v["path_started_at"].as_str(), v["path_target_date"].as_str()), (Some("gospels"), Some(started.as_str()), Some("2026-12-31")));
        // the same path again changes nothing; restart moves the start
        let (_, v) = call(&app, "PUT", &format!("/groups/{slug}/path"), Some(&anna), json!({ "path_id": "gospels" })).await;
        assert_eq!(v["path"]["started_at"].as_str(), Some(started.as_str()));
        let (_, v) = call(&app, "PUT", &format!("/groups/{slug}/path"), Some(&anna), json!({ "path_id": "gospels", "restart": true })).await;
        assert!(v["path"]["started_at"].as_str().unwrap() > started.as_str());
        // the list shows which groups walk a path; clearing takes it off
        let (_, list) = call(&app, "GET", "/groups", Some(&ben), Value::Null).await;
        assert_eq!(list[0]["path_id"], "gospels");
        let (_, v) = call(&app, "PUT", &format!("/groups/{slug}/path"), Some(&anna), json!({ "path_id": null })).await;
        assert_eq!(v["path"], Value::Null);
        assert_eq!(v["path_id"], Value::Null);
    }

    #[tokio::test]
    async fn the_path_is_exported_and_deleted_as_personal_data() {
        let (app, pool) = app();
        let (_, anna) = user(&pool, "anna");
        call(&app, "PUT", "/me/path", Some(&anna), json!({ "id": "bible", "pace_per_week": 7 })).await;
        let (_, v) = call(&app, "GET", "/me/export", Some(&anna), Value::Null).await;
        assert_eq!((v["path"]["path_id"].as_str(), v["path"]["pace_per_week"].as_i64(), v["path"]["with_ministry"].as_i64(), v["path"]["target_date"].clone()), (Some("bible"), Some(7), Some(0), Value::Null));
        let (st, v) = call(&app, "DELETE", "/me/data", Some(&anna), json!({ "categories": ["path"] })).await;
        assert_eq!((st, v["deleted"]["path"].as_i64()), (200, Some(1)));
        let (_, v) = call(&app, "GET", "/me/path", Some(&anna), Value::Null).await;
        assert_eq!(v["path"], Value::Null);
        let (_, v) = call(&app, "GET", "/me/export", Some(&anna), Value::Null).await;
        assert_eq!(v["path"], Value::Null);
    }
}
