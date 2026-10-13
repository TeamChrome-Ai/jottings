//! The cleanse (docs/EDITION.md, "Cleanse"): `berean cleanse` sets the 1890 edition and, on top of it, takes out of the
//! ministry what is not Mr. Darby's own: the collections `other` and `misc` whole, the footnotes of the Collected
//! Writings and the Notes (with their "[n]" callers), the Letters' topic lines (Bible Truth Publishers'; the recipients
//! stay, credited, by L. J. L. Hodgett's leave), the Synopsis's italic-only sub-headings and the "{…}" editorial notes. shared/cleanse.ts is the same rule for
//! a pack a phone holds; the two are kept in step by hand. Two rows of `meta` carry it: `cleanse` ("1" while on) and
//! `cleanse_prior_edition` (what `cleanse undo` restores). Nothing stored is rewritten: every function here filters a
//! copy, so `cleanse undo` serves everything whole again.
use crate::edition::Edition;
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

pub const HIDDEN_COLLECTIONS: [&str; 2] = ["other", "misc"];
pub const NOTELESS_COLLECTIONS: [&str; 3] = ["cw", "notes-comments", "notes-jottings"];
pub fn collection_hidden(c: &str) -> bool { HIDDEN_COLLECTIONS.contains(&c) }
pub fn notes_hidden(c: &str) -> bool { NOTELESS_COLLECTIONS.contains(&c) }

fn meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get::<_, String>(0)).optional().ok().flatten()
}
fn put(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, value]).map(|_| ())
}
pub fn get(conn: &Connection) -> bool { meta(conn, "cleanse").as_deref() == Some("1") }
/// The edition the owner had before the cleanse set 1890; None when the cleanse never set it.
pub fn prior_edition(conn: &Connection) -> Option<Edition> { meta(conn, "cleanse_prior_edition").and_then(|v| Edition::parse(&v)) }
/// Turns the cleanse on: 1890 for the edition, the one before it remembered.
pub fn apply(conn: &Connection) -> rusqlite::Result<()> {
    if !get(conn) {
        let was = crate::edition::get(conn);
        put(conn, "cleanse_prior_edition", was.as_str())?;
    }
    put(conn, "cleanse", "1")?;
    crate::edition::set(conn, Edition::E1890)
}
/// Turns it off; the edition goes back to what the cleanse found (1961 unless the owner had set 1890 themselves).
pub fn undo(conn: &Connection) -> rusqlite::Result<Edition> {
    let back = prior_edition(conn).unwrap_or(crate::edition::DEFAULT);
    put(conn, "cleanse", "0")?;
    conn.execute("DELETE FROM meta WHERE key='cleanse_prior_edition'", [])?;
    crate::edition::set(conn, back)?;
    Ok(back)
}

// ---------- text ----------

static SUBHEADING: Lazy<Regex> = Lazy::new(|| Regex::new(r"^<i>[^<]*</i>$").unwrap());
static CALLER: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[\d+\]").unwrap());
static BRACES: Lazy<Regex> = Lazy::new(|| Regex::new(r"\{[^}]*\}").unwrap());
static SPACES: Lazy<Regex> = Lazy::new(|| Regex::new(r" {2,}").unwrap());

/// A paragraph that is a sub-heading: wholly one italic run.
pub fn is_subheading(para: &str) -> bool { SUBHEADING.is_match(para) }
/// A section's paragraphs as the index and the app split them (blank lines; empty ones dropped).
pub fn split_paras(text: &str) -> Vec<&str> { text.split("\n\n").filter(|p| !p.trim().is_empty()).collect() }
/// The sub-heading paragraphs of a text, by index, ascending.
pub fn subheading_indices(text: &str) -> Vec<i64> { split_paras(text).iter().enumerate().filter(|(_, p)| is_subheading(p)).map(|(i, _)| i as i64).collect() }
/// Where paragraph `i` stands once the sub-headings before it are gone; None for a sub-heading itself.
pub fn remap_para(i: i64, heads: &[i64]) -> Option<i64> {
    if heads.contains(&i) { return None }
    Some(i - heads.iter().filter(|&&h| h < i).count() as i64)
}
pub fn strip_callers(s: &str) -> String { CALLER.replace_all(s, "").into_owned() }
/// The callers out of a plain paragraph, with a [start, end) span of it moved along.
pub fn strip_callers_at(plain: &str, start: usize, end: usize) -> (String, usize, usize) {
    // the index measures in UTF-16 units; a caller is ASCII, so its length is the same in both
    let mut shift = 0;
    for m in CALLER.find_iter(plain) {
        let at = plain[..m.start()].encode_utf16().count();
        if at + m.len() <= start { shift += m.len() }
    }
    (strip_callers(plain), start.saturating_sub(shift), end.saturating_sub(shift))
}
pub fn strip_braces(s: &str) -> String {
    let s = BRACES.replace_all(s, "");
    SPACES.replace_all(&s, " ").replace("\n ", "\n").trim().to_string()
}
/// A section's text as the cleanse shows it in `collection`.
pub fn text(collection: &str, text: &str) -> String {
    let mut t = if collection == "synopsis" { split_paras(text).into_iter().filter(|p| !is_subheading(p)).collect::<Vec<_>>().join("\n\n") } else { text.to_string() };
    if notes_hidden(collection) { t = strip_callers(&t).trim_start_matches(' ').to_string() }
    strip_braces(&t)
}

// ---------- a section's listing ----------

/// A letter's entry without the topics (Bible Truth Publishers' lines). The recipient and the title naming it stay:
/// L. J. L. Hodgett, whose list they come from, allows them with a credit (data/ministry/SOURCE.md, 2026-10-08).
pub fn letter_meta(m: &Value) -> Value {
    let mut v = m.clone();
    if let Some(o) = v.as_object_mut() { o.remove("subtitle"); }
    v
}
/// A work's contents list as the cleanse shows it (the Letters' entries retitled; the rest as they are).
pub fn contents(collection: &str, contents: &Value) -> Value {
    if collection != "letters" { return contents.clone() }
    Value::Array(contents.as_array().into_iter().flatten().map(letter_meta).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::{app_with_ministry, call};
    use axum::http::header;
    use std::io::Read;
    use tower::ServiceExt;

    async fn cache_control(app: &axum::Router, uri: &str) -> String {
        let res = app.clone().oneshot(axum::http::Request::builder().uri(uri).body(axum::body::Body::empty()).unwrap()).await.unwrap();
        res.headers().get(header::CACHE_CONTROL).and_then(|v| v.to_str().ok()).unwrap_or("").to_string()
    }
    async fn gunzip(app: &axum::Router, uri: &str) -> Value {
        let res = app.clone().oneshot(axum::http::Request::builder().uri(uri).body(axum::body::Body::empty()).unwrap()).await.unwrap();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 26).await.unwrap();
        let mut s = String::new();
        flate2::read::GzDecoder::new(&bytes[..]).read_to_string(&mut s).unwrap();
        serde_json::from_str(&s).unwrap()
    }
    fn ids(v: &Value, key: &str) -> Vec<String> { v.as_array().into_iter().flatten().map(|x| x[key].as_str().unwrap_or("").to_string()).collect() }
    fn has_subheading(text: &str) -> bool { split_paras(text).iter().any(|p| is_subheading(p)) }

    #[tokio::test]
    async fn the_cleanse_hides_what_is_not_darbys_and_the_undo_restores_it() {
        crate::testkit::texts();
        let (app, pool) = app_with_ministry(&crate::ministry::tests::cleanse_fixture());
        let get = |uri: &str| { let app = app.clone(); let uri = uri.to_string(); async move { call(&app, "GET", &uri, None, Value::Null).await } };

        // before: everything as it is in the data
        let (_, e) = get("/edition").await;
        assert_eq!((e["edition"].as_str(), e["cleanse"].as_bool()), (Some("1961"), Some(false)));
        let (_, lib) = get("/ministry").await;
        assert_eq!(ids(&lib["authors"], "id"), ["darby", "coates"]);
        assert_eq!(ids(&lib["authors"][0]["collections"], "id"), ["cw", "synopsis", "letters", "other"]);
        assert_eq!(get("/ministry/refs/43/3/16").await.1["groups"][0]["total"], 7);
        assert_eq!(get("/ministry/refs/1/1/1").await.1["groups"][0]["total"], 1);
        assert_eq!(get("/ministry/chapter/1/1").await.1["verses"], json!([1, 2, 3]));
        assert_eq!(get("/ministry/search?q=wigram").await.1["hits"].as_array().unwrap().len(), 2, "the letter's recipient and the base fixture's cw section with a `to`");
        let (_, passage) = get("/companion/darby/passage/1/1").await;
        assert!(passage.as_array().unwrap().iter().any(|p| has_subheading(p["section"]["text"].as_str().unwrap())), "the Synopsis's Genesis 1 has sub-headings in the data");
        let plain_version = get("/ministry/offline").await.1["authors"][0]["version"].as_str().unwrap().to_string();

        apply(&pool.get().unwrap()).unwrap();

        let (_, e) = get("/edition").await;
        assert_eq!((e["edition"].as_str(), e["cleanse"].as_bool()), (Some("1890"), Some(true)));
        // the library: no Coates (1890), no hidden collection; their works as absent
        let (_, lib) = get("/ministry").await;
        assert_eq!(ids(&lib["authors"], "id"), ["darby"]);
        assert_eq!(ids(&lib["authors"][0]["collections"], "id"), ["cw", "synopsis", "letters"]);
        for uri in ["/ministry/darby/other-x", "/ministry/darby/other-x/1", "/ministry/offline/darby/other-x", "/ministry/coates/romans"] {
            assert_eq!(get(uri).await.0, 404, "{uri}");
        }
        // letters: no topic line; the recipient and the title naming them stay (Hodgett's list, credited); the text as it is
        let (_, w) = get("/ministry/darby/letters-1").await;
        assert_eq!(w["sections"][0], json!({ "title": "To G. V. Wigram · Pau, 1876", "passages": [], "date": "Pau, 1876", "to": "G. V. Wigram" }));
        assert_eq!(w["sections"][1]["title"], "Letter 2");
        let (_, l2) = get("/ministry/darby/letters-1/2").await;
        assert_eq!((l2["section"]["title"].as_str(), l2["section"]["text"].as_str()), (Some("Letter 2"), Some("Dear brother, [1833]")));
        // the Collected Writings: no notes, no callers
        let (_, s) = get("/ministry/darby/cw-doctrinal-1/1").await;
        assert_eq!(s["section"]["text"], "God so loved the world (John 3:16).

Compare <i>verses</i> 14–18 of the chapter.");
        assert!(s["section"].get("notes").is_none());
        assert!(s["section"].get("figures").is_some(), "figures stay");
        // the Synopsis: the sub-headings gone, in the library and in the companion
        assert_eq!(get("/ministry/darby/genesis/1").await.1["section"]["text"], "In the beginning (Genesis 1:1).

And God said (Genesis 1:3).");
        let (_, passage) = get("/companion/darby/passage/1/1").await;
        assert!(passage.as_array().unwrap().iter().all(|p| !has_subheading(p["section"]["text"].as_str().unwrap())));
        let (_, one) = get("/companion/darby/genesis/1").await;
        assert!(!has_subheading(one["section"]["text"].as_str().unwrap()));
        // the title search: the recipient still found, no topic line, nothing of the hidden collections
        let (_, r) = get("/ministry/search?q=wigram").await;
        assert_eq!(r["hits"].as_array().unwrap().len(), 2, "the letter's recipient and the fixture's cw section with a `to`");
        assert_eq!(get("/ministry/search?q=topics").await.1["hits"], json!([]));
        assert_eq!(get("/ministry/search?q=eternal").await.1["hits"], json!([]));
        assert_eq!(get("/ministry/search?q=pau").await.1["hits"][0]["title"], "To G. V. Wigram · Pau, 1876");
        assert_eq!(get("/ministry/search?q=john%203").await.1["hits"][0]["work"]["id"], "cw-doctrinal-1");
        // the verse index: no note, no hidden work, no sub-heading; the Synopsis's paragraphs renumbered
        let (_, r) = get("/ministry/refs/43/3/16").await;
        let g = &r["groups"][0];
        let got: Vec<(String, i64, i64)> = g["items"].as_array().unwrap().iter().map(|i| (i["work"]["id"].as_str().unwrap().to_string(), i["n"].as_i64().unwrap(), i["para"].as_i64().unwrap())).collect();
        assert_eq!(got, [("cw-doctrinal-1".into(), 1, 0), ("cw-doctrinal-1".into(), 2, 0), ("letters-1".into(), 1, 0), ("cw-doctrinal-1".into(), 1, 1), ("cw-doctrinal-1".into(), 1, 2)]);
        assert_eq!((g["total"].as_i64(), g["pages"].as_i64()), (Some(5), Some(1)));
        assert!(g["items"].as_array().unwrap().iter().all(|i| i.get("note").is_none()));
        assert_eq!((g["items"][2]["section"].as_str(), g["items"][2]["snippet"].as_str()), (Some("To G. V. Wigram · Pau, 1876"), Some("Read John 3:16.")));
        assert_eq!((g["items"][3]["snippet"].as_str(), g["items"][3]["hl"].clone()), (Some("Compare verses 14–18 of the chapter."), json!([8, 25])));
        let (_, r) = get("/ministry/refs/1/1/1-3").await;
        let items = r["groups"][0]["items"].as_array().unwrap();
        assert_eq!(items.iter().map(|i| (i["para"].as_i64().unwrap(), i["snippet"].as_str().unwrap().to_string())).collect::<Vec<_>>(), [(0, "In the beginning (Genesis 1:1).".into()), (1, "And God said (Genesis 1:3).".into())]);
        assert_eq!(get("/ministry/refs/1/1/2").await.1["groups"], json!([]), "a verse named only in a sub-heading has nothing");
        assert_eq!(get("/ministry/chapter/1/1").await.1["verses"], json!([1, 3]));
        assert_eq!(get("/ministry/chapter/43/3").await.1["verses"], json!([16, 17]));
        // the offline pack: its own version, the hidden work out, the sections and the index as the API serves them
        let (_, list) = get("/ministry/offline").await;
        let darby = &list["authors"][0];
        let version = darby["version"].as_str().unwrap();
        assert!(version == format!("{plain_version}-c"), "{version}");
        assert_eq!(ids(&darby["works"], "id"), ["cw-doctrinal-1", "genesis", "letters-1"]);
        let pack = gunzip(&app, "/ministry/offline/darby").await;
        assert_eq!(pack["version"].as_str(), Some(version));
        let works = pack["works"].as_array().unwrap();
        assert!(works[0]["sections"][0].get("notes").is_none());
        assert_eq!(works[0]["sections"][0]["text"], s["section"]["text"]);
        assert_eq!(works[1]["sections"][0]["text"], "In the beginning (Genesis 1:1).

And God said (Genesis 1:3).");
        assert_eq!(works[2]["contents"]["sections"][0]["title"], "To G. V. Wigram · Pau, 1876");
        assert_eq!(works[2]["sections"][0]["to"], "G. V. Wigram");
        assert!(works[2]["sections"][0].get("subtitle").is_none());
        let rows = pack["refs"]["43"]["3"].as_array().unwrap();
        assert!(rows.iter().all(|r| r[5].as_i64() != Some(1)), "no row into a note: {rows:?}");
        assert_eq!(rows.iter().filter(|r| r[0] == 16).count(), 5);
        let genesis = pack["refs"]["1"]["1"].as_array().unwrap();
        assert_eq!(genesis.iter().map(|r| (r[0].as_i64().unwrap(), r[4].as_i64().unwrap())).collect::<Vec<_>>(), [(1, 0), (3, 1)]);
        let (_, w) = get("/ministry/offline/darby/letters-1").await;
        assert_eq!(w["contents"]["sections"][0]["title"], "To G. V. Wigram · Pau, 1876");
        // caching: a read that does not say the cleanse is on is kept nowhere; the 1961 name neither
        assert_eq!(cache_control(&app, "/ministry?ed=1890").await, "no-store");
        assert_eq!(cache_control(&app, "/ministry?ed=1890&cl=1").await, "public, max-age=86400");
        assert_eq!(cache_control(&app, "/ministry?ed=1961&cl=1").await, "no-store");
        assert_eq!(cache_control(&app, "/ministry/darby/other-x?ed=1890&cl=1").await, "", "a 404 carries none: main.rs makes it no-store");

        // undo: everything back, the edition too
        assert_eq!(undo(&pool.get().unwrap()).unwrap(), Edition::E1961);
        let (_, e) = get("/edition").await;
        assert_eq!((e["edition"].as_str(), e["cleanse"].as_bool()), (Some("1961"), Some(false)));
        let (_, lib) = get("/ministry").await;
        assert_eq!(ids(&lib["authors"], "id"), ["darby", "coates"]);
        assert_eq!(ids(&lib["authors"][0]["collections"], "id"), ["cw", "synopsis", "letters", "other"]);
        assert_eq!(get("/ministry/refs/43/3/16").await.1["groups"][0]["total"], 7);
        assert_eq!(get("/ministry/darby/letters-1").await.1["sections"][0]["to"], "G. V. Wigram");
        assert_eq!(get("/ministry/darby/cw-doctrinal-1/1").await.1["section"]["notes"][0], "See John 3:16 again.");
        assert_eq!(get("/ministry/darby/genesis/1").await.1["section"]["text"].as_str().map(has_subheading), Some(true));
        assert_eq!(get("/ministry/offline").await.1["authors"][0]["version"], plain_version);
        assert_eq!(cache_control(&app, "/ministry?ed=1961").await, "public, max-age=86400");
        assert_eq!(cache_control(&app, "/ministry?ed=1961&cl=1").await, "no-store");
    }

    #[tokio::test]
    async fn an_edition_row_cannot_bring_1961_back_under_the_cleanse() {
        let (app, pool) = crate::testkit::app();
        apply(&pool.get().unwrap()).unwrap();
        crate::edition::set(&pool.get().unwrap(), Edition::E1961).unwrap();
        assert_eq!(call(&app, "GET", "/edition", None, Value::Null).await.1["edition"], "1890");
        assert_eq!(call(&app, "GET", "/chronology", None, Value::Null).await.0, 404);
    }

    #[test]
    fn the_rules() {
        assert!(collection_hidden("other") && collection_hidden("misc") && !collection_hidden("letters") && !collection_hidden("synopsis"));
        assert!(notes_hidden("cw") && notes_hidden("notes-jottings") && !notes_hidden("synopsis") && !notes_hidden("letters"));
        assert!(is_subheading("<i>Creation with man as head</i>") && !is_subheading("<i>Partly</i> italic") && !is_subheading("Plain"));
        assert_eq!(subheading_indices("<i>A</i>\n\nOne\n\n<i>B</i>\n\nTwo\n\nThree"), [0, 2]);
        assert_eq!((remap_para(0, &[0, 2]), remap_para(1, &[0, 2]), remap_para(2, &[0, 2]), remap_para(4, &[0, 2])), (None, Some(0), None, Some(2)));
        assert_eq!(text("synopsis", "<i>A</i>\n\nOne\n\n<i>B</i>\n\nTwo"), "One\n\nTwo");
        assert_eq!(text("cw", "[1] When a man[2] speaks.[3] More"), "When a man speaks. More");
        assert_eq!(text("other", "Words {Christian Friend 1893.} here.\n\n{Ed.} Next"), "Words here.\n\nNext");
        assert_eq!(text("letters", "Dear brother, [1833]"), "Dear brother, [1833]", "a bracketed year is not a caller: letters keep their text");
        let (t, s, e) = strip_callers_at("Compare verses 14–18 of the chapter.[1] See John 3:16.[2]", 44, 53);
        assert_eq!(t, "Compare verses 14–18 of the chapter. See John 3:16.");
        assert_eq!(String::from_utf16_lossy(&t.encode_utf16().collect::<Vec<_>>()[s..e]), "John 3:16");
        // a caller after the span moves nothing
        assert_eq!(strip_callers_at("See John 3:16.[2]", 4, 13), ("See John 3:16.".into(), 4, 13));
        let m = json!({ "title": "To B. & S. Plymouth · Dublin, May, 1832", "subtitle": "Prayer; Union", "passages": [], "date": "Dublin, May, 1832", "to": "B. & S. Plymouth" });
        assert_eq!(letter_meta(&m), json!({ "title": "To B. & S. Plymouth · Dublin, May, 1832", "passages": [], "date": "Dublin, May, 1832", "to": "B. & S. Plymouth" }));
        assert_eq!(contents("cw", &json!([{ "title": "A", "to": "x" }])), json!([{ "title": "A", "to": "x" }]));
    }

    #[test]
    fn the_switch_remembers_the_edition_it_found() {
        let (_, pool) = crate::testkit::app();
        let c = pool.get().unwrap();
        assert!(!get(&c));
        apply(&c).unwrap();
        assert!(get(&c) && crate::edition::get(&c) == Edition::E1890 && prior_edition(&c) == Some(Edition::E1961));
        apply(&c).unwrap();
        assert_eq!(prior_edition(&c), Some(Edition::E1961), "applied twice: the first edition is kept");
        assert_eq!(undo(&c).unwrap(), Edition::E1961);
        assert!(!get(&c) && crate::edition::get(&c) == Edition::E1961 && prior_edition(&c).is_none());
        // an owner who had 1890 before keeps it after the undo
        crate::edition::set(&c, Edition::E1890).unwrap();
        apply(&c).unwrap();
        assert_eq!(undo(&c).unwrap(), Edition::E1890);
        assert_eq!(crate::edition::get(&c), Edition::E1890);
    }
}
