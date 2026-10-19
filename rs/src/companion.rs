//! The companion beside the text, one shape for two authors: J. N. Darby's Synopsis of the Books of the Bible
//! (data/synopsis, tools/synopsis_convert.py) and C. A. Coates's Outlines and The Believer Established, the works of his
//! that are public domain in the US as well (data/coates, tools/coates_convert.py). Each author's index (works, sections and the passages each treats) is small
//! and every client reads it whole; the web fetches the text a section or a chapter's sections at a time. The files are
//! compiled in, like the dictionary.
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::{extract::{Path, State}, http::header, response::{IntoResponse, Response}, Json};
use rust_embed::{Embed, EmbeddedFile};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Embed)]
#[folder = "../data/synopsis/"]
#[include = "*.json"]
struct Darby;

#[derive(Embed)]
#[folder = "../data/coates/"]
#[include = "*.json"]
struct Coates;

struct Work { meta: Value, sections: Vec<Value> }
struct Library { index: String, order: Vec<String>, works: HashMap<String, Work> }

/// A passage `[book, fromChapter, fromVerse, toChapter, toVerse]` touches `book` `chapter`: shared/companion.ts versesIn.
fn touches(p: &Value, book: i64, chapter: i64) -> bool {
    let n = |i: usize| p.get(i).and_then(Value::as_i64).unwrap_or(0);
    n(0) == book && n(1) <= chapter && chapter <= n(3)
}

fn load(author: &str, get: fn(&str) -> Option<EmbeddedFile>) -> Library {
    let raw = get("index.json").unwrap_or_else(|| panic!("{author}: index.json"));
    let index = String::from_utf8(raw.data.into_owned()).expect("utf-8 index");
    let parsed: Value = serde_json::from_str(&index).unwrap_or_else(|e| panic!("{author}: index.json: {e}"));
    let mut order = Vec::new();
    let mut works = HashMap::new();
    for w in parsed["works"].as_array().expect("works") {
        let id = w["id"].as_str().expect("work id").to_string();
        let file = get(&format!("{id}.json")).unwrap_or_else(|| panic!("{author}: {id}.json"));
        let full: Value = serde_json::from_slice(&file.data).unwrap_or_else(|e| panic!("{author}: {id}.json: {e}"));
        let meta = json!({ "id": id, "title": w["title"], "kind": w["kind"] });
        order.push(id.clone());
        works.insert(id, Work { meta, sections: full["sections"].as_array().cloned().unwrap_or_default() });
    }
    Library { index, order, works }
}

/// The author's library, parsed on first use; None for an author we do not have.
fn library(author: &str) -> Option<&'static Library> {
    static DARBY: OnceLock<Library> = OnceLock::new();
    static COATES: OnceLock<Library> = OnceLock::new();
    match author {
        "darby" => Some(DARBY.get_or_init(|| load("darby", Darby::get))),
        "coates" => Some(COATES.get_or_init(|| load("coates", Coates::get))),
        _ => None,
    }
}
/// The books the author's walks (kind `outline`) treat, ascending: the `coates` path's route (shared/paths.ts COATES_BOOKS).
pub fn outlined_books(author: &str) -> Vec<i64> {
    let Some(lib) = library(author) else { return Vec::new() };
    let mut books: Vec<i64> = lib.order.iter().map(|id| &lib.works[id]).filter(|w| w.meta["kind"] == "outline")
        .flat_map(|w| w.sections.iter().flat_map(|s| s["passages"].as_array().into_iter().flatten().filter_map(|p| p.get(0).and_then(Value::as_i64)))).collect();
    books.sort_unstable(); books.dedup(); books
}
fn known(author: &str) -> ApiResult<&'static Library> { library(author).ok_or_else(|| ApiError::not_found("no such author")) }
/// The author, unless the edition served leaves them out (edition::hides_author): then as unknown as one never had.
async fn shown(s: &AppState, author: &str) -> ApiResult<&'static Library> {
    if crate::edition::hides_author(s.edition().await, author) { return Err(ApiError::not_found("no such author")) }
    known(author)
}

/// Every section of the author treating `book` `chapter`: the walks through a book first in reading order, then the
/// addresses (shared/companion.ts sectionsFor).
fn sections_for(author: &str, lib: &Library, book: i64, chapter: i64) -> Vec<Value> {
    let (mut outlines, mut addresses) = (Vec::new(), Vec::new());
    for id in &lib.order {
        let w = &lib.works[id];
        for (i, s) in w.sections.iter().enumerate() {
            if !s["passages"].as_array().is_some_and(|ps| ps.iter().any(|p| touches(p, book, chapter))) { continue }
            let place = json!({ "author": author, "work": w.meta, "n": i + 1, "section": s });
            if w.meta["kind"] == "addresses" { addresses.push(place) } else { outlines.push(place) }
        }
    }
    outlines.extend(addresses);
    outlines
}

fn day(mut r: Response) -> Response { r.headers_mut().insert(header::CACHE_CONTROL, "public, max-age=86400".parse().unwrap()); r }

/// `{ works: [{ id, title, kind, sections: [{ title, part?, passages }] }] }`, no text.
pub async fn index(State(s): State<AppState>, Path(author): Path<String>) -> ApiResult<Response> {
    Ok(day(([(header::CONTENT_TYPE, "application/json")], shown(&s, &author).await?.index.as_str()).into_response()))
}

/// A section as served: Darby's Synopsis under the cleanse (cleanse.rs) without its italic-only sub-headings, and its
/// quotations of Scripture from the ministry's verse index (ministry.rs `quotes_of`; the texts are the same) when the
/// server has the index.
fn served(s: &AppState, author: &str, work: &str, n: i64, section: &Value, cleanse: bool) -> Value {
    let mut sec = section.clone();
    if cleanse && author == "darby" {
        if let Some(t) = sec["text"].as_str() { sec["text"] = json!(crate::cleanse::text("synopsis", t)) }
    }
    if let Some(q) = s.ministry.as_ref().and_then(|m| m.quotes_of(author, work, n, cleanse)) { sec["quotes"] = q }
    sec
}

/// One section with its text: `{ author, work: { id, title, kind }, n, count, section }`; 404 for an unknown author,
/// work or number.
pub async fn section(State(s): State<AppState>, Path((author, work, n)): Path<(String, String, usize)>) -> ApiResult<Response> {
    let w = shown(&s, &author).await?.works.get(&work).ok_or_else(|| ApiError::not_found("no such work"))?;
    let sec = n.checked_sub(1).and_then(|i| w.sections.get(i)).ok_or_else(|| ApiError::not_found("no such section"))?;
    let sec = served(&s, &author, &work, n as i64, sec, s.cleanse().await);
    Ok(day(Json(json!({ "author": author, "work": w.meta, "n": n, "count": w.sections.len(), "section": sec })).into_response()))
}

/// The author's sections treating one chapter, with their text: `[{ author, work, n, section }]`, `[]` when there are
/// none; 404 for an unknown author or a chapter the Bible does not have.
pub async fn passage(State(s): State<AppState>, Path((author, book, chapter)): Path<(String, i64, i64)>) -> ApiResult<Response> {
    let lib = shown(&s, &author).await?;
    let b = crate::books::book(book).ok_or_else(|| ApiError::not_found("no such book"))?;
    if chapter < 1 || chapter > b.chapters as i64 { return Err(ApiError::not_found("no such chapter")) }
    let cleanse = s.cleanse().await;
    let mut places = sections_for(&author, lib, book, chapter);
    for p in &mut places {
        let (work, n) = (p["work"]["id"].as_str().unwrap_or("").to_string(), p["n"].as_i64().unwrap_or(0));
        p["section"] = served(&s, &author, &work, n, &p["section"], cleanse);
    }
    Ok(day(Json(places).into_response()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::{app, call};
    use serde_json::Value;

    #[test]
    fn indexes_and_works_agree() {
        for author in ["darby", "coates"] {
            let lib = library(author).unwrap();
            let index: Value = serde_json::from_str(&lib.index).unwrap();
            for w in index["works"].as_array().unwrap() {
                let full = &lib.works[w["id"].as_str().unwrap()];
                let metas = w["sections"].as_array().unwrap();
                assert_eq!(metas.len(), full.sections.len(), "{author} {}", w["id"]);
                for (m, s) in metas.iter().zip(&full.sections) {
                    assert_eq!(m["title"], s["title"], "{author}");
                    assert_eq!(m["passages"], s["passages"], "{author} {}", m["title"]);
                    assert!(s["text"].as_str().is_some_and(|t| !t.is_empty()), "{author} {} {}", w["id"], s["title"]);
                    for p in m["passages"].as_array().unwrap() {
                        let b = crate::books::book(p[0].as_i64().unwrap()).expect("book");
                        let (c1, c2) = (p[1].as_i64().unwrap(), p[3].as_i64().unwrap());
                        assert!(1 <= c1 && c1 <= c2 && c2 <= b.chapters as i64, "{author} {} {}: {p}", w["id"], m["title"]);
                    }
                }
            }
        }
        assert!(library("kelly").is_none());
    }

    #[tokio::test]
    async fn endpoints() {
        crate::testkit::texts();
        let (app, _pool) = app();
        for author in ["darby", "coates"] {
            let (st, idx) = call(&app, "GET", &format!("/companion/{author}"), None, Value::Null).await;
            assert_eq!(st, 200, "{author}");
            let works = idx["works"].as_array().unwrap();
            assert!(works.iter().all(|w| w["sections"][0].get("text").is_none()), "{author}: the index carries no text");
            // Genesis 1: a section of each author's walk through Genesis, and that section by its number
            let (st, g1) = call(&app, "GET", &format!("/companion/{author}/passage/1/1"), None, Value::Null).await;
            assert_eq!(st, 200);
            let first = &g1[0];
            assert_eq!(first["author"], author);
            assert_eq!(first["work"]["kind"], "outline", "{author}: {first}");
            let (st, s) = call(&app, "GET", &format!("/companion/{author}/{}/{}", first["work"]["id"].as_str().unwrap(), first["n"]), None, Value::Null).await;
            assert_eq!(st, 200);
            assert_eq!(s["section"]["text"], first["section"]["text"]);
            assert_eq!(s["count"], works.iter().find(|w| w["id"] == first["work"]["id"]).unwrap()["sections"].as_array().unwrap().len());
        }
        // Coates on Genesis 1 is chapter 1 of his Outline; on Romans 15 the Outline comes before the address on 15:13
        let (_, g1) = call(&app, "GET", "/companion/coates/passage/1/1", None, Value::Null).await;
        assert_eq!(g1[0]["work"]["id"], "genesis");
        assert!(g1[0]["section"]["text"].as_str().unwrap().contains("In the beginning"));
        let (_, rom15) = call(&app, "GET", "/companion/coates/passage/45/15", None, Value::Null).await;
        let kinds: Vec<&str> = rom15.as_array().unwrap().iter().map(|p| p["work"]["kind"].as_str().unwrap()).collect();
        assert!(kinds.first() == Some(&"outline") && kinds.contains(&"addresses"), "{kinds:?}");
        assert!(kinds.windows(2).all(|k| !(k[0] == "addresses" && k[1] != "addresses")));
        // a chapter an author does not treat is an empty list, not an error
        let (st, none) = call(&app, "GET", "/companion/coates/passage/21/1", None, Value::Null).await;
        assert_eq!((st, none), (200, serde_json::json!([])), "Coates has no reading of Ecclesiastes 1");

        // the 1890 edition leaves Coates out: every route of his answers as for an author never had; Darby stays; 1961 again restores him
        let (app2, pool) = crate::testkit::app();
        crate::edition::set(&pool.get().unwrap(), crate::edition::Edition::E1890).unwrap();
        for uri in ["/companion/coates", "/companion/coates/passage/1/1", "/companion/coates/genesis/1"] { assert_eq!(call(&app2, "GET", uri, None, Value::Null).await.0, 404, "{uri}") }
        for uri in ["/companion/darby", "/companion/darby/passage/1/1"] { assert_eq!(call(&app2, "GET", uri, None, Value::Null).await.0, 200, "{uri}") }
        crate::edition::set(&pool.get().unwrap(), crate::edition::Edition::E1961).unwrap();
        for uri in ["/companion/coates", "/companion/coates/passage/1/1", "/companion/coates/genesis/1"] { assert_eq!(call(&app2, "GET", uri, None, Value::Null).await.0, 200, "{uri}") }

        // 404s: an unknown author, work, number, or a book or chapter the Bible does not have
        for uri in ["/companion/kelly", "/companion/kelly/passage/1/1", "/companion/kelly/genesis/1", "/companion/coates/nowhere/1", "/companion/coates/genesis/0",
            "/companion/coates/genesis/9999", "/companion/darby/passage/67/1", "/companion/darby/passage/1/51", "/companion/coates/passage/1/0"] {
            let (st, body) = call(&app, "GET", uri, None, Value::Null).await;
            assert_eq!(st, 404, "{uri}");
            assert!(body["error"].is_string(), "{uri}");
        }
    }
}
