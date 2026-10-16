//! The edition the app serves (docs/EDITION.md): "1961", the default, or "1890", the fallback built only from material
//! that needs no one's permission. The choice lives in `meta` (key `edition`) of the user database, so `berean edition
//! set …` switches a running server: every request reads it through `Cache`, at most `TTL` old. Nothing is rewritten by a
//! switch: the reader's stored path, a group's path and a phone's downloads stay as they were, and switching back
//! restores everything.
use crate::AppState;
use axum::{extract::{Request, State}, http::{header, HeaderValue}, middleware::Next, response::Response};
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Edition { E1961, E1890 }
impl Edition {
    pub fn as_str(self) -> &'static str { match self { Edition::E1961 => "1961", Edition::E1890 => "1890" } }
    pub fn parse(s: &str) -> Option<Edition> { match s.trim() { "1961" => Some(Edition::E1961), "1890" => Some(Edition::E1890), _ => None } }
}
pub const DEFAULT: Edition = Edition::E1961;
/// How long a server may serve the edition it last read.
pub const TTL: Duration = Duration::from_secs(10);

pub fn get(conn: &Connection) -> Edition {
    conn.query_row("SELECT value FROM meta WHERE key='edition'", [], |r| r.get::<_, String>(0)).optional().ok().flatten().and_then(|v| Edition::parse(&v)).unwrap_or(DEFAULT)
}
pub fn set(conn: &Connection, ed: Edition) -> rusqlite::Result<()> {
    conn.execute("INSERT INTO meta (key, value) VALUES ('edition', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![ed.as_str()]).map(|_| ())
}

/// What the server serves now: the edition, and whether the cleanse is on (cleanse.rs). While the cleanse is on the
/// edition is 1890 whatever the `edition` row says, so an older row can never bring the 1961 notes back under it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Served { pub edition: Edition, pub cleanse: bool }
pub fn served(conn: &Connection) -> Served {
    let cleanse = crate::cleanse::get(conn);
    Served { edition: if cleanse { Edition::E1890 } else { get(conn) }, cleanse }
}

/// The last state read, and when; a zero TTL reads the database every time (the tests flip it between requests).
pub struct Cache { ttl: Duration, at: Mutex<Option<(Instant, Served)>> }
impl Cache {
    pub fn new(ttl: Duration) -> Cache { Cache { ttl, at: Mutex::new(None) } }
    pub fn fresh(&self) -> Option<Served> { self.at.lock().ok()?.filter(|(t, _)| t.elapsed() < self.ttl).map(|(_, e)| e) }
    pub fn put(&self, e: Served) { if let Ok(mut g) = self.at.lock() { *g = Some((Instant::now(), e)) } }
}

impl AppState {
    pub async fn served(&self) -> Served {
        if let Some(e) = self.edition.fresh() { return e }
        let e = self.db(|c| Ok(served(c))).await.unwrap_or(Served { edition: DEFAULT, cleanse: false });
        self.edition.put(e);
        e
    }
    pub async fn edition(&self) -> Edition { self.served().await.edition }
    pub async fn cleanse(&self) -> bool { self.served().await.cleanse }
}

/// An author the edition leaves out everywhere: the companion, the library, its search, Ministry on a verse and the
/// offline packs. C. A. Coates, J. B. Stoney and F. E. Raven are texts of a publisher's edition
/// (client/src/lib/editionCore.ts EDITION_AUTHORS).
pub fn hides_author(ed: Edition, author: &str) -> bool { ed == Edition::E1890 && matches!(author, "coates" | "stoney" | "raven") }
/// The path a reader or a group on `id` is shown: the Coates path reads as the Synopsis path while Coates is hidden.
/// Only what is shown changes; the stored id stays.
pub fn shown_path(ed: Edition, id: &str) -> &str { if ed == Edition::E1890 && id == "coates" { "synopsis" } else { id } }

/// The scripture tables an edition reads: the 1890 notes always; the 1890 text only when the data build had
/// data/darby_1890.json (it then writes `verses_1890` and its companions), otherwise the one text both editions share.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tables { pub verses: &'static str, pub fts: &'static str, pub tri: &'static str, pub chapters: &'static str, pub words: &'static str, pub notes: &'static str }
pub const T1961: Tables = Tables { verses: "verses", fts: "verses_fts", tri: "verses_tri", chapters: "chapters", words: "verse_words", notes: "notes" };
const T1890_NOTES: Tables = Tables { notes: "notes_1890", ..T1961 };
const T1890_TEXT: Tables = Tables { verses: "verses_1890", fts: "verses_1890_fts", tri: "verses_1890_tri", chapters: "chapters_1890", words: "verse_words_1890", notes: "notes_1890" };
pub fn has_text_1890(conn: &Connection) -> bool {
    conn.prepare_cached("SELECT 1 FROM sqlite_master WHERE type='table' AND name='verses_1890'").and_then(|mut st| st.exists([])).unwrap_or(false)
}
pub fn tables(conn: &Connection, ed: Edition) -> Tables {
    match ed { Edition::E1961 => T1961, Edition::E1890 if has_text_1890(conn) => T1890_TEXT, Edition::E1890 => T1890_NOTES }
}

/// The introductory notices an edition shows (`GET /api/intro`, the About screen): the 1961 edition's file whole; for
/// 1890, data/notices_1890.json when there is one, else the sections of the 1961 file that are not the 1961 editors'
/// (the 1890 Old Testament extract, the 1884 New Testament extracts and the 1871 preface), without the 1961 notice and
/// the order of the prophets. client/src/lib/editionCore.ts `noticeSections` is the same rule.
pub fn intro_json(ed: Edition, intro: &str, notices_1890: Option<&str>) -> String {
    if ed == Edition::E1961 { return intro.to_string() }
    if let Some(n) = notices_1890 { return n.to_string() }
    let v: serde_json::Value = serde_json::from_str(intro).unwrap_or_default();
    let sections: Vec<&serde_json::Value> = v["sections"].as_array().into_iter().flatten().filter(|s| section_in_1890(s["title"].as_str().unwrap_or(""))).collect();
    serde_json::json!({ "sections": sections }).to_string()
}
pub fn section_in_1890(title: &str) -> bool {
    let t = title.to_lowercase();
    !t.contains("1961") && !t.starts_with("chronolog") && ["1890", "1884", "1871"].iter().any(|y| t.contains(y))
}

/// API reads whose answer depends on the edition. A client sends `ed=<edition>` with them (client/src/lib/api.ts), and
/// `cl=1` while it knows the cleanse is on; the answer keeps its cache lifetime only when that is what is served, so
/// no cache holds one state's answer under another's name. Without `ed` (an older app) it is cached a minute at most;
/// while the cleanse is on, a request that does not say so is `no-store`.
fn depends(path: &str) -> bool {
    let p = path.trim_start_matches("/api");
    p == "/ministry/offline" || (p.starts_with("/bible/") && p != "/bible/books") || p.starts_with("/search") || p.starts_with("/strongs/")
        || p == "/intro" || p == "/chronology" || p.starts_with("/companion/") || (p.starts_with("/ministry") && !p.starts_with("/ministry/offline/"))
}
pub async fn guard(State(s): State<AppState>, req: Request, next: Next) -> Response {
    let query = req.uri().query().unwrap_or("").to_string();
    let asked = depends(req.uri().path()).then(|| query.split('&').find_map(|kv| kv.strip_prefix("ed=")).map(str::to_string));
    let mut res = next.run(req).await;
    let Some(asked) = asked else { return res };
    let public = res.headers().get(header::CACHE_CONTROL).and_then(|v| v.to_str().ok()).is_some_and(|v| v.starts_with("public"));
    if !public { return res }
    let active = s.served().await;
    let cleansed = query.split('&').any(|kv| kv == "cl=1");
    let cc = match asked.as_deref() {
        _ if active.cleanse != cleansed => "no-store",
        Some(a) if a == active.edition.as_str() => return res,
        Some(_) => "no-store",
        None => "public, max-age=60",
    };
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(cc));
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::{app, call};
    use serde_json::Value;

    #[test]
    fn parses_and_names() {
        assert_eq!(Edition::parse("1890"), Some(Edition::E1890));
        assert_eq!(Edition::parse(" 1961\n"), Some(Edition::E1961));
        assert_eq!(Edition::parse("1884"), None);
        assert_eq!(Edition::E1890.as_str(), "1890");
        assert!(hides_author(Edition::E1890, "coates") && !hides_author(Edition::E1961, "coates") && !hides_author(Edition::E1890, "darby"));
        assert_eq!((shown_path(Edition::E1890, "coates"), shown_path(Edition::E1961, "coates"), shown_path(Edition::E1890, "gospels")), ("synopsis", "coates", "gospels"));
    }

    #[test]
    fn intro_keeps_only_the_pre_1961_notices_in_1890() {
        crate::testkit::texts();
        let intro = include_str!("../../data/ccel/intro.json");
        assert_eq!(intro_json(Edition::E1961, intro, None), intro);
        let v: Value = serde_json::from_str(&intro_json(Edition::E1890, intro, None)).unwrap();
        let titles: Vec<&str> = v["sections"].as_array().unwrap().iter().map(|s| s["title"].as_str().unwrap()).collect();
        assert_eq!(titles.len(), 3, "{titles:?}");
        assert!(titles.iter().all(|t| !t.contains("1961") && !t.to_lowercase().starts_with("chronolog")), "{titles:?}");
        assert!(titles[0].contains("1890") && titles[1].contains("1884") && titles[2].contains("1871"), "{titles:?}");
        assert!(v.get("source").is_none());
        // a notices file of the 1890 edition's own replaces them whole
        let own = r#"{"sections":[{"title":"Introductory notice (1890)","html":"<p>x</p>"}]}"#;
        assert_eq!(intro_json(Edition::E1890, intro, Some(own)), own);
        assert_eq!(intro_json(Edition::E1961, intro, Some(own)), intro);
    }

    #[tokio::test]
    async fn the_switch_is_read_from_the_database() {
        let (app, pool) = app();
        let (st, v) = call(&app, "GET", "/edition", None, Value::Null).await;
        assert_eq!((st, v["edition"].as_str()), (200, Some("1961")), "the default");
        set(&pool.get().unwrap(), Edition::E1890).unwrap();
        assert_eq!(get(&pool.get().unwrap()), Edition::E1890);
        assert_eq!(call(&app, "GET", "/edition", None, Value::Null).await.1["edition"], "1890");
        set(&pool.get().unwrap(), Edition::E1961).unwrap();
        assert_eq!(call(&app, "GET", "/edition", None, Value::Null).await.1["edition"], "1961");
        // a value the server does not know reads as the default
        pool.get().unwrap().execute("UPDATE meta SET value='1884' WHERE key='edition'", []).unwrap();
        assert_eq!(call(&app, "GET", "/edition", None, Value::Null).await.1["edition"], "1961");
    }

    #[test]
    fn a_cache_answers_until_its_time_is_up() {
        let c = Cache::new(Duration::from_secs(60));
        assert_eq!(c.fresh(), None);
        let on = Served { edition: Edition::E1890, cleanse: true };
        c.put(on);
        assert_eq!(c.fresh(), Some(on));
        let z = Cache::new(Duration::ZERO);
        z.put(on);
        assert_eq!(z.fresh(), None);
    }

    /// John 3:16 with a 1961 note and an 1890 note, and the user database's own path tables.
    fn scripture(pool: &crate::db::DbPool) {
        pool.get().unwrap().execute_batch("
            INSERT INTO chapters (book, chapter, words, verse_count) VALUES (43, 3, 20, 1);
            INSERT INTO verses (id, book, chapter, verse, text) VALUES (43003016, 43, 3, 16, 'For God so loved the world, that he gave his only-begotten Son');
            INSERT INTO notes (verse_id, marker, word_index, text) VALUES (43003016, 'a', 9, 'A note of the 1961 edition.');
            INSERT INTO notes_1890 (verse_id, marker, word_index, text) VALUES (43003016, 'a', 9, 'Mr. Darby''s own note.');
            INSERT INTO verses_fts(verses_fts) VALUES('rebuild'); INSERT INTO verses_tri(verses_tri) VALUES('rebuild');").unwrap();
    }
    fn flip(pool: &crate::db::DbPool, ed: Edition) { set(&pool.get().unwrap(), ed).unwrap() }
    async fn cache_control(app: &axum::Router, uri: &str) -> (u16, String) {
        use tower::ServiceExt;
        let res = app.clone().oneshot(axum::http::Request::builder().uri(uri).body(axum::body::Body::empty()).unwrap()).await.unwrap();
        (res.status().as_u16(), res.headers().get(header::CACHE_CONTROL).and_then(|v| v.to_str().ok()).unwrap_or("").to_string())
    }

    #[tokio::test]
    async fn notes_notices_and_the_table_follow_the_edition() {
        crate::testkit::texts();
        let (app, pool) = app();
        scripture(&pool);
        let note = |v: &Value| v["verses"][0]["notes"][0]["text"].as_str().map(str::to_string);
        let (st, ch) = call(&app, "GET", "/bible/43/3", None, Value::Null).await;
        assert_eq!((st, note(&ch).as_deref()), (200, Some("A note of the 1961 edition.")));
        assert_eq!(call(&app, "GET", "/intro", None, Value::Null).await.1["sections"].as_array().unwrap().len(), 5);
        assert_eq!(call(&app, "GET", "/chronology", None, Value::Null).await.0, 200);

        flip(&pool, Edition::E1890);
        let (_, ch) = call(&app, "GET", "/bible/43/3", None, Value::Null).await;
        assert_eq!(note(&ch).as_deref(), Some("Mr. Darby's own note."));
        let (_, v) = call(&app, "GET", "/bible/43/3/16", None, Value::Null).await;
        assert_eq!(v["notes"].as_array().unwrap().len(), 1);
        assert_eq!(v["notes"][0]["text"], "Mr. Darby's own note.");
        let intro = call(&app, "GET", "/intro", None, Value::Null).await.1;
        let titles: Vec<&str> = intro["sections"].as_array().unwrap().iter().map(|s| s["title"].as_str().unwrap()).collect();
        assert!(titles.len() == 3 && titles.iter().all(|t| !t.contains("1961") && !t.starts_with("Chronolog")), "{titles:?}");
        assert_eq!(call(&app, "GET", "/chronology", None, Value::Null).await.0, 404);
        // the shared text is searched either way
        assert_eq!(call(&app, "GET", "/search?q=begotten", None, Value::Null).await.1["total"], 1);

        // the 1890 text, when the data build had one: read, searched and cited from its own tables
        pool.get().unwrap().execute_batch(&format!("{}
            INSERT INTO chapters_1890 (book, chapter, words, verse_count) VALUES (43, 3, 20, 1);
            INSERT INTO verses_1890 (id, book, chapter, verse, text) VALUES (43003016, 43, 3, 16, 'For God so loved the world, that he gave his only begotten Son');
            {}", crate::db::SCHEMA_TEXT_1890, crate::db::FTS_REBUILD_1890)).unwrap();
        let (_, ch) = call(&app, "GET", "/bible/43/3", None, Value::Null).await;
        assert_eq!((ch["verses"][0]["t"].as_str().unwrap().ends_with("only begotten Son"), note(&ch).as_deref()), (true, Some("Mr. Darby's own note.")));
        assert_eq!(call(&app, "GET", "/search?q=%22only%20begotten%22", None, Value::Null).await.1["total"], 1);
        assert!(call(&app, "GET", "/search?q=jn%203:16", None, Value::Null).await.1["hits"][0]["text"].as_str().unwrap().ends_with("only begotten Son"));
        assert!(call(&app, "GET", "/bible/verses?refs=43.3.16", None, Value::Null).await.1[0]["verses"][0]["text"].as_str().unwrap().ends_with("only begotten Son"));

        // back to 1961: everything as it was
        flip(&pool, Edition::E1961);
        let (_, ch) = call(&app, "GET", "/bible/43/3", None, Value::Null).await;
        assert_eq!((ch["verses"][0]["t"].as_str().unwrap().ends_with("only-begotten Son"), note(&ch).as_deref()), (true, Some("A note of the 1961 edition.")));
        assert_eq!(call(&app, "GET", "/intro", None, Value::Null).await.1["sections"].as_array().unwrap().len(), 5);
        assert_eq!(call(&app, "GET", "/chronology", None, Value::Null).await.0, 200);
    }

    #[tokio::test]
    async fn a_cached_answer_is_kept_only_under_its_own_edition() {
        let (app, pool) = app();
        scripture(&pool);
        assert_eq!(cache_control(&app, "/bible/43/3?ed=1961").await, (200, "public, max-age=86400".into()));
        // an app that does not say which edition it means (before this build): a minute at most
        assert_eq!(cache_control(&app, "/bible/43/3").await, (200, "public, max-age=60".into()));
        flip(&pool, Edition::E1890);
        assert_eq!(cache_control(&app, "/bible/43/3?ed=1961").await, (200, "no-store".into()));
        assert_eq!(cache_control(&app, "/bible/43/3?ed=1890").await, (200, "public, max-age=86400".into()));
        assert_eq!(cache_control(&app, "/edition").await, (200, "public, max-age=60".into()));
        assert_eq!(cache_control(&app, "/bible/books?ed=1961").await, (200, "public, max-age=86400".into()));
    }

    #[tokio::test]
    async fn coates_is_hidden_from_the_library_and_comes_back() {
        let (app, pool) = crate::testkit::app_with_ministry(&crate::ministry::tests::fixture());
        let authors = |v: &Value| v["authors"].as_array().unwrap().iter().map(|a| a["id"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        let groups = |v: &Value| v["groups"].as_array().unwrap().iter().map(|a| a["author"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        let check = |shown: bool| {
            let app = app.clone();
            async move {
                let both: Vec<String> = if shown { vec!["darby".into(), "coates".into()] } else { vec!["darby".into()] };
                assert_eq!(authors(&call(&app, "GET", "/ministry", None, Value::Null).await.1), both);
                assert_eq!(authors(&call(&app, "GET", "/ministry/offline", None, Value::Null).await.1), both);
                let hits = call(&app, "GET", "/ministry/search?q=chapter", None, Value::Null).await.1;
                assert_eq!(hits["hits"].as_array().unwrap().iter().any(|h| h["author"] == "coates"), shown);
                assert_eq!(call(&app, "GET", "/ministry/chapter/45/8", None, Value::Null).await.1["verses"], if shown { serde_json::json!([28]) } else { serde_json::json!([]) });
                assert_eq!(groups(&call(&app, "GET", "/ministry/refs/45/8/28", None, Value::Null).await.1), if shown { vec!["coates".to_string()] } else { vec![] });
                let want = if shown { 200 } else { 404 };
                for uri in ["/ministry/coates/romans", "/ministry/coates/romans/1", "/ministry/refs/45/8/28?author=coates", "/ministry/offline/coates", "/ministry/offline/coates/romans"] {
                    assert_eq!(call(&app, "GET", uri, None, Value::Null).await.0, want, "{uri}");
                }
                // Darby is the same in both
                assert_eq!(groups(&call(&app, "GET", "/ministry/refs/43/3/16", None, Value::Null).await.1), ["darby"]);
                assert_eq!(call(&app, "GET", "/ministry/darby/cw-doctrinal-1/1", None, Value::Null).await.0, 200);
            }
        };
        check(true).await;
        flip(&pool, Edition::E1890);
        check(false).await;
        flip(&pool, Edition::E1961);
        check(true).await;
    }

    #[tokio::test]
    async fn the_coates_path_reads_as_the_synopsis_path_and_is_kept() {
        let (app, pool) = app();
        let (_, t) = crate::testkit::user(&pool, "anna");
        let (_, tg) = crate::testkit::user(&pool, "ben");
        assert_eq!(call(&app, "PUT", "/me/path", Some(&t), serde_json::json!({ "id": "coates" })).await.0, 200);
        let (st, g) = call(&app, "POST", "/groups", Some(&tg), serde_json::json!({ "name": "Romans readers" })).await;
        assert_eq!(st, 200, "{g}");
        let slug = g["slug"].as_str().unwrap().to_string();
        assert_eq!(call(&app, "PUT", &format!("/groups/{slug}/path"), Some(&tg), serde_json::json!({ "path_id": "coates" })).await.1["path"]["id"], "coates");

        flip(&pool, Edition::E1890);
        // no one starts it now; a reader on it keeps it, and changing the pace leaves it where it is
        let (_, t2) = crate::testkit::user(&pool, "cara");
        assert_eq!(call(&app, "PUT", "/me/path", Some(&t2), serde_json::json!({ "id": "coates" })).await.0, 400);
        assert_eq!(call(&app, "PUT", "/me/path", Some(&t), serde_json::json!({ "pace_per_week": 7 })).await.1["path"]["id"], "coates");
        // the group's members see the Synopsis path, its route and their places on it
        let (_, d) = call(&app, "GET", &format!("/groups/{slug}"), Some(&tg), Value::Null).await;
        assert_eq!((d["path"]["id"].as_str(), d["path_id"].as_str()), (Some("synopsis"), Some("synopsis")));
        // a new target for the path they see keeps the stored one and its start
        let (_, d) = call(&app, "PUT", &format!("/groups/{slug}/path"), Some(&tg), serde_json::json!({ "path_id": "synopsis", "target_date": "2027-01-01" })).await;
        assert_eq!((d["path"]["id"].as_str(), d["path"]["target_date"].as_str()), (Some("synopsis"), Some("2027-01-01")));
        let stored: String = pool.get().unwrap().query_row("SELECT path_id FROM groups WHERE slug=?1", [&slug], |r| r.get(0)).unwrap();
        assert_eq!(stored, "coates");
        assert_eq!(call(&app, "PUT", &format!("/groups/{slug}/path"), Some(&tg), serde_json::json!({ "path_id": "gospels" })).await.0, 200);
        assert_eq!(call(&app, "PUT", &format!("/groups/{slug}/path"), Some(&tg), serde_json::json!({ "path_id": "coates" })).await.0, 400);

        flip(&pool, Edition::E1961);
        assert_eq!(call(&app, "PUT", "/me/path", Some(&t2), serde_json::json!({ "id": "coates" })).await.1["path"]["id"], "coates");
        assert_eq!(call(&app, "GET", "/me/path", Some(&t), Value::Null).await.1["path"]["id"], "coates");
    }

    #[test]
    fn which_reads_depend_on_the_edition() {
        for p in ["/bible/43/3", "/bible/verses", "/search", "/strongs/G1320", "/intro", "/chronology", "/companion/darby", "/ministry", "/ministry/search", "/ministry/refs/43/3/16", "/ministry/offline", "/api/intro"] { assert!(depends(p), "{p}") }
        for p in ["/bible/books", "/ministry/offline/darby", "/ministry/offline/darby/refs", "/edition", "/me", "/stats"] { assert!(!depends(p), "{p}") }
    }
}
