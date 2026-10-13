//! Sessions (cookie or Bearer), argon2id passwords.
use crate::db::{now_iso, DbPool};
use crate::error::ApiError;
use argon2::{password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString}, Argon2};
use axum::{extract::FromRequestParts, http::request::Parts};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use rand::{distributions::Alphanumeric, Rng};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

pub const COOKIE: &str = "berean_session";
const SESSION_DAYS: i64 = 90;

#[derive(Serialize, Clone, Debug)]
pub struct User { pub id: i64, pub handle: String, pub display_name: String, pub is_admin: i64, pub created_at: String, pub settings: Value,
    /// The preset picture shown (theirs or the default for the id), and whether they chose it (avatars.rs).
    pub avatar: String, pub avatar_chosen: bool,
    /// The admin took the name away: the app asks for a new display name and handle before anything else.
    pub must_rename: bool }

/// A site admin with Admin mode on (Settings → Admin, `settings.admin_mode`): the Developer badge shows by their name and
/// every group opens to them as to its own admins (groups.rs `require_member`). Off, they are an ordinary reader.
pub fn admin_mode(u: &User) -> bool { u.is_admin == 1 && u.settings.get("admin_mode").and_then(Value::as_bool) == Some(true) }
/// `admin_mode` for a users row aliased `u`, for the queries that list people (the badge).
pub const ADMIN_MODE_SQL: &str = "(u.is_admin=1 AND coalesce(json_extract(u.settings,'$.admin_mode'),0)=1)";

pub fn get_user(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<Option<User>> {
    conn.query_row("SELECT id, handle, display_name, is_admin, created_at, settings, avatar, must_rename FROM users WHERE id=?1", params![id], row_user).optional()
}
fn row_user(r: &rusqlite::Row) -> rusqlite::Result<User> {
    let s: String = r.get(5)?;
    let id: i64 = r.get(0)?;
    let chosen: Option<String> = r.get(6)?;
    Ok(User { id, handle: r.get(1)?, display_name: r.get(2)?, is_admin: r.get(3)?, created_at: r.get(4)?, settings: serde_json::from_str(&s).unwrap_or(Value::Object(Default::default())),
        avatar: crate::avatars::effective(id, chosen.as_deref()), avatar_chosen: chosen.as_deref().is_some_and(crate::avatars::is_id), must_rename: r.get::<_, i64>(7)? != 0 })
}

pub fn user_by_token(conn: &rusqlite::Connection, token: &str) -> rusqlite::Result<Option<User>> {
    conn.prepare_cached("SELECT u.id, u.handle, u.display_name, u.is_admin, u.created_at, u.settings, u.avatar, u.must_rename FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?1 AND s.expires_at > ?2 AND u.disabled=0")?
        .query_row(params![token, now_iso()], row_user).optional()
}

pub fn random_token(n: usize) -> String { rand::thread_rng().sample_iter(&Alphanumeric).take(n).map(char::from).collect() }

pub fn create_session(conn: &rusqlite::Connection, user_id: i64) -> rusqlite::Result<(String, Cookie<'static>)> {
    let token = random_token(32);
    let exp = time::OffsetDateTime::now_utc() + time::Duration::days(SESSION_DAYS);
    conn.execute("INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)", params![token, user_id, exp.format(&time::format_description::well_known::Rfc3339).unwrap()])?;
    let mut c = Cookie::new(COOKIE, token.clone());
    c.set_http_only(true); c.set_same_site(SameSite::Lax); c.set_path("/"); c.set_expires(exp);
    c.set_secure(std::env::var("BEREAN_INSECURE_COOKIE").is_err() && std::env::var("BEREAN_PROD").is_ok());
    Ok((token, c))
}

/// A handle as stored: lowercase, 3-24 letters, digits or _.
pub fn clean_handle(handle: &str) -> Result<String, ApiError> {
    let handle = handle.trim().trim_start_matches('@').to_lowercase();
    if handle.len() < 3 || handle.len() > 24 || !handle.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
        return Err(ApiError::bad("handle: 3-24 letters, digits or _"));
    }
    Ok(handle)
}

pub fn register(conn: &rusqlite::Connection, handle: &str, display_name: &str, password: &str) -> Result<User, ApiError> {
    let handle = clean_handle(handle)?;
    if password.chars().count() < 8 { return Err(ApiError::bad("password: at least 8 characters")); }
    let display = { let d = display_name.trim(); if d.is_empty() { handle.clone() } else { d.to_string() } };
    if !crate::scan::name_ok(&handle) || !crate::scan::name_ok(&display) { return Err(ApiError::bad("that name is not allowed; please choose another")); }
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default().hash_password(password.as_bytes(), &salt).map_err(|_| ApiError::internal("hash"))?.to_string();
    // the first account created while no admin exists becomes the site admin (survives a deleted first account)
    let admins: i64 = conn.query_row("SELECT count(*) FROM users WHERE is_admin=1", [], |r| r.get(0))?;
    match conn.execute("INSERT INTO users (handle, display_name, password_hash, is_admin) VALUES (?1, ?2, ?3, ?4)", params![handle, display, hash, (admins == 0) as i64]) {
        Ok(_) => Ok(get_user(conn, conn.last_insert_rowid())?.unwrap()),
        Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == rusqlite::ErrorCode::ConstraintViolation => Err(ApiError::new(409, "that handle is taken")),
        Err(e) => Err(e.into()),
    }
}

pub fn login(conn: &rusqlite::Connection, handle: &str, password: &str) -> Result<User, ApiError> {
    let row: Option<(i64, String)> = conn.query_row("SELECT id, password_hash FROM users WHERE handle=?1 AND disabled=0", params![handle.trim().to_lowercase()], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    let Some((id, hash)) = row else { return Err(ApiError::new(401, "wrong handle or password")) };
    // a hash the verifier cannot parse (e.g. from another implementation) is simply a failed login
    let Ok(parsed) = PasswordHash::new(&hash) else { return Err(ApiError::new(401, "wrong handle or password")) };
    if Argon2::default().verify_password(password.as_bytes(), &parsed).is_err() { return Err(ApiError::new(401, "wrong handle or password")); }
    Ok(get_user(conn, id)?.unwrap())
}

/// Extractor: the current user if the request carries a valid session (cookie or Bearer).
#[derive(Clone)]
pub struct MaybeUser(pub Option<User>);
/// Extractor: 401 unless signed in.
pub struct AuthUser(pub User);

fn token_from_parts(parts: &Parts) -> Option<String> {
    if let Some(h) = parts.headers.get(http::header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        if let Some(t) = h.strip_prefix("Bearer ") { return Some(t.to_string()); }
    }
    let jar = CookieJar::from_headers(&parts.headers);
    jar.get(COOKIE).map(|c| c.value().to_string())
}

impl FromRequestParts<crate::AppState> for MaybeUser {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &crate::AppState) -> Result<Self, Self::Rejection> {
        let Some(token) = token_from_parts(parts) else { return Ok(MaybeUser(None)) };
        let pool: DbPool = state.pool.clone();
        let seen = crate::bans::Seen::of(parts);
        tokio::task::spawn_blocking(move || {
            let conn = pool.get().map_err(|_| ApiError::internal("db"))?;
            let Some(u) = user_by_token(&conn, &token)? else { return Ok(MaybeUser(None)) };
            // where the account is seen, checked against the bans (bans.rs); an evader is signed out here
            if !crate::bans::touch(&conn, u.id, &token, &seen)? { return Ok(MaybeUser(None)); }
            Ok(MaybeUser(Some(u)))
        }).await.map_err(|_| ApiError::internal("server error"))?
    }
}
impl FromRequestParts<crate::AppState> for AuthUser {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &crate::AppState) -> Result<Self, Self::Rejection> {
        match MaybeUser::from_request_parts(parts, state).await?.0 { Some(u) => Ok(AuthUser(u)), None => Err(ApiError::new(401, "sign in required")) }
    }
}
