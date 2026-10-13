//! A ban is a nuke. `nuke` takes the person out of every place others can see them (content hidden, outlines made
//! private, profile gone, every group left, every friendship, invite, reaction and QR token ended, every session
//! signed out) and marks everything that identifies them: each IP address they used (IPv6 by its /64), each device
//! (the app's Android id / iOS vendor id / web install id, header `x-jottings-device`), their Google account and email,
//! and their own contact hashes. A marked identifier then blocks new sign-ups, and a strong one (device, Google,
//! email, contact) seen on another account nukes that account too as ban evasion. An IP alone only flags the other
//! account for the admin (a shared network is not proof), and an IP mark lapses after IP_DAYS; the rest are permanent.
//! Rows are hidden, never deleted: the evidence is kept (illegal content must be preserved) and an unban can restore.
//! Identifiers are stored as SHA-256 of "kind:value", never in the clear.
use crate::error::ApiError;
use axum::{extract::{ConnectInfo, FromRequestParts}, http::request::Parts};
use once_cell::sync::Lazy;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const IP_DAYS: i64 = 90;
/// How often one session's address and device are recorded and checked again.
const TOUCH_EVERY: Duration = Duration::from_secs(3600);
const STRONG: &[&str] = &["device", "google", "email", "contact"];

pub fn hash(kind: &str, value: &str) -> String {
    Sha256::digest(format!("{kind}:{}", value.trim().to_lowercase()).as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// IPv4 as is, IPv6 by its /64 (one household or phone rotates within it); loopback and "local" are not people.
fn ip_key(ip: &str) -> Option<String> {
    match ip.parse::<IpAddr>().ok()? {
        IpAddr::V4(v) if v.is_loopback() || v.is_unspecified() => None,
        IpAddr::V4(v) => Some(v.to_string()),
        IpAddr::V6(v) if v.is_loopback() || v.is_unspecified() => None,
        IpAddr::V6(v) => { let s = v.segments(); Some(format!("{:x}:{:x}:{:x}:{:x}::/64", s[0], s[1], s[2], s[3])) }
    }
}

/// Where a request comes from: its address (feedback::ClientAddr's rule: behind Caddy, the entry Caddy appended) and
/// the device the app says it runs on.
#[derive(Clone, Default)]
pub struct Seen { pub ip: Option<String>, pub device: Option<String> }
impl Seen {
    pub fn of(parts: &Parts) -> Seen {
        let peer = parts.extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip());
        let forwarded = || parts.headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|v| v.rsplit(',').next()).map(|v| v.trim().to_string());
        let ip = match peer { Some(ip) if !ip.is_loopback() => Some(ip.to_string()), _ => forwarded() };
        let device = parts.headers.get("x-jottings-device").and_then(|v| v.to_str().ok()).map(str::trim).filter(|d| (8..=128).contains(&d.len())).map(String::from);
        Seen { ip: ip.as_deref().and_then(ip_key), device }
    }
    fn marks(&self) -> Vec<(&'static str, String)> {
        let mut m = Vec::new();
        if let Some(ip) = &self.ip { m.push(("ip", hash("ip", ip))); }
        if let Some(d) = &self.device { m.push(("device", hash("device", d))); }
        m
    }
}
impl<S: Send + Sync> FromRequestParts<S> for Seen {
    type Rejection = std::convert::Infallible;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> { Ok(Seen::of(parts)) }
}

/// The banned account a mark belongs to, if it is marked and the mark has not lapsed.
fn banned_by(conn: &Connection, kind: &str, h: &str, except: i64) -> rusqlite::Result<Option<i64>> {
    conn.query_row("SELECT user_id FROM ban_marks WHERE kind=?1 AND hash=?2 AND user_id<>?3 AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) LIMIT 1", params![kind, h, except], |r| r.get(0)).optional()
}

/// A new account from a banned person's network, device or Google account is refused.
pub fn check_signup(conn: &Connection, seen: &Seen, extra: &[(&'static str, String)]) -> Result<(), ApiError> {
    for (kind, h) in seen.marks().iter().chain(extra.iter()) {
        if banned_by(conn, kind, h, -1)?.is_some() { return Err(ApiError::forbidden("sign-up is not available")); }
    }
    Ok(())
}

static TOUCHED: Lazy<Mutex<HashMap<String, Instant>>> = Lazy::new(Default::default);

/// Record where an account is seen and check it against the bans. Called on sign-in and, at most hourly per session,
/// on every signed-in request. Returns false when the account has just been nuked as ban evasion.
pub fn touch(conn: &Connection, uid: i64, session: &str, seen: &Seen) -> rusqlite::Result<bool> {
    let key = format!("{session}|{:?}|{:?}", seen.ip, seen.device);
    {
        let mut m = TOUCHED.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        if m.get(&key).is_some_and(|t| now.duration_since(*t) < TOUCH_EVERY) { return Ok(true); }
        if m.len() > 50_000 { m.retain(|_, t| now.duration_since(*t) < TOUCH_EVERY); }
        m.insert(key, now);
    }
    let marks = seen.marks();
    for (kind, h) in &marks { record(conn, uid, kind, h)?; }
    evasion(conn, uid, &marks)
}

pub fn record(conn: &Connection, uid: i64, kind: &str, h: &str) -> rusqlite::Result<()> {
    conn.execute("INSERT INTO user_marks (user_id, kind, hash) VALUES (?1,?2,?3) ON CONFLICT (user_id, kind, hash) DO UPDATE SET last_seen=strftime('%Y-%m-%dT%H:%M:%fZ','now')", params![uid, kind, h])?;
    Ok(())
}

/// An account carrying a banned person's strong identifier is the same person: nuked, with a report for the admin.
/// One sharing only their network is reported, not touched. Admins and accounts an admin unbanned are exempt.
pub fn evasion(conn: &Connection, uid: i64, marks: &[(&'static str, String)]) -> rusqlite::Result<bool> {
    let (admin, exempt, disabled): (i64, i64, i64) = conn.query_row("SELECT is_admin, ban_exempt, disabled FROM users WHERE id=?1", params![uid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    if admin == 1 || exempt == 1 || disabled == 1 || uid == 0 { return Ok(true); }
    for (kind, h) in marks {
        let Some(banned) = banned_by(conn, kind, h, uid)? else { continue };
        let handle: String = conn.query_row("SELECT handle FROM users WHERE id=?1", params![banned], |r| r.get(0)).unwrap_or_else(|_| "?".into());
        let open: bool = conn.query_row("SELECT count(*) > 0 FROM reports WHERE reporter_id=0 AND kind='user' AND target_id=?1 AND status IN ('pending','hidden','escalated')", params![uid], |r| r.get(0))?;
        if STRONG.contains(kind) {
            let why = format!("Ban evasion: same {kind} as banned @{handle}. Account nuked.");
            conn.execute("INSERT INTO reports (reporter_id, kind, target_id, reason, details, status, ai_verdict, ai_reason, ai_category, ai_model, author_id) VALUES (0,'user',?1,'other','automatic ban-evasion check','hidden','ban',?2,'evasion','rules',?1)", params![uid, why])?;
            nuke(conn, uid)?;
            let text = format!("{} moderation: {why}", crate::brand::get().name);
            tokio::spawn(async move { crate::moderation::webhook(&text).await });
            return Ok(false);
        }
        if !open {
            conn.execute("INSERT INTO reports (reporter_id, kind, target_id, reason, details, status, ai_verdict, ai_reason, ai_category, ai_model, author_id) VALUES (0,'user',?1,'other','automatic ban-evasion check','escalated','escalate',?2,'evasion','rules',?1)",
                params![uid, format!("Signed in from the network of banned @{handle}. A shared network is not proof; ban if it is the same person.")])?;
        }
    }
    Ok(true)
}

/// The ban. See the module comment for what it does; `unnuke` reverses what can be reversed.
pub fn nuke(conn: &Connection, uid: i64) -> rusqlite::Result<()> {
    // every identifier, marked before the rows that carry some of them go
    let mut marks: Vec<(String, String)> = {
        let mut st = conn.prepare("SELECT kind, hash FROM user_marks WHERE user_id=?1")?;
        let v = st.query_map(params![uid], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?; v
    };
    {
        let mut st = conn.prepare("SELECT subject, email FROM oauth_identities WHERE user_id=?1")?;
        let ids: Vec<(String, Option<String>)> = st.query_map(params![uid], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
        for (sub, email) in ids { marks.push(("google".into(), hash("google", &sub))); if let Some(e) = email { marks.push(("email".into(), hash("email", &e))); } }
        let mut st = conn.prepare("SELECT hash FROM contact_hashes WHERE user_id=?1")?;
        let hs: Vec<String> = st.query_map(params![uid], |r| r.get(0))?.collect::<Result<_, _>>()?;
        marks.extend(hs.into_iter().map(|h| ("contact".to_string(), h)));
    }
    for (kind, h) in &marks {
        let lapse = (kind == "ip").then(|| format!("+{IP_DAYS} days"));
        conn.execute("INSERT OR REPLACE INTO ban_marks (kind, hash, user_id, expires_at) VALUES (?1,?2,?3, CASE WHEN ?4 IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now',?4) END)", params![kind, h, uid, lapse])?;
    }
    conn.execute("UPDATE users SET disabled=1, ban_exempt=0 WHERE id=?1 AND id<>0", params![uid])?;
    conn.execute("DELETE FROM sessions WHERE user_id=?1", params![uid])?;
    conn.execute("DELETE FROM friend_tokens WHERE user_id=?1", params![uid])?;
    conn.execute("DELETE FROM contact_hashes WHERE user_id=?1", params![uid])?;
    conn.execute("UPDATE group_posts SET hidden=1 WHERE user_id=?1", params![uid])?;
    conn.execute("UPDATE outlines SET hidden=1, visibility='private' WHERE user_id=?1", params![uid])?;
    // friends: every friendship, reaction and invite either way
    let friends: Vec<i64> = { let mut st = conn.prepare("SELECT CASE WHEN a=?1 THEN b ELSE a END FROM friendships WHERE a=?1 OR b=?1")?; let v = st.query_map(params![uid], |r| r.get(0))?.collect::<Result<_, _>>()?; v };
    for f in friends { crate::friends::sever(conn, uid, f)?; }
    conn.execute("DELETE FROM friend_reactions WHERE from_id=?1 OR to_id=?1", params![uid])?;
    conn.execute("UPDATE friend_invites SET cancelled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE (from_id=?1 OR to_id=?1) AND cancelled_at IS NULL", params![uid])?;
    // groups: a group they own passes to its longest-standing admin, else its longest-standing member; one with nobody
    // else stays as it is, with no members, so nothing in it is lost
    let owned: Vec<i64> = { let mut st = conn.prepare("SELECT id FROM groups WHERE owner_id=?1")?; let v = st.query_map(params![uid], |r| r.get(0))?.collect::<Result<_, _>>()?; v };
    for g in owned {
        let heir: Option<i64> = conn.query_row("SELECT m.user_id FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=?1 AND m.user_id<>?2 AND u.disabled=0 ORDER BY m.role='admin' DESC, m.joined_at LIMIT 1", params![g, uid], |r| r.get(0)).optional()?;
        if let Some(h) = heir {
            conn.execute("UPDATE groups SET owner_id=?1 WHERE id=?2", params![h, g])?;
            conn.execute("UPDATE group_members SET role='admin' WHERE group_id=?1 AND user_id=?2", params![g, h])?;
        }
    }
    conn.execute("DELETE FROM group_members WHERE user_id=?1", params![uid])?;
    Ok(())
}

/// Lift a ban: the account back and exempt from the evasion check, its marks released, and its content shown again
/// except what another report still holds hidden or an admin removed. Groups, friendships and shared links are not
/// restored: the person rejoins and re-shares.
pub fn unnuke(conn: &Connection, uid: i64, report_id: i64) -> rusqlite::Result<()> {
    conn.execute("UPDATE users SET disabled=0, ban_exempt=1 WHERE id=?1 AND id<>0", params![uid])?;
    conn.execute("DELETE FROM ban_marks WHERE user_id=?1", params![uid])?;
    let held = "SELECT target_id FROM reports WHERE kind=?3 AND id<>?2 AND (status='hidden' OR resolution IN ('remove','ban'))";
    conn.execute(&format!("UPDATE group_posts SET hidden=0 WHERE user_id=?1 AND id NOT IN ({held})"), params![uid, report_id, "post"])?;
    conn.execute(&format!("UPDATE outlines SET hidden=0 WHERE user_id=?1 AND id NOT IN ({held})"), params![uid, report_id, "outline"])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::testkit::{app, call, call_h, user};
    use rusqlite::params;
    use serde_json::{json, Value};

    fn one(pool: &crate::db::DbPool, sql: &str, p: impl rusqlite::Params) -> i64 { pool.get().unwrap().query_row(sql, p, |r| r.get(0)).unwrap() }

    #[test]
    fn ipv6_is_banned_by_its_64() {
        assert_eq!(super::ip_key("2001:db8:1:2:aaaa::1"), super::ip_key("2001:db8:1:2:bbbb::9"));
        assert_ne!(super::ip_key("2001:db8:1:2::1"), super::ip_key("2001:db8:1:3::1"));
        assert_eq!(super::ip_key("127.0.0.1"), None);
    }

    #[tokio::test]
    async fn a_ban_leaves_nothing_of_the_person_anywhere() {
        let (app, pool) = app();
        let (admin_id, admin) = user(&pool, "admin");
        pool.get().unwrap().execute("UPDATE users SET is_admin=1 WHERE id=?1", params![admin_id]).unwrap();
        let (anna_id, anna) = user(&pool, "anna");
        let (ben_id, ben) = user(&pool, "ben");
        // ben owns a group anna is in, is her friend, reacted to her, shares an outline and posts
        let (_, g) = call(&app, "POST", "/groups", Some(&ben), json!({ "name": "Psalms" })).await;
        let slug = g["slug"].as_str().unwrap().to_string();
        call(&app, "POST", "/groups/join", Some(&anna), json!({ "invite_code": g["invite_code"] })).await;
        let c = pool.get().unwrap();
        c.execute("INSERT INTO friendships (a, b) VALUES (?1, ?2)", params![anna_id.min(ben_id), anna_id.max(ben_id)]).unwrap();
        c.execute("INSERT INTO friend_reactions (from_id, to_id, target, kind) VALUES (?1, ?2, 'streak', 'heart')", params![ben_id, anna_id]).unwrap();
        c.execute("INSERT INTO outlines (user_id, title, visibility, share_code) VALUES (?1, 'Mine', 'public', 'abc123')", params![ben_id]).unwrap();
        c.execute("INSERT INTO contact_hashes (user_id, hash) VALUES (?1, ?2)", params![ben_id, "a".repeat(64)]).unwrap();
        drop(c);
        let mine = one(&pool, "SELECT id FROM outlines WHERE share_code='abc123'", []);
        let (_, p) = call(&app, "POST", &format!("/groups/{slug}/posts"), Some(&ben), json!({ "outline_id": mine })).await;
        call(&app, "POST", "/reports", Some(&anna), json!({ "kind": "post", "id": p["id"], "reason": crate::testkit::report_reason() })).await;
        let rid = one(&pool, "SELECT id FROM reports WHERE kind='post'", []);
        assert_eq!(call(&app, "POST", &format!("/admin/reports/{rid}"), Some(&admin), json!({ "action": "ban" })).await.0, 200);

        assert_eq!(one(&pool, "SELECT disabled FROM users WHERE id=?1", [ben_id]), 1);
        assert_eq!(one(&pool, "SELECT count(*) FROM sessions WHERE user_id=?1", [ben_id]), 0);
        assert_eq!(one(&pool, "SELECT count(*) FROM group_members WHERE user_id=?1", [ben_id]), 0);
        assert_eq!(one(&pool, "SELECT owner_id FROM groups", []), anna_id, "the group passes to anna");
        assert_eq!(one(&pool, "SELECT role='admin' FROM group_members WHERE user_id=?1", [anna_id]), 1);
        assert_eq!(one(&pool, "SELECT count(*) FROM friendships", []), 0);
        assert_eq!(one(&pool, "SELECT count(*) FROM friend_reactions", []), 0);
        assert_eq!(one(&pool, "SELECT count(*) FROM contact_hashes", []), 0);
        assert_eq!(one(&pool, "SELECT hidden + (visibility='private') FROM outlines", []), 2);
        assert_eq!(one(&pool, "SELECT count(*) FROM group_posts WHERE hidden=0", []), 0);
        assert_eq!(call(&app, "GET", "/users/ben", Some(&anna), Value::Null).await.0, 404);
        assert_eq!(call(&app, "GET", "/users/ben", Some(&admin), Value::Null).await.0, 200);
        // his IP, his contact hash and (had he one) his devices are marked; nothing is kept in the clear
        assert_eq!(one(&pool, "SELECT count(*) FROM ban_marks WHERE user_id=?1 AND kind IN ('ip','contact')", [ben_id]), 2);
        assert_eq!(one(&pool, "SELECT count(*) FROM ban_marks WHERE hash LIKE '%203.0%'", []), 0);
        assert_eq!(call(&app, "GET", "/me", Some(&ben), Value::Null).await.1["user"], Value::Null);
    }

    #[tokio::test]
    async fn a_banned_persons_network_device_and_contacts_follow_them() {
        let (app, pool) = app();
        let (admin_id, admin) = user(&pool, "admin");
        pool.get().unwrap().execute("UPDATE users SET is_admin=1 WHERE id=?1", params![admin_id]).unwrap();
        let dev = [("x-jottings-device", "a:ben-phone-0001"), ("x-forwarded-for", "198.51.100.7")];
        let (s, b) = call_h(&app, "POST", "/auth/register", None, json!({ "handle": "ben", "password": "correct horse battery" }), &dev).await;
        assert_eq!(s, 200);
        let ben_id = b["user"]["id"].as_i64().unwrap();
        // cara shares ben's network only; dora is already on the app and later picks up ben's phone
        let (_, cara_id, _) = { let (s, v) = call_h(&app, "POST", "/auth/register", None, json!({ "handle": "cara", "password": "correct horse battery" }), &[("x-forwarded-for", "198.51.100.7")]).await; (s, v["user"]["id"].as_i64().unwrap(), v["token"].as_str().unwrap().to_string()) };
        let (_, dora) = user(&pool, "dora");
        let dora_id = one(&pool, "SELECT id FROM users WHERE handle='dora'", []);
        pool.get().unwrap().execute("INSERT INTO reports (reporter_id, kind, target_id, reason) VALUES (?1, 'user', ?2, ?3)", params![admin_id, ben_id, crate::testkit::report_reason()]).unwrap();
        let rid = one(&pool, "SELECT id FROM reports", []);
        call(&app, "POST", &format!("/admin/reports/{rid}"), Some(&admin), json!({ "action": "ban" })).await;

        // no new account from his network or his phone
        let fresh = |h: &'static str| json!({ "handle": h, "password": "correct horse battery" });
        assert_eq!(call_h(&app, "POST", "/auth/register", None, fresh("ben2"), &[("x-forwarded-for", "198.51.100.7")]).await.0, 403);
        assert_eq!(call_h(&app, "POST", "/auth/register", None, fresh("ben3"), &[("x-forwarded-for", "192.0.2.50"), ("x-jottings-device", "a:ben-phone-0001")]).await.0, 403);
        assert_eq!(call_h(&app, "POST", "/auth/register", None, fresh("eve"), &[("x-forwarded-for", "192.0.2.51")]).await.0, 200);
        // cara on the same network: flagged for the admin, not touched
        let cara_tok = call_h(&app, "POST", "/auth/login", None, json!({ "handle": "cara", "password": "correct horse battery" }), &[("x-forwarded-for", "198.51.100.7")]).await.1["token"].as_str().unwrap().to_string();
        assert_eq!(call_h(&app, "GET", "/me", Some(&cara_tok), Value::Null, &[("x-forwarded-for", "198.51.100.7")]).await.1["user"]["handle"], "cara");
        assert_eq!(one(&pool, "SELECT disabled FROM users WHERE id=?1", [cara_id]), 0);
        assert_eq!(one(&pool, "SELECT count(*) FROM reports WHERE target_id=?1 AND ai_category='evasion' AND status='escalated'", [cara_id]), 1);
        // dora on ben's phone is ben: nuked on her next request
        assert_eq!(call_h(&app, "GET", "/me", Some(&dora), Value::Null, &[("x-forwarded-for", "192.0.2.60"), ("x-jottings-device", "a:ben-phone-0001")]).await.1["user"], Value::Null);
        assert_eq!(one(&pool, "SELECT disabled FROM users WHERE id=?1", [dora_id]), 1);
        assert_eq!(one(&pool, "SELECT count(*) FROM reports WHERE target_id=?1 AND ai_category='evasion' AND ai_verdict='ban'", [dora_id]), 1);
        // an account that registers ben's own phone number for contact discovery is ben
        let (s, v) = call_h(&app, "POST", "/auth/register", None, fresh("fred"), &[("x-forwarded-for", "192.0.2.70")]).await;
        assert_eq!(s, 200);
        let fred = v["token"].as_str().unwrap().to_string();
        let ben_hash = "b".repeat(64);
        pool.get().unwrap().execute("INSERT INTO ban_marks (kind, hash, user_id) VALUES ('contact', ?1, ?2)", params![ben_hash, ben_id]).unwrap();
        assert_eq!(call_h(&app, "PUT", "/friends/discoverable", Some(&fred), json!({ "hashes": [ben_hash] }), &[("x-forwarded-for", "192.0.2.70")]).await.0, 403);
        // the admin lifts ben's ban: his marks go, and he is not caught again by his own phone
        call(&app, "POST", &format!("/admin/reports/{rid}"), Some(&admin), json!({ "action": "unban" })).await;
        assert_eq!(one(&pool, "SELECT count(*) FROM ban_marks WHERE user_id=?1", [ben_id]), 0);
        assert_eq!(call_h(&app, "POST", "/auth/login", None, json!({ "handle": "ben", "password": "correct horse battery" }), &dev).await.0, 200);
    }
}
