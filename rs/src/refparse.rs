//! "jn 3:16", "1 cor 13:4-7", "ps 23" -> Ref. Mirrors shared/ref.ts.
use crate::books::{find_book, Book};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Ref { pub book: i64, pub chapter: i64, #[serde(skip_serializing_if = "Option::is_none")] pub v1: Option<i64>, #[serde(skip_serializing_if = "Option::is_none")] pub v2: Option<i64> }

static REF_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^\s*((?:[1-3]|i{1,3}|first|second|third)?\s*[a-z][a-z .]*?)\s*(\d+)?(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?\s*$").unwrap());
static LOOKS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^\s*(?:[1-3]\s*)?[a-z]{2,}[a-z .]*\s*\d").unwrap());

pub fn parse_ref(input: &str) -> Option<Ref> {
    let m = REF_RE.captures(input)?;
    let book = find_book(m.get(1)?.as_str())?;
    let num = m.get(2).and_then(|x| x.as_str().parse::<i64>().ok());
    let v1 = m.get(3).and_then(|x| x.as_str().parse::<i64>().ok());
    let v2 = m.get(4).and_then(|x| x.as_str().parse::<i64>().ok());
    let chapter = num.unwrap_or(1);
    if book.chapters == 1 && num.is_some() && v1.is_none() {
        return Some(Ref { book: book.n as i64, chapter: 1, v1: Some(chapter), v2: None });
    }
    if chapter < 1 || chapter > book.chapters as i64 { return None; }
    if let (Some(a), Some(b)) = (v1, v2) { if b < a { return None; } }
    Some(Ref { book: book.n as i64, chapter, v1, v2 })
}

/// "Romans 11", "Romans 11:33", "Romans 11:33-36"; a one-chapter book's verse is "Jude 3" (shared/ref.ts `formatRef`).
/// None for a book there is not.
pub fn format_ref(r: &Ref) -> Option<String> {
    let b = crate::books::book(r.book)?;
    let single = b.chapters == 1;
    let mut s = if single && r.v1.is_some() { b.name.to_string() } else { format!("{} {}", b.name, r.chapter) };
    if let Some(v1) = r.v1 { s += &if single { format!(" {v1}") } else { format!(":{v1}") }; }
    if let Some(v2) = r.v2.filter(|v2| Some(*v2) != r.v1) { s += &format!("-{v2}"); }
    Some(s)
}

/// A book's name or alias and nothing after it ("song", "1 kings", "sos"): no chapter, no verse. Search reads such a
/// query as a word first and offers the book beside the hits (search.rs; shared/ref.ts `bareBook`).
pub fn bare_book(input: &str) -> Option<&'static Book> {
    let m = REF_RE.captures(input)?;
    if m.get(2).is_some() || m.get(3).is_some() { return None; }
    find_book(m.get(1)?.as_str())
}

pub fn looks_like_ref(input: &str) -> bool {
    LOOKS_RE.is_match(input) || (input.trim().len() >= 2 && find_book(input.trim()).is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_common_forms() {
        assert_eq!(parse_ref("jn 3:16"), Some(Ref { book: 43, chapter: 3, v1: Some(16), v2: None }));
        assert_eq!(parse_ref("1 cor 13:4-7"), Some(Ref { book: 46, chapter: 13, v1: Some(4), v2: Some(7) }));
        assert_eq!(parse_ref("ps 23"), Some(Ref { book: 19, chapter: 23, v1: None, v2: None }));
        assert_eq!(parse_ref("Psalm 119:105").map(|r| r.chapter), Some(119));
        assert_eq!(parse_ref("jude 3"), Some(Ref { book: 65, chapter: 1, v1: Some(3), v2: None }));
        assert_eq!(parse_ref("rev").map(|r| r.book), Some(66));
        assert_eq!(parse_ref("I John 4:8").map(|r| r.book), Some(62));
        assert_eq!(parse_ref("song of solomon 2").map(|r| r.book), Some(22));
    }
    #[test]
    fn rejects_nonsense() {
        assert!(parse_ref("gen 51").is_none());
        assert!(parse_ref("love").is_none());
        assert!(parse_ref("jn 3:20-16").is_none());
        assert!(!looks_like_ref("faith hope love"));
        assert!(!looks_like_ref("loving-kindness"));
        assert!(looks_like_ref("jn 3:16"));
    }
    #[test]
    fn formats_as_the_app_does() {
        let f = |book, chapter, v1, v2| format_ref(&Ref { book, chapter, v1, v2 });
        assert_eq!(f(45, 11, None, None).as_deref(), Some("Romans 11"));
        assert_eq!(f(45, 11, Some(33), None).as_deref(), Some("Romans 11:33"));
        assert_eq!(f(45, 11, Some(33), Some(36)).as_deref(), Some("Romans 11:33-36"));
        assert_eq!(f(45, 11, Some(33), Some(33)).as_deref(), Some("Romans 11:33"));
        assert_eq!(f(65, 1, Some(3), None).as_deref(), Some("Jude 3"));
        assert_eq!(f(65, 1, None, None).as_deref(), Some("Jude 1"));
        assert_eq!(f(9, 2, Some(2), None).as_deref(), Some("1 Samuel 2:2"));
        assert_eq!((f(0, 1, None, None), f(67, 1, None, None)), (None, None));
    }
    #[test]
    fn bare_book_is_a_name_without_a_number() {
        for (q, n) in [("song", 22), ("Mark", 41), ("1 kings", 11), ("song of solomon", 22), ("sos", 22), ("first john", 62), (" gen. ", 1)] {
            assert_eq!(bare_book(q).map(|b| b.n), Some(n), "{q}");
        }
        for q in ["song 2", "song 2:1", "song of solomon 2", "jn 3:16", "1 kings 8", "jude 3", "love", "kings"] { assert!(bare_book(q).is_none(), "{q}"); }
    }
}
