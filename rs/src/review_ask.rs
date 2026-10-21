//! The owner's ask for a review (docs/API.md "Review ask"). Nothing asks until the owner starts an ask on the server
//! (`berean review-ask start`, so only someone signed in to the server can); there is no web route that starts one.
//! A running ask reaches committed readers only: signed in, with chapters credited on enough days and enough chapters
//! in all. Home shows it once (client/src/components/ReviewAsk.tsx), on Android installs from Google Play: the reader
//! says whether the app is a help; either way both a review and private feedback stay on offer, the one their answer
//! suggests in the accent (no review gating, Play's policy).
use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::{extract::{Path, State}, routing::{get, post}, Json, Router};
use rusqlite::{named_params, params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

/// What a committed reader is when the owner names nothing else: chapters credited on 14 days, 30 chapters in all.
pub const DAYS: i64 = 14;
pub const CHAPTERS: i64 = 30;
/// A reader who has read enough (`u` is the users row); :days and :chapters are the ask's.
const COMMITTED: &str = "u.disabled = 0 AND u.is_admin = 0
  AND (SELECT count(*) FROM activity_days d WHERE d.user_id = u.id AND d.pages > 0) >= :days
  AND (SELECT count(*) FROM page_credits p WHERE p.user_id = u.id) >= :chapters";

struct Ask { id: i64, days: i64, chapters: i64, only: Option<i64> }
fn running(conn: &Connection) -> rusqlite::Result<Option<Ask>> {
    conn.query_row("SELECT id, min_days, min_chapters, only_user_id FROM review_asks WHERE stopped_at IS NULL ORDER BY id DESC LIMIT 1", [],
        |r| Ok(Ask { id: r.get(0)?, days: r.get(1)?, chapters: r.get(2)?, only: r.get(3)? })).optional()
}

/// The ask this reader should see now, if any, recorded as shown: the running one, when they are committed (or the one
/// the ask names), have not answered it, and did not say yes or no to an earlier one (closing one unanswered leaves
/// them free to be asked again).
pub fn pending(conn: &Connection, uid: i64) -> rusqlite::Result<Option<i64>> {
    let Some(a) = running(conn)? else { return Ok(None) };
    let reaches = match a.only {
        Some(only) => only == uid,
        None => {
            let committed: bool = conn.query_row(&format!("SELECT count(*) > 0 FROM users u WHERE u.id = :uid AND {COMMITTED}"),
                named_params! { ":uid": uid, ":days": a.days, ":chapters": a.chapters }, |r| r.get(0))?;
            let said_before: bool = conn.query_row("SELECT count(*) > 0 FROM review_ask_answers WHERE user_id=?1 AND ask_id<>?2 AND answer IN ('like','dislike')", params![uid, a.id], |r| r.get(0))?;
            committed && !said_before
        }
    };
    if !reaches { return Ok(None) }
    let answered: bool = conn.query_row("SELECT count(*) > 0 FROM review_ask_answers WHERE ask_id=?1 AND user_id=?2 AND answer IS NOT NULL", params![a.id, uid], |r| r.get(0))?;
    if answered { return Ok(None) }
    conn.execute("INSERT OR IGNORE INTO review_ask_answers (ask_id, user_id) VALUES (?1, ?2)", params![a.id, uid])?;
    Ok(Some(a.id))
}

async fn get_ask(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Value>> {
    let ask = s.db(move |conn| Ok(pending(conn, u.id)?)).await?;
    Ok(Json(json!({ "ask": ask })))
}

/// The reader's answer (`like`, `dislike`, or `later` for closing it unanswered), that they opened the store page, or
/// the feedback message they sent from it; any of these, as they happen.
#[derive(Deserialize)] struct AnswerIn { answer: Option<String>, store: Option<bool>, feedback_id: Option<i64> }
async fn answer(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>, Json(b): Json<AnswerIn>) -> ApiResult<Json<Value>> {
    if let Some(a) = b.answer.as_deref() { if !matches!(a, "like" | "dislike" | "later") { return Err(ApiError::bad("answer: like, dislike or later")) } }
    s.db(move |conn| {
        let shown: bool = conn.query_row("SELECT count(*) > 0 FROM review_ask_answers WHERE ask_id=?1 AND user_id=?2", params![id, u.id], |r| r.get(0))?;
        if !shown { return Err(ApiError::not_found("no such ask")) }
        let now = crate::db::now_iso();
        match b.answer.as_deref() {
            // closing the card after an answer keeps the answer
            Some("later") => { conn.execute("UPDATE review_ask_answers SET answer='later', answered_at=?1 WHERE ask_id=?2 AND user_id=?3 AND answer IS NULL", params![now, id, u.id])?; }
            Some(a) => { conn.execute("UPDATE review_ask_answers SET answer=?1, answered_at=?2 WHERE ask_id=?3 AND user_id=?4", params![a, now, id, u.id])?; }
            None => {}
        }
        if b.store == Some(true) { conn.execute("UPDATE review_ask_answers SET store_at=coalesce(store_at, ?1) WHERE ask_id=?2 AND user_id=?3", params![now, id, u.id])?; }
        // only the reader's own message
        if let Some(f) = b.feedback_id { conn.execute("UPDATE review_ask_answers SET feedback_id=?1 WHERE ask_id=?2 AND user_id=?3 AND EXISTS (SELECT 1 FROM feedback WHERE id=?1 AND user_id=?3)", params![f, id, u.id])?; }
        Ok(())
    }).await?;
    Ok(Json(json!({ "ok": true })))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/review-ask", get(get_ask)).route("/review-ask/{id}", post(answer))
}

/// How many readers a new ask with these thresholds would reach today.
pub fn committed_count(conn: &Connection, days: i64, chapters: i64) -> rusqlite::Result<i64> {
    conn.query_row(&format!("SELECT count(*) FROM users u WHERE {COMMITTED}"), named_params! { ":days": days, ":chapters": chapters }, |r| r.get(0))
}

/// `berean review-ask start [--days N] [--chapters N] [--only <handle>]`: stops the running ask, if any, and starts
/// this one; `--only` reaches that one reader whatever they have read (to see it on your own phone first).
pub fn start(conn: &Connection, args: &[String]) -> anyhow::Result<()> {
    let (mut days, mut chapters, mut only) = (DAYS, CHAPTERS, None);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut val = || it.next().ok_or_else(|| anyhow::anyhow!("{a} needs a value"));
        match a.as_str() {
            "--days" => days = val()?.parse()?,
            "--chapters" => chapters = val()?.parse()?,
            "--only" => {
                let h = val()?.trim_start_matches('@').to_string();
                let id: Option<i64> = conn.query_row("SELECT id FROM users WHERE handle=?1 COLLATE NOCASE", params![h], |r| r.get(0)).optional()?;
                only = Some((id.ok_or_else(|| anyhow::anyhow!("no such user: @{h}"))?, h));
            }
            _ => anyhow::bail!("review-ask start [--days N] [--chapters N] [--only <handle>]"),
        }
    }
    conn.execute("UPDATE review_asks SET stopped_at=?1 WHERE stopped_at IS NULL", params![crate::db::now_iso()])?;
    conn.execute("INSERT INTO review_asks (min_days, min_chapters, only_user_id) VALUES (?1, ?2, ?3)", params![days, chapters, only.as_ref().map(|o| o.0)])?;
    let id = conn.last_insert_rowid();
    let who = match only {
        Some((_, h)) => { println!("review ask #{id} started for @{h} only"); format!("@{h} sees") }
        None => { println!("review ask #{id} started: readers with chapters credited on {days}+ days and {chapters}+ chapters; {} qualify today", committed_count(conn, days, chapters)?); "each sees".into() }
    };
    println!("{who} it on Home the next time the app opens (Android, installed from Google Play); `berean review-ask stop` ends it");
    Ok(())
}

/// `berean review-ask stop`
pub fn stop(conn: &Connection) -> anyhow::Result<()> {
    let n = conn.execute("UPDATE review_asks SET stopped_at=?1 WHERE stopped_at IS NULL", params![crate::db::now_iso()])?;
    println!("{}", if n == 0 { "no review ask is running" } else { "review ask stopped; nobody else will be shown it" });
    Ok(())
}

/// `berean review-ask`: each ask, newest first, with what came of it; the feedback it brought is in `berean feedback`.
pub fn report(conn: &Connection) -> anyhow::Result<()> {
    let mut st = conn.prepare("SELECT a.id, substr(a.started_at,1,16), coalesce(substr(a.stopped_at,1,16), 'running'), a.min_days, a.min_chapters, u.handle,
        count(r.user_id), count(r.answer='like' OR NULL), count(r.answer='dislike' OR NULL), count(r.answer='later' OR NULL), count(r.store_at), count(r.feedback_id), group_concat(r.feedback_id)
        FROM review_asks a LEFT JOIN users u ON u.id=a.only_user_id LEFT JOIN review_ask_answers r ON r.ask_id=a.id GROUP BY a.id ORDER BY a.id DESC LIMIT 20")?;
    let mut any = false;
    for row in st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?, r.get::<_, Option<String>>(5)?,
        [r.get::<_, i64>(6)?, r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?], r.get::<_, Option<String>>(12)?)))? {
        let (id, from, to, days, chapters, only, [shown, like, dislike, later, store, feedback], ids) = row?;
        any = true;
        let who = only.map(|h| format!("@{h} only")).unwrap_or_else(|| format!("{days}+ days, {chapters}+ chapters"));
        println!("#{id}  {from} → {to}  ({who})");
        println!("     shown {shown}  · a help {like}  · not yet {dislike}  · closed {later}  · opened the store {store}  · feedback {feedback}{}",
            ids.map(|i| format!(" (berean feedback-show {})", i.replace(',', ", "))).unwrap_or_default());
    }
    if !any { println!("no review ask yet; `berean review-ask start` begins one"); }
    if running(conn)?.is_none() { println!("readers who would qualify today ({DAYS}+ days, {CHAPTERS}+ chapters): {}", committed_count(conn, DAYS, CHAPTERS)?); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::{app, call, user};

    /// `days` reading days with `per_day` credited chapters each, ending today.
    fn read(pool: &crate::db::DbPool, uid: i64, days: i64, per_day: i64) {
        let c = pool.get().unwrap();
        for d in 0..days {
            let date: String = c.query_row("SELECT date('now', ?1)", params![format!("-{d} days")], |r| r.get(0)).unwrap();
            c.execute("INSERT INTO activity_days (user_id, date, active_seconds, pages, chapters) VALUES (?1, ?2, 900, ?3, ?3)", params![uid, date, per_day]).unwrap();
            for ch in 0..per_day { c.execute("INSERT INTO page_credits (user_id, book, chapter, date, dwell_seconds) VALUES (?1, 1, ?2, ?3, 120)", params![uid, d * 10 + ch + 1, date]).unwrap(); }
        }
    }

    #[tokio::test]
    async fn nothing_is_asked_until_the_owner_starts_an_ask_and_then_only_of_committed_readers() {
        let (app, pool) = app();
        let (keen, keen_t) = user(&pool, "keen");
        let (_, new_t) = user(&pool, "newcomer");
        read(&pool, keen, 15, 2);
        let (st, v) = call(&app, "GET", "/review-ask", Some(&keen_t), Value::Null).await;
        assert_eq!((st, v["ask"].clone()), (200, Value::Null));
        let (st, _) = call(&app, "GET", "/review-ask", None, Value::Null).await;
        assert_eq!(st, 401);
        start(&pool.get().unwrap(), &[]).unwrap();
        let (_, v) = call(&app, "GET", "/review-ask", Some(&keen_t), Value::Null).await;
        assert!(v["ask"].is_i64(), "{v}");
        let (_, v) = call(&app, "GET", "/review-ask", Some(&new_t), Value::Null).await;
        assert!(v["ask"].is_null(), "a reader who has not read enough is not asked: {v}");
    }

    #[tokio::test]
    async fn an_answer_closes_it_and_a_like_or_dislike_is_not_asked_again() {
        let (app, pool) = app();
        let (a, a_t) = user(&pool, "anna");
        let (b, b_t) = user(&pool, "ben");
        read(&pool, a, 20, 2); read(&pool, b, 20, 2);
        start(&pool.get().unwrap(), &[]).unwrap();
        let (_, v) = call(&app, "GET", "/review-ask", Some(&a_t), Value::Null).await;
        let id = v["ask"].as_i64().unwrap();
        let (st, _) = call(&app, "POST", &format!("/review-ask/{id}"), Some(&a_t), json!({ "answer": "like" })).await;
        assert_eq!(st, 200);
        // closing the thank-you card afterwards keeps the like
        call(&app, "POST", &format!("/review-ask/{id}"), Some(&a_t), json!({ "answer": "later", "store": true })).await;
        let (answer, store): (String, Option<String>) = pool.get().unwrap().query_row("SELECT answer, store_at FROM review_ask_answers WHERE user_id=?1", params![a], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(answer, "like");
        assert!(store.is_some());
        let (_, v) = call(&app, "GET", "/review-ask", Some(&a_t), Value::Null).await;
        assert!(v["ask"].is_null());
        // Ben closes it unanswered
        let (_, v) = call(&app, "GET", "/review-ask", Some(&b_t), Value::Null).await;
        call(&app, "POST", &format!("/review-ask/{}", v["ask"]), Some(&b_t), json!({ "answer": "later" })).await;
        // a later ask reaches Ben again, not Anna
        start(&pool.get().unwrap(), &[]).unwrap();
        let (_, v) = call(&app, "GET", "/review-ask", Some(&a_t), Value::Null).await;
        assert!(v["ask"].is_null());
        let (_, v) = call(&app, "GET", "/review-ask", Some(&b_t), Value::Null).await;
        assert!(v["ask"].is_i64());
        stop(&pool.get().unwrap()).unwrap();
        let (_, v) = call(&app, "GET", "/review-ask", Some(&b_t), Value::Null).await;
        assert!(v["ask"].is_null(), "a stopped ask reaches nobody");
    }

    #[tokio::test]
    async fn only_names_one_reader_and_answers_need_a_shown_ask_and_own_feedback() {
        let (app, pool) = app();
        let (_, owner_t) = user(&pool, "owner");
        let (c, c_t) = user(&pool, "cara");
        read(&pool, c, 20, 2);
        start(&pool.get().unwrap(), &["--only".into(), "@owner".into()]).unwrap();
        let (_, v) = call(&app, "GET", "/review-ask", Some(&c_t), Value::Null).await;
        assert!(v["ask"].is_null());
        let (_, v) = call(&app, "GET", "/review-ask", Some(&owner_t), Value::Null).await;
        let id = v["ask"].as_i64().expect("the named reader is asked whatever they have read");
        // Cara was never shown it: she cannot answer it
        let (st, _) = call(&app, "POST", &format!("/review-ask/{id}"), Some(&c_t), json!({ "answer": "dislike" })).await;
        assert_eq!(st, 404);
        let (st, _) = call(&app, "POST", &format!("/review-ask/{id}"), Some(&owner_t), json!({ "answer": "maybe" })).await;
        assert_eq!(st, 400);
        // the feedback linked must be the reader's own
        let (_, f) = call(&app, "POST", "/feedback", Some(&c_t), json!({ "message": "Bigger type please" })).await;
        call(&app, "POST", &format!("/review-ask/{id}"), Some(&owner_t), json!({ "answer": "dislike", "feedback_id": f["id"] })).await;
        let linked: Option<i64> = pool.get().unwrap().query_row("SELECT feedback_id FROM review_ask_answers WHERE ask_id=?1", params![id], |r| r.get(0)).unwrap();
        assert_eq!(linked, None);
        assert!(super::start(&pool.get().unwrap(), &["--only".into(), "@nobody".into()]).is_err());
    }
}
