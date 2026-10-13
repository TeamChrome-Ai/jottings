use crate::auth::{random_token, AuthUser, MaybeUser};
use crate::badges::check_badges;
use crate::db::now_iso;
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::{extract::{Path, State}, routing::{get, post}, Json, Router};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Serialize, Clone)]
pub struct Item { pub id: i64, pub outline_id: i64, pub position: i64, pub kind: String, pub book: Option<i64>, pub chapter: Option<i64>, pub v1: Option<i64>, pub v2: Option<i64>, pub text: Option<String>, pub url: Option<String>, pub depth: i64 }
#[derive(Serialize, Clone)]
pub struct Outline {
    pub id: i64, pub user_id: i64, pub title: String, pub description: Option<String>, pub visibility: String, pub share_code: Option<String>, pub print_style: String,
    pub forked_from: Option<i64>, pub created_at: String, pub updated_at: String, pub owner_handle: String,
    pub hidden: i64,
    /// Set while the outline is published (visibility `public`): listed publicly, newest first.
    pub published_at: Option<String>,
    pub owner_display_name: String,
    pub owner_avatar: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub verse_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub items: Option<Vec<Item>>,
}

const COLS: &str = "o.id, o.user_id, o.title, o.description, o.visibility, o.share_code, o.print_style, o.forked_from, o.created_at, o.updated_at, u.handle, o.hidden, o.published_at, u.display_name, u.avatar";
/// The column after COLS, for a query that adds one.
const NEXT: usize = 15;
fn row(r: &rusqlite::Row) -> rusqlite::Result<Outline> {
    Ok(Outline { id: r.get(0)?, user_id: r.get(1)?, title: r.get(2)?, description: r.get(3)?, visibility: r.get(4)?, share_code: r.get(5)?, print_style: r.get(6)?, forked_from: r.get(7)?, created_at: r.get(8)?, updated_at: r.get(9)?, owner_handle: r.get(10)?, hidden: r.get(11)?, published_at: r.get(12)?, owner_display_name: r.get(13)?, owner_avatar: Some(crate::avatars::effective(r.get(1)?, r.get::<_, Option<String>>(14)?.as_deref())), verse_count: None, items: None })
}
fn items(conn: &Connection, id: i64) -> rusqlite::Result<Vec<Item>> {
    let mut st = conn.prepare_cached("SELECT id, outline_id, position, kind, book, chapter, v1, v2, text, url, depth FROM outline_items WHERE outline_id=?1 ORDER BY position")?;
    let rows_ = st.query_map(params![id], |r| Ok(Item { id: r.get(0)?, outline_id: r.get(1)?, position: r.get(2)?, kind: r.get(3)?, book: r.get(4)?, chapter: r.get(5)?, v1: r.get(6)?, v2: r.get(7)?, text: r.get(8)?, url: r.get(9)?, depth: r.get(10)? }))?.collect(); rows_
}
fn load(conn: &Connection, id: i64) -> rusqlite::Result<Option<Outline>> {
    let o = conn.query_row(&format!("SELECT {COLS} FROM outlines o JOIN users u ON u.id=o.user_id WHERE o.id=?1"), params![id], row).optional()?;
    Ok(match o { Some(mut o) => { o.items = Some(items(conn, id)?); Some(o) } None => None })
}
/// Private (the owner only) or shared by link (the link is what a group post carries). A once-published outline
/// (`public`) reads as a link one: there is no public list. Hidden by moderation: the owner only.
fn can_read(o: &Outline, uid: Option<i64>, via_code: bool) -> bool { Some(o.user_id) == uid || (o.hidden == 0 && via_code && o.visibility != "private") }

/// What a link preview may say of the jotting behind a share code (og.rs): its title, its description and its first
/// note with words in it. Only for one that anyone holding the link may read (`can_read` for nobody in particular); a
/// private or hidden one is None, as a code there is not. Nothing of the owner.
pub struct Shared { pub id: i64, pub title: String, pub description: Option<String>, pub note: Option<String> }
pub fn shared(conn: &Connection, code: &str) -> rusqlite::Result<Option<Shared>> {
    let found = conn.prepare_cached(&format!("SELECT {COLS}, (SELECT i.text FROM outline_items i WHERE i.outline_id=o.id AND i.kind='note' AND trim(coalesce(i.text,''))<>'' ORDER BY i.position LIMIT 1) FROM outlines o JOIN users u ON u.id=o.user_id WHERE o.share_code=?1"))?
        .query_row(params![code], |r| Ok((row(r)?, r.get::<_, Option<String>>(NEXT)?))).optional()?;
    Ok(found.filter(|(o, _)| can_read(o, None, true)).map(|(o, note)| Shared { id: o.id, title: o.title, description: o.description, note }))
}
/// The first `n` passages an outline gathers, in its order.
pub fn first_verses(conn: &Connection, id: i64, n: i64) -> rusqlite::Result<Vec<crate::refparse::Ref>> {
    let mut st = conn.prepare_cached("SELECT book, chapter, v1, v2 FROM outline_items WHERE outline_id=?1 AND kind='verse' AND book IS NOT NULL AND chapter IS NOT NULL ORDER BY position LIMIT ?2")?;
    let rows_ = st.query_map(params![id, n], |r| Ok(crate::refparse::Ref { book: r.get(0)?, chapter: r.get(1)?, v1: r.get(2)?, v2: r.get(3)? }))?.collect(); rows_
}

async fn list_mine(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Vec<Outline>>> {
    let conn = s.pool.get()?;
    let mut st = conn.prepare_cached(&format!("SELECT {COLS}, (SELECT count(*) FROM outline_items i WHERE i.outline_id=o.id AND i.kind='verse') FROM outlines o JOIN users u ON u.id=o.user_id WHERE o.user_id=?1 ORDER BY o.updated_at DESC"))?;
    let rows = st.query_map(params![u.id], |r| { let mut o = row(r)?; o.verse_count = Some(r.get(NEXT)?); Ok(o) })?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(rows))
}
async fn for_verse(State(s): State<AppState>, MaybeUser(u): MaybeUser, Path((book, chapter)): Path<(i64, i64)>) -> ApiResult<Json<Vec<Value>>> {
    let conn = s.pool.get()?;
    let uid = u.map(|u| u.id).unwrap_or(-1);
    let mut st = conn.prepare_cached("SELECT i.outline_id, o.title, i.v1, i.v2, o.user_id = ?1 FROM outline_items i JOIN outlines o ON o.id=i.outline_id WHERE i.kind='verse' AND i.book=?2 AND i.chapter=?3 AND o.user_id=?1 ORDER BY o.updated_at DESC LIMIT 100")?;
    let rows = st.query_map(params![uid, book, chapter], |r| Ok(json!({ "outline_id": r.get::<_, i64>(0)?, "title": r.get::<_, String>(1)?, "v1": r.get::<_, Option<i64>>(2)?, "v2": r.get::<_, Option<i64>>(3)?, "mine": r.get::<_, i64>(4)? })))?.collect::<Result<Vec<_>, _>>()?;
    Ok(Json(rows))
}
async fn by_code(State(s): State<AppState>, MaybeUser(u): MaybeUser, Path(code): Path<String>) -> ApiResult<Json<Outline>> {
    let conn = s.pool.get()?;
    let o = conn.query_row(&format!("SELECT {COLS} FROM outlines o JOIN users u ON u.id=o.user_id WHERE o.share_code=?1"), params![code], row).optional()?;
    let Some(mut o) = o else { return Err(ApiError::not_found("not found")) };
    if !can_read(&o, u.map(|u| u.id), true) { return Err(ApiError::forbidden("private")); }
    o.items = Some(items(&conn, o.id)?);
    Ok(Json(o))
}

#[derive(Deserialize)]
struct Meta { title: Option<String>, description: Option<Option<String>>, visibility: Option<String>, print_style: Option<String> }
fn validate_meta(m: &Meta) -> ApiResult<()> {
    if let Some(t) = &m.title { if t.trim().is_empty() || t.chars().count() > 160 { return Err(ApiError::bad("title: 1-160 characters")); } }
    // 'public' is set by publish only; a PATCH may carry it back unchanged (the editor sends its whole record)
    if let Some(v) = &m.visibility { if !["private", "link", "public"].contains(&v.as_str()) { return Err(ApiError::bad("visibility")); } }
    if let Some(p) = &m.print_style { if !["verses-first", "inline", "refs-only"].contains(&p.as_str()) { return Err(ApiError::bad("print_style")); } }
    Ok(())
}
async fn create(State(s): State<AppState>, AuthUser(u): AuthUser, Json(m): Json<Meta>) -> ApiResult<Json<Outline>> {
    validate_meta(&m)?;
    let Some(title) = m.title.as_deref().map(str::trim).filter(|t| !t.is_empty()) else { return Err(ApiError::bad("title required")) };
    let conn = s.pool.get()?;
    conn.execute("INSERT INTO outlines (user_id, title, description, visibility, share_code, print_style) VALUES (?1,?2,?3,?4,?5,?6)",
        params![u.id, title, m.description.flatten(), m.visibility.as_deref().unwrap_or("private"), random_token(10), m.print_style.as_deref().unwrap_or("verses-first")])?;
    let id = conn.last_insert_rowid();
    check_badges(&conn, u.id)?;
    Ok(Json(load(&conn, id)?.unwrap()))
}
async fn get_one(State(s): State<AppState>, MaybeUser(u): MaybeUser, Path(id): Path<i64>) -> ApiResult<Json<Outline>> {
    let conn = s.pool.get()?;
    let Some(o) = load(&conn, id)? else { return Err(ApiError::not_found("not found")) };
    if !can_read(&o, u.map(|u| u.id), false) { return Err(ApiError::forbidden("private")); }
    Ok(Json(o))
}
async fn patch(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>, Json(m): Json<Meta>) -> ApiResult<Json<Outline>> {
    validate_meta(&m)?;
    let conn = s.pool.get()?;
    let Some(o) = load(&conn, id)? else { return Err(ApiError::not_found("not found")) };
    if o.user_id != u.id { return Err(ApiError::not_found("not found")); }
    // an unchanged visibility is no change; 'public' is reached through publish, never by a PATCH
    let visibility = m.visibility.clone().filter(|v| *v != o.visibility);
    if visibility.as_deref() == Some("public") { return Err(ApiError::bad("Publish an outline with Publish")); }
    // choosing Private or Anyone with the link on a published outline unpublishes it
    conn.execute("UPDATE outlines SET title=coalesce(?1, title), description=CASE WHEN ?2 THEN ?3 ELSE description END, visibility=coalesce(?4, visibility), print_style=coalesce(?5, print_style), updated_at=?6,
        published_at=CASE WHEN ?4 IS NOT NULL THEN NULL ELSE published_at END WHERE id=?7",
        params![m.title.as_deref().map(str::trim), m.description.is_some(), m.description.clone().flatten(), visibility, m.print_style, now_iso(), id])?;
    check_badges(&conn, u.id)?;
    if let Some(o2) = load(&conn, id)? { if o2.visibility != "private" { crate::moderation::auto_scan(&conn, "outline", id)?; } }
    Ok(Json(load(&conn, id)?.unwrap()))
}
#[derive(Deserialize)]
struct ItemIn { kind: String, book: Option<i64>, chapter: Option<i64>, v1: Option<i64>, v2: Option<i64>, text: Option<String>, url: Option<String>, #[serde(default)] depth: i64 }
#[derive(Deserialize)] struct ItemsIn { items: Vec<ItemIn> }
async fn put_items(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>, Json(b): Json<ItemsIn>) -> ApiResult<Json<Outline>> {
    if b.items.len() > 2000 { return Err(ApiError::bad("too many items")); }
    let mut conn = s.pool.get()?;
    let owner: Option<i64> = conn.query_row("SELECT user_id FROM outlines WHERE id=?1", params![id], |r| r.get(0)).optional()?;
    if owner != Some(u.id) { return Err(ApiError::not_found("not found")); }
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM outline_items WHERE outline_id=?1", params![id])?;
    {
        let mut ins = tx.prepare("INSERT INTO outline_items (outline_id, position, kind, book, chapter, v1, v2, text, url, depth) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)")?;
        for (i, it) in b.items.iter().enumerate() {
            if !["verse", "note", "link", "heading"].contains(&it.kind.as_str()) { return Err(ApiError::bad(format!("item {i}: bad kind"))); }
            if it.kind == "verse" && (it.book.is_none() || it.chapter.is_none()) { return Err(ApiError::bad(format!("item {i}: verse needs book and chapter"))); }
            if let Some(t) = &it.text { if t.chars().count() > 20000 { return Err(ApiError::bad(format!("item {i}: text too long"))); } }
            ins.execute(params![id, i as i64, it.kind, it.book, it.chapter, it.v1, it.v2.or(it.v1), it.text, it.url, it.depth.clamp(0, 6)])?;
        }
    }
    tx.execute("UPDATE outlines SET updated_at=?1 WHERE id=?2", params![now_iso(), id])?;
    tx.commit()?;
    if let Some(o2) = load(&conn, id)? { if o2.visibility != "private" { crate::moderation::auto_scan(&conn, "outline", id)?; } }
    Ok(Json(load(&conn, id)?.unwrap()))
}
async fn fork(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>) -> ApiResult<Json<Outline>> {
    let mut conn = s.pool.get()?;
    let Some(o) = load(&conn, id)? else { return Err(ApiError::not_found("not found")) };
    if !can_read(&o, Some(u.id), true) { return Err(ApiError::not_found("not found")); }
    let tx = conn.transaction()?;
    tx.execute("INSERT INTO outlines (user_id, title, description, visibility, share_code, print_style, forked_from) VALUES (?1,?2,?3,'private',?4,?5,?6)", params![u.id, o.title, o.description, random_token(10), o.print_style, o.id])?;
    let nid = tx.last_insert_rowid();
    {
        let mut ins = tx.prepare("INSERT INTO outline_items (outline_id, position, kind, book, chapter, v1, v2, text, url, depth) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)")?;
        for it in o.items.unwrap_or_default() { ins.execute(params![nid, it.position, it.kind, it.book, it.chapter, it.v1, it.v2, it.text, it.url, it.depth])?; }
    }
    tx.commit()?;
    Ok(Json(load(&conn, nid)?.unwrap()))
}
/// Publishing to everyone is withdrawn: there is no public list. Sharing is by link.
async fn publish(AuthUser(_): AuthUser, Path(_): Path<i64>) -> ApiResult<Json<Outline>> {
    Err(ApiError::new(410, format!("Publishing to everyone has ended. Share {} by its link instead.", crate::brand::get().noun.a)))
}
/// Unpublish: an outline published before the public list was withdrawn goes back to "Anyone with the link" (a link
/// already posted to a group keeps working); the owner can make it private in the editor.
async fn unpublish(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>) -> ApiResult<Json<Outline>> {
    Ok(Json(s.db(move |conn| {
        let n = conn.execute("UPDATE outlines SET visibility=CASE WHEN visibility='public' THEN 'link' ELSE visibility END, published_at=NULL WHERE id=?1 AND user_id=?2", params![id, u.id])?;
        if n == 0 { return Err(ApiError::not_found("not found")); }
        Ok(load(conn, id)?.unwrap())
    }).await?))
}
/// The public list is withdrawn; an older app asking for it gets an empty page.
async fn list_public() -> Json<Vec<Outline>> { Json(Vec::new()) }
async fn delete(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    conn.execute("DELETE FROM outlines WHERE id=?1 AND user_id=?2", params![id, u.id])?;
    Ok(Json(json!({ "ok": true })))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_mine).post(create))
        .route("/for-verse/{book}/{chapter}", get(for_verse))
        .route("/shared/{code}", get(by_code))
        .route("/public", get(list_public))
        .route("/{id}/publish", post(publish))
        .route("/{id}/unpublish", post(unpublish))
        .route("/{id}", get(get_one).patch(patch).delete(delete))
        .route("/{id}/items", axum::routing::put(put_items))
        .route("/{id}/fork", post(fork))
}

#[cfg(test)]
mod tests {
    use crate::testkit::{app, call, user};
    use serde_json::{json, Value};
    const NULL: Value = Value::Null;

    async fn outline(app: &axum::Router, token: &str, title: &str, note: &str) -> i64 {
        let (_, o) = call(app, "POST", "/outlines", Some(token), json!({ "title": title })).await;
        let id = o["id"].as_i64().unwrap();
        call(app, "PUT", &format!("/outlines/{id}/items"), Some(token), json!({ "items": [{ "kind": "verse", "book": 43, "chapter": 3, "v1": 16 }, { "kind": "note", "text": note }] })).await;
        id
    }

    #[tokio::test]
    async fn there_is_no_public_list_and_a_published_outline_reads_as_a_link_one() {
        let (app, pool) = app();
        let (anna_id, anna) = user(&pool, "anna");
        let (_, ben) = user(&pool, "ben");
        let id = outline(&app, &anna, "Love in John", "God so loved").await;
        // publishing is withdrawn, for the owner too
        assert_eq!(call(&app, "POST", &format!("/outlines/{id}/publish"), Some(&anna), NULL).await.0, 410);
        assert_eq!(call(&app, "POST", &format!("/outlines/{id}/publish"), Some(&ben), NULL).await.0, 410);
        // one published before the withdrawal
        pool.get().unwrap().execute("UPDATE outlines SET visibility='public', published_at='2026-01-01T00:00:00Z' WHERE id=?1", rusqlite::params![id]).unwrap();
        for t in [None, Some(ben.as_str()), Some(anna.as_str())] {
            let (st, list) = call(&app, "GET", "/outlines/public", t, NULL).await;
            assert_eq!((st, list.as_array().map(|l| l.len())), (200, Some(0)));
        }
        assert_eq!(call(&app, "GET", &format!("/outlines/{id}"), Some(&ben), NULL).await.0, 403);
        assert_eq!(call(&app, "GET", &format!("/outlines/{id}"), None, NULL).await.0, 403);
        assert_eq!(call(&app, "GET", &format!("/outlines/{id}"), Some(&anna), NULL).await.0, 200);
        let code = call(&app, "GET", &format!("/outlines/{id}"), Some(&anna), NULL).await.1["share_code"].as_str().unwrap().to_string();
        assert_eq!(call(&app, "GET", &format!("/outlines/shared/{code}"), None, NULL).await.0, 200, "the link still opens it");
        // a public profile lists no jottings
        call(&app, "PATCH", "/me", Some(&anna), json!({ "settings": { "public_profile": true } })).await;
        assert_eq!(call(&app, "GET", "/users/anna", None, NULL).await.1.get("outlines"), None);
        // the editor saves its whole record: 'public' unchanged is no change, and cannot be chosen
        let (st, o) = call(&app, "PATCH", &format!("/outlines/{id}"), Some(&anna), json!({ "title": "Love in John 3", "visibility": "public" })).await;
        assert_eq!((st, o["visibility"].as_str()), (200, Some("public")));
        let id2 = outline(&app, &anna, "Psalm 23", "the shepherd").await;
        assert_eq!(call(&app, "PATCH", &format!("/outlines/{id2}"), Some(&anna), json!({ "visibility": "public" })).await.0, 400);
        // unpublish (or a visibility chosen in the editor) makes it plainly link-shared
        let (_, o) = call(&app, "POST", &format!("/outlines/{id}/unpublish"), Some(&anna), NULL).await;
        assert_eq!((o["visibility"].as_str(), o["published_at"].is_null()), (Some("link"), true));
        assert_eq!(call(&app, "GET", &format!("/outlines/shared/{code}"), Some(&ben), NULL).await.0, 200);
        assert_eq!(call(&app, "POST", &format!("/outlines/{id}/unpublish"), Some(&ben), NULL).await.0, 404);
        // hidden by moderation: not even by link
        pool.get().unwrap().execute("UPDATE outlines SET hidden=1 WHERE user_id=?1", rusqlite::params![anna_id]).unwrap();
        assert_eq!(call(&app, "GET", &format!("/outlines/shared/{code}"), Some(&ben), NULL).await.0, 403);
    }
}
