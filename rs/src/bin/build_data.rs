#![allow(dead_code)]
//! Build-time tool: data/darby.json + notes_bf.json + words.json + strongs.json -> data/scripture.db
//! (schema + FTS indexes), plus brotli-compressed per-chapter JSON for the offline bundle in client/public/bible/; the
//! 1890 edition's notes (data/notes_1890.json), and its text when data/darby_1890.json exists, beside them in the
//! database and in client/public/bible1890/ (docs/EDITION.md). BEREAN_NEUTERED=1 writes the client bundle with the 1890
//! edition only (no 1961 note in any chapter file; the database still holds both): the production build.
use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::Deserialize;
use sha2::Digest;
use std::{collections::HashMap, fs, io::Write};

#[path = "../db.rs"] mod db;
#[path = "../books.rs"] mod books;

#[derive(Deserialize)] struct RawVerse { v: i64, t: String, h: Option<String>, p: Option<u8>, s: Option<u8>, hd: Option<String> }
#[derive(Deserialize)] struct RawChapter { c: i64, title: Option<String>, division: Option<u8>, verses: Vec<RawVerse> }
#[derive(Deserialize)] struct RawBook { n: i64, chapters: Vec<RawChapter> }
#[derive(Deserialize)] struct Raw { books: Vec<RawBook> }
#[derive(Deserialize, Clone)] struct RawNote { m: String, i: i64, #[serde(default)] w: String, t: String }
#[derive(Deserialize)] struct StrongsEntry { lemma: String, translit: String, pron: String, kjv: String }

/// A Bible in another language, kept in the English Darby's chapters and verses (docs/LANGUAGES.md): data/text_<lang>.json.
#[derive(Deserialize)] struct LangNote { marker: String, pos: i64, text: String }
/// A printed verse that begins inside a slot, at word `pos` (the German's Numbers 30:2 inside English 30:1).
#[derive(Deserialize)] struct LangInner { nv: i64 }
#[derive(Deserialize)] struct LangVerse { v: i64, t: String, h: Option<String>, p: Option<u8>, s: Option<u8>, nv: Option<i64>, nc: Option<i64>, #[serde(rename = "nvTo")] nv_to: Option<i64>, #[serde(rename = "ncTo")] nc_to: Option<i64>, #[serde(default)] inner: Vec<LangInner>, #[serde(default)] notes: Vec<LangNote> }
#[derive(Deserialize)] struct LangChapter { c: i64, title: Option<String>, nc: Option<i64>, verses: Vec<LangVerse> }
#[derive(Deserialize)] struct LangBook { n: i64, chapters: Vec<LangChapter> }
#[derive(Deserialize)] struct LangText { books: Vec<LangBook> }
/// The Bibles other than the English the data build knows.
const LANGS: [&str; 2] = ["fr", "de"];

#[derive(Deserialize)] struct Move { from: String, to: String, text: String, r#as: Option<String> }
#[derive(Deserialize)] struct Replace { r#ref: String, from: String, to: String }
#[derive(Deserialize, Default)] struct Corrections { #[serde(default)] moves: Vec<Move>, #[serde(default)] replace: Vec<Replace> }

/// data/corrections.json: move a leading phrase from one verse to the end of the previous one (verse-boundary
/// fixes), or replace a substring inside a verse. Applied to both the plain and the html text. Loud on misses.
fn apply_corrections(mut raw: Raw, data: &str) -> Result<Raw> {
    let Ok(txt) = fs::read_to_string(format!("{data}/corrections.json")) else { return Ok(raw) };
    let c: Corrections = serde_json::from_str(&txt)?;
    let parse = |k: &str| -> (i64, i64, i64) { let p: Vec<i64> = k.split('.').map(|x| x.parse().unwrap()).collect(); (p[0], p[1], p[2]) };
    let mut applied = 0;
    for m in &c.moves {
        let (fb, fc, fv) = parse(&m.from); let (tb, tc, tv) = parse(&m.to);
        anyhow::ensure!(fb == tb, "move across books unsupported: {}", m.from);
        let book = raw.books.iter_mut().find(|b| b.n == fb).unwrap();
        let text = &m.text;
        let appended = m.r#as.as_deref().unwrap_or(text).to_string();
        {
            let src = book.chapters.iter_mut().find(|ch| ch.c == fc).unwrap().verses.iter_mut().find(|v| v.v == fv).unwrap();
            anyhow::ensure!(src.t.starts_with(text.as_str()), "correction miss: {} does not start with {:?}", m.from, text);
            src.t = src.t[text.len()..].trim_start().to_string();
            if let Some(h) = src.h.take() { src.h = Some(if h.starts_with(text.as_str()) { h[text.len()..].trim_start().to_string() } else { h }); }
        }
        {
            let dst = book.chapters.iter_mut().find(|ch| ch.c == tc).unwrap().verses.iter_mut().find(|v| v.v == tv).unwrap();
            dst.t = format!("{} {}", dst.t.trim_end(), appended);
            if let Some(h) = dst.h.as_mut() { *h = format!("{} {}", h.trim_end(), appended); }
        }
        applied += 1;
    }
    for r in &c.replace {
        let (b, cc, v) = parse(&r.r#ref);
        let verse = raw.books.iter_mut().find(|x| x.n == b).unwrap().chapters.iter_mut().find(|ch| ch.c == cc).unwrap().verses.iter_mut().find(|x| x.v == v).unwrap();
        anyhow::ensure!(verse.t.contains(&r.from), "correction miss: {} lacks {:?}", r.r#ref, r.from);
        verse.t = verse.t.replace(&r.from, &r.to);
        if let Some(h) = verse.h.as_mut() { *h = h.replace(&r.from, &r.to); }
        applied += 1;
    }
    println!("corrections: {applied} applied");
    Ok(raw)
}

/// Index (as the reader tokenizes: runs of ASCII letters, digits and apostrophes) of the word that follows byte offset `at`.
fn word_index_at(s: &str, at: usize) -> i64 { let mut n = 0; let mut in_w = false; for (i, c) in s.char_indices() { if i >= at { break; } let w = c.is_ascii_alphanumeric() || c == '\'' || c == '’'; if w && !in_w { n += 1; } in_w = w; } n }
fn word_count(s: &str) -> i64 { let mut n = 0; let mut in_w = false; for c in s.chars() { let w = c.is_alphanumeric() || c == '\'' || c == '’'; if w && !in_w { n += 1; } in_w = w; } n }

/// The reader's words (client/src/lib/bible.ts `tokenize`): runs of ASCII letters, digits and apostrophes.
fn reader_words(s: &str) -> Vec<&str> { s.split(|c: char| !(c.is_ascii_alphanumeric() || c == '\'' || c == '’')).filter(|w| !w.is_empty()).collect() }

/// The words `align_tags` pairs, case-folded: the reader's, except that a word with æ or œ in it is one, spelled out as
/// ebible spells it ("Cæsarea", which the reader splits at the æ, is ebible's "Caesarea"). Each comes with the range of
/// the reader's words it covers and its bytes in `s`.
fn match_units(s: &str) -> Vec<(String, std::ops::Range<usize>, std::ops::Range<usize>)> {
    let mut out: Vec<(String, std::ops::Range<usize>, std::ops::Range<usize>)> = Vec::new();
    let (mut n, mut in_unit, mut in_word) = (0, false, false);
    for (at, c) in s.char_indices() {
        let lig = match c { 'æ' | 'Æ' => "ae", 'œ' | 'Œ' => "oe", _ => "" };
        let reader = c.is_ascii_alphanumeric() || c == '\'' || c == '’';
        if !reader && lig.is_empty() { in_unit = false; in_word = false; continue }
        if !in_unit { out.push((String::new(), n..n, at..at)); in_unit = true; }
        let u = out.last_mut().unwrap();
        u.2.end = at + c.len_utf8();
        if reader {
            if !in_word { n += 1; u.1.end = n; in_word = true; }
            u.0.extend(c.to_lowercase());
        } else { in_word = false; u.0.push_str(lig); }
    }
    out.retain(|u| !u.1.is_empty());
    out
}

/// words.json lists only the words ebible wrapped in `\w`, from ebible's own copy of the text, so its n-th entry is not
/// the n-th word of ours (Matt 1:2 there has no "begat"; John 3:2 has no "thou art"), and a tag read by position landed
/// on the wrong word more than half the time. Each tag moves to the word it pairs with in a longest common subsequence
/// of the two lists (`match_units` of each; ebible's "father-in-law" is three, like ours, each with the word's number);
/// a tag whose word has no partner in our text is dropped. Returns one row per word of `text` as the reader tokenizes
/// it, (word, code) with "" where it carries none, and how many of their tags found their word. A tag on several of the
/// reader's words ("father-in-law", "Cæsarea") is one occurrence: its number is on each, so a tap on any piece opens
/// it, and its first row holds the word as printed and the others "" (`bible::strongs_info` counts the rows with a word).
fn align_tags(text: &str, theirs: &[(String, String)]) -> (Vec<(String, String)>, usize) {
    let a = match_units(text);
    let b: Vec<(String, usize)> = theirs.iter().enumerate().flat_map(|(t, (w, _))| match_units(w).into_iter().map(move |(u, ..)| (u, t))).collect();
    let (n, m) = (a.len(), b.len());
    // lcs[i][j]: the longest common subsequence of a[i..] and b[j..]
    let mut lcs = vec![vec![0u16; m + 1]; n + 1];
    for i in (0..n).rev() { for j in (0..m).rev() { lcs[i][j] = if a[i].0 == b[j].0 { lcs[i + 1][j + 1] + 1 } else { lcs[i + 1][j].max(lcs[i][j + 1]) }; } }
    // the units of ours each tag pairs with, in order
    let mut found: Vec<Vec<usize>> = vec![Vec::new(); theirs.len()];
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if a[i].0 == b[j].0 { found[b[j].1].push(i); i += 1; j += 1; }
        else if lcs[i + 1][j] >= lcs[i][j + 1] { i += 1 } else { j += 1 }
    }
    let mut out: Vec<(String, String)> = reader_words(text).into_iter().map(|w| (w.to_string(), String::new())).collect();
    for ((_, code), us) in theirs.iter().zip(&found) {
        if code.is_empty() || us.is_empty() { continue }
        // pieces side by side are one word; a tag whose pieces landed apart is one occurrence per piece
        let whole = us.windows(2).all(|p| a[p[0]].1.end == a[p[1]].1.start);
        for (x, &u) in us.iter().enumerate() {
            for k in a[u].1.clone() { out[k] = (String::new(), code.clone()); }
            if x == 0 || !whole { out[a[u].1.start].0 = text[a[u].2.clone()].to_string(); }
        }
        if whole { out[a[us[0]].1.start].0 = text[a[us[0]].2.start..a[*us.last().unwrap()].2.end].to_string(); }
    }
    let paired = theirs.iter().zip(&found).filter(|((_, c), us)| !us.is_empty() && !c.is_empty()).count();
    (out, paired)
}

/// Lettered notes as data/notes_bf.json (1961) and data/notes_1890.json (1890) keep them: `{ "b.c.v": [{ m, i, w, t }] }`;
/// a missing file is no notes.
fn read_notes(path: &str) -> Result<HashMap<String, Vec<RawNote>>> {
    match fs::read_to_string(path) { Ok(s) => Ok(serde_json::from_str(&s).with_context(|| path.to_string())?), Err(_) => Ok(HashMap::new()) }
}

/// One edition's notes: its lettered notes and the El / Eloah glosses read from its text, per verse, ordered by word
/// index. Darby's printed edition prints Elohim as plain "God" and marks only El ("·God") and Eloah ("†God"): the glyphs
/// are in the text itself, so the glosses come from them at their printed places (the text drops the glyphs after).
/// ebible's own symbol glosses (data/notes.json) are not used: its word positions come from a different text.
/// `base` is data/notes.json, whose glosses all go: its verses keep an empty list, as the 1961 files have always had.
fn edition_notes(raw: &Raw, base: &HashMap<String, Vec<RawNote>>, lettered: HashMap<String, Vec<RawNote>>) -> (HashMap<String, Vec<RawNote>>, usize) {
    let mut notes = base.clone();
    for (k, v) in lettered { notes.entry(k).or_default().extend(v); }
    for v in notes.values_mut() { v.sort_by_key(|n| n.i); v.retain(|n| !matches!(n.m.as_str(), "°" | "*" | "+" | "·" | "†")); }
    let mut glyphs = 0;
    for b in &raw.books {
        for ch in &b.chapters {
            for v in &ch.verses {
                let key = format!("{}.{}.{}", b.n, ch.c, v.v);
                for (at, c) in v.t.char_indices() {
                    let (m, t) = match c { '·' => ("·", "El"), '†' => ("†", "Eloah"), _ => continue };
                    notes.entry(key.clone()).or_default().push(RawNote { m: m.into(), i: word_index_at(&v.t, at), w: String::new(), t: t.into() });
                    glyphs += 1;
                }
                if let Some(ns) = notes.get_mut(&key) { ns.sort_by_key(|n| n.i); }
            }
        }
    }
    (notes, glyphs)
}

/// The verses, chapters and Strong's rows of one text into `{verses,chapters,verse_words}{suffix}`, notes into `notes_table`.
fn write_text(tx: &rusqlite::Transaction, raw: &Raw, suffix: &str, notes: &HashMap<String, Vec<RawNote>>, notes_table: &str, words: &HashMap<String, Vec<(String, String)>>) -> Result<(usize, usize, usize)> {
    let mut ins_v = tx.prepare(&format!("INSERT INTO verses{suffix} (id, book, chapter, verse, text, html, para, strophe, head) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"))?;
    let mut ins_c = tx.prepare(&format!("INSERT INTO chapters{suffix} (book, chapter, title, division, words, verse_count) VALUES (?1,?2,?3,?4,?5,?6)"))?;
    let mut ins_n = tx.prepare(&format!("INSERT INTO {notes_table} (verse_id, marker, word_index, text) VALUES (?1,?2,?3,?4)"))?;
    let mut ins_w = tx.prepare(&format!("INSERT INTO verse_words{suffix} (verse_id, word_index, word, strongs) VALUES (?1,?2,?3,?4)"))?;
    let mut total = 0;
    let (mut tags_kept, mut tags_all) = (0usize, 0usize);
    for b in &raw.books {
        for ch in &b.chapters {
            let mut wtot = 0;
            for v in &ch.verses {
                let id = db::verse_id(b.n, ch.c, v.v);
                let text = v.t.replace(['·', '†'], "");
                let html = v.h.as_ref().map(|h| h.replace(['·', '†'], ""));
                ins_v.execute(params![id, b.n, ch.c, v.v, text, html, v.p.unwrap_or(0), v.s.unwrap_or(0), v.hd])?;
                wtot += word_count(&text);
                let key = format!("{}.{}.{}", b.n, ch.c, v.v);
                if let Some(ns) = notes.get(&key) { for n in ns { ins_n.execute(params![id, n.m, n.i, n.t])?; } }
                // one row per word of the text as the reader tokenizes it, so a tag's position is the word it names
                if let Some(ws) = words.get(&key) {
                    let (rows, paired) = align_tags(&text, ws);
                    tags_kept += paired;
                    tags_all += ws.iter().filter(|(_, c)| !c.is_empty()).count();
                    for (i, (w, c)) in rows.iter().enumerate() { ins_w.execute(params![id, i as i64, w, c])?; }
                }
                total += 1;
            }
            ins_c.execute(params![b.n, ch.c, ch.title, ch.division.unwrap_or(0), wtot, ch.verses.len() as i64])?;
        }
    }
    Ok((total, tags_kept, tags_all))
}

/// The reader's chapter files (client/public/bible/B/C.json, what /bible/B/C.json serves and the apps bundle): text,
/// layout marks and notes. `ed` marks a chapter of an edition other than the 1961 one, so a stored copy says which it is.
fn chapter_files(raw: &Raw, notes: &HashMap<String, Vec<RawNote>>, ed: Option<&str>) -> Vec<serde_json::Value> {
    let mut all = Vec::with_capacity(1189);
    for b in &raw.books {
        for ch in &b.chapters {
            let verses: Vec<serde_json::Value> = ch.verses.iter().map(|v| {
                let key = format!("{}.{}.{}", b.n, ch.c, v.v);
                let mut o = serde_json::json!({ "v": v.v, "t": v.t.replace(['·', '†'], "") });
                if let Some(h) = &v.h { o["h"] = serde_json::json!(h.replace(['·', '†'], "")); }
                if v.p.is_some() { o["p"] = serde_json::json!(1); }
                if v.s.is_some() { o["s"] = serde_json::json!(1); }
                if let Some(hd) = &v.hd { o["hd"] = serde_json::json!(hd); }
                if let Some(ns) = notes.get(&key) { o["notes"] = serde_json::json!(ns.iter().enumerate().map(|(i, n)| serde_json::json!({ "id": db::verse_id(b.n, ch.c, v.v) * 10 + i as i64, "marker": n.m, "pos": n.i, "text": n.t })).collect::<Vec<_>>()); }
                o
            }).collect();
            let mut c = serde_json::json!({ "book": b.n, "c": ch.c, "verses": verses, "words": ch.verses.iter().map(|v| word_count(&v.t)).sum::<i64>() });
            if let Some(t) = &ch.title { c["title"] = serde_json::json!(t); }
            if ch.division.is_some() { c["division"] = serde_json::json!(1); }
            if let Some(e) = ed { c["ed"] = serde_json::json!(e); }
            all.push(c);
        }
    }
    all
}

/// What the app bundle adds for the 1890 edition to a 1961 chapter (client/src/lib/editionCore.ts applyOverlay): only
/// its notes, by verse, when the two chapters are the same text; the whole chapter when they are not (data/darby_1890.json).
/// None for a chapter of the same text with no notes.
fn overlay_entry(c1961: &serde_json::Value, c1890: &serde_json::Value) -> Option<serde_json::Value> {
    let strip = |c: &serde_json::Value| -> serde_json::Value {
        let mut c = c.clone();
        if let Some(o) = c.as_object_mut() { o.remove("ed"); }
        for v in c["verses"].as_array_mut().into_iter().flatten() { if let Some(o) = v.as_object_mut() { o.remove("notes"); } }
        c
    };
    if strip(c1961) != strip(c1890) { return Some(serde_json::json!({ "chapter": c1890 })) }
    let mut notes = serde_json::Map::new();
    for v in c1890["verses"].as_array().into_iter().flatten() {
        if let Some(ns) = v.get("notes").filter(|n| n.as_array().is_some_and(|a| !a.is_empty())) { notes.insert(v["v"].to_string(), ns.clone()); }
    }
    (!notes.is_empty()).then(|| serde_json::json!({ "notes": notes }))
}

struct Bundle<'a> { raw: &'a Raw, notes: &'a HashMap<String, Vec<RawNote>>, ed: Option<&'static str> }

/// What the client bundle under `client/public/bible` carries: the 1961 edition (its notes, no `ed` mark), or with
/// BEREAN_NEUTERED=1 the 1890 edition (its notes, every chapter marked `ed: "1890"`), so an app built from it holds no
/// 1961 note at all. The 1890 overlay the apps lay over the bundle is then empty: there is nothing to differ from.
fn bundle_plan<'a>(neutered: bool, raw: &'a Raw, raw_1890: Option<&'a Raw>, notes: &'a HashMap<String, Vec<RawNote>>, notes_1890: &'a HashMap<String, Vec<RawNote>>) -> Bundle<'a> {
    if neutered { Bundle { raw: raw_1890.unwrap_or(raw), notes: notes_1890, ed: Some("1890") } } else { Bundle { raw, notes, ed: None } }
}

fn lettered(m: &str) -> bool { !m.is_empty() && m.bytes().all(|c| c.is_ascii_lowercase()) }

fn clean_scan_word(w: &str) -> bool {
    !w.is_empty() && w.split(['-', '\'', '’']).all(|run| !run.is_empty() && run.chars().all(|c| c.is_ascii_alphabetic() || "æœÆŒ".contains(c)))
}

fn note_words<'a>(reader: &[&'a str], n: &'a RawNote) -> Vec<&'a str> {
    let Some(&word) = usize::try_from(n.i - 1).ok().and_then(|i| reader.get(i)) else { return Vec::new() };
    let split_by_reader = clean_scan_word(&n.w) && !n.w.eq_ignore_ascii_case(word) && n.w.to_ascii_lowercase().ends_with(&word.to_ascii_lowercase());
    if split_by_reader { vec![word, n.w.as_str()] } else { vec![word] }
}

#[derive(Default, Debug)]
struct FootnoteIndex {
    words: std::collections::BTreeMap<String, Vec<[i64; 5]>>,
    listed: usize,
    on_no_word: usize,
}

fn footnote_index(raw: &Raw, notes: &HashMap<String, Vec<RawNote>>) -> FootnoteIndex {
    let mut index = FootnoteIndex::default();
    let mut texts: HashMap<&str, i64> = HashMap::new();
    for b in &raw.books { for ch in &b.chapters { for v in &ch.verses {
        let Some(ns) = notes.get(&format!("{}.{}.{}", b.n, ch.c, v.v)) else { continue };
        let text = v.t.replace(['·', '†'], "");
        let reader = reader_words(&text);
        for (i, n) in ns.iter().enumerate().filter(|(_, n)| lettered(&n.m)) {
            let words = note_words(&reader, n);
            if words.is_empty() { index.on_no_word += 1; continue }
            let next = texts.len() as i64;
            let t = *texts.entry(n.t.as_str()).or_insert(next);
            for w in words { index.words.entry(w.to_string()).or_default().push([b.n, ch.c, v.v, i as i64, t]); }
            index.listed += 1;
        }
    } } }
    index
}

/// Every English chapter and verse has its place in `t`, in the same order: a text that lost or gained one would put a
/// reader's highlights on the wrong words. Returns the problems, empty when there are none.
fn lang_slots_match(english: &Raw, t: &LangText) -> Vec<String> {
    let mut bad = Vec::new();
    if english.books.len() != t.books.len() { bad.push(format!("{} books, the English has {}", t.books.len(), english.books.len())); }
    for (eb, tb) in english.books.iter().zip(&t.books) {
        if eb.n != tb.n || eb.chapters.len() != tb.chapters.len() { bad.push(format!("book {}: {} chapters, the English has {}", tb.n, tb.chapters.len(), eb.chapters.len())); continue }
        for (ec, tc) in eb.chapters.iter().zip(&tb.chapters) {
            let (ev, tv): (Vec<i64>, Vec<i64>) = (ec.verses.iter().map(|v| v.v).collect(), tc.verses.iter().map(|v| v.v).collect());
            if ec.c != tc.c || ev != tv { bad.push(format!("{} {}: verses {:?}…, the English {:?}…", tb.n, tc.c, &tv[..tv.len().min(3)], &ev[..ev.len().min(3)])); }
        }
    }
    bad
}

/// The text's tables for the server's search: verses_<lang> (with its full-text indexes), chapters_<lang>, notes_<lang>.
fn write_lang_db(tx: &rusqlite::Transaction, lang: &str, t: &LangText) -> Result<usize> {
    tx.execute_batch(&db::schema_text_lang(lang))?;
    let mut ins_v = tx.prepare(&format!("INSERT INTO verses_{lang} (id, book, chapter, verse, text, html, para, strophe, head) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL)"))?;
    let mut ins_c = tx.prepare(&format!("INSERT INTO chapters_{lang} (book, chapter, title, division, words, verse_count) VALUES (?1,?2,?3,0,?4,?5)"))?;
    let mut ins_n = tx.prepare(&format!("INSERT INTO notes_{lang} (verse_id, marker, word_index, text) VALUES (?1,?2,?3,?4)"))?;
    let mut total = 0;
    for b in &t.books { for ch in &b.chapters {
        let mut words = 0;
        for v in &ch.verses {
            let id = db::verse_id(b.n, ch.c, v.v);
            if !v.t.is_empty() { ins_v.execute(params![id, b.n, ch.c, v.v, v.t, v.h, v.p.unwrap_or(0), v.s.unwrap_or(0)])?; total += 1; }
            words += word_count(&v.t);
            for n in &v.notes { ins_n.execute(params![id, n.marker, n.pos, n.text])?; }
        }
        ins_c.execute(params![b.n, ch.c, ch.title, words, ch.verses.len() as i64])?;
    } }
    tx.execute_batch(&db::fts_rebuild_lang(lang))?;
    Ok(total)
}

/// The reader's chapter files of the text (client/public/bible-<lang>/B/C.json), marked `tx` so a stored copy says which
/// Bible it is; each verse's own printed numbers where they differ, and `m` on an English verse whose words this Bible
/// gives with its neighbour's (the reader shows nothing for it, where an English verse Darby omits says so).
fn lang_chapter_files(lang: &str, t: &LangText, english: &Raw) -> Vec<serde_json::Value> {
    let mut all = Vec::with_capacity(1189);
    for (b, eb) in t.books.iter().zip(&english.books) { for (ch, ec) in b.chapters.iter().zip(&eb.chapters) {
        let verses: Vec<serde_json::Value> = ch.verses.iter().zip(&ec.verses).map(|(v, ev)| {
            let mut o = serde_json::json!({ "v": v.v, "t": v.t });
            if v.t.is_empty() && !ev.t.is_empty() { o["m"] = serde_json::json!(1); }
            if let Some(h) = &v.h { o["h"] = serde_json::json!(h); }
            if v.p.is_some() { o["p"] = serde_json::json!(1); }
            if v.s.is_some() { o["s"] = serde_json::json!(1); }
            if let Some(n) = v.nv { o["nv"] = serde_json::json!(n); }
            if let Some(n) = v.nc { o["nc"] = serde_json::json!(n); }
            // two printed verses in one slot: shown as their range ("1-2")
            if let Some(n) = v.nv_to.or(v.inner.last().map(|i| i.nv)) { o["nvTo"] = serde_json::json!(n); }
            if let Some(n) = v.nc_to { o["ncTo"] = serde_json::json!(n); }
            if !v.notes.is_empty() { o["notes"] = serde_json::json!(v.notes.iter().enumerate().map(|(i, n)| serde_json::json!({ "id": db::verse_id(b.n, ch.c, v.v) * 10 + i as i64, "marker": n.marker, "pos": n.pos, "text": n.text })).collect::<Vec<_>>()); }
            o
        }).collect();
        let mut c = serde_json::json!({ "book": b.n, "c": ch.c, "tx": lang, "verses": verses, "words": ch.verses.iter().map(|v| word_count(&v.t)).sum::<i64>() });
        if let Some(x) = &ch.title { c["title"] = serde_json::json!(x); }
        if let Some(n) = ch.nc { c["nc"] = serde_json::json!(n); }
        all.push(c);
    } }
    all
}

/// Where the text's own numbers sit in the English (shared/texts.ts VerseMap): by English "book.chapter", runs of verses
/// `[v, len, own chapter, own first verse]`, only where some verse differs.
fn lang_verse_map(t: &LangText) -> serde_json::Map<String, serde_json::Value> {
    let mut out = serde_json::Map::new();
    for b in &t.books { for ch in &b.chapters {
        let mut runs: Vec<[i64; 4]> = Vec::new();
        for v in &ch.verses {
            let (oc, ov) = (v.nc.unwrap_or(ch.c), v.nv.unwrap_or(v.v));
            if (oc, ov) == (ch.c, v.v) { continue }
            match runs.last_mut() {
                Some(r) if r[0] + r[1] == v.v && r[2] == oc && r[3] + r[1] == ov => r[1] += 1,
                _ => runs.push([v.v, 1, oc, ov]),
            }
        }
        if !runs.is_empty() { out.insert(format!("{}.{}", b.n, ch.c), serde_json::json!(runs)); }
    } }
    out
}

fn br(path: &str, bytes: &[u8]) -> Result<()> {
    fs::write(path, bytes)?;
    let mut f = fs::File::create(format!("{path}.br"))?;
    let mut enc = brotli::CompressorWriter::new(&mut f, 4096, 11, 22);
    enc.write_all(bytes)?; enc.flush()?; Ok(())
}

fn write_bundle(dir: &str, chapters: &[serde_json::Value], ed: Option<&str>) -> Result<u64> {
    fs::create_dir_all(dir)?;
    let mut total = 0u64;
    for c in chapters {
        fs::create_dir_all(format!("{dir}/{}", c["book"]))?;
        let json = serde_json::to_vec(c)?;
        br(&format!("{dir}/{}/{}.json", c["book"], c["c"]), &json)?;
        total += json.len() as u64;
    }
    let mut archive = serde_json::json!({ "v": 1, "chapters": chapters });
    if let Some(e) = ed { archive["ed"] = serde_json::json!(e); }
    br(&format!("{dir}/all.json"), &serde_json::to_vec(&archive)?)?;
    Ok(total)
}

fn write_edition(dir: &str, b: &Bundle) -> Result<(Vec<serde_json::Value>, u64)> {
    let chapters = chapter_files(b.raw, b.notes, b.ed);
    let total = write_bundle(dir, &chapters, b.ed)?;
    let index = footnote_index(b.raw, b.notes);
    let json = serde_json::to_vec(&index.words)?;
    let path = format!("{dir}/footnotes.json");
    fs::write(&path, &json)?;
    println!("footnotes ({}): {} lettered notes under {} words, {} KB, in {path}; {} on no word", b.ed.unwrap_or("1961"), index.listed, index.words.len(), json.len() / 1024, index.on_no_word);
    Ok((chapters, total))
}

fn main() -> Result<()> {
    let data = std::env::args().nth(1).unwrap_or_else(|| "data".into());
    let neutered = std::env::var("BEREAN_NEUTERED").is_ok_and(|v| v == "1");
    if neutered { println!("BEREAN_NEUTERED=1: the client bundle carries the 1890 edition only"); }
    let out_db = format!("{data}/scripture.db");
    let _ = fs::remove_file(&out_db);
    let raw: Raw = serde_json::from_str(&fs::read_to_string(format!("{data}/darby.json")).context("data/darby.json")?)?;
    let raw = apply_corrections(raw, &data)?;
    // the 1890 edition (docs/EDITION.md): its own text when data/darby_1890.json exists (taken as it stands; the
    // corrections are to the 2014 PDF's text), else the same text; its own lettered notes from data/notes_1890.json
    let raw_1890: Option<Raw> = match fs::read_to_string(format!("{data}/darby_1890.json")) { Ok(s) => Some(serde_json::from_str(&s).context("data/darby_1890.json")?), Err(_) => None };
    let base = read_notes(&format!("{data}/notes.json"))?;
    let bf = read_notes(&format!("{data}/notes_bf.json"))?;
    let lettered_1961: usize = bf.values().map(Vec::len).sum();
    let (notes, glyphs) = edition_notes(&raw, &base, bf);
    let own = read_notes(&format!("{data}/notes_1890.json"))?;
    let lettered_1890: usize = own.values().map(Vec::len).sum();
    // loud about a note keyed to a verse the text does not have: it would be dropped without a word
    let verses_1890: std::collections::HashSet<String> = raw_1890.as_ref().unwrap_or(&raw).books.iter().flat_map(|b| b.chapters.iter().flat_map(move |ch| ch.verses.iter().map(move |v| format!("{}.{}.{}", b.n, ch.c, v.v)))).collect();
    let mut stray: Vec<&String> = own.keys().filter(|k| !verses_1890.contains(*k)).collect();
    stray.sort();
    if !stray.is_empty() { println!("notes 1890: {} verse keys the text does not have, left out: {:?}", stray.len(), &stray[..stray.len().min(10)]); }
    let (notes_1890, glyphs_1890) = edition_notes(raw_1890.as_ref().unwrap_or(&raw), &base, own);
    println!("notes 1961: {lettered_1961} lettered (notes_bf.json) + {glyphs} El/Eloah glosses from the printed glyphs");
    println!("notes 1890: {lettered_1890} lettered (notes_1890.json{}) + {glyphs_1890} glosses; text: {}", if lettered_1890 == 0 { ": none yet" } else { "" }, if raw_1890.is_some() { "darby_1890.json" } else { "the same as 1961" });
    // the other languages' Bibles (docs/LANGUAGES.md), each refused whole if it does not fill the English slots exactly
    let mut texts: Vec<(&str, LangText)> = Vec::new();
    for lang in LANGS {
        let Ok(s) = fs::read_to_string(format!("{data}/text_{lang}.json")) else { continue };
        let t: LangText = serde_json::from_str(&s).with_context(|| format!("data/text_{lang}.json"))?;
        let bad = lang_slots_match(&raw, &t);
        anyhow::ensure!(bad.is_empty(), "data/text_{lang}.json does not fill the English chapters and verses: {} problems, first {:?}", bad.len(), &bad[..bad.len().min(5)]);
        texts.push((lang, t));
    }
    let words: HashMap<String, Vec<(String, String)>> = fs::read_to_string(format!("{data}/words.json")).ok().map(|s| serde_json::from_str(&s)).transpose()?.unwrap_or_default();
    let strongs: HashMap<String, StrongsEntry> = fs::read_to_string(format!("{data}/strongs.json")).ok().map(|s| serde_json::from_str(&s)).transpose()?.unwrap_or_default();

    let mut conn = Connection::open(&out_db)?;
    conn.execute_batch("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA page_size = 4096;")?;
    conn.execute_batch(db::SCHEMA)?;
    let tx = conn.transaction()?;
    {
        let (total, tags_kept, tags_all) = write_text(&tx, &raw, "", &notes, "notes", &words)?;
        // the 1890 notes against the shared text, or with the 1890 text in its own tables
        let mut ins_n = tx.prepare("INSERT INTO notes_1890 (verse_id, marker, word_index, text) VALUES (?1,?2,?3,?4)")?;
        match &raw_1890 {
            None => for b in &raw.books { for ch in &b.chapters { for v in &ch.verses {
                if let Some(ns) = notes_1890.get(&format!("{}.{}.{}", b.n, ch.c, v.v)) { for n in ns { ins_n.execute(params![db::verse_id(b.n, ch.c, v.v), n.m, n.i, n.t])?; } }
            } } },
            Some(r) => {
                tx.execute_batch(db::SCHEMA_TEXT_1890)?;
                let (n, kept, all) = write_text(&tx, r, "_1890", &notes_1890, "notes_1890", &words)?;
                println!("1890 text: {n} verses; Strong's tags aligned: {kept} of {all}");
            }
        }
        // tools/strongs_concordance.py: Strong's own fields only; an empty one is stored as NULL
        let mut ins_s = tx.prepare("INSERT INTO strongs (code, lemma, translit, pron, kjv) VALUES (?1,?2,?3,?4,?5)")?;
        let some = |s: &String| (!s.is_empty()).then(|| s.clone());
        for (code, e) in &strongs { ins_s.execute(params![code, e.lemma, e.translit, some(&e.pron), some(&e.kjv)])?; }
        println!("verses: {total}, strongs: {}; Strong's tags aligned to the text: {tags_kept} of {tags_all}", strongs.len());
    }
    tx.execute_batch(db::FTS_REBUILD)?;
    if raw_1890.is_some() { tx.execute_batch(db::FTS_REBUILD_1890)?; }
    for (lang, t) in &texts { println!("{lang} text: {} verses", write_lang_db(&tx, lang, t)?); }
    tx.execute("INSERT INTO meta (key, value) VALUES ('built_at', ?1)", params![db::now_iso()])?;
    tx.commit()?;
    conn.execute_batch("VACUUM; PRAGMA journal_mode = WAL;")?;
    drop(conn);
    println!("wrote {out_db} ({} MB)", fs::metadata(&out_db)?.len() / 1_048_576);

    // Client bundles: one small JSON per chapter (public/bible/NN/C.json, what the reader fetches) and a
    // single archive of every chapter (public/bible/all.json) that "Download all" unpacks into the Cache API.
    // Vite copies public/ into dist/, the .br siblings are streamed as-is to clients that accept brotli.
    let out_dir = std::env::var("BEREAN_PUBLIC").unwrap_or_else(|_| "client/public/bible".into());
    let bundle = bundle_plan(neutered, &raw, raw_1890.as_ref(), &notes, &notes_1890);
    let (all, total) = write_edition(&out_dir, &bundle)?;
    println!("client bundle ({}): {} KB of chapter JSON, archive {} KB brotli, in {out_dir}", bundle.ed.unwrap_or("1961"), total / 1024, fs::metadata(format!("{out_dir}/all.json.br"))?.len() / 1024);

    // The 1890 edition beside it (docs/EDITION.md): the same files for the web and the server under bible1890/, and for
    // the apps, which bundle the 1961 files, only what differs: notes/<book>.json (overlay_entry per chapter), meta.json
    // (a version of the 1890 data, whether it has its own text and notices) and notices.json (data/notices_1890.json, or null).
    let dir_1890 = format!("{out_dir}1890");
    let (all_1890, total_1890) = write_edition(&dir_1890, &Bundle { raw: raw_1890.as_ref().unwrap_or(&raw), notes: &notes_1890, ed: Some("1890") })?;
    fs::create_dir_all(format!("{dir_1890}/notes"))?;
    let by_key: HashMap<(i64, i64), &serde_json::Value> = all.iter().map(|c| ((c["book"].as_i64().unwrap_or(0), c["c"].as_i64().unwrap_or(0)), c)).collect();
    let mut books: std::collections::BTreeMap<i64, serde_json::Map<String, serde_json::Value>> = std::collections::BTreeMap::new();
    for c in &all_1890 {
        if neutered { break }
        let (b, n) = (c["book"].as_i64().unwrap_or(0), c["c"].as_i64().unwrap_or(0));
        let book = books.entry(b).or_default();
        let entry = match by_key.get(&(b, n)) { Some(c61) => overlay_entry(c61, c), None => Some(serde_json::json!({ "chapter": c })) };
        if let Some(e) = entry { book.insert(n.to_string(), e); }
    }
    let mut overlay_bytes = 0;
    for b in raw.books.iter().map(|b| b.n) {
        let json = serde_json::to_vec(&books.remove(&b).unwrap_or_default())?;
        overlay_bytes += json.len();
        fs::write(format!("{dir_1890}/notes/{b}.json"), json)?;
    }
    let notices = fs::read_to_string(format!("{data}/notices_1890.json")).ok();
    if let Some(n) = &notices { serde_json::from_str::<serde_json::Value>(n).context("data/notices_1890.json")?; }
    let notices_json = notices.clone().unwrap_or_else(|| "null".into());
    fs::write(format!("{dir_1890}/notices.json"), &notices_json)?;
    let mut hash = sha2::Sha256::new();
    for c in &all_1890 { hash.update(serde_json::to_vec(c)?); }
    hash.update(notices_json.as_bytes());
    let version: String = hash.finalize()[..6].iter().map(|b| format!("{b:02x}")).collect();
    fs::write(format!("{dir_1890}/meta.json"), serde_json::to_vec(&serde_json::json!({ "v": version, "text": raw_1890.is_some(), "notices": notices.is_some() }))?)?;
    println!("1890 bundle: {} KB of chapter JSON in {dir_1890}; app overlay {} KB; version {version}", total_1890 / 1024, overlay_bytes / 1024);

    // The other languages' Bibles (docs/LANGUAGES.md): the same files under bible-<lang>/ for the web, the server and the
    // apps' bundle, with map.json (where their numbers differ) and meta.json (a version, in their URLs).
    for (lang, t) in &texts {
        let dir = format!("{out_dir}-{lang}");
        let files = lang_chapter_files(lang, t, &raw);
        let total = write_bundle(&dir, &files, None)?;
        let map = lang_verse_map(t);
        fs::write(format!("{dir}/map.json"), serde_json::to_vec(&map)?)?;
        let mut hash = sha2::Sha256::new();
        for c in &files { hash.update(serde_json::to_vec(c)?); }
        let version: String = hash.finalize()[..6].iter().map(|b| format!("{b:02x}")).collect();
        fs::write(format!("{dir}/meta.json"), serde_json::to_vec(&serde_json::json!({ "v": version }))?)?;
        println!("{lang} bundle: {} KB of chapter JSON in {dir}; {} chapters numbered differently; version {version}", total / 1024, map.len());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tagged(words: &[(&str, &str)]) -> Vec<(String, String)> { words.iter().map(|(w, c)| (w.to_string(), c.to_string())).collect() }
    fn verse(v: i64, t: &str) -> RawVerse { RawVerse { v, t: t.into(), h: None, p: None, s: None, hd: None } }
    fn tiny() -> Raw { Raw { books: vec![RawBook { n: 1, chapters: vec![RawChapter { c: 1, title: None, division: None, verses: vec![verse(1, "In the beginning ·God created"), verse(2, "And the earth was waste")] }] }] } }

    #[test]
    fn each_edition_has_its_notes_and_the_glyph_glosses() {
        let dir = std::env::temp_dir().join(format!("berean-build-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("notes_1890.json");
        fs::write(&path, r#"{"1.1.2":[{"m":"a","i":3,"w":"earth","t":"Or 'land.'"}],"1.1.1":[{"m":"b","i":4,"w":"created","t":"A note of 1890."}]}"#).unwrap();
        let base: HashMap<String, Vec<RawNote>> = serde_json::from_str(r#"{"1.1.1":[{"m":"°","i":3,"t":"Elohim"}],"1.1.2":[{"m":"°","i":1,"t":"x"}]}"#).unwrap();
        let (notes, glyphs) = edition_notes(&tiny(), &base, read_notes(path.to_str().unwrap()).unwrap());
        assert_eq!(glyphs, 1);
        let at = |k: &str| notes[k].iter().map(|n| (n.m.as_str(), n.i, n.t.as_str())).collect::<Vec<_>>();
        // ebible's ° gloss goes; the El of ·God comes from the text, before the lettered note at a later word
        assert_eq!(at("1.1.1"), [("·", 3, "El"), ("b", 4, "A note of 1890.")]);
        assert_eq!(at("1.1.2"), [("a", 3, "Or 'land.'")]);
        // no file: the glyph glosses alone
        let (none, _) = edition_notes(&tiny(), &base, read_notes(dir.join("absent.json").to_str().unwrap()).unwrap());
        assert_eq!(none["1.1.1"].iter().map(|n| n.m.as_str()).collect::<Vec<_>>(), ["·"]);
        assert!(none["1.1.2"].is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_app_overlay_carries_notes_only_unless_the_text_differs() {
        let raw = tiny();
        let base = HashMap::new();
        let (n61, _) = edition_notes(&raw, &base, serde_json::from_str(r#"{"1.1.2":[{"m":"c","i":2,"t":"1961"}]}"#).unwrap());
        let (n90, _) = edition_notes(&raw, &base, serde_json::from_str(r#"{"1.1.2":[{"m":"a","i":3,"t":"1890"}]}"#).unwrap());
        let c61 = &chapter_files(&raw, &n61, None)[0];
        let c90 = &chapter_files(&raw, &n90, Some("1890"))[0];
        assert_eq!(c90["ed"], "1890");
        assert!(c61.get("ed").is_none());
        let e = overlay_entry(c61, c90).unwrap();
        assert!(e.get("chapter").is_none());
        assert_eq!(e["notes"]["2"][0]["text"], "1890");
        assert_eq!(e["notes"]["1"][0]["marker"], "·");
        // the same notes in both: still the 1890 ones (the overlay replaces a verse's notes whole)
        assert!(overlay_entry(c61, &chapter_files(&raw, &n61, Some("1890"))[0]).is_some());
        // a different text: the whole chapter
        let mut other = tiny();
        other.books[0].chapters[0].verses[1].t = "And the earth was without form".into();
        let c_other = &chapter_files(&other, &n90, Some("1890"))[0];
        assert_eq!(overlay_entry(c61, c_other).unwrap()["chapter"], *c_other);
        // no notes and the same text: nothing to carry
        assert!(overlay_entry(c61, &chapter_files(&raw, &HashMap::new(), Some("1890"))[0]).is_none());
    }

    #[test]
    fn a_neutered_bundle_has_no_1961_note() {
        let raw = tiny();
        let base = HashMap::new();
        let (n61, _) = edition_notes(&raw, &base, serde_json::from_str(r#"{"1.1.2":[{"m":"c","i":2,"t":"A note of the 1961 editors."}]}"#).unwrap());
        let (n90, _) = edition_notes(&raw, &base, serde_json::from_str(r#"{"1.1.2":[{"m":"a","i":3,"t":"Mr. Darby's own."}]}"#).unwrap());
        let b = bundle_plan(true, &raw, None, &n61, &n90);
        let files = chapter_files(b.raw, b.notes, b.ed);
        let text = serde_json::to_string(&files).unwrap();
        assert!(!text.contains("1961 editors") && text.contains("Mr. Darby's own.") && files[0]["ed"] == "1890", "{text}");
        let index = footnote_index(b.raw, b.notes);
        assert!(index.words.contains_key("earth") && !index.words.contains_key("the"), "the index of a neutered bundle has the 1890 note's word only: {index:?}");
        // the 1890 text, when there is one, is the bundle's text
        let mut own = tiny();
        own.books[0].chapters[0].verses[1].t = "And the earth was without form".into();
        let b = bundle_plan(true, &raw, Some(&own), &n61, &n90);
        assert!(serde_json::to_string(&chapter_files(b.raw, b.notes, b.ed).to_vec()).unwrap().contains("without form"));
        // unset: the 1961 bundle as always, no `ed`
        let b = bundle_plan(false, &raw, Some(&own), &n61, &n90);
        let files = chapter_files(b.raw, b.notes, b.ed);
        assert!(serde_json::to_string(&files).unwrap().contains("1961 editors") && files[0].get("ed").is_none());
        let index = footnote_index(b.raw, b.notes);
        assert!(index.words.contains_key("the") && !index.words.contains_key("earth"), "the 1961 bundle's index has the 1961 note's word: {index:?}");
    }

    fn note(m: &str, i: i64, w: &str, t: &str) -> RawNote { RawNote { m: m.into(), i, w: w.into(), t: t.into() } }

    #[test]
    fn a_footnote_is_listed_under_the_word_its_marker_follows() {
        let raw = Raw { books: vec![RawBook { n: 41, chapters: vec![RawChapter { c: 6, title: None, division: None, verses: vec![verse(21, "made a supper to his great men and to the chiliarchs and to the first of Galilee")] }] }] };
        let notes = HashMap::from([("41.6.21".to_string(), vec![note("c", 7, "men", "Lit. 'great ones.'"), note("d", 11, "chiliarchs", "Commanders of 1,000 men.")])]);
        let index = footnote_index(&raw, &notes);
        assert_eq!(index.words.keys().collect::<Vec<_>>(), ["chiliarchs", "men"]);
        assert_eq!(index.words["chiliarchs"], [[41, 6, 21, 1, 1]]);
        assert_eq!(index.words["men"], [[41, 6, 21, 0, 0]]);
        assert_eq!((index.listed, index.on_no_word), (2, 0));
    }

    #[test]
    fn the_scans_word_is_a_second_key_only_when_clean_spelt_otherwise_and_ending_with_the_readers() {
        fn on(text: &str, w: &str) -> Vec<String> {
            let reader = reader_words(text);
            let n = note("a", reader.len() as i64, w, "");
            note_words(&reader, &n).into_iter().map(String::from).collect()
        }
        assert_eq!(on("and called it Beer-sheba", "Beer-sheba"), ["sheba", "Beer-sheba"]);
        assert_eq!(on("Jesus the Nazaræan", "Nazaræan"), ["an", "Nazaræan"]);
        assert_eq!(on("Jesus the Nazaræan", "Nazaraean"), ["an", "Nazaraean"]);
        assert_eq!(on("the chiliarch", "Chiliarch"), ["chiliarch"]);
        assert_eq!(on("the chiliarch", ""), ["chiliarch"]);
        assert_eq!(on("If a damsel that is a", "virgin"), ["a"], "a scan word one word off is not a key (5.22.14)");
        assert_eq!(on("the house of God", "ùGod"), ["God"]);
        assert_eq!(on("my confidence", "confidence]"), ["confidence"]);
        assert!(note_words(&reader_words("Beer-sheba"), &note("a", 0, "Beer-sheba", "")).is_empty(), "at a verse's start a note is on no word");
        assert!(note_words(&reader_words("Beer-sheba"), &note("a", 3, "Beer-sheba", "")).is_empty(), "past the verse's last word a note is on no word");
        let raw = Raw { books: vec![RawBook { n: 1, chapters: vec![RawChapter { c: 21, title: None, division: None, verses: vec![verse(31, "Therefore he called that place Beer-sheba")] }] }] };
        let index = footnote_index(&raw, &HashMap::from([("1.21.31".to_string(), vec![note("a", 7, "Beer-sheba", "Well of the oath."), note("b", 0, "Therefore", "x")])]));
        assert_eq!(index.words["Beer-sheba"], [[1, 21, 31, 0, 0]]);
        assert_eq!(index.words["sheba"], [[1, 21, 31, 0, 0]]);
        assert_eq!((index.listed, index.on_no_word), (1, 1));
    }

    #[test]
    fn glosses_are_not_footnotes_but_count_in_the_place() {
        let raw = tiny();
        let (notes, _) = edition_notes(&raw, &HashMap::new(), serde_json::from_str(r#"{"1.1.1":[{"m":"b","i":5,"w":"created","t":"A note."}]}"#).unwrap());
        let index = footnote_index(&raw, &notes);
        assert_eq!(index.words.keys().collect::<Vec<_>>(), ["created"]);
        assert_eq!(index.words["created"], [[1, 1, 1, 1, 0]]);
        assert_eq!(chapter_files(&raw, &notes, None)[0]["verses"][0]["notes"][1]["marker"], "b");
    }

    #[test]
    fn identical_texts_share_one_id_numbered_in_bible_order() {
        let notes = HashMap::from([
            ("1.1.1".to_string(), vec![note("a", 3, "beginning", "Or 'land.'"), note("b", 5, "created", "Or 'made.'")]),
            ("1.1.2".to_string(), vec![note("a", 3, "earth", "Or 'land.'")]),
        ]);
        let index = footnote_index(&tiny(), &notes);
        assert_eq!((index.words["beginning"][0][4], index.words["created"][0][4], index.words["earth"][0][4]), (0, 1, 0));
    }

    #[test]
    fn every_entry_names_a_lettered_note_of_the_chapter_files_written_beside_it() {
        let dir = std::env::temp_dir().join(format!("berean-footnotes-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let raw = tiny();
        let (notes, _) = edition_notes(&raw, &HashMap::new(), serde_json::from_str(r#"{"1.1.1":[{"m":"a","i":3,"w":"beginning","t":"x"},{"m":"b","i":5,"w":"created","t":"y"}],"1.1.2":[{"m":"c","i":0,"w":"","t":"z"},{"m":"d","i":3,"w":"earth","t":"x"}]}"#).unwrap());
        let dir_s = dir.to_str().unwrap();
        write_edition(dir_s, &bundle_plan(false, &raw, None, &notes, &HashMap::new())).unwrap();
        let read = |p: &str| -> serde_json::Value { serde_json::from_str(&fs::read_to_string(dir.join(p)).unwrap()).unwrap() };
        let index: std::collections::BTreeMap<String, Vec<[i64; 5]>> = serde_json::from_value(read("footnotes.json")).unwrap();
        assert_eq!(index.keys().collect::<Vec<_>>(), ["beginning", "created", "earth"]);
        for (word, entries) in &index {
            for &[b, c, v, i, _] in entries {
                let verse = read(&format!("{b}/{c}.json"))["verses"].as_array().unwrap().iter().find(|x| x["v"] == v).unwrap().clone();
                let n = &verse["notes"][i as usize];
                assert!(lettered(n["marker"].as_str().unwrap()), "{word}: {n}");
                assert_eq!(reader_words(verse["t"].as_str().unwrap())[n["pos"].as_i64().unwrap() as usize - 1], word);
            }
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tags_follow_their_words_not_their_positions() {
        // John 3:2: ebible's list lacks "thou art", so "teacher" is its 17th entry and our 19th word
        let text = "he came to him by night, and said to him, Rabbi, we know that thou art come a teacher from God";
        let ours = reader_words(text);
        let theirs = tagged(&[("he", ""), ("came", "G2064"), ("to", ""), ("him", ""), ("by", ""), ("night", "G3571"), ("and", ""), ("said", ""), ("to", ""), ("him", ""), ("Rabbi", "G4461"), ("we", ""), ("know", "G1492"), ("that", ""), ("come", "G2064"), ("a", ""), ("teacher", "G1320"), ("from", ""), ("God", "G2316")]);
        let (rows, paired) = align_tags(text, &theirs);
        assert_eq!((rows.len(), paired), (ours.len(), 7));
        assert!(rows.iter().zip(&ours).all(|((w, _), o)| w == o));
        let at = |w: &str| rows[ours.iter().position(|x| *x == w).unwrap()].1.as_str();
        assert_eq!((at("teacher"), at("come"), at("God"), at("thou"), at("art")), ("G1320", "G2064", "G2316", "", ""));
        // a word only they have takes its tag with it; case does not matter
        let (rows, paired) = align_tags("Abraham begat Isaac", &tagged(&[("abraham", "G11"), ("fathered", "G1080"), ("Isaac", "G2464")]));
        assert_eq!((rows.iter().map(|(_, c)| c.as_str()).collect::<Vec<_>>(), paired), (vec!["G11", "", "G2464"], 2));
        assert_eq!(reader_words("Jesus’ disciples, don't"), ["Jesus’", "disciples", "don't"]);
    }

    #[test]
    fn a_word_the_reader_splits_is_one_occurrence() {
        // ebible writes "father-in-law" and "Caesarea" whole, and the fill "glad tidings"; the reader splits them at the
        // hyphens, the æ and the space. Each piece carries the number, and the first holds the word as printed
        let at = |text: &str, theirs: &[(&str, &str)]| align_tags(text, &tagged(theirs)).0;
        let pair = |w: &str, c: &str| (w.to_string(), c.to_string());
        assert_eq!(at("thy father-in-law is going up", &[("thy", ""), ("father-in-law", "H2524"), ("going", "H5927"), ("up", "")]),
            [pair("thy", ""), pair("father-in-law", "H2524"), pair("", "H2524"), pair("", "H2524"), pair("is", ""), pair("going", "H5927"), pair("up", "")]);
        assert_eq!(at("till he came to Cæsarea.", &[("till", "G2193"), ("came", "G2064"), ("Caesarea", "G2542")]),
            [pair("till", "G2193"), pair("he", ""), pair("came", "G2064"), pair("to", ""), pair("Cæsarea", "G2542"), pair("", "G2542")]);
        assert_eq!(at("a certain man, Æneas by name", &[("certain", "G5100"), ("man", "G444"), ("Aeneas", "G132"), ("name", "G3686")]),
            [pair("a", ""), pair("certain", "G5100"), pair("man", "G444"), pair("Æneas", "G132"), pair("by", ""), pair("name", "G3686")]);
        assert_eq!(at("to announce glad tidings to the poor", &[("announce", "G2097"), ("glad tidings", "G2098"), ("poor", "G4434")]),
            [pair("to", ""), pair("announce", "G2097"), pair("glad tidings", "G2098"), pair("", "G2098"), pair("to", ""), pair("the", ""), pair("poor", "G4434")]);
        // "Verily, verily" is two tags, two occurrences
        assert_eq!(at("Verily, verily, I say", &[("Verily", "G281"), ("verily", "G281"), ("say", "G3004")]),
            [pair("Verily", "G281"), pair("verily", "G281"), pair("I", ""), pair("say", "G3004")]);
    }
}
