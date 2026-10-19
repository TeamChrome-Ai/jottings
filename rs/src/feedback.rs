//! Feedback from anyone (signed in or not) to the site admin, and the admin's supporter flag on a user.
//! Feedback is private to the admin: it is never shown to other users, so it is not moderated.
//! The admin may answer a message (`reply`): a signed-in sender reads the answer in the app (`/feedback/mine`), told
//! once on their next visit. A sender without an account has no inbox: the admin has only the email they left.
use crate::auth::{AuthUser, MaybeUser};
use crate::badges::check_badges;
use crate::error::{ApiError, ApiResult};
use crate::moderation::require_admin;
use crate::AppState;
use axum::{extract::{ConnectInfo, FromRequestParts, Path, State}, http::request::Parts, routing::{get, patch, post}, Json, Router};
use once_cell::sync::Lazy;
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const MESSAGE_MAX: usize = 2000;
pub const REPLY_MAX: usize = 1000;
/// The read-aloud log a reader chose to add (client/src/lib/readAloudLog.ts): longer ones are cut, not refused.
pub const DIAGNOSTICS_MAX: usize = 24_000;
/// The one-tap answer in the admin's inbox, and what `berean feedback-thank` sends.
pub const THANKS: &str = "Thank you for this. The fix will be in the next update.";
const EMAIL_MAX: usize = 254;
/// Per sender (address, and account when signed in): this many messages per window.
const PER_SENDER: usize = 5;
const WINDOW: Duration = Duration::from_secs(10 * 60);
/// Across everyone, per hour: a flood from many addresses still cannot fill the disk.
const GLOBAL_PER_HOUR: i64 = 120;

/// The address a request came from. Behind Caddy (a loopback peer) that is the last X-Forwarded-For entry, the one
/// Caddy appended; a direct peer is used as is, so a client cannot pick its own key by sending the header.
pub struct ClientAddr(pub String);
impl<S: Send + Sync> FromRequestParts<S> for ClientAddr {
    type Rejection = std::convert::Infallible;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        let peer = parts.extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip());
        let forwarded = || parts.headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|v| v.rsplit(',').next()).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        Ok(ClientAddr(match peer {
            Some(ip) if !ip.is_loopback() => ip.to_string(),
            _ => forwarded().unwrap_or_else(|| "local".into()),
        }))
    }
}

static RECENT: Lazy<Mutex<HashMap<String, Vec<Instant>>>> = Lazy::new(Default::default);

/// Records a send for every key if all of them are under the limit; otherwise records nothing and says no.
fn admit(keys: &[String], now: Instant) -> bool {
    let mut m = RECENT.lock().unwrap_or_else(|e| e.into_inner());
    m.retain(|_, v| { v.retain(|t| now.duration_since(*t) < WINDOW); !v.is_empty() });
    if keys.iter().any(|k| m.get(k).is_some_and(|v| v.len() >= PER_SENDER)) { return false; }
    for k in keys { m.entry(k.clone()).or_default().push(now); }
    true
}

/// Trimmed, or None when blank; an error when present but not shaped like an address.
fn clean_email(e: Option<&str>) -> ApiResult<Option<String>> {
    let Some(e) = e.map(str::trim).filter(|e| !e.is_empty()) else { return Ok(None) };
    let ok = e.len() <= EMAIL_MAX && !e.chars().any(char::is_whitespace) && e.split_once('@').is_some_and(|(a, b)| !a.is_empty() && b.contains('.') && !b.starts_with('.') && !b.ends_with('.'));
    if ok { Ok(Some(e.to_string())) } else { Err(ApiError::bad("email: that does not look like an email address")) }
}
fn short(s: Option<String>, n: usize) -> Option<String> { s.map(|s| s.trim().chars().take(n).collect::<String>()).filter(|s| !s.is_empty()) }

#[derive(Deserialize)] struct FeedbackIn { message: String, email: Option<String>, app_version: Option<String>, platform: Option<String>, diagnostics: Option<String> }
async fn submit(State(s): State<AppState>, MaybeUser(u): MaybeUser, ClientAddr(addr): ClientAddr, Json(b): Json<FeedbackIn>) -> ApiResult<Json<Value>> {
    let message = b.message.trim().to_string();
    let len = message.chars().count();
    if len == 0 || len > MESSAGE_MAX { return Err(ApiError::bad(format!("message: 1-{MESSAGE_MAX} characters"))); }
    let email = clean_email(b.email.as_deref())?;
    let (version, platform) = (short(b.app_version, 32), short(b.platform, 16));
    let diagnostics = short(b.diagnostics, DIAGNOSTICS_MAX);
    let mut keys = vec![format!("a:{addr}")];
    if let Some(u) = &u { keys.push(format!("u:{}", u.id)); }
    if !admit(&keys, Instant::now()) { return Err(ApiError::new(429, "That is a lot of messages at once. Please try again in a few minutes.")); }
    let uid = u.map(|u| u.id);
    let id = s.db(move |conn| {
        let hour: i64 = conn.query_row("SELECT count(*) FROM feedback WHERE created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')", [], |r| r.get(0))?;
        if hour >= GLOBAL_PER_HOUR { return Err(ApiError::new(429, "Feedback is busy right now. Please try again in an hour.")); }
        conn.execute("INSERT INTO feedback (user_id, message, email, app_version, platform, diagnostics) VALUES (?1,?2,?3,?4,?5,?6)", params![uid, message, email, version, platform, diagnostics])?;
        Ok(conn.last_insert_rowid())
    }).await?;
    Ok(Json(json!({ "ok": true, "id": id })))
}

async fn admin_list(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Vec<Value>>> {
    require_admin(&u)?;
    Ok(Json(s.db(|conn| {
        let mut st = conn.prepare_cached("SELECT f.id, f.message, f.email, f.app_version, f.platform, f.created_at, u.id, u.handle, f.reply, f.replied_at, f.reply_seen_at, f.diagnostics FROM feedback f LEFT JOIN users u ON u.id=f.user_id ORDER BY f.id DESC LIMIT 500")?;
        let v: Vec<Value> = st.query_map([], |r| {
            let user = match r.get::<_, Option<i64>>(6)? { Some(id) => json!({ "id": id, "handle": r.get::<_, String>(7)? }), None => Value::Null };
            Ok(json!({ "id": r.get::<_, i64>(0)?, "message": r.get::<_, String>(1)?, "email": r.get::<_, Option<String>>(2)?, "app_version": r.get::<_, Option<String>>(3)?, "platform": r.get::<_, Option<String>>(4)?, "created_at": r.get::<_, String>(5)?, "user": user,
                "reply": r.get::<_, Option<String>>(8)?, "replied_at": r.get::<_, Option<String>>(9)?, "reply_seen": r.get::<_, Option<String>>(10)?.is_some(), "diagnostics": r.get::<_, Option<String>>(11)? }))
        })?.collect::<Result<_, _>>()?;
        Ok(v)
    }).await?))
}
/// Answers `id` (or changes the answer, which the sender is then told of again). Returns whether the sender has an
/// account to read it in.
pub fn set_reply(conn: &rusqlite::Connection, id: i64, text: &str) -> ApiResult<bool> {
    let text = text.trim();
    let len = text.chars().count();
    if len == 0 || len > REPLY_MAX { return Err(ApiError::bad(format!("reply: 1-{REPLY_MAX} characters"))); }
    let Some(uid): Option<Option<i64>> = conn.query_row("SELECT user_id FROM feedback WHERE id=?1", params![id], |r| r.get(0)).optional()? else { return Err(ApiError::not_found("no such message")) };
    conn.execute("UPDATE feedback SET reply=?1, replied_at=?2, reply_seen_at=NULL WHERE id=?3", params![text, crate::db::now_iso(), id])?;
    Ok(uid.is_some())
}
#[derive(Deserialize)] struct ReplyIn { #[serde(default)] text: String, #[serde(default)] thanks: bool }
/// `{ thanks: true }` sends the standard thank-you; `{ text }` the admin's own words.
async fn admin_reply(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>, Json(b): Json<ReplyIn>) -> ApiResult<Json<Value>> {
    require_admin(&u)?;
    let text = if b.thanks { THANKS.to_string() } else { b.text };
    let reaches = s.db(move |conn| set_reply(conn, id, &text)).await?;
    Ok(Json(json!({ "ok": true, "reaches_sender": reaches })))
}
/// The reader's own messages that have an answer, newest first; `unseen` is how many answers they have not been shown.
async fn mine(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Value>> {
    Ok(Json(s.db(move |conn| {
        let mut st = conn.prepare_cached("SELECT id, message, created_at, reply, replied_at, reply_seen_at FROM feedback WHERE user_id=?1 AND reply IS NOT NULL ORDER BY replied_at DESC LIMIT 50")?;
        let v: Vec<Value> = st.query_map(params![u.id], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "message": r.get::<_, String>(1)?, "created_at": r.get::<_, String>(2)?, "reply": r.get::<_, String>(3)?, "replied_at": r.get::<_, Option<String>>(4)?, "seen": r.get::<_, Option<String>>(5)?.is_some() })))?.collect::<Result<_, _>>()?;
        let unseen = v.iter().filter(|r| r["seen"] == json!(false)).count();
        Ok(json!({ "replies": v, "unseen": unseen }))
    }).await?))
}
/// The reader has been shown their answers.
async fn mine_seen(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Value>> {
    s.db(move |conn| { conn.execute("UPDATE feedback SET reply_seen_at=?1 WHERE user_id=?2 AND reply IS NOT NULL AND reply_seen_at IS NULL", params![crate::db::now_iso(), u.id])?; Ok(()) }).await?;
    Ok(Json(json!({ "ok": true })))
}
/// `berean feedback`: the inbox, newest first.
pub fn report(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    let mut st = conn.prepare("SELECT f.id, substr(f.created_at,1,16), coalesce('@'||u.handle, f.email, 'anonymous'), coalesce(f.app_version,''), f.reply IS NOT NULL, replace(substr(f.message,1,110), char(10), ' '), f.diagnostics IS NOT NULL FROM feedback f LEFT JOIN users u ON u.id=f.user_id ORDER BY f.id DESC LIMIT 200")?;
    for row in st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, bool>(4)?, r.get::<_, String>(5)?, r.get::<_, bool>(6)?)))? {
        let (id, at, who, ver, answered, msg, log) = row?;
        println!("{id:>4}  {at}  {who:<22} {ver:<12} {} {}  {msg}", if answered { "answered" } else { "        " }, if log { "log" } else { "   " });
    }
    Ok(())
}
/// `berean feedback-show <message number>`: one message whole, with the read-aloud log its sender added.
pub fn show(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<bool> {
    let row = conn.query_row("SELECT f.created_at, coalesce('@'||u.handle, f.email, 'anonymous'), coalesce(f.app_version,''), coalesce(f.platform,''), f.message, f.diagnostics FROM feedback f LEFT JOIN users u ON u.id=f.user_id WHERE f.id=?1", params![id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, Option<String>>(5)?))).optional()?;
    let Some((at, who, ver, platform, message, diagnostics)) = row else { return Ok(false) };
    println!("#{id}  {at}  {who}  {ver} {platform}\n\n{message}");
    if let Some(d) = diagnostics { println!("\n{d}"); }
    Ok(true)
}
/// `berean feedback-thank <handle | message number>`: the standard thank-you on every message of that reader not yet
/// answered, or on the one message of that number (as `berean feedback` lists them) if it has an account behind it.
pub fn thank(conn: &rusqlite::Connection, who: &str) -> rusqlite::Result<usize> {
    let ids: Vec<i64> = match who.trim_start_matches('#').parse::<i64>() {
        Ok(id) => conn.prepare("SELECT id FROM feedback WHERE id=?1 AND user_id IS NOT NULL AND reply IS NULL")?.query_map(params![id], |r| r.get(0))?.collect::<Result<_, _>>()?,
        Err(_) => conn.prepare("SELECT f.id FROM feedback f JOIN users u ON u.id=f.user_id WHERE u.handle=?1 COLLATE NOCASE AND f.reply IS NULL")?.query_map(params![who.trim_start_matches('@')], |r| r.get(0))?.collect::<Result<_, _>>()?,
    };
    for id in &ids { conn.execute("UPDATE feedback SET reply=?1, replied_at=?2, reply_seen_at=NULL WHERE id=?3", params![THANKS, crate::db::now_iso(), id])?; }
    Ok(ids.len())
}
async fn admin_delete(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    require_admin(&u)?;
    s.db(move |conn| { conn.execute("DELETE FROM feedback WHERE id=?1", params![id])?; Ok(()) }).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize, Default)] struct RenameIn { #[serde(default)] display_name: Option<String> }
/// The admin takes an account's name away: the handle becomes reader<id> and the display name "Reader" (or the one
/// given), and the reader's app asks them for a new display name and handle before anything else (auth::User
/// must_rename, cleared by PATCH /me with a handle). Not on another admin.
pub fn force_rename(conn: &rusqlite::Connection, id: i64, display: Option<&str>) -> ApiResult<Value> {
    let display = display.map(str::trim).filter(|d| !d.is_empty()).unwrap_or("Reader");
    if display.chars().count() > 60 { return Err(ApiError::bad("display_name: 1-60 characters")); }
    let Some(admin): Option<i64> = conn.query_row("SELECT is_admin FROM users WHERE id=?1", params![id], |r| r.get(0)).optional()? else { return Err(ApiError::not_found("no such user")) };
    if admin == 1 { return Err(ApiError::bad("an admin's name is their own")); }
    let handle = format!("reader{id}");
    conn.execute("UPDATE users SET handle=?1, display_name=?2, must_rename=1 WHERE id=?3", params![handle, display, id])?;
    Ok(json!({ "id": id, "handle": handle, "display_name": display }))
}
async fn admin_rename(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>, Json(b): Json<RenameIn>) -> ApiResult<Json<Value>> {
    require_admin(&u)?;
    Ok(Json(s.db(move |conn| force_rename(conn, id, b.display_name.as_deref())).await?))
}

#[derive(Deserialize)] struct UserPatch { supporter: Option<bool> }
/// Admin edits to an account. `supporter` grants (or takes back) the secret Supporter badge at once.
async fn admin_user_patch(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>, Json(b): Json<UserPatch>) -> ApiResult<Json<Value>> {
    require_admin(&u)?;
    if id <= 0 { return Err(ApiError::not_found("no such user")); }
    Ok(Json(s.db(move |conn| {
        let Some(handle): Option<String> = conn.query_row("SELECT handle FROM users WHERE id=?1", params![id], |r| r.get(0)).optional()? else { return Err(ApiError::not_found("no such user")) };
        if let Some(on) = b.supporter {
            conn.execute("UPDATE users SET supporter=?1 WHERE id=?2", params![on as i64, id])?;
            if on { check_badges(conn, id)?; } else { conn.execute("DELETE FROM badges WHERE user_id=?1 AND code='supporter'", params![id])?; }
        }
        let supporter: i64 = conn.query_row("SELECT supporter FROM users WHERE id=?1", params![id], |r| r.get(0))?;
        Ok(json!({ "id": id, "handle": handle, "supporter": supporter == 1 }))
    }).await?))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/feedback", post(submit))
        .route("/admin/feedback", get(admin_list))
        .route("/admin/feedback/{id}", axum::routing::delete(admin_delete))
        .route("/admin/feedback/{id}/reply", post(admin_reply))
        .route("/feedback/mine", get(mine))
        .route("/feedback/mine/seen", post(mine_seen))
        .route("/admin/users/{id}", patch(admin_user_patch))
        .route("/admin/users/{id}/rename", post(admin_rename))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    fn app() -> (Router, crate::db::DbPool) {
        let path = std::env::temp_dir().join(format!("berean-test-{}.db", crate::auth::random_token(6)));
        let pool = crate::db::open_pool(path.to_str().unwrap(), None).unwrap();
        let state = AppState { pool: pool.clone(), ministry: None, edition: std::sync::Arc::new(crate::edition::Cache::new(std::time::Duration::ZERO)), net: std::sync::Arc::new(crate::testkit::Offline) };
        (crate::routes::router().with_state(state), pool)
    }
    /// A user with a session; returns (id, token).
    fn user(pool: &crate::db::DbPool, handle: &str, admin: bool) -> (i64, String) {
        let c = pool.get().unwrap();
        c.execute("INSERT INTO users (handle, display_name, password_hash, is_admin) VALUES (?1, ?1, 'x', ?2)", params![handle, admin as i64]).unwrap();
        let id = c.last_insert_rowid();
        (id, crate::auth::create_session(&c, id).unwrap().0)
    }
    async fn call(app: &Router, method: &str, uri: &str, token: Option<&str>, addr: &str, body: Value) -> (u16, Value) {
        let mut req = Request::builder().method(method).uri(uri).header("content-type", "application/json").header("x-forwarded-for", addr);
        if let Some(t) = token { req = req.header("authorization", format!("Bearer {t}")); }
        let res = app.clone().oneshot(req.body(Body::from(body.to_string())).unwrap()).await.unwrap();
        let status = res.status().as_u16();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    #[tokio::test]
    async fn signed_out_feedback_reaches_the_admin_list_only() {
        let (app, pool) = app();
        let (_, admin) = user(&pool, "admin", true);
        let (_, reader) = user(&pool, "reader", false);
        let (st, v) = call(&app, "POST", "/feedback", None, "203.0.113.1", json!({ "message": "  The footnotes are lovely.  ", "email": "a@example.org", "app_version": "1.0.0 (25)", "platform": "web" })).await;
        assert_eq!(st, 200, "{v}");
        let (st, _) = call(&app, "GET", "/admin/feedback", Some(&reader), "203.0.113.1", Value::Null).await;
        assert_eq!(st, 403);
        let (st, _) = call(&app, "GET", "/admin/feedback", None, "203.0.113.1", Value::Null).await;
        assert_eq!(st, 401);
        let (st, list) = call(&app, "GET", "/admin/feedback", Some(&admin), "203.0.113.1", Value::Null).await;
        assert_eq!(st, 200);
        assert_eq!(list[0]["message"], "The footnotes are lovely.");
        assert_eq!(list[0]["email"], "a@example.org");
        assert_eq!(list[0]["platform"], "web");
        assert!(list[0]["user"].is_null());
        let (st, _) = call(&app, "DELETE", &format!("/admin/feedback/{}", list[0]["id"]), Some(&admin), "203.0.113.1", Value::Null).await;
        assert_eq!(st, 200);
        let (_, list) = call(&app, "GET", "/admin/feedback", Some(&admin), "203.0.113.1", Value::Null).await;
        assert_eq!(list.as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn a_read_aloud_log_rides_with_the_message_and_is_cut_not_refused() {
        let (app, pool) = app();
        let (_, admin) = user(&pool, "admin", true);
        let log = format!("Read-aloud log\n{}", "10-18 21:40:12 still Psalm 118:12\n".repeat(1000));
        let (st, v) = call(&app, "POST", "/feedback", None, "203.0.113.6", json!({ "message": "The voice stopped on the drive", "diagnostics": log })).await;
        assert_eq!(st, 200, "{v}");
        call(&app, "POST", "/feedback", None, "203.0.113.6", json!({ "message": "No log with this one", "diagnostics": "   " })).await;
        let (_, list) = call(&app, "GET", "/admin/feedback", Some(&admin), "203.0.113.6", Value::Null).await;
        assert!(list[0]["diagnostics"].is_null());
        let kept = list[1]["diagnostics"].as_str().unwrap();
        assert_eq!(kept.chars().count(), DIAGNOSTICS_MAX);
        assert!(kept.starts_with("Read-aloud log\n"));
        assert!(show(&pool.get().unwrap(), list[1]["id"].as_i64().unwrap()).unwrap());
        assert!(!show(&pool.get().unwrap(), 9999).unwrap());
    }

    #[tokio::test]
    async fn a_reply_reaches_its_sender_once_and_only_them() {
        let (app, pool) = app();
        let (_, admin) = user(&pool, "admin", true);
        let (_, reader) = user(&pool, "reader", false);
        let (_, other) = user(&pool, "other", false);
        let (_, a) = call(&app, "POST", "/feedback", Some(&reader), "203.0.113.2", json!({ "message": "Josa-phat has a hyphen" })).await;
        let (_, b) = call(&app, "POST", "/feedback", None, "203.0.113.9", json!({ "message": "No account here", "email": "a@b.example" })).await;
        let (id, anon) = (a["id"].as_i64().unwrap(), b["id"].as_i64().unwrap());
        assert_eq!(call(&app, "POST", &format!("/admin/feedback/{id}/reply"), Some(&reader), "203.0.113.2", json!({ "thanks": true })).await.0, 403, "only the admin answers");
        assert_eq!(call(&app, "POST", &format!("/admin/feedback/{id}/reply"), Some(&admin), "203.0.113.2", json!({ "text": "  " })).await.0, 400);
        let (st, r) = call(&app, "POST", &format!("/admin/feedback/{id}/reply"), Some(&admin), "203.0.113.2", json!({ "thanks": true })).await;
        assert_eq!((st, r["reaches_sender"].as_bool()), (200, Some(true)));
        let (_, r) = call(&app, "POST", &format!("/admin/feedback/{anon}/reply"), Some(&admin), "203.0.113.2", json!({ "text": "Thanks" })).await;
        assert_eq!(r["reaches_sender"].as_bool(), Some(false), "no account, no inbox");
        let (_, mine) = call(&app, "GET", "/feedback/mine", Some(&reader), "203.0.113.2", Value::Null).await;
        assert_eq!((mine["unseen"].as_i64(), mine["replies"][0]["reply"].as_str(), mine["replies"][0]["message"].as_str()), (Some(1), Some(THANKS), Some("Josa-phat has a hyphen")));
        let (_, theirs) = call(&app, "GET", "/feedback/mine", Some(&other), "203.0.113.2", Value::Null).await;
        assert_eq!((theirs["unseen"].as_i64(), theirs["replies"].as_array().map(Vec::len)), (Some(0), Some(0)));
        call(&app, "POST", "/feedback/mine/seen", Some(&reader), "203.0.113.2", Value::Null).await;
        let (_, mine) = call(&app, "GET", "/feedback/mine", Some(&reader), "203.0.113.2", Value::Null).await;
        assert_eq!((mine["unseen"].as_i64(), mine["replies"][0]["seen"].as_bool()), (Some(0), Some(true)));
        let (_, list) = call(&app, "GET", "/admin/feedback", Some(&admin), "203.0.113.2", Value::Null).await;
        assert_eq!((list[1]["reply"].as_str(), list[1]["reply_seen"].as_bool()), (Some(THANKS), Some(true)));
        // the command line thanks what is not yet answered, by handle
        let c = pool.get().unwrap();
        call(&app, "POST", "/feedback", Some(&reader), "203.0.113.3", json!({ "message": "And the dot" })).await;
        assert_eq!(thank(&c, "@Reader").unwrap(), 1);
        assert_eq!(thank(&c, "reader").unwrap(), 0);
        // or one message by its number; a message with no account behind it cannot be answered this way
        // (written straight in: the sender limit is one table for every test in the process)
        c.execute("INSERT INTO feedback (user_id, message) SELECT user_id, 'A third' FROM feedback WHERE id=?1", params![id]).unwrap();
        let third = c.last_insert_rowid();
        assert_eq!((thank(&c, &format!("#{third}")).unwrap(), thank(&c, &third.to_string()).unwrap(), thank(&c, &anon.to_string()).unwrap()), (1, 0, 0));
    }

    #[tokio::test]
    async fn a_forced_rename_takes_the_name_and_the_reader_must_choose_another() {
        let (app, pool) = app();
        let (_, admin) = user(&pool, "admin", true);
        let (id, troll) = user(&pool, "troll", false);
        let (_, other) = user(&pool, "other", false);
        assert_eq!(call(&app, "POST", &format!("/admin/users/{id}/rename"), Some(&other), "203.0.113.2", json!({})).await.0, 403);
        assert_eq!(call(&app, "PATCH", "/me", Some(&troll), "203.0.113.2", json!({ "handle": "newname" })).await.0, 400, "no handle change unasked");
        let (st, r) = call(&app, "POST", &format!("/admin/users/{id}/rename"), Some(&admin), "203.0.113.2", json!({})).await;
        assert_eq!((st, r["handle"].as_str().map(String::from)), (200, Some(format!("reader{id}"))));
        let (_, me) = call(&app, "GET", "/me", Some(&troll), "203.0.113.2", Value::Null).await;
        assert_eq!((me["user"]["must_rename"].as_bool(), me["user"]["display_name"].as_str()), (Some(true), Some("Reader")), "still signed in, asked to rename");
        for (h, why) in [("other", "taken"), (&format!("reader{id}") as &str, "the placeholder"), ("x", "too short")] {
            assert_eq!(call(&app, "PATCH", "/me", Some(&troll), "203.0.113.2", json!({ "handle": h, "display_name": "T" })).await.0, 400, "{why}");
        }
        assert_eq!(call(&app, "PATCH", "/me", Some(&troll), "203.0.113.2", json!({ "handle": "@Fresh_Start", "display_name": "Fresh" })).await.0, 200);
        let (_, me) = call(&app, "GET", "/me", Some(&troll), "203.0.113.2", Value::Null).await;
        assert_eq!((me["user"]["handle"].as_str(), me["user"]["display_name"].as_str(), me["user"]["must_rename"].as_bool()), (Some("fresh_start"), Some("Fresh"), Some(false)));
        let (_, admin_id) = (0, pool.get().unwrap().query_row("SELECT id FROM users WHERE handle='admin'", [], |r| r.get::<_, i64>(0)).unwrap());
        assert_eq!(call(&app, "POST", &format!("/admin/users/{admin_id}/rename"), Some(&admin), "203.0.113.2", json!({})).await.0, 400, "not on an admin");
    }

    #[tokio::test]
    async fn signed_in_feedback_names_the_sender() {
        let (app, pool) = app();
        let (_, admin) = user(&pool, "admin", true);
        let (id, reader) = user(&pool, "reader", false);
        let (st, _) = call(&app, "POST", "/feedback", Some(&reader), "203.0.113.2", json!({ "message": "Dark theme please" })).await;
        assert_eq!(st, 200);
        let (_, list) = call(&app, "GET", "/admin/feedback", Some(&admin), "203.0.113.2", Value::Null).await;
        assert_eq!(list[0]["user"]["id"], id);
        assert_eq!(list[0]["user"]["handle"], "reader");
        assert!(list[0]["email"].is_null());
    }

    #[tokio::test]
    async fn rejects_empty_long_and_malformed() {
        let (app, _) = app();
        let a = "203.0.113.3";
        assert_eq!(call(&app, "POST", "/feedback", None, a, json!({ "message": "   " })).await.0, 400);
        assert_eq!(call(&app, "POST", "/feedback", None, a, json!({ "message": "x".repeat(MESSAGE_MAX + 1) })).await.0, 400);
        assert_eq!(call(&app, "POST", "/feedback", None, a, json!({ "message": "hi", "email": "not an email" })).await.0, 400);
        assert_eq!(call(&app, "POST", "/feedback", None, a, json!({ "message": "hi", "email": "a@b" })).await.0, 400);
        assert_eq!(call(&app, "POST", "/feedback", None, a, json!({ "message": "x".repeat(MESSAGE_MAX), "email": "" })).await.0, 200);
    }

    #[tokio::test]
    async fn limits_each_sender() {
        let (app, _) = app();
        for _ in 0..PER_SENDER { assert_eq!(call(&app, "POST", "/feedback", None, "203.0.113.4", json!({ "message": "hello" })).await.0, 200); }
        let (st, v) = call(&app, "POST", "/feedback", None, "203.0.113.4", json!({ "message": "hello" })).await;
        assert_eq!(st, 429, "{v}");
        // someone else is not held up by it
        assert_eq!(call(&app, "POST", "/feedback", None, "203.0.113.5", json!({ "message": "hello" })).await.0, 200);
    }

    #[tokio::test]
    async fn supporter_badge_is_secret_until_granted() {
        let (app, pool) = app();
        let (_, admin) = user(&pool, "admin", true);
        let (id, reader) = user(&pool, "reader", false);
        let codes = |v: &Value| v["badges"].as_array().unwrap().iter().map(|b| b["code"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        let (_, stats) = call(&app, "GET", "/stats", Some(&reader), "203.0.113.6", Value::Null).await;
        assert!(!codes(&stats).contains(&"supporter".to_string()), "a locked secret badge is not listed");
        assert!(codes(&stats).contains(&"streak_3".to_string()), "ordinary locked badges still are");
        assert_eq!(call(&app, "PATCH", &format!("/admin/users/{id}"), Some(&reader), "203.0.113.6", json!({ "supporter": true })).await.0, 403);
        let (st, v) = call(&app, "PATCH", &format!("/admin/users/{id}"), Some(&admin), "203.0.113.6", json!({ "supporter": true })).await;
        assert_eq!((st, v["supporter"].as_bool()), (200, Some(true)));
        let (_, stats) = call(&app, "GET", "/stats", Some(&reader), "203.0.113.6", Value::Null).await;
        let badge = stats["badges"].as_array().unwrap().iter().find(|b| b["code"] == "supporter").cloned().unwrap();
        assert!(badge["earned_at"].is_string());
        // other people see it on the (opened) profile only once earned, and never see the flag itself
        call(&app, "PATCH", "/me", Some(&reader), "203.0.113.6", json!({ "settings": { "public_profile": true } })).await;
        let (_, profile) = call(&app, "GET", "/users/reader", None, "203.0.113.6", Value::Null).await;
        assert!(codes(&profile).contains(&"supporter".to_string()));
        assert!(profile["user"].get("supporter").is_none());
        let (_, profile) = call(&app, "GET", "/users/reader", Some(&admin), "203.0.113.6", Value::Null).await;
        assert_eq!(profile["user"]["supporter"], true);
        // taking it back removes the badge
        call(&app, "PATCH", &format!("/admin/users/{id}"), Some(&admin), "203.0.113.6", json!({ "supporter": false })).await;
        let (_, stats) = call(&app, "GET", "/stats", Some(&reader), "203.0.113.6", Value::Null).await;
        assert!(!codes(&stats).contains(&"supporter".to_string()));
        assert_eq!(call(&app, "PATCH", "/admin/users/9999", Some(&admin), "203.0.113.6", json!({ "supporter": true })).await.0, 404);
    }

    #[test]
    fn email_shapes() {
        assert_eq!(clean_email(None).unwrap(), None);
        assert_eq!(clean_email(Some("  ")).unwrap(), None);
        assert_eq!(clean_email(Some(" a.b@mail.example.org ")).unwrap().as_deref(), Some("a.b@mail.example.org"));
        for bad in ["a@b", "@b.org", "a b@c.org", "a@.org", "a@org."] { assert!(clean_email(Some(bad)).is_err(), "{bad}"); }
    }
}
