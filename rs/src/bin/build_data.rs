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
#[derive(Deserialize, Clone)] struct RawNote { m: String, i: i64, t: String }
#[derive(Deserialize)] struct StrongsEntry { lemma: String, translit: String, pron: String, kjv: String }

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

/// words.json lists only the words ebible wrapped in `\w`, from ebible's own copy of the text, so its n-th entry is not
/// the n-th word of ours (Matt 1:2 there has no "begat"; John 3:2 has no "thou art"), and a tag read by position landed
/// on the wrong word more than half the time. Each tag moves to the word it pairs with in a longest common subsequence
/// of the two lists (case-folded); a tag whose word has no partner in our text is dropped. Returns one code per word
/// of `ours`, "" where it carries none.
fn align_tags(ours: &[&str], theirs: &[(String, String)]) -> Vec<String> {
    let (n, m) = (ours.len(), theirs.len());
    let a: Vec<String> = ours.iter().map(|w| w.to_lowercase()).collect();
    let b: Vec<String> = theirs.iter().map(|(w, _)| w.to_lowercase()).collect();
    // lcs[i][j]: the longest common subsequence of a[i..] and b[j..]
    let mut lcs = vec![vec![0u16; m + 1]; n + 1];
    for i in (0..n).rev() { for j in (0..m).rev() { lcs[i][j] = if a[i] == b[j] { lcs[i + 1][j + 1] + 1 } else { lcs[i + 1][j].max(lcs[i][j + 1]) }; } }
    let mut out = vec![String::new(); n];
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if a[i] == b[j] { out[i] = theirs[j].1.clone(); i += 1; j += 1; }
        else if lcs[i + 1][j] >= lcs[i][j + 1] { i += 1 } else { j += 1 }
    }
    out
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
                    notes.entry(key.clone()).or_default().push(RawNote { m: m.into(), i: word_index_at(&v.t, at), t: t.into() });
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
                    let ours = reader_words(&text);
                    let codes = align_tags(&ours, ws);
                    tags_kept += codes.iter().filter(|c| !c.is_empty()).count();
                    tags_all += ws.iter().filter(|(_, c)| !c.is_empty()).count();
                    for (i, (w, c)) in ours.iter().zip(&codes).enumerate() { ins_w.execute(params![id, i as i64, w, c])?; }
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

/// What the client bundle under `client/public/bible` carries: the 1961 edition (its notes, no `ed` mark), or with
/// BEREAN_NEUTERED=1 the 1890 edition (its notes, every chapter marked `ed: "1890"`), so an app built from it holds no
/// 1961 note at all. The 1890 overlay the apps lay over the bundle is then empty: there is nothing to differ from.
fn bundle_plan<'a>(neutered: bool, raw: &'a Raw, raw_1890: Option<&'a Raw>, notes: &'a HashMap<String, Vec<RawNote>>, notes_1890: &'a HashMap<String, Vec<RawNote>>) -> (&'a Raw, &'a HashMap<String, Vec<RawNote>>, Option<&'static str>) {
    if neutered { (raw_1890.unwrap_or(raw), notes_1890, Some("1890")) } else { (raw, notes, None) }
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
    tx.execute("INSERT INTO meta (key, value) VALUES ('built_at', ?1)", params![db::now_iso()])?;
    tx.commit()?;
    conn.execute_batch("VACUUM; PRAGMA journal_mode = WAL;")?;
    drop(conn);
    println!("wrote {out_db} ({} MB)", fs::metadata(&out_db)?.len() / 1_048_576);

    // Client bundles: one small JSON per chapter (public/bible/NN/C.json, what the reader fetches) and a
    // single archive of every chapter (public/bible/all.json) that "Download all" unpacks into the Cache API.
    // Vite copies public/ into dist/, the .br siblings are streamed as-is to clients that accept brotli.
    let out_dir = std::env::var("BEREAN_PUBLIC").unwrap_or_else(|_| "client/public/bible".into());
    let br = |path: &str, bytes: &[u8]| -> Result<()> {
        fs::write(path, bytes)?;
        let mut f = fs::File::create(format!("{path}.br"))?;
        let mut enc = brotli::CompressorWriter::new(&mut f, 4096, 11, 22);
        enc.write_all(bytes)?; enc.flush()?; Ok(())
    };
    // `ed` in the archive: absent for 1961 as before, so its files do not change
    let write_bundle = |dir: &str, chapters: &[serde_json::Value], ed: Option<&str>| -> Result<u64> {
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
    };
    let (bundle_raw, bundle_notes, bundle_ed) = bundle_plan(neutered, &raw, raw_1890.as_ref(), &notes, &notes_1890);
    let all = chapter_files(bundle_raw, bundle_notes, bundle_ed);
    let total = write_bundle(&out_dir, &all, bundle_ed)?;
    println!("client bundle ({}): {} KB of chapter JSON, archive {} KB brotli, in {out_dir}", bundle_ed.unwrap_or("1961"), total / 1024, fs::metadata(format!("{out_dir}/all.json.br"))?.len() / 1024);

    // The 1890 edition beside it (docs/EDITION.md): the same files for the web and the server under bible1890/, and for
    // the apps, which bundle the 1961 files, only what differs: notes/<book>.json (overlay_entry per chapter), meta.json
    // (a version of the 1890 data, whether it has its own text and notices) and notices.json (data/notices_1890.json, or null).
    let dir_1890 = format!("{out_dir}1890");
    let all_1890 = chapter_files(raw_1890.as_ref().unwrap_or(&raw), &notes_1890, Some("1890"));
    let total_1890 = write_bundle(&dir_1890, &all_1890, Some("1890"))?;
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
        let (r, n, ed) = bundle_plan(true, &raw, None, &n61, &n90);
        let files = chapter_files(r, n, ed);
        let text = serde_json::to_string(&files).unwrap();
        assert!(!text.contains("1961 editors") && text.contains("Mr. Darby's own.") && files[0]["ed"] == "1890", "{text}");
        // the 1890 text, when there is one, is the bundle's text
        let mut own = tiny();
        own.books[0].chapters[0].verses[1].t = "And the earth was without form".into();
        let (r, _, _) = bundle_plan(true, &raw, Some(&own), &n61, &n90);
        assert!(serde_json::to_string(&chapter_files(r, n, ed).to_vec()).unwrap().contains("without form"));
        // unset: the 1961 bundle as always, no `ed`
        let (r, n, ed) = bundle_plan(false, &raw, Some(&own), &n61, &n90);
        let files = chapter_files(r, n, ed);
        assert!(serde_json::to_string(&files).unwrap().contains("1961 editors") && files[0].get("ed").is_none());
    }

    #[test]
    fn tags_follow_their_words_not_their_positions() {
        // John 3:2: ebible's list lacks "thou art", so "teacher" is its 17th entry and our 19th word
        let ours = reader_words("he came to him by night, and said to him, Rabbi, we know that thou art come a teacher from God");
        let theirs = tagged(&[("he", ""), ("came", "G2064"), ("to", ""), ("him", ""), ("by", ""), ("night", "G3571"), ("and", ""), ("said", ""), ("to", ""), ("him", ""), ("Rabbi", "G4461"), ("we", ""), ("know", "G1492"), ("that", ""), ("come", "G2064"), ("a", ""), ("teacher", "G1320"), ("from", ""), ("God", "G2316")]);
        let codes = align_tags(&ours, &theirs);
        assert_eq!(codes.len(), ours.len());
        let at = |w: &str| codes[ours.iter().position(|x| *x == w).unwrap()].as_str();
        assert_eq!((at("teacher"), at("come"), at("God"), at("thou"), at("art")), ("G1320", "G2064", "G2316", "", ""));
        // a word only they have takes its tag with it; case does not matter
        let codes = align_tags(&reader_words("Abraham begat Isaac"), &tagged(&[("abraham", "G11"), ("fathered", "G1080"), ("Isaac", "G2464")]));
        assert_eq!(codes, ["G11", "", "G2464"]);
        assert_eq!(reader_words("Jesus’ disciples, don't"), ["Jesus’", "disciples", "don't"]);
    }
}
