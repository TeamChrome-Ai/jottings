//! Reference parsing + FTS5 search (unicode61 prefix/phrase, trigram substring fallback).
use crate::edition::Tables;
use crate::refparse::{bare_book, looks_like_ref, parse_ref, Ref};
use rusqlite::params;
use serde::Serialize;
use std::time::Instant;

#[derive(Serialize, Clone)]
pub struct Hit { pub book: i64, pub chapter: i64, pub verse: i64, pub text: String, pub snippet: String, pub rank: f64 }

#[derive(Serialize)]
pub struct SearchResponse { pub kind: &'static str, #[serde(skip_serializing_if = "Option::is_none")] pub r#ref: Option<Ref>, pub hits: Vec<Hit>, pub total: i64, pub query: String, pub took_ms: u128,
    /// How the text hits are ordered: "bible" or "match". Absent for a reference and an empty query.
    #[serde(skip_serializing_if = "Option::is_none")] pub order: Option<&'static str>,
    /// Text hits for a query that is also a book's name ("song", "mark"): that book, chapter 1, for the client to offer.
    #[serde(skip_serializing_if = "Option::is_none")] pub book: Option<Ref>,
    /// One bare word in Bible order: the first `exact` hits hold the word itself (or its plural), the rest a longer
    /// word it begins. Absent when all or none do.
    #[serde(skip_serializing_if = "Option::is_none")] pub exact: Option<i64> }

/// The order of text hits: canonical (book, chapter, verse), as a concordance lists them, or bm25 (best match first).
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Order { Bible, Match }
impl Order {
    fn name(self) -> &'static str { match self { Order::Bible => "bible", Order::Match => "match" } }
    /// `order=bible|match`; anything else leaves the choice to `default_order`.
    pub fn parse(s: Option<&str>) -> Option<Order> { match s { Some("bible") => Some(Order::Bible), Some("match") => Some(Order::Match), _ => None } }
}
/// One word or one quoted phrase reads as a concordance lookup: Bible order. Several terms are a hunt for the verse
/// that has them all: best match first. shared/search.ts `defaultOrder` is the same rule.
pub fn default_order(q: &str) -> Order { if fts_parts(q, true).len() <= 1 { Order::Bible } else { Order::Match } }

fn scope_sql(scope: &str) -> (String, Vec<i64>) {
    match scope {
        "OT" => (" AND v.book <= 39".into(), vec![]),
        "NT" => (" AND v.book >= 40".into(), vec![]),
        s => match s.parse::<i64>() { Ok(n) if (1..=66).contains(&n) => (" AND v.book = ?".into(), vec![n]), _ => (String::new(), vec![]) },
    }
}

/// Quoted phrases stay phrases; bare words get prefix matching; hyphenated words become phrases.
fn fts_query(q: &str, prefix: bool) -> Option<String> {
    let parts = fts_parts(q, prefix);
    if parts.is_empty() { None } else { Some(parts.join(" AND ")) }
}
fn fts_parts(q: &str, prefix: bool) -> Vec<String> {
    let mut parts = Vec::new();
    let mut rest = q;
    while !rest.is_empty() {
        rest = rest.trim_start();
        if rest.is_empty() { break; }
        if let Some(r) = rest.strip_prefix('"') {
            let end = r.find('"').unwrap_or(r.len());
            let phrase = r[..end].trim();
            if !phrase.is_empty() { parts.push(format!("\"{}\"", phrase.replace('"', ""))); }
            rest = if end < r.len() { &r[end + 1..] } else { "" };
        } else {
            let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            let word = &rest[..end];
            rest = &rest[end..];
            let pieces: Vec<String> = word.split(['-', '–', '—']).map(|p| p.chars().filter(|c| c.is_alphanumeric() || *c == '\'' || *c == '’').collect::<String>()).filter(|p| !p.is_empty()).collect();
            if pieces.is_empty() { continue; }
            if pieces.len() > 1 { parts.push(format!("\"{}\"{}", pieces.join(" "), if prefix { "*" } else { "" })); }
            else if prefix && pieces[0].chars().count() >= 3 { parts.push(format!("\"{}\"*", pieces[0])); }
            else { parts.push(format!("\"{}\"", pieces[0])); }
        }
    }
    parts
}

/// The endings that are still the word looked up (WHOLE_ENDINGS in shared/search.ts).
const WHOLE_ENDINGS: [&str; 3] = ["", "s", "es"];
/// One bare word read as a concordance lookup also matches every longer word it begins, and in Bible order those
/// crowd out the word itself ("ant": Psalms' "anticipate" before Proverbs' "ants"). This is the match for the word
/// itself or its plural, whose verses lead; None when the query is not one bare word.
fn whole_forms(q: &str) -> Option<String> {
    let parts = fts_parts(q, true);
    let [part] = parts.as_slice() else { return None };
    let word = part.strip_prefix('"')?.strip_suffix("\"*")?;
    if word.is_empty() || !word.chars().all(char::is_alphanumeric) { return None; }
    Some(WHOLE_ENDINGS.iter().map(|e| format!("\"{word}{e}\"")).collect::<Vec<_>>().join(" OR "))
}

/// The hits, their count, and (with `whole`) how many of them hold the word itself. Parameters are bound in the order
/// the statement names them: the match, a one-book scope's book, the whole-word match, limit and offset.
fn run(conn: &rusqlite::Connection, verses: &str, table: &str, m: &str, scope: &(String, Vec<i64>), order: Order, whole: Option<&str>, limit: i64, offset: i64) -> rusqlite::Result<(Vec<Hit>, i64, i64)> {
    use rusqlite::types::Value as V;
    let lead = if whole.is_some() { format!("({table}.rowid IN (SELECT rowid FROM {table} WHERE {table} MATCH ?)) DESC, ") } else { String::new() };
    let by = match order { Order::Bible => format!("{lead}v.book, v.chapter, v.verse"), Order::Match => format!("bm25({table})") };
    let sql = format!(
        "SELECT v.book, v.chapter, v.verse, v.text, snippet({t}, 0, '<mark>', '</mark>', '…', 24), bm25({t}) FROM {t} JOIN {verses} v ON v.id = {t}.rowid WHERE {t} MATCH ?{s} ORDER BY {by} LIMIT ? OFFSET ?",
        t = table, s = scope.0);
    let cnt = format!("SELECT count(*) FROM {t} JOIN {verses} v ON v.id = {t}.rowid WHERE {t} MATCH ?{s}", t = table, s = scope.0);
    let matching = |m: &str| -> Vec<V> { std::iter::once(V::Text(m.to_string())).chain(scope.1.iter().map(|b| V::Integer(*b))).collect() };
    let mut p = matching(m);
    if matches!(order, Order::Bible) { p.extend(whole.map(|w| V::Text(w.to_string()))); }
    p.extend([V::Integer(limit), V::Integer(offset)]);
    let hits: Vec<Hit> = conn.prepare_cached(&sql)?.query_map(rusqlite::params_from_iter(p), row_hit)?.collect::<Result<_, _>>()?;
    let mut cs = conn.prepare_cached(&cnt)?;
    let total: i64 = cs.query_row(rusqlite::params_from_iter(matching(m)), |r| r.get(0))?;
    let exact: i64 = match whole { Some(w) => cs.query_row(rusqlite::params_from_iter(matching(w)), |r| r.get(0))?, None => 0 };
    Ok((hits, total, exact))
}
fn row_hit(r: &rusqlite::Row) -> rusqlite::Result<Hit> {
    Ok(Hit { book: r.get(0)?, chapter: r.get(1)?, verse: r.get(2)?, text: r.get(3)?, snippet: r.get(4)?, rank: r.get(5)? })
}

fn esc(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;") }
/// ±70 chars around the first case-insensitive occurrence, match wrapped in <mark>.
fn window_snippet(text: &str, q: &str) -> String {
    let needle = q.replace('"', "");
    let needle = needle.trim();
    let lower = text.to_lowercase();
    let Some(i) = lower.find(&needle.to_lowercase()) else { return if text.chars().count() > 160 { format!("{}…", text.chars().take(160).collect::<String>()) } else { text.to_string() } };
    let end = i + needle.len();
    let mut a = i.saturating_sub(70); while !text.is_char_boundary(a) { a -= 1; }
    let mut b = (end + 70).min(text.len()); while !text.is_char_boundary(b) { b += 1; }
    format!("{}{}<mark>{}</mark>{}{}", if a > 0 { "…" } else { "" }, esc(&text[a..i]), esc(&text[i..end]), esc(&text[end..b]), if b < text.len() { "…" } else { "" })
}

/// Search the text of the edition `t` names (edition::tables).
pub fn search(conn: &rusqlite::Connection, t: &Tables, q_raw: &str, limit: i64, offset: i64, scope: &str, order: Option<Order>) -> rusqlite::Result<SearchResponse> {
    let t0 = Instant::now();
    let q = q_raw.trim().to_string();
    let limit = limit.clamp(1, 200);
    let offset = offset.max(0);
    if q.is_empty() { return Ok(SearchResponse { kind: "text", r#ref: None, hits: vec![], total: 0, query: q, took_ms: 0, order: None, book: None, exact: None }); }

    let cite = |r: Ref| -> rusqlite::Result<SearchResponse> {
        let v1 = r.v1.unwrap_or(1);
        let v2 = r.v2.or(r.v1).unwrap_or(999);
        let mut st = conn.prepare_cached(&format!("SELECT book, chapter, verse, text FROM {} WHERE book=?1 AND chapter=?2 AND verse BETWEEN ?3 AND ?4 ORDER BY verse", t.verses))?;
        let hits: Vec<Hit> = st.query_map(params![r.book, r.chapter, v1, v2], |x| Ok(Hit { book: x.get(0)?, chapter: x.get(1)?, verse: x.get(2)?, text: x.get::<_, String>(3)?, snippet: x.get(3)?, rank: 0.0 }))?.collect::<Result<_, _>>()?;
        let total = hits.len() as i64;
        Ok(SearchResponse { kind: "ref", r#ref: Some(r), hits, total, query: q.clone(), took_ms: t0.elapsed().as_millis(), order: None, book: None, exact: None })
    };
    // A reference with a chapter or verse is a citation. A book's name alone ("song", "mark") is a word first: its
    // hits come back with `book` so the client can offer the book, and only a name the text never uses ("jn",
    // "song of solomon") is a citation of chapter 1. A name of several words is searched as a phrase.
    // shared/search.ts searchIndex is the same rule.
    let mut book: Option<Ref> = None;
    let mut words = q.clone();
    if looks_like_ref(&q) {
        if let Some(r) = parse_ref(&q) {
            if bare_book(&q).is_none() { return cite(r); }
            book = Some(r);
            if q.split_whitespace().count() > 1 { words = format!("\"{}\"", q.split_whitespace().collect::<Vec<_>>().join(" ")); }
        }
    }
    let full = q.clone();
    let q = words;

    let scope = scope_sql(scope);
    let order = order.unwrap_or_else(|| default_order(&q));
    let mut res = (Vec::new(), 0i64, 0i64);
    let mut used_trigram = false;
    let attempt = |m: &str, table: &str, whole: Option<&str>| run(conn, t.verses, table, m, &scope, order, whole, limit, offset);
    // the word itself leads only a Bible-order list (a match-order list is already ranked)
    let whole = if matches!(order, Order::Bible) { whole_forms(&q) } else { None };
    if let Some(m) = fts_query(&q, true) { res = attempt(&m, t.fts, whole.as_deref()).unwrap_or((vec![], 0, 0)); }
    if res.1 == 0 { if let Some(m) = fts_query(&q, false) { res = attempt(&m, t.fts, None).unwrap_or((vec![], 0, 0)); } }
    let plain: String = q.replace('"', "").split_whitespace().collect::<Vec<_>>().join(" ");
    if res.1 == 0 && plain.chars().count() >= 3 {
        res = attempt(&format!("\"{}\"", plain), t.tri, None).unwrap_or((vec![], 0, 0));
        used_trigram = true;
    }
    if res.1 == 0 { if let Some(r) = book { return cite(r); } }
    let hits = res.0.into_iter().map(|mut h| { if used_trigram { h.snippet = window_snippet(&h.text, &plain); } h }).collect();
    // a two-letter alias that is also a word ("he", "is", "am") is just the word: no Hebrews row over 7,519 verses
    let book = book.filter(|_| full.chars().filter(|c| c.is_alphanumeric()).count() >= 3);
    Ok(SearchResponse { kind: "text", r#ref: None, hits, total: res.1, query: full, took_ms: t0.elapsed().as_millis(), order: Some(order.name()), book, exact: Some(res.2).filter(|e| *e > 0 && *e < res.1) })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn conn() -> rusqlite::Connection {
        let c = rusqlite::Connection::open_with_flags(crate::testkit::seed(), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).expect("data/scripture.db");
        c
    }
    #[test]
    fn fts_query_forms() {
        assert_eq!(fts_query("faith hope love", true).unwrap(), "\"faith\"* AND \"hope\"* AND \"love\"*");
        assert_eq!(fts_query("loving-kindness", true).unwrap(), "\"loving kindness\"*");
        assert_eq!(fts_query("\"life eternal\" god", false).unwrap(), "\"life eternal\" AND \"god\"");
        assert!(fts_query("---", true).is_none());
    }
    #[test]
    fn reference_and_text_search() {
        let c = conn();
        let r = search(&c, &crate::edition::T1961, "jn 3:16", 10, 0, "all", None).unwrap();
        assert_eq!(r.kind, "ref");
        assert!(r.hits[0].text.starts_with("For God so loved the world"));
        let r = search(&c, &crate::edition::T1961, "loving-kindness", 5, 0, "all", None).unwrap();
        assert!(r.total > 150, "total {}", r.total);
        assert!(r.hits[0].snippet.contains("<mark>"));
        let r = search(&c, &crate::edition::T1961, "\"only-begotten Son\"", 10, 0, "NT", None).unwrap();
        assert!(r.hits.iter().any(|h| h.book == 43 && h.chapter == 3 && h.verse == 16));
        assert!(search(&c, &crate::edition::T1961, "begat", 50, 0, "NT", None).unwrap().hits.iter().all(|h| h.book >= 40));
        assert!(search(&c, &crate::edition::T1961, "shepherd", 50, 0, "19", None).unwrap().hits.iter().all(|h| h.book == 19));
        // substring fallback through the trigram index
        let r = search(&c, &crate::edition::T1961, "oving-kindnes", 5, 0, "all", None).unwrap();
        assert!(r.total > 0 && r.hits[0].snippet.contains("<mark>"));
    }
    #[test]
    fn the_word_itself_leads_a_bible_order_lookup() {
        assert_eq!(whole_forms("ant").unwrap(), "\"ant\" OR \"ants\" OR \"antes\"");
        for q in ["an", "ant bee", "\"ant\"", "loving-kindness", "ant's", "---"] { assert_eq!(whole_forms(q), None, "{q}"); }
        let c = conn();
        let at = |h: &Hit| (h.book, h.chapter, h.verse);
        // "ant": Proverbs' ant and ants before every "anticipate", "Antioch" and "antelope", each group in Bible order
        let r = search(&c, &crate::edition::T1961, "ant", 200, 0, "all", None).unwrap();
        let exact = r.exact.expect("some hits hold the word itself, not all") as usize;
        assert_eq!(r.hits[..exact].iter().map(at).collect::<Vec<_>>(), vec![(20, 6, 6), (20, 30, 25)]);
        assert!(r.total as usize > exact && r.hits.len() == r.total as usize);
        assert!(r.hits[exact..].windows(2).all(|w| at(&w[0]) < at(&w[1])));
        assert!(at(&r.hits[exact]) < (20, 6, 6), "a longer word stands earlier in the Bible than the word itself");
        // the pages follow the same order, and a scope counts its own
        let p = search(&c, &crate::edition::T1961, "ant", 1, 1, "all", None).unwrap();
        assert_eq!((at(&p.hits[0]), p.exact), ((20, 30, 25), r.exact));
        assert_eq!(search(&c, &crate::edition::T1961, "ant", 50, 0, "20", None).unwrap().exact, None, "in Proverbs every hit is the word itself");
        assert_eq!(search(&c, &crate::edition::T1961, "ant", 50, 0, "NT", None).unwrap().exact, None, "and in the New Testament none is");
        // best match is ranked as before; a word no longer word begins with has one group
        assert_eq!(search(&c, &crate::edition::T1961, "ant", 50, 0, "all", Some(Order::Match)).unwrap().exact, None);
        assert_eq!(search(&c, &crate::edition::T1961, "beginning", 50, 0, "all", None).unwrap().exact, None);
    }
    #[test]
    fn order_defaults_and_overrides() {
        assert_eq!(default_order("beginning"), Order::Bible);
        assert_eq!(default_order("loving-kindness"), Order::Bible);
        assert_eq!(default_order("\"in the beginning\""), Order::Bible);
        assert_eq!(default_order("faith hope love"), Order::Match);
        assert_eq!(default_order("\"life eternal\" god"), Order::Match);
        let c = conn();
        let at = |h: &Hit| (h.book, h.chapter, h.verse);
        // one word: a concordance's order, Genesis 1:1 first
        let r = search(&c, &crate::edition::T1961, "beginning", 50, 0, "all", None).unwrap();
        assert_eq!(r.order, Some("bible"));
        assert_eq!(at(&r.hits[0]), (1, 1, 1));
        assert!(r.hits.windows(2).all(|w| at(&w[0]) < at(&w[1])));
        // asked for best match: bm25, as before, and the same total
        let m = search(&c, &crate::edition::T1961, "beginning", 50, 0, "all", Some(Order::Match)).unwrap();
        assert_eq!(m.order, Some("match"));
        assert_eq!(m.total, r.total);
        assert!(m.hits.windows(2).all(|w| w[0].rank <= w[1].rank));
        assert_ne!(at(&m.hits[0]), (1, 1, 1));
        // several words default to best match, and can be put in Bible order
        let r = search(&c, &crate::edition::T1961, "faith hope love", 50, 0, "all", None).unwrap();
        assert_eq!(r.order, Some("match"));
        assert!(r.hits.windows(2).all(|w| w[0].rank <= w[1].rank));
        let b = search(&c, &crate::edition::T1961, "faith hope love", 50, 0, "all", Some(Order::Bible)).unwrap();
        assert_eq!(b.order, Some("bible"));
        assert!(b.hits.windows(2).all(|w| at(&w[0]) < at(&w[1])));
        // a quoted phrase is a lookup too; the substring fallback follows the same rule; a reference names no order
        assert_eq!(search(&c, &crate::edition::T1961, "\"in the beginning\"", 10, 0, "all", None).unwrap().order, Some("bible"));
        let r = search(&c, &crate::edition::T1961, "oving-kindnes", 50, 0, "all", None).unwrap();
        assert!(r.order == Some("bible") && r.hits.windows(2).all(|w| at(&w[0]) < at(&w[1])));
        assert_eq!(search(&c, &crate::edition::T1961, "jn 3:16", 10, 0, "all", None).unwrap().order, None);
        assert_eq!(Order::parse(Some("bible")), Some(Order::Bible));
        assert_eq!(Order::parse(Some("newest")), None);
    }
    #[test]
    fn a_book_name_alone_is_a_word_first() {
        let c = conn();
        let at = |h: &Hit| (h.book, h.chapter, h.verse);
        // the word, in Bible order, with the book offered beside it
        let r = search(&c, &crate::edition::T1961, "song", 50, 0, "all", None).unwrap();
        assert_eq!((r.kind, r.order), ("text", Some("bible")));
        assert!(r.total > 0 && r.r#ref.is_none());
        assert_eq!(r.book, Some(Ref { book: 22, chapter: 1, v1: None, v2: None }));
        assert!(r.hits.iter().all(|h| h.text.to_lowercase().contains("song")));
        assert!(r.hits.windows(2).all(|w| at(&w[0]) < at(&w[1])) && r.hits[0].book < 22);
        // order, scope and paging as any word search
        let m = search(&c, &crate::edition::T1961, "song", 50, 0, "all", Some(Order::Match)).unwrap();
        assert_eq!((m.order, m.total, m.book.is_some()), (Some("match"), r.total, true));
        assert!(search(&c, &crate::edition::T1961, "song", 50, 0, "NT", None).unwrap().hits.iter().all(|h| h.book >= 40));
        assert_eq!(at(&search(&c, &crate::edition::T1961, "song", 1, 1, "all", None).unwrap().hits[0]), at(&r.hits[1]));
        let r = search(&c, &crate::edition::T1961, "mark", 50, 0, "all", None).unwrap();
        assert_eq!((r.kind, r.book.as_ref().map(|b| (b.book, b.chapter))), ("text", Some((41, 1))));
        assert!(r.total > 0);
        for q in ["job", "acts", "john", "numbers", "judges", "ruth", "james", "titus", "amos", "joel", "habakkuk"] {
            let r = search(&c, &crate::edition::T1961, q, 5, 0, "all", None).unwrap();
            assert!(r.kind == "text" && r.total > 0 && r.book.is_some(), "{q}");
        }
        // with a chapter or a verse it is a citation, as before
        for (q, ch) in [("song 2:1", 2), ("song 2", 2), ("song of solomon 2", 2)] {
            let r = search(&c, &crate::edition::T1961, q, 10, 0, "all", None).unwrap();
            assert_eq!((r.kind, r.r#ref.as_ref().map(|x| (x.book, x.chapter)), r.book.is_none()), ("ref", Some((22, ch)), true), "{q}");
        }
        assert_eq!(search(&c, &crate::edition::T1961, "1 kings 8", 10, 0, "all", None).unwrap().r#ref.map(|x| (x.book, x.chapter)), Some((11, 8)));
        // a name of several words is a phrase: the text has "song of songs" once, "song of solomon" never
        let r = search(&c, &crate::edition::T1961, "song of songs", 10, 0, "all", None).unwrap();
        assert_eq!((r.kind, r.order, r.query.as_str(), r.book.as_ref().map(|b| b.book)), ("text", Some("bible"), "song of songs", Some(22)));
        assert!(r.hits.iter().all(|h| h.text.to_lowercase().contains("song of songs")));
        // a name the text never uses opens the book at chapter 1
        for (q, b) in [("song of solomon", 22), ("jn", 43), ("1 cor", 46), ("jdg", 7)] {
            let r = search(&c, &crate::edition::T1961, q, 10, 0, "all", None).unwrap();
            assert_eq!((r.kind, r.r#ref.as_ref().map(|x| (x.book, x.chapter)), r.order), ("ref", Some((b, 1)), None), "{q}");
            assert!(r.total > 0 && r.book.is_none(), "{q}");
        }
    }
    #[test]
    fn window_snippet_marks_and_trims() {
        let s = window_snippet("a".repeat(200).as_str(), "aaa");
        assert!(s.starts_with("<mark>aaa</mark>") && s.ends_with('…'));
    }
}
