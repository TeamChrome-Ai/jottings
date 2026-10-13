//! The Concise Bible Dictionary (George Morrish, 1897) for the web client, which does not bundle it: the 3.3 MB of
//! articles would be a 1.2 MB gzipped download for the one article a Strong's lookup shows. data/cbd is compiled in
//! (tools/cbd_convert.py writes it); native apps ship the same files.
use crate::error::{ApiError, ApiResult};
use axum::{extract::{Path, Query}, http::header, response::{IntoResponse, Response}, Json};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;

const INDEX: &str = include_str!("../../data/cbd/index.json");
/// The articles, one file per initial letter of the id (the app reads one letter at a time).
macro_rules! articles { ($($l:literal)*) => { [$(include_str!(concat!("../../data/cbd/articles/", $l, ".json"))),*] } }
const ARTICLES: [&str; 26] = articles!("a" "b" "c" "d" "e" "f" "g" "h" "i" "j" "k" "l" "m" "n" "o" "p" "q" "r" "s" "t" "u" "v" "w" "x" "y" "z");
const LIMIT: usize = 60;

/// id -> article, parsed on first use.
fn entries() -> &'static HashMap<String, Value> {
    static M: OnceLock<HashMap<String, Value>> = OnceLock::new();
    M.get_or_init(|| {
        ARTICLES.iter().flat_map(|f| serde_json::from_str::<Vec<Value>>(f).expect("data/cbd/articles"))
            .filter_map(|e| Some((e.get("id")?.as_str()?.to_string(), e))).collect()
    })
}

/// (id, headword, folded headword, folded aliases) in index order.
struct Row { id: String, headword: String, key: String, aliases: Vec<String> }
fn rows() -> &'static Vec<Row> {
    static R: OnceLock<Vec<Row>> = OnceLock::new();
    R.get_or_init(|| {
        let raw: Vec<Value> = serde_json::from_str(INDEX).expect("data/cbd/index.json");
        raw.iter().filter_map(|r| {
            let r = r.as_array()?;
            let headword = r.get(1)?.as_str()?.to_string();
            let aliases = r.get(2)?.as_array()?.iter().filter_map(|a| a.as_str().map(key)).collect();
            Some(Row { id: r.first()?.as_str()?.to_string(), key: key(&headword), headword, aliases })
        }).collect()
    })
}

/// Letters and digits, lower-cased: shared/cbd.ts nameKey for the (all-ASCII) headwords.
fn key(s: &str) -> String { s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect() }

/// Headword prefix first, then alias prefix, then contains: shared/cbd.ts searchHeadwords.
fn search(q: &str) -> Vec<(&'static str, &'static str)> {
    let k = key(q);
    if k.is_empty() { return Vec::new(); }
    let (mut prefix, mut alias, mut contains) = (Vec::new(), Vec::new(), Vec::new());
    for r in rows() {
        if r.key.starts_with(&k) { prefix.push(r) }
        else if r.aliases.iter().any(|a| a.starts_with(&k)) { alias.push(r) }
        else if r.key.contains(&k) || r.aliases.iter().any(|a| a.contains(&k)) { contains.push(r) }
        if prefix.len() >= LIMIT { break }
    }
    prefix.into_iter().chain(alias).chain(contains).take(LIMIT).map(|r| (r.id.as_str(), r.headword.as_str())).collect()
}

fn day(mut r: Response) -> Response { r.headers_mut().insert(header::CACHE_CONTROL, "public, max-age=86400".parse().unwrap()); r }

#[derive(Deserialize)] pub struct IndexQ { q: Option<String> }
/// Without `q`: the whole index.json (matching and the A to Z list run on it). With `q`: `[{id, headword}]`.
pub async fn index(Query(p): Query<IndexQ>) -> Response {
    match p.q {
        None => day(([(header::CONTENT_TYPE, "application/json")], INDEX).into_response()),
        Some(q) => day(Json(search(&q).into_iter().map(|(id, headword)| serde_json::json!({ "id": id, "headword": headword })).collect::<Vec<_>>()).into_response()),
    }
}

pub async fn entry(Path(id): Path<String>) -> ApiResult<Response> {
    let e = entries().get(&id).ok_or_else(|| ApiError::not_found("no such dictionary entry"))?;
    Ok(day(Json(e).into_response()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn search_ranks_prefix_before_contains() {
        crate::testkit::texts();
        let hits = search("aaron");
        assert_eq!(hits.first().map(|h| h.0), Some("aaron"));
        assert!(hits.iter().any(|h| h.0 == "aaronic-priesthood"));
        let contains = search("priesthood");
        assert!(contains.iter().any(|h| h.0 == "aaronic-priesthood"));
        assert!(search("").is_empty());
    }
    #[test]
    fn every_index_row_has_an_article() {
        for r in rows() { assert!(entries().contains_key(&r.id), "{}", r.id); }
    }
}
