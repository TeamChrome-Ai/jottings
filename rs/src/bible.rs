//! Scripture reads. Everything here is read-only after `build-data`.
use crate::edition::Tables;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

#[derive(Serialize)]
pub struct Note { pub id: i64, pub marker: String, pub pos: i64, pub text: String }

#[derive(Serialize)]
pub struct Verse {
    pub v: i64,
    pub t: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub h: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub p: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")] pub s: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")] pub hd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub notes: Option<Vec<Note>>,
    #[serde(skip_serializing_if = "Option::is_none")] pub words: Option<Vec<(String, String)>>,
}

#[derive(Serialize)]
pub struct Chapter {
    pub book: i64, pub c: i64,
    #[serde(skip_serializing_if = "Option::is_none")] pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub division: Option<u8>,
    pub words: i64,
    pub verses: Vec<Verse>,
}

/// A chapter of the edition `t` names (edition::tables): its text, notes and Strong's tags.
pub fn get_chapter(conn: &rusqlite::Connection, t: &Tables, book: i64, chapter: i64, with_words: bool) -> rusqlite::Result<Option<Chapter>> {
    let meta: Option<(Option<String>, i64, i64)> = conn
        .prepare_cached(&format!("SELECT title, division, words FROM {} WHERE book=?1 AND chapter=?2", t.chapters))?
        .query_row(params![book, chapter], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()?;
    let Some((title, division, words_total)) = meta else { return Ok(None) };
    let mut st = conn.prepare_cached(&format!("SELECT id, verse, text, html, para, strophe, head FROM {} WHERE book=?1 AND chapter=?2 ORDER BY verse", t.verses))?;
    let mut notes_st = conn.prepare_cached(&format!("SELECT id, marker, word_index, text FROM {} WHERE verse_id=?1 ORDER BY word_index, id", t.notes))?;
    let mut words_st = conn.prepare_cached(&format!("SELECT word, strongs FROM {} WHERE verse_id=?1 ORDER BY word_index", t.words))?;
    let rows = st.query_map(params![book, chapter], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, i64>(4)?, r.get::<_, i64>(5)?, r.get::<_, Option<String>>(6)?)))?;
    let mut verses = Vec::with_capacity(40);
    for row in rows {
        let (id, v, t, h, para, strophe, head) = row?;
        let notes: Vec<Note> = notes_st.query_map(params![id], |r| Ok(Note { id: r.get(0)?, marker: r.get(1)?, pos: r.get(2)?, text: r.get(3)? }))?.collect::<Result<_, _>>()?;
        let words = if with_words {
            let w: Vec<(String, String)> = words_st.query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
            if w.is_empty() { None } else { Some(w) }
        } else { None };
        verses.push(Verse { v, t, h, p: (para != 0).then_some(1), s: (strophe != 0).then_some(1), hd: head, notes: (!notes.is_empty()).then_some(notes), words });
    }
    Ok(Some(Chapter { book, c: chapter, title, division: (division != 0).then_some(1), words: words_total, verses }))
}

pub fn verse_counts(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<Vec<i64>>> {
    let mut out: Vec<Vec<i64>> = crate::books::BOOKS.iter().map(|b| vec![0; b.chapters as usize]).collect();
    let mut st = conn.prepare("SELECT book, chapter, verse_count FROM chapters")?;
    for r in st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))? {
        let (b, c, n) = r?;
        if let Some(bk) = out.get_mut((b - 1) as usize) { if let Some(slot) = bk.get_mut((c - 1) as usize) { *slot = n; } }
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct RangeVerse { pub verse: i64, pub text: String, #[serde(skip_serializing_if = "Option::is_none")] pub html: Option<String> }

pub fn get_range(conn: &rusqlite::Connection, t: &Tables, book: i64, chapter: i64, v1: i64, v2: i64) -> rusqlite::Result<Vec<RangeVerse>> {
    let mut st = conn.prepare_cached(&format!("SELECT verse, text, html FROM {} WHERE book=?1 AND chapter=?2 AND verse BETWEEN ?3 AND ?4 ORDER BY verse", t.verses))?;
    let rows_ = st.query_map(params![book, chapter, v1, v2], |r| Ok(RangeVerse { verse: r.get(0)?, text: r.get(1)?, html: r.get(2)? }))?.collect(); rows_
}

/// ¾ of a 250 wpm read, clamped 45 s – 240 s.
/// A fast reader's pace, and the least and most time a chapter can need: `shared/reading.ts` holds the same numbers.
pub const READ_WPM: f64 = 250.0;
pub const READ_MIN_SECONDS: i64 = 45;
pub const READ_MAX_SECONDS: i64 = 600;

/// Active seconds a chapter of `words` needs before it counts as read.
pub fn required_seconds(words: i64) -> i64 { ((words as f64 / READ_WPM * 60.0).round() as i64).clamp(READ_MIN_SECONDS, READ_MAX_SECONDS) }

/// From the chapter's word count in scripture.db; a chapter it does not know is taken as 1000 words.
pub fn chapter_required_seconds(conn: &rusqlite::Connection, book: i64, chapter: i64) -> i64 {
    let words: i64 = conn.prepare_cached("SELECT words FROM chapters WHERE book=?1 AND chapter=?2").and_then(|mut st| st.query_row(params![book, chapter], |r| r.get(0))).unwrap_or(1000);
    required_seconds(words)
}

/// One number's page of Strong's Exhaustive Concordance (1890), read against Darby's text. The entry is what Strong
/// himself gives for the number: the word, its transliteration and pronunciation, and its renderings in the KJV
/// (`kjv`, his list as printed; it carries no counts). The rest is the concordance proper, from `verse_words`: how
/// Darby renders the word (`renderings`, spellings folded by case, most used first), every tagged occurrence counted
/// per book in canonical order (`books`), and one page of the verses holding it (`page`).
#[derive(Serialize)]
pub struct StrongsInfo {
    pub code: String, pub lemma: Option<String>, pub translit: Option<String>, pub pron: Option<String>, pub kjv: Option<String>,
    pub renderings: Vec<(String, i64)>,
    /// tagged words, and the verses holding them (a verse can hold the word twice)
    pub occurrences: i64, pub verses: i64,
    pub books: Vec<StrongsBook>,
    pub offset: i64,
    pub page: Vec<Occurrence>,
}
#[derive(Serialize, Debug, PartialEq)]
pub struct StrongsBook { pub book: i64, pub occurrences: i64, pub verses: i64 }
/// A verse holding the number; `w` lists the word indexes (the reader's tokenizer, as `verse_words.word_index`) of
/// the words tagged with it, so the client can set them apart.
#[derive(Serialize, Debug)]
pub struct Occurrence { pub book: i64, pub chapter: i64, pub verse: i64, pub text: String, pub w: Vec<i64> }

/// `code` as the tags spell it (upper case, no zero padding: "h0430" is H430). Every `verse_words.strongs` value is a
/// single code (see the test below), so an exact match finds every occurrence and nothing else: H430 is not H4300.
pub fn strongs_info(conn: &rusqlite::Connection, t: &Tables, code: &str, limit: i64, offset: i64) -> rusqlite::Result<StrongsInfo> {
    let (lemma, translit, pron, kjv) = conn
        .prepare_cached("SELECT lemma, translit, pron, kjv FROM strongs WHERE code=?1")?
        .query_row(params![code], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .optional()?
        .unwrap_or((None, None, None, None));
    // `strongs <> ''` lets SQLite use the partial indexes on verse_words
    let mut st = conn.prepare_cached(&format!("SELECT verse_id / 1000000, count(*), count(DISTINCT verse_id) FROM {} WHERE strongs=?1 AND strongs <> '' GROUP BY 1 ORDER BY 1", t.words))?;
    let books: Vec<StrongsBook> = st.query_map(params![code], |r| Ok(StrongsBook { book: r.get(0)?, occurrences: r.get(1)?, verses: r.get(2)? }))?.collect::<Result<_, _>>()?;
    let mut st = conn.prepare_cached(&format!("SELECT word, count(*) FROM {} WHERE strongs=?1 AND strongs <> '' GROUP BY word", t.words))?;
    let spelled: Vec<(String, i64)> = st.query_map(params![code], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    let mut st = conn.prepare_cached(&format!("SELECT DISTINCT verse_id FROM {} WHERE strongs=?1 AND strongs <> '' ORDER BY verse_id LIMIT ?2 OFFSET ?3", t.words))?;
    let ids: Vec<i64> = st.query_map(params![code, limit, offset], |r| r.get(0))?.collect::<Result<_, _>>()?;
    let mut vs = conn.prepare_cached(&format!("SELECT book, chapter, verse, text FROM {} WHERE id=?1", t.verses))?;
    let mut ws = conn.prepare_cached(&format!("SELECT word_index FROM {} WHERE verse_id=?1 AND strongs=?2 ORDER BY word_index", t.words))?;
    let mut page = Vec::with_capacity(ids.len());
    for id in ids {
        let Some((book, chapter, verse, text)) = vs.query_row(params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional()? else { continue };
        let w = ws.query_map(params![id, code], |r| r.get(0))?.collect::<Result<_, _>>()?;
        page.push(Occurrence { book, chapter, verse, text, w });
    }
    Ok(StrongsInfo {
        code: code.to_string(), lemma, translit, pron, kjv,
        renderings: fold_renderings(spelled),
        occurrences: books.iter().map(|b| b.occurrences).sum(), verses: books.iter().map(|b| b.verses).sum(),
        books, offset, page,
    })
}

/// The Strong's numbers behind an English word of Darby's text, most tagged first: `verse_words` rows whose word
/// is `word` in any case (the tags keep the printed spelling: "Propitiation" opening a sentence, "propitiation"; the
/// `verse_words_word` index answers it). A
/// word of the ministry has no tag of its own; this is how the sheet finds "the word" for it. Empty when Darby never
/// renders a tagged word so.
#[derive(Serialize, Debug, PartialEq)]
pub struct WordCode { pub code: String, pub count: i64, pub lemma: Option<String> }
pub fn word_codes(conn: &rusqlite::Connection, t: &Tables, word: &str) -> rusqlite::Result<Vec<WordCode>> {
    let w = word.trim();
    if w.is_empty() || w.len() > 40 { return Ok(vec![]) }
    let mut st = conn.prepare_cached(&format!("SELECT v.strongs, count(*), s.lemma FROM {} v LEFT JOIN strongs s ON s.code = v.strongs WHERE v.strongs <> '' AND v.word = ?1 COLLATE NOCASE GROUP BY v.strongs ORDER BY 2 DESC, 1", t.words))?;
    let codes = st.query_map(params![w], |r| Ok(WordCode { code: r.get(0)?, count: r.get(1)?, lemma: r.get(2)? }))?.collect();
    codes
}

/// Spellings of one rendering that differ only in case ("Teacher" opening a sentence, "teacher") count together under
/// the commonest spelling; the result is most used first, then alphabetical.
fn fold_renderings(spelled: Vec<(String, i64)>) -> Vec<(String, i64)> {
    let mut by: std::collections::HashMap<String, (String, i64, i64)> = std::collections::HashMap::new();
    for (word, n) in spelled {
        let e = by.entry(word.to_lowercase()).or_insert_with(|| (word.clone(), 0, 0));
        e.1 += n;
        if n > e.2 { e.0 = word; e.2 = n; }
    }
    let mut out: Vec<(String, i64)> = by.into_values().map(|(w, n, _)| (w, n)).collect();
    out.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.to_lowercase().cmp(&b.0.to_lowercase())));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edition::T1961;
    fn conn() -> rusqlite::Connection {
        rusqlite::Connection::open_with_flags(crate::testkit::seed(), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).expect("data/scripture.db")
    }

    #[test]
    fn word_codes_finds_the_numbers_behind_a_rendering() {
        let c = conn();
        let codes = word_codes(&c, &T1961, "propitiation").unwrap();
        // Darby's "propitiation" renders hilasmos (1 John 2:2; 4:10) and hilasterion (Rom 3:25), Greek only
        assert!(codes.iter().all(|w| w.code.starts_with('G')), "{codes:?}");
        assert!(codes.iter().any(|w| w.code == "G2434"), "{codes:?}");
        assert!(codes.windows(2).all(|p| p[0].count >= p[1].count));
        assert!(codes.iter().all(|w| w.lemma.is_some()));
        // case folded: the tags keep the printed spelling
        assert_eq!(word_codes(&c, &T1961, "Propitiation").unwrap(), codes);
        assert!(word_codes(&c, &T1961, "xyzzy").unwrap().is_empty());
        assert!(word_codes(&c, &T1961, "").unwrap().is_empty());
    }

    #[test]
    fn every_tag_is_one_code() {
        // exact matching in strongs_info is exhaustive only while no word carries two codes
        let odd: i64 = conn().query_row("SELECT count(*) FROM verse_words WHERE strongs <> '' AND NOT (strongs GLOB '[HG][1-9]*' AND substr(strongs, 2) NOT GLOB '*[^0-9]*')", [], |r| r.get(0)).unwrap();
        assert_eq!(odd, 0);
    }

    #[test]
    fn word_rows_are_the_words_of_the_text() {
        // the reader reads a verse's tags by word position: row i must be the text's i-th word (see build_data align_tags)
        let c = conn();
        for (book, chapter) in [(1, 1), (40, 1), (43, 3), (19, 119)] {
            for v in get_chapter(&c, &T1961, book, chapter, true).unwrap().unwrap().verses {
                let ours: Vec<&str> = v.t.split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '\'' || ch == '’')).filter(|w| !w.is_empty()).collect();
                let rows: Vec<String> = v.words.unwrap_or_default().into_iter().map(|(w, _)| w).collect();
                assert_eq!(rows, ours, "{book} {chapter}:{}", v.v);
            }
        }
    }

    #[test]
    fn nt_number_pages_and_groups_by_book() {
        let c = conn();
        let all = strongs_info(&c, &T1961, "G1320", 1000, 0).unwrap();
        assert_eq!(all.lemma.as_deref(), Some("διδάσκαλος"));
        assert_eq!(all.pron.as_deref(), Some("did-as'-kal-os"));
        assert_eq!(all.kjv.as_deref(), Some("doctor, master, teacher"));
        let n: i64 = c.query_row("SELECT count(*) FROM verse_words WHERE strongs='G1320'", [], |r| r.get(0)).unwrap();
        let v: i64 = c.query_row("SELECT count(DISTINCT verse_id) FROM verse_words WHERE strongs='G1320'", [], |r| r.get(0)).unwrap();
        assert!(n > 40, "{n}");
        assert_eq!((all.occurrences, all.verses, all.page.len() as i64), (n, v, v));
        // books in canonical order, New Testament only, their counts adding up to the totals
        assert!(all.books.windows(2).all(|p| p[0].book < p[1].book));
        assert!(all.books.iter().all(|b| (40..=66).contains(&b.book) && b.occurrences >= b.verses && b.verses > 0));
        assert_eq!(all.books.iter().map(|b| b.verses).sum::<i64>(), v);
        assert!(all.books.iter().any(|b| b.book == 43));
        // renderings are Darby's words for it and account for every occurrence
        assert_eq!(all.renderings.iter().map(|r| r.1).sum::<i64>(), n);
        // Darby's "Teacher" (in address, 34 times) and "teacher" count as one rendering
        let teacher = all.renderings.iter().find(|(w, _)| w.eq_ignore_ascii_case("teacher")).expect("teacher");
        let spelled: i64 = c.query_row("SELECT count(*) FROM verse_words WHERE strongs='G1320' AND lower(word)='teacher'", [], |r| r.get(0)).unwrap();
        assert_eq!(teacher.1, spelled);
        assert!(all.renderings.windows(2).all(|p| p[0].1 >= p[1].1));
        // the verses in canonical order, each with the tagged word marked where the reader's tokenizer puts it
        assert!(all.page.windows(2).all(|p| (p[0].book, p[0].chapter, p[0].verse) < (p[1].book, p[1].chapter, p[1].verse)));
        let jn = all.page.iter().find(|o| (o.book, o.chapter, o.verse) == (43, 3, 2)).expect("John 3:2");
        let words: Vec<&str> = jn.text.split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '\'' || ch == '’')).filter(|w| !w.is_empty()).collect();
        assert_eq!(jn.w.iter().map(|&i| words[i as usize]).collect::<Vec<_>>(), ["teacher"]);
        // 30 at a time: the pages join into the whole list, the page past the end is empty, the totals never change
        let mut joined = Vec::new();
        for offset in (0..v).step_by(30) {
            let p = strongs_info(&c, &T1961, "G1320", 30, offset).unwrap();
            assert_eq!((p.occurrences, p.verses, p.offset), (n, v, offset));
            assert!(p.page.len() <= 30);
            joined.extend(p.page.into_iter().map(|o| (o.book, o.chapter, o.verse)));
        }
        assert_eq!(joined, all.page.iter().map(|o| (o.book, o.chapter, o.verse)).collect::<Vec<_>>());
        assert!(strongs_info(&c, &T1961, "G1320", 30, v).unwrap().page.is_empty());
    }

    #[test]
    fn ot_number_counts_every_verse_and_only_its_own_code() {
        let c = conn();
        let p = strongs_info(&c, &T1961, "H430", 30, 60).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM verse_words WHERE strongs='H430'", [], |r| r.get(0)).unwrap();
        let v: i64 = c.query_row("SELECT count(DISTINCT verse_id) FROM verse_words WHERE strongs='H430'", [], |r| r.get(0)).unwrap();
        // exact: H4300-H4309 are other words
        let near: i64 = c.query_row("SELECT count(*) FROM verse_words WHERE strongs LIKE 'H430_'", [], |r| r.get(0)).unwrap();
        assert!(near > 0);
        assert_eq!((p.occurrences, p.verses, p.page.len()), (n, v, 30));
        assert_eq!(p.books.first().map(|b| b.book), Some(1));
        assert!(p.books.iter().all(|b| b.book <= 39));
        assert!(p.page.iter().all(|o| !o.w.is_empty()));
        assert_eq!(p.lemma.as_deref(), Some("אֱלֹהִים"));
        assert!(p.kjv.as_deref().unwrap().starts_with("angels, × exceeding, God"));
        // the page picks up where the previous one stopped
        let before = strongs_info(&c, &T1961, "H430", 30, 30).unwrap();
        let last = before.page.last().unwrap();
        let first = p.page.first().unwrap();
        assert!((last.book, last.chapter, last.verse) < (first.book, first.chapter, first.verse));
        // Genesis 1:1: "In the beginning God created": God is the fourth word
        let gen = strongs_info(&c, &T1961, "H430", 1, 0).unwrap();
        assert_eq!((gen.page[0].book, gen.page[0].chapter, gen.page[0].verse, gen.page[0].w.clone()), (1, 1, 1, vec![3]));
    }

    #[test]
    fn a_number_with_no_occurrences() {
        let c = conn();
        // in Strong's, never tagged in this text
        let code: String = c.query_row("SELECT code FROM strongs WHERE code NOT IN (SELECT strongs FROM verse_words WHERE strongs <> '') ORDER BY code LIMIT 1", [], |r| r.get(0)).unwrap();
        let p = strongs_info(&c, &T1961, &code, 30, 0).unwrap();
        assert!(p.lemma.is_some());
        assert_eq!((p.occurrences, p.verses, p.books.len(), p.page.len(), p.renderings.len()), (0, 0, 0, 0, 0));
        // not a number at all
        let p = strongs_info(&c, &T1961, "G3203", 30, 0).unwrap();
        assert!(p.lemma.is_none() && p.kjv.is_none() && p.page.is_empty() && p.occurrences == 0);
    }

    #[test]
    fn renderings_fold_case_under_the_commonest_spelling() {
        let r = fold_renderings(vec![("Teacher".into(), 2), ("teacher".into(), 9), ("master".into(), 9), ("teachers".into(), 1)]);
        assert_eq!(r, vec![("teacher".to_string(), 11), ("master".to_string(), 9), ("teachers".to_string(), 1)]);
    }
}
