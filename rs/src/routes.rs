use crate::activity::{self, Beat};
use crate::auth::{self, AuthUser, MaybeUser};
use crate::badges::{check_badges, user_badges};
use crate::bible;
use crate::books::BOOKS;
use crate::db::{now_iso, verse_id};
use crate::edition::{self, Edition};
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::{extract::{Path, Query, State}, http::header, response::{IntoResponse, Response}, routing::{get, post, put}, Json, Router};
use axum_extra::extract::CookieJar;
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

fn cached(v: impl serde::Serialize, secs: u32) -> Response {
    let mut r = Json(v).into_response();
    r.headers_mut().insert(header::CACHE_CONTROL, format!("public, max-age={secs}").parse().unwrap());
    r
}

// ---------------- scripture ----------------
async fn books(State(s): State<AppState>) -> ApiResult<Response> {
    let counts = s.db(|conn| Ok(bible::verse_counts(conn)?)).await?;
    let books: Vec<Value> = BOOKS.iter().map(|b| json!({ "n": b.n, "name": b.name, "abbr": b.abbr, "osis": b.osis, "testament": if b.n <= 39 { "OT" } else { "NT" }, "chapters": b.chapters })).collect();
    Ok(cached(json!({ "books": books, "verse_counts": counts }), 86400))
}
#[derive(Deserialize)] struct ChapterQ { words: Option<String> }
async fn chapter(State(s): State<AppState>, Path((book, chapter)): Path<(i64, i64)>, Query(q): Query<ChapterQ>) -> ApiResult<Response> {
    let with_words = q.words.as_deref() == Some("1");
    let ed = s.edition().await;
    match s.db(move |conn| Ok(bible::get_chapter(conn, &edition::tables(conn, ed), book, chapter, with_words)?)).await? { Some(c) => Ok(cached(c, 86400)), None => Err(ApiError::not_found("no such chapter")) }
}
async fn verse(State(s): State<AppState>, Path((book, chapter, verse)): Path<(i64, i64, i64)>) -> ApiResult<Response> {
    let ed = s.edition().await;
    let Some(c) = s.db(move |conn| Ok(bible::get_chapter(conn, &edition::tables(conn, ed), book, chapter, false)?)).await? else { return Err(ApiError::not_found("no such verse")) };
    let Some(v) = c.verses.into_iter().find(|v| v.v == verse) else { return Err(ApiError::not_found("no such verse")) };
    let mut val = serde_json::to_value(v).unwrap();
    val["book"] = json!(book); val["chapter"] = json!(chapter);
    Ok(cached(val, 86400))
}
#[derive(Deserialize)] struct VersesQ { refs: Option<String> }
async fn verses(State(s): State<AppState>, Query(q): Query<VersesQ>) -> ApiResult<Response> {
    let ed = s.edition().await;
    let out = s.db(move |conn| {
        let t = edition::tables(conn, ed);
        let mut out = Vec::new();
        for key in q.refs.unwrap_or_default().split(',').filter(|k| !k.is_empty()).take(200) {
            let parts: Vec<&str> = key.split('.').collect();
            let (Some(b), Some(c)) = (parts.first().and_then(|x| x.parse::<i64>().ok()), parts.get(1).and_then(|x| x.parse::<i64>().ok())) else { out.push(json!({ "key": key, "verses": [] })); continue; };
            let (v1, v2) = match parts.get(2) { Some(r) => { let mut it = r.split('-'); let a = it.next().and_then(|x| x.parse::<i64>().ok()).unwrap_or(1); let b2 = it.next().and_then(|x| x.parse::<i64>().ok()).unwrap_or(a); (a, b2) } None => (1, 999) };
            out.push(json!({ "key": key, "book": b, "chapter": c, "verses": bible::get_range(conn, &t, b, c, v1, v2)? }));
        }
        Ok(out)
    }).await?;
    Ok(cached(out, 3600))
}
#[derive(Deserialize)] struct SearchQ { q: Option<String>, limit: Option<i64>, offset: Option<i64>, scope: Option<String>, order: Option<String> }
async fn search(State(s): State<AppState>, Query(q): Query<SearchQ>) -> ApiResult<Response> {
    let ed = s.edition().await;
    Ok(cached(s.db(move |conn| Ok(crate::search::search(conn, &edition::tables(conn, ed), q.q.as_deref().unwrap_or(""), q.limit.unwrap_or(50), q.offset.unwrap_or(0), q.scope.as_deref().unwrap_or("all"), crate::search::Order::parse(q.order.as_deref()))?)).await?, 300))
}
#[derive(Deserialize)] struct StrongsQ { limit: Option<i64>, offset: Option<i64> }
async fn strongs(State(s): State<AppState>, Path(code): Path<String>, Query(q): Query<StrongsQ>) -> ApiResult<Response> {
    let code = code.to_uppercase();
    let code = match code.split_at_checked(1) { Some((p, rest)) if p == "H" || p == "G" => format!("{}{}", p, rest.trim_start_matches('0')), _ => code };
    // one page of verses (30 unless asked), in canonical order; the entry, renderings and book counts come with every page
    let ed = s.edition().await;
    Ok(cached(s.db(move |conn| Ok(bible::strongs_info(conn, &edition::tables(conn, ed), &code, q.limit.unwrap_or(30).clamp(1, 200), q.offset.unwrap_or(0).max(0))?)).await?, 86400))
}
/// The numbers behind an English word (`bible::word_codes`): what the word sheet opens on for a word of the ministry.
async fn strongs_word(State(s): State<AppState>, Path(word): Path<String>) -> ApiResult<Response> {
    let ed = s.edition().await;
    Ok(cached(s.db(move |conn| Ok(json!({ "word": word, "codes": bible::word_codes(conn, &edition::tables(conn, ed), &word)? }))).await?, 86400))
}
fn json_day(body: String) -> Response { let mut r = ([(header::CONTENT_TYPE, "application/json")], body).into_response(); r.headers_mut().insert(header::CACHE_CONTROL, "public, max-age=86400".parse().unwrap()); r }
/// The 1961 edition's chronological table; the 1890 edition has none.
async fn chronology(State(s): State<AppState>) -> ApiResult<Response> {
    if s.edition().await == Edition::E1890 { return Err(ApiError::not_found("the chronological table is not part of this edition")) }
    Ok(json_day(include_str!("../../data/ccel/chronology.json").into()))
}
/// data/notices_1890.json, when the 1890 edition has notices of its own (compiled in when present).
#[derive(rust_embed::Embed)]
#[folder = "../data/"]
#[include = "notices_1890.json"]
struct Notices1890;
async fn intro(State(s): State<AppState>) -> Response {
    static INTRO_1890: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    const INTRO: &str = include_str!("../../data/ccel/intro.json");
    match s.edition().await {
        Edition::E1961 => json_day(INTRO.into()),
        Edition::E1890 => json_day(INTRO_1890.get_or_init(|| {
            let own = Notices1890::get("notices_1890.json").and_then(|f| String::from_utf8(f.data.into_owned()).ok());
            edition::intro_json(Edition::E1890, INTRO, own.as_deref())
        }).clone()),
    }
}
/// `{ edition: "1961" | "1890", cleanse: bool }`: what the server serves now (docs/EDITION.md); the app asks on start and on return.
async fn edition_now(State(s): State<AppState>) -> Response { let v = s.served().await; cached(json!({ "edition": v.edition.as_str(), "cleanse": v.cleanse }), 60) }

// ---------------- auth ----------------
#[derive(Deserialize)] struct Creds { handle: String, password: String, display_name: Option<String> }
// argon2 is ~19 MiB and tens of ms of CPU per hash: kept off the runtime workers with the database work
async fn register(State(s): State<AppState>, seen: crate::bans::Seen, jar: CookieJar, Json(b): Json<Creds>) -> ApiResult<(CookieJar, Json<Value>)> {
    let (user, (token, cookie)) = s.db(move |conn| {
        // not from a banned person's network or device (bans.rs)
        crate::bans::check_signup(conn, &seen, &[])?;
        let user = auth::register(conn, &b.handle, b.display_name.as_deref().unwrap_or(""), &b.password)?;
        let session = auth::create_session(conn, user.id)?;
        crate::bans::touch(conn, user.id, &session.0, &seen)?;
        Ok((user, session))
    }).await?;
    Ok((jar.add(cookie), Json(json!({ "user": user, "token": token }))))
}
async fn login(State(s): State<AppState>, seen: crate::bans::Seen, jar: CookieJar, Json(b): Json<Creds>) -> ApiResult<(CookieJar, Json<Value>)> {
    let (user, (token, cookie)) = s.db(move |conn| {
        let user = auth::login(conn, &b.handle, &b.password)?;
        let session = auth::create_session(conn, user.id)?;
        if !crate::bans::touch(conn, user.id, &session.0, &seen)? { return Err(ApiError::forbidden("this account has been suspended")); }
        Ok((user, session))
    }).await?;
    Ok((jar.add(cookie), Json(json!({ "user": user, "token": token }))))
}
async fn logout(State(s): State<AppState>, jar: CookieJar) -> ApiResult<(CookieJar, Json<Value>)> {
    if let Some(c) = jar.get(auth::COOKIE) { let conn = s.pool.get()?; conn.execute("DELETE FROM sessions WHERE token=?1", params![c.value()])?; }
    let mut c = axum_extra::extract::cookie::Cookie::from(auth::COOKIE); c.set_path("/");
    Ok((jar.remove(c), Json(json!({ "ok": true }))))
}
async fn me(MaybeUser(u): MaybeUser) -> Json<Value> { Json(json!({ "user": u, "settings": u.as_ref().map(|u| u.settings.clone()) })) }
#[derive(Deserialize)] struct MeIn { display_name: Option<String>, handle: Option<String>, settings: Option<serde_json::Map<String, Value>>, #[serde(default, deserialize_with = "some")] avatar: Option<Option<String>> }
/// `"avatar": null` (back to the default) is kept apart from a missing key.
fn some<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> { T::deserialize(d).map(Some) }
async fn patch_me(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<MeIn>) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    if let Some(n) = b.display_name { let n = n.trim(); if n.is_empty() || n.chars().count() > 60 { return Err(ApiError::bad("display_name: 1-60 characters")); } if !crate::scan::name_ok(n) { return Err(ApiError::bad("that name is not allowed; please choose another")); } conn.execute("UPDATE users SET display_name=?1 WHERE id=?2", params![n, u.id])?; }
    // a new handle only when the admin has taken the old name away (feedback.rs admin_rename), and with it a new display
    // name: the two together end the forced rename
    if let Some(h) = b.handle {
        if !u.must_rename { return Err(ApiError::bad("the handle cannot be changed")); }
        let h = crate::auth::clean_handle(&h)?;
        if !crate::scan::name_ok(&h) { return Err(ApiError::bad("that handle is not allowed; please choose another")); }
        if h.starts_with("reader") && h[6..].chars().all(|c| c.is_ascii_digit()) { return Err(ApiError::bad("please choose a handle of your own")); }
        let taken: bool = conn.query_row("SELECT count(*) > 0 FROM users WHERE handle=?1 COLLATE NOCASE AND id<>?2", params![h, u.id], |r| r.get(0))?;
        if taken { return Err(ApiError::bad("that handle is taken")); }
        conn.execute("UPDATE users SET handle=?1, must_rename=0 WHERE id=?2", params![h, u.id])?;
    }
    if let Some(a) = b.avatar {
        if a.as_deref().is_some_and(|a| !crate::avatars::is_id(a)) { return Err(ApiError::bad("avatar: one of the preset pictures")); }
        conn.execute("UPDATE users SET avatar=?1 WHERE id=?2", params![a, u.id])?;
    }
    if let Some(patch) = b.settings { let mut cur = u.settings.as_object().cloned().unwrap_or_default(); for (k, v) in patch { cur.insert(k, v); } conn.execute("UPDATE users SET settings=?1 WHERE id=?2", params![Value::Object(cur).to_string(), u.id])?; }
    Ok(Json(json!({ "ok": true })))
}
/// Account deletion (Play policy): everything hangs off users(id) with ON DELETE CASCADE except groups.owner_id;
/// groups the user owns go with the account (their members, events and posts cascade from the group).
async fn delete_me(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<serde_json::Value>) -> ApiResult<Json<Value>> {
    if b.get("confirm").and_then(|v| v.as_str()) != Some("delete") { return Err(ApiError::bad("send {\"confirm\":\"delete\"}")); }
    let mut conn = s.pool.get()?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM groups WHERE owner_id=?1", params![u.id])?;
    tx.execute("DELETE FROM users WHERE id=?1", params![u.id])?;
    tx.commit()?;
    Ok(Json(json!({ "ok": true, "deleted": true })))
}
/// A profile is private unless its owner turns on `public_profile` (an absent key is private). Private: the owner sees
/// it all; friends, group-mates and the admin see the name and picture only; anyone else gets "no such user".
/// Public: anyone sees the totals, the streak and the badges. The per-day history is the owner's only, and no profile
/// lists jottings.
async fn user_profile(State(s): State<AppState>, MaybeUser(me): MaybeUser, Path(handle): Path<String>) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    let r: Option<(i64, String, String, String, String, i64, Option<String>, i64)> = conn.query_row("SELECT id, handle, display_name, created_at, settings, supporter, avatar, disabled FROM users WHERE handle=?1", params![handle], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?))).optional()?;
    let Some((id, handle, display_name, created_at, settings, supporter, avatar, disabled)) = r else { return Err(ApiError::not_found("no such user")) };
    let admin = me.as_ref().is_some_and(|m| m.is_admin == 1);
    let owner = me.as_ref().map(|m| m.id) == Some(id);
    if disabled == 1 && !admin { return Err(ApiError::not_found("no such user")); }
    let settings: Value = serde_json::from_str(&settings).unwrap_or(json!({}));
    let public = settings.get("public_profile").and_then(|v| v.as_bool()).unwrap_or(false);
    let known = match me.as_ref() {
        Some(m) if !public && !owner && !admin => crate::friends::are_friends(&conn, m.id, id)?
            || conn.query_row("SELECT count(*) > 0 FROM group_members a JOIN group_members b ON b.group_id=a.group_id WHERE a.user_id=?1 AND b.user_id=?2", params![m.id, id], |r| r.get(0))?,
        _ => false,
    };
    if !public && !owner && !admin && !known { return Err(ApiError::not_found("no such user")); }
    let mut base = json!({ "id": id, "handle": handle, "display_name": display_name, "created_at": created_at, "avatar": crate::avatars::effective(id, avatar.as_deref()) });
    // the Developer badge by a site admin's name while their Admin mode is on (auth::admin_mode)
    let site_admin: i64 = conn.query_row("SELECT is_admin FROM users WHERE id=?1", params![id], |r| r.get(0))?;
    if site_admin == 1 && settings.get("admin_mode").and_then(Value::as_bool) == Some(true) { base["staff"] = json!(true); }
    // the flag behind the secret Supporter badge is for the admin's control on this page only
    if admin { base["supporter"] = json!(supporter == 1); }
    if !public && !owner { return Ok(Json(json!({ "user": base, "private": true }))); }
    let badges: Vec<_> = user_badges(&conn, id)?.into_iter().filter(|b| b.earned_at.is_some()).collect();
    let mut stats = serde_json::to_value(activity::stats(&conn, id)?).unwrap();
    if !owner { let st = stats["streak"].take(); stats["streak"] = json!({ "current": st["current"], "longest": st["longest"] }); }
    let mut v = json!({ "user": base, "stats": stats, "badges": badges });
    if owner { v["public"] = json!(public); }
    Ok(Json(v))
}

// ---------------- personal ----------------
async fn bookmarks(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Vec<Value>>> {
    let conn = s.pool.get()?;
    let mut st = conn.prepare_cached("SELECT id, book, chapter, verse, label, color, created_at FROM bookmarks WHERE user_id=?1 ORDER BY created_at DESC, id DESC")?;
    let rows: Vec<Value> = st.query_map(params![u.id], bm_row)?.collect::<Result<_, _>>()?;
    Ok(Json(rows))
}
fn bm_row(r: &rusqlite::Row) -> rusqlite::Result<Value> { Ok(json!({ "id": r.get::<_, i64>(0)?, "book": r.get::<_, i64>(1)?, "chapter": r.get::<_, Option<i64>>(2)?, "verse": r.get::<_, Option<i64>>(3)?, "label": r.get::<_, Option<String>>(4)?, "color": r.get::<_, Option<String>>(5)?, "created_at": r.get::<_, String>(6)? })) }
/// A verse (book, chapter, verse), a chapter (no verse) or a book (no chapter, no verse).
#[derive(Deserialize)] struct BmIn { book: i64, chapter: Option<i64>, verse: Option<i64>, label: Option<String>, color: Option<String> }
async fn bookmark_create(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<BmIn>) -> ApiResult<Json<Value>> {
    let chapters = usize::try_from(b.book - 1).ok().and_then(|i| BOOKS.get(i)).map(|bk| i64::from(bk.chapters));
    let fits = match (chapters, b.chapter, b.verse) { (Some(n), Some(c), v) => (1..=n).contains(&c) && v.is_none_or(|v| v >= 1), (Some(_), None, None) => true, _ => false };
    if !fits { return Err(ApiError::bad("bad reference")); }
    let conn = s.pool.get()?;
    // one bookmark per target (bookmarks_target): a repeat returns the existing row instead of a duplicate
    conn.execute("INSERT INTO bookmarks (user_id, book, chapter, verse, label, color) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT DO NOTHING", params![u.id, b.book, b.chapter, b.verse, b.label, b.color])?;
    Ok(Json(conn.query_row("SELECT id, book, chapter, verse, label, color, created_at FROM bookmarks WHERE user_id=?1 AND book=?2 AND chapter IS ?3 AND verse IS ?4", params![u.id, b.book, b.chapter, b.verse], bm_row)?))
}
#[derive(Deserialize)] struct BmPatch { label: Option<String>, color: Option<String> }
async fn bookmark_patch(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>, Json(b): Json<BmPatch>) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    conn.execute("UPDATE bookmarks SET label=coalesce(?1, label), color=coalesce(?2, color) WHERE id=?3 AND user_id=?4", params![b.label, b.color, id, u.id])?;
    Ok(Json(json!({ "ok": true })))
}
async fn bookmark_delete(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    conn.execute("DELETE FROM bookmarks WHERE id=?1 AND user_id=?2", params![id, u.id])?;
    Ok(Json(json!({ "ok": true })))
}
#[derive(Deserialize)] struct HlQ { book: Option<i64>, chapter: Option<i64> }
async fn highlights(State(s): State<AppState>, AuthUser(u): AuthUser, Query(q): Query<HlQ>) -> ApiResult<Json<Vec<Value>>> {
    let rows = s.db(move |conn| Ok(if let (Some(b), Some(c)) = (q.book, q.chapter) {
        let mut st = conn.prepare_cached("SELECT verse_id, color FROM highlights WHERE user_id=?1 AND verse_id BETWEEN ?2 AND ?3")?;
        let v: Vec<Value> = st.query_map(params![u.id, verse_id(b, c, 0), verse_id(b, c, 999)], |r| Ok(json!({ "verse_id": r.get::<_, i64>(0)?, "color": r.get::<_, String>(1)? })))?.collect::<Result<_, _>>()?; v
    } else {
        let mut st = conn.prepare_cached("SELECT verse_id, color, created_at FROM highlights WHERE user_id=?1 ORDER BY created_at DESC LIMIT 500")?;
        let v: Vec<Value> = st.query_map(params![u.id], |r| Ok(json!({ "verse_id": r.get::<_, i64>(0)?, "color": r.get::<_, String>(1)?, "created_at": r.get::<_, String>(2)? })))?.collect::<Result<_, _>>()?; v
    })).await?;
    Ok(Json(rows))
}
#[derive(Deserialize)] struct HlIn { verse_id: i64, color: Option<String> }
async fn highlight_put(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<HlIn>) -> ApiResult<Json<Value>> {
    s.db(move |conn| {
        match b.color { Some(c) => { conn.prepare_cached("INSERT INTO highlights (user_id, verse_id, color) VALUES (?1,?2,?3) ON CONFLICT(user_id, verse_id) DO UPDATE SET color=excluded.color")?.execute(params![u.id, b.verse_id, c])?; } None => { conn.prepare_cached("DELETE FROM highlights WHERE user_id=?1 AND verse_id=?2")?.execute(params![u.id, b.verse_id])?; } }
        Ok(())
    }).await?;
    Ok(Json(json!({ "ok": true })))
}
async fn position(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Value>> {
    let r: Option<(i64, i64, i64)> = s.db(move |conn| Ok(conn.prepare_cached("SELECT book, chapter, verse FROM reading_positions WHERE user_id=?1")?.query_row(params![u.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?)).await?;
    let (b, c, v) = r.unwrap_or((1, 1, 1));
    Ok(Json(json!({ "book": b, "chapter": c, "verse": v })))
}
#[derive(Deserialize)] struct PosIn { book: i64, chapter: i64, #[serde(default = "one")] verse: i64 }
fn one() -> i64 { 1 }
async fn position_put(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<PosIn>) -> ApiResult<Json<Value>> {
    if !(1..=66).contains(&b.book) || b.chapter < 1 { return Err(ApiError::bad("bad reference")); }
    s.db(move |conn| {
        conn.prepare_cached("INSERT INTO reading_positions (user_id, book, chapter, verse, updated_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(user_id) DO UPDATE SET book=excluded.book, chapter=excluded.chapter, verse=excluded.verse, updated_at=excluded.updated_at")?
            .execute(params![u.id, b.book, b.chapter, b.verse.max(1), now_iso()])?;
        Ok(())
    }).await?;
    Ok(Json(json!({ "ok": true })))
}

// ---------------- activity ----------------
async fn beat(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<Beat>) -> ApiResult<Json<activity::BeatResult>> {
    if b.session_id.len() < 8 || b.session_id.len() > 64 { return Err(ApiError::bad("session_id")); }
    if let Some(bk) = b.book { if !(1..=66).contains(&bk) { return Err(ApiError::bad("book")); } }
    Ok(Json(s.db(move |conn| Ok(activity::beat(conn, u.id, &b)?)).await?))
}
/// `?tz=<minutes east of UTC>` on the stats reads: the reader's offset now, so "today" is their day even before a beat
/// has reported it; kept as their latest offset. Without it the stored one (or UTC) is used.
#[derive(Deserialize)] struct TzQ { tz: Option<i64> }
async fn stats(State(s): State<AppState>, AuthUser(u): AuthUser, Query(q): Query<TzQ>) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    activity::remember_offset(&conn, u.id, q.tz)?;
    let mut v = serde_json::to_value(activity::stats(&conn, u.id)?).unwrap();
    v["badges"] = json!(user_badges(&conn, u.id)?);
    Ok(Json(v))
}
#[derive(Deserialize)] struct CalQ { from: Option<String>, to: Option<String>, tz: Option<i64> }
async fn calendar(State(s): State<AppState>, AuthUser(u): AuthUser, Query(q): Query<CalQ>) -> ApiResult<Json<Vec<activity::CalDay>>> {
    let conn = s.pool.get()?;
    activity::remember_offset(&conn, u.id, q.tz)?;
    let today = activity::user_today(&conn, u.id);
    let to = q.to.unwrap_or_else(|| today.clone());
    let from = q.from.unwrap_or_else(|| activity::parse_day(&today).map(|d| activity::day_key(d - time::Duration::days(370))).unwrap_or_default());
    Ok(Json(activity::calendar(&conn, u.id, &from, &to)?))
}
async fn progress(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Value>> { let conn = s.pool.get()?; Ok(Json(json!(activity::progress_map(&conn, u.id)?))) }
async fn streak(State(s): State<AppState>, AuthUser(u): AuthUser, Query(q): Query<TzQ>) -> ApiResult<Json<activity::StreakInfo>> {
    let conn = s.pool.get()?;
    activity::remember_offset(&conn, u.id, q.tz)?;
    Ok(Json(activity::streak_info(&conn, u.id, &activity::user_today(&conn, u.id))?))
}
async fn recheck(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Vec<crate::badges::Badge>>> { let conn = s.pool.get()?; Ok(Json(check_badges(&conn, u.id)?)) }

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/bible/books", get(books))
        .route("/bible/verses", get(verses))
        .route("/bible/{book}/{chapter}", get(chapter))
        .route("/bible/{book}/{chapter}/{verse}", get(verse))
        .route("/search", get(search))
        .route("/strongs/{code}", get(strongs))
        .route("/strongs/word/{word}", get(strongs_word))
        .route("/chronology", get(chronology))
        .route("/edition", get(edition_now))
        .route("/intro", get(intro))
        .route("/dictionary", get(crate::dictionary::index))
        .route("/dictionary/{id}", get(crate::dictionary::entry))
        .route("/companion/{author}", get(crate::companion::index))
        .route("/companion/{author}/passage/{book}/{chapter}", get(crate::companion::passage))
        .route("/companion/{author}/{work}/{n}", get(crate::companion::section))
        .route("/ministry", get(crate::ministry::library))
        .route("/ministry/search", get(crate::ministry::search))
        .route("/ministry/offline", get(crate::ministry_offline::listing))
        .route("/ministry/offline/{author}", get(crate::ministry_offline::pack))
        .route("/ministry/offline/{author}/refs", get(crate::ministry_offline::refs))
        .route("/ministry/offline/{author}/{work}", get(crate::ministry_offline::work))
        .route("/ministry/chapter/{book}/{chapter}", get(crate::ministry::chapter))
        .route("/ministry/refs/{book}/{chapter}/{verses}", get(crate::ministry::refs))
        .route("/ministry/{author}/{work}", get(crate::ministry::work))
        .route("/ministry/{author}/{work}/{n}", get(crate::ministry::section))
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/google", post(crate::google::handler))
        .route("/auth/config", get(crate::google::config))
        .route("/me", get(me).patch(patch_me).delete(delete_me))
        .route("/me/path", get(crate::paths::get_mine).put(crate::paths::put_mine).delete(crate::paths::delete_mine))
        .route("/me/marks", get(crate::marks::list).post(crate::marks::bulk))
        .route("/me/marks/{book}/{chapter}", put(crate::marks::set).delete(crate::marks::clear))
        .route("/me/export", get(crate::me_data::export))
        .route("/me/restore-activity", post(crate::me_data::restore_activity).layer(axum::extract::DefaultBodyLimit::max(crate::me_data::RESTORE_BODY_LIMIT)))
        .route("/me/data", axum::routing::delete(crate::me_data::delete_data))
        .route("/users/{handle}", get(user_profile))
        .route("/link-preview", get(crate::link_preview::preview))
        .route("/bookmarks", get(bookmarks).post(bookmark_create))
        .route("/bookmarks/{id}", axum::routing::patch(bookmark_patch).delete(bookmark_delete))
        .route("/highlights", get(highlights).put(highlight_put))
        .route("/position", get(position).put(position_put))
        .route("/activity/beat", post(beat))
        .route("/stats", get(stats))
        .route("/stats/calendar", get(calendar))
        .route("/stats/progress", get(progress))
        .route("/stats/streak", get(streak))
        .route("/stats/recheck", post(recheck))
        .merge(crate::moderation::router())
        .merge(crate::feedback::router())
        .merge(crate::live::router())
        .nest("/outlines", crate::outlines::router())
        .nest("/groups", crate::groups::router())
        .nest("/friends", crate::friends::router())
        .nest("/tts", crate::tts::router())
}
// keep `put` import used
#[allow(dead_code)] fn _unused() -> axum::routing::MethodRouter<AppState> { put(position_put) }

#[cfg(test)]
mod tests {
    use crate::testkit::{app, call, user};
    use serde_json::{json, Value};
    const NULL: Value = Value::Null;
    /// "43", "43.3" or "43.3.16" per bookmark, newest first.
    fn targets(v: &Value) -> Vec<String> {
        v.as_array().unwrap().iter().map(|b| [&b["book"], &b["chapter"], &b["verse"]].iter().filter_map(|x| x.as_i64()).map(|n| n.to_string()).collect::<Vec<_>>().join(".")).collect()
    }

    #[tokio::test]
    async fn a_verse_a_chapter_and_a_book_are_three_bookmarks_each_kept_once() {
        let (app, pool) = app();
        let (_, anna) = user(&pool, "anna");
        let verse = call(&app, "POST", "/bookmarks", Some(&anna), json!({ "book": 43, "chapter": 3, "verse": 16 })).await.1;
        let chapter = call(&app, "POST", "/bookmarks", Some(&anna), json!({ "book": 43, "chapter": 3, "verse": null })).await.1;
        let book = call(&app, "POST", "/bookmarks", Some(&anna), json!({ "book": 43 })).await.1;
        assert_eq!((book["chapter"].clone(), book["verse"].clone()), (NULL, NULL));
        assert_ne!(verse["id"], chapter["id"]);
        assert_ne!(chapter["id"], book["id"]);
        // a repeat of each returns the row it already has
        for (body, first) in [(json!({ "book": 43, "chapter": 3, "verse": 16 }), &verse), (json!({ "book": 43, "chapter": 3 }), &chapter), (json!({ "book": 43, "chapter": null }), &book)] {
            let (st, again) = call(&app, "POST", "/bookmarks", Some(&anna), body).await;
            assert_eq!((st, &again["id"]), (200, &first["id"]));
        }
        let (_, list) = call(&app, "GET", "/bookmarks", Some(&anna), NULL).await;
        let mut got = targets(&list);
        got.sort();
        assert_eq!(got, ["43", "43.3", "43.3.16"]);
        // removing the chapter's leaves the verse and the book; bookmarking it again makes a new one
        call(&app, "DELETE", &format!("/bookmarks/{}", chapter["id"]), Some(&anna), NULL).await;
        let (_, list) = call(&app, "GET", "/bookmarks", Some(&anna), NULL).await;
        assert_eq!(list.as_array().unwrap().len(), 2);
        assert!(!targets(&list).contains(&"43.3".to_string()));
        let back = call(&app, "POST", "/bookmarks", Some(&anna), json!({ "book": 43, "chapter": 3 })).await.1;
        assert_ne!(back["id"], chapter["id"]);
    }

    #[tokio::test]
    async fn a_bookmark_must_name_a_real_place() {
        let (app, pool) = app();
        let (_, anna) = user(&pool, "anna");
        for body in [json!({ "book": 0 }), json!({ "book": 67 }), json!({ "book": 43, "chapter": 22 }), json!({ "book": 43, "chapter": 0 }), json!({ "book": 43, "verse": 16 }), json!({ "book": 43, "chapter": 3, "verse": 0 })] {
            assert_eq!(call(&app, "POST", "/bookmarks", Some(&anna), body.clone()).await.0, 400, "{body}");
        }
        assert_eq!(call(&app, "POST", "/bookmarks", Some(&anna), json!({ "book": 43, "chapter": 21 })).await.0, 200);
    }

    #[tokio::test]
    async fn every_kind_is_exported_and_goes_with_the_account() {
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        for body in [json!({ "book": 1 }), json!({ "book": 1, "chapter": 1 }), json!({ "book": 1, "chapter": 1, "verse": 1 })] {
            call(&app, "POST", "/bookmarks", Some(&anna), body).await;
        }
        let (_, doc) = call(&app, "GET", "/me/export", Some(&anna), NULL).await;
        assert_eq!(targets(&doc["bookmarks"]), ["1", "1.1", "1.1.1"]);
        assert_eq!(call(&app, "DELETE", "/me", Some(&anna), json!({ "confirm": "delete" })).await.0, 200);
        let left: i64 = pool.get().unwrap().query_row("SELECT count(*) FROM bookmarks WHERE user_id=?1", [id], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }

    #[tokio::test]
    async fn a_profile_is_private_until_its_owner_opens_it_and_never_shows_the_days() {
        let (app, pool) = app();
        let (anna_id, anna) = user(&pool, "anna");
        let (_, ben) = user(&pool, "ben");
        let (cara_id, cara) = user(&pool, "cara");
        let (admin_id, admin) = user(&pool, "admin");
        {
            let c = pool.get().unwrap();
            c.execute("UPDATE users SET is_admin=1 WHERE id=?1", [admin_id]).unwrap();
            c.execute("INSERT INTO activity_days (user_id, date, active_seconds, pages) VALUES (?1, '2026-01-01', 900, 3)", [anna_id]).unwrap();
            c.execute("INSERT INTO groups (name, slug, owner_id, invite_code) VALUES ('Romans', 'romans', ?1, 'code1')", [anna_id]).unwrap();
            c.execute("INSERT INTO group_members (group_id, user_id) SELECT id, ?1 FROM groups UNION ALL SELECT id, ?2 FROM groups", [anna_id, cara_id]).unwrap();
        }
        // private by default: nothing for the signed-out or a stranger
        assert_eq!(call(&app, "GET", "/users/anna", None, NULL).await.0, 404);
        assert_eq!(call(&app, "GET", "/users/anna", Some(&ben), NULL).await.0, 404);
        // a group-mate and the admin see the name and picture only
        for t in [&cara, &admin] {
            let (st, v) = call(&app, "GET", "/users/anna", Some(t), NULL).await;
            assert_eq!((st, v["private"].as_bool(), v["user"]["handle"].as_str(), v.get("stats")), (200, Some(true), Some("anna"), None));
        }
        // the owner sees it all, days included, and that it is private
        let (_, own) = call(&app, "GET", "/users/anna", Some(&anna), NULL).await;
        assert_eq!((own["public"].as_bool(), own["stats"]["streak"]["days"].as_array().map(|d| d.len())), (Some(false), Some(1)));
        // switched on: public to anyone, without the per-day history and without jottings
        call(&app, "PATCH", "/me", Some(&anna), json!({ "settings": { "public_profile": true } })).await;
        for t in [None, Some(ben.as_str())] {
            let (st, v) = call(&app, "GET", "/users/anna", t, NULL).await;
            assert_eq!((st, v.get("private"), v["stats"]["total_pages"].as_i64()), (200, None, Some(3)));
            assert_eq!(v["stats"]["streak"].as_object().unwrap().keys().collect::<Vec<_>>(), ["current", "longest"]);
            assert_eq!((v.get("outlines"), v.get("public")), (None, None));
        }
        assert_eq!(call(&app, "GET", "/users/anna", Some(&anna), NULL).await.1["public"], true);
        // and off again
        call(&app, "PATCH", "/me", Some(&anna), json!({ "settings": { "public_profile": false } })).await;
        assert_eq!(call(&app, "GET", "/users/anna", Some(&ben), NULL).await.0, 404);
    }
}
