//! The paragraphs a plain question finds, ordered by how near they are in meaning to it, for the assistant
//! (docs/SEARCH_EXPAND.md, "Passages by meaning"). The expansion (expand.rs) finds them by the phrases and verses it
//! serves; a hosted embedding model gives the question a vector, kept per question in `search_vectors` of the user
//! database; each paragraph's vector was computed once by tools/embed_ministry.py into data/ministry_vec.bin
//! (`Vectors`). The file stays on disk: a request reads only the rows of its candidates.
use crate::edition::Served;
use crate::error::ApiResult;
use crate::expand::{self, Asked};
use crate::ministry::Ministry;
use crate::AppState;
use axum::{extract::{Query, State}, response::{IntoResponse, Response}, Json};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::os::unix::fs::FileExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

const MODEL: &str = "text-embedding-3-small";
const URL: &str = "https://api.openai.com";
/// The numbers of a row: text-embedding-3-small's full size. The shorter sizes changed three to five of the top ten.
pub(crate) const DIMS: usize = 1536;
/// The paragraphs a request orders at most, the expansion's first: one question reads at most this many rows.
const CANDIDATES: usize = 3000;
/// The paragraphs answered.
const SHOWN: usize = 10;
/// A call that has not answered by then leaves the passages in the expansion's order, within the two seconds the
/// assistant waits.
const TIMEOUT: std::time::Duration = std::time::Duration::from_millis(1500);

/// data/ministry_vec.bin, as tools/embed_ministry.py writes it, integers little-endian:
///
/// | bytes | |
/// |---|---|
/// | 4 | `MAGIC` |
/// | u32 | `FORMAT` |
/// | u32 | the numbers of a row (`DIMS`) |
/// | u64 | the rows, `count` |
/// | u32, then that many | the model's name, UTF-8 |
/// | count × i64 | the paragraphs' ids (`paras.id`), ascending |
/// | count × DIMS × i8 | each paragraph's vector in the same order, `quantized` |
const MAGIC: &[u8; 4] = b"MVEC";
const FORMAT: u32 = 1;
const HEAD: u64 = 24;

/// The file, open, and its ids: a paragraph's row is found by binary search of `ids` and read from disk on its own.
pub struct Vectors { file: std::fs::File, ids: Vec<i64>, rows: u64 }
impl Vectors {
    /// The file at `path` if it fits: made by `model` with DIMS numbers a row, one row for each of `library` (the
    /// enabled authors' paragraphs, ascending) and no byte more or less. Only the header and the ids are read. Err says
    /// why not.
    pub fn open(path: &Path, model: &str, library: &[i64]) -> Result<Vectors, String> {
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let len = file.metadata().map_err(|e| e.to_string())?.len();
        let read = |at: u64, n: usize| { let mut b = vec![0u8; n]; file.read_exact_at(&mut b, at).map(|_| b).map_err(|_| format!("{len} bytes, cut short")) };
        let head = read(0, HEAD as usize)?;
        let word = |i: usize| u32::from_le_bytes(head[i..i + 4].try_into().unwrap());
        if &head[..4] != MAGIC { return Err("not a vector file".into()) }
        let (format, dims, count, name_len) = (word(4), word(8) as u64, u64::from_le_bytes(head[12..20].try_into().unwrap()), word(20) as u64);
        if format != FORMAT { return Err(format!("format {format}, the server reads {FORMAT}")) }
        let name = read(HEAD, name_len.min(256) as usize)?;
        let name = String::from_utf8_lossy(&name);
        if name != model { return Err(format!("made with {name}, the server asks {model}")) }
        if dims != DIMS as u64 { return Err(format!("{dims} numbers a row, the server's have {DIMS}")) }
        let rows = HEAD + name_len + count.saturating_mul(8);
        let size = count.checked_mul(8 + DIMS as u64).map(|n| n + HEAD + name_len);
        if size != Some(len) { return Err(format!("{len} bytes for {count} rows of {DIMS}")) }
        let ids: Vec<i64> = read(HEAD + name_len, count as usize * 8)?.chunks_exact(8).map(|b| i64::from_le_bytes(b.try_into().unwrap())).collect();
        if ids != library { return Err(format!("{count} rows for the {} paragraphs of the library, or other ids: made from another build of ministry.db", library.len())) }
        Ok(Vectors { file, ids, rows })
    }
    /// Paragraph `id`'s row, read from disk into `row`: false when the file has none.
    fn row(&self, id: i64, row: &mut [u8]) -> std::io::Result<bool> {
        let Ok(k) = self.ids.binary_search(&id) else { return Ok(false) };
        self.file.read_exact_at(row, self.rows + k as u64 * DIMS as u64)?;
        Ok(true)
    }
}

/// A vector as the file keeps one: L2-normalised, times 127, rounded half to even as numpy rounds.
pub(crate) fn quantized(v: &[f32]) -> Vec<i8> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    v.iter().map(|x| (x / norm * 127.0).round_ties_even().clamp(-127.0, 127.0) as i8).collect()
}
fn dot(q: &[i8], row: &[u8]) -> i32 { q.iter().zip(row).map(|(&a, &b)| a as i32 * b as i8 as i32).sum() }

/// Read once at start: without `BEREAN_EMBED_KEY` no question is embedded and every answer is by matches. `url` is the
/// embeddings API's host (`BEREAN_EMBED_URL`), a local stand-in for the tests and the web check. `vectors` is the file
/// when there is a key and the file fits.
pub struct Config { key: Option<String>, model: String, url: String, vectors: Option<Arc<Vectors>> }
impl Config {
    /// The file is `BEREAN_MINISTRY_VEC`, or ministry_vec.bin beside `ministry_path`. Logs at start what it found.
    pub fn from_env(m: Option<&Ministry>, ministry_path: &str) -> Config {
        let var = |k: &str| std::env::var(k).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        let mut c = Config {
            key: var("BEREAN_EMBED_KEY"),
            model: var("BEREAN_EMBED_MODEL").unwrap_or_else(|| MODEL.into()),
            url: var("BEREAN_EMBED_URL").map(|u| u.trim_end_matches('/').to_string()).unwrap_or_else(|| URL.into()),
            vectors: None,
        };
        let path = var("BEREAN_MINISTRY_VEC").map(PathBuf::from).unwrap_or_else(|| Path::new(ministry_path).with_file_name("ministry_vec.bin"));
        match (&c.key, m) {
            (None, _) => tracing::info!("passages by meaning off: no BEREAN_EMBED_KEY"),
            (Some(_), None) => {}
            (Some(_), Some(_)) if !path.exists() => tracing::warn!("no {}: passages are ordered by their matches (tools/embed_ministry.py makes it)", path.display()),
            (Some(_), Some(m)) => match m.paragraph_ids().map_err(|e| e.message).and_then(|ids| Vectors::open(&path, &c.model, &ids)) {
                Ok(v) => { tracing::info!("passages by meaning on: {}, {} rows in {}", c.model, v.ids.len(), path.display()); c.vectors = Some(Arc::new(v)) }
                Err(why) => tracing::warn!("{} refused: {why}; passages are ordered by their matches", path.display()),
            },
        }
        c
    }
    pub fn off() -> Config { Config { key: None, model: MODEL.into(), url: URL.into(), vectors: None } }
}

/// `meaning`: the embedding ordered the items; `matches`: it could not (no key, no file that fits, the day's calls
/// taken, the call failed, nothing to order), and they are in the expansion's own order.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
enum By { Meaning, Matches }
/// `GET /ministry/passages?q=` (shared/ministry.ts Passages).
#[derive(Serialize)]
struct Passages { q: String, state: Asked, by: By, items: Vec<Value> }

#[derive(Deserialize)]
pub struct PassagesQ { q: Option<String> }

/// `GET /ministry/passages?q=`: the expansion's paragraphs (`candidates`) in the edition served, the SHOWN nearest the
/// question, or the expansion's SHOWN first when they cannot be ordered by meaning. `q` and `state` are the expansion's.
/// Only an answer that will not change may be kept by a cache: by meaning, or with nothing to order.
pub async fn passages(State(s): State<AppState>, Query(q): Query<PassagesQ>) -> ApiResult<Response> {
    let n = nearest(&s, q.q.as_deref().unwrap_or("")).await?;
    Ok(reply(Passages { q: n.q, state: n.state, by: n.by, items: n.items.into_iter().map(|(_, i)| i).collect() }))
}

/// What `/ministry/passages` answers, each item with its `paras.id`, and the edition and cleanse its items were read
/// in, for the assistant to read the same paragraphs' text in (assistant.rs search_library).
pub(crate) struct Nearest { q: String, state: Asked, by: By, pub(crate) items: Vec<(i64, Value)>, pub(crate) served: Served }
pub(crate) async fn nearest(s: &AppState, q: &str) -> ApiResult<Nearest> {
    let (asked, kept) = expand::question(q);
    // A new question's vector is asked for while its expansion is, not after it: the embedder takes only the question
    // as asked. It begins once the expansion has taken its place among the day's calls (`expansion_asking`), so at the
    // day's last call the expansion is the one made. A vector made beside an expansion that then fails or finds
    // nothing is kept as any other, and that question makes the call once.
    let (begin, begun) = tokio::sync::oneshot::channel::<()>();
    let beside = async {
        match (&asked, &s.near.vectors, s.near.key.is_some(), begun.await) {
            (Some(asked), Some(_), true, Ok(())) => Some(question_vector(s, asked, &kept).await),
            _ => None,
        }
    };
    let (expanded, beside) = tokio::join!(expand::expansion_asking(s, asked.as_deref(), kept.clone(), move || { let _ = begin.send(()); }), beside);
    let (mut e, mut served) = expanded?;
    let (Some(lib), Some(asked), Asked::Ok) = (s.ministry.clone(), asked, e.state) else { return Ok(Nearest { q: e.q, state: e.state, by: By::Matches, items: Vec::new(), served }) };
    let mut ranked = in_order(&lib, &e, served).await?;
    let mut near = None;
    if let (Some(v), true) = (&s.near.vectors, s.near.key.is_some()) {
        // a question asked before has its expansion kept and asks no model: its vector is kept too, or is asked for
        // now, when there are paragraphs to order
        let (q, called) = match beside {
            Some(q) => (q?, true),
            None if !ranked.is_empty() => (question_vector(s, &asked, &e.q).await?, true),
            None => (None, false),
        };
        // the embedding call can outlast edition::TTL: the answer is counted again in the edition served once it is back
        if called && s.served().await != served {
            (e, served) = expand::expansion(s, Some(&asked), kept).await?;
            ranked = in_order(&lib, &e, served).await?;
        }
        near = q.filter(|_| !ranked.is_empty()).map(|q| (v.clone(), q));
    }
    let (by, order) = match near {
        Some((v, q)) if !ranked.is_empty() => {
            let read = ranked.clone();
            match tokio::task::spawn_blocking(move || by_meaning(&v, &read, &q)).await {
                Ok(Ok(order)) => (By::Meaning, order),
                Ok(Err(why)) => { tracing::warn!("passages: the vector file could not be read: {why}"); (By::Matches, ranked) }
                Err(_) => (By::Matches, ranked),
            }
        }
        _ => (By::Matches, ranked),
    };
    let items = lib.clone().db(move |c| {
        let mut items = Vec::new();
        for id in order { if items.len() == SHOWN { break } if let Some(i) = lib.passage(c, id, served)? { items.push((id, i)) } }
        Ok(items)
    }).await?;
    Ok(Nearest { q: e.q, state: e.state, by, items, served })
}
/// `candidates` of the expansion `e`, counted in the edition `served`.
async fn in_order(lib: &Arc<Ministry>, e: &expand::Expansion, served: Served) -> ApiResult<Vec<i64>> {
    let phrases: Vec<String> = e.phrases.iter().map(|p| p.text.clone()).collect();
    let verses: Vec<i64> = e.verses.iter().map(|v| v.book * 1_000_000 + v.chapter * 1000 + v.verse).collect();
    let m = lib.clone();
    lib.db(move |c| candidates(c, &m, &phrases, &verses, served)).await
}
fn reply(p: Passages) -> Response {
    let lasts = p.state == Asked::Ok && (p.by == By::Meaning || p.items.is_empty());
    let r = Json(p).into_response();
    if lasts { crate::ministry::day(r) } else { r }
}

/// The expansion's paragraphs in the edition `s`: those with one of `phrases` as typed (the paragraphs its total counts)
/// or citing one of `verses` in their own text, each once, in the expansion's own order (most phrases and verses, then
/// more phrases, then reading order), at most CANDIDATES.
fn candidates(c: &rusqlite::Connection, m: &Ministry, phrases: &[String], verses: &[i64], s: Served) -> ApiResult<Vec<i64>> {
    let mut found: std::collections::HashMap<i64, (usize, usize)> = Default::default();
    for p in phrases { for id in m.text_ids(c, p, s, false)? { found.entry(id).or_default().0 += 1 } }
    for &v in verses { for id in m.citing_ids(c, v, s)? { found.entry(id).or_default().1 += 1 } }
    let mut ranked: Vec<(i64, (usize, usize))> = found.into_iter().collect();
    ranked.sort_unstable_by_key(|&(id, (p, v))| (std::cmp::Reverse(p + v), std::cmp::Reverse(p), id));
    Ok(ranked.into_iter().take(CANDIDATES).map(|(id, _)| id).collect())
}

/// `ranked` nearest the question `q` first, the file's rows read in their order on disk; a tie keeps the expansion's
/// order, and a paragraph the file lacks goes last.
fn by_meaning(v: &Vectors, ranked: &[i64], q: &[i8]) -> std::io::Result<Vec<i64>> {
    let mut row = vec![0u8; DIMS];
    let mut on_disk: Vec<usize> = (0..ranked.len()).collect();
    on_disk.sort_unstable_by_key(|&k| ranked[k]);
    let mut sim = vec![i32::MIN; ranked.len()];
    for k in on_disk { if v.row(ranked[k], &mut row)? { sim[k] = dot(q, &row) } }
    let mut order: Vec<usize> = (0..ranked.len()).collect();
    order.sort_by_key(|&k| std::cmp::Reverse(sim[k]));
    Ok(order.into_iter().map(|k| ranked[k]).collect())
}

/// The question's vector, quantized: kept in `search_vectors` under the question as kept and the model, or from one
/// embedding call of the question as asked, taken from the day's calls before it is made and kept once it answers.
/// None when the day's calls are taken or the call failed; a failed call is not kept, so the next ask tries again.
async fn question_vector(s: &AppState, asked: &str, kept: &str) -> ApiResult<Option<Vec<i8>>> {
    let (q, model) = (kept.to_string(), s.near.model.clone());
    let had: Option<Vec<u8>> = s.db(move |c| Ok(c.query_row("SELECT vec FROM search_vectors WHERE q = ?1 AND model = ?2", rusqlite::params![q, model], |r| r.get(0)).optional()?)).await?;
    if let Some(bytes) = had.filter(|b| b.len() == DIMS * 4) { return Ok(Some(quantized(&floats(&bytes)))) }
    if !expand::take_call(s).await? { return Ok(None) }
    match embed(&s.near, asked).await {
        Ok(bytes) => {
            let v = quantized(&floats(&bytes));
            let (q, model) = (kept.to_string(), s.near.model.clone());
            s.db(move |c| Ok(c.execute("INSERT OR REPLACE INTO search_vectors (q, model, vec, at) VALUES (?1, ?2, ?3, ?4)", rusqlite::params![q, model, bytes, crate::db::now_iso()]).map(|_| ())?)).await?;
            Ok(Some(v))
        }
        Err(why) => { tracing::warn!("passages: no embedding to keep: {why}"); Ok(None) }
    }
}
fn floats(bytes: &[u8]) -> Vec<f32> { bytes.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect() }

/// One call to the embeddings API for `text`: its vector as the API sends it (DIMS little-endian f32), or why there is
/// none: no key, a failed call, anything but HTTP 200, a vector of another size. Every answer's tokens are logged.
async fn embed(cfg: &Config, text: &str) -> Result<Vec<u8>, String> {
    use base64::prelude::{Engine, BASE64_STANDARD};
    let key = cfg.key.as_deref().ok_or_else(|| "no BEREAN_EMBED_KEY".to_string())?;
    let res = crate::http_client().post(format!("{}/v1/embeddings", cfg.url)).bearer_auth(key).timeout(TIMEOUT)
        .json(&serde_json::json!({ "model": cfg.model, "input": text, "encoding_format": "base64" })).send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let v: Value = res.json().await.map_err(|e| e.to_string())?;
    tracing::info!(model = %cfg.model, status = status.as_u16(), tokens = v["usage"]["total_tokens"].as_i64().unwrap_or(0), "embedding call");
    if !status.is_success() { return Err(format!("HTTP {status}: {}", v["error"]["message"].as_str().unwrap_or("?"))) }
    let bytes = BASE64_STANDARD.decode(v["data"][0]["embedding"].as_str().ok_or_else(|| "no embedding".to_string())?).map_err(|e| e.to_string())?;
    if bytes.len() != DIMS * 4 { return Err(format!("{} numbers, not {DIMS}", bytes.len() / 4)) }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edition::Edition;
    use crate::testkit::{app_with_near, call};
    use axum::http::{HeaderMap, StatusCode};
    use base64::prelude::{Engine, BASE64_STANDARD};
    use rusqlite::params;
    use serde_json::json;
    use std::sync::Mutex;

    type Calls = Arc<Mutex<Vec<(HeaderMap, Value)>>>;
    type Embed = fn(&str) -> (u16, Vec<f32>);

    /// How long each stand-in takes to answer, a note to the test that a call has come in, and the address each call
    /// came from: one address is one connection.
    #[derive(Clone, Default)]
    struct Slow { model: std::time::Duration, embedder: std::time::Duration, model_called: Arc<tokio::sync::Notify>, embedder_called: Arc<tokio::sync::Notify>, peers: Arc<Mutex<Vec<std::net::SocketAddr>>> }
    type Peer = axum::extract::ConnectInfo<std::net::SocketAddr>;

    /// The Messages API and the embeddings API on one local port, every call kept: the model answers `answer` to every
    /// question, the embedder `embed(input)`, a status and the vector, each after `slow`'s wait.
    async fn stand_in(answer: fn() -> String, embed: Embed, slow: Slow) -> (String, Calls, Calls) {
        let (model, embedder): (Calls, Calls) = Default::default();
        let (m, e, s) = (model.clone(), embedder.clone(), slow.clone());
        let app = axum::Router::new()
            .route("/v1/messages", axum::routing::post(move |axum::extract::ConnectInfo(peer): Peer, headers: HeaderMap, Json(body): Json<Value>| {
                let (m, slow) = (m.clone(), s.clone());
                slow.peers.lock().unwrap().push(peer);
                async move {
                    slow.model_called.notify_one();
                    tokio::time::sleep(slow.model).await;
                    m.lock().unwrap().push((headers, body));
                    Json(crate::expand::tests::text(&answer()).1)
                }
            }))
            .route("/v1/embeddings", axum::routing::post(move |axum::extract::ConnectInfo(peer): Peer, headers: HeaderMap, Json(body): Json<Value>| {
                let (e, slow) = (e.clone(), slow.clone());
                slow.peers.lock().unwrap().push(peer);
                async move {
                    slow.embedder_called.notify_one();
                    tokio::time::sleep(slow.embedder).await;
                    let (status, v) = embed(body["input"].as_str().unwrap_or(""));
                    e.lock().unwrap().push((headers, body));
                    let bytes: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
                    let reply = if status == 200 {
                        json!({ "object": "list", "data": [{ "object": "embedding", "index": 0, "embedding": BASE64_STANDARD.encode(bytes) }], "model": MODEL, "usage": { "prompt_tokens": 9, "total_tokens": 9 } })
                    } else { json!({ "error": { "message": "The server had an error while processing your request.", "type": "server_error" } }) };
                    (StatusCode::from_u16(status).unwrap(), Json(reply))
                }
            }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await.unwrap() });
        (url, model, embedder)
    }

    /// The fixture of ministry.rs's tests with the words of expand.rs's.
    fn library() -> String {
        let db = crate::ministry::tests::fixture();
        crate::ministry::tests::with_text(&db);
        db
    }
    fn library_ids(db: &str) -> Vec<i64> { Ministry::open(db).unwrap().unwrap().paragraph_ids().unwrap() }
    /// A vector file for `ids`, as tools/embed_ministry.py writes one: `row(id)` quantized, `model` and `dims` in the header.
    fn write(ids: &[i64], model: &str, dims: usize, row: impl Fn(i64) -> Vec<f32>) -> PathBuf {
        let path = std::env::temp_dir().join(format!("berean-vec-{}.bin", crate::auth::random_token(8)));
        let mut b: Vec<u8> = MAGIC.to_vec();
        for n in [FORMAT, dims as u32] { b.extend(n.to_le_bytes()) }
        b.extend((ids.len() as u64).to_le_bytes());
        b.extend((model.len() as u32).to_le_bytes());
        b.extend(model.as_bytes());
        for id in ids { b.extend(id.to_le_bytes()) }
        for &id in ids { b.extend(quantized(&row(id)).iter().map(|&x| x as u8)) }
        std::fs::write(&path, b).unwrap();
        path
    }
    fn vectors(db: &str, row: impl Fn(i64) -> Vec<f32>) -> Vectors {
        let ids = library_ids(db);
        Vectors::open(&write(&ids, MODEL, DIMS, row), MODEL, &ids).unwrap()
    }
    /// A paragraph's row: one number of its own, the id's place among the DIMS.
    fn hot(id: i64) -> Vec<f32> { let mut v = vec![0.0; DIMS]; v[id as usize % DIMS] = 1.0; v }
    /// A question nearest `ids`' rows (`hot`) in that order, and far from every other.
    fn toward(ids: &[i64]) -> Vec<f32> {
        let mut v = vec![0.0; DIMS];
        for (k, id) in ids.iter().enumerate() { v[*id as usize % DIMS] = (ids.len() - k) as f32 }
        v
    }
    fn toward_coates(_: &str) -> (u16, Vec<f32>) { (200, toward(&[1000, 4, 1100, 2, 301, 1])) }
    fn toward_coates_first(_: &str) -> (u16, Vec<f32>) { (200, toward(&[1000, 1100, 4])) }
    fn sealing() -> String { crate::expand::tests::sealing_json() }

    struct Test { app: axum::Router, pool: crate::db::DbPool, model: Calls, embedder: Calls }
    async fn test(db: &str, answer: fn() -> String, embed: Embed, daily: i64, key: bool, vectors: Option<Vectors>) -> Test {
        test_with(db, answer, embed, daily, key, vectors, Slow::default()).await
    }
    async fn test_with(db: &str, answer: fn() -> String, embed: Embed, daily: i64, key: bool, vectors: Option<Vectors>, slow: Slow) -> Test {
        let (url, model, embedder) = stand_in(answer, embed, slow).await;
        let expand = crate::expand::Config { key: Some("test-key".into()), model: "claude-haiku-5-5".into(), daily, url: url.clone() };
        let near = Config { key: key.then(|| "test-embed-key".into()), model: MODEL.into(), url, vectors: vectors.map(Arc::new) };
        let (app, pool) = app_with_near(db, expand, near);
        Test { app, pool, model, embedder }
    }
    impl Test {
        fn calls(&self) -> (usize, usize) { (self.model.lock().unwrap().len(), self.embedder.lock().unwrap().len()) }
    }
    async fn ask(app: &axum::Router, q: &str) -> Value {
        let (st, v) = call(app, "GET", &format!("/ministry/passages?q={}", q.replace(' ', "%20").replace('?', "%3F")), None, Value::Null).await;
        assert_eq!(st, 200, "{v}");
        v
    }
    /// The answer's paragraphs by their ids in the fixture.
    fn ids(db: &str, v: &Value) -> Vec<i64> {
        let c = rusqlite::Connection::open(db).unwrap();
        v["items"].as_array().unwrap().iter().map(|i| c.query_row("SELECT id FROM paras WHERE author = ?1 AND work = ?2 AND n = ?3 AND i = ?4",
            params![i["author"].as_str(), i["work"]["id"].as_str(), i["n"].as_i64(), i["para"].as_i64()], |r| r.get(0)).unwrap()).collect()
    }
    const Q: &str = "how can I be sealed with the Spirit";
    /// The sealing answer's paragraphs in the expansion's order: "sealed with the Spirit" as typed (Darby's, Coates's),
    /// then those citing John 3:16 and Romans 8:28, each in reading order.
    const SEALING: [i64; 6] = [301, 1100, 1, 2, 4, 1000];

    #[tokio::test]
    async fn near_orders_the_expansions_paragraphs_by_meaning() {
        let db = library();
        let t = test(&db, sealing, toward_coates, 2000, true, Some(vectors(&db, hot))).await;
        let v = ask(&t.app, Q).await;
        assert_eq!((v["q"].as_str(), v["state"].as_str(), v["by"].as_str()), (Some("how can i be sealed with the spirit"), Some("ok"), Some("meaning")), "{v}");
        assert_eq!(ids(&db, &v), [1000, 4, 1100, 2, 301, 1]);
        assert_eq!(t.calls(), (1, 1));
    }

    /// The calls of a second question go over the connections the first one's left open: no call makes a client, and
    /// with it a connection, of its own. A new question's two calls are made together, here to one host, so they are
    /// two connections and no more.
    #[tokio::test]
    async fn near_the_calls_of_a_second_question_go_over_the_firsts_connections() {
        let db = library();
        let slow = Slow::default();
        let t = test_with(&db, sealing, toward_coates, 2000, true, Some(vectors(&db, hot)), slow.clone()).await;
        for q in [Q, "what is the sealing of the Spirit"] { assert_eq!(ask(&t.app, q).await["by"], "meaning") }
        let peers = slow.peers.lock().unwrap().clone();
        let connections: std::collections::HashSet<std::net::SocketAddr> = peers.iter().copied().collect();
        assert_eq!((t.calls(), peers.len()), ((2, 2), 4));
        assert!(connections.len() <= 2, "a call opened a connection of its own: {peers:?}");
    }

    #[tokio::test]
    async fn near_answers_a_paragraph_once_however_many_items_find_it() {
        fn twice() -> String { json!({ "phrases": ["God so loved the world", "sealed with the Spirit"], "verses": ["John 3:16"], "related": [] }).to_string() }
        fn toward_4(_: &str) -> (u16, Vec<f32>) { (200, toward(&[4, 1])) }
        let db = library();
        let matches = test(&db, twice, toward_4, 2000, false, Some(vectors(&db, hot))).await;
        assert_eq!(ids(&db, &ask(&matches.app, Q).await), [1, 301, 1100, 2, 4], "a phrase and a verse first, then a phrase, then a verse, each in reading order");
        let meaning = test(&db, twice, toward_4, 2000, true, Some(vectors(&db, hot))).await;
        assert_eq!(ids(&db, &ask(&meaning.app, Q).await), [4, 1, 301, 1100, 2]);
    }

    #[tokio::test]
    async fn near_answers_the_ten_nearest_of_more() {
        fn grace() -> String { json!({ "phrases": ["Grace reigns"], "verses": [], "related": [] }).to_string() }
        fn toward_last(_: &str) -> (u16, Vec<f32>) { (200, toward(&(435..445).rev().collect::<Vec<_>>())) }
        let db = library();
        let matches = test(&db, grace, toward_last, 2000, false, Some(vectors(&db, hot))).await;
        assert_eq!(ids(&db, &ask(&matches.app, Q).await), (400..410).collect::<Vec<_>>());
        let meaning = test(&db, grace, toward_last, 2000, true, Some(vectors(&db, hot))).await;
        assert_eq!(ids(&db, &ask(&meaning.app, Q).await), (435..445).rev().collect::<Vec<_>>(), "45 paragraphs have the phrase");
    }

    #[tokio::test]
    async fn near_keeps_to_the_edition_served() {
        let db = library();
        let t = test(&db, sealing, toward_coates_first, 2000, true, Some(vectors(&db, hot))).await;
        assert_eq!(ids(&db, &ask(&t.app, Q).await), [1000, 1100, 4, 301, 1, 2]);
        crate::edition::set(&t.pool.get().unwrap(), Edition::E1890).unwrap();
        assert_eq!(ids(&db, &ask(&t.app, Q).await), [4, 301, 1, 2], "Coates is not in the 1890 edition");
        assert_eq!(t.calls(), (1, 1));
    }

    #[tokio::test]
    async fn near_keeps_to_the_cleanse() {
        fn toward_other(_: &str) -> (u16, Vec<f32>) { (200, toward(&[220, 210])) }
        let db = crate::ministry::tests::cleanse_fixture();
        crate::ministry::tests::with_text(&db);
        let t = test(&db, sealing, toward_other, 2000, true, Some(vectors(&db, hot))).await;
        assert_eq!(ids(&db, &ask(&t.app, Q).await), [220, 210, 301, 1100, 1, 2, 4, 1000]);
        crate::cleanse::apply(&t.pool.get().unwrap()).unwrap();
        assert_eq!(ids(&db, &ask(&t.app, Q).await), [210, 301, 1, 2, 4], "the cleanse hides the other writings, and Coates with the 1890 edition");
    }

    #[tokio::test]
    async fn near_orders_only_the_expansions_first_candidates() {
        fn mercy() -> String { json!({ "phrases": ["mercy endureth"], "verses": [], "related": [] }).to_string() }
        fn toward_past(_: &str) -> (u16, Vec<f32>) { let mut v = vec![0.0; DIMS]; (v[0], v[1]) = (2.0, 1.0); (200, v) }
        let db = library();
        let c = rusqlite::Connection::open(&db).unwrap();
        c.execute_batch(r#"
            INSERT INTO authors VALUES ('bellett', 3, 'J. G. Bellett', 'Bellett', 1795, 1864, 1, 'pd', '');
            INSERT INTO collections VALUES ('bellett', 'papers', 0, 'Papers');
            INSERT INTO works VALUES ('bellett', 'mercy', 'papers', 0, 'Mercy', 'papers', 1, '[{"title":"Mercy","passages":[]}]');
            INSERT INTO sections VALUES ('bellett', 'mercy', 1, '{"title":"Mercy","passages":[]}', NULL, NULL);
        "#).unwrap();
        for k in 0..CANDIDATES as i64 + 5 { c.execute("INSERT INTO paras VALUES (?1, 'bellett', 'mercy', 1, ?2, 'His mercy endureth for ever.')", params![10_000 + k, k]).unwrap(); }
        crate::ministry::tests::index_words(&c);
        let last = 10_000 + CANDIDATES as i64 - 1;
        let row = move |id: i64| { let mut v = vec![0.0; DIMS]; v[if id == last + 1 { 0 } else if id == last { 1 } else { 2 }] = 1.0; v };
        let t = test(&db, mercy, toward_past, 2000, true, Some(vectors(&db, row))).await;
        assert_eq!(ids(&db, &ask(&t.app, Q).await), [last].into_iter().chain(10_000..10_009).collect::<Vec<_>>(), "the paragraph after the expansion's first 3,000 is never read");
    }

    #[test]
    fn near_refuses_a_file_that_does_not_fit() {
        let db = library();
        let ids = library_ids(&db);
        let why = |p: &Path, model: &str, ids: &[i64]| Vectors::open(p, model, ids).err().unwrap_or_default();
        let fits = write(&ids, MODEL, DIMS, hot);
        assert_eq!(why(&fits, MODEL, &ids), "");
        let hot512 = |id: i64| { let mut v = vec![0.0; 512]; v[id as usize % 512] = 1.0; v };
        let cut = write(&ids, MODEL, DIMS, hot);
        let bytes = std::fs::read(&cut).unwrap();
        std::fs::write(&cut, &bytes[..bytes.len() - 1]).unwrap();
        let not = std::env::temp_dir().join(format!("berean-vec-{}.bin", crate::auth::random_token(8)));
        std::fs::write(&not, b"SQLite format 3\0 and then some more bytes").unwrap();
        for (path, model, ids, says) in [
            (std::env::temp_dir().join("berean-vec-none.bin"), MODEL, &ids[..], "No such file"),
            (write(&ids, MODEL, 512, hot512), MODEL, &ids[..], "512 numbers a row, the server's have 1536"),
            (fits.clone(), "text-embedding-3-large", &ids[..], "made with text-embedding-3-small, the server asks text-embedding-3-large"),
            (write(&ids[1..], MODEL, DIMS, hot), MODEL, &ids[..], "made from another build of ministry.db"),
            (cut, MODEL, &ids[..], "bytes for"),
            (not, MODEL, &ids[..], "not a vector file"),
        ] {
            assert!(why(&path, model, ids).contains(says), "{}: {}", path.display(), why(&path, model, ids));
        }
    }

    #[tokio::test]
    async fn near_without_a_key_or_a_file_answers_the_expansions_order() {
        let db = library();
        for (key, file) in [(false, true), (true, false)] {
            let t = test(&db, sealing, toward_coates, 2000, key, file.then(|| vectors(&db, hot))).await;
            let v = ask(&t.app, Q).await;
            assert_eq!((v["state"].as_str(), v["by"].as_str(), ids(&db, &v)), (Some("ok"), Some("matches"), SEALING.to_vec()), "key {key}, file {file}");
            assert_eq!(t.calls(), (1, 0));
        }
    }

    #[tokio::test]
    async fn near_a_question_asked_before_makes_no_call() {
        let db = library();
        let t = test(&db, sealing, toward_coates, 2000, true, Some(vectors(&db, hot))).await;
        let first = ask(&t.app, Q).await;
        assert_eq!(ask(&t.app, "How can I be SEALED  with the Spirit??").await, first);
        assert_eq!(t.calls(), (1, 1));
        let kept: (i64, String) = t.pool.get().unwrap().query_row("SELECT count(*), max(model) FROM search_vectors WHERE q = 'how can i be sealed with the spirit'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(kept, (1, MODEL.to_string()));
        t.pool.get().unwrap().execute("UPDATE search_vectors SET model = 'text-embedding-3-large'", []).unwrap();
        assert_eq!(ask(&t.app, Q).await, first);
        assert_eq!(t.calls(), (1, 2), "a vector of another model is no vector of this file's");
    }

    #[tokio::test]
    async fn near_asks_the_embedder_for_the_question_as_asked() {
        let db = library();
        let t = test(&db, sealing, toward_coates, 2000, true, Some(vectors(&db, hot))).await;
        ask(&t.app, "  How can I be  sealed with the Spirit? ").await;
        let (headers, body) = t.embedder.lock().unwrap()[0].clone();
        assert_eq!(headers["authorization"].to_str().unwrap(), "Bearer test-embed-key");
        assert_eq!(body, json!({ "model": MODEL, "input": "How can I be sealed with the Spirit?", "encoding_format": "base64" }));
    }

    #[tokio::test]
    async fn near_an_embedding_that_fails_answers_the_expansions_order_and_is_not_kept() {
        fn down(_: &str) -> (u16, Vec<f32>) { (500, Vec::new()) }
        fn short(_: &str) -> (u16, Vec<f32>) { (200, vec![1.0; 512]) }
        let db = library();
        for embed in [down as Embed, short] {
            let t = test(&db, sealing, embed, 2000, true, Some(vectors(&db, hot))).await;
            for _ in 0..2 {
                let v = ask(&t.app, Q).await;
                assert_eq!((v["state"].as_str(), v["by"].as_str(), ids(&db, &v)), (Some("ok"), Some("matches"), SEALING.to_vec()));
            }
            let c = t.pool.get().unwrap();
            let (kept, calls): (i64, i64) = (c.query_row("SELECT count(*) FROM search_vectors", [], |r| r.get(0)).unwrap(), c.query_row("SELECT sum(calls) FROM search_expansion_calls", [], |r| r.get(0)).unwrap());
            assert_eq!((t.calls(), kept, calls), ((1, 2), 0, 3), "each try is one of the day's calls");
        }
    }

    /// The two calls of a new question are made together, the expansion's place in the day's calls taken first: with
    /// one call left it is the expansion that is made, however slow its model, and the paragraphs come in its order.
    #[tokio::test]
    async fn near_an_embedding_takes_one_of_the_days_calls_before_it_is_made() {
        let db = library();
        let slow = Slow { model: std::time::Duration::from_millis(200), ..Default::default() };
        let one = test_with(&db, sealing, toward_coates, 1, true, Some(vectors(&db, hot)), slow).await;
        let v = ask(&one.app, Q).await;
        assert_eq!((v["state"].as_str(), v["by"].as_str(), ids(&db, &v)), (Some("ok"), Some("matches"), SEALING.to_vec()));
        assert_eq!(one.calls(), (1, 0), "the expansion took the day's one call");
        let two = test(&db, sealing, toward_coates, 2, true, Some(vectors(&db, hot))).await;
        assert_eq!(ask(&two.app, Q).await["by"], "meaning");
        let next = ask(&two.app, "what is the sealing of the Spirit").await;
        assert_eq!((next["state"].as_str(), next["items"].as_array().map(Vec::len), two.calls()), (Some("busy"), Some(0), (1, 1)));
    }

    /// The last call of a day goes to the expansion of the next new question: its embedding, made beside it on any
    /// other day, is not made, and the answer is in the expansion's order.
    #[tokio::test]
    async fn near_the_days_last_call_is_the_expansions() {
        let db = library();
        let t = test(&db, sealing, toward_coates, 3, true, Some(vectors(&db, hot))).await;
        assert_eq!(ask(&t.app, Q).await["by"], "meaning");
        let last = ask(&t.app, "what is the sealing of the Spirit").await;
        assert_eq!((last["state"].as_str(), last["by"].as_str(), ids(&db, &last)), (Some("ok"), Some("matches"), SEALING.to_vec()));
        let taken: i64 = t.pool.get().unwrap().query_row("SELECT sum(calls) FROM search_expansion_calls", [], |r| r.get(0)).unwrap();
        assert_eq!((t.calls(), taken), ((2, 1), 3));
    }

    /// A new question's embedding is asked for while its expansion is: the embedder has the call before the model has
    /// answered.
    #[tokio::test]
    async fn near_asks_for_a_new_questions_embedding_while_its_expansion_is_asked_for() {
        let db = library();
        let slow = Slow { model: std::time::Duration::from_millis(600), ..Default::default() };
        let t = test_with(&db, sealing, toward_coates, 2000, true, Some(vectors(&db, hot)), slow.clone()).await;
        let app = t.app.clone();
        let asking = tokio::spawn(async move { ask(&app, Q).await });
        slow.embedder_called.notified().await;
        assert_eq!(t.model.lock().unwrap().len(), 0, "the embedding waited for the expansion's answer");
        let v = asking.await.unwrap();
        assert_eq!((v["by"].as_str(), ids(&db, &v), t.calls()), (Some("meaning"), vec![1000, 4, 1100, 2, 301, 1], (1, 1)));
    }

    /// The embedding made beside an expansion that then finds nothing is one of the day's calls and is kept, so the
    /// same question makes it once.
    #[tokio::test]
    async fn near_a_question_whose_expansion_finds_nothing_makes_its_embedding_call_once() {
        fn nothing() -> String { json!({ "phrases": ["free bitcoin"], "verses": ["Jude 20"], "related": ["the Spirit sealed"] }).to_string() }
        let db = library();
        let t = test(&db, nothing, toward_coates, 2000, true, Some(vectors(&db, hot))).await;
        for _ in 0..2 { assert_eq!(ask(&t.app, Q).await, json!({ "q": "how can i be sealed with the spirit", "state": "ok", "by": "matches", "items": [] }), "a related subject is no candidate") }
        let c = t.pool.get().unwrap();
        let (kept, taken): (i64, i64) = (c.query_row("SELECT count(*) FROM search_vectors WHERE q = 'how can i be sealed with the spirit'", [], |r| r.get(0)).unwrap(), c.query_row("SELECT sum(calls) FROM search_expansion_calls", [], |r| r.get(0)).unwrap());
        assert_eq!((t.calls(), kept, taken), ((1, 1), 1, 2));
    }

    /// And beside an expansion whose model gave nothing to keep: the question is busy, its vector is kept, and the next
    /// ask makes the expansion's call alone.
    #[tokio::test]
    async fn near_an_expansion_that_fails_keeps_the_embedding_made_beside_it() {
        fn prose() -> String { "Here are some phrases: sealed with the Spirit.".to_string() }
        let db = library();
        let t = test(&db, prose, toward_coates, 2000, true, Some(vectors(&db, hot))).await;
        for calls in [(1, 1), (2, 1)] {
            let v = ask(&t.app, Q).await;
            assert_eq!((v["state"].as_str(), v["items"].as_array().map(Vec::len), t.calls()), (Some("busy"), Some(0), calls));
        }
        let kept: i64 = t.pool.get().unwrap().query_row("SELECT count(*) FROM search_vectors", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, 1);
    }

    #[tokio::test]
    async fn near_is_off_without_the_expansion_and_asks_nothing_for_a_short_question() {
        let db = library();
        let (url, model, embedder) = stand_in(sealing, toward_coates, Slow::default()).await;
        let near = Config { key: Some("test-embed-key".into()), model: MODEL.into(), url: url.clone(), vectors: Some(Arc::new(vectors(&db, hot))) };
        let (app, _) = app_with_near(&db, crate::expand::Config { key: None, model: "claude-haiku-5-5".into(), daily: 2000, url }, near);
        assert_eq!(ask(&app, Q).await, json!({ "q": "how can i be sealed with the spirit", "state": "off", "by": "matches", "items": [] }));
        let t = test(&db, sealing, toward_coates, 2000, true, Some(vectors(&db, hot))).await;
        assert_eq!(ask(&t.app, "sealed Spirit").await, json!({ "q": "sealed spirit", "state": "ok", "by": "matches", "items": [] }));
        assert_eq!((model.lock().unwrap().len(), embedder.lock().unwrap().len(), t.calls()), (0, 0, (0, 0)));
    }

    #[tokio::test]
    async fn near_answers_a_paragraph_as_the_words_search_lists_it_with_its_opening() {
        let db = library();
        let long = format!("{} So it is that believers are sealed with the Spirit.", "In the opening words of this paper the writer speaks of other things at length. ".repeat(4));
        let c = rusqlite::Connection::open(&db).unwrap();
        c.execute("INSERT INTO paras VALUES (312, 'darby', 'cw-text', 1, 12, ?1)", [&long]).unwrap();
        crate::ministry::tests::index_words(&c);
        let t = test(&db, sealing, toward_coates, 2000, true, Some(vectors(&db, hot))).await;
        let v = ask(&t.app, Q).await;
        assert_eq!(v["items"][4], json!({ "author": "darby", "work": { "id": "cw-text", "title": "Collected Writings 5: Sealing", "collection": "cw" }, "n": 1, "section": "Sealing", "para": 1, "snippet": "Believers are sealed with the Spirit, as Ephesians says." }));
        let opening = v["items"].as_array().unwrap().iter().find(|i| i["para"] == 12).and_then(|i| i["snippet"].as_str()).unwrap_or("").to_string();
        assert!(opening.starts_with("In the opening words") && opening.ends_with('…') && !opening.contains("sealed"), "{opening}");
    }

    /// Asks `path` for Q while the test switches the edition to 1890 as soon as `called` says the slow stand-in has the call.
    async fn ask_while_1890_comes(t: &Test, path: &str, called: &tokio::sync::Notify) -> Value {
        let app = t.app.clone();
        let uri = format!("/ministry/{path}?q={}", Q.replace(' ', "%20"));
        let asking = tokio::spawn(async move { call(&app, "GET", &uri, None, Value::Null).await });
        called.notified().await;
        crate::edition::set(&t.pool.get().unwrap(), Edition::E1890).unwrap();
        let (st, v) = asking.await.unwrap();
        assert_eq!(st, 200, "{v}");
        v
    }

    #[tokio::test]
    async fn expand_and_passages_count_in_the_edition_served_once_the_model_has_answered() {
        let db = library();
        let mut answered = Vec::new();
        for path in ["expand", "passages"] {
            let slow = Slow { model: std::time::Duration::from_millis(400), ..Default::default() };
            let t = test_with(&db, sealing, toward_coates_first, 2000, true, Some(vectors(&db, hot)), slow.clone()).await;
            answered.push(ask_while_1890_comes(&t, path, &slow.model_called).await);
        }
        let expand_1890 = json!({ "q": "how can i be sealed with the spirit", "state": "ok", "phrases": [{ "text": "sealed with the Spirit", "total": 1 }],
            "verses": [{ "book": 43, "chapter": 3, "verse": 16, "total": 3 }], "related": [{ "text": "the Spirit sealed", "total": 3 }] });
        assert_eq!((&answered[0], answered[1]["by"].as_str(), ids(&db, &answered[1])), (&expand_1890, Some("meaning"), vec![4, 301, 1, 2]), "counted and ordered in 1890, without Coates");
    }

    #[tokio::test]
    async fn near_answers_in_the_edition_served_once_the_embedder_has_answered() {
        let db = library();
        let slow = Slow { embedder: std::time::Duration::from_millis(400), ..Default::default() };
        let t = test_with(&db, sealing, toward_coates_first, 2000, true, Some(vectors(&db, hot)), slow.clone()).await;
        let v = ask_while_1890_comes(&t, "passages", &slow.embedder_called).await;
        assert_eq!((v["by"].as_str(), ids(&db, &v)), (Some("meaning"), vec![4, 301, 1, 2]), "ordered in 1890, without Coates");
    }
}
