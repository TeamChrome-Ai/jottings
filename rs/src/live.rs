//! The admin's live numbers (`GET /api/admin/live`, client `/admin/live`): store-link clicks by hour and day, accounts,
//! readers, and how the server is answering. Counts only, as store.rs: nothing here says who.
//!
//! The request figures are kept in memory by `measure` (a layer over every request) in buckets of one UTC hour, the
//! last 48: they start again when the server does, and `since` says when that was. Clicks by hour are in the
//! database (`store_click_hours`), written by store.rs beside the daily count.
use crate::auth::AuthUser;
use crate::error::ApiResult;
use crate::AppState;
use axum::{extract::{Request, State}, middleware::Next, response::Response, routing::get, Json, Router};
use rusqlite::params;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};

/// Upper edges, ms, of the answer-time histogram; the last bin is everything slower.
const EDGES: [f64; 13] = [1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0, 500.0, 1000.0, 2000.0, 5000.0, 10000.0];
/// `n` counts every request; `timed` and the times only those whose time is the server's own: not a recording being
/// downloaded, whose seconds are the listener's connection. The histogram is for the 95th percentile, which a phone
/// that stalls mid-upload cannot move the way it moved a "slowest answer".
#[derive(Default, Clone, Copy)]
struct Bucket { n: u64, errors: u64, opens: u64, timed: u64, total_ms: f64, max_ms: f64, hist: [u64; 14] }
fn bin(ms: f64) -> usize { EDGES.iter().position(|e| ms <= *e).unwrap_or(EDGES.len()) }
/// The time 95 in 100 answers came within, to the histogram's edge (None when nothing was timed).
fn p95(hist: &[u64; 14]) -> Option<f64> {
    let total: u64 = hist.iter().sum();
    if total == 0 { return None }
    let (want, mut seen) = ((total as f64 * 0.95).ceil() as u64, 0);
    for (i, n) in hist.iter().enumerate() { seen += n; if seen >= want { return Some(*EDGES.get(i).unwrap_or(&20000.0)) } }
    None
}
struct Metrics { since: String, hours: BTreeMap<String, Bucket> }
static METRICS: OnceLock<Mutex<Metrics>> = OnceLock::new();
fn metrics() -> &'static Mutex<Metrics> { METRICS.get_or_init(|| Mutex::new(Metrics { since: crate::db::now_iso(), hours: BTreeMap::new() })) }
const KEPT_HOURS: usize = 48;

/// The UTC hour `t` falls in, as stored and sent: `2026-10-12T14`.
pub fn hour_key(t: time::OffsetDateTime) -> String { format!("{:04}-{:02}-{:02}T{:02}", t.year(), u8::from(t.month()), t.day(), t.hour()) }

/// One request into its hour's bucket. `opens` counts `/api/edition`, which an app asks on every start and return to
/// the foreground: the nearest thing to "the app was opened" that needs no identifier.
fn record(hour: String, path: &str, status: u16, ms: f64) {
    let Ok(mut m) = metrics().lock() else { return };
    let b = m.hours.entry(hour).or_default();
    b.n += 1;
    if status >= 500 { b.errors += 1 }
    if !(path.starts_with("/api/tts/") && path.contains("/audio")) { b.timed += 1; b.total_ms += ms; b.hist[bin(ms)] += 1; if ms > b.max_ms { b.max_ms = ms } }
    if path == "/api/edition" { b.opens += 1 }
    while m.hours.len() > KEPT_HOURS { let Some(k) = m.hours.keys().next().cloned() else { break }; m.hours.remove(&k); }
}
pub async fn measure(req: Request, next: Next) -> Response {
    let (path, t0) = (req.uri().path().to_string(), std::time::Instant::now());
    let res = next.run(req).await;
    record(hour_key(time::OffsetDateTime::now_utc()), &path, res.status().as_u16(), t0.elapsed().as_secs_f64() * 1000.0);
    res
}

fn rows(conn: &rusqlite::Connection, sql: &str) -> rusqlite::Result<Vec<Value>> {
    let mut st = conn.prepare_cached(sql)?;
    let v = st.query_map([], |r| Ok(json!({ "key": r.get::<_, String>(0)?, "n": r.get::<_, i64>(1)? })))?.collect(); v
}
fn one(conn: &rusqlite::Connection, sql: &str) -> rusqlite::Result<i64> { conn.query_row(sql, [], |r| r.get(0)) }

async fn live(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Value>> {
    crate::moderation::require_admin(&u)?;
    let now = time::OffsetDateTime::now_utc();
    let today = crate::activity::day_key(now.date());
    let db = s.db(move |c| {
        let clicks_today: i64 = c.query_row("SELECT coalesce(sum(n),0) FROM store_clicks WHERE day=?1", params![today], |r| r.get(0))?;
        Ok(json!({
            "clicks": {
                "today": clicks_today,
                "total": one(c, "SELECT coalesce(sum(n),0) FROM store_clicks")?,
                "by_hour": rows(c, "SELECT hour, n FROM (SELECT hour, n FROM store_click_hours ORDER BY hour DESC LIMIT 48) ORDER BY hour")?,
                "by_day": rows(c, "SELECT day, sum(n) FROM store_clicks GROUP BY day ORDER BY day DESC LIMIT 14")?,
            },
            "accounts": {
                "total": one(c, "SELECT count(*) FROM users WHERE id<>0 AND disabled=0")?,
                "today": c.query_row("SELECT count(*) FROM users WHERE id<>0 AND substr(created_at,1,10)=?1", params![today], |r| r.get::<_, i64>(0))?,
                "by_day": rows(c, "SELECT substr(created_at,1,10) d, count(*) FROM users WHERE id<>0 GROUP BY d ORDER BY d DESC LIMIT 14")?,
            },
            // signed-in readers only: a reader without an account leaves nothing on the server
            "readers": {
                "today": c.query_row("SELECT count(*) FROM activity_days WHERE date>=?1 AND active_seconds>0", params![today], |r| r.get::<_, i64>(0))?,
                "minutes_today": c.query_row("SELECT coalesce(sum(active_seconds),0)/60 FROM activity_days WHERE date>=?1", params![today], |r| r.get::<_, i64>(0))?,
            },
            "community": {
                "groups": one(c, "SELECT count(*) FROM groups")?,
                "jottings": one(c, "SELECT count(*) FROM outlines")?,
                "feedback": one(c, "SELECT count(*) FROM feedback")?,
                "reports_pending": one(c, "SELECT count(*) FROM reports WHERE status IN ('pending','hidden','escalated')")?,
            },
        }))
    }).await?;
    let (since, hours, all): (String, Vec<Value>, [u64; 14]) = match metrics().lock() {
        Ok(m) => {
            let mut all = [0u64; 14];
            for b in m.hours.values() { for (i, n) in b.hist.iter().enumerate() { all[i] += n } }
            (m.since.clone(), m.hours.iter().map(|(k, b)| json!({ "key": k, "n": b.n, "errors": b.errors, "opens": b.opens, "timed": b.timed, "avg_ms": if b.timed > 0 { (b.total_ms / b.timed as f64 * 10.0).round() / 10.0 } else { 0.0 }, "p95_ms": p95(&b.hist), "max_ms": b.max_ms.round() })).collect(), all)
        }
        Err(_) => (String::new(), vec![], [0; 14]),
    };
    let mut v = db;
    v["now"] = json!(crate::db::now_iso());
    v["server"] = json!({ "since": since, "by_hour": hours, "p95_ms": p95(&all) });
    Ok(Json(v))
}

/// `berean store-click-hours < lines`: adds `YYYY-MM-DDTHH n` lines (UTC hours) to the hourly record, for the hours
/// before the server kept one. Lines that are not that shape are skipped.
pub fn import_hours(conn: &rusqlite::Connection, text: &str) -> rusqlite::Result<usize> {
    let mut done = 0;
    for line in text.lines() {
        let mut it = line.split_whitespace();
        let (Some(hour), Some(n)) = (it.next(), it.next().and_then(|n| n.parse::<i64>().ok())) else { continue };
        if hour.len() != 13 || hour.as_bytes()[10] != b'T' { continue }
        conn.execute("INSERT INTO store_click_hours (hour, n) VALUES (?1, ?2) ON CONFLICT(hour) DO UPDATE SET n = excluded.n", params![hour, n])?;
        done += 1;
    }
    Ok(done)
}

pub fn router() -> Router<AppState> { Router::new().route("/admin/live", get(live)) }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::{app, call, user};

    #[test]
    fn hours_are_utc_keys_and_buckets_add_up() {
        let t = time::macros::datetime!(2026-10-12 14:59:59 UTC);
        assert_eq!(hour_key(t), "2026-10-12T14");
        record("2026-10-12T14".into(), "/api/edition", 200, 4.0);
        record("2026-10-12T14".into(), "/api/search", 503, 10.0);
        let m = metrics().lock().unwrap();
        let b = m.hours["2026-10-12T14"];
        assert_eq!((b.n, b.errors, b.opens, b.max_ms), (2, 1, 1, 10.0));
        drop(m);
        // a recording being downloaded is counted but not timed; one stalled upload does not move the 95th percentile
        record("2026-10-12T15".into(), "/api/tts/alec/43/3/audio.opus", 206, 9000.0);
        for _ in 0..99 { record("2026-10-12T15".into(), "/api/bible/43/3", 200, 3.0); }
        record("2026-10-12T15".into(), "/api/friends/contacts/match", 200, 10358.0);
        let m = metrics().lock().unwrap();
        let b = m.hours["2026-10-12T15"];
        assert_eq!((b.n, b.timed, p95(&b.hist), p95(&[0; 14])), (101, 100, Some(5.0), None));
    }

    #[tokio::test]
    async fn the_live_numbers_are_the_admins_and_count_clicks_by_hour() {
        let (app, pool) = app();
        let (boss_id, boss) = user(&pool, "boss");
        let (_, ben) = user(&pool, "ben");
        pool.get().unwrap().execute("UPDATE users SET is_admin=(id=?1)", params![boss_id]).unwrap();
        assert_eq!(call(&app, "GET", "/admin/live", Some(&ben), Value::Null).await.0, 403);
        assert_eq!(call(&app, "GET", "/admin/live", None, Value::Null).await.0, 401);
        let c = pool.get().unwrap();
        assert_eq!(import_hours(&c, "2026-10-12T14 132\nnonsense\n2026-10-12T15 87\n").unwrap(), 2);
        c.execute("INSERT INTO store_clicks (day, src, n) VALUES ('2026-10-12', '', 219)", []).unwrap();
        let (st, v) = call(&app, "GET", "/admin/live", Some(&boss), Value::Null).await;
        assert_eq!(st, 200);
        assert_eq!((v["clicks"]["total"].as_i64(), v["clicks"]["by_hour"][1]["key"].as_str(), v["clicks"]["by_hour"][1]["n"].as_i64()), (Some(219), Some("2026-10-12T15"), Some(87)));
        assert_eq!(v["accounts"]["total"].as_i64(), Some(2));
    }
}
