use crate::auth::{admin_mode, random_token, AuthUser, User, ADMIN_MODE_SQL};
use crate::badges::check_badges;
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::{extract::{Path, State}, routing::{delete, get, post}, Json, Router};
use crate::activity;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeSet;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Serialize, Clone)]
pub struct Group { pub id: i64, pub name: String, pub slug: String, pub description: Option<String>, pub owner_id: i64, pub created_at: String, pub member_count: i64, pub role: Option<String>, #[serde(skip_serializing_if = "Option::is_none")] pub invite_code: Option<String>, pub streak_enabled: bool,
    /// The path the group walks together (paths::BUILT_IN) and when it set out; None while it walks none.
    pub path_id: Option<String>, pub path_started_at: Option<String>, pub path_target_date: Option<String>,
    /// The reader is a site admin in Admin mode who is not a member: here to moderate, with the group admins' rights.
    #[serde(skip_serializing_if = "std::ops::Not::not")] pub site_admin: bool }
/// A group event as the API sends it. `books` is what counts for the chapter-based metrics: `books_json` when set, else
/// the legacy `book_from`..`book_to` range spelled out, else None (every book). The four option strings are validated
/// against VISIBILITIES / COUNTS_FROM / REPEATS; their meaning is in docs/API.md, Groups.
#[derive(Serialize, Clone, Deserialize)]
pub struct Event {
    pub id: i64, pub group_id: i64, pub name: String, pub metric: String, pub starts_at: String, pub ends_at: String, pub time_weight: f64, pub page_weight: f64, pub goal: Option<f64>,
    pub book_from: Option<i64>, pub book_to: Option<i64>, pub created_by: i64, pub created_at: String,
    pub description: Option<String>, pub books: Option<Vec<i64>>, pub visibility: String, pub counts_from: String, pub repeat: String, pub late_join: bool,
    /// Set once the repeat sweep has created the next window from this one; that happens once per row.
    pub renewed_at: Option<String>,
}
pub const METRICS: [&str; 5] = ["active_minutes", "pages", "chapters", "score", "streak"];
pub const VISIBILITIES: [&str; 2] = ["members", "private_admin"];
pub const COUNTS_FROM: [&str; 2] = ["event_start", "group_join"];
pub const REPEATS: [&str; 3] = ["none", "weekly", "monthly"];

fn slugify(s: &str) -> String {
    let mut out = String::new(); let mut dash = false;
    for c in s.to_lowercase().chars() { if c.is_ascii_alphanumeric() { out.push(c); dash = false; } else if !dash && !out.is_empty() { out.push('-'); dash = true; } }
    let out = out.trim_end_matches('-').chars().take(40).collect::<String>();
    if out.is_empty() { "group".into() } else { out }
}
const COLS: &str = "g.id, g.name, g.slug, g.description, g.owner_id, g.created_at, (SELECT count(*) FROM group_members m WHERE m.group_id=g.id), (SELECT role FROM group_members m WHERE m.group_id=g.id AND m.user_id=?1), g.invite_code, g.streak_enabled, g.path_id, g.path_started_at, g.path_target_date";
fn row(r: &rusqlite::Row) -> rusqlite::Result<Group> { Ok(Group { id: r.get(0)?, name: r.get(1)?, slug: r.get(2)?, description: r.get(3)?, owner_id: r.get(4)?, created_at: r.get(5)?, member_count: r.get(6)?, role: r.get(7)?, invite_code: r.get(8)?, streak_enabled: r.get::<_, i64>(9)? != 0, path_id: r.get(10)?, path_started_at: r.get(11)?, path_target_date: r.get(12)?, site_admin: false }) }
fn load(conn: &Connection, slug: &str, uid: i64) -> rusqlite::Result<Option<Group>> { conn.query_row(&format!("SELECT {COLS} FROM groups g WHERE g.slug=?2"), params![uid, slug], row).optional() }
/// A site admin in Admin mode passes as one of the group's admins, member or not (`site_admin` when not).
fn require_member(conn: &Connection, slug: &str, u: &User, admin: bool) -> ApiResult<Group> {
    let Some(mut g) = load(conn, slug, u.id)? else { return Err(ApiError::not_found("no such group")) };
    if admin_mode(u) && g.role.as_deref() != Some("admin") { g.site_admin = g.role.is_none(); g.role = Some("admin".into()); }
    if g.role.is_none() { return Err(ApiError::not_found("no such group")); }
    if admin && g.role.as_deref() != Some("admin") { return Err(ApiError::forbidden("group admins only")); }
    Ok(g)
}
fn event_row(r: &rusqlite::Row) -> rusqlite::Result<Event> {
    let (book_from, book_to): (Option<i64>, Option<i64>) = (r.get(9)?, r.get(10)?);
    let books = match r.get::<_, Option<String>>(14)?.and_then(|j| serde_json::from_str::<Vec<i64>>(&j).ok()) {
        Some(b) if !b.is_empty() => Some(b),
        _ => book_from.map(|a| (a..=book_to.unwrap_or(a).max(a)).collect()),
    };
    Ok(Event { id: r.get(0)?, group_id: r.get(1)?, name: r.get(2)?, metric: r.get(3)?, starts_at: r.get(4)?, ends_at: r.get(5)?, time_weight: r.get(6)?, page_weight: r.get(7)?, goal: r.get(8)?, book_from, book_to, created_by: r.get(11)?, created_at: r.get(12)?,
        description: r.get(13)?, books, visibility: r.get(15)?, counts_from: r.get(16)?, repeat: r.get(17)?, late_join: r.get::<_, i64>(18)? != 0, renewed_at: r.get(19)? })
}
const EV_COLS: &str = "id, group_id, name, metric, starts_at, ends_at, time_weight, page_weight, goal, book_from, book_to, created_by, created_at, description, books_json, visibility, counts_from, repeat, late_join, renewed_at";
fn load_event(conn: &Connection, id: i64, gid: i64) -> rusqlite::Result<Option<Event>> { conn.query_row(&format!("SELECT {EV_COLS} FROM group_events WHERE id=?1 AND group_id=?2"), params![id, gid], event_row).optional() }

async fn list(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Vec<Group>>> {
    let conn = s.pool.get()?;
    let mut st = conn.prepare_cached(&format!("SELECT {COLS} FROM groups g JOIN group_members mm ON mm.group_id=g.id AND mm.user_id=?1 ORDER BY g.name"))?;
    let rows = st.query_map(params![u.id], |r| { let mut g = row(r)?; if g.role.as_deref() != Some("admin") { g.invite_code = None; } Ok(g) })?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(rows))
}
#[derive(Deserialize)] struct CreateIn { name: String, description: Option<String> }
async fn create(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<CreateIn>) -> ApiResult<Json<Group>> {
    let name = b.name.trim();
    if name.chars().count() < 2 || name.chars().count() > 60 { return Err(ApiError::bad("name: 2-60 characters")); }
    let mut conn = s.pool.get()?;
    let mut slug = slugify(name);
    if conn.query_row("SELECT 1 FROM groups WHERE slug=?1", params![slug], |_| Ok(())).optional()?.is_some() { slug = format!("{}-{}", slug, random_token(4).to_lowercase()); }
    let tx = conn.transaction()?;
    tx.execute("INSERT INTO groups (name, slug, description, owner_id, invite_code) VALUES (?1,?2,?3,?4,?5)", params![name, slug, b.description, u.id, random_token(8)])?;
    let gid = tx.last_insert_rowid();
    tx.execute("INSERT INTO group_members (group_id, user_id, role) VALUES (?1,?2,'admin')", params![gid, u.id])?;
    tx.commit()?;
    check_badges(&conn, u.id)?;
    Ok(Json(load(&conn, &slug, u.id)?.unwrap()))
}
#[derive(Deserialize)] struct JoinIn { invite_code: String }
async fn join(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<JoinIn>) -> ApiResult<Json<Group>> {
    let conn = s.pool.get()?;
    let slug: Option<String> = conn.query_row("SELECT slug FROM groups WHERE invite_code=?1", params![b.invite_code.trim()], |r| r.get(0)).optional()?;
    let Some(slug) = slug else { return Err(ApiError::not_found("invalid invite code")) };
    conn.execute("INSERT OR IGNORE INTO group_members (group_id, user_id) SELECT id, ?1 FROM groups WHERE slug=?2", params![u.id, slug])?;
    check_badges(&conn, u.id)?;
    let mut g = load(&conn, &slug, u.id)?.unwrap();
    if g.role.as_deref() != Some("admin") { g.invite_code = None; }
    Ok(Json(g))
}
async fn detail(State(s): State<AppState>, AuthUser(u): AuthUser, Path(slug): Path<String>) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    let g = require_member(&conn, &slug, &u, false)?;
    let members: Vec<Value> = { let mut st = conn.prepare_cached(&format!("SELECT u.id, u.handle, u.display_name, m.role, m.joined_at, u.avatar, {ADMIN_MODE_SQL} FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=?1 ORDER BY m.role, u.display_name"))?;
        let v: Vec<Value> = st.query_map(params![g.id], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "handle": r.get::<_, String>(1)?, "display_name": r.get::<_, String>(2)?, "role": r.get::<_, String>(3)?, "joined_at": r.get::<_, String>(4)?, "avatar": crate::avatars::effective(r.get(0)?, r.get::<_, Option<String>>(5)?.as_deref()), "staff": r.get::<_, bool>(6)? })))?.collect::<Result<_, _>>()?; v };
    let events: Vec<Event> = { let mut st = conn.prepare_cached(&format!("SELECT {EV_COLS} FROM group_events WHERE group_id=?1 ORDER BY starts_at DESC"))?; let rows_ = st.query_map(params![g.id], event_row)?.collect::<Result<_, _>>()?; rows_ };
    let mut v = serde_json::to_value(&g).unwrap();
    if g.role.as_deref() != Some("admin") { v.as_object_mut().unwrap().remove("invite_code"); }
    v["members"] = json!(members); v["events"] = json!(events);
    v["streak"] = if g.streak_enabled { json!(group_streak(&conn, g.id)?) } else { Value::Null };
    let ed = s.edition().await;
    v["path"] = group_path(&conn, &g, ed)?;
    v["path_id"] = json!(g.path_id.as_deref().map(|p| crate::edition::shown_path(ed, p)));
    Ok(Json(v))
}
/// The group's path with each member's place on it from their own chapters credited since the group set out
/// (docs/PATHS.md rule 5); null while the group walks none. Members in the detail's order. The path is the one the
/// edition shows (edition::shown_path): a group on the Coates path walks the Synopsis path while Coates is hidden.
fn group_path(conn: &Connection, g: &Group, ed: crate::edition::Edition) -> rusqlite::Result<Value> {
    let (Some(id), Some(started)) = (&g.path_id, &g.path_started_at) else { return Ok(Value::Null) };
    let id = crate::edition::shown_path(ed, id);
    let Some(chapters) = crate::paths::chapters_of(id) else { return Ok(Value::Null) };
    let mut st = conn.prepare_cached("SELECT m.user_id FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=?1 ORDER BY m.role, u.display_name")?;
    let ids: Vec<i64> = st.query_map(params![g.id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    let mut members = Vec::with_capacity(ids.len());
    for uid in ids {
        let (done, position) = crate::paths::place(&chapters, &crate::paths::read_since(conn, uid, started)?);
        members.push(json!({ "user_id": uid, "done": done, "position": position }));
    }
    Ok(json!({ "id": id, "started_at": started, "target_date": g.path_target_date, "members": members }))
}
#[derive(Deserialize)] struct GroupPathIn { path_id: Option<String>, #[serde(default)] restart: bool, #[serde(default, deserialize_with = "some")] target_date: Option<Option<String>> }
fn some<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> { T::deserialize(d).map(Some) }
/// Admins set the path the group walks: a built-in id starts it now (the same id again changes only the target unless
/// `restart`; `target_date` YYYY-MM-DD or null, absent leaves it), null takes it off. Answers as the detail does.
async fn set_path(State(s): State<AppState>, AuthUser(u): AuthUser, Path(slug): Path<String>, Json(b): Json<GroupPathIn>) -> ApiResult<Json<Value>> {
    let ed = s.edition().await;
    let conn = s.pool.get()?;
    let g = require_member(&conn, &slug, &u, true)?;
    // the path as shown counts as the same path: a new target for the Synopsis path the members see keeps the stored one
    let same = |id: &str| g.path_id.as_deref().is_some_and(|p| p == id || crate::edition::shown_path(ed, p) == id);
    match &b.path_id {
        None => { conn.execute("UPDATE groups SET path_id=NULL, path_started_at=NULL WHERE id=?1", params![g.id])?; }
        Some(id) if !crate::paths::BUILT_IN.contains(&id.as_str()) || (crate::edition::shown_path(ed, id) != id && !same(id)) => return Err(ApiError::bad("path_id: a group walks one of the built-in paths")),
        Some(_) if b.target_date.as_ref().is_some_and(|t| t.as_deref().is_some_and(|d| !crate::paths::is_day(d))) => return Err(ApiError::bad("target_date: a day as YYYY-MM-DD, or null")),
        Some(id) if same(id) && !b.restart => {
            if let Some(t) = &b.target_date { conn.execute("UPDATE groups SET path_target_date=?1 WHERE id=?2", params![t, g.id])?; }
        }
        Some(id) => { conn.execute("UPDATE groups SET path_id=?1, path_started_at=?2, path_target_date=?3 WHERE id=?4", params![id, crate::db::now_iso(), b.target_date.clone().flatten(), g.id])?; }
    }
    let g = load(&conn, &slug, u.id)?.unwrap();
    let mut v = serde_json::to_value(&g).unwrap();
    v["path"] = group_path(&conn, &g, ed)?;
    v["path_id"] = json!(g.path_id.as_deref().map(|p| crate::edition::shown_path(ed, p)));
    Ok(Json(v))
}
#[derive(Deserialize)] struct PatchIn { name: Option<String>, description: Option<Option<String>>, rotate_invite: Option<bool>, streak_enabled: Option<bool> }
async fn patch(State(s): State<AppState>, AuthUser(u): AuthUser, Path(slug): Path<String>, Json(b): Json<PatchIn>) -> ApiResult<Json<Group>> {
    let conn = s.pool.get()?;
    let g = require_member(&conn, &slug, &u, true)?;
    if let Some(on) = b.streak_enabled {
        if g.owner_id != u.id { return Err(ApiError::forbidden("only the group's owner turns the group streak on or off")); }
        conn.execute("UPDATE groups SET streak_enabled=?1 WHERE id=?2", params![on as i64, g.id])?;
    }
    if let Some(n) = &b.name { if n.trim().chars().count() < 2 || n.chars().count() > 60 { return Err(ApiError::bad("name: 2-60 characters")); } }
    conn.execute("UPDATE groups SET name=coalesce(?1, name), description=CASE WHEN ?2 THEN ?3 ELSE description END, invite_code=CASE WHEN ?4 THEN ?5 ELSE invite_code END WHERE id=?6",
        params![b.name.as_deref().map(str::trim), b.description.is_some(), b.description.clone().flatten(), b.rotate_invite.unwrap_or(false), random_token(8), g.id])?;
    Ok(Json(load(&conn, &slug, u.id)?.unwrap()))
}
async fn leave(State(s): State<AppState>, AuthUser(u): AuthUser, Path(slug): Path<String>) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    let g = require_member(&conn, &slug, &u, false)?;
    if g.owner_id == u.id { return Err(ApiError::bad("the owner cannot leave; transfer ownership first")); }
    conn.execute("DELETE FROM group_members WHERE group_id=?1 AND user_id=?2", params![g.id, u.id])?;
    Ok(Json(json!({ "ok": true })))
}
#[derive(Deserialize)] struct RoleIn { role: String }
async fn set_role(State(s): State<AppState>, AuthUser(u): AuthUser, Path((slug, target)): Path<(String, i64)>, Json(b): Json<RoleIn>) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    let g = require_member(&conn, &slug, &u, true)?;
    if !["admin", "member"].contains(&b.role.as_str()) { return Err(ApiError::bad("role")); }
    if target == g.owner_id && b.role != "admin" { return Err(ApiError::bad("the owner stays admin")); }
    conn.execute("UPDATE group_members SET role=?1 WHERE group_id=?2 AND user_id=?3", params![b.role, g.id, target])?;
    Ok(Json(json!({ "ok": true })))
}
async fn remove_member(State(s): State<AppState>, AuthUser(u): AuthUser, Path((slug, target)): Path<(String, i64)>) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    let g = require_member(&conn, &slug, &u, true)?;
    if target == g.owner_id { return Err(ApiError::bad("cannot remove the owner")); }
    conn.execute("DELETE FROM group_members WHERE group_id=?1 AND user_id=?2", params![g.id, target])?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize, Default)]
struct EventIn {
    name: Option<String>, metric: Option<String>, starts_at: Option<String>, ends_at: Option<String>, time_weight: Option<f64>, page_weight: Option<f64>, goal: Option<Option<f64>>,
    book_from: Option<Option<i64>>, book_to: Option<Option<i64>>,
    /// `books`: the list of book numbers that count (empty or null = every book); when sent it replaces book_from/book_to.
    description: Option<Option<String>>, books: Option<Option<Vec<i64>>>, visibility: Option<String>, counts_from: Option<String>, repeat: Option<String>, late_join: Option<bool>,
}
/// Every value an event row is written from, resolved from the request and (for an edit) the current row.
#[derive(Clone, Debug, PartialEq)]
pub struct EventFields {
    pub name: String, pub metric: String, pub starts_at: String, pub ends_at: String, pub time_weight: f64, pub page_weight: f64, pub goal: Option<f64>,
    pub book_from: Option<i64>, pub book_to: Option<i64>, pub description: Option<String>, pub books: Option<Vec<i64>>,
    pub visibility: String, pub counts_from: String, pub repeat: String, pub late_join: bool,
}
impl Default for EventFields {
    fn default() -> Self { EventFields { name: String::new(), metric: "active_minutes".into(), starts_at: String::new(), ends_at: String::new(), time_weight: 1.0, page_weight: 4.0, goal: None, book_from: None, book_to: None, description: None, books: None, visibility: "members".into(), counts_from: "event_start".into(), repeat: "none".into(), late_join: true } }
}
/// An existing row's values, the base an edit and a renewal start from.
fn fields_of(ev: &Event) -> EventFields {
    EventFields { name: ev.name.clone(), metric: ev.metric.clone(), starts_at: ev.starts_at.clone(), ends_at: ev.ends_at.clone(), time_weight: ev.time_weight, page_weight: ev.page_weight, goal: ev.goal, book_from: ev.book_from, book_to: ev.book_to,
        description: ev.description.clone(), books: ev.books.clone(), visibility: ev.visibility.clone(), counts_from: ev.counts_from.clone(), repeat: ev.repeat.clone(), late_join: ev.late_join }
}
/// A list of books as stored: sorted, without repeats; empty means every book and is stored as NULL.
fn normal_books(b: Vec<i64>) -> Option<Vec<i64>> { let set: BTreeSet<i64> = b.into_iter().collect(); if set.is_empty() { None } else { Some(set.into_iter().collect()) } }
fn resolve(b: EventIn, base: EventFields) -> EventFields {
    let mut f = base;
    if let Some(v) = b.name { f.name = v.trim().to_string(); }
    if let Some(v) = b.metric { f.metric = v; }
    if let Some(v) = b.starts_at { f.starts_at = v; }
    if let Some(v) = b.ends_at { f.ends_at = v; }
    if let Some(v) = b.time_weight { f.time_weight = v; }
    if let Some(v) = b.page_weight { f.page_weight = v; }
    if let Some(v) = b.goal { f.goal = v; }
    if let Some(v) = b.description { f.description = v.map(|d| d.trim().to_string()).filter(|d| !d.is_empty()); }
    if let Some(v) = b.visibility { f.visibility = v; }
    if let Some(v) = b.counts_from { f.counts_from = v; }
    if let Some(v) = b.repeat { f.repeat = v; }
    if let Some(v) = b.late_join { f.late_join = v; }
    match b.books {
        // a list replaces the range, whatever else the request says about it
        Some(v) => { f.books = v.and_then(normal_books); f.book_from = None; f.book_to = None; }
        None => {
            if let Some(v) = b.book_from { f.book_from = v; f.books = None; }
            if let Some(v) = b.book_to { f.book_to = v; f.books = None; }
            if let Some(a) = f.book_from { if f.book_to.is_none_or(|t| t < a) { f.book_to = Some(a); } } else { f.book_to = None; }
        }
    }
    f
}
fn is_date(s: &str) -> bool { s.len() == 10 && s.as_bytes()[4] == b'-' && s.as_bytes()[7] == b'-' && s.chars().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()) && activity::parse_day(s).is_some() }
/// Mirrored by client/src/lib/events.ts `problems`, so the form says the same before the server has to.
pub fn validate_event(f: &EventFields) -> ApiResult<()> {
    if f.name.chars().count() < 2 || f.name.chars().count() > 80 { return Err(ApiError::bad("name: 2-80 characters")); }
    if !METRICS.contains(&f.metric.as_str()) { return Err(ApiError::bad("metric")); }
    if !is_date(&f.starts_at) || !is_date(&f.ends_at) { return Err(ApiError::bad("dates must be YYYY-MM-DD")); }
    if f.ends_at < f.starts_at { return Err(ApiError::bad("ends before it starts")); }
    if !(0.0..=100.0).contains(&f.time_weight) || !(0.0..=100.0).contains(&f.page_weight) { return Err(ApiError::bad("weights: 0 to 100")); }
    if f.goal.is_some_and(|g| !(g >= 0.0) || g > 1e9) { return Err(ApiError::bad("goal: 0 or more")); }
    if f.description.as_deref().is_some_and(|d| d.chars().count() > 120) { return Err(ApiError::bad("description: up to 120 characters")); }
    if f.books.as_deref().is_some_and(|b| b.iter().any(|n| !(1..=66).contains(n))) { return Err(ApiError::bad("books: numbers 1 to 66")); }
    if [f.book_from, f.book_to].iter().flatten().any(|n| !(1..=66).contains(n)) { return Err(ApiError::bad("book range: 1 to 66")); }
    if !VISIBILITIES.contains(&f.visibility.as_str()) { return Err(ApiError::bad("visibility")); }
    if !COUNTS_FROM.contains(&f.counts_from.as_str()) { return Err(ApiError::bad("counts_from")); }
    if !REPEATS.contains(&f.repeat.as_str()) { return Err(ApiError::bad("repeat")); }
    Ok(())
}
fn books_json(f: &EventFields) -> Option<String> { f.books.as_ref().map(|b| serde_json::to_string(b).unwrap_or_default()) }
fn insert_event(conn: &Connection, gid: i64, f: &EventFields, by: i64) -> rusqlite::Result<i64> {
    conn.execute("INSERT INTO group_events (group_id, name, metric, starts_at, ends_at, time_weight, page_weight, goal, book_from, book_to, created_by, description, books_json, visibility, counts_from, repeat, late_join) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
        params![gid, f.name, f.metric, f.starts_at, f.ends_at, f.time_weight, f.page_weight, f.goal, f.book_from, f.book_to, by, f.description, books_json(f), f.visibility, f.counts_from, f.repeat, f.late_join as i64])?;
    Ok(conn.last_insert_rowid())
}
async fn create_event(State(s): State<AppState>, AuthUser(u): AuthUser, Path(slug): Path<String>, Json(b): Json<EventIn>) -> ApiResult<Json<Event>> {
    let conn = s.pool.get()?;
    let g = require_member(&conn, &slug, &u, true)?;
    let f = resolve(b, EventFields::default());
    validate_event(&f)?;
    let id = insert_event(&conn, g.id, &f, u.id)?;
    Ok(Json(load_event(&conn, id, g.id)?.unwrap()))
}
async fn patch_event(State(s): State<AppState>, AuthUser(u): AuthUser, Path((slug, id)): Path<(String, i64)>, Json(b): Json<EventIn>) -> ApiResult<Json<Event>> {
    let conn = s.pool.get()?;
    let g = require_member(&conn, &slug, &u, true)?;
    let Some(cur) = load_event(&conn, id, g.id)? else { return Err(ApiError::not_found("no such event")) };
    let f = resolve(b, fields_of(&cur));
    validate_event(&f)?;
    conn.execute("UPDATE group_events SET name=?1, metric=?2, starts_at=?3, ends_at=?4, time_weight=?5, page_weight=?6, goal=?7, book_from=?8, book_to=?9, description=?10, books_json=?11, visibility=?12, counts_from=?13, repeat=?14, late_join=?15 WHERE id=?16",
        params![f.name, f.metric, f.starts_at, f.ends_at, f.time_weight, f.page_weight, f.goal, f.book_from, f.book_to, f.description, books_json(&f), f.visibility, f.counts_from, f.repeat, f.late_join as i64, id])?;
    Ok(Json(load_event(&conn, id, g.id)?.unwrap()))
}
async fn delete_event(State(s): State<AppState>, AuthUser(u): AuthUser, Path((slug, id)): Path<(String, i64)>) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    let g = require_member(&conn, &slug, &u, true)?;
    conn.execute("DELETE FROM group_events WHERE id=?1 AND group_id=?2", params![id, g.id])?;
    Ok(Json(json!({ "ok": true })))
}

/// `rank` is the place on the full board, kept when a private board is cut down to the reader's own row.
#[derive(Serialize)]
pub struct Row { pub user_id: i64, pub handle: String, pub display_name: String, pub value: f64, pub active_seconds: i64, pub pages: i64, pub chapters: i64, pub rank: i64, pub staff: bool }
/// Every member's figures for `ev`, best first. Each member is counted from the event's start, or from the day they
/// joined when that is earlier and `counts_from` is `group_join`; with `late_join` off a member who joined after the
/// start is left off the board altogether. `books` restricts the chapter-based columns only: minutes and streak
/// are whatever was read.
pub fn leaderboard(conn: &Connection, ev: &Event) -> rusqlite::Result<Vec<Row>> {
    let scope = match &ev.books { Some(b) if !b.is_empty() => format!(" AND p.book IN ({})", b.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(",")), _ => String::new() };
    let mut mst = conn.prepare_cached(&format!("SELECT u.id, u.handle, u.display_name, m.joined_at, {ADMIN_MODE_SQL} FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=?1"))?;
    let members: Vec<(i64, String, String, String, bool)> = mst.query_map(params![ev.group_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?.collect::<Result<_, _>>()?;
    let mut st = conn.prepare(&format!("SELECT
        coalesce((SELECT sum(a.active_seconds) FROM activity_days a WHERE a.user_id=?1 AND a.date BETWEEN ?2 AND ?3), 0),
        coalesce((SELECT count(*) FROM page_credits p WHERE p.user_id=?1 AND p.date BETWEEN ?2 AND ?3{scope}), 0),
        coalesce((SELECT count(*) FROM chapters_read p WHERE p.user_id=?1 AND substr(p.first_read_at,1,10) BETWEEN ?2 AND ?3{scope}), 0)"))?;
    let mut rows: Vec<Row> = Vec::with_capacity(members.len());
    for (user_id, handle, display_name, joined_at, staff) in members {
        let joined = local_day_of(&joined_at, activity::user_offset(conn, user_id));
        if !ev.late_join && joined > ev.starts_at { continue; }
        let from = if ev.counts_from == "group_join" && joined < ev.starts_at { joined } else { ev.starts_at.clone() };
        let (active_seconds, pages, chapters): (i64, i64, i64) = st.query_row(params![user_id, from, ev.ends_at], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        let value = match ev.metric.as_str() {
            "active_minutes" => active_seconds as f64 / 60.0,
            "pages" => pages as f64,
            "chapters" => chapters as f64,
            "streak" => {
                // each member's own goal, as their own streak and the group streak count it (met_days)
                let days: Vec<String> = met_days(conn, user_id)?.into_iter().filter(|d| *d >= from && *d <= ev.ends_at).collect();
                let (mut best, mut run, mut prev): (i64, i64, Option<String>) = (0, 0, None);
                for d in days { run = match &prev { Some(p) if next_day(p) == d => run + 1, _ => 1 }; best = best.max(run); prev = Some(d); }
                best as f64
            }
            _ => (active_seconds as f64 / 60.0) * ev.time_weight + pages as f64 * ev.page_weight,
        };
        rows.push(Row { user_id, handle, display_name, value: (value * 10.0).round() / 10.0, active_seconds, pages, chapters, rank: 0, staff });
    }
    rows.sort_by(|a, b| b.value.partial_cmp(&a.value).unwrap_or(std::cmp::Ordering::Equal));
    for (i, r) in rows.iter_mut().enumerate() { r.rank = i as i64 + 1; }
    Ok(rows)
}
fn next_day(d: &str) -> String {
    let dt = time::Date::parse(d, &time::macros::format_description!("[year]-[month]-[day]")).unwrap() + time::Duration::days(1);
    format!("{:04}-{:02}-{:02}", dt.year(), u8::from(dt.month()), dt.day())
}
/// `private`: the board was cut down to the reader's own row (`visibility` private_admin, reader not an admin).
async fn event_leaderboard(State(s): State<AppState>, AuthUser(u): AuthUser, Path((slug, id)): Path<(String, i64)>) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    let g = require_member(&conn, &slug, &u, false)?;
    let Some(ev) = load_event(&conn, id, g.id)? else { return Err(ApiError::not_found("no such event")) };
    let mut rows = leaderboard(&conn, &ev)?;
    let private = ev.visibility == "private_admin" && g.role.as_deref() != Some("admin");
    if private { rows.retain(|r| r.user_id == u.id); }
    Ok(Json(json!({ "event": ev, "rows": rows, "private": private })))
}

// ---------------- repeating events ----------------

/// A month on: the same day of the month, or the last day of the next month when the day was its month's last (or
/// does not exist there), so "1–30 Sept" becomes "1–31 Oct".
fn add_month(d: time::Date) -> time::Date {
    let (y, m) = if d.month() == time::Month::December { (d.year() + 1, time::Month::January) } else { (d.year(), d.month().next()) };
    let last = time::util::days_in_month(m, y);
    let day = if d.day() == time::util::days_in_month(d.month(), d.year()) { last } else { d.day().min(last) };
    time::Date::from_calendar_date(y, m, day).unwrap()
}
/// The window a repeating event goes on with: stepped a week or a month at a time from its own dates until the end
/// is `today` or later, so an event that lapsed for a while skips the windows nobody could read for.
pub fn next_window(starts_at: &str, ends_at: &str, repeat: &str, today: &str) -> Option<(String, String)> {
    let (mut a, mut e) = (activity::parse_day(starts_at)?, activity::parse_day(ends_at)?);
    let today = activity::parse_day(today)?;
    for _ in 0..2000 {
        match repeat { "weekly" => { a += time::Duration::weeks(1); e += time::Duration::weeks(1); } "monthly" => { a = add_month(a); e = add_month(e); } _ => return None }
        if e >= today { return Some((activity::day_key(a), activity::day_key(e))); }
    }
    None
}
/// Every repeating event whose window has ended (by the UTC day `today`) and has not been renewed gets its next
/// window as a new event, same name and options, and is marked renewed. Run from main every minute.
pub fn sweep_repeats(conn: &Connection, today: &str) -> rusqlite::Result<usize> {
    let due: Vec<Event> = { let mut st = conn.prepare_cached(&format!("SELECT {EV_COLS} FROM group_events WHERE repeat<>'none' AND renewed_at IS NULL AND ends_at < ?1"))?; let v = st.query_map(params![today], event_row)?.collect::<Result<_, _>>()?; v };
    let mut n = 0;
    for ev in due {
        let Some((starts_at, ends_at)) = next_window(&ev.starts_at, &ev.ends_at, &ev.repeat, today) else { continue };
        let f = EventFields { starts_at, ends_at, ..fields_of(&ev) };
        let tx = conn.unchecked_transaction()?;
        insert_event(&tx, ev.group_id, &f, ev.created_by)?;
        tx.execute("UPDATE group_events SET renewed_at=?1 WHERE id=?2", params![crate::db::now_iso(), ev.id])?;
        tx.commit()?;
        n += 1;
    }
    Ok(n)
}

async fn feed(State(s): State<AppState>, AuthUser(u): AuthUser, Path(slug): Path<String>) -> ApiResult<Json<Vec<Value>>> {
    let conn = s.pool.get()?;
    let g = require_member(&conn, &slug, &u, false)?;
    // jottings and site admins' notices; the free text of posts from before versionCode 36 stays out. A site admin in
    // Admin mode also sees what moderation has hidden, flagged `hidden`
    let mut st = conn.prepare_cached(&format!("SELECT p.id, p.body, p.created_at, p.outline_id, u.handle, u.display_name, o.title, o.share_code, p.user_id, p.hidden, u.avatar, p.notice, {ADMIN_MODE_SQL} FROM group_posts p JOIN users u ON u.id=p.user_id LEFT JOIN outlines o ON o.id=p.outline_id
        WHERE p.group_id=?1 AND (p.outline_id IS NOT NULL OR p.notice=1) AND (p.hidden=0 OR p.user_id=?2 OR ?3) AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id=?2) ORDER BY p.created_at DESC LIMIT 100"))?;
    let rows = st.query_map(params![g.id, u.id, admin_mode(&u)], |r| { let notice = r.get::<_, i64>(11)? == 1; Ok(json!({ "id": r.get::<_, i64>(0)?, "body": if notice { r.get::<_, String>(1)? } else { String::new() }, "notice": notice, "created_at": r.get::<_, String>(2)?, "outline_id": r.get::<_, Option<i64>>(3)?, "handle": r.get::<_, String>(4)?, "display_name": r.get::<_, String>(5)?, "outline_title": r.get::<_, Option<String>>(6)?, "share_code": r.get::<_, Option<String>>(7)?, "user_id": r.get::<_, i64>(8)?, "hidden": r.get::<_, i64>(9)?, "avatar": crate::avatars::effective(r.get(8)?, r.get::<_, Option<String>>(10)?.as_deref()), "staff": r.get::<_, bool>(12)? })) })?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(rows))
}
#[derive(Deserialize)] struct PostIn { #[serde(default)] body: String, outline_id: Option<i64> }
async fn post_create(State(s): State<AppState>, AuthUser(u): AuthUser, Path(slug): Path<String>, Json(b): Json<PostIn>) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    let g = require_member(&conn, &slug, &u, false)?;
    // a group shares jottings, nothing else: no free text of its own (versionCode 36); the feed shows only these. The
    // one exception is a site admin in Admin mode, whose text goes up as a notice under the Developer badge, unscanned
    if !b.body.trim().is_empty() {
        if !admin_mode(&u) { return Err(ApiError::bad(format!("a group shares {} only", crate::brand::get().noun.many))); }
        let body = b.body.trim();
        if body.chars().count() > 2000 { return Err(ApiError::bad("a notice: up to 2,000 characters")); }
        conn.execute("INSERT INTO group_posts (group_id, user_id, outline_id, body, notice) VALUES (?1,?2,NULL,?3,1)", params![g.id, u.id, body])?;
        return Ok(Json(json!({ "id": conn.last_insert_rowid() })));
    }
    let Some(oid) = b.outline_id else { return Err(ApiError::bad(format!("choose {} to share", crate::brand::get().noun.a))) };
    let o: Option<(i64, String)> = conn.query_row("SELECT user_id, visibility FROM outlines WHERE id=?1", params![oid], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    match o { Some((uid, vis)) if uid == u.id => { if vis == "private" { conn.execute("UPDATE outlines SET visibility='link' WHERE id=?1", params![oid])?; } } _ => return Err(ApiError::forbidden("not your outline")) }
    conn.execute("INSERT INTO group_posts (group_id, user_id, outline_id, body) VALUES (?1,?2,?3,'')", params![g.id, u.id, oid])?;
    let pid = conn.last_insert_rowid();
    crate::moderation::auto_scan(&conn, "post", pid)?;
    Ok(Json(json!({ "id": pid })))
}
async fn post_delete(State(s): State<AppState>, AuthUser(u): AuthUser, Path((slug, id)): Path<(String, i64)>) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    let g = require_member(&conn, &slug, &u, false)?;
    conn.execute("DELETE FROM group_posts WHERE id=?1 AND group_id=?2 AND (user_id=?3 OR ?4)", params![id, g.id, u.id, g.role.as_deref() == Some("admin")])?;
    Ok(Json(json!({ "ok": true })))
}

// ---------------- group streaks ----------------

/// A reader's met days: their own daily goal of minutes met (`activity::day_met`), on their own local dates. The group streak and
/// an event's streak metric both count days through this, as the reader's own streak does (activity::streak_info).
pub fn met_days(conn: &Connection, uid: i64) -> rusqlite::Result<BTreeSet<String>> {
    let goal = activity::daily_goal_seconds(conn, uid);
    let mut st = conn.prepare_cached("SELECT date FROM activity_days WHERE user_id=?1 AND active_seconds >= ?2")?;
    let v = st.query_map(params![uid, goal], |r| r.get(0))?.collect(); v
}

/// One member as the group streak sees them: the local day they joined, their today, their met days.
pub struct Member { pub id: i64, pub joined: String, pub today: String, pub met: BTreeSet<String> }

#[derive(Serialize, Debug, PartialEq)]
pub struct MemberToday { pub id: i64, pub met: bool }
#[derive(Serialize, Debug)]
pub struct GroupStreak {
    pub current: i64, pub longest: i64,
    /// The group's day: the earliest of the members' todays, the one still open for at least one of them.
    pub day: String, pub kept: bool, pub run_start: Option<String>,
    /// kept, waiting, lapsed or none, as a friend streak (friends.rs)
    pub state: &'static str,
    /// Who has met their own today, and how many of how many.
    pub today: Vec<MemberToday>, pub met_today: usize, pub members: usize,
}

fn shift(d: &str, n: i64) -> String { activity::parse_day(d).map(|x| activity::day_key(x + time::Duration::days(n))).unwrap_or_else(|| d.to_string()) }
/// How far back a group streak is looked for: a year and a little, as a reader's streak.
const LOOKBACK: i64 = 400;

/// The group streak: consecutive dates on which every member who had joined by then met their own goal, each on their
/// own local day. A member counts from the day they joined, so joining never breaks a run; it is computed from the
/// current members, so a member who has left no longer counts for any day, past or future.
pub fn group_streak_of(members: &[Member]) -> GroupStreak {
    let today: Vec<MemberToday> = members.iter().map(|m| MemberToday { id: m.id, met: m.met.contains(&m.today) }).collect();
    let met_today = today.iter().filter(|t| t.met).count();
    let (Some(day), Some(last), Some(start)) = (members.iter().map(|m| m.today.clone()).min(), members.iter().map(|m| m.today.clone()).max(), members.iter().map(|m| m.joined.clone()).min()) else {
        return GroupStreak { current: 0, longest: 0, day: String::new(), kept: false, run_start: None, state: "none", today, met_today, members: 0 };
    };
    let met = |d: &str| { let mut req = members.iter().filter(|m| m.joined.as_str() <= d).peekable(); req.peek().is_some() && req.all(|m| m.met.contains(d)) };
    let floor = { let f = shift(&last, -LOOKBACK); if f > start { f } else { start.clone() } };
    // the latest met day, then the run ending on it while that is the group's day or the one before
    let mut latest = None; let mut d = last.clone();
    while d >= floor { if met(&d) { latest = Some(d.clone()); break; } d = shift(&d, -1); }
    let (current, run_start) = match &latest {
        Some(l) if *l >= shift(&day, -1) => { let mut n = 0; let mut d = l.clone(); while d >= floor && met(&d) { n += 1; d = shift(&d, -1); } (n, Some(shift(l, 1 - n))) }
        _ => (0, None),
    };
    let mut longest = 0; let mut run = 0; let mut d = floor.clone();
    while d <= last { if met(&d) { run += 1; longest = longest.max(run); } else { run = 0; } d = shift(&d, 1); }
    let kept = current > 0 && latest.as_deref().is_some_and(|l| l >= day.as_str());
    let state = if kept { "kept" } else if current > 0 { "waiting" } else if longest > 0 { "lapsed" } else { "none" };
    GroupStreak { current, longest, day, kept, run_start, state, today, met_today, members: members.len() }
}

/// The local day `iso` (a stored UTC timestamp) fell on for a reader `offset_min` east of UTC.
fn local_day_of(iso: &str, offset_min: i64) -> String {
    time::OffsetDateTime::parse(iso, &time::format_description::well_known::Rfc3339).map(|t| activity::day_key(activity::local_date(t, offset_min))).unwrap_or_else(|_| iso.chars().take(10).collect())
}
fn members_of(conn: &Connection, gid: i64) -> rusqlite::Result<Vec<Member>> {
    let mut st = conn.prepare_cached("SELECT m.user_id, m.joined_at FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=?1 AND u.disabled=0")?;
    let rows: Vec<(i64, String)> = st.query_map(params![gid], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    rows.into_iter().map(|(id, joined)| Ok(Member { id, joined: local_day_of(&joined, activity::user_offset(conn, id)), today: activity::user_today(conn, id), met: met_days(conn, id)? })).collect()
}
pub fn group_streak(conn: &Connection, gid: i64) -> rusqlite::Result<GroupStreak> { Ok(group_streak_of(&members_of(conn, gid)?)) }

/// The longest group streak `uid` has been in the group for all of, over their groups with the streak on: a badge
/// needs the whole run, so a member who joined three days into it counts three.
pub fn best_group_streak(conn: &Connection, uid: i64, _today: &str) -> i64 {
    let run = || -> rusqlite::Result<i64> {
        let mut st = conn.prepare_cached("SELECT g.id FROM group_members m JOIN groups g ON g.id=m.group_id WHERE m.user_id=?1 AND g.streak_enabled=1")?;
        let gids: Vec<i64> = st.query_map(params![uid], |r| r.get(0))?.collect::<Result<_, _>>()?;
        let mut best = 0;
        for gid in gids {
            let members = members_of(conn, gid)?;
            let gs = group_streak_of(&members);
            let (Some(start), Some(me)) = (gs.run_start.as_deref(), members.iter().find(|m| m.id == uid)) else { continue };
            let from = if me.joined.as_str() > start { me.joined.clone() } else { start.to_string() };
            let end = shift(start, gs.current - 1);
            let span = activity::parse_day(&end).zip(activity::parse_day(&from)).map(|(e, f)| (e - f).whole_days() + 1).unwrap_or(0);
            best = best.max(span.min(gs.current));
        }
        Ok(best)
    };
    run().unwrap_or(0)
}

/// A beat has just met `uid`'s day: every member of their streak groups whose group streak now reaches a badge gets it.
pub fn on_day_met(conn: &Connection, uid: i64) -> rusqlite::Result<()> {
    let mut st = conn.prepare_cached("SELECT DISTINCT m2.user_id FROM group_members m JOIN groups g ON g.id=m.group_id AND g.streak_enabled=1 JOIN group_members m2 ON m2.group_id=g.id WHERE m.user_id=?1")?;
    let ids: Vec<i64> = st.query_map(params![uid], |r| r.get(0))?.collect::<Result<_, _>>()?;
    for id in ids { crate::badges::check_badges_prefixed(conn, id, &activity::user_today(conn, id), "group_streak_")?; }
    Ok(())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/join", post(join))
        .route("/{slug}", get(detail).patch(patch))
        .route("/{slug}/leave", post(leave))
        .route("/{slug}/path", axum::routing::put(set_path))
        .route("/{slug}/members/{user_id}/role", post(set_role))
        .route("/{slug}/members/{user_id}", delete(remove_member))
        .route("/{slug}/events", post(create_event))
        .route("/{slug}/events/{id}", axum::routing::patch(patch_event).delete(delete_event))
        .route("/{slug}/events/{id}/leaderboard", get(event_leaderboard))
        .route("/{slug}/feed", get(feed))
        .route("/{slug}/posts", post(post_create))
        .route("/{slug}/posts/{id}", delete(post_delete))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::{app, call, user};

    fn m(id: i64, joined: &str, today: &str, met: &[&str]) -> Member { Member { id, joined: joined.into(), today: today.into(), met: met.iter().map(|s| s.to_string()).collect() } }

    #[test]
    fn every_member_on_the_same_date_or_the_day_is_not_met() {
        let g = group_streak_of(&[m(1, "2026-09-01", "2026-09-26", &["2026-09-24", "2026-09-25", "2026-09-26"]), m(2, "2026-09-01", "2026-09-26", &["2026-09-23", "2026-09-24", "2026-09-25"])]);
        assert_eq!((g.current, g.kept, g.state, g.met_today, g.members), (2, false, "waiting", 1, 2));
        assert_eq!(g.run_start.as_deref(), Some("2026-09-24"));
        assert_eq!(g.today, [MemberToday { id: 1, met: true }, MemberToday { id: 2, met: false }]);
        let g = group_streak_of(&[m(1, "2026-09-01", "2026-09-26", &["2026-09-25", "2026-09-26"]), m(2, "2026-09-01", "2026-09-26", &["2026-09-25", "2026-09-26"])]);
        assert_eq!((g.current, g.kept, g.state), (2, true, "kept"));
    }

    #[test]
    fn a_member_counts_from_the_day_they_joined() {
        // Cara joins on the 25th: the 23rd and 24th needed only Anna and Ben
        let members = [
            m(1, "2026-09-01", "2026-09-26", &["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"]),
            m(2, "2026-09-01", "2026-09-26", &["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"]),
            m(3, "2026-09-25", "2026-09-26", &["2026-09-25", "2026-09-26"]),
        ];
        assert_eq!(group_streak_of(&members).current, 4);
        // a new member who has not read yet holds today open, and breaks nothing before it
        let members = [members[0].clone_m(), members[1].clone_m(), m(4, "2026-09-26", "2026-09-26", &[])];
        let g = group_streak_of(&members);
        assert_eq!((g.current, g.kept, g.state), (3, false, "waiting"), "the run to yesterday holds while today waits for the newcomer");
    }

    #[test]
    fn each_members_own_day_decides_and_the_group_waits_for_the_earliest() {
        // Anna in Sydney is on the 27th, Ben in Denver still on the 26th: the group's day is the 26th
        let g = group_streak_of(&[m(1, "2026-09-01", "2026-09-27", &["2026-09-25", "2026-09-26", "2026-09-27"]), m(2, "2026-09-01", "2026-09-26", &["2026-09-25", "2026-09-26"])]);
        assert_eq!((g.day.as_str(), g.current, g.kept), ("2026-09-26", 2, true));
        // a lapse, then nothing yet: lapsed, with the best run kept
        let g = group_streak_of(&[m(1, "2026-09-01", "2026-09-26", &["2026-09-20", "2026-09-21", "2026-09-26"]), m(2, "2026-09-01", "2026-09-26", &["2026-09-20", "2026-09-21"])]);
        assert_eq!((g.current, g.longest, g.state), (0, 2, "lapsed"));
        // before anyone joined nothing counts, however much was read
        let g = group_streak_of(&[m(1, "2026-09-26", "2026-09-26", &["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"])]);
        assert_eq!(g.current, 1);
        assert_eq!(group_streak_of(&[]).state, "none");
    }

    impl Member { fn clone_m(&self) -> Member { Member { id: self.id, joined: self.joined.clone(), today: self.today.clone(), met: self.met.clone() } } }

    #[tokio::test]
    async fn two_members_meeting_a_day_start_the_group_streak_and_badges_need_the_whole_run() {
        let (app, pool) = app();
        let (anna_id, anna) = user(&pool, "anna");
        let (ben_id, ben) = user(&pool, "ben");
        let (_, g) = call(&app, "POST", "/groups", Some(&anna), json!({ "name": "Psalms" })).await;
        let slug = g["slug"].as_str().unwrap().to_string();
        call(&app, "POST", "/groups/join", Some(&ben), json!({ "invite_code": g["invite_code"] })).await;
        let t = activity::user_today(&pool.get().unwrap(), anna_id);
        let met = |uid: i64, d: &str| { pool.get().unwrap().execute("INSERT OR REPLACE INTO activity_days (user_id, date, active_seconds, pages) VALUES (?1, ?2, 700, 1)", params![uid, d]).unwrap(); };
        met(anna_id, &t);
        let (_, v) = call(&app, "GET", &format!("/groups/{slug}"), Some(&ben), Value::Null).await;
        assert_eq!((v["streak"]["current"].as_i64(), v["streak"]["met_today"].as_i64(), v["streak"]["members"].as_i64()), (Some(0), Some(1), Some(2)));
        met(ben_id, &t);
        let (_, v) = call(&app, "GET", &format!("/groups/{slug}"), Some(&ben), Value::Null).await;
        assert_eq!((v["streak"]["current"].as_i64(), v["streak"]["kept"].as_bool()), (Some(1), Some(true)));
        // the group was made today: a week of reading before it does not count
        for i in 1..7 { met(anna_id, &shift(&t, -i)); met(ben_id, &shift(&t, -i)); }
        assert_eq!(group_streak(&pool.get().unwrap(), g["id"].as_i64().unwrap()).unwrap().current, 1);
        // backdate the group and both joins by a week: seven days, and the badge for both, via one reader's day
        pool.get().unwrap().execute("UPDATE group_members SET joined_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days')", []).unwrap();
        assert_eq!(group_streak(&pool.get().unwrap(), g["id"].as_i64().unwrap()).unwrap().current, 7);
        on_day_met(&pool.get().unwrap(), ben_id).unwrap();
        let has = |uid: i64| pool.get().unwrap().query_row("SELECT count(*) FROM badges WHERE user_id=?1 AND code='group_streak_7'", params![uid], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!((has(anna_id), has(ben_id)), (1, 1));
        // a member who joined three days ago was there for three of the seven
        let (cara_id, cara) = user(&pool, "cara");
        call(&app, "POST", "/groups/join", Some(&cara), json!({ "invite_code": g["invite_code"] })).await;
        pool.get().unwrap().execute("UPDATE group_members SET joined_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days') WHERE user_id=?1", params![cara_id]).unwrap();
        for i in 0..3 { met(cara_id, &shift(&t, -i)); }
        assert_eq!(group_streak(&pool.get().unwrap(), g["id"].as_i64().unwrap()).unwrap().current, 7);
        assert_eq!(best_group_streak(&pool.get().unwrap(), cara_id, &t), 3);
        on_day_met(&pool.get().unwrap(), cara_id).unwrap();
        assert_eq!(has(cara_id), 0);
    }

    #[tokio::test]
    async fn a_site_admin_in_admin_mode_opens_any_group_posts_a_notice_and_wears_the_badge() {
        let (app, pool) = app();
        let (_, anna) = user(&pool, "anna");
        let (ben_id, ben) = user(&pool, "ben");
        let (boss_id, boss) = user(&pool, "boss");
        pool.get().unwrap().execute("UPDATE users SET is_admin=(id=?1)", params![boss_id]).unwrap();
        let (_, g) = call(&app, "POST", "/groups", Some(&anna), json!({ "name": "Psalms" })).await;
        let slug = g["slug"].as_str().unwrap().to_string();
        call(&app, "POST", "/groups/join", Some(&ben), json!({ "invite_code": g["invite_code"] })).await;
        // Admin mode off: an admin is an ordinary reader, the group is not theirs to see
        assert_eq!(call(&app, "GET", &format!("/groups/{slug}"), Some(&boss), Value::Null).await.0, 404);
        assert_eq!(call(&app, "GET", "/admin/groups", Some(&ben), Value::Null).await.0, 403, "the panel is the site admin's");
        call(&app, "PATCH", "/me", Some(&boss), json!({ "settings": { "admin_mode": true } })).await;
        let (_, list) = call(&app, "GET", "/admin/groups", Some(&boss), Value::Null).await;
        assert_eq!((list[0]["slug"].as_str(), list[0]["member_count"].as_i64(), list[0]["my_role"].is_null()), (Some(slug.as_str()), Some(2), true));
        let (st, d) = call(&app, "GET", &format!("/groups/{slug}"), Some(&boss), Value::Null).await;
        assert_eq!((st, d["role"].as_str(), d["site_admin"].as_bool(), d["member_count"].as_i64()), (200, Some("admin"), Some(true), Some(2)), "in as an admin, not as a member");
        // a notice: free text under the badge; the same text from a member is refused as before
        assert_eq!(call(&app, "POST", &format!("/groups/{slug}/posts"), Some(&ben), json!({ "body": "hello" })).await.0, 400);
        let (st, p) = call(&app, "POST", &format!("/groups/{slug}/posts"), Some(&boss), json!({ "body": "  Be kind to one another.  " })).await;
        assert_eq!(st, 200);
        let (_, feed) = call(&app, "GET", &format!("/groups/{slug}/feed"), Some(&ben), Value::Null).await;
        assert_eq!((feed[0]["id"].as_i64(), feed[0]["body"].as_str(), feed[0]["notice"].as_bool(), feed[0]["staff"].as_bool()), (p["id"].as_i64(), Some("Be kind to one another."), Some(true), Some(true)));
        // moderation: a member removed; hidden posts are seen in Admin mode
        assert_eq!(call(&app, "DELETE", &format!("/groups/{slug}/members/{ben_id}"), Some(&boss), Value::Null).await.0, 200);
        assert_eq!(call(&app, "GET", &format!("/groups/{slug}"), Some(&ben), Value::Null).await.0, 404);
        // the badge goes with the mode; the notice stays
        call(&app, "PATCH", "/me", Some(&boss), json!({ "settings": { "admin_mode": false } })).await;
        let (_, feed) = call(&app, "GET", &format!("/groups/{slug}/feed"), Some(&anna), Value::Null).await;
        assert_eq!((feed[0]["notice"].as_bool(), feed[0]["staff"].as_bool()), (Some(true), Some(false)));
        assert_eq!(call(&app, "GET", &format!("/groups/{slug}"), Some(&boss), Value::Null).await.0, 404);
    }

    #[tokio::test]
    async fn only_the_owner_turns_the_group_streak_off() {
        let (app, pool) = app();
        let (_, anna) = user(&pool, "anna");
        let (ben_id, ben) = user(&pool, "ben");
        let (_, g) = call(&app, "POST", "/groups", Some(&anna), json!({ "name": "Psalms" })).await;
        let slug = g["slug"].as_str().unwrap().to_string();
        call(&app, "POST", "/groups/join", Some(&ben), json!({ "invite_code": g["invite_code"] })).await;
        call(&app, "POST", &format!("/groups/{slug}/members/{ben_id}/role"), Some(&anna), json!({ "role": "admin" })).await;
        assert_eq!(call(&app, "PATCH", &format!("/groups/{slug}"), Some(&ben), json!({ "streak_enabled": false })).await.0, 403, "an admin who is not the owner");
        let (st, v) = call(&app, "PATCH", &format!("/groups/{slug}"), Some(&anna), json!({ "streak_enabled": false })).await;
        assert_eq!((st, v["streak_enabled"].as_bool()), (200, Some(false)));
        let (_, d) = call(&app, "GET", &format!("/groups/{slug}"), Some(&ben), Value::Null).await;
        assert!(d["streak"].is_null());
    }

    #[tokio::test]
    async fn the_event_streak_metric_counts_each_members_own_goal() {
        let (app, pool) = app();
        let (anna_id, anna) = user(&pool, "anna");
        let (_, g) = call(&app, "POST", "/groups", Some(&anna), json!({ "name": "Race" })).await;
        let slug = g["slug"].as_str().unwrap().to_string();
        // a 5-minute goal: 400 s a day meets it (the old fixed 10 minutes did not)
        pool.get().unwrap().execute("UPDATE users SET settings='{\"daily_goal_minutes\":5}' WHERE id=?1", params![anna_id]).unwrap();
        for d in ["2026-09-20", "2026-09-21", "2026-09-22"] { pool.get().unwrap().execute("INSERT INTO activity_days (user_id, date, active_seconds) VALUES (?1, ?2, 400)", params![anna_id, d]).unwrap(); }
        let (_, ev) = call(&app, "POST", &format!("/groups/{slug}/events"), Some(&anna), json!({ "name": "Week", "metric": "streak", "starts_at": "2026-09-20", "ends_at": "2026-09-26" })).await;
        let (_, lb) = call(&app, "GET", &format!("/groups/{slug}/events/{}/leaderboard", ev["id"]), Some(&anna), Value::Null).await;
        assert_eq!(lb["rows"][0]["value"], 3.0);
    }
    fn fields(name: &str, a: &str, e: &str) -> EventFields { EventFields { name: name.into(), starts_at: a.into(), ends_at: e.into(), ..EventFields::default() } }

    #[test]
    fn validate_event_names_each_refusal_and_resolve_normalizes() {
        let ok = fields("Gospels", "2026-09-01", "2026-09-30");
        assert!(validate_event(&ok).is_ok());
        let bad = |f: EventFields| validate_event(&f).err().map(|e| e.message).unwrap_or_default();
        assert_eq!(bad(EventFields { name: "x".into(), ..ok.clone() }), "name: 2-80 characters");
        assert_eq!(bad(EventFields { metric: "verses".into(), ..ok.clone() }), "metric");
        assert_eq!(bad(EventFields { starts_at: "2026-02-30".into(), ..ok.clone() }), "dates must be YYYY-MM-DD");
        assert_eq!(bad(EventFields { ends_at: "2026-08-31".into(), ..ok.clone() }), "ends before it starts");
        assert_eq!(bad(EventFields { time_weight: 101.0, ..ok.clone() }), "weights: 0 to 100");
        assert_eq!(bad(EventFields { goal: Some(-1.0), ..ok.clone() }), "goal: 0 or more");
        assert_eq!(bad(EventFields { description: Some("d".repeat(121)), ..ok.clone() }), "description: up to 120 characters");
        assert_eq!(bad(EventFields { books: Some(vec![0]), ..ok.clone() }), "books: numbers 1 to 66");
        assert_eq!(bad(EventFields { book_from: Some(67), ..ok.clone() }), "book range: 1 to 66");
        assert_eq!(bad(EventFields { visibility: "everyone".into(), ..ok.clone() }), "visibility");
        assert_eq!(bad(EventFields { counts_from: "always".into(), ..ok.clone() }), "counts_from");
        assert_eq!(bad(EventFields { repeat: "daily".into(), ..ok.clone() }), "repeat");
        // a list replaces the range, is sorted without repeats, and empty means every book; a blank description is none
        let f = resolve(EventIn { books: Some(Some(vec![43, 19, 40, 40])), description: Some(Some("  ".into())), ..Default::default() }, EventFields { book_from: Some(1), book_to: Some(5), ..ok.clone() });
        assert_eq!((f.books.as_deref(), f.book_from, f.book_to, f.description.as_deref()), (Some(&[19, 40, 43][..]), None, None, None));
        let f = resolve(EventIn { books: Some(Some(vec![])), ..Default::default() }, ok.clone());
        assert_eq!(f.books, None);
        // the legacy range alone: a lone from is its own to, and a to before the from becomes the from
        let f = resolve(EventIn { book_from: Some(Some(40)), book_to: Some(Some(19)), ..Default::default() }, ok.clone());
        assert_eq!((f.book_from, f.book_to), (Some(40), Some(40)));
    }

    #[test]
    fn the_next_window_steps_past_the_windows_nobody_could_read_for() {
        assert_eq!(next_window("2026-09-01", "2026-09-07", "weekly", "2026-09-08"), Some(("2026-09-08".into(), "2026-09-14".into())));
        // three weeks late: straight to the window that is live today
        assert_eq!(next_window("2026-09-01", "2026-09-07", "weekly", "2026-09-30"), Some(("2026-09-29".into(), "2026-10-05".into())));
        assert_eq!(next_window("2026-09-01", "2026-09-30", "monthly", "2026-10-01"), Some(("2026-10-01".into(), "2026-10-31".into())));
        assert_eq!(next_window("2026-01-31", "2026-01-31", "monthly", "2026-02-01"), Some(("2026-02-28".into(), "2026-02-28".into())));
        assert_eq!(next_window("2026-01-15", "2026-02-14", "monthly", "2026-02-15"), Some(("2026-02-15".into(), "2026-03-14".into())));
        assert_eq!(next_window("2026-12-01", "2026-12-31", "monthly", "2027-01-01"), Some(("2027-01-01".into(), "2027-01-31".into())));
        assert_eq!(next_window("2026-09-01", "2026-09-07", "none", "2026-09-08"), None);
    }

    /// A page credit and a first read of `book` `chapter` on `day` for `uid`.
    fn read(pool: &crate::db::DbPool, uid: i64, book: i64, chapter: i64, day: &str) {
        let c = pool.get().unwrap();
        c.execute("INSERT OR IGNORE INTO page_credits (user_id, book, chapter, date, dwell_seconds) VALUES (?1, ?2, ?3, ?4, 120)", params![uid, book, chapter, day]).unwrap();
        c.execute("INSERT OR IGNORE INTO chapters_read (user_id, book, chapter, first_read_at) VALUES (?1, ?2, ?3, ?4 || 'T12:00:00Z')", params![uid, book, chapter, day]).unwrap();
    }

    #[tokio::test]
    async fn a_book_list_scopes_the_chapter_columns_and_a_legacy_range_still_reads() {
        let (app, pool) = app();
        let (anna_id, anna) = user(&pool, "anna");
        let (_, g) = call(&app, "POST", "/groups", Some(&anna), json!({ "name": "Gospels" })).await;
        let slug = g["slug"].as_str().unwrap().to_string();
        let t = activity::user_today(&pool.get().unwrap(), anna_id);
        read(&pool, anna_id, 40, 1, &t); read(&pool, anna_id, 19, 23, &t); read(&pool, anna_id, 1, 1, &t);
        pool.get().unwrap().execute("INSERT INTO activity_days (user_id, date, active_seconds, pages) VALUES (?1, ?2, 600, 3)", params![anna_id, t]).unwrap();
        let (st, ev) = call(&app, "POST", &format!("/groups/{slug}/events"), Some(&anna), json!({ "name": "Gospels and Psalms", "metric": "pages", "starts_at": t, "ends_at": t, "books": [43, 19, 40, 40], "description": "  Read together  " })).await;
        assert_eq!(st, 200);
        assert_eq!((ev["books"].clone(), ev["book_from"].clone(), ev["description"].as_str()), (json!([19, 40, 43]), Value::Null, Some("Read together")));
        let board = |id: &Value| { let app = app.clone(); let anna = anna.clone(); let slug = slug.clone(); let id = id.clone(); async move { call(&app, "GET", &format!("/groups/{slug}/events/{id}/leaderboard"), Some(&anna), Value::Null).await.1 } };
        let lb = board(&ev["id"]).await;
        assert_eq!((lb["rows"][0]["pages"].as_i64(), lb["rows"][0]["chapters"].as_i64(), lb["rows"][0]["active_seconds"].as_i64(), lb["rows"][0]["rank"].as_i64()), (Some(2), Some(2), Some(600), Some(1)));
        // minutes ignore the books
        let (_, ev2) = call(&app, "PATCH", &format!("/groups/{slug}/events/{}", ev["id"]), Some(&anna), json!({ "metric": "active_minutes" })).await;
        assert_eq!(ev2["books"], json!([19, 40, 43]), "an edit without books keeps them");
        assert_eq!(board(&ev["id"]).await["rows"][0]["value"], 10.0);
        // a row written by an older server: from–to only
        pool.get().unwrap().execute("UPDATE group_events SET books_json=NULL, book_from=40, book_to=43 WHERE id=?1", params![ev["id"].as_i64()]).unwrap();
        let lb = board(&ev["id"]).await;
        assert_eq!((lb["event"]["books"].clone(), lb["rows"][0]["pages"].as_i64()), (json!([40, 41, 42, 43]), Some(1)));
        // an empty list from the client means every book, and drops the range
        let (_, ev3) = call(&app, "PATCH", &format!("/groups/{slug}/events/{}", ev["id"]), Some(&anna), json!({ "books": [] })).await;
        assert_eq!((ev3["books"].clone(), ev3["book_from"].clone()), (Value::Null, Value::Null));
        assert_eq!(board(&ev["id"]).await["rows"][0]["pages"].as_i64(), Some(3));
        assert_eq!(call(&app, "POST", &format!("/groups/{slug}/events"), Some(&anna), json!({ "name": "Bad", "metric": "pages", "starts_at": t, "ends_at": t, "books": [67] })).await.0, 400);
        assert_eq!(call(&app, "POST", &format!("/groups/{slug}/events"), Some(&anna), json!({ "name": "Bad", "metric": "pages", "starts_at": t, "ends_at": t, "visibility": "everyone" })).await.0, 400);
    }

    #[tokio::test]
    async fn counting_from_the_join_day_and_leaving_late_joiners_off() {
        let (app, pool) = app();
        let (anna_id, anna) = user(&pool, "anna");
        let (ben_id, ben) = user(&pool, "ben");
        let (_, g) = call(&app, "POST", "/groups", Some(&anna), json!({ "name": "Psalms" })).await;
        let slug = g["slug"].as_str().unwrap().to_string();
        call(&app, "POST", "/groups/join", Some(&ben), json!({ "invite_code": g["invite_code"] })).await;
        let t = activity::user_today(&pool.get().unwrap(), anna_id);
        // Anna joined 20 days ago, Ben today; the event ran from 8 days ago to 2 days ago
        pool.get().unwrap().execute("UPDATE group_members SET joined_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days') WHERE user_id=?1", params![anna_id]).unwrap();
        let (a, e) = (shift(&t, -8), shift(&t, -2));
        for (uid, day) in [(anna_id, shift(&t, -15)), (anna_id, shift(&t, -5)), (ben_id, shift(&t, -5))] {
            pool.get().unwrap().execute("INSERT INTO activity_days (user_id, date, active_seconds) VALUES (?1, ?2, 600)", params![uid, day]).unwrap();
        }
        let (_, ev) = call(&app, "POST", &format!("/groups/{slug}/events"), Some(&anna), json!({ "name": "Week", "metric": "active_minutes", "starts_at": a, "ends_at": e })).await;
        let rows = |id: &Value, who: &str| { let app = app.clone(); let who = who.to_string(); let slug = slug.clone(); let id = id.clone(); async move { call(&app, "GET", &format!("/groups/{slug}/events/{id}/leaderboard"), Some(&who), Value::Null).await.1["rows"].clone() } };
        let r = rows(&ev["id"], &anna).await;
        assert_eq!(r.as_array().unwrap().len(), 2, "late joiners score by default");
        assert!(r.as_array().unwrap().iter().all(|x| x["value"] == 10.0), "reading before the start does not count: {r}");
        // from the join day: Anna's reading 15 days ago counts, Ben's join today is after the start so nothing more
        call(&app, "PATCH", &format!("/groups/{slug}/events/{}", ev["id"]), Some(&anna), json!({ "counts_from": "group_join" })).await;
        let r = rows(&ev["id"], &anna).await;
        let of = |uid: i64| r.as_array().unwrap().iter().find(|x| x["user_id"] == uid).map(|x| x["value"].as_f64().unwrap());
        assert_eq!((of(anna_id), of(ben_id)), (Some(20.0), Some(10.0)));
        // late joiners off: Ben, who joined after the start, is not on the board
        let (st, ev2) = call(&app, "PATCH", &format!("/groups/{slug}/events/{}", ev["id"]), Some(&anna), json!({ "late_join": false })).await;
        assert_eq!((st, ev2["late_join"].as_bool()), (200, Some(false)));
        let r = rows(&ev["id"], &ben).await;
        assert_eq!(r.as_array().unwrap().iter().map(|x| x["user_id"].as_i64().unwrap()).collect::<Vec<_>>(), [anna_id]);
    }

    #[tokio::test]
    async fn an_admins_only_board_shows_a_member_their_own_row_at_its_place() {
        let (app, pool) = app();
        let (anna_id, anna) = user(&pool, "anna");
        let (ben_id, ben) = user(&pool, "ben");
        let (_, g) = call(&app, "POST", "/groups", Some(&anna), json!({ "name": "Quiet" })).await;
        let slug = g["slug"].as_str().unwrap().to_string();
        call(&app, "POST", "/groups/join", Some(&ben), json!({ "invite_code": g["invite_code"] })).await;
        let t = activity::user_today(&pool.get().unwrap(), anna_id);
        pool.get().unwrap().execute("INSERT INTO activity_days (user_id, date, active_seconds) VALUES (?1, ?2, 1200), (?3, ?2, 300)", params![anna_id, t, ben_id]).unwrap();
        let (_, ev) = call(&app, "POST", &format!("/groups/{slug}/events"), Some(&anna), json!({ "name": "No pressure", "metric": "active_minutes", "starts_at": t, "ends_at": t, "visibility": "private_admin" })).await;
        let (_, mine) = call(&app, "GET", &format!("/groups/{slug}/events/{}/leaderboard", ev["id"]), Some(&ben), Value::Null).await;
        assert_eq!((mine["private"].as_bool(), mine["rows"].as_array().unwrap().len(), mine["rows"][0]["user_id"].as_i64(), mine["rows"][0]["rank"].as_i64()), (Some(true), 1, Some(ben_id), Some(2)));
        let (_, all) = call(&app, "GET", &format!("/groups/{slug}/events/{}/leaderboard", ev["id"]), Some(&anna), Value::Null).await;
        assert_eq!((all["private"].as_bool(), all["rows"].as_array().unwrap().len()), (Some(false), 2));
        // the event itself, in the group detail, says so to everyone
        let (_, d) = call(&app, "GET", &format!("/groups/{slug}"), Some(&ben), Value::Null).await;
        assert_eq!(d["events"][0]["visibility"], "private_admin");
    }

    #[tokio::test]
    async fn a_repeating_event_is_renewed_once_with_the_same_name_and_options() {
        let (app, pool) = app();
        let (_, anna) = user(&pool, "anna");
        let (_, g) = call(&app, "POST", "/groups", Some(&anna), json!({ "name": "Weekly" })).await;
        let slug = g["slug"].as_str().unwrap().to_string();
        let (_, ev) = call(&app, "POST", &format!("/groups/{slug}/events"), Some(&anna), json!({ "name": "Psalms this week", "metric": "pages", "starts_at": "2026-09-01", "ends_at": "2026-09-07", "repeat": "weekly", "books": [19], "goal": 7, "visibility": "private_admin", "description": "One a day" })).await;
        let c = pool.get().unwrap();
        assert_eq!(sweep_repeats(&c, "2026-09-07").unwrap(), 0, "not before the window has ended");
        assert_eq!(sweep_repeats(&c, "2026-09-08").unwrap(), 1);
        assert_eq!(sweep_repeats(&c, "2026-09-08").unwrap(), 0, "renewed once");
        let (_, d) = call(&app, "GET", &format!("/groups/{slug}"), Some(&anna), Value::Null).await;
        let evs = d["events"].as_array().unwrap();
        assert_eq!(evs.len(), 2);
        let (new, old) = (&evs[0], &evs[1]);
        assert_eq!((new["starts_at"].as_str(), new["ends_at"].as_str(), new["name"].as_str()), (Some("2026-09-08"), Some("2026-09-14"), Some("Psalms this week")));
        for k in ["metric", "repeat", "books", "goal", "visibility", "description", "created_by", "late_join", "counts_from"] { assert_eq!(new[k], old[k], "{k} carried over"); }
        assert!(old["renewed_at"].is_string() && new["renewed_at"].is_null());
        assert_eq!(old["id"], ev["id"]);
        // the new one renews in its turn, skipping windows that have passed
        assert_eq!(sweep_repeats(&c, "2026-10-01").unwrap(), 1);
        let (_, d) = call(&app, "GET", &format!("/groups/{slug}"), Some(&anna), Value::Null).await;
        assert_eq!((d["events"].as_array().unwrap().len(), d["events"][0]["starts_at"].as_str()), (3, Some("2026-09-29")));
        // one turned off stays as it is
        call(&app, "PATCH", &format!("/groups/{slug}/events/{}", d["events"][0]["id"]), Some(&anna), json!({ "repeat": "none" })).await;
        assert_eq!(sweep_repeats(&c, "2027-01-01").unwrap(), 0);
    }
}
