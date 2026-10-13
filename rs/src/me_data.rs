//! Data rights without closing the account: a full export and category-wise deletion; and the export read back as a
//! backup, whose reading history is signed here so that a file cannot be edited into a longer streak or shared round.
use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::{extract::State, http::header, response::{IntoResponse, Response}, Json};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn rows(conn: &Connection, sql: &str, uid: i64) -> rusqlite::Result<Vec<Value>> {
    let mut st = conn.prepare(sql)?;
    let cols: Vec<String> = st.column_names().iter().map(|c| c.to_string()).collect();
    let out = st.query_map(params![uid], |r| {
        let mut o = serde_json::Map::new();
        for (i, c) in cols.iter().enumerate() {
            let v: Value = match r.get_ref(i)? {
                rusqlite::types::ValueRef::Null => Value::Null,
                rusqlite::types::ValueRef::Integer(n) => json!(n),
                rusqlite::types::ValueRef::Real(f) => json!(f),
                rusqlite::types::ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
                rusqlite::types::ValueRef::Blob(b) => json!(format!("<{} bytes>", b.len())),
            };
            o.insert(c.clone(), v);
        }
        Ok(Value::Object(o))
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(out)
}

// ---------------- the signed reading history ----------------
// The four tables a streak is made of, as typed rows: the export signs them and `restore_activity` verifies them from
// the values, never from the JSON text (the app parses the file and writes it again).

#[derive(Serialize, Deserialize)] struct DayRow { date: String, active_seconds: i64, pages: i64, chapters: i64 }
#[derive(Serialize, Deserialize)] struct CreditRow { book: i64, chapter: i64, date: String, dwell_seconds: i64, credited_at: String, tz_offset_min: i64 }
#[derive(Serialize, Deserialize)] struct ReadRow { book: i64, chapter: i64, first_read_at: String, #[serde(default)] last_read_at: Option<String>, times: i64 }
#[derive(Serialize, Deserialize)] struct BadgeRow { code: String, earned_at: String }
#[derive(Default)] struct History { days: Vec<DayRow>, credits: Vec<CreditRow>, read: Vec<ReadRow>, badges: Vec<BadgeRow> }

fn history(conn: &Connection, uid: i64) -> rusqlite::Result<History> {
    fn q<T>(conn: &Connection, sql: &str, uid: i64, f: impl FnMut(&rusqlite::Row) -> rusqlite::Result<T>) -> rusqlite::Result<Vec<T>> { let mut st = conn.prepare(sql)?; let v = st.query_map(params![uid], f)?.collect(); v }
    Ok(History {
        days: q(conn, "SELECT date, active_seconds, pages, chapters FROM activity_days WHERE user_id=?1 ORDER BY date", uid, |r| Ok(DayRow { date: r.get(0)?, active_seconds: r.get(1)?, pages: r.get(2)?, chapters: r.get(3)? }))?,
        credits: q(conn, "SELECT book, chapter, date, dwell_seconds, credited_at, tz_offset_min FROM page_credits WHERE user_id=?1 ORDER BY credited_at, id", uid, |r| Ok(CreditRow { book: r.get(0)?, chapter: r.get(1)?, date: r.get(2)?, dwell_seconds: r.get(3)?, credited_at: r.get(4)?, tz_offset_min: r.get(5)? }))?,
        read: q(conn, "SELECT book, chapter, first_read_at, last_read_at, times FROM chapters_read WHERE user_id=?1 ORDER BY first_read_at, book, chapter", uid, |r| Ok(ReadRow { book: r.get(0)?, chapter: r.get(1)?, first_read_at: r.get(2)?, last_read_at: r.get(3)?, times: r.get(4)? }))?,
        badges: q(conn, "SELECT code, earned_at FROM badges WHERE user_id=?1 ORDER BY earned_at, code", uid, |r| Ok(BadgeRow { code: r.get(0)?, earned_at: r.get(1)? }))?,
    })
}

/// The text that is signed: a header, the account, the export time, then one line per row in the order exported, each
/// `section|field|field...`. In a text field the separator, a line break and the escape itself are escaped, so no
/// value can pose as two fields or as a second row; NULL is the empty field.
struct Canon(String);
impl Canon {
    fn row(&mut self, section: &str) -> &mut Self { self.0.push_str(section); self }
    fn n(&mut self, v: i64) -> &mut Self { self.0.push('|'); self.0.push_str(&v.to_string()); self }
    fn s(&mut self, v: &str) -> &mut Self {
        self.0.push('|');
        for c in v.chars() { match c { '\\' => self.0.push_str("\\\\"), '|' => self.0.push_str("\\|"), '\n' => self.0.push_str("\\n"), '\r' => self.0.push_str("\\r"), c => self.0.push(c) } }
        self
    }
    fn end(&mut self) { self.0.push('\n'); }
}
fn canonical(uid: i64, exported_at: &str, h: &History) -> String {
    let mut c = Canon(String::with_capacity(64 + 48 * h.days.len() + 96 * (h.credits.len() + h.read.len()) + 48 * h.badges.len()));
    c.row("jottings-backup-activity-v1").end();
    c.row("user").n(uid).end();
    c.row("exported").s(exported_at).end();
    for d in &h.days { c.row("day").s(&d.date).n(d.active_seconds).n(d.pages).n(d.chapters).end(); }
    for p in &h.credits { c.row("credit").n(p.book).n(p.chapter).s(&p.date).n(p.dwell_seconds).s(&p.credited_at).n(p.tz_offset_min).end(); }
    for r in &h.read { c.row("read").n(r.book).n(r.chapter).s(&r.first_read_at).s(r.last_read_at.as_deref().unwrap_or("")).n(r.times).end(); }
    for b in &h.badges { c.row("badge").s(&b.code).s(&b.earned_at).end(); }
    c.0
}

/// RFC 2104 over SHA-256 (the vectors of RFC 4231 are in the tests).
fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    let mut k = [0u8; 64];
    if key.len() > 64 { k[..32].copy_from_slice(&Sha256::digest(key)); } else { k[..key.len()].copy_from_slice(key); }
    let (mut ipad, mut opad) = ([0x36u8; 64], [0x5cu8; 64]);
    for i in 0..64 { ipad[i] ^= k[i]; opad[i] ^= k[i]; }
    let inner = Sha256::new().chain_update(ipad).chain_update(msg).finalize();
    Sha256::new().chain_update(opad).chain_update(inner).finalize().into()
}
fn hex(b: &[u8]) -> String { b.iter().map(|b| format!("{b:02x}")).collect() }
/// Equal or not in the same time wherever the first difference is.
fn same(a: &[u8], b: &[u8]) -> bool { a.len() == b.len() && a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0 }

/// What signs without BEREAN_DB_KEY (development and tests). It is public, so production must never sign with it.
const DEV_KEY: [u8; 32] = *b"jottings-backup-dev-key-not-prod";
/// The signing key: SHA-256 of a label and the database key. None in production without that key.
fn signing_key_from(db_key: Option<&str>, prod: bool) -> Option<[u8; 32]> {
    match db_key { Some(k) => Some(Sha256::digest(format!("jottings-backup-signature-v1:{k}")).into()), None if prod => None, None => Some(DEV_KEY) }
}
/// The key by the environment, read as main.rs reads it (an empty BEREAN_DB_KEY is no key).
fn signing_key() -> ApiResult<[u8; 32]> {
    let db_key = std::env::var("BEREAN_DB_KEY").ok().filter(|k| !k.is_empty());
    signing_key_from(db_key.as_deref(), std::env::var("BEREAN_PROD").is_ok()).ok_or_else(|| { tracing::error!("BEREAN_PROD is set but BEREAN_DB_KEY is not: a backup cannot be signed or verified"); ApiError::internal("backup signing is not configured") })
}
fn sign(key: &[u8; 32], uid: i64, exported_at: &str, h: &History) -> String { hex(&hmac_sha256(key, canonical(uid, exported_at, h).as_bytes())) }

pub async fn export(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Response> {
    let key = signing_key()?;
    let conn = s.pool.get()?;
    let exported_at = crate::db::now_iso();
    let h = history(&conn, u.id)?;
    let signature = sign(&key, u.id, &exported_at, &h);
    let (settings, tz, avatar): (String, Option<i64>, Option<String>) = conn.query_row("SELECT settings, tz_offset_min, avatar FROM users WHERE id=?1", params![u.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    let mut outlines = rows(&conn, "SELECT id, title, description, visibility, share_code, print_style, hidden, created_at, updated_at FROM outlines WHERE user_id=?1 ORDER BY id", u.id)?;
    for o in outlines.iter_mut() {
        let oid = o["id"].as_i64().unwrap_or(0);
        let items = rows(&conn, "SELECT position, kind, book, chapter, v1, v2, text, url, depth FROM outline_items WHERE outline_id=?1 ORDER BY position", oid)?;
        o["items"] = json!(items);
    }
    let doc = json!({
        "format": "jottings-backup", "version": 1,
        "exported_at": exported_at,
        // the preset picture as its id only (null: the default shown for the account's id)
        "user": { "id": u.id, "handle": u.handle, "display_name": u.display_name, "created_at": u.created_at, "settings": serde_json::from_str::<Value>(&settings).unwrap_or(json!({})), "tz_offset_min": tz, "avatar": avatar },
        "reading_position": conn.query_row("SELECT book, chapter, verse, updated_at FROM reading_positions WHERE user_id=?1", params![u.id], |r| Ok(json!({ "book": r.get::<_, i64>(0)?, "chapter": r.get::<_, i64>(1)?, "verse": r.get::<_, i64>(2)?, "updated_at": r.get::<_, String>(3)? }))).optional()?,
        // the reading history, and its signature over these rows in this order (`canonical`)
        "activity_days": h.days, "page_credits": h.credits, "chapters_read": h.read, "badges": h.badges,
        "activity_signature": signature,
        // the reading path (docs/PATHS.md): the active one and, inside history, the ones left for it
        "path": rows(&conn, "SELECT path_id, started_at, target_date, pace_per_week, with_ministry, custom_json, history_json FROM user_paths WHERE user_id=?1", u.id)?.pop(),
        "bookmarks": rows(&conn, "SELECT book, chapter, verse, label, color, created_at FROM bookmarks WHERE user_id=?1 ORDER BY created_at, id", u.id)?,
        "highlights": rows(&conn, "SELECT verse_id, color, created_at FROM highlights WHERE user_id=?1 ORDER BY created_at", u.id)?,
        "outlines": outlines,
        "group_memberships": rows(&conn, "SELECT g.name, g.slug, m.role, m.joined_at FROM group_members m JOIN groups g ON g.id=m.group_id WHERE m.user_id=?1 ORDER BY m.joined_at", u.id)?,
        "group_posts": rows(&conn, "SELECT p.id, g.slug AS group_slug, p.body, p.outline_id, p.hidden, p.created_at FROM group_posts p JOIN groups g ON g.id=p.group_id WHERE p.user_id=?1 ORDER BY p.created_at", u.id)?,
        "reports_filed": rows(&conn, "SELECT kind, target_id, reason, details, status, created_at FROM reports WHERE reporter_id=?1 ORDER BY created_at", u.id)?,
        "blocks": rows(&conn, "SELECT u.handle, b.created_at FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=?1 ORDER BY b.created_at", u.id)?,
        "feedback": rows(&conn, "SELECT message, email, app_version, platform, created_at FROM feedback WHERE user_id=?1 ORDER BY created_at", u.id)?,
        // bans.rs: fingerprints of the networks and devices the account was seen on (the hash itself says nothing)
        "sign_in_fingerprints": rows(&conn, "SELECT kind, first_seen, last_seen FROM user_marks WHERE user_id=?1 ORDER BY first_seen", u.id)?,
        // friends (settings ride in user.settings.friends). Sent invites carry only what the sender saw: the handle as
        // typed, never whether it reached anyone
        "friends": rows(&conn, "SELECT u.handle, u.display_name, f.created_at AS since FROM friendships f JOIN users u ON u.id = CASE WHEN f.a=?1 THEN f.b ELSE f.a END WHERE f.a=?1 OR f.b=?1 ORDER BY f.created_at", u.id)?,
        "friend_invites_sent": rows(&conn, "SELECT to_handle AS handle, via, created_at, cancelled_at FROM friend_invites WHERE from_id=?1 ORDER BY created_at", u.id)?,
        "friend_invites_received": rows(&conn, "SELECT u.handle AS from_handle, i.via, i.created_at, i.declined_at FROM friend_invites i JOIN users u ON u.id=i.from_id WHERE i.to_id=?1 AND i.delivered=1 ORDER BY i.created_at", u.id)?,
        "friend_reactions_sent": rows(&conn, "SELECT u.handle AS to_handle, r.target, r.kind, r.created_at FROM friend_reactions r JOIN users u ON u.id=r.to_id WHERE r.from_id=?1 ORDER BY r.created_at", u.id)?,
        "friend_reactions_received": rows(&conn, "SELECT u.handle AS from_handle, r.target, r.kind, r.created_at, r.seen_at FROM friend_reactions r JOIN users u ON u.id=r.from_id WHERE r.to_id=?1 ORDER BY r.created_at", u.id)?,
        "friend_codes": rows(&conn, "SELECT created_at, expires_at, used_at FROM friend_tokens WHERE user_id=?1 ORDER BY created_at", u.id)?,
        "contact_hashes": rows(&conn, "SELECT hash FROM contact_hashes WHERE user_id=?1 ORDER BY hash", u.id)?,
    });
    let mut res = Json(doc).into_response();
    res.headers_mut().insert(header::CONTENT_DISPOSITION, "attachment; filename=\"jottings-backup.json\"".parse().unwrap());
    res.headers_mut().insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    Ok(res)
}

#[derive(Deserialize)] pub struct DeleteIn { categories: Vec<String> }
const CATEGORIES: &[&str] = &["activity", "bookmarks", "highlights", "position", "outlines", "posts", "groups", "reports", "blocks", "friends", "path"];

pub async fn delete_data(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<DeleteIn>) -> ApiResult<Json<Value>> {
    if b.categories.is_empty() { return Err(ApiError::bad("choose at least one category")); }
    for c in &b.categories { if !CATEGORIES.contains(&c.as_str()) { return Err(ApiError::bad(format!("unknown category {c}"))); } }
    let mut conn = s.pool.get()?;
    let tx = conn.transaction()?;
    let mut deleted = serde_json::Map::new();
    for c in &b.categories {
        let n: usize = match c.as_str() {
            "activity" => {
                let mut n = tx.execute("DELETE FROM activity_days WHERE user_id=?1", params![u.id])?;
                n += tx.execute("DELETE FROM page_credits WHERE user_id=?1", params![u.id])?;
                n += tx.execute("DELETE FROM chapters_read WHERE user_id=?1", params![u.id])?;
                n += tx.execute("DELETE FROM badges WHERE user_id=?1", params![u.id])?;
                n += tx.execute("DELETE FROM activity_sessions WHERE user_id=?1", params![u.id])?;
                n
            }
            "bookmarks" => tx.execute("DELETE FROM bookmarks WHERE user_id=?1", params![u.id])?,
            "highlights" => tx.execute("DELETE FROM highlights WHERE user_id=?1", params![u.id])?,
            "position" => tx.execute("DELETE FROM reading_positions WHERE user_id=?1", params![u.id])?,
            "outlines" => tx.execute("DELETE FROM outlines WHERE user_id=?1", params![u.id])?,
            "posts" => tx.execute("DELETE FROM group_posts WHERE user_id=?1", params![u.id])?,
            "groups" => { let mut n = tx.execute("DELETE FROM groups WHERE owner_id=?1", params![u.id])?; n += tx.execute("DELETE FROM group_members WHERE user_id=?1", params![u.id])?; n }
            "reports" => tx.execute("DELETE FROM reports WHERE reporter_id=?1", params![u.id])?,
            "blocks" => tx.execute("DELETE FROM blocks WHERE user_id=?1", params![u.id])?,
            "path" => tx.execute("DELETE FROM user_paths WHERE user_id=?1", params![u.id])?,
            // every friendship, invite (both ways), reaction (both ways), code and contact hash; the settings stay
            "friends" => {
                let mut n = tx.execute("DELETE FROM friendships WHERE a=?1 OR b=?1", params![u.id])?;
                n += tx.execute("DELETE FROM friend_invites WHERE from_id=?1", params![u.id])?;
                // invites to me are also their sender's record: unlinked from me, left in their list unchanged
                n += tx.execute("UPDATE friend_invites SET to_id=NULL, delivered=0 WHERE to_id=?1", params![u.id])?;
                n += tx.execute("DELETE FROM friend_reactions WHERE from_id=?1 OR to_id=?1", params![u.id])?;
                n += tx.execute("DELETE FROM friend_tokens WHERE user_id=?1", params![u.id])?;
                n += tx.execute("DELETE FROM contact_hashes WHERE user_id=?1", params![u.id])?;
                n
            }
            _ => 0,
        };
        deleted.insert(c.clone(), json!(n));
    }
    tx.commit()?;
    Ok(Json(json!({ "deleted": deleted })))
}

// ---------------- the reading history restored from a backup ----------------
#[derive(Deserialize)] struct UserRef { id: i64 }
/// The signed part of an export, with the keys the export gives them; anything else in the body is ignored.
#[derive(Deserialize)] struct RestoreIn { user: UserRef, exported_at: String, activity_signature: String,
    #[serde(default)] activity_days: Vec<DayRow>, #[serde(default)] page_credits: Vec<CreditRow>, #[serde(default)] chapters_read: Vec<ReadRow>, #[serde(default)] badges: Vec<BadgeRow> }

// far past what a reader can have (a day is one row, a chapter credits once a day, the canon has 1,189 chapters), and
// what RESTORE_BODY_LIMIT is sized for: the route takes more than axum's 2 MB because 50,000 credits are about 7 MB
const MAX_DAYS: usize = 5_000;
const MAX_CREDITS: usize = 50_000;
const MAX_READ: usize = 5_000;
const MAX_BADGES: usize = 500;
pub const RESTORE_BODY_LIMIT: usize = 16 << 20;
/// No count in a row is larger, so no sum over a restored history can overflow.
const MAX_COUNT: i64 = 1_000_000_000;

fn not_a_backup() -> String { format!("This is not a {} backup with reading history.", crate::brand::get().name) }
const TOO_LARGE: &str = "This backup's reading history is too large to restore.";
const CHANGED: &str = "This backup's reading history has been changed, so it cannot be restored.";
const IMPOSSIBLE: &str = "This backup's reading history holds an entry that cannot be restored.";
const STILL_OPEN: &str = "This reading history belongs to another account that is still open.";
const CLAIMED: &str = "This reading history has already been restored to another account.";

/// Every row is one the server could have written: real days and times no later than a day from `now` (the furthest
/// zone is a day ahead of UTC, see `activity::resolve_day`), a book of the canon, a possible day's seconds, nothing
/// negative. The signature already says so; this holds if the key ever leaks.
fn plausible(h: &History, now: time::OffsetDateTime) -> bool {
    let limit = now + time::Duration::days(1);
    let day = |s: &str| crate::activity::parse_day(s).is_some_and(|d| d <= limit.date() && crate::activity::day_key(d) == s);
    let at = |s: &str| time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).is_ok_and(|t| t <= limit);
    let place = |book: i64, chapter: i64| (1..=66).contains(&book) && (1..=MAX_COUNT).contains(&chapter);
    let n = |v: i64| (0..=MAX_COUNT).contains(&v);
    h.days.iter().all(|d| day(&d.date) && (0..=86_400).contains(&d.active_seconds) && n(d.pages) && n(d.chapters))
        && h.credits.iter().all(|p| place(p.book, p.chapter) && day(&p.date) && n(p.dwell_seconds) && at(&p.credited_at) && crate::activity::valid_offset(Some(p.tz_offset_min)).is_some())
        && h.read.iter().all(|r| place(r.book, r.chapter) && at(&r.first_read_at) && r.last_read_at.as_deref().is_none_or(at) && (1..=MAX_COUNT).contains(&r.times))
        && h.badges.iter().all(|b| !b.code.is_empty() && b.code.len() <= 40 && b.code.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_') && at(&b.earned_at))
}

/// Merges a signed history into `caller`'s. Their own always; another account's only once that account is gone, and
/// then to one account only (`activity_claims`). Nothing is ever added to what is there: a day keeps the larger of
/// each number, a credit or badge that exists stays, so a second restore of the same file changes nothing.
fn restore(conn: &mut crate::db::Conn, caller: i64, body: &[u8], key: &[u8; 32], now: time::OffsetDateTime) -> ApiResult<Value> {
    let b: RestoreIn = serde_json::from_slice(body).map_err(|_| ApiError::bad(not_a_backup()))?;
    if b.activity_days.len() > MAX_DAYS || b.page_credits.len() > MAX_CREDITS || b.chapters_read.len() > MAX_READ || b.badges.len() > MAX_BADGES { return Err(ApiError::bad(TOO_LARGE)); }
    let (source, h) = (b.user.id, History { days: b.activity_days, credits: b.page_credits, read: b.chapters_read, badges: b.badges });
    if !same(sign(key, source, &b.exported_at, &h).as_bytes(), b.activity_signature.as_bytes()) { return Err(ApiError::bad(CHANGED)); }
    if !plausible(&h, now) { return Err(ApiError::bad(IMPOSSIBLE)); }
    // the write lock from the start: whether the source account exists, the claim and the merge are one step, so two
    // accounts restoring the same file at once cannot both pass
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if source != caller {
        if tx.query_row("SELECT 1 FROM users WHERE id=?1", params![source], |_| Ok(())).optional()?.is_some() { return Err(ApiError::forbidden(STILL_OPEN)); }
        tx.execute("INSERT OR IGNORE INTO activity_claims (source_user_id, claimed_by, claimed_at) VALUES (?1,?2,?3)", params![source, caller, crate::db::now_iso()])?;
        let by: i64 = tx.query_row("SELECT claimed_by FROM activity_claims WHERE source_user_id=?1", params![source], |r| r.get(0))?;
        if by != caller { return Err(ApiError::forbidden(CLAIMED)); }
    }
    // the Supporter badge is the admin's to give (users.supporter), not a part of anyone's reading
    let supporter: bool = tx.query_row("SELECT supporter FROM users WHERE id=?1", params![caller], |r| r.get(0))?;
    let (mut days, mut credits, mut chapters, mut badges) = (0, 0, 0, 0);
    {
        let mut st = tx.prepare_cached("INSERT INTO activity_days (user_id, date, active_seconds, pages, chapters) VALUES (?1,?2,?3,?4,?5)
            ON CONFLICT(user_id, date) DO UPDATE SET active_seconds=max(active_seconds, excluded.active_seconds), pages=max(pages, excluded.pages), chapters=max(chapters, excluded.chapters)
            WHERE excluded.active_seconds > active_seconds OR excluded.pages > pages OR excluded.chapters > chapters")?;
        for d in &h.days { days += st.execute(params![caller, d.date, d.active_seconds, d.pages, d.chapters])?; }
        let mut st = tx.prepare_cached("INSERT OR IGNORE INTO page_credits (user_id, book, chapter, date, dwell_seconds, credited_at, tz_offset_min) VALUES (?1,?2,?3,?4,?5,?6,?7)")?;
        for p in &h.credits { credits += st.execute(params![caller, p.book, p.chapter, p.date, p.dwell_seconds, p.credited_at, p.tz_offset_min])?; }
        // a row from before last_read_at has none: its first reading is its last, as db::open_pool fills it
        let mut st = tx.prepare_cached("INSERT INTO chapters_read (user_id, book, chapter, first_read_at, last_read_at, times) VALUES (?1,?2,?3,?4,?5,?6)
            ON CONFLICT(user_id, book, chapter) DO UPDATE SET first_read_at=min(first_read_at, excluded.first_read_at), last_read_at=max(coalesce(last_read_at, first_read_at), excluded.last_read_at), times=max(times, excluded.times)
            WHERE excluded.first_read_at < first_read_at OR excluded.last_read_at > coalesce(last_read_at, first_read_at) OR excluded.times > times")?;
        for r in &h.read { chapters += st.execute(params![caller, r.book, r.chapter, r.first_read_at, r.last_read_at.as_deref().unwrap_or(&r.first_read_at), r.times])?; }
        let mut st = tx.prepare_cached("INSERT INTO badges (user_id, code, earned_at) VALUES (?1,?2,?3) ON CONFLICT(user_id, code) DO UPDATE SET earned_at=excluded.earned_at WHERE excluded.earned_at < earned_at")?;
        for b in h.badges.iter().filter(|b| supporter || b.code != "supporter") { badges += st.execute(params![caller, b.code, b.earned_at])?; }
    }
    tx.commit()?;
    // nothing caches a streak or a total (stats read these tables); the badges are the one thing kept, so the ones the
    // merged history now earns are given here rather than on the reader's next beat
    crate::badges::check_badges(conn, caller)?;
    Ok(json!({ "restored": { "days": days, "credits": credits, "chapters": chapters, "badges": badges } }))
}

pub async fn restore_activity(State(s): State<AppState>, AuthUser(u): AuthUser, body: axum::body::Bytes) -> ApiResult<Json<Value>> {
    let key = signing_key()?;
    Ok(Json(s.db(move |conn| restore(conn, u.id, &body, &key, time::OffsetDateTime::now_utc())).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::{app, call, user};
    use axum::{body::Body, http::Request, Router};
    use tower::ServiceExt;
    const NULL: Value = Value::Null;

    /// A request with the body as written, for what `call` cannot say: a body that is not `Value`'s own rendering, and the headers.
    async fn raw(app: &Router, method: &str, uri: &str, token: &str, body: String) -> (u16, axum::http::HeaderMap, Value) {
        let req = Request::builder().method(method).uri(uri).header("content-type", "application/json").header("x-forwarded-for", "203.0.113.9").header("authorization", format!("Bearer {token}"));
        let res = app.clone().oneshot(req.body(Body::from(body)).unwrap()).await.unwrap();
        let (status, headers) = (res.status().as_u16(), res.headers().clone());
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 26).await.unwrap();
        (status, headers, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }
    /// The same document as a different text: every object's keys in reverse, indented, numbers and strings untouched.
    fn rewritten(v: &Value, depth: usize) -> String {
        let pad = "\n".to_string() + &"\t".repeat(depth + 1);
        match v {
            Value::Object(o) => format!("{{{}{pad}}}", o.iter().rev().map(|(k, v)| format!("{pad}{} :  {}", json!(k), rewritten(v, depth + 1))).collect::<Vec<_>>().join(" ,")),
            Value::Array(a) => format!("[{}{pad}]", a.iter().map(|v| format!("{pad}{}", rewritten(v, depth + 1))).collect::<Vec<_>>().join(",")),
            v => v.to_string(),
        }
    }
    /// Three days, two credits, two chapters (one from before last_read_at) and a badge; then every badge the test
    /// database gives for them, so that a later check has nothing to add.
    async fn reading(app: &Router, pool: &crate::db::DbPool, uid: i64, token: &str) {
        {
            let c = pool.get().unwrap();
            for (d, secs, pages, chapters) in [("2026-01-01", 900, 1, 1), ("2026-01-02", 700, 0, 0), ("2026-01-03", 1200, 1, 1)] { c.execute("INSERT INTO activity_days (user_id, date, active_seconds, pages, chapters) VALUES (?1,?2,?3,?4,?5)", params![uid, d, secs, pages, chapters]).unwrap(); }
            for (ch, d, at) in [(3, "2026-01-01", "2026-01-01T07:10:00.000Z"), (4, "2026-01-03", "2026-01-03T21:40:00.000Z")] {
                c.execute("INSERT INTO page_credits (user_id, book, chapter, date, dwell_seconds, credited_at, tz_offset_min) VALUES (?1,43,?2,?3,200,?4,-300)", params![uid, ch, d, at]).unwrap();
                c.execute("INSERT INTO chapters_read (user_id, book, chapter, first_read_at, last_read_at, times) VALUES (?1,43,?2,?3,?3,2)", params![uid, ch, at]).unwrap();
            }
            c.execute("UPDATE chapters_read SET last_read_at=NULL WHERE user_id=?1 AND chapter=3", [uid]).unwrap();
            c.execute("INSERT INTO badges (user_id, code, earned_at) VALUES (?1, 'first_page', '2026-01-01T07:10:00.000Z')", [uid]).unwrap();
        }
        assert_eq!(call(app, "POST", "/stats/recheck", Some(token), NULL).await.0, 200);
    }
    /// Every row of the four tables for one reader, as text.
    fn held(pool: &crate::db::DbPool, uid: i64) -> Vec<String> {
        let c = pool.get().unwrap();
        ["SELECT 'day', date, active_seconds, pages, chapters, '' FROM activity_days WHERE user_id=?1 ORDER BY date",
         "SELECT 'credit', book, chapter, date, dwell_seconds, credited_at || ' ' || tz_offset_min FROM page_credits WHERE user_id=?1 ORDER BY book, chapter, date",
         "SELECT 'read', book, chapter, first_read_at, ifnull(last_read_at, 'NULL'), times FROM chapters_read WHERE user_id=?1 ORDER BY book, chapter",
         "SELECT 'badge', code, earned_at, '', '', '' FROM badges WHERE user_id=?1 ORDER BY code"].iter().flat_map(|sql| {
            let mut st = c.prepare(sql).unwrap();
            let v: Vec<String> = st.query_map([uid], |r| Ok((0..6).map(|i| match r.get_ref(i).unwrap() { rusqlite::types::ValueRef::Integer(n) => n.to_string(), rusqlite::types::ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned(), _ => "?".into() }).collect::<Vec<_>>().join(" "))).unwrap().collect::<Result<_, _>>().unwrap();
            v
        }).collect()
    }
    fn restored(v: &Value) -> [i64; 4] { ["days", "credits", "chapters", "badges"].map(|k| v["restored"][k].as_i64().unwrap_or(-1)) }
    /// A body the server itself could have signed for `uid`, whatever its rows say.
    fn signed(uid: i64, h: &History) -> Value {
        let at = "2026-02-01T00:00:00Z";
        json!({ "user": { "id": uid }, "exported_at": at, "activity_days": h.days, "page_credits": h.credits, "chapters_read": h.read, "badges": h.badges, "activity_signature": sign(&signing_key().unwrap(), uid, at, h) })
    }
    fn day(date: &str, active_seconds: i64) -> DayRow { DayRow { date: date.into(), active_seconds, pages: 0, chapters: 0 } }

    #[test]
    fn hmac_sha256_matches_rfc_4231() {
        // test cases 1, 2 and 6 (a key longer than the block is hashed first)
        assert_eq!(hex(&hmac_sha256(&[0x0b; 20], b"Hi There")), "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
        assert_eq!(hex(&hmac_sha256(b"Jefe", b"what do ya want for nothing?")), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
        assert_eq!(hex(&hmac_sha256(&[0xaa; 131], b"Test Using Larger Than Block-Size Key - Hash Key First")), "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
        assert!(same(b"abc", b"abc") && !same(b"abc", b"abd") && !same(b"abc", b"ab") && same(b"", b""));
    }

    #[test]
    fn production_never_signs_with_the_dev_key() {
        assert_eq!(signing_key_from(None, false), Some(DEV_KEY));
        assert_eq!(signing_key_from(None, true), None);
        let k = signing_key_from(Some("00ff"), true).unwrap();
        assert_eq!(hex(&k), hex(&Sha256::digest(b"jottings-backup-signature-v1:00ff")));
        assert_eq!(signing_key_from(Some("00ff"), false), Some(k));
        assert!(k != DEV_KEY && signing_key_from(Some("00fe"), true) != Some(k));
    }

    #[test]
    fn no_value_can_pose_as_another_row_or_field() {
        let one = |code: &str, at: &str| canonical(7, "t", &History { badges: vec![BadgeRow { code: code.into(), earned_at: at.into() }], ..Default::default() });
        assert_eq!(one("first_page", "2026-01-01T00:00:00Z"), "jottings-backup-activity-v1\nuser|7\nexported|t\nbadge|first_page|2026-01-01T00:00:00Z\n");
        // a separator or a line break inside a value stays inside it
        assert_ne!(one("a|b", "c"), one("a", "b|c"));
        assert_ne!(one("a\\", "|b"), one("a\\|", "b"));
        assert_eq!(one("a\nbadge|x|y", "z").lines().count(), 4);
        // NULL is the empty field, and the account and the time are part of what is signed
        let read = |last: Option<&str>| canonical(7, "t", &History { read: vec![ReadRow { book: 43, chapter: 3, first_read_at: "a".into(), last_read_at: last.map(Into::into), times: 2 }], ..Default::default() });
        assert!(read(None).ends_with("read|43|3|a||2\n") && read(Some("b")).ends_with("read|43|3|a|b|2\n"));
        assert_ne!(canonical(7, "t", &History::default()), canonical(8, "t", &History::default()));
        assert_ne!(canonical(7, "t", &History::default()), canonical(7, "u", &History::default()));
    }

    #[tokio::test]
    async fn an_export_is_signed_and_brings_its_own_history_back_once() {
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        reading(&app, &pool, id, &anna).await;
        let (st, headers, doc) = raw(&app, "GET", "/me/export", &anna, String::new()).await;
        assert_eq!((st, &doc["format"], &doc["version"], &doc["user"]["id"]), (200, &json!("jottings-backup"), &json!(1), &json!(id)));
        assert_eq!(headers["content-disposition"], "attachment; filename=\"jottings-backup.json\"");
        let sig = doc["activity_signature"].as_str().unwrap();
        assert!(sig.len() == 64 && sig.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)), "{sig}");
        // the rows keep the shape they had, a NULL included
        assert_eq!(doc["activity_days"][0], json!({ "date": "2026-01-01", "active_seconds": 900, "pages": 1, "chapters": 1 }));
        assert_eq!(doc["page_credits"][0], json!({ "book": 43, "chapter": 3, "date": "2026-01-01", "dwell_seconds": 200, "credited_at": "2026-01-01T07:10:00.000Z", "tz_offset_min": -300 }));
        assert_eq!(doc["chapters_read"][0], json!({ "book": 43, "chapter": 3, "first_read_at": "2026-01-01T07:10:00.000Z", "last_read_at": null, "times": 2 }));
        let before = held(&pool, id);
        let stats = call(&app, "GET", "/stats", Some(&anna), NULL).await.1;
        let n_badges = doc["badges"].as_array().unwrap().len() as i64;
        assert!(before.len() as i64 == 3 + 2 + 2 + n_badges && n_badges >= 1);
        // restored over what is still there: nothing to do
        let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&anna), doc.clone()).await;
        assert_eq!((st, restored(&v)), (200, [0; 4]));
        assert_eq!(held(&pool, id), before);
        // the Activity category deleted, then the whole file posted (the keys that are not history are ignored)
        assert_eq!(call(&app, "DELETE", "/me/data", Some(&anna), json!({ "categories": ["activity"] })).await.0, 200);
        assert!(held(&pool, id).is_empty());
        let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&anna), doc.clone()).await;
        assert_eq!((st, restored(&v)), (200, [3, 2, 2, n_badges]), "{v}");
        // all of it as it was, but the chapter without a last reading, which now has its first (as a boot fills it)
        let after = held(&pool, id);
        assert_eq!(after.iter().filter(|r| !r.starts_with("read 43 3 ")).collect::<Vec<_>>(), before.iter().filter(|r| !r.starts_with("read 43 3 ")).collect::<Vec<_>>());
        assert!(after.contains(&"read 43 3 2026-01-01T07:10:00.000Z 2026-01-01T07:10:00.000Z 2".to_string()), "{after:?}");
        let now = call(&app, "GET", "/stats", Some(&anna), NULL).await.1;
        for k in ["total_active_seconds", "total_pages", "chapters_read"] { assert_eq!(now[k], stats[k], "{k}"); }
        assert_eq!((now["total_active_seconds"].as_i64(), now["streak"]["longest"].as_i64(), &now["badges"]), (Some(2800), Some(3), &stats["badges"]));
        // and a second time changes nothing
        let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&anna), doc).await;
        assert_eq!((st, restored(&v)), (200, [0; 4]));
        assert_eq!(held(&pool, id), after);
        let claims: i64 = pool.get().unwrap().query_row("SELECT count(*) FROM activity_claims", [], |r| r.get(0)).unwrap();
        assert_eq!(claims, 0);
    }

    #[tokio::test]
    async fn an_edited_backup_is_refused_and_nothing_is_written() {
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        let (ben_id, ben) = user(&pool, "ben");
        reading(&app, &pool, id, &anna).await;
        let doc = call(&app, "GET", "/me/export", Some(&anna), NULL).await.1;
        call(&app, "DELETE", "/me/data", Some(&anna), json!({ "categories": ["activity"] })).await;
        let edit = |f: &dyn Fn(&mut Value)| { let mut d = doc.clone(); f(&mut d); d };
        let edits = [
            edit(&|d| d["activity_days"][1]["active_seconds"] = json!(701)),
            edit(&|d| d["activity_days"][0]["date"] = json!("2026-01-04")),
            edit(&|d| d["activity_days"].as_array_mut().unwrap().push(json!({ "date": "2026-01-04", "active_seconds": 900, "pages": 0, "chapters": 0 }))),
            edit(&|d| { d["activity_days"].as_array_mut().unwrap().remove(1); }),
            edit(&|d| d["activity_days"].as_array_mut().unwrap().swap(0, 1)),
            edit(&|d| d["page_credits"][0]["chapter"] = json!(5)),
            edit(&|d| d["page_credits"][0]["tz_offset_min"] = json!(0)),
            edit(&|d| d["chapters_read"][1]["times"] = json!(3)),
            edit(&|d| d["chapters_read"][0]["last_read_at"] = json!("2026-01-05T00:00:00.000Z")),
            edit(&|d| d["badges"][0]["code"] = json!("streak_365")),
            edit(&|d| d["exported_at"] = json!("2026-01-01T00:00:00Z")),
            // made out to the one restoring it
            edit(&|d| d["user"]["id"] = json!(ben_id)),
            edit(&|d| d["activity_signature"] = json!("0".repeat(64))),
            edit(&|d| d["activity_signature"] = json!("")),
        ];
        for d in &edits {
            for t in [&anna, &ben] {
                let (st, v) = call(&app, "POST", "/me/restore-activity", Some(t), d.clone()).await;
                assert_eq!((st, v["error"].as_str()), (400, Some("This backup's reading history has been changed, so it cannot be restored.")), "{d}");
            }
        }
        // not a backup at all, a backup from before the signature, and one past the caps
        for d in [json!({}), json!([1]), edit(&|d| { d.as_object_mut().unwrap().remove("activity_signature"); }), edit(&|d| d["activity_days"][0]["pages"] = json!("1")), edit(&|d| d["activity_days"][0]["pages"] = json!(1.5))] {
            let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&anna), d.clone()).await;
            assert_eq!((st, v["error"].as_str()), (400, Some(super::not_a_backup().as_str())), "{d}");
        }
        assert_eq!(raw(&app, "POST", "/me/restore-activity", &anna, "{ not json".into()).await.0, 400);
        let many = signed(id, &History { days: (0..=MAX_DAYS).map(|_| day("2026-01-01", 1)).collect(), ..Default::default() });
        let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&anna), many).await;
        assert_eq!((st, v["error"].as_str()), (400, Some("This backup's reading history is too large to restore.")));
        assert_eq!(call(&app, "POST", "/me/restore-activity", None, doc.clone()).await.0, 401);
        assert!(held(&pool, id).is_empty() && held(&pool, ben_id).is_empty());
        // the file as it was still restores
        assert_eq!(call(&app, "POST", "/me/restore-activity", Some(&anna), doc).await.0, 200);
        assert_eq!(held(&pool, id).iter().filter(|r| r.starts_with("day ")).count(), 3);
    }

    #[tokio::test]
    async fn a_signed_entry_that_cannot_be_true_is_refused_whole() {
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        let tomorrow = crate::activity::day_key(time::OffsetDateTime::now_utc().date() + time::Duration::days(1));
        let later = crate::activity::day_key(time::OffsetDateTime::now_utc().date() + time::Duration::days(2));
        let credit = |book, chapter, date: &str, dwell, at: &str, tz| CreditRow { book, chapter, date: date.into(), dwell_seconds: dwell, credited_at: at.into(), tz_offset_min: tz };
        let read = |book, chapter, at: &str, last: Option<&str>, times| ReadRow { book, chapter, first_read_at: at.into(), last_read_at: last.map(Into::into), times };
        let badge = |code: &str, at: &str| BadgeRow { code: code.into(), earned_at: at.into() };
        const AT: &str = "2026-01-01T07:10:00.000Z";
        let bad = [
            History { days: vec![day(&later, 900)], ..Default::default() },
            History { days: vec![day("2026-02-30", 900)], ..Default::default() },
            History { days: vec![day("2026-1-1", 900)], ..Default::default() },
            History { days: vec![day("yesterday", 900)], ..Default::default() },
            History { days: vec![day("2026-01-02", 86_401)], ..Default::default() },
            History { days: vec![day("2026-01-02", -1)], ..Default::default() },
            History { days: vec![DayRow { pages: -1, ..day("2026-01-02", 900) }], ..Default::default() },
            History { days: vec![DayRow { chapters: -1, ..day("2026-01-02", 900) }], ..Default::default() },
            History { credits: vec![credit(0, 1, "2026-01-01", 200, AT, 0)], ..Default::default() },
            History { credits: vec![credit(67, 1, "2026-01-01", 200, AT, 0)], ..Default::default() },
            History { credits: vec![credit(43, 0, "2026-01-01", 200, AT, 0)], ..Default::default() },
            History { credits: vec![credit(43, 3, &later, 200, AT, 0)], ..Default::default() },
            History { credits: vec![credit(43, 3, "2026-01-01", -5, AT, 0)], ..Default::default() },
            History { credits: vec![credit(43, 3, "2026-01-01", 200, "2999-01-01T00:00:00Z", 0)], ..Default::default() },
            History { credits: vec![credit(43, 3, "2026-01-01", 200, "this morning", 0)], ..Default::default() },
            History { credits: vec![credit(43, 3, "2026-01-01", 200, AT, 5000)], ..Default::default() },
            History { read: vec![read(43, 151, AT, None, 0)], ..Default::default() },
            History { read: vec![read(70, 1, AT, None, 1)], ..Default::default() },
            History { read: vec![read(43, 3, AT, Some(""), 1)], ..Default::default() },
            History { read: vec![read(43, 3, "", None, 1)], ..Default::default() },
            History { badges: vec![badge("first_page", "soon")], ..Default::default() },
            History { badges: vec![badge("First Page", AT)], ..Default::default() },
            History { badges: vec![badge("", AT)], ..Default::default() },
        ];
        for mut h in bad {
            // a good row first: nothing of a refused file is kept
            h.days.insert(0, day("2026-01-01", 900));
            let body = signed(id, &h);
            let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&anna), body.clone()).await;
            assert_eq!((st, v["error"].as_str()), (400, Some("This backup's reading history holds an entry that cannot be restored.")), "{body}");
        }
        assert!(held(&pool, id).is_empty());
        // the furthest zone is a day ahead of UTC: tomorrow is a day a beat can have credited
        let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&anna), signed(id, &History { days: vec![day(&tomorrow, 86_400)], ..Default::default() })).await;
        assert_eq!((st, restored(&v)), (200, [1, 0, 0, 0]));
    }

    #[tokio::test]
    async fn a_long_history_is_more_than_the_usual_body_and_still_fits() {
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        let h = History { credits: (1..=20_000).map(|i| CreditRow { book: 19, chapter: i, date: "2026-01-01".into(), dwell_seconds: 200, credited_at: "2026-01-01T07:10:00.000Z".into(), tz_offset_min: -300 }).collect(), ..Default::default() };
        let body = signed(id, &h);
        assert!(body.to_string().len() > 2 << 20);
        let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&anna), body.clone()).await;
        assert_eq!((st, restored(&v)[1]), (200, 20_000), "{v}");
        assert_eq!(restored(&call(&app, "POST", "/me/restore-activity", Some(&anna), body).await.1)[1], 0);
        // the limit is this route's alone
        assert_eq!(call(&app, "POST", "/bookmarks", Some(&anna), json!({ "book": 43, "label": "x".repeat(3 << 20) })).await.0, 413);
        assert_eq!(pool.get().unwrap().query_row("SELECT count(*) FROM page_credits WHERE user_id=?1", [id], |r| r.get::<_, i64>(0)).unwrap(), 20_000);
    }

    #[tokio::test]
    async fn another_open_account_cannot_take_the_history() {
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        let (ben_id, ben) = user(&pool, "ben");
        reading(&app, &pool, id, &anna).await;
        let doc = call(&app, "GET", "/me/export", Some(&anna), NULL).await.1;
        for _ in 0..2 {
            let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&ben), doc.clone()).await;
            assert_eq!((st, v["error"].as_str()), (403, Some("This reading history belongs to another account that is still open.")));
        }
        // emptied of its reading, the account is still open
        call(&app, "DELETE", "/me/data", Some(&anna), json!({ "categories": ["activity"] })).await;
        assert_eq!(call(&app, "POST", "/me/restore-activity", Some(&ben), doc.clone()).await.0, 403);
        // banned is not gone either (bans.rs keeps the row)
        pool.get().unwrap().execute("UPDATE users SET disabled=1 WHERE id=?1", [id]).unwrap();
        assert_eq!(call(&app, "POST", "/me/restore-activity", Some(&ben), doc).await.0, 403);
        assert!(held(&pool, ben_id).is_empty());
        let claims: i64 = pool.get().unwrap().query_row("SELECT count(*) FROM activity_claims", [], |r| r.get(0)).unwrap();
        assert_eq!(claims, 0);
    }

    #[tokio::test]
    async fn a_deleted_accounts_history_moves_to_one_account_only() {
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        let (ben_id, ben) = user(&pool, "ben");
        let (cara_id, cara) = user(&pool, "cara");
        reading(&app, &pool, id, &anna).await;
        {
            let c = pool.get().unwrap();
            c.execute("UPDATE users SET supporter=1 WHERE id=?1", [id]).unwrap();
            c.execute("INSERT INTO badges (user_id, code, earned_at) VALUES (?1, 'supporter', '2026-01-02T00:00:00.000Z')", [id]).unwrap();
            // ben's own reading meets anna's on one day, one credit, one chapter and one badge
            c.execute("INSERT INTO activity_days (user_id, date, active_seconds, pages, chapters) VALUES (?1, '2026-01-01', 1000, 0, 0), (?1, '2025-12-31', 600, 1, 1)", [ben_id]).unwrap();
            c.execute("INSERT INTO page_credits (user_id, book, chapter, date, dwell_seconds, credited_at, tz_offset_min) VALUES (?1, 43, 3, '2026-01-01', 999, '2026-01-01T09:00:00.000Z', 60)", [ben_id]).unwrap();
            c.execute("INSERT INTO chapters_read (user_id, book, chapter, first_read_at, last_read_at, times) VALUES (?1, 43, 3, '2025-12-31T10:00:00.000Z', '2026-01-01T09:00:00.000Z', 5), (?1, 43, 4, '2026-02-01T10:00:00.000Z', '2026-02-02T10:00:00.000Z', 1)", [ben_id]).unwrap();
            c.execute("INSERT INTO badges (user_id, code, earned_at) VALUES (?1, 'first_page', '2025-12-31T10:00:00.000Z')", [ben_id]).unwrap();
        }
        // every badge of ben's is older than anna's, but the one her early chapter gave her alone
        assert_eq!(call(&app, "POST", "/stats/recheck", Some(&ben), NULL).await.0, 200);
        pool.get().unwrap().execute("UPDATE badges SET earned_at='2025-12-31T10:00:00.000Z' WHERE user_id=?1", [ben_id]).unwrap();
        let doc = call(&app, "GET", "/me/export", Some(&anna), NULL).await.1;
        let anna_badges: Vec<String> = doc["badges"].as_array().unwrap().iter().map(|b| b["code"].as_str().unwrap().to_string()).collect();
        assert!(anna_badges.contains(&"supporter".to_string()) && anna_badges.contains(&"early_bird".to_string()));
        let ben_before = held(&pool, ben_id);
        assert_eq!(call(&app, "DELETE", "/me", Some(&anna), json!({ "confirm": "delete" })).await.0, 200);
        // ben takes it: the larger of each number on the shared day, his own credit kept, the chapters' earliest and
        // latest readings and larger counts, his earlier badge kept; and not the badge only the admin gives
        let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&ben), doc.clone()).await;
        assert_eq!((st, restored(&v)), (200, [3, 1, 1, 1]), "{v}");
        let now = held(&pool, ben_id);
        for row in ["day 2025-12-31 600 1 1 ", "day 2026-01-01 1000 1 1 ", "day 2026-01-02 700 0 0 ", "day 2026-01-03 1200 1 1 ",
            "credit 43 3 2026-01-01 999 2026-01-01T09:00:00.000Z 60", "credit 43 4 2026-01-03 200 2026-01-03T21:40:00.000Z -300",
            "read 43 3 2025-12-31T10:00:00.000Z 2026-01-01T09:00:00.000Z 5", "read 43 4 2026-01-03T21:40:00.000Z 2026-02-02T10:00:00.000Z 2",
            "badge first_page 2025-12-31T10:00:00.000Z   "] {
            assert!(now.contains(&row.to_string()), "{row:?} not in {now:?}");
        }
        assert!(now.iter().any(|r| r.starts_with("badge early_bird ")) && !now.iter().any(|r| r.starts_with("badge supporter")));
        assert_eq!(now.len(), ben_before.len() + 2 + 1 + 1);
        let claim: (i64, i64) = pool.get().unwrap().query_row("SELECT source_user_id, claimed_by FROM activity_claims", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(claim, (id, ben_id));
        // cara is too late, however often she asks
        for _ in 0..2 {
            let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&cara), doc.clone()).await;
            assert_eq!((st, v["error"].as_str()), (403, Some("This reading history has already been restored to another account.")));
        }
        assert!(held(&pool, cara_id).is_empty());
        // ben again: allowed, and nothing changes
        let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&ben), doc.clone()).await;
        assert_eq!((st, restored(&v)), (200, [0; 4]));
        assert_eq!(held(&pool, ben_id), now);
        // a new account never gets the id of the one that closed, so the claim cannot come loose; nor when ben closes his
        let (dora_id, dora) = user(&pool, "dora");
        assert!(dora_id > cara_id);
        assert_eq!(call(&app, "DELETE", "/me", Some(&ben), json!({ "confirm": "delete" })).await.0, 200);
        assert_eq!(call(&app, "POST", "/me/restore-activity", Some(&dora), doc).await.0, 403);
        assert!(held(&pool, dora_id).is_empty());
    }

    #[tokio::test]
    async fn the_signature_is_over_the_values_not_the_text() {
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        reading(&app, &pool, id, &anna).await;
        let doc = call(&app, "GET", "/me/export", Some(&anna), NULL).await.1;
        // through a parser and back, keys in another order, spaces and line breaks everywhere
        let text = rewritten(&doc, 0);
        assert_ne!(text, doc.to_string());
        assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), doc);
        assert!(text.find("\"user\"").unwrap() < text.find("\"activity_days\"").unwrap() && text.contains("\"pages\" :  1 ,\n"));
        call(&app, "DELETE", "/me/data", Some(&anna), json!({ "categories": ["activity"] })).await;
        let (st, _, v) = raw(&app, "POST", "/me/restore-activity", &anna, text).await;
        assert_eq!((st, &restored(&v)[..3]), (200, &[3, 2, 2][..]), "{v}");
        // only the signed keys, as the app sends them
        call(&app, "DELETE", "/me/data", Some(&anna), json!({ "categories": ["activity"] })).await;
        let mut part: serde_json::Map<String, Value> = ["exported_at", "activity_days", "page_credits", "chapters_read", "badges", "activity_signature"].iter().map(|k| (k.to_string(), doc[*k].clone())).collect();
        part.insert("user".into(), json!({ "id": id }));
        let (st, v) = call(&app, "POST", "/me/restore-activity", Some(&anna), Value::Object(part)).await;
        assert_eq!((st, &restored(&v)[..3]), (200, &[3, 2, 2][..]), "{v}");
    }
}
