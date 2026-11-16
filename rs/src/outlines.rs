use crate::auth::{random_token, AuthUser, MaybeUser};
use crate::badges::check_badges;
use crate::db::now_iso;
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::{extract::{Path, Query, State}, http::StatusCode, response::{IntoResponse, Response}, routing::{get, post}, Json, Router};
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
#[derive(Deserialize)] struct SearchQ { q: Option<String>, limit: Option<i64> }
#[derive(Serialize)] struct Found { id: i64, title: String, snippet: String, updated_at: String }

/// The reader's own jottings that hold every word of `q` (case aside): in the title, the description, a note, a link's
/// words, or a passage named by its book. Newest first. Nobody else's, ever.
async fn search_mine(State(s): State<AppState>, AuthUser(u): AuthUser, Query(q): Query<SearchQ>) -> ApiResult<Json<Vec<Found>>> {
    let words: Vec<String> = q.q.unwrap_or_default().to_lowercase().split(|c: char| !(c.is_alphanumeric() || c == '\'' || c == ':')).filter(|w| !w.is_empty()).take(8).map(String::from).collect();
    if words.is_empty() { return Ok(Json(vec![])) }
    let limit = q.limit.unwrap_or(20).clamp(1, 50) as usize;
    let found = s.db(move |conn| {
        let mut st = conn.prepare_cached("SELECT o.id, o.title, coalesce(o.description,''), o.updated_at FROM outlines o WHERE o.user_id=?1 ORDER BY o.updated_at DESC")?;
        let outlines: Vec<(i64, String, String, String)> = st.query_map(params![u.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<_, _>>()?;
        let mut its = conn.prepare_cached("SELECT kind, book, chapter, v1, coalesce(text,'') FROM outline_items WHERE outline_id=?1 ORDER BY position")?;
        let mut out = Vec::new();
        for (id, title, description, updated_at) in outlines {
            let items: Vec<(String, Option<i64>, Option<i64>, Option<i64>, String)> = its.query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?.collect::<Result<_, _>>()?;
            // what the jotting says, a line each: its title, description, notes and links, and its passages by name
            let mut lines = vec![title.clone(), description];
            for (kind, book, chapter, v1, text) in items {
                if kind == "verse" {
                    if let (Some(b), Some(c)) = (book.and_then(crate::books::book), chapter) { lines.push(match v1 { Some(v) => format!("{} {c}:{v}", b.name), None => format!("{} {c}", b.name) }); }
                } else if !text.trim().is_empty() { lines.push(text); }
            }
            let all = lines.join("\n").to_lowercase();
            if !words.iter().all(|w| all.contains(w.as_str())) { continue }
            // the line to show: the first after the title with the first word, else the title's own
            let snippet = lines.iter().skip(1).find(|l| l.to_lowercase().contains(words[0].as_str())).map(|l| clip(l, &words[0])).unwrap_or_default();
            out.push(Found { id, title, snippet, updated_at });
            if out.len() >= limit { break }
        }
        Ok(out)
    }).await?;
    Ok(Json(found))
}
/// About 120 characters of `line` around the first `word`, on character boundaries.
fn clip(line: &str, word: &str) -> String {
    let chars: Vec<char> = line.split_whitespace().collect::<Vec<_>>().join(" ").chars().collect();
    let lower: String = chars.iter().collect::<String>().to_lowercase();
    let at = lower.find(word).map(|b| lower[..b].chars().count()).unwrap_or(0);
    // start on a word: back from 50 characters before the word to the space before it
    let mut a = at.saturating_sub(50);
    while a > 0 && chars[a - 1] != ' ' { a -= 1; }
    let b = (a + 120).min(chars.len());
    format!("{}{}{}", if a > 0 { "…" } else { "" }, chars[a..b].iter().collect::<String>(), if b < chars.len() { "…" } else { "" })
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
struct Meta {
    title: Option<String>, description: Option<Option<String>>, visibility: Option<String>, print_style: Option<String>,
    /// The `updated_at` the app last saw, and who is saving (a PATCH only): see `changed_since`.
    if_updated: Option<String>, writer: Option<String>,
}
/// A save may name the stamp (`updated_at`) its sender last saw, as `if_updated`, and who the sender is, as `writer`:
/// a name the sender makes up, one for each editor on a screen and each write made for the reader, which the
/// outline keeps from its last save (`last_writer`; none when that save named none). The rule is not "your stamp is
/// old" but "someone other than you has saved since you last saw it". So a save that names a stamp is made when the
/// stamp is the outline's, or when the outline's last save was this writer's own: an editor whose own save moved the
/// stamp, and never had the answer, is not behind. Otherwise nothing is changed, and the answer is 409 with the
/// outline as it is: an editor that is behind (another device, another screen, a write it never heard of) cannot put
/// the lines it holds over a newer save. The compare and the write are one statement, in the save's transaction.
/// A save that names no stamp is made as it always was, which is every app released before the fields; it leaves
/// its writer if it named one, and none if not, so that an editor behind it is refused.
fn changed_since(o: Outline) -> Response {
    (StatusCode::CONFLICT, Json(json!({ "error": "This was changed somewhere else since it was loaded.", "outline": o }))).into_response()
}
/// A writer's name is the sender's own making: 1 to 64 letters, digits, hyphens and underscores. Anything else is
/// refused outright, with nothing saved: a name the server cut or cleaned would not be the name its sender compares.
fn validate_writer(w: &Option<String>) -> ApiResult<()> {
    match w {
        Some(w) if w.is_empty() || w.len() > 64 || !w.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') => Err(ApiError::bad("writer: 1-64 letters, digits, - or _")),
        _ => Ok(()),
    }
}
/// What a save answers: the outline as it stands, when its stamp is still the save's own; as the save left it, when
/// another has been made since. So the stamp an app takes from the answer is never one of a save it has not seen.
fn answer(conn: &Connection, saved: Outline) -> rusqlite::Result<Response> {
    Ok(Json(match load(conn, saved.id)? { Some(now) if now.updated_at == saved.updated_at => now, _ => saved }).into_response())
}
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
async fn patch(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>, Json(m): Json<Meta>) -> ApiResult<Response> {
    validate_meta(&m)?;
    validate_writer(&m.writer)?;
    let mut conn = s.pool.get()?;
    let Some(o) = load(&conn, id)? else { return Err(ApiError::not_found("not found")) };
    if o.user_id != u.id { return Err(ApiError::not_found("not found")); }
    // an unchanged visibility is no change; 'public' is reached through publish, never by a PATCH
    let visibility = m.visibility.clone().filter(|v| *v != o.visibility);
    if visibility.as_deref() == Some("public") { return Err(ApiError::bad("Publish an outline with Publish")); }
    // choosing Private or Anyone with the link on a published outline unpublishes it
    let tx = conn.transaction()?;
    let n = tx.execute("UPDATE outlines SET title=coalesce(?1, title), description=CASE WHEN ?2 THEN ?3 ELSE description END, visibility=coalesce(?4, visibility), print_style=coalesce(?5, print_style), updated_at=?6, last_writer=?9,
        published_at=CASE WHEN ?4 IS NOT NULL THEN NULL ELSE published_at END WHERE id=?7 AND (?8 IS NULL OR updated_at=?8 OR (?9 IS NOT NULL AND last_writer=?9))",
        params![m.title.as_deref().map(str::trim), m.description.is_some(), m.description.clone().flatten(), visibility, m.print_style, now_iso(), id, m.if_updated, m.writer])?;
    if n == 0 {
        drop(tx);
        return match load(&conn, id)? { Some(now) => Ok(changed_since(now)), None => Err(ApiError::not_found("not found")) };
    }
    let Some(saved) = load(&tx, id)? else { return Err(ApiError::not_found("not found")) };
    tx.commit()?;
    check_badges(&conn, u.id)?;
    if saved.visibility != "private" { crate::moderation::auto_scan(&conn, "outline", id)?; }
    Ok(answer(&conn, saved)?)
}
#[derive(Deserialize)]
struct ItemIn { kind: String, book: Option<i64>, chapter: Option<i64>, v1: Option<i64>, v2: Option<i64>, text: Option<String>, url: Option<String>, #[serde(default)] depth: i64 }
#[derive(Deserialize)] struct ItemsIn { items: Vec<ItemIn>, /** The `updated_at` the app last saw, and who is saving: see `changed_since`. */ if_updated: Option<String>, writer: Option<String> }
async fn put_items(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>, Json(b): Json<ItemsIn>) -> ApiResult<Response> {
    if b.items.len() > 2000 { return Err(ApiError::bad("too many items")); }
    validate_writer(&b.writer)?;
    let mut conn = s.pool.get()?;
    let owner: Option<i64> = conn.query_row("SELECT user_id FROM outlines WHERE id=?1", params![id], |r| r.get(0)).optional()?;
    if owner != Some(u.id) { return Err(ApiError::not_found("not found")); }
    let tx = conn.transaction()?;
    // the stamp and the writer first: this is the compare, and every line below is written under it or not at all
    let n = tx.execute("UPDATE outlines SET updated_at=?1, last_writer=?4 WHERE id=?2 AND (?3 IS NULL OR updated_at=?3 OR (?4 IS NOT NULL AND last_writer=?4))", params![now_iso(), id, b.if_updated, b.writer])?;
    if n == 0 {
        drop(tx);
        return match load(&conn, id)? { Some(now) => Ok(changed_since(now)), None => Err(ApiError::not_found("not found")) };
    }
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
    let Some(saved) = load(&tx, id)? else { return Err(ApiError::not_found("not found")) };
    tx.commit()?;
    if saved.visibility != "private" { crate::moderation::auto_scan(&conn, "outline", id)?; }
    Ok(answer(&conn, saved)?)
}
#[derive(Deserialize)] struct ForkIn { code: Option<String> }
/// The owner copies their own by id; anyone else only with its share code, as the link gave it.
async fn fork(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>, Json(b): Json<ForkIn>) -> ApiResult<Json<Outline>> {
    let mut conn = s.pool.get()?;
    let Some(o) = load(&conn, id)? else { return Err(ApiError::not_found("not found")) };
    let via_code = b.code.is_some() && b.code == o.share_code;
    if !can_read(&o, Some(u.id), via_code) { return Err(ApiError::not_found("not found")); }
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
        .route("/search", get(search_mine))
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

    /// `if_updated`: the `updated_at` the app last saw. A save that names it is made only on the outline as it was
    /// then, so an editor that is behind cannot write its lines of before over a newer save. A save that names none
    /// is made as it always was, which is every app released before the field.
    #[tokio::test]
    async fn a_save_that_names_the_stamp_it_last_saw_is_refused_once_the_outline_has_changed() {
        let (app, pool) = app();
        let (_, anna) = user(&pool, "anna");
        let (_, ben) = user(&pool, "ben");
        let id = outline(&app, &anna, "Love in John", "God so loved").await;
        let (one, lines) = (format!("/outlines/{id}"), format!("/outlines/{id}/items"));
        let stamp = |o: &Value| o["updated_at"].as_str().unwrap().to_string();
        let texts = |o: &Value| o["items"].as_array().unwrap().iter().map(|i| i["text"].as_str().unwrap_or("").to_string()).collect::<Vec<_>>();
        let seen = stamp(&call(&app, "GET", &one, Some(&anna), NULL).await.1);

        // changed from another device, by an app that names no stamp: saved, as before
        let (st, theirs) = call(&app, "PUT", &lines, Some(&anna), json!({ "items": [{ "kind": "note", "text": "From another device" }] })).await;
        assert_eq!((st, texts(&theirs)), (200, vec!["From another device".to_string()]));
        let now = stamp(&theirs);
        assert_ne!(now, seen, "every save moves the stamp");

        // lines from an editor that is behind: refused, nothing changed, and the outline as it is comes with the refusal
        let (st, r) = call(&app, "PUT", &lines, Some(&anna), json!({ "items": [{ "kind": "note", "text": "From an editor that is behind" }], "if_updated": seen })).await;
        assert_eq!(st, 409);
        assert_eq!((stamp(&r["outline"]), texts(&r["outline"])), (now.clone(), vec!["From another device".to_string()]));
        assert!(r["error"].is_string());
        // its title and settings, the same
        let (st, r) = call(&app, "PATCH", &one, Some(&anna), json!({ "title": "A title from behind", "visibility": "link", "if_updated": seen })).await;
        assert_eq!((st, r["outline"]["title"].as_str(), r["outline"]["visibility"].as_str()), (409, Some("Love in John"), Some("private")));
        let o = call(&app, "GET", &one, Some(&anna), NULL).await.1;
        assert_eq!((stamp(&o), texts(&o), o["title"].as_str(), o["visibility"].as_str()), (now.clone(), vec!["From another device".to_string()], Some("Love in John"), Some("private")));

        // naming the stamp the outline has: saved, and the answer carries the new stamp
        let (st, o) = call(&app, "PUT", &lines, Some(&anna), json!({ "items": [{ "kind": "note", "text": "From an editor that is not behind" }], "if_updated": now })).await;
        assert_eq!((st, texts(&o)), (200, vec!["From an editor that is not behind".to_string()]));
        let second = stamp(&o);
        assert_ne!(second, now);
        let (st, o) = call(&app, "PATCH", &one, Some(&anna), json!({ "title": "Love", "if_updated": second })).await;
        assert_eq!((st, o["title"].as_str()), (200, Some("Love")));
        let third = stamp(&o);
        assert_ne!(third, second);
        // and that stamp is spent by the save it allowed
        assert_eq!(call(&app, "PATCH", &one, Some(&anna), json!({ "title": "Love again", "if_updated": second })).await.0, 409);
        assert_eq!(call(&app, "PUT", &lines, Some(&anna), json!({ "items": [], "if_updated": second })).await.0, 409);

        // lines the server will not take, with the right stamp: refused for the lines, and the stamp is as it was
        assert_eq!(call(&app, "PUT", &lines, Some(&anna), json!({ "items": [{ "kind": "nonsense" }], "if_updated": third })).await.0, 400);
        let o = call(&app, "GET", &one, Some(&anna), NULL).await.1;
        assert_eq!((stamp(&o), texts(&o)), (third.clone(), vec!["From an editor that is not behind".to_string()]));

        // someone else's outline is not there, whatever stamp is named: a refusal would say that it is
        for named in [third.clone(), seen.clone()] {
            assert_eq!(call(&app, "PUT", &lines, Some(&ben), json!({ "items": [], "if_updated": named })).await.0, 404);
            assert_eq!(call(&app, "PATCH", &one, Some(&ben), json!({ "title": "Ben's", "if_updated": named })).await.0, 404);
        }

        // no stamp named: as before, whatever the outline's stamp
        let (st, o) = call(&app, "PUT", &lines, Some(&anna), json!({ "items": [{ "kind": "note", "text": "From an app before the field" }] })).await;
        assert_eq!((st, texts(&o)), (200, vec!["From an app before the field".to_string()]));
        let (st, o) = call(&app, "PATCH", &one, Some(&anna), json!({ "title": "Titled by an app before the field" })).await;
        assert_eq!((st, o["title"].as_str(), texts(&o)), (200, Some("Titled by an app before the field"), vec!["From an app before the field".to_string()]));
    }

    /// The rule is not "your stamp is old" but "someone other than you has saved since you last saw it". A save may
    /// name, beside the stamp, who is saving (`writer`), and the outline keeps the writer of its last save. A save
    /// that names a stamp is made when the stamp is the outline's, or when the last save was this writer's own.
    #[tokio::test]
    async fn a_save_is_refused_when_someone_else_has_saved_since_and_not_for_the_writers_own_earlier_save() {
        let (app, pool) = app();
        let (_, anna) = user(&pool, "anna");
        let (_, ben) = user(&pool, "ben");
        let stamp = |o: &Value| o["updated_at"].as_str().unwrap().to_string();
        let texts = |o: &Value| o["items"].as_array().unwrap().iter().map(|i| i["text"].as_str().unwrap_or("").to_string()).collect::<Vec<_>>();
        let lines = |text: &str, seen: Option<&str>, writer: Option<&str>| {
            let mut b = json!({ "items": [{ "kind": "note", "text": text }] });
            if let Some(s) = seen { b["if_updated"] = json!(s); }
            if let Some(w) = writer { b["writer"] = json!(w); }
            b
        };
        let last_writer = |id: i64| pool.get().unwrap().query_row("SELECT last_writer FROM outlines WHERE id=?1", rusqlite::params![id], |r| r.get::<_, Option<String>>(0)).unwrap();
        let (e, d) = ("editor-E-0123456789abcdef", "editor-D-0123456789abcdef");

        // 1. E saves, the answer is lost, E retries with the stamp of before its own save: made
        let id = outline(&app, &anna, "Case one", "as loaded").await;
        let (one, put) = (format!("/outlines/{id}"), format!("/outlines/{id}/items"));
        let loaded = stamp(&call(&app, "GET", &one, Some(&anna), NULL).await.1);
        let (st, o) = call(&app, "PUT", &put, Some(&anna), lines("E's words", Some(&loaded), Some(e))).await;
        assert_eq!((st, last_writer(id).as_deref()), (200, Some(e)));
        let first = stamp(&o);
        let (st, o) = call(&app, "PUT", &put, Some(&anna), lines("E's words, sent again", Some(&loaded), Some(e))).await;
        assert_eq!((st, texts(&o)), (200, vec!["E's words, sent again".to_string()]), "E's own save moved the stamp: no one else has saved");
        assert_ne!(stamp(&o), first);

        // 2. two saves of E's name the same stamp (one on its way when the page closed): both made, the later's words stay;
        //    and E's title, sent at once with its lines, names a stamp the lines have spent
        let id = outline(&app, &anna, "Case two", "as loaded").await;
        let (one, put) = (format!("/outlines/{id}"), format!("/outlines/{id}/items"));
        let loaded = stamp(&call(&app, "GET", &one, Some(&anna), NULL).await.1);
        assert_eq!(call(&app, "PUT", &put, Some(&anna), lines("on its way", Some(&loaded), Some(e))).await.0, 200);
        let (st, o) = call(&app, "PUT", &put, Some(&anna), lines("the last words before the page closed", Some(&loaded), Some(e))).await;
        assert_eq!((st, texts(&o)), (200, vec!["the last words before the page closed".to_string()]));
        let (st, o) = call(&app, "PATCH", &one, Some(&anna), json!({ "title": "Case two, retitled", "if_updated": loaded, "writer": e })).await;
        assert_eq!((st, o["title"].as_str(), last_writer(id).as_deref()), (200, Some("Case two, retitled"), Some(e)));

        // 3. E saves; D saves; E saves naming the stamp of its own last save: refused, nothing changed
        let id = outline(&app, &anna, "Case three", "as loaded").await;
        let (one, put) = (format!("/outlines/{id}"), format!("/outlines/{id}/items"));
        let loaded = stamp(&call(&app, "GET", &one, Some(&anna), NULL).await.1);
        let es = stamp(&call(&app, "PUT", &put, Some(&anna), lines("E's words", Some(&loaded), Some(e))).await.1);
        let (st, o) = call(&app, "PUT", &put, Some(&anna), lines("D's words", Some(&es), Some(d))).await;
        assert_eq!(st, 200);
        let ds = stamp(&o);
        let (st, r) = call(&app, "PUT", &put, Some(&anna), lines("E's words over D's", Some(&es), Some(e))).await;
        assert_eq!((st, texts(&r["outline"]), stamp(&r["outline"])), (409, vec!["D's words".to_string()], ds.clone()));
        let (st, r) = call(&app, "PATCH", &one, Some(&anna), json!({ "title": "E's title over D's save", "if_updated": es, "writer": e })).await;
        assert_eq!((st, r["outline"]["title"].as_str()), (409, Some("Case three")));
        assert_eq!((last_writer(id).as_deref(), stamp(&call(&app, "GET", &one, Some(&anna), NULL).await.1)), (Some(d), ds), "a refused save leaves the writer and the stamp");

        // 4. E saves (the answer is lost); D saves; E retries with the stamp of before its own save: refused
        let id = outline(&app, &anna, "Case four", "as loaded").await;
        let (one, put) = (format!("/outlines/{id}"), format!("/outlines/{id}/items"));
        let loaded = stamp(&call(&app, "GET", &one, Some(&anna), NULL).await.1);
        let es = stamp(&call(&app, "PUT", &put, Some(&anna), lines("E's words", Some(&loaded), Some(e))).await.1);
        assert_eq!(call(&app, "PUT", &put, Some(&anna), lines("D's words", Some(&es), Some(d))).await.0, 200);
        let (st, r) = call(&app, "PUT", &put, Some(&anna), lines("E's words, sent again", Some(&loaded), Some(e))).await;
        assert_eq!((st, texts(&r["outline"])), (409, vec!["D's words".to_string()]), "the last to save was D");

        // 5. E at an old stamp, never having saved, after D saved: refused
        let id = outline(&app, &anna, "Case five", "as loaded").await;
        let (one, put) = (format!("/outlines/{id}"), format!("/outlines/{id}/items"));
        let loaded = stamp(&call(&app, "GET", &one, Some(&anna), NULL).await.1);
        assert_eq!(call(&app, "PUT", &put, Some(&anna), lines("D's words", Some(&loaded), Some(d))).await.0, 200);
        let (st, r) = call(&app, "PUT", &put, Some(&anna), lines("E's words", Some(&loaded), Some(e))).await;
        assert_eq!((st, texts(&r["outline"])), (409, vec!["D's words".to_string()]));

        // 6. E saves; a save that names nothing lands (verses added from the reader, an app before the fields); E saves: refused
        let id = outline(&app, &anna, "Case six", "as loaded").await;
        let (one, put) = (format!("/outlines/{id}"), format!("/outlines/{id}/items"));
        let loaded = stamp(&call(&app, "GET", &one, Some(&anna), NULL).await.1);
        let es = stamp(&call(&app, "PUT", &put, Some(&anna), lines("E's words", Some(&loaded), Some(e))).await.1);
        let (st, o) = call(&app, "PUT", &put, Some(&anna), lines("E's words, and a verse added from the reader", None, None)).await;
        assert_eq!((st, last_writer(id)), (200, None), "a save that names no writer leaves none");
        let added = stamp(&o);
        for seen in [&es, &loaded] {
            let (st, r) = call(&app, "PUT", &put, Some(&anna), lines("E's words over the verse", Some(seen.as_str()), Some(e))).await;
            assert_eq!((st, texts(&r["outline"])), (409, vec!["E's words, and a verse added from the reader".to_string()]));
        }
        // a title saved with no fields does the same
        assert_eq!(call(&app, "PUT", &put, Some(&anna), lines("E again", Some(&added), Some(e))).await.0, 200);
        let es = stamp(&call(&app, "GET", &one, Some(&anna), NULL).await.1);
        assert_eq!(call(&app, "PATCH", &one, Some(&anna), json!({ "title": "Retitled by an app before the fields" })).await.0, 200);
        assert_eq!(last_writer(id), None);
        assert_eq!(call(&app, "PUT", &put, Some(&anna), lines("E over that", Some(&es), Some(e))).await.0, 409);

        // 7. E saves; Ask writes, under a writer of its own; E, not having taken what Ask read back, saves: refused.
        //    E with the stamp Ask's write left: made
        let id = outline(&app, &anna, "Case seven", "as loaded").await;
        let (one, put) = (format!("/outlines/{id}"), format!("/outlines/{id}/items"));
        let loaded = stamp(&call(&app, "GET", &one, Some(&anna), NULL).await.1);
        let es = stamp(&call(&app, "PUT", &put, Some(&anna), lines("E's words", Some(&loaded), Some(e))).await.1);
        let (st, o) = call(&app, "PUT", &put, Some(&anna), lines("E's words, and Ask's", Some(&es), Some("ask-0123456789abcdef"))).await;
        assert_eq!(st, 200);
        let asks = stamp(&o);
        assert_eq!(call(&app, "PUT", &put, Some(&anna), lines("E's words over Ask's", Some(&es), Some(e))).await.0, 409);
        let (st, o) = call(&app, "PUT", &put, Some(&anna), lines("E's words, Ask's, and more of E's", Some(&asks), Some(e))).await;
        assert_eq!((st, texts(&o), last_writer(id).as_deref()), (200, vec!["E's words, Ask's, and more of E's".to_string()], Some(e)));

        // a writer named with no stamp: saved whatever the stamp, as any save without one, and the writer is kept
        let (st, _) = call(&app, "PUT", &put, Some(&anna), lines("D, naming no stamp", None, Some(d))).await;
        assert_eq!((st, last_writer(id).as_deref()), (200, Some(d)));
        assert_eq!(call(&app, "PUT", &put, Some(&anna), lines("D again, at a spent stamp", Some(&asks), Some(d))).await.0, 200);

        // 8. a writer that is empty, too long or made of anything but letters, digits, - and _: 400, and nothing changed
        let before = call(&app, "GET", &one, Some(&anna), NULL).await.1;
        let long = "w".repeat(65);
        for bad in ["", long.as_str(), "has space", "tab\there", "é-accent", "semi;colon", "quote\"d"] {
            for seen in [None, Some(stamp(&before))] {
                assert_eq!(call(&app, "PUT", &put, Some(&anna), lines("from a writer with a bad name", seen.as_deref(), Some(bad))).await.0, 400, "PUT {bad:?}");
                let mut b = json!({ "title": "From a writer with a bad name", "writer": bad });
                if let Some(s) = &seen { b["if_updated"] = json!(s); }
                assert_eq!(call(&app, "PATCH", &one, Some(&anna), b).await.0, 400, "PATCH {bad:?}");
            }
        }
        let after = call(&app, "GET", &one, Some(&anna), NULL).await.1;
        assert_eq!((stamp(&after), texts(&after), after["title"].as_str(), last_writer(id).as_deref()), (stamp(&before), texts(&before), before["title"].as_str(), Some(d)));
        // 64 of them is a name
        let longest = "W".repeat(64);
        assert_eq!(call(&app, "PUT", &put, Some(&anna), lines("from the longest name", Some(&stamp(&before)), Some(&longest))).await.0, 200);

        // 9. someone else's outline is not there, whatever is named, its own last writer included: never a refusal that says it is
        let now = stamp(&call(&app, "GET", &one, Some(&anna), NULL).await.1);
        for (seen, writer) in [(Some(now.as_str()), Some(longest.as_str())), (Some("a stamp it never had"), Some(longest.as_str())), (Some(now.as_str()), None), (None, Some(e)), (None, None)] {
            assert_eq!(call(&app, "PUT", &put, Some(&ben), lines("Ben's", seen, writer)).await.0, 404, "{seen:?} {writer:?}");
            let mut b = json!({ "title": "Ben's" });
            if let Some(s) = seen { b["if_updated"] = json!(s); }
            if let Some(w) = writer { b["writer"] = json!(w); }
            assert_eq!(call(&app, "PATCH", &one, Some(&ben), b).await.0, 404, "{seen:?} {writer:?}");
        }
        let o = call(&app, "GET", &one, Some(&anna), NULL).await.1;
        assert_eq!((stamp(&o), texts(&o)), (now, vec!["from the longest name".to_string()]));
    }

    /// What the rule does not cover, set down so that it is known: a change made to an outline otherwise than by a
    /// save through these two routes moves no stamp and names no writer. Posting an outline to a group makes a private
    /// one readable by its link (groups.rs `post_create`) in just that way, and the editor's save of a title carries
    /// its whole record, the visibility it loaded with it.
    #[tokio::test]
    async fn a_change_that_moves_no_stamp_is_not_seen_by_a_save_that_names_one() {
        let (app, pool) = app();
        let (_, anna) = user(&pool, "anna");
        let id = outline(&app, &anna, "Shared to a group", "as loaded").await;
        let one = format!("/outlines/{id}");
        let loaded = call(&app, "GET", &one, Some(&anna), NULL).await.1;
        // as a group post does it
        pool.get().unwrap().execute("UPDATE outlines SET visibility='link' WHERE id=?1", rusqlite::params![id]).unwrap();
        let (st, o) = call(&app, "PATCH", &one, Some(&anna), json!({ "title": "Shared to a group, retitled", "visibility": "private", "if_updated": loaded["updated_at"], "writer": "editor-E-0123456789abcdef" })).await;
        assert_eq!((st, o["visibility"].as_str()), (200, Some("private")), "the stamp is the one the editor loaded: the save is made, and the link is closed again");
    }

    #[tokio::test]
    async fn the_owner_copies_by_id_and_anyone_else_only_with_the_link() {
        let (app, pool) = app();
        let (_, anna) = user(&pool, "anna");
        let (_, ben) = user(&pool, "ben");
        let id = outline(&app, &anna, "Love in John", "God so loved").await;
        call(&app, "PATCH", &format!("/outlines/{id}"), Some(&anna), json!({ "visibility": "link" })).await;
        let code = call(&app, "GET", &format!("/outlines/{id}"), Some(&anna), NULL).await.1["share_code"].as_str().unwrap().to_string();
        let fork = format!("/outlines/{id}/fork");
        let (st, o) = call(&app, "POST", &fork, Some(&anna), json!({})).await;
        assert_eq!((st, o["forked_from"].as_i64()), (200, Some(id)), "the owner, by id");
        // by its number alone, or with a code that is not its own, someone else's is not there
        for body in [json!({}), json!({ "code": null }), json!({ "code": "wrong" })] {
            assert_eq!(call(&app, "POST", &fork, Some(&ben), body.clone()).await.0, 404, "{body}");
        }
        let (st, o) = call(&app, "POST", &fork, Some(&ben), json!({ "code": code })).await;
        assert_eq!((st, o["title"].as_str(), o["visibility"].as_str(), o["items"].as_array().map(|i| i.len())), (200, Some("Love in John"), Some("private"), Some(2)));
        // made private, or hidden by moderation: not even with the code
        call(&app, "PATCH", &format!("/outlines/{id}"), Some(&anna), json!({ "visibility": "private" })).await;
        assert_eq!(call(&app, "POST", &fork, Some(&ben), json!({ "code": code })).await.0, 404);
        call(&app, "PATCH", &format!("/outlines/{id}"), Some(&anna), json!({ "visibility": "link" })).await;
        pool.get().unwrap().execute("UPDATE outlines SET hidden=1 WHERE id=?1", rusqlite::params![id]).unwrap();
        assert_eq!(call(&app, "POST", &fork, Some(&ben), json!({ "code": code })).await.0, 404);
    }

    #[tokio::test]
    async fn a_reader_searches_their_own_jottings_and_no_one_elses() {
        let (app, pool) = app();
        let (_, anna) = user(&pool, "anna");
        let (_, ben) = user(&pool, "ben");
        outline(&app, &anna, "Love", "God so loved the world, and the Son came").await;
        outline(&app, &anna, "Morning", "Grace upon grace this morning").await;
        outline(&app, &ben, "Ben's love", "The love of God, as Ben has it").await;
        let find = |t: &str, q: &str| { let (app, t, q) = (app.clone(), t.to_string(), q.to_string()); async move { call(&app, "GET", &format!("/outlines/search?q={}", q.replace(' ', "%20")), Some(&t), NULL).await } };
        let (st, r) = find(&anna, "loved world").await;
        assert_eq!(st, 200);
        assert_eq!(r.as_array().unwrap().len(), 1);
        assert_eq!(r[0]["title"], "Love");
        assert!(r[0]["snippet"].as_str().unwrap().contains("loved the world"));
        // a passage is found by its book's name; every jotting of hers holds John 3:16
        assert_eq!(find(&anna, "john").await.1.as_array().unwrap().len(), 2);
        // Ben's own words are his alone
        assert_eq!(find(&anna, "ben").await.1.as_array().unwrap().len(), 0);
        assert_eq!(find(&ben, "love").await.1.as_array().unwrap().len(), 1);
        assert_eq!(call(&app, "GET", "/outlines/search?q=love", None, NULL).await.0, 401);
    }
}
