//! Offline packs of the ministry library: everything the library reader and Ministry on a verse need for one author,
//! built once per data version and kept under `<data>/cache/ministry-offline/`, so a phone can keep an author's works
//! and read them with no connection. `GET /ministry/offline` lists the packs with their sizes; `/offline/{author}` is
//! the whole pack, one gzip JSON (`{ version, author, works: [{ contents, sections }], refs? }`); `/offline/{author}/
//! {work}` one work of it uncompressed (`{ contents, sections }`, what the phone stores per work, so it never parses
//! 50 MB at once) and `/offline/{author}/refs` the verse index (per book, per chapter, rows `[verse, rank, work, n,
//! para, note, start, end, rowText?]`, `work` an index into the pack's works). The index goes in only when it is small
//! beside the text (REFS_SHARE): reading offline is the must, the verse index the nice-to-have. While the cleanse is on
//! (cleanse.rs) the packs are built again without what it hides, under a version of their own (`<version>-c`), so a phone
//! holding the plain pack sees an update and re-syncs; `cleanse undo` offers the plain pack again.
use crate::cleanse;
use crate::edition::Served;
use crate::error::{ApiError, ApiResult};
use crate::ministry::{plain, Ministry};
use crate::AppState;
use axum::{extract::{Path, State}, http::{header, HeaderMap, StatusCode}, response::{IntoResponse, Response}, Json};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;

/// The verse index rides in the pack when its JSON is at most this share of the text's.
const REFS_SHARE: f64 = 1.0 / 3.0;

#[derive(Serialize, Deserialize, Clone)]
pub struct WorkEntry { pub id: String, pub bytes: u64, pub sections: i64 }
/// One author's pack as the listing shows it (and as `info.json` keeps it between server starts).
#[derive(Serialize, Deserialize, Clone)]
pub struct PackInfo {
    pub id: String,
    pub name: String,
    pub short: String,
    /// The data's version: the ministry.db file's mtime and size. A phone compares it with what it holds.
    pub version: String,
    /// The gzip pack.
    pub bytes: u64,
    /// The works' JSON as stored on the phone, uncompressed.
    #[serde(rename = "rawBytes")] pub raw_bytes: u64,
    pub sections: i64,
    /// The verse index is in the pack (and at /offline/{author}/refs).
    pub refs: bool,
    #[serde(rename = "refsBytes")] pub refs_bytes: u64,
    pub works: Vec<WorkEntry>,
}

/// What a pack holds beyond the data, raised when it changes so a phone holding an older pack sees an update: 2, its
/// sections carry their quotations of Scripture (`quotes`).
const FORMAT: u32 = 2;
/// The pack's version: the database file's mtime and size, hex, and the pack's FORMAT; "0" when they cannot be read.
pub fn version_of(db_path: &str) -> String {
    std::fs::metadata(db_path).ok().map(|m| {
        let t = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
        format!("{t:x}-{:x}-{FORMAT}", m.len())
    }).unwrap_or_else(|| "0".into())
}

/// Where the packs live: `<dir of ministry.db>/cache/ministry-offline`. Folders of other versions (plain or cleansed) are removed.
pub fn cache_dir(db_path: &str, version: &str) -> PathBuf {
    let dir = std::path::Path::new(db_path).parent().unwrap_or(std::path::Path::new(".")).join("cache").join("ministry-offline");
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if e.path().is_dir() && !name.ends_with(&format!("-{version}")) && !name.ends_with(&format!("-{version}-c")) { let _ = std::fs::remove_dir_all(e.path()); }
        }
    }
    dir
}

/// The pack's version as listed: the data's, with `-c` while the cleanse is on.
fn version_for(m: &Ministry, cleanse: bool) -> String { if cleanse { format!("{}-c", m.version) } else { m.version.clone() } }
fn pack_dir(m: &Ministry, author: &str, cleanse: bool) -> PathBuf { m.offline_dir.join(format!("{author}-{}", version_for(m, cleanse))) }

/// Builds the author's pack on disk (blocking: run on the blocking pool) and returns its listing entry. Under the cleanse
/// the pack holds what the API serves then: the hidden collections left out, the sections' text and notes cleansed, the
/// index without rows into any of it, the Synopsis's paragraphs renumbered.
fn build(m: &Ministry, author: &str, cleanse: bool) -> anyhow::Result<PackInfo> {
    let served = Served { edition: crate::edition::DEFAULT, cleanse };
    let lib: Value = serde_json::from_str(if cleanse { m.library_for(served) } else { &m.library })?;
    let entry = lib["authors"].as_array().and_then(|a| a.iter().find(|a| a["id"] == author)).cloned().ok_or_else(|| anyhow::anyhow!("no such author"))?;
    let version = version_for(m, cleanse);
    let dir = pack_dir(m, author, cleanse);
    let works_dir = dir.join("works");
    std::fs::create_dir_all(&works_dir)?;
    let c = m.pool.get()?;
    let ord: i64 = c.query_row("SELECT ord FROM authors WHERE id = ?1", [author], |r| r.get(0))?;
    let figures_sql = if m.figures { "SELECT n, notes, figures FROM sections WHERE author = ?1 AND work = ?2" } else { "SELECT n, notes, NULL FROM sections WHERE author = ?1 AND work = ?2" };

    let gz_path = dir.join("pack.json.gz");
    let mut gz = flate2::write::GzEncoder::new(std::io::BufWriter::new(std::fs::File::create(&gz_path)?), flate2::Compression::default());
    write!(gz, "{{\"version\":{},\"author\":{},\"works\":[", json!(version), entry)?;

    let mut works = Vec::new();
    let mut work_index: HashMap<String, usize> = HashMap::new();
    let (mut raw_bytes, mut sections_total) = (0u64, 0i64);
    for col in entry["collections"].as_array().into_iter().flatten() {
        for ws in col["works"].as_array().into_iter().flatten() {
            let id = ws["id"].as_str().unwrap_or("").to_string();
            let w = m.works.get(&(author.to_string(), id.clone())).ok_or_else(|| anyhow::anyhow!("{author}/{id}: not loaded"))?;
            // the text: paragraphs by section, joined by a blank line as /ministry/{author}/{work}/{n} joins them
            let mut texts: Vec<Vec<String>> = vec![Vec::new(); w.count as usize];
            let mut st = c.prepare_cached("SELECT n, text FROM paras WHERE author = ?1 AND work = ?2 ORDER BY n, i")?;
            for r in st.query_map(params![author, id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
                let (n, t) = r?;
                if let Some(v) = texts.get_mut((n - 1).max(0) as usize) { v.push(t) }
            }
            let mut extras: HashMap<i64, (Option<String>, Option<String>)> = HashMap::new();
            let mut st = c.prepare_cached(figures_sql)?;
            for r in st.query_map(params![author, id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?)))? {
                let (n, notes, figs) = r?;
                extras.insert(n, (notes, figs));
            }
            let mut sections = Vec::with_capacity(w.count as usize);
            for n in 1..=w.count {
                let mut s = w.contents_for(cleanse).get((n - 1) as usize).cloned().unwrap_or_else(|| json!({}));
                let text = texts[(n - 1) as usize].join("\n\n");
                s["text"] = json!(if cleanse { cleanse::text(&w.collection, &text) } else { text });
                if let Some((notes, figs)) = extras.get(&n) {
                    if let Some(ns) = notes.as_ref().filter(|_| !(cleanse && cleanse::notes_hidden(&w.collection))) { s["notes"] = serde_json::from_str(ns)? }
                    if let Some(fs) = figs { s["figures"] = serde_json::from_str(fs)? }
                }
                if let Some(q) = m.quotes_of(author, &id, n, cleanse) { s["quotes"] = q }
                sections.push(s);
            }
            let head = json!({ "id": id, "title": w.title, "kind": w.kind, "collection": w.collection });
            let body = format!("{{\"contents\":{{\"author\":{},\"work\":{},\"sections\":{}}},\"sections\":{}}}", json!(author), head, w.raw_for(cleanse), Value::Array(sections));
            std::fs::write(works_dir.join(format!("{id}.json")), &body)?;
            if !works.is_empty() { gz.write_all(b",")?; }
            gz.write_all(body.as_bytes())?;
            raw_bytes += body.len() as u64;
            sections_total += w.count;
            work_index.insert(id.clone(), works.len());
            works.push(WorkEntry { id, bytes: body.len() as u64, sections: w.count });
        }
    }
    gz.write_all(b"]")?;

    // the verse index: per book, per chapter, rows in the server's order (rank, then reading order)
    let mut refs: BTreeMap<i64, BTreeMap<i64, Vec<Value>>> = BTreeMap::new();
    for (sql, row) in [
        ("SELECT r.verse, r.rank, p.work, p.n, p.i, r.note, r.start, r.end, p.text FROM refs r JOIN paras p ON p.id = r.para WHERE r.a = ?1 AND r.note >= 0 ORDER BY r.verse, r.rank, r.para, r.note", false),
        ("SELECT r.verse, r.rank, f.work, f.n, f.slot, r.note, r.start, r.end, f.text FROM refs r JOIN figrows f ON f.id = r.para WHERE r.a = ?1 AND r.note < 0 ORDER BY r.verse, r.rank, r.para, r.note", true),
    ] {
        let mut st = c.prepare(sql)?;
        for r in st.query_map([ord], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?, r.get::<_, i64>(5)?, r.get::<_, i64>(6)?, r.get::<_, i64>(7)?, r.get::<_, Option<String>>(8)?)))? {
            let (verse, rank, work, n, mut i, note, mut start, mut end, text) = r?;
            // a hidden work is not in the pack, so no row of it either
            let Some(&wi) = work_index.get(&work) else { continue };
            if cleanse && !row {
                let collection = m.works.get(&(author.to_string(), work.clone())).map(|w| w.collection.as_str()).unwrap_or("");
                if note > 0 && cleanse::notes_hidden(collection) { continue }
                if note == 0 {
                    if let Some(heads) = m.heads_of(&work, n) { match cleanse::remap_para(i, heads) { Some(j) => i = j, None => continue } }
                    if cleanse::notes_hidden(collection) {
                        let (_, s2, e2) = cleanse::strip_callers_at(&plain(text.as_deref().unwrap_or("")), start as usize, end as usize);
                        (start, end) = (s2 as i64, e2 as i64);
                    }
                }
            }
            let mut v = vec![json!(verse % 1000), json!(rank), json!(wi), json!(n), json!(i), json!(note), json!(start), json!(end)];
            if row { v.push(json!(text.unwrap_or_default())) }
            refs.entry(verse / 1_000_000).or_default().entry(verse / 1000 % 1000).or_default().push(json!(v));
        }
    }
    let refs_json = {
        let mut books = Map::new();
        for (b, chapters) in refs {
            let mut cs = Map::new();
            for (ch, mut rows) in chapters {
                // a figure row sorts among the paragraphs by rank, then by its place in the work
                rows.sort_by_key(|r| (r[1].as_i64().unwrap_or(0), r[2].as_i64().unwrap_or(0), r[3].as_i64().unwrap_or(0), r[4].as_i64().unwrap_or(0), r[5].as_i64().unwrap_or(0)));
                cs.insert(ch.to_string(), Value::Array(rows));
            }
            books.insert(b.to_string(), Value::Object(cs));
        }
        Value::Object(books).to_string()
    };
    let refs_bytes = refs_json.len() as u64;
    let include_refs = (refs_bytes as f64) <= (raw_bytes as f64) * REFS_SHARE;
    if include_refs {
        std::fs::write(dir.join("refs.json"), &refs_json)?;
        write!(gz, ",\"refs\":{refs_json}")?;
    }
    gz.write_all(b"}")?;
    gz.finish()?.flush()?;

    let info = PackInfo {
        id: author.to_string(), name: entry["name"].as_str().unwrap_or("").into(), short: entry["short"].as_str().unwrap_or("").into(),
        version, bytes: std::fs::metadata(&gz_path)?.len(), raw_bytes, sections: sections_total, refs: include_refs, refs_bytes, works,
    };
    std::fs::write(dir.join("info.json"), serde_json::to_vec(&info)?)?;
    tracing::info!("ministry offline pack {author}{}: {} works, {} sections, {} bytes gzip ({} raw), refs {} bytes {}", if cleanse { " (cleansed)" } else { "" }, info.works.len(), info.sections, info.bytes, info.raw_bytes, info.refs_bytes, if include_refs { "included" } else { "left out" });
    Ok(info)
}

impl Ministry {
    /// The author's pack (plain, or the cleansed one), built on first use (or read back from `info.json` when an
    /// earlier start built it).
    pub async fn pack(self: &Arc<Self>, author: &str, cleanse: bool) -> ApiResult<Arc<PackInfo>> {
        self.author(author)?;
        let key = format!("{author}{}", if cleanse { "-c" } else { "" });
        let mut packs = self.packs.lock().await;
        if let Some(p) = packs.get(&key) { return Ok(p.clone()) }
        let dir = pack_dir(self, author, cleanse);
        let version = version_for(self, cleanse);
        let kept = std::fs::read(dir.join("info.json")).ok().and_then(|b| serde_json::from_slice::<PackInfo>(&b).ok())
            .filter(|i| i.version == version && dir.join("pack.json.gz").exists());
        let info = match kept {
            Some(i) => i,
            None => {
                let (m, a) = (self.clone(), author.to_string());
                tokio::task::spawn_blocking(move || build(&m, &a, cleanse)).await.map_err(|_| ApiError::internal("server error"))??
            }
        };
        let info = Arc::new(info);
        packs.insert(key, info.clone());
        Ok(info)
    }
}

fn need(s: &AppState) -> ApiResult<&Arc<Ministry>> { s.ministry.as_ref().ok_or_else(|| ApiError::not_found("no such author")) }
/// The library, and `author` in it as the edition shows it: an author it leaves out has no pack to offer.
async fn need_author<'a>(s: &'a AppState, author: &str) -> ApiResult<(&'a Arc<Ministry>, Served)> {
    let m = need(s)?;
    let served = s.served().await;
    m.author_in(author, served.edition)?;
    Ok((m, served))
}

/// A pack file from disk with its version as ETag; 304 when the client holds it.
async fn file(path: PathBuf, version: &str, content_type: &'static str, h: &HeaderMap) -> ApiResult<Response> {
    let etag = format!("\"{version}\"");
    if h.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) == Some(etag.as_str()) {
        return Ok((StatusCode::NOT_MODIFIED, [(header::ETAG, etag)]).into_response());
    }
    let bytes = tokio::fs::read(&path).await.map_err(|_| ApiError::not_found("no such file"))?;
    let headers = [(header::CONTENT_TYPE, content_type.to_string()), (header::ETAG, etag), (header::CACHE_CONTROL, "public, max-age=86400".into()), (header::CONTENT_LENGTH, bytes.len().to_string())];
    Ok((headers, bytes).into_response())
}

/// `GET /ministry/offline`: `{ authors: [{ id, name, short, version, bytes, rawBytes, sections, refs, refsBytes, works:
/// [{ id, bytes, sections }] }] }`, every enabled author (the first call builds the packs).
pub async fn listing(State(s): State<AppState>) -> ApiResult<Response> {
    let Some(m) = s.ministry.as_ref() else { return Ok(Json(json!({ "authors": [] })).into_response()) };
    let served = s.served().await;
    let mut authors = Vec::new();
    for id in m.author_ids(served.edition) { authors.push((*m.pack(&id, served.cleanse).await?).clone()) }
    Ok(([(header::CACHE_CONTROL, "public, max-age=3600")], Json(json!({ "authors": authors }))).into_response())
}

/// `GET /ministry/offline/{author}`: the gzip pack (`application/gzip`, Content-Length, ETag the version).
pub async fn pack(State(s): State<AppState>, Path(author): Path<String>, h: HeaderMap) -> ApiResult<Response> {
    let (m, served) = need_author(&s, &author).await?;
    let info = m.pack(&author, served.cleanse).await?;
    file(pack_dir(m, &author, served.cleanse).join("pack.json.gz"), &info.version, "application/gzip", &h).await
}

/// `GET /ministry/offline/{author}/refs`: the verse index alone, JSON; 404 when the pack left it out.
pub async fn refs(State(s): State<AppState>, Path(author): Path<String>, h: HeaderMap) -> ApiResult<Response> {
    let (m, served) = need_author(&s, &author).await?;
    let info = m.pack(&author, served.cleanse).await?;
    if !info.refs { return Err(ApiError::not_found("the verse index is not in this pack")) }
    file(pack_dir(m, &author, served.cleanse).join("refs.json"), &info.version, "application/json", &h).await
}

/// `GET /ministry/offline/{author}/{work}`: one work, `{ contents, sections }`, JSON.
pub async fn work(State(s): State<AppState>, Path((author, work)): Path<(String, String)>, h: HeaderMap) -> ApiResult<Response> {
    let (m, served) = need_author(&s, &author).await?;
    let info = m.pack(&author, served.cleanse).await?;
    if !info.works.iter().any(|w| w.id == work) { return Err(ApiError::not_found("no such work")) }
    file(pack_dir(m, &author, served.cleanse).join("works").join(format!("{work}.json")), &info.version, "application/json", &h).await
}

#[cfg(test)]
mod tests {
    use crate::testkit::{app_with_ministry, call};
    use axum::{body::Body, http::Request};
    use serde_json::Value;
    use std::io::Read;
    use tower::ServiceExt;

    #[tokio::test]
    async fn packs_round_trip() {
        let (app, _) = app_with_ministry(&crate::ministry::tests::fixture());
        let (st, list) = call(&app, "GET", "/ministry/offline", None, Value::Null).await;
        assert_eq!(st, 200, "{list}");
        let authors = list["authors"].as_array().unwrap();
        assert_eq!(authors.iter().map(|a| a["id"].as_str().unwrap()).collect::<Vec<_>>(), ["darby", "coates"], "enabled authors only");
        let darby = &authors[0];
        assert_eq!((darby["sections"].as_i64(), darby["works"][0]["id"].as_str(), darby["refs"].as_bool()), (Some(2), Some("cw-doctrinal-1"), Some(true)));
        assert!(darby["bytes"].as_u64().unwrap() > 0 && darby["rawBytes"].as_u64().unwrap() > darby["bytes"].as_u64().unwrap() / 4);

        // the gzip pack: gunzipped, it holds every work with every section's text, notes and figures, and the index
        let res = app.clone().oneshot(Request::builder().uri("/ministry/offline/darby").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.status(), 200);
        assert_eq!(res.headers()[header_name("content-type")], "application/gzip");
        let etag = res.headers()[header_name("etag")].to_str().unwrap().to_string();
        assert_eq!(etag, format!("\"{}\"", darby["version"].as_str().unwrap()));
        let len: usize = res.headers()[header_name("content-length")].to_str().unwrap().parse().unwrap();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 26).await.unwrap();
        assert_eq!((bytes.len(), bytes.len() as u64), (len, darby["bytes"].as_u64().unwrap()));
        let mut json = String::new();
        flate2::read::GzDecoder::new(&bytes[..]).read_to_string(&mut json).unwrap();
        let pack: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(pack["version"], darby["version"]);
        assert_eq!(pack["author"]["collections"][0]["works"][0]["id"], "cw-doctrinal-1");
        let works = pack["works"].as_array().unwrap();
        let sections: usize = works.iter().map(|w| w["sections"].as_array().unwrap().len()).sum();
        assert_eq!(sections as i64, darby["sections"].as_i64().unwrap());
        let (_, api) = call(&app, "GET", "/ministry/darby/cw-doctrinal-1/1", None, Value::Null).await;
        assert_eq!(works[0]["sections"][0], api["section"], "a packed section is the API's");
        let (_, contents) = call(&app, "GET", "/ministry/darby/cw-doctrinal-1", None, Value::Null).await;
        assert_eq!(works[0]["contents"], contents);
        // the index: John 3:16's rows, best first, the figure row last with its text; verses within the chapter
        let rows = pack["refs"]["43"]["3"].as_array().unwrap();
        assert_eq!(rows.iter().filter(|r| r[0] == 16).count(), 5);
        assert_eq!((rows[0][0].as_i64(), rows[0][1].as_i64(), rows[0][2].as_i64()), (Some(16), Some(1_001_000), Some(0)), "the quotation first: {}", rows[0]);
        let last = rows.iter().filter(|r| r[0] == 16).last().unwrap();
        assert_eq!((last[5].as_i64(), last[8].as_str()), (Some(-1), Some("Whosoever · John 3:16")));

        // one work uncompressed, the index alone, and a 304 for the version held
        let (st, w) = call(&app, "GET", "/ministry/offline/darby/cw-doctrinal-1", None, Value::Null).await;
        assert_eq!((st, &w), (200, &works[0]));
        let (st, r) = call(&app, "GET", "/ministry/offline/darby/refs", None, Value::Null).await;
        assert_eq!((st, &r), (200, &pack["refs"]));
        let res = app.clone().oneshot(Request::builder().uri("/ministry/offline/darby").header("if-none-match", &etag).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.status(), 304);
        // 404s: a disabled author, an unknown work
        for uri in ["/ministry/offline/kelly", "/ministry/offline/darby/nowhere", "/ministry/offline/kelly/john"] {
            assert_eq!(call(&app, "GET", uri, None, Value::Null).await.0, 404, "{uri}");
        }
    }

    #[tokio::test]
    async fn without_the_database() {
        let (app, _) = crate::testkit::app();
        assert_eq!(call(&app, "GET", "/ministry/offline", None, Value::Null).await.1, serde_json::json!({ "authors": [] }));
        assert_eq!(call(&app, "GET", "/ministry/offline/darby", None, Value::Null).await.0, 404);
    }

    fn header_name(n: &'static str) -> axum::http::HeaderName { axum::http::HeaderName::from_static(n) }
}
