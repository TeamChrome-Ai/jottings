//! "Continue with Google": the client obtains an OpenID Connect ID token (Google Identity Services on
//! the web, expo-auth-session on mobile) and posts it here; we verify the RS256 signature against
//! Google's published JWKS, the issuer, the audience (our client ids) and expiry, then create or
//! link the local user. No email round-trips, no password resets.
use crate::auth::{create_session, get_user, random_token, User};
use crate::db::now_iso;
use crate::error::ApiError;
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use once_cell::sync::Lazy;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const JWKS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";
static JWKS: Lazy<Mutex<Option<(JwkSet, Instant)>>> = Lazy::new(|| Mutex::new(None));

#[derive(Deserialize)]
pub struct GoogleClaims { pub sub: String, pub email: Option<String>, pub email_verified: Option<bool>, pub name: Option<String>, pub picture: Option<String> }

/// Comma-separated list of accepted OAuth client ids (web, iOS, Android) from BEREAN_GOOGLE_CLIENT_IDS.
pub fn client_ids() -> Vec<String> {
    std::env::var("BEREAN_GOOGLE_CLIENT_IDS").ok().map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()).unwrap_or_default()
}

async fn jwks() -> Result<JwkSet, ApiError> {
    if let Some((set, at)) = JWKS.lock().unwrap().as_ref() { if at.elapsed() < Duration::from_secs(6 * 3600) { return Ok(set.clone()); } }
    let set: JwkSet = reqwest::Client::new().get(JWKS_URL).timeout(Duration::from_secs(8)).send().await.map_err(|_| ApiError::new(502, "could not reach Google"))?
        .json().await.map_err(|_| ApiError::new(502, "bad JWKS from Google"))?;
    *JWKS.lock().unwrap() = Some((set.clone(), Instant::now()));
    Ok(set)
}

pub async fn verify(id_token: &str) -> Result<GoogleClaims, ApiError> {
    let auds = client_ids();
    if auds.is_empty() { return Err(ApiError::new(503, "Google sign-in is not configured on this server")); }
    let header = decode_header(id_token).map_err(|_| ApiError::new(401, "bad token"))?;
    let kid = header.kid.ok_or_else(|| ApiError::new(401, "bad token"))?;
    let mut set = jwks().await?;
    if set.find(&kid).is_none() { *JWKS.lock().unwrap() = None; set = jwks().await?; } // key rotation
    let jwk = set.find(&kid).ok_or_else(|| ApiError::new(401, "unknown signing key"))?;
    let key = DecodingKey::from_jwk(jwk).map_err(|_| ApiError::new(401, "bad key"))?;
    let mut v = Validation::new(Algorithm::RS256);
    v.set_audience(&auds);
    v.set_issuer(&["https://accounts.google.com", "accounts.google.com"]);
    let data = decode::<GoogleClaims>(id_token, &key, &v).map_err(|e| { tracing::warn!("google token rejected: {e}"); ApiError::new(401, "token rejected") })?;
    Ok(data.claims)
}

/// Find the user linked to this Google subject; otherwise link by verified email to an existing account
/// or create a fresh one. Returns (user, created).
pub fn upsert_user(conn: &Connection, c: &GoogleClaims, seen: &crate::bans::Seen) -> Result<(User, bool), ApiError> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS oauth_identities (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, email TEXT, created_at TEXT NOT NULL, PRIMARY KEY (provider, subject));")?;
    let email = c.email.as_deref().filter(|_| c.email_verified.unwrap_or(false));
    // BEREAN_ADMIN_EMAILS: a verified Google email on this list is the site admin, whatever account it lands on
    let admin_email = email.map(|e| admin_emails().iter().any(|a| a.eq_ignore_ascii_case(e))).unwrap_or(false);
    if let Some(uid) = conn.query_row("SELECT user_id FROM oauth_identities WHERE provider='google' AND subject=?1", params![c.sub], |r| r.get::<_, i64>(0)).optional()? {
        if admin_email { conn.execute("UPDATE users SET is_admin=1 WHERE id=?1", params![uid])?; }
        return Ok((get_user(conn, uid)?.ok_or_else(|| ApiError::internal("orphan identity"))?, false));
    }
    // a display name from Google, a handle derived from the email local part (or a random one), made unique
    let base = email.and_then(|e| e.split('@').next()).map(|s| s.to_lowercase().chars().filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_').take(20).collect::<String>()).filter(|s| s.len() >= 3 && crate::scan::name_ok(s)).unwrap_or_else(|| format!("reader_{}", random_token(6).to_lowercase()));
    let mut handle = base.clone();
    let mut n = 1;
    while conn.query_row("SELECT 1 FROM users WHERE handle=?1", params![handle], |_| Ok(())).optional()?.is_some() { n += 1; handle = format!("{base}{n}"); }
    // a Google name that is itself an attack (scan::name_ok) is not carried over
    let display = c.name.clone().filter(|n| crate::scan::name_ok(n)).unwrap_or_else(|| handle.clone());
    // not a banned person's Google account, email, network or device (bans.rs)
    let mut ids = vec![("google", crate::bans::hash("google", &c.sub))];
    if let Some(e) = email { ids.push(("email", crate::bans::hash("email", e))); }
    crate::bans::check_signup(conn, seen, &ids)?;
    let first: i64 = conn.query_row("SELECT count(*) FROM users WHERE is_admin=1", [], |r| r.get(0))?;
    // no usable password: a random argon2-shaped sentinel that can never verify
    conn.execute("INSERT INTO users (handle, display_name, password_hash, is_admin) VALUES (?1, ?2, ?3, ?4)", params![handle, display, format!("google:{}", random_token(32)), (first == 0 || admin_email) as i64])?;
    let uid = conn.last_insert_rowid();
    conn.execute("INSERT INTO oauth_identities (provider, subject, user_id, email, created_at) VALUES ('google', ?1, ?2, ?3, ?4)", params![c.sub, uid, email, now_iso()])?;
    Ok((get_user(conn, uid)?.unwrap(), true))
}

#[derive(Deserialize)]
pub struct GoogleIn { pub id_token: String }

pub async fn handler(axum::extract::State(s): axum::extract::State<crate::AppState>, seen: crate::bans::Seen, jar: axum_extra::extract::CookieJar, axum::Json(b): axum::Json<GoogleIn>) -> Result<(axum_extra::extract::CookieJar, axum::Json<serde_json::Value>), ApiError> {
    let claims = verify(&b.id_token).await?;
    let conn = s.pool.get()?;
    let (user, created) = upsert_user(&conn, &claims, &seen)?;
    // a suspended account gets a plain answer, not a session the server then ignores (auth: sessions need disabled=0)
    if conn.query_row("SELECT disabled FROM users WHERE id=?1", params![user.id], |r| r.get::<_, i64>(0))? == 1 { return Err(ApiError::forbidden("this account has been suspended")); }
    let (token, cookie) = create_session(&conn, user.id)?;
    // this Google account or email on a banned person is evasion too
    let mut ids = vec![("google", crate::bans::hash("google", &claims.sub))];
    if let Some(e) = claims.email.as_deref().filter(|_| claims.email_verified.unwrap_or(false)) { ids.push(("email", crate::bans::hash("email", e))); }
    if !crate::bans::touch(&conn, user.id, &token, &seen)? || !crate::bans::evasion(&conn, user.id, &ids)? { return Err(ApiError::forbidden("this account has been suspended")); }
    Ok((jar.add(cookie), axum::Json(serde_json::json!({ "user": user, "token": token, "created": created }))))
}

fn admin_emails() -> Vec<String> {
    std::env::var("BEREAN_ADMIN_EMAILS").ok().map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()).unwrap_or_default()
}
pub async fn config(headers: axum::http::HeaderMap) -> axum::Json<serde_json::Value> {
    let ids = client_ids();
    // Only the web client takes its id from here. The native apps carry their own ids in app.json, and a native
    // build without one must not be told Google is on: mounting the provider hook with only a web id throws on
    // Android (builds 21 to 23 crashed on the login screen the moment the server advertised it).
    let native = headers.get(axum::http::header::USER_AGENT).and_then(|v| v.to_str().ok()).map(|ua| ua.starts_with("okhttp") || ua.contains("Expo") || ua.contains("Dalvik")).unwrap_or(false);
    if native { return axum::Json(serde_json::json!({ "google_client_id": serde_json::Value::Null, "google_enabled": false })); }
    axum::Json(serde_json::json!({ "google_client_id": ids.first(), "google_enabled": !ids.is_empty() }))
}
