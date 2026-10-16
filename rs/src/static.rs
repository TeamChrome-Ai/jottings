//! Embedded client bundle (dist/) with immutable caching for hashed assets, precompressed
//! brotli siblings (foo.js.br) served when the client accepts br, and SPA fallback. The shell (index.html) goes out
//! with the link-preview tags of the page asked for (og.rs).
use crate::edition::Edition;
use crate::AppState;
use axum::{body::Body, extract::{Request, State}, http::{header, HeaderMap, HeaderValue, StatusCode}, response::{IntoResponse, Response}};
use rust_embed::{Embed, EmbeddedFile};
use sha2::{Digest, Sha256};

#[derive(Embed)]
#[folder = "../client/dist/"]
struct Assets;

pub async fn serve(State(s): State<AppState>, req: Request) -> Response {
    let path = req.uri().path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    let h = req.headers();
    let accepts_br = h.get(header::ACCEPT_ENCODING).and_then(|v| v.to_str().ok()).map(|v| v.contains("br")).unwrap_or(false);
    let served = s.served().await;
    if let Some(alt) = edition_path(path, served.edition) {
        // never the 1961 file in its place: a bundle without the 1890 one has nothing to serve there; while the cleanse
        // is on, nothing under the 1961 paths may be kept anywhere
        let Some(mut res) = lookup(&alt, accepts_br, h) else { return (StatusCode::NOT_FOUND, "not found").into_response() };
        res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(if served.cleanse { "no-store" } else { "no-cache" }));
        return res;
    }
    let query = req.uri().query();
    if path == "index.html" { return shell(&s, served.edition, path, query, accepts_br, h).await; }
    if let Some(res) = lookup(path, accepts_br, h) { return res; }
    // a page still open from the version before an update asks for that version's code: kept on disk by the release
    if let Some(res) = previous(path, h) { return res; }
    // expo static export writes one html per route; a deep link to a dynamic route ([book]/[chapter]) falls back to the shell
    if !path.contains('.') {
        if let Some(res) = lookup(&format!("{path}.html"), accepts_br, h) { return res; }
        return shell(&s, served.edition, path, query, accepts_br, h).await;
    }
    (StatusCode::NOT_FOUND, "not found").into_response()
}

/// The shell with the link-preview tags of `path` in its head (og.rs): the same page for every client, a crawler or
/// not. It differs by path, so it is built per request and sent as it is (4 KB; the response layer compresses it):
/// no-cache like the shell file, with a validator of the bytes sent, so nothing answers one path with another's page.
/// A bundle whose shell has no head sends the file untouched.
async fn shell(s: &AppState, ed: Edition, path: &str, query: Option<&str>, accepts_br: bool, h: &HeaderMap) -> Response {
    let home = path == "index.html";
    let tags = if home { None } else { crate::og::tags(s, ed, path, query).await };
    let html = Assets::get("index.html").and_then(|f| crate::og::render(std::str::from_utf8(&f.data).ok()?, tags.as_ref(), home));
    let Some(html) = html else { return lookup("index.html", accepts_br, h).unwrap_or_else(|| (StatusCode::NOT_FOUND, "not found").into_response()) };
    let hash = Sha256::digest(html.as_bytes());
    let mut res = respond("index.html", Body::from(html), &hash, false, false, h);
    res.headers_mut().insert(header::VARY, HeaderValue::from_static("Accept-Encoding"));
    res
}

/// What the 1890 edition serves in place of a 1961 file (docs/EDITION.md): the chapters and archive under bible/ come
/// from bible1890/ (the client asks for bible1890/ itself; this is for anything that still asks for the old paths), the
/// credits page from credits-1890.html. Answered with no-cache, so a switch back is seen at once.
fn edition_path(path: &str, ed: Edition) -> Option<String> {
    if ed != Edition::E1890 { return None }
    if let Some(rest) = path.strip_prefix("bible/") { return Some(format!("bible1890/{rest}")) }
    matches!(path, "credits.html" | "credits").then(|| "credits-1890.html".to_string())
}

/// Where the release keeps the previous version's code (tools/release-*.sh `keep_previous`): an update replaces every
/// hashed file, and a page left open from before it would otherwise find the screens it has not loaded yet gone. The
/// client reloads into the new version when one is missing all the same (client/src/lib/staleBuild.ts).
pub fn previous_dir() -> std::path::PathBuf { std::path::PathBuf::from(std::env::var("BEREAN_DATA").unwrap_or_else(|_| "data".into())).join("web-previous") }

/// The previous version's copy of a hashed file under _expo/static/, when the release kept one.
fn previous(path: &str, h: &HeaderMap) -> Option<Response> {
    if !path.starts_with("_expo/static/") || path.split('/').any(|p| p == ".." || p.is_empty()) { return None }
    let bytes = std::fs::read(previous_dir().join(path)).ok()?;
    let hash = Sha256::digest(&bytes);
    Some(respond(path, Body::from(bytes), &hash, true, false, h))
}

fn lookup(path: &str, accepts_br: bool, h: &HeaderMap) -> Option<Response> {
    // expo export hashes everything under _expo/ and assets/; chapter bundles only change with a data rebuild; a
    // changed face in fonts/ takes a new file name (client/src/lib/appFonts.web.ts)
    let immutable = path.starts_with("_expo/") || path.starts_with("assets/") || path.starts_with("bible/") || path.starts_with("bible1890/") || path.starts_with("fonts/");
    if accepts_br {
        if let Some(f) = Assets::get(&format!("{path}.br")) { return Some(file_response(path, f, immutable, true, h)); }
    }
    let f = Assets::get(path)?;
    Some(file_response(path, f, immutable, false, h))
}

fn file_response(path: &str, f: EmbeddedFile, immutable: bool, br: bool, h: &HeaderMap) -> Response {
    let hash = f.metadata.sha256_hash();
    // the embedded bytes are 'static: hand them to the body without a per-request copy
    respond(path, Body::from(f.data), &hash, immutable, br, h)
}

/// `body` as the file at `path`, or 304 when the client holds it (`hash`: SHA-256 of the bytes).
fn respond(path: &str, body: Body, hash: &[u8], immutable: bool, br: bool, h: &HeaderMap) -> Response {
    let cc = if immutable { "public, max-age=31536000, immutable" } else if path.ends_with("sw.js") || path.ends_with(".html") { "no-cache" } else { "public, max-age=3600" };
    // weak: the compression layer may gzip the identity variant on the way out, so the bytes are not guaranteed
    let etag = format!("W/\"{}\"", hash[..12].iter().map(|b| format!("{b:02x}")).collect::<String>());
    let fresh = h.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(',').any(|t| { let t = t.trim(); t == "*" || t.trim_start_matches("W/") == &etag[2..] }));
    let mut res = if fresh { let mut r = Response::new(Body::empty()); *r.status_mut() = StatusCode::NOT_MODIFIED; r } else { Response::new(body) };
    let hs = res.headers_mut();
    if !fresh {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        hs.insert(header::CONTENT_TYPE, HeaderValue::from_str(mime.as_ref()).unwrap());
        if br { hs.insert(header::CONTENT_ENCODING, HeaderValue::from_static("br")); }
    }
    if br { hs.insert(header::VARY, HeaderValue::from_static("Accept-Encoding")); }
    hs.insert(header::ETAG, HeaderValue::from_str(&etag).unwrap());
    hs.insert(header::CACHE_CONTROL, HeaderValue::from_static(cc));
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_1890_edition_serves_its_own_chapters_and_credits() {
        assert_eq!(edition_path("bible/43/3.json", Edition::E1890).as_deref(), Some("bible1890/43/3.json"));
        assert_eq!(edition_path("bible/all.json", Edition::E1890).as_deref(), Some("bible1890/all.json"));
        assert_eq!(edition_path("credits.html", Edition::E1890).as_deref(), Some("credits-1890.html"));
        assert_eq!(edition_path("credits", Edition::E1890).as_deref(), Some("credits-1890.html"));
        for p in ["bible/43/3.json", "credits.html", "index.html"] { assert_eq!(edition_path(p, Edition::E1961), None, "{p}") }
        for p in ["bible1890/43/3.json", "index.html", "privacy.html", "_expo/static/js/x.js"] { assert_eq!(edition_path(p, Edition::E1890), None, "{p}") }
    }

    // ---- the shell's link-preview tags (og.rs), through the site as main.rs mounts it; client/dist must be built ----
    use crate::og::esc;
    use crate::testkit::{call, fetch, site, user};
    use serde_json::{json, Value};

    /// The site's address, and an address on it.
    fn site_url(path: &str) -> String { format!("{}{path}", crate::brand::get().site) }
    fn embedded(path: &str) -> String { String::from_utf8(Assets::get(path).expect("client/dist is not built").data.into_owned()).unwrap() }
    async fn html(app: &axum::Router, uri: &str) -> String { let (st, _, body) = fetch(app, uri, &[]).await; assert_eq!(st, 200, "{uri}"); String::from_utf8(body).unwrap() }
    fn tag<'a>(html: &'a str, key: &str) -> Option<&'a str> {
        let open = format!("<meta {}=\"{key}\" content=\"", if key.starts_with("og:") { "property" } else { "name" });
        let at = html.find(&open)? + open.len();
        Some(&html[at..at + html[at..].find('"')?])
    }
    /// Romans 11 and Jude from the seed (data/scripture.db), as a server holds them.
    fn scripture(pool: &crate::db::DbPool) {
        let seed = crate::testkit::seed();
        pool.get().unwrap().execute_batch(&format!("ATTACH DATABASE '{seed}' AS seed KEY ''; INSERT INTO verses (id, book, chapter, verse, text) SELECT id, book, chapter, verse, text FROM seed.verses WHERE (book=45 AND chapter=11) OR book=65; DETACH DATABASE seed;")).expect("data/scripture.db");
    }
    fn verse(pool: &crate::db::DbPool, v: i64) -> String { pool.get().unwrap().query_row("SELECT text FROM verses WHERE book=45 AND chapter=11 AND verse=?1", [v], |r| r.get(0)).unwrap() }
    async fn jotting(app: &axum::Router, token: &str, meta: Value, items: Value) -> (i64, String) {
        let (_, o) = call(app, "POST", "/api/outlines", Some(token), meta).await;
        let id = o["id"].as_i64().unwrap();
        call(app, "PUT", &format!("/api/outlines/{id}/items"), Some(token), json!({ "items": items })).await;
        let (st, o) = call(app, "PATCH", &format!("/api/outlines/{id}"), Some(token), json!({ "visibility": "link" })).await;
        assert_eq!(st, 200);
        (id, o["share_code"].as_str().unwrap().to_string())
    }

    #[tokio::test]
    async fn a_verse_link_says_the_reference_and_the_words() {
        let (app, pool) = site();
        scripture(&pool);
        let page = html(&app, "/read/45/11?v=33").await;
        let words = verse(&pool, 33);
        assert!(words.starts_with("O depth of riches both of [the] wisdom and knowledge of God!"), "{words}");
        assert_eq!((tag(&page, "og:title"), tag(&page, "twitter:title")), (Some("Romans 11:33"), Some("Romans 11:33")));
        assert_eq!((tag(&page, "og:description"), tag(&page, "twitter:description"), tag(&page, "description")), (Some(words.as_str()), Some(words.as_str()), Some(words.as_str())));
        assert!(page.contains("<title>Romans 11:33</title>"));
        assert_eq!((tag(&page, "og:url"), tag(&page, "og:type"), tag(&page, "og:site_name"), tag(&page, "twitter:card")), (Some(site_url("/read/45/11?v=33").as_str()), Some("website"), Some(crate::brand::get().name.as_str()), Some("summary_large_image")));
        assert_eq!((tag(&page, "og:image"), tag(&page, "og:image:width"), tag(&page, "og:image:height"), tag(&page, "twitter:image")), (Some(site_url("/og.png").as_str()), Some("1024"), Some("500"), Some(site_url("/og.png").as_str())));
        // several verses: joined, cut at a word; the address keeps the verses and nothing else of the query
        let page = html(&app, "/read/45/11?utm_source=x&v=33&v2=36").await;
        let said = tag(&page, "og:description").unwrap();
        assert_eq!((tag(&page, "og:title"), tag(&page, "og:url")), (Some("Romans 11:33-36"), Some(site_url("/read/45/11?v=33&amp;v2=36").as_str())));
        assert!(said.starts_with(&format!("{} {}", words, verse(&pool, 34))) && said.ends_with('…') && said.chars().count() <= 300 && said.chars().count() > 250, "{said}");
        // the chapter: how it opens
        let page = html(&app, "/read/45/11").await;
        assert_eq!((tag(&page, "og:title"), tag(&page, "og:url")), (Some("Romans 11"), Some(site_url("/read/45/11").as_str())));
        let said = tag(&page, "og:description").unwrap();
        assert!(said.starts_with(&esc(&format!("{} {}", verse(&pool, 1), verse(&pool, 2)))[..200]) && said.ends_with('…') && said.chars().count() <= 300, "{said}");
        assert!(said.starts_with("I say then, Has God cast away his people?"));
        // a book of one chapter is named as the app names it
        assert_eq!(tag(&html(&app, "/read/65/1?v=3").await, "og:title"), Some("Jude 3"));
    }

    #[tokio::test]
    async fn what_is_not_there_gets_the_generic_tags_and_nothing_of_the_path() {
        let (app, pool) = site();
        scripture(&pool);
        let shell = embedded("index.html");
        let generic = html(&app, "/friends").await;
        let b = crate::brand::get();
        assert_eq!((tag(&generic, "og:title"), tag(&generic, "og:url")), (Some(b.store_name.as_str()), None));
        assert!(generic.contains(&format!("<title>{}</title>", b.store_name)));
        let own = tag(&shell, "description").unwrap();
        assert!(own.starts_with(&format!("{}: Darby", b.name)) && generic.contains(&format!("<meta name=\"description\" content=\"{own}\" />")), "the shell's own description stays");
        assert_eq!(tag(&generic, "og:description").map(crate::og::unesc), Some(crate::og::unesc(own)));
        assert_eq!(tag(&generic, "og:image"), Some(site_url("/og.png").as_str()));
        // a book, chapter or verse there is not; every other page of the app; a profile: all the same bytes
        for uri in ["/read/99/1", "/read/45/999", "/read/45/11?v=999", "/read/45/11?v=33&v2=999", "/read/45/11?v=36&v2=33", "/read/1/1", "/u/anna", "/outlines/3", "/jottings/3", "/groups/romans", "/friends/add/Ab3dE6", "/o/nosuchcode1", "/no/such/page?x=%22%3E%3Cscript%3E"] {
            assert_eq!(html(&app, uri).await, generic, "{uri}");
        }
        // the home page is the same with its address
        let home = html(&app, "/").await;
        assert_eq!(tag(&home, "og:url"), Some(site_url("/").as_str()));
        assert_eq!(home.replace(&format!("    <meta property=\"og:url\" content=\"{}\" />\n", site_url("/")), ""), generic);
        assert_eq!(html(&app, "/index.html").await, home);
        // from </head> on, the shell's own bytes; before it, the shell's head and then the tags
        for page in [&generic, &home, &html(&app, "/read/45/11?v=33").await] { assert_eq!(page.split_once("</head>").unwrap().1, shell.split_once("</head>").unwrap().1); }
        assert!(generic.starts_with(shell.split_once("</head>").unwrap().0));
        // a database that cannot answer: the generic tags, not a failed page
        pool.get().unwrap().execute_batch("DROP TABLE verses_fts; DROP TABLE verses_tri; DROP TABLE verses;").unwrap();
        assert_eq!(html(&app, "/read/45/11?v=33").await, generic);
    }

    #[tokio::test]
    async fn a_jotting_shared_by_link_says_its_title_and_never_whose_it_is() {
        let (app, pool) = site();
        let (_, zeb) = user(&pool, "zebedee");
        let generic = html(&app, "/friends").await;
        // what a shared one is called when it says nothing more of itself: "<A noun> on <the app>"
        let what = format!("{} on {}", crate::brand::get().noun.a_cap, crate::brand::get().name);
        // its description; else its first note; else the verses it gathers; else what it is
        let (id, code) = jotting(&app, &zeb, json!({ "title": "Grace \"abounding\" <now> & then", "description": "Notes for\nTuesday's  reading" }), json!([{ "kind": "note", "text": "a note" }])).await;
        let page = html(&app, &format!("/o/{code}")).await;
        assert_eq!(tag(&page, "og:title"), Some("Grace &quot;abounding&quot; &lt;now&gt; &amp; then"));
        assert!(page.contains("<title>Grace &quot;abounding&quot; &lt;now&gt; &amp; then</title>") && !page.contains("<now>"));
        assert_eq!((tag(&page, "og:description"), tag(&page, "description")), (Some(format!("{what}: Notes for Tuesday&#39;s reading").as_str()), Some(format!("{what}: Notes for Tuesday&#39;s reading").as_str())));
        assert_eq!(tag(&page, "og:url"), Some(site_url(&format!("/o/{code}")).as_str()));
        assert!(!page.to_lowercase().contains("zebedee"), "no handle, no name");
        let (_, noted) = jotting(&app, &zeb, json!({ "title": "Noted" }), json!([{ "kind": "heading", "text": "A heading" }, { "kind": "verse", "book": 43, "chapter": 3, "v1": 16 }, { "kind": "note", "text": "  " }, { "kind": "note", "text": format!("First words. {}", "more ".repeat(80)) }])).await;
        let said = tag(&html(&app, &format!("/o/{noted}")).await, "og:description").unwrap().to_string();
        assert!(said.starts_with(&format!("{what}: First words. more more")) && said.ends_with("more…") && said.chars().count() <= 200, "{said}");
        let (_, verses) = jotting(&app, &zeb, json!({ "title": "Verses" }), json!([{ "kind": "verse", "book": 43, "chapter": 3, "v1": 16 }, { "kind": "verse", "book": 45, "chapter": 5, "v1": 8, "v2": 10 }, { "kind": "verse", "book": 19, "chapter": 23 }, { "kind": "link", "url": "https://example.org/", "text": "a link" }])).await;
        assert_eq!(tag(&html(&app, &format!("/o/{verses}")).await, "og:description"), Some(format!("{what}: John 3:16; Romans 5:8-10; Psalms 23").as_str()));
        let (_, bare) = jotting(&app, &zeb, json!({ "title": "Bare" }), json!([])).await;
        assert_eq!(tag(&html(&app, &format!("/o/{bare}")).await, "og:description"), Some(what.as_str()));
        // one published before the public list was withdrawn reads as a link one
        pool.get().unwrap().execute("UPDATE outlines SET visibility='public' WHERE id=?1", [id]).unwrap();
        assert_eq!(html(&app, &format!("/o/{code}")).await, page);
        // hidden by moderation, made private again, or a code there is not: the same bytes as any other page
        pool.get().unwrap().execute("UPDATE outlines SET visibility='link', hidden=1 WHERE id=?1", [id]).unwrap();
        let hidden = html(&app, &format!("/o/{code}")).await;
        pool.get().unwrap().execute("UPDATE outlines SET hidden=0 WHERE id=?1", [id]).unwrap();
        assert_eq!(html(&app, &format!("/o/{code}")).await, page, "shown again");
        assert_eq!(call(&app, "PATCH", &format!("/api/outlines/{id}"), Some(&zeb), json!({ "visibility": "private" })).await.0, 200);
        let private = html(&app, &format!("/o/{code}")).await;
        let unknown = html(&app, "/o/Zz9Zz9Zz9Z").await;
        assert!(hidden == generic && private == generic && unknown == generic);
        assert!(!private.contains("Grace") && !private.contains(&code));
        // the owner's own session changes nothing: a preview is what anyone with the link sees
        let (st, _, body) = fetch(&app, &format!("/o/{code}"), &[("authorization", &format!("Bearer {zeb}"))]).await;
        assert_eq!((st, String::from_utf8(body).unwrap()), (200, generic));
    }

    #[test]
    fn a_file_of_the_previous_version_is_served_from_where_the_release_kept_it() {
        // BEREAN_DATA is the process's; the file is put where previous_dir() points and removed after
        let dir = previous_dir().join("_expo/static/js/web");
        std::fs::create_dir_all(&dir).unwrap();
        let name = format!("old-{}.js", crate::auth::random_token(6));
        std::fs::write(dir.join(&name), b"old code").unwrap();
        let h = HeaderMap::new();
        let res = previous(&format!("_expo/static/js/web/{name}"), &h).expect("kept file served");
        assert_eq!(res.status(), StatusCode::OK);
        assert!(res.headers()[header::CACHE_CONTROL].to_str().unwrap().contains("immutable"));
        assert!(previous("_expo/static/js/web/none-here.js", &h).is_none());
        assert!(previous("_expo/static/../../secret", &h).is_none(), "nothing outside the folder");
        assert!(previous("index.html", &h).is_none(), "only the hashed code");
        std::fs::remove_file(dir.join(&name)).unwrap();
    }
    #[tokio::test]
    async fn the_shell_keeps_its_cache_rules_and_other_pages_are_untouched() {
        let (app, pool) = site();
        scripture(&pool);
        let header = |h: &axum::http::HeaderMap, k: &str| h.get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        let mut etags: Vec<String> = Vec::new();
        for uri in ["/", "/friends", "/read/45/11", "/read/45/11?v=33"] {
            let (st, h, body) = fetch(&app, uri, &[("accept-encoding", "br, gzip")]).await;
            assert_eq!((st, header(&h, "cache-control").as_str(), header(&h, "content-type").as_str(), header(&h, "content-encoding").as_str(), header(&h, "vary").as_str()), (200, "no-cache", "text/html", "", "Accept-Encoding"), "{uri}");
            assert!(String::from_utf8(body).unwrap().contains("og:title"));
            // revalidation: the validator is of the bytes sent, so it answers for this path only
            let etag = header(&h, "etag");
            let (st, h2, body) = fetch(&app, uri, &[("if-none-match", &etag)]).await;
            assert_eq!((st, body.len(), header(&h2, "etag") == etag, header(&h2, "cache-control").as_str()), (304, 0, true, "no-cache"), "{uri}");
            etags.push(etag);
        }
        assert_eq!(fetch(&app, "/read/45/11", &[("if-none-match", &etags[1])]).await.0, 200, "another page's validator is not this one's");
        etags.sort(); etags.dedup();
        assert_eq!(etags.len(), 4, "a page of its own has a validator of its own");
        // the other pages of the bundle go out as the files they are
        for (uri, file) in [("/privacy", "privacy.html"), ("/privacy.html", "privacy.html"), ("/terms", "terms.html"), ("/credits", "credits.html")] {
            let (st, h, body) = fetch(&app, uri, &[]).await;
            assert_eq!((st, header(&h, "cache-control").as_str()), (200, "no-cache"), "{uri}");
            assert!(body == embedded(file).into_bytes() && !embedded(file).contains("og:title"), "{uri}");
        }
        let (st, h, body) = fetch(&app, "/privacy", &[("accept-encoding", "br")]).await;
        assert_eq!((st, header(&h, "content-encoding").as_str(), body == Assets::get("privacy.html.br").unwrap().data.into_owned()), (200, "br", true));
        assert_eq!(fetch(&app, "/no-such-file.png", &[]).await.0, 404);
        assert_eq!(fetch(&app, "/api/no-such", &[]).await.0, 404);
    }
}
