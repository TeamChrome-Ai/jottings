//! Ministry on a verse and the ministry library: the written ministry of the enabled authors of the registry
//! (shared/ministry.ts), from data/ministry.db (built by tools/ministry_index.ts; schema in ministry.sql). The library
//! lists authors, collections and works and serves a section's text; the index answers which paragraphs refer to a
//! verse, best first (shared/ministryIndex.ts has the ranking rule; the rank is stored, the order is `rank, para`).
//! The database is opened read-only; without it the library is empty and every verse has nothing, which is how a
//! server without the data behaves.
use crate::cleanse;
use crate::edition::{Edition, Served};
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::{extract::{Path, Query, State}, http::header, response::{IntoResponse, Response}, Json};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, params_from_iter, OpenFlags, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

/// Results per page of one author's list.
pub const PER_PAGE: i64 = 20;
/// How much of a paragraph a result shows (shared/ministryIndex.ts SNIPPET_CHARS).
const SNIPPET_CHARS: usize = 200;
/// A selection longer than this is refused: the sheet asks for what is selected in one chapter.
const MAX_VERSES: usize = 200;

pub(crate) struct Author { pub id: String, ord: i64, name: String, short: String, born: i64, died: i64, source: String }
pub(crate) struct Work { pub title: String, pub kind: String, pub collection: String, pub count: i64, pub contents: Value, pub raw: String,
    /// The contents as the cleanse lists them (cleanse.rs `contents`): the Letters' entries retitled; None where nothing changes.
    cleansed: Option<(Value, String)> }
impl Work {
    pub(crate) fn contents_for(&self, cleanse: bool) -> &Value { if cleanse { self.cleansed.as_ref().map(|c| &c.0).unwrap_or(&self.contents) } else { &self.contents } }
    pub(crate) fn raw_for(&self, cleanse: bool) -> &str { if cleanse { self.cleansed.as_ref().map(|c| c.1.as_str()).unwrap_or(&self.raw) } else { &self.raw } }
}
/// A section's title as the title search reads it: `hay` is the folded words of its title, subtitle and (a letter's)
/// recipient joined by single spaces, with a leading space, so a word start is " word" and a phrase " a b";
/// `hay_cleansed` the same of the cleansed listing (a letter's date alone).
struct Title { author: String, work: String, collection: String, n: i64, hay: String, hay_cleansed: String }

pub struct Ministry {
    pub(crate) pool: r2d2::Pool<SqliteConnectionManager>,
    /// Enabled authors only, in the registry's order: a disabled one is as absent as one never listed.
    authors: Vec<Author>,
    pub(crate) works: HashMap<(String, String), Work>,
    pub(crate) library: String,
    /// The library without the authors the 1890 edition leaves out (edition::hides_author).
    library_1890: String,
    /// The 1890 library without the collections the cleanse hides (cleanse.rs).
    library_cleansed: String,
    /// The Synopsis's sub-heading paragraphs by (work, n), ascending indices, and their `paras.id`s as a JSON array:
    /// what the cleanse takes out of the text and the index.
    heads: HashMap<(String, i64), Vec<i64>>,
    pub(crate) head_ids: String,
    /// Every section of every enabled author in library order (author, collection, work, n): the title search's index.
    titles: Vec<Title>,
    /** The database has `sections.figures` (built after figures were added); an older one is served without them. */
    pub(crate) figures: bool,
    /// The data's version and where its offline packs are kept (ministry_offline.rs), built on first request.
    pub(crate) version: String,
    pub(crate) offline_dir: std::path::PathBuf,
    pub(crate) packs: tokio::sync::Mutex<HashMap<String, Arc<crate::ministry_offline::PackInfo>>>,
}

impl Ministry {
    /// Opens `path` read-only and reads the library's lists into memory; None when there is no such file.
    pub fn open(path: &str) -> anyhow::Result<Option<Arc<Ministry>>> {
        if !std::path::Path::new(path).exists() { return Ok(None) }
        let manager = SqliteConnectionManager::file(path)
            .with_flags(OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
            .with_init(|c| c.execute_batch("PRAGMA query_only = ON; PRAGMA mmap_size = 268435456; PRAGMA cache_size = -16000;"));
        let pool = r2d2::Pool::builder().max_size(4).build(manager)?;
        let conn = pool.get()?;
        let authors: Vec<Author> = conn.prepare("SELECT id, ord, name, short, born, died, source FROM authors WHERE enabled = 1 ORDER BY ord")?
            .query_map([], |r| Ok(Author { id: r.get(0)?, ord: r.get(1)?, name: r.get(2)?, short: r.get(3)?, born: r.get(4)?, died: r.get(5)?, source: r.get(6)? }))?
            .collect::<Result<_, _>>()?;
        let mut works = HashMap::new();
        let mut titles = Vec::new();
        let mut lib = Vec::new();
        for a in &authors {
            let mut cols: Vec<Value> = Vec::new();
            let mut st = conn.prepare("SELECT id, title FROM collections WHERE author = ?1 ORDER BY ord")?;
            let collections: Vec<(String, String)> = st.query_map([&a.id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
            for (cid, ctitle) in collections {
                let mut st = conn.prepare("SELECT id, title, kind, count, contents FROM works WHERE author = ?1 AND collection = ?2 ORDER BY ord")?;
                let rows: Vec<(String, String, String, i64, String)> = st.query_map(params![a.id, cid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?.collect::<Result<_, _>>()?;
                let mut list = Vec::new();
                for (id, title, kind, count, raw) in rows {
                    list.push(json!({ "id": id, "title": title, "kind": kind, "count": count }));
                    let contents: Value = serde_json::from_str(&raw)?;
                    let cleansed = (cid == "letters").then(|| { let c = cleanse::contents(&cid, &contents); let raw = c.to_string(); (c, raw) });
                    for (i, sec) in contents.as_array().into_iter().flatten().enumerate() {
                        let text = ["title", "subtitle", "to"].iter().filter_map(|k| sec[k].as_str()).collect::<Vec<_>>().join(" / ");
                        let h = hay(&text);
                        let hc = cleansed.as_ref().and_then(|c| c.0[i]["title"].as_str()).map(hay).unwrap_or_else(|| h.clone());
                        titles.push(Title { author: a.id.clone(), work: id.clone(), collection: cid.clone(), n: i as i64 + 1, hay: h, hay_cleansed: hc });
                    }
                    works.insert((a.id.clone(), id), Work { title, kind, collection: cid.clone(), count, contents, raw, cleansed });
                }
                cols.push(json!({ "id": cid, "title": ctitle, "works": list }));
            }
            lib.push(json!({ "id": a.id, "name": a.name, "short": a.short, "born": a.born, "died": a.died, "source": a.source, "collections": cols }));
        }
        let figures = conn.prepare("SELECT 1 FROM pragma_table_info('sections') WHERE name = 'figures'")?.exists([])?;
        // the Synopsis's sub-headings (cleanse.rs is_subheading), read once: some 10,000 short paragraphs
        let mut heads: HashMap<(String, i64), Vec<i64>> = HashMap::new();
        let mut head_ids = Vec::new();
        let mut synopsis: Vec<&(String, String)> = works.iter().filter(|(_, w)| w.collection == "synopsis").map(|(k, _)| k).collect();
        synopsis.sort();
        for (author, work) in synopsis {
            let mut st = conn.prepare_cached("SELECT id, n, i, text FROM paras WHERE author = ?1 AND work = ?2 ORDER BY n, i")?;
            for r in st.query_map(params![author, work], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?)))? {
                let (id, n, i, text) = r?;
                if cleanse::is_subheading(&text) { heads.entry((work.clone(), n)).or_default().push(i); head_ids.push(id); }
            }
        }
        drop(conn);
        let shown_1890: Vec<&Value> = lib.iter().filter(|a| !crate::edition::hides_author(Edition::E1890, a["id"].as_str().unwrap_or(""))).collect();
        let library_1890 = json!({ "authors": shown_1890 }).to_string();
        let library_cleansed = json!({ "authors": shown_1890.iter().map(|a| {
            let mut a = (*a).clone();
            if let Some(cols) = a["collections"].as_array_mut() { cols.retain(|c| !cleanse::collection_hidden(c["id"].as_str().unwrap_or(""))) }
            a
        }).collect::<Vec<_>>() }).to_string();
        let library = json!({ "authors": lib }).to_string();
        let version = crate::ministry_offline::version_of(path);
        let offline_dir = crate::ministry_offline::cache_dir(path, &version);
        Ok(Some(Arc::new(Ministry { pool, authors, works, library, library_1890, library_cleansed, heads, head_ids: json!(head_ids).to_string(), titles, figures, version, offline_dir, packs: Default::default() })))
    }
    /// The library as served: every enabled author; without Coates in 1890; without the hidden collections under the cleanse.
    pub(crate) fn library_for(&self, s: Served) -> &str { if s.cleanse { &self.library_cleansed } else if s.edition == Edition::E1890 { &self.library_1890 } else { &self.library } }
    /// The Synopsis's sub-heading indices of a section, when it has any.
    pub(crate) fn heads_of(&self, work: &str, n: i64) -> Option<&Vec<i64>> { self.heads.get(&(work.to_string(), n)) }
    /// A work the state leaves out: one of a hidden collection under the cleanse, as absent as a work never loaded.
    pub(crate) fn work_hidden(&self, w: &Work, s: Served) -> bool { s.cleanse && cleanse::collection_hidden(&w.collection) }
    /// The enabled authors the edition shows, in the registry's order.
    fn shown(&self, ed: Edition) -> impl Iterator<Item = &Author> { self.authors.iter().filter(move |a| !crate::edition::hides_author(ed, &a.id)) }
    pub(crate) fn author_ids(&self, ed: Edition) -> Vec<String> { self.shown(ed).map(|a| a.id.clone()).collect() }

    pub(crate) fn author(&self, id: &str) -> ApiResult<&Author> { self.authors.iter().find(|a| a.id == id).ok_or_else(|| ApiError::not_found("no such author")) }
    /// `author`, unless the edition leaves them out: then 404 like an author never enabled.
    pub(crate) fn author_in(&self, id: &str, ed: Edition) -> ApiResult<&Author> { self.shown(ed).find(|a| a.id == id).ok_or_else(|| ApiError::not_found("no such author")) }
    pub(crate) fn work(&self, author: &str, work: &str, s: Served) -> ApiResult<&Work> {
        self.author_in(author, s.edition)?;
        let w = self.works.get(&(author.to_string(), work.to_string())).ok_or_else(|| ApiError::not_found("no such work"))?;
        if self.work_hidden(w, s) { return Err(ApiError::not_found("no such work")) }
        Ok(w)
    }
    fn enabled_ords(&self, ed: Edition) -> String { self.shown(ed).map(|a| a.ord.to_string()).collect::<Vec<_>>().join(",") }
    /// The ids of the works in `collections`, quoted for SQL (`'a','b'`; `''` when there are none).
    fn works_in(&self, collections: &[&str]) -> String {
        let mut ids: Vec<String> = self.works.iter().filter(|(_, w)| collections.contains(&w.collection.as_str())).map(|((_, id), _)| format!("'{}'", id.replace('\'', "''"))).collect();
        ids.sort();
        if ids.is_empty() { "''".into() } else { ids.join(",") }
    }
    async fn db<T: Send + 'static>(self: &Arc<Self>, f: impl FnOnce(&rusqlite::Connection) -> ApiResult<T> + Send + 'static) -> ApiResult<T> {
        let pool = self.pool.clone();
        tokio::task::spawn_blocking(move || { let c = pool.get()?; f(&c) }).await.map_err(|_| ApiError::internal("server error"))?
    }
}

fn day(mut r: Response) -> Response { r.headers_mut().insert(header::CACHE_CONTROL, "public, max-age=86400".parse().unwrap()); r }
fn get(s: &AppState) -> Option<&Arc<Ministry>> { s.ministry.as_ref() }
fn need(s: &AppState) -> ApiResult<&Arc<Ministry>> { get(s).ok_or_else(|| ApiError::not_found("no such author")) }

/// A paragraph as the index read it (shared/ministryIndex.ts plainOf): a block quotation's lines without their "> ",
/// lines joined by a space, tags dropped, the five entities decoded.
pub(crate) fn plain(text: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let quote = lines.iter().all(|l| l.starts_with("> ") || *l == ">");
    let joined = lines.iter().map(|l| if quote { l.strip_prefix("> ").or_else(|| l.strip_prefix('>')).unwrap_or(l) } else { l }).collect::<Vec<_>>().join(" ");
    decode(&strip_tags(&joined))
}
fn note_plain(note: &str) -> String {
    static NL: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| regex::Regex::new(r"\n+").unwrap());
    decode(&strip_tags(&NL.split(note).collect::<Vec<_>>().join(" ")))
}
fn strip_tags(s: &str) -> String {
    static TAG: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| regex::Regex::new(r"<[^>]*>").unwrap());
    TAG.replace_all(s, "").into_owned()
}
fn decode(s: &str) -> String {
    static ENT: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| regex::Regex::new(r"&(?:amp|lt|gt|quot|#39);").unwrap());
    ENT.replace_all(s, |c: &regex::Captures| match &c[0] { "&amp;" => "&", "&lt;" => "<", "&gt;" => ">", "&quot;" => "\"", _ => "'" }).into_owned()
}

/// About SNIPPET_CHARS of `plain` around [start, end) (UTF-16 units), cut between words, "…" where text is left out,
/// and the reference's place in it: shared/ministryIndex.ts snippetOf, unit for unit.
pub fn snippet(plain: &str, start: usize, end: usize, size: usize) -> (String, [usize; 2]) {
    let u: Vec<u16> = plain.encode_utf16().collect();
    let len = u.len();
    let (start, end) = (start.min(len), end.min(len).max(start.min(len)));
    let sp = b' ' as u16;
    let before = ((size as f64 - (end - start) as f64) * 0.4).floor().max(0.0) as usize;
    let mut a = start.saturating_sub(before);
    let mut b = len.min(end.max(a + size));
    if b - a < size { a = b.saturating_sub(size) }
    if a > 0 && u[a - 1] != sp {
        a = match u[a..].iter().position(|&c| c == sp).map(|i| i + a) { Some(i) if i < start => i + 1, _ => a.min(start) };
    }
    if b < len && u[b] != sp {
        b = match u[..=b].iter().rposition(|&c| c == sp) { Some(i) if i >= end => i, _ => b.max(end) };
    }
    let head = if a > 0 { "…" } else { "" };
    let tail = if b < len { "…" } else { "" };
    let slice = String::from_utf16_lossy(&u[a..b]);
    let lead = slice.encode_utf16().count() - slice.trim_start().encode_utf16().count();
    let h = head.encode_utf16().count();
    (format!("{head}{}{tail}", slice.trim()), [h + start - a - lead, h + end - a - lead])
}

/// "16", "16-18", "1,3,7-9" → the verses, sorted and unique; None when it does not read.
fn selection(sel: &str) -> Option<Vec<i64>> {
    let mut out = Vec::new();
    for part in sel.split(',') {
        let (a, b) = match part.split_once('-') { Some((a, b)) => (a.trim().parse::<i64>().ok()?, b.trim().parse::<i64>().ok()?), None => { let v = part.trim().parse::<i64>().ok()?; (v, v) } };
        if a < 1 || b < a || b - a > MAX_VERSES as i64 { return None }
        out.extend(a..=b);
        if out.len() > MAX_VERSES { return None }
    }
    out.sort_unstable();
    out.dedup();
    Some(out)
}

const MENTIONS: [&str; 4] = ["quote", "verse", "range", "list"];

/// `GET /ministry`: the library, `{ authors: [{ id, name, short, born, died, source, collections: [{ id, title, works:
/// [{ id, title, kind, count }] }] }] }`, enabled authors only.
pub async fn library(State(s): State<AppState>) -> Response {
    let served = s.served().await;
    let body = get(&s).map(|m| m.library_for(served).to_string()).unwrap_or_else(|| r#"{"authors":[]}"#.into());
    day(([(header::CONTENT_TYPE, "application/json")], body).into_response())
}

/// `GET /ministry/:author/:work`: `{ author, work: { id, title, kind, collection }, sections: [{ title, subtitle?, part?,
/// passages, date?, to? }] }`.
pub async fn work(State(s): State<AppState>, Path((author, work)): Path<(String, String)>) -> ApiResult<Response> {
    let served = s.served().await;
    let w = need(&s)?.work(&author, &work, served)?;
    let body = format!(r#"{{"author":{},"work":{},"sections":{}}}"#, json!(author), json!({ "id": work, "title": w.title, "kind": w.kind, "collection": w.collection }), w.raw_for(served.cleanse));
    Ok(day(([(header::CONTENT_TYPE, "application/json")], body).into_response()))
}

/// `GET /ministry/:author/:work/:n`: one section with its text, the companion's shape: `{ author, work, n, count,
/// section: { title, …, text, notes?, figures? } }`.
pub async fn section(State(s): State<AppState>, Path((author, work, n)): Path<(String, String, i64)>) -> ApiResult<Response> {
    let served = s.served().await;
    let m = need(&s)?.clone();
    let w = m.work(&author, &work, served)?;
    if n < 1 || n > w.count { return Err(ApiError::not_found("no such section")) }
    let meta = w.contents_for(served.cleanse)[(n - 1) as usize].clone();
    let head = json!({ "id": work, "title": w.title, "kind": w.kind, "collection": w.collection });
    let (count, collection) = (w.count, w.collection.clone());
    let (a, wk) = (author.clone(), work.clone());
    let figures_sql = if m.figures { "SELECT notes, figures FROM sections WHERE author = ?1 AND work = ?2 AND n = ?3" } else { "SELECT notes, NULL FROM sections WHERE author = ?1 AND work = ?2 AND n = ?3" };
    let (text, notes, figures) = m.db(move |c| {
        let mut st = c.prepare_cached("SELECT text FROM paras WHERE author = ?1 AND work = ?2 AND n = ?3 ORDER BY i")?;
        let paras: Vec<String> = st.query_map(params![a, wk, n], |r| r.get(0))?.collect::<Result<_, _>>()?;
        let (notes, figures): (Option<String>, Option<String>) = c.query_row(figures_sql, params![a, wk, n], |r| Ok((r.get(0)?, r.get(1)?))).optional()?.unwrap_or((None, None));
        Ok((paras.join("\n\n"), notes, figures))
    }).await?;
    let mut section = meta;
    section["text"] = json!(if served.cleanse { cleanse::text(&collection, &text) } else { text });
    if let Some(ns) = notes.filter(|_| !(served.cleanse && cleanse::notes_hidden(&collection))) { section["notes"] = serde_json::from_str(&ns).map_err(|_| ApiError::internal("bad notes"))? }
    if let Some(fs) = figures { section["figures"] = serde_json::from_str(&fs).map_err(|_| ApiError::internal("bad figures"))? }
    Ok(day(Json(json!({ "author": author, "work": head, "n": n, "count": count, "section": section })).into_response()))
}

/// Verses in a chapter as the index has them; None for a chapter the Bible does not have.
fn verses_in(c: &rusqlite::Connection, book: i64, chapter: i64) -> ApiResult<Option<i64>> {
    Ok(c.query_row("SELECT verses FROM chapters WHERE book = ?1 AND chapter = ?2", params![book, chapter], |r| r.get(0)).optional()?)
}
fn valid_chapter(book: i64, chapter: i64) -> ApiResult<()> {
    let b = crate::books::book(book).ok_or_else(|| ApiError::not_found("no such book"))?;
    if chapter < 1 || chapter > b.chapters as i64 { return Err(ApiError::not_found("no such chapter")) }
    Ok(())
}

// ---------- the title search ----------

/// Case and accents folded as shared/search.ts `fold` folds them (æ and œ stay ligatures), apostrophes dropped as
/// shared/companion.ts searchCompanion drops them ("Lord's" = "lords").
pub fn fold(s: &str) -> String {
    s.chars().filter(|c| !matches!(c, '\'' | '’')).flat_map(char::to_lowercase).map(|c| match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a', 'ç' => 'c', 'è' | 'é' | 'ê' | 'ë' => 'e', 'ì' | 'í' | 'î' | 'ï' => 'i', 'ñ' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' => 'o', 'ù' | 'ú' | 'û' | 'ü' => 'u', 'ý' | 'ÿ' => 'y', c => c,
    }).collect()
}
/// The folded words of `s` (runs of letters and digits), in order.
pub fn words(s: &str) -> Vec<String> { fold(s).split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect() }
/// The index's form of a title: " word word …" (see `Title::hay`).
fn hay(s: &str) -> String { let w = words(s); if w.is_empty() { String::new() } else { format!(" {}", w.join(" ")) } }

/// How a title answers the query's words, or None: 0 the words in order as a phrase, 1 the title begins with the first
/// word and has them all, 2 it has them all. A word matches a word of the title it begins ("cares" ← "care"); a number
/// only the same number ("5" is not "51").
pub fn title_rank(hay: &str, words: &[String]) -> Option<u8> {
    if words.is_empty() || hay.is_empty() { return None }
    let has = |w: &str| if w.chars().all(|c| c.is_ascii_digit()) { hay.contains(&format!(" {w} ")) || hay.ends_with(&format!(" {w}")) } else { hay.contains(&format!(" {w}")) };
    if !words.iter().all(|w| has(w)) { return None }
    let phrase = format!(" {}", words.join(" "));
    let numeric_end = words.last().is_some_and(|w| w.chars().all(|c| c.is_ascii_digit()));
    if hay.match_indices(&phrase).any(|(i, _)| !numeric_end || matches!(hay[i + phrase.len()..].chars().next(), None | Some(' '))) { return Some(0) }
    Some(if hay.starts_with(&format!(" {}", words[0])) { 1 } else { 2 })
}

#[derive(Deserialize)] pub struct SearchQ { q: Option<String>, limit: Option<i64> }

/// `GET /ministry/search?q=&limit=`: sections whose title (subtitle, or a letter's recipient) has every word of `q`,
/// `{ hits: [{ author, work: { id, title, kind, collection }, n, title, subtitle?, part?, passages, date?, to? }] }`
/// (the section as its work's contents list it, placed), a phrase match first, then a title that begins with the
/// words, then the rest, each in library order; `limit` up to 100, 30 by default. A title index, not the text.
pub async fn search(State(s): State<AppState>, Query(q): Query<SearchQ>) -> Response {
    let limit = q.limit.unwrap_or(30).clamp(1, 100) as usize;
    let words = words(q.q.as_deref().unwrap_or(""));
    let served = s.served().await;
    let hits: Vec<Value> = match get(&s) {
        Some(m) if !words.is_empty() => {
            let shown = |t: &&Title| !crate::edition::hides_author(served.edition, &t.author) && !(served.cleanse && cleanse::collection_hidden(&t.collection));
            let mut found: Vec<(u8, &Title)> = m.titles.iter().filter(shown).filter_map(|t| title_rank(if served.cleanse { &t.hay_cleansed } else { &t.hay }, &words).map(|r| (r, t))).collect();
            found.sort_by_key(|(r, _)| *r);
            found.iter().take(limit).filter_map(|(_, t)| {
                let w = m.works.get(&(t.author.clone(), t.work.clone()))?;
                let mut hit = w.contents_for(served.cleanse).get((t.n - 1) as usize)?.clone();
                hit["author"] = json!(t.author);
                hit["work"] = json!({ "id": t.work, "title": w.title, "kind": w.kind, "collection": w.collection });
                hit["n"] = json!(t.n);
                Some(hit)
            }).collect()
        }
        _ => Vec::new(),
    };
    day(Json(json!({ "hits": hits })).into_response())
}

/// `GET /ministry/chapter/:book/:chapter`: `{ book, chapter, verses: [16, 17, …] }`, the verses of the chapter some
/// enabled author refers to (the selection bar's quiet check).
pub async fn chapter(State(s): State<AppState>, Path((book, chapter)): Path<(i64, i64)>) -> ApiResult<Response> {
    valid_chapter(book, chapter)?;
    let served = s.served().await;
    let verses: Vec<i64> = match get(&s) {
        None => Vec::new(),
        Some(m) => {
            let ords = m.enabled_ords(served.edition);
            let m = m.clone();
            m.clone().db(move |c| {
                if ords.is_empty() { return Ok(Vec::new()) }
                let lo = book * 1_000_000 + chapter * 1000;
                let vs = if served.cleanse {
                    // only what the cleanse serves counts: no hidden work, no note of a noteless work, no sub-heading
                    let (hidden, noteless) = (m.works_in(&cleanse::HIDDEN_COLLECTIONS), m.works_in(&cleanse::NOTELESS_COLLECTIONS));
                    let sql = format!("SELECT DISTINCT r.verse FROM refs r LEFT JOIN paras p ON r.note >= 0 AND p.id = r.para LEFT JOIN figrows f ON r.note < 0 AND f.id = r.para \
                        WHERE r.verse > ?1 AND r.verse < ?2 AND r.a IN ({ords}) AND coalesce(p.work, f.work) NOT IN ({hidden}) AND (r.note <= 0 OR p.work NOT IN ({noteless})) \
                        AND r.para NOT IN (SELECT value FROM json_each(?3)) ORDER BY r.verse");
                    let mut st = c.prepare_cached(&sql)?;
                    let vs: Vec<i64> = st.query_map(params![lo, lo + 1000, m.head_ids], |r| r.get::<_, i64>(0))?.map(|v| v.map(|v| v - lo)).collect::<Result<_, _>>()?;
                    vs
                } else {
                    let mut st = c.prepare_cached(&format!("SELECT DISTINCT verse FROM refs WHERE verse > ?1 AND verse < ?2 AND a IN ({ords}) ORDER BY verse"))?;
                    let vs: Vec<i64> = st.query_map(params![lo, lo + 1000], |r| r.get::<_, i64>(0))?.map(|v| v.map(|v| v - lo)).collect::<Result<_, _>>()?;
                    vs
                };
                Ok(vs)
            }).await?
        }
    };
    Ok(day(Json(json!({ "book": book, "chapter": chapter, "verses": verses })).into_response()))
}

#[derive(Deserialize)] pub struct RefsQ { author: Option<String>, page: Option<i64> }

/// One author's page of results for the verses: `{ author, name, short, source, total, page, pages, items }`.
fn group(c: &rusqlite::Connection, m: &Ministry, a: &Author, ids: &[i64], page: i64, cleanse: bool) -> ApiResult<Value> {
    let marks = vec!["?"; ids.len()].join(",");
    let args = |extra: &[i64]| ids.iter().copied().chain(std::iter::once(a.ord)).chain(extra.iter().copied()).collect::<Vec<i64>>();
    // a paragraph named for several selected verses is listed once, at its best; SQLite's bare columns come from the
    // row that holds the MIN. Under the cleanse every row is read, what it leaves out dropped here and the page cut after
    let sql = format!("SELECT para, note, MIN(rank), start, end FROM refs WHERE verse IN ({marks}) AND a = ? GROUP BY para, note ORDER BY 3, para, note");
    let row = |r: &rusqlite::Row| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?));
    let (total, page, pages, rows): (i64, i64, i64, Vec<(i64, i64, i64, i64, i64)>) = if cleanse {
        (0, page, 0, c.prepare_cached(&sql)?.query_map(params_from_iter(args(&[])), row)?.collect::<Result<_, _>>()?)
    } else {
        let total: i64 = c.query_row(&format!("SELECT count(*) FROM (SELECT 1 FROM refs WHERE verse IN ({marks}) AND a = ? GROUP BY para, note)"), params_from_iter(args(&[])), |r| r.get(0))?;
        let pages = ((total + PER_PAGE - 1) / PER_PAGE).max(1);
        let page = page.clamp(1, pages);
        (total, page, pages, c.prepare_cached(&format!("{sql} LIMIT ? OFFSET ?"))?.query_map(params_from_iter(args(&[PER_PAGE, (page - 1) * PER_PAGE])), row)?.collect::<Result<_, _>>()?)
    };
    let mut items = Vec::new();
    for (para, note, rank, start, end) in rows {
        // note -1: a figure row (figrows), addressed by its slot after the section's paragraphs; its text is already plain
        let from = if note < 0 { "SELECT work, n, slot, text FROM figrows WHERE id = ?1" } else { "SELECT work, n, i, text FROM paras WHERE id = ?1" };
        let (work, n, mut i, text): (String, i64, i64, String) = c.prepare_cached(from)?.query_row([para], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        let Some(w) = m.works.get(&(a.id.clone(), work.clone())) else { continue };
        if cleanse && (cleanse::collection_hidden(&w.collection) || (note > 0 && cleanse::notes_hidden(&w.collection))) { continue }
        let mut source = if note > 0 {
            let notes: Option<String> = c.prepare_cached("SELECT notes FROM sections WHERE author = ?1 AND work = ?2 AND n = ?3")?.query_row(params![a.id, work, n], |r| r.get(0))?;
            let notes: Vec<String> = notes.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
            note_plain(notes.get((note - 1) as usize).map(String::as_str).unwrap_or(""))
        } else if note < 0 { text.clone() } else { plain(&text) };
        let (mut start, mut end) = (start as usize, end as usize);
        if cleanse && note == 0 {
            // the Synopsis's sub-headings are gone: a paragraph moves up by the headings before it, a heading itself is nothing
            if let Some(heads) = m.heads_of(&work, n) { match cleanse::remap_para(i, heads) { Some(j) => i = j, None => continue } }
            if cleanse::notes_hidden(&w.collection) { (source, start, end) = cleanse::strip_callers_at(&source, start, end) }
        }
        let (snippet, hl) = snippet(&source, start, end, SNIPPET_CHARS);
        let title = w.contents_for(cleanse).get((n - 1) as usize).and_then(|s| s["title"].as_str()).unwrap_or("");
        let mut item = json!({ "work": { "id": work, "title": w.title, "collection": w.collection }, "n": n, "section": title, "para": i,
            "mention": MENTIONS[(rank / 10_000_000).clamp(0, 3) as usize], "snippet": snippet, "hl": hl });
        if note > 0 { item["note"] = json!(note) }
        if note < 0 { item["row"] = json!(true) }
        items.push(item);
    }
    let (total, page, pages, items) = if cleanse {
        let total = items.len() as i64;
        let pages = ((total + PER_PAGE - 1) / PER_PAGE).max(1);
        let page = page.clamp(1, pages);
        (total, page, pages, items.into_iter().skip(((page - 1) * PER_PAGE) as usize).take(PER_PAGE as usize).collect())
    } else { (total, page, pages, items) };
    Ok(json!({ "author": a.id, "name": a.name, "short": a.short, "source": a.source, "total": total, "page": page, "pages": pages, "items": items }))
}

/// `GET /ministry/refs/:book/:chapter/:verses?author=&page=`: the paragraphs referring to the verses ("16", "16-18",
/// "1,3,7-9"), per author, best first: `{ book, chapter, verses, groups: [{ author, name, short, source, total, page,
/// pages, items: [{ work: { id, title, collection }, n, section, para, note?, row?, mention, snippet, hl }] }] }`; `row`: the
/// item is a row of one of the section's figures, `para` its slot after the paragraphs. Without
/// `author`, the first page of every enabled author that has something; with it, that author's `page`. 404 for a verse
/// or chapter the Bible does not have and for an author not enabled; 400 for a selection that does not read.
pub async fn refs(State(s): State<AppState>, Path((book, chapter, sel)): Path<(i64, i64, String)>, Query(q): Query<RefsQ>) -> ApiResult<Response> {
    valid_chapter(book, chapter)?;
    let verses = selection(&sel).ok_or_else(|| ApiError::bad("verses: a verse, a range or a list, as 16, 16-18 or 1,3,7-9"))?;
    let Some(m) = get(&s).cloned() else {
        if q.author.is_some() { return Err(ApiError::not_found("no such author")) }
        return Ok(day(Json(json!({ "book": book, "chapter": chapter, "verses": verses, "groups": [] })).into_response()));
    };
    let served = s.served().await;
    if let Some(a) = &q.author { m.author_in(a, served.edition)?; }
    let page = q.page.unwrap_or(1);
    let body = m.clone().db(move |c| {
        let count = verses_in(c, book, chapter)?.ok_or_else(|| ApiError::not_found("no such chapter"))?;
        if verses.iter().any(|&v| v > count) { return Err(ApiError::not_found("no such verse")) }
        let ids: Vec<i64> = verses.iter().map(|v| book * 1_000_000 + chapter * 1000 + v).collect();
        let mut groups = Vec::new();
        for a in m.shown(served.edition).filter(|a| q.author.as_deref().is_none_or(|x| x == a.id)) {
            let g = group(c, &m, a, &ids, if q.author.is_some() { page } else { 1 }, served.cleanse)?;
            if q.author.is_some() || g["total"].as_i64() > Some(0) { groups.push(g) }
        }
        Ok(json!({ "book": book, "chapter": chapter, "verses": verses, "groups": groups }))
    }).await?;
    Ok(day(Json(body).into_response()))
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::testkit::{app_with_ministry, call};

    /// A small ministry.db: Darby and Coates enabled, Kelly disabled with rows of his own on the same verses.
    pub fn fixture() -> String {
        let path = std::env::temp_dir().join(format!("berean-ministry-{}.db", crate::auth::random_token(8)));
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch(include_str!("ministry.sql")).unwrap();
        c.execute_batch(r#"
            INSERT INTO authors VALUES ('darby', 0, 'J. N. Darby', 'Darby', 1800, 1882, 1, 'pd', 'Darby source'),
              ('coates', 1, 'C. A. Coates', 'Coates', 1862, 1945, 1, 'pd', 'Coates source'), ('kelly', 2, 'W. Kelly', 'Kelly', 1821, 1906, 0, 'pd', '');
            INSERT INTO collections VALUES ('darby', 'cw', 0, 'Collected Writings'), ('coates', 'outlines', 0, 'Outlines'), ('kelly', 'lectures', 0, 'Lectures');
            INSERT INTO chapters VALUES (43, 3, 36), (45, 8, 39);
            INSERT INTO works VALUES ('darby', 'cw-doctrinal-1', 'cw', 0, 'Collected Writings 3: Doctrinal 1', 'papers', 2, '[{"title":"On John 3","passages":[[43,3,1,3,0]]},{"title":"Letter","passages":[],"to":"G. V. Wigram"}]'),
              ('coates', 'romans', 'outlines', 0, 'An Outline of Romans', 'outline', 1, '[{"title":"Chapter 8","passages":[[45,8,1,8,0]]}]'),
              ('kelly', 'john', 'lectures', 0, 'Lectures on John', 'outline', 1, '[{"title":"John 3","passages":[]}]');
            INSERT INTO sections VALUES ('darby', 'cw-doctrinal-1', 1, '{"title":"On John 3","passages":[[43,3,1,3,0]]}', '["See John 3:16 again."]', '[{"kind":"table","source":"p. 1","columns":["Verse"],"rows":[["John 3:16"]]}]'),
              ('darby', 'cw-doctrinal-1', 2, '{"title":"Letter","passages":[],"to":"G. V. Wigram"}', NULL, NULL),
              ('coates', 'romans', 1, '{"title":"Chapter 8","passages":[[45,8,1,8,0]]}', NULL, NULL), ('kelly', 'john', 1, '{"title":"John 3","passages":[]}', NULL, NULL);
            INSERT INTO figrows VALUES (6, 'darby', 'cw-doctrinal-1', 1, 2, 'Whosoever · John 3:16');
            INSERT INTO paras VALUES (1, 'darby', 'cw-doctrinal-1', 1, 0, 'God so loved the world (John 3:16).'),
              (2, 'darby', 'cw-doctrinal-1', 1, 1, 'Compare <i>verses</i> 14–18 of the chapter.[1]'),
              (3, 'darby', 'cw-doctrinal-1', 2, 0, '> A line of a hymn' || char(10) || '> and its second, John 3:16'),
              (4, 'coates', 'romans', 1, 0, 'All things work together for good (Romans 8:28).'),
              (5, 'kelly', 'john', 1, 0, 'Kelly on John 3:16.');
            -- ranks per shared/ministryIndex.ts rankOf: quote 0, verse 1e7, range 2e7, list 3e7
            INSERT INTO refs VALUES (43003016, 0, 1001000, 1, 0, 0, 34), (43003016, 0, 21001000, 2, 0, 8, 25), (43003017, 0, 21001000, 2, 0, 8, 25),
              (43003016, 0, 11001000, 3, 0, 36, 43), (43003016, 0, 11001000, 2, 1, 4, 13), (45008028, 1, 11001000, 4, 0, 34, 46),
              (43003016, 2, 0, 5, 0, 9, 18), (43003017, 2, 0, 5, 0, 9, 18), (43003016, 0, 32001000, 6, -1, 12, 21);
        "#).unwrap();
        path.to_str().unwrap().to_string()
    }

    /// `fixture()` with what the cleanse acts on: a Synopsis work with two sub-headings (one carrying the only reference
    /// to Genesis 1:2), two letters (one with a recipient, topics and a date, one bare) and one of the other writings.
    pub fn cleanse_fixture() -> String {
        let path = fixture();
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch(r#"
            INSERT INTO collections VALUES ('darby', 'synopsis', 5, 'Synopsis'), ('darby', 'letters', 6, 'Letters'), ('darby', 'other', 7, 'Other writings');
            INSERT INTO chapters VALUES (1, 1, 31);
            INSERT INTO works VALUES ('darby', 'genesis', 'synopsis', 5000, 'Genesis', 'outline', 1, '[{"title":"Genesis 1","passages":[[1,1,1,1,31]]}]'),
              ('darby', 'letters-1', 'letters', 6000, 'Letters 1', 'letters', 2, '[{"title":"To G. V. Wigram · Pau, 1876","subtitle":"Topics; More topics","passages":[],"date":"Pau, 1876","to":"G. V. Wigram"},{"title":"Letter 2","passages":[]}]'),
              ('darby', 'other-x', 'other', 7000, 'Eternal life', 'papers', 1, '[{"title":"Eternal life","subtitle":"Christian Friend 1893","passages":[]}]');
            INSERT INTO sections VALUES ('darby', 'genesis', 1, '{"title":"Genesis 1","passages":[[1,1,1,1,31]]}', NULL, NULL),
              ('darby', 'letters-1', 1, '{"title":"To G. V. Wigram · Pau, 1876","subtitle":"Topics; More topics","passages":[],"date":"Pau, 1876","to":"G. V. Wigram"}', NULL, NULL),
              ('darby', 'letters-1', 2, '{"title":"Letter 2","passages":[]}', NULL, NULL),
              ('darby', 'other-x', 1, '{"title":"Eternal life","subtitle":"Christian Friend 1893","passages":[]}', NULL, NULL);
            INSERT INTO paras VALUES (200, 'darby', 'genesis', 1, 0, '<i>Creation</i>'), (201, 'darby', 'genesis', 1, 1, 'In the beginning (Genesis 1:1).'),
              (202, 'darby', 'genesis', 1, 2, '<i>Heading on Genesis 1:2</i>'), (203, 'darby', 'genesis', 1, 3, 'And God said (Genesis 1:3).'),
              (210, 'darby', 'letters-1', 1, 0, 'Read John 3:16.'), (211, 'darby', 'letters-1', 2, 0, 'Dear brother, [1833]'),
              (220, 'darby', 'other-x', 1, 0, '{Christian Friend vol. 12.} John 3:16 here too.');
            INSERT INTO refs VALUES (1001001, 0, 11001000, 201, 0, 18, 29), (1001002, 0, 11001000, 202, 0, 11, 22), (1001003, 0, 11001000, 203, 0, 14, 25),
              (43003016, 0, 11001000, 210, 0, 5, 14), (43003016, 0, 11001000, 220, 0, 28, 37);
        "#).unwrap();
        path
    }

    #[test]
    fn snippets_cut_between_words() {
        let text = "In the beginning God created the heavens and the earth. ".repeat(10) + "So John 3:16 says it. " + &"And the earth was waste and empty. ".repeat(10);
        let start = text.find("John 3:16").unwrap();
        let (s, hl) = snippet(&text, start, start + 9, 200);
        let u: Vec<u16> = s.encode_utf16().collect();
        assert_eq!(String::from_utf16_lossy(&u[hl[0]..hl[1]]), "John 3:16");
        assert!(s.starts_with('…') && s.ends_with('…'), "{s}");
        assert!(!s.contains("…ginning") && !s[3..].starts_with(' '), "{s}");
        assert!(u.len() <= 202, "{} {s}", u.len());
        // short: the whole paragraph, no ellipses
        assert_eq!(snippet("See John 3:16.", 4, 13, 200), ("See John 3:16.".into(), [4, 13]));
        // UTF-16 units: a character outside the BMP before the reference counts two
        let (s, hl) = snippet("𝔊 John 3:16", 3, 12, 200);
        assert_eq!(String::from_utf16_lossy(&s.encode_utf16().collect::<Vec<_>>()[hl[0]..hl[1]]), "John 3:16");
        // the same snippet as shared/ministryIndex.ts snippetOf (tests/ministry.test.ts pins these numbers)
        let t = "a ".repeat(150) + "Romans 8:28" + &" b".repeat(150);
        let (s, hl) = snippet(&t, 300, 311, 200);
        assert_eq!((s.encode_utf16().count(), hl), (201, [75, 86]));
    }

    #[test]
    fn title_ranks() {
        assert_eq!(fold("Christ’s Ïtalia"), "christs italia");
        assert_eq!(words("Romans 5:1–11, the Lord's"), ["romans", "5", "1", "11", "the", "lords"]);
        let h = hay("Christ for my sins and Christ for my cares");
        assert_eq!(h, " christ for my sins and christ for my cares");
        assert_eq!(title_rank(&h, &words("christ for my")), Some(0));
        assert_eq!(title_rank(&h, &words("CHRIST cares")), Some(1));
        assert_eq!(title_rank(&h, &words("sins care")), Some(2));
        assert_eq!(title_rank(&h, &words("sin christ")), Some(2));
        assert_eq!(title_rank(&h, &words("hrist")), None);
        assert_eq!(title_rank(&h, &words("christ for me")), None);
        assert_eq!(title_rank(&h, &words("")), None);
        // numbers match whole: "Romans 5" is not in "Romans 51"
        assert_eq!(title_rank(&hay("Romans 51"), &words("romans 5")), None);
        assert_eq!(title_rank(&hay("Romans 5:1–11"), &words("romans 5")), Some(0));
        assert_eq!(title_rank(&hay("Notes on Romans 5"), &words("romans 5")), Some(0));
        assert_eq!(title_rank(&hay("Romans, chapter 5"), &words("romans 5")), Some(1));
        assert_eq!(title_rank(&hay("Notes on Romans 51 and 5"), &words("romans 5")), Some(2));
    }

    #[test]
    fn plain_text_as_indexed() {
        assert_eq!(plain("> A line\n> and <i>two</i> &amp; three"), "A line and two & three");
        assert_eq!(plain("Not a quote\n> half"), "Not a quote > half");
        assert_eq!(note_plain("One\n\nTwo &lt;x&gt;"), "One Two <x>");
    }

    #[test]
    fn selections() {
        assert_eq!(selection("16"), Some(vec![16]));
        assert_eq!(selection("18-16"), None);
        assert_eq!(selection("1,3,7-9,3"), Some(vec![1, 3, 7, 8, 9]));
        assert_eq!(selection("x"), None);
        assert_eq!(selection("0"), None);
        assert_eq!(selection("1-500"), None);
    }

    #[tokio::test]
    async fn library_and_index() {
        let (app, _) = app_with_ministry(&fixture());
        // the library: enabled authors only, Kelly nowhere
        let (st, lib) = call(&app, "GET", "/ministry", None, Value::Null).await;
        assert_eq!(st, 200);
        let ids: Vec<&str> = lib["authors"].as_array().unwrap().iter().map(|a| a["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["darby", "coates"]);
        assert_eq!(lib["authors"][0]["collections"][0]["works"][0], json!({ "id": "cw-doctrinal-1", "title": "Collected Writings 3: Doctrinal 1", "kind": "papers", "count": 2 }));
        let (st, w) = call(&app, "GET", "/ministry/darby/cw-doctrinal-1", None, Value::Null).await;
        assert_eq!(st, 200);
        assert_eq!(w["sections"][1]["to"], "G. V. Wigram");
        // the title search: title, recipient; every word; enabled authors only; the hit is the section placed
        let (st, r) = call(&app, "GET", "/ministry/search?q=john%203", None, Value::Null).await;
        assert_eq!(st, 200);
        let got: Vec<(&str, &str, i64)> = r["hits"].as_array().unwrap().iter().map(|h| (h["author"].as_str().unwrap(), h["work"]["id"].as_str().unwrap(), h["n"].as_i64().unwrap())).collect();
        assert_eq!(got, [("darby", "cw-doctrinal-1", 1)], "Kelly's John 3 never: {r}");
        assert_eq!(r["hits"][0]["work"], json!({ "id": "cw-doctrinal-1", "title": "Collected Writings 3: Doctrinal 1", "kind": "papers", "collection": "cw" }));
        assert_eq!((r["hits"][0]["title"].as_str(), r["hits"][0]["passages"].as_array().map(Vec::len)), (Some("On John 3"), Some(1)));
        let (_, r) = call(&app, "GET", "/ministry/search?q=wigram", None, Value::Null).await;
        assert_eq!(r["hits"][0]["to"], "G. V. Wigram");
        let (_, r) = call(&app, "GET", "/ministry/search?q=chapter%208%20romans", None, Value::Null).await;
        assert_eq!(r["hits"], json!([]), "every word must be in the title");
        let (_, r) = call(&app, "GET", "/ministry/search?q=chapter%208&limit=1", None, Value::Null).await;
        assert_eq!(r["hits"][0]["author"], "coates");
        for uri in ["/ministry/search", "/ministry/search?q=", "/ministry/search?q=%20-%20"] { assert_eq!(call(&app, "GET", uri, None, Value::Null).await.1, json!({ "hits": [] }), "{uri}"); }
        let (st, sec) = call(&app, "GET", "/ministry/darby/cw-doctrinal-1/1", None, Value::Null).await;
        assert_eq!(st, 200);
        assert_eq!(sec["section"]["text"], "God so loved the world (John 3:16).\n\nCompare <i>verses</i> 14–18 of the chapter.[1]");
        assert_eq!(sec["section"]["notes"][0], "See John 3:16 again.");
        assert_eq!(sec["section"]["figures"][0]["rows"][0][0], "John 3:16");
        let (_, letter) = call(&app, "GET", "/ministry/darby/cw-doctrinal-1/2", None, Value::Null).await;
        assert!(letter["section"].get("figures").is_none(), "a section without figures has no key: {letter}");
        assert_eq!((sec["count"].as_i64(), sec["work"]["collection"].as_str()), (Some(2), Some("cw")));

        // John 3:16: Darby's quotation first, then the single verses (the hymn, the footnote), then the range, then the row
        // of the section's table last (after every paragraph); Kelly never
        let (st, r) = call(&app, "GET", "/ministry/refs/43/3/16", None, Value::Null).await;
        assert_eq!(st, 200);
        let groups = r["groups"].as_array().unwrap();
        assert_eq!(groups.len(), 1, "Coates has nothing on John 3:16 and Kelly is disabled: {r}");
        let items = groups[0]["items"].as_array().unwrap();
        let got: Vec<(i64, i64, &str)> = items.iter().map(|i| (i["n"].as_i64().unwrap(), i["para"].as_i64().unwrap(), i["mention"].as_str().unwrap())).collect();
        assert_eq!(got, [(1, 0, "quote"), (1, 1, "verse"), (2, 0, "verse"), (1, 1, "range"), (1, 2, "list")]);
        assert_eq!((items[4]["row"].clone(), items[4]["snippet"].clone(), items[4]["hl"].clone()), (json!(true), json!("Whosoever · John 3:16"), json!([12, 21])));
        assert!(items[0].get("row").is_none());
        assert_eq!(items[1]["note"], 1);
        assert_eq!(items[0]["snippet"], "God so loved the world (John 3:16).");
        assert_eq!(items[3]["snippet"], "Compare verses 14–18 of the chapter.[1]");
        assert_eq!(items[3]["hl"], json!([8, 25]));
        assert_eq!(items[2]["snippet"], "A line of a hymn and its second, John 3:16");
        assert_eq!(items[2]["section"], "Letter");
        assert_eq!(groups[0]["total"], 5);

        // 16-17: a paragraph named for both verses is listed once, at its best
        let (_, r) = call(&app, "GET", "/ministry/refs/43/3/16-17", None, Value::Null).await;
        assert_eq!(r["groups"][0]["total"], 5);
        assert_eq!(r["verses"], json!([16, 17]));
        // 17 alone: only the range, and never Kelly's row
        let (_, r) = call(&app, "GET", "/ministry/refs/43/3/17", None, Value::Null).await;
        assert_eq!(r["groups"][0]["items"].as_array().unwrap().len(), 1);
        assert_eq!(r["groups"].as_array().unwrap().len(), 1);

        // the quiet check: verses of a chapter with anything, from enabled authors only
        let (st, ch) = call(&app, "GET", "/ministry/chapter/43/3", None, Value::Null).await;
        assert_eq!((st, ch["verses"].clone()), (200, json!([16, 17])));
        let (_, ch) = call(&app, "GET", "/ministry/chapter/45/8", None, Value::Null).await;
        assert_eq!(ch["verses"], json!([28]));
        let (_, ch) = call(&app, "GET", "/ministry/chapter/1/1", None, Value::Null).await;
        assert_eq!(ch["verses"], json!([]));

        // one author's page
        let (st, r) = call(&app, "GET", "/ministry/refs/45/8/28?author=coates&page=1", None, Value::Null).await;
        assert_eq!(st, 200);
        assert_eq!((r["groups"][0]["author"].as_str(), r["groups"][0]["pages"].as_i64()), (Some("coates"), Some(1)));
        // a verse nobody wrote on: no groups
        let (st, r) = call(&app, "GET", "/ministry/refs/45/8/1", None, Value::Null).await;
        assert_eq!((st, r["groups"].clone()), (200, json!([])));

        // 404s: a disabled or unknown author anywhere, a work or section that is not there, a chapter or verse the
        // Bible does not have; 400 for a selection that does not read
        for uri in ["/ministry/kelly/john", "/ministry/kelly/john/1", "/ministry/refs/43/3/16?author=kelly", "/ministry/nobody/x", "/ministry/darby/nowhere",
            "/ministry/darby/cw-doctrinal-1/0", "/ministry/darby/cw-doctrinal-1/3", "/ministry/refs/43/3/37", "/ministry/refs/43/22/1", "/ministry/refs/67/1/1",
            "/ministry/chapter/43/22", "/ministry/chapter/0/1"] {
            let (st, body) = call(&app, "GET", uri, None, Value::Null).await;
            assert_eq!(st, 404, "{uri}: {body}");
            assert!(body["error"].is_string(), "{uri}");
        }
        for uri in ["/ministry/refs/43/3/x", "/ministry/refs/43/3/17-16"] {
            assert_eq!(call(&app, "GET", uri, None, Value::Null).await.0, 400, "{uri}");
        }
    }

    #[tokio::test]
    async fn paging() {
        let path = fixture();
        {
            let c = rusqlite::Connection::open(&path).unwrap();
            // 45 more Darby paragraphs on John 3:16, ranked in reverse of their order
            for k in 0..45i64 {
                c.execute("INSERT INTO paras VALUES (?1, 'darby', 'cw-doctrinal-1', 2, ?2, 'John 3:16 once more.')", params![100 + k, 1 + k]).unwrap();
                c.execute("INSERT INTO refs VALUES (43003016, 0, ?1, ?2, 0, 0, 9)", params![11_002_000 + (45 - k), 100 + k]).unwrap();
            }
        }
        let (app, _) = app_with_ministry(&path);
        let (_, p1) = call(&app, "GET", "/ministry/refs/43/3/16", None, Value::Null).await;
        let g = &p1["groups"][0];
        assert_eq!((g["total"].as_i64(), g["pages"].as_i64(), g["items"].as_array().unwrap().len()), (Some(50), Some(3), 20));
        let (_, p3) = call(&app, "GET", "/ministry/refs/43/3/16?author=darby&page=3", None, Value::Null).await;
        let g = &p3["groups"][0];
        assert_eq!((g["page"].as_i64(), g["items"].as_array().unwrap().len()), (Some(3), 10));
        // past the end: the last page
        let (_, p9) = call(&app, "GET", "/ministry/refs/43/3/16?author=darby&page=9", None, Value::Null).await;
        assert_eq!(p9["groups"][0]["page"], 3);
        // within a class, a better rank first: the extra paragraphs run from para 145 (rank …001) back to 100
        let order: Vec<i64> = p1["groups"][0]["items"].as_array().unwrap().iter().skip(3).take(3).map(|i| i["para"].as_i64().unwrap()).collect();
        assert_eq!(order, [45, 44, 43]);
    }

    #[tokio::test]
    async fn without_the_database() {
        let (app, _) = crate::testkit::app();
        assert_eq!(call(&app, "GET", "/ministry", None, Value::Null).await.1, json!({ "authors": [] }));
        assert_eq!(call(&app, "GET", "/ministry/chapter/43/3", None, Value::Null).await.1["verses"], json!([]));
        assert_eq!(call(&app, "GET", "/ministry/refs/43/3/16", None, Value::Null).await.1["groups"], json!([]));
        assert_eq!(call(&app, "GET", "/ministry/darby/cw-doctrinal-1", None, Value::Null).await.0, 404);
        assert_eq!(call(&app, "GET", "/ministry/search?q=john", None, Value::Null).await.1, json!({ "hits": [] }));
    }
}
