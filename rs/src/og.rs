//! Link previews of the app's own pages. A messenger's crawler (WhatsApp, iMessage, Telegram ...) runs no script, so
//! what a shared link says must be in the HTML the server sends: the shell (index.html) goes out with Open Graph and
//! Twitter tags in its head (static.rs `shell`). A chapter or verses say the reference and the text; a jotting anyone
//! with its link may read says its title and what it holds; every other path gets the one generic set, and so does a
//! jotting that is private, hidden or not there: a preview never tells whether a share code exists. Nothing of a
//! person (handle, display name) and nothing private goes into a tag.
use crate::edition::{self, Edition};
use crate::refparse::{format_ref, Ref};
use crate::AppState;
use crate::brand;

/// client/public/og.png and its size
const IMAGE: (&str, u32, u32) = ("/og.png", 1024, 500);
const VERSE_CHARS: usize = 300;
const JOTTING_CHARS: usize = 200;
/// The verses a bare chapter is described by: enough to fill VERSE_CHARS.
const OPENING: i64 = 8;
const DESCRIPTION_OPEN: &str = "<meta name=\"description\" content=\"";

/// What a page says of itself; `url` is its one address (no query but the verses).
#[derive(Debug, PartialEq)]
pub struct Tags { pub title: String, pub description: String, pub url: String }

#[derive(Debug, PartialEq)]
enum Page { Read { book: i64, chapter: i64, verses: Option<(i64, i64)> }, Jotting(String), Other }

fn num(s: &str) -> Option<i64> { if s.is_empty() || s.len() > 4 || !s.bytes().all(|b| b.is_ascii_digit()) { None } else { s.parse().ok() } }

/// `/read/{book}/{chapter}[?v=..[&v2=..]]` for a chapter the book has, `/o/{code}`, or anything else. A `v` or `v2`
/// that is not a verse number, or runs backwards, names no page.
fn page(path: &str, query: Option<&str>) -> Page {
    let seg: Vec<&str> = path.trim_matches('/').split('/').collect();
    match seg[..] {
        ["read", b, c] => {
            let (Some(book), Some(chapter)) = (num(b), num(c)) else { return Page::Other };
            if !crate::books::book(book).is_some_and(|bk| (1..=i64::from(bk.chapters)).contains(&chapter)) { return Page::Other }
            let arg = |k: &str| query.unwrap_or("").split('&').find_map(|kv| kv.strip_prefix(k));
            let verses = match (arg("v=").map(num), arg("v2=").map(num)) {
                (None, _) => None,
                (Some(Some(v)), None) if v >= 1 => Some((v, v)),
                (Some(Some(v)), Some(Some(v2))) if v >= 1 && v2 >= v => Some((v, v2)),
                _ => return Page::Other,
            };
            Page::Read { book, chapter, verses }
        }
        ["o", code] if !code.is_empty() && code.len() <= 64 && code.bytes().all(|b| b.is_ascii_alphanumeric()) => Page::Jotting(code.to_string()),
        _ => Page::Other,
    }
}

/// The tags of the page at `path`, or None for the generic set. The database work is one indexed read on the blocking
/// pool; a database that cannot answer is the generic set, never a failed page.
pub async fn tags(s: &AppState, ed: Edition, path: &str, query: Option<&str>) -> Option<Tags> {
    match page(path, query) {
        Page::Read { book, chapter, verses } => s.db(move |conn| Ok(read(conn, &edition::tables(conn, ed), book, chapter, verses)?)).await.ok().flatten(),
        Page::Jotting(code) => s.db(move |conn| Ok(jotting(conn, &code)?)).await.ok().flatten(),
        Page::Other => None,
    }
}

/// The verses asked for, or how the chapter opens, from the edition's text as it is. Every verse named must be there.
fn read(conn: &rusqlite::Connection, t: &edition::Tables, book: i64, chapter: i64, verses: Option<(i64, i64)>) -> rusqlite::Result<Option<Tags>> {
    let (a, b) = verses.unwrap_or((1, OPENING));
    let rows = crate::bible::get_range(conn, t, book, chapter, a, b)?;
    let (Some(first), Some(last)) = (rows.first(), rows.last()) else { return Ok(None) };
    if verses.is_some() && (first.verse != a || last.verse != b) { return Ok(None) }
    let Some(title) = format_ref(&Ref { book, chapter, v1: verses.map(|v| v.0), v2: verses.map(|v| v.1) }) else { return Ok(None) };
    let text = tidy(&rows.iter().map(|r| r.text.as_str()).collect::<Vec<_>>().join(" "));
    let url = format!("{}/read/{book}/{chapter}{}", brand::get().site, match verses { Some((v, v2)) if v2 > v => format!("?v={v}&v2={v2}"), Some((v, _)) => format!("?v={v}"), None => String::new() });
    Ok(Some(Tags { title, description: cut(&text, VERSE_CHARS), url }))
}

/// A jotting anyone with the link may read (outlines::shared): its title, and its description, else its first note,
/// else the verses it gathers.
fn jotting(conn: &rusqlite::Connection, code: &str) -> rusqlite::Result<Option<Tags>> {
    let Some(j) = crate::outlines::shared(conn, code)? else { return Ok(None) };
    let title = tidy(&j.title);
    if title.is_empty() { return Ok(None) }
    let mut holds = [j.description, j.note].into_iter().flatten().map(|s| tidy(&s)).find(|s| !s.is_empty());
    if holds.is_none() {
        let refs: Vec<String> = crate::outlines::first_verses(conn, j.id, 8)?.iter().filter_map(format_ref).collect();
        if !refs.is_empty() { holds = Some(refs.join("; ")); }
    }
    let b = brand::get();
    // what it is, when it says nothing more of itself: the feature's noun and the app's name
    let what = format!("{} on {}", b.noun.a_cap, b.name);
    let description = match holds { Some(h) => cut(&format!("{what}: {h}"), JOTTING_CHARS), None => what };
    Ok(Some(Tags { title, description, url: format!("{}/o/{code}", b.site) }))
}

fn inner(s: &str, open: &str, close: &str) -> Option<std::ops::Range<usize>> {
    let a = s.find(open)? + open.len();
    Some(a..a + s[a..].find(close)?)
}

/// `shell` (index.html) with the tags before its `</head>`; from `</head>` on it is the shell's own bytes. With `tags`
/// the title and description of the head are theirs too. Without, the set is the generic one: the shell's own title
/// and description said again as tags, and an address for the home page only (`home`), so every other path gets the
/// same bytes and none of what was asked for is written back. None when the shell has no `</head>`.
pub fn render(shell: &str, tags: Option<&Tags>, home: bool) -> Option<String> {
    let (head, rest) = shell.split_at(shell.find("</head>")?);
    let (b, origin) = (brand::get(), brand::get().site.as_str());
    let mut head = head.to_string();
    let own = inner(&head, DESCRIPTION_OPEN, "\"").map(|r| unesc(&head[r])).unwrap_or_default();
    if let Some(t) = tags {
        // the later one first: the earlier range stays where it was
        let mut swaps = [(inner(&head, "<title>", "</title>"), &t.title), (inner(&head, DESCRIPTION_OPEN, "\""), &t.description)];
        swaps.sort_by_key(|(r, _)| std::cmp::Reverse(r.as_ref().map(|r| r.start)));
        for (r, v) in swaps { if let Some(r) = r { head.replace_range(r, &esc(v)); } }
    }
    let (title, description, url) = match tags { Some(t) => (t.title.as_str(), t.description.as_str(), Some(t.url.clone())), None => (b.store_name.as_str(), own.as_str(), home.then(|| format!("{origin}/"))) };
    let image = format!("{origin}{}", IMAGE.0);
    let mut metas: Vec<(&str, String)> = vec![("og:title", title.into()), ("og:description", description.into()), ("og:type", "website".into()), ("og:site_name", b.name.clone())];
    if let Some(u) = url { metas.push(("og:url", u)); }
    metas.extend([("og:image", image.clone()), ("og:image:width", IMAGE.1.to_string()), ("og:image:height", IMAGE.2.to_string()),
        ("twitter:card", "summary_large_image".into()), ("twitter:title", title.into()), ("twitter:description", description.into()), ("twitter:image", image)]);
    head.push('\n');
    // a shell whose own description could not be read says none, rather than an empty one
    for (k, v) in metas.into_iter().filter(|(_, v)| !v.is_empty()) { head += &format!("    <meta {}=\"{k}\" content=\"{}\" />\n", if k.starts_with("og:") { "property" } else { "name" }, esc(&v)); }
    Some(head + "  " + rest)
}

// ---------------- text ----------------

/// For an attribute or text: & < > " '.
pub fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 16);
    for c in s.chars() { match c { '&' => out += "&amp;", '<' => out += "&lt;", '>' => out += "&gt;", '"' => out += "&quot;", '\'' => out += "&#39;", c => out.push(c) } }
    out
}

const NAMED: &[(&str, &str)] = &[("amp", "&"), ("lt", "<"), ("gt", ">"), ("quot", "\""), ("apos", "'"), ("nbsp", "\u{a0}"), ("ndash", "–"), ("mdash", "—"), ("hellip", "…"),
    ("lsquo", "‘"), ("rsquo", "’"), ("ldquo", "“"), ("rdquo", "”"), ("laquo", "«"), ("raquo", "»"), ("middot", "·"), ("bull", "•"), ("copy", "©"), ("reg", "®"), ("trade", "™")];

/// The common entities read back: the named ones above, `&#NNN;` and `&#xHH;`. Anything else stays as written.
pub fn unesc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out += &rest[..i];
        rest = &rest[i..];
        let name = rest[1..].find(';').filter(|n| *n <= 10).map(|n| &rest[1..1 + n]);
        let ch = name.and_then(|n| match n.strip_prefix('#') {
            Some(d) => d.strip_prefix(['x', 'X']).map_or_else(|| d.parse::<u32>().ok(), |h| u32::from_str_radix(h, 16).ok()).and_then(char::from_u32).map(String::from),
            None => NAMED.iter().find(|(k, _)| *k == n).map(|(_, v)| v.to_string()),
        });
        match (name, ch) { (Some(n), Some(c)) => { out += &c; rest = &rest[n.len() + 2..]; } _ => { out.push('&'); rest = &rest[1..]; } }
    }
    out + rest
}

/// One line of plain text: runs of white space are one space, control characters and the invisible ones that turn or
/// hide text (zero-width, direction marks and overrides) are gone.
pub fn tidy(s: &str) -> String {
    let hidden = |c: char| c.is_control() || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}');
    let spaced: String = s.chars().map(|c| if c.is_whitespace() { ' ' } else { c }).filter(|c| !hidden(*c)).collect();
    spaced.split(' ').filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")
}

/// At most `max` characters: a longer text ends at a word, with "…" (inside a very long word when there is no other place).
pub fn cut(s: &str, max: usize) -> String {
    if s.chars().count() <= max { return s.to_string() }
    let head: String = s.chars().take(max.saturating_sub(1)).collect();
    let whole_word = s.chars().nth(max.saturating_sub(1)).is_some_and(char::is_whitespace);
    let kept = if whole_word { head.as_str() } else { match head.rfind(' ') { Some(i) if i >= head.len() / 2 => &head[..i], _ => head.as_str() } };
    format!("{}…", kept.trim_end_matches(|c: char| c.is_whitespace() || matches!(c, ',' | ';' | ':' | '-' | '–' | '—' | '(' | '[')))
}

#[cfg(test)]
mod tests {
    use super::*;
    /// A shell as the client builds it: its title is the brand's.
    fn shell() -> String { format!("<!DOCTYPE html>\n<html>\n  <head>\n    <meta name=\"description\" content=\"Darby's New Translation &amp; more.\" />\n    <title>{}</title>\n  <link rel=\"icon\" href=\"/favicon.ico\"/></head>\n\n  <body><div id=\"root\"></div></body>\n</html>\n", esc(&brand::get().store_name)) }

    #[test]
    fn a_path_is_a_chapter_a_jotting_or_neither() {
        let read = |book, chapter, verses| Page::Read { book, chapter, verses };
        assert_eq!(page("read/45/11", None), read(45, 11, None));
        assert_eq!(page("/read/45/11/", Some("v=33")), read(45, 11, Some((33, 33))));
        assert_eq!(page("read/45/11", Some("utm=x&v=33&v2=36")), read(45, 11, Some((33, 36))));
        assert_eq!(page("read/45/11", Some("v2=36&fbclid=1")), read(45, 11, None), "an end without a start is the chapter");
        assert_eq!(page("read/65/1", Some("v=3&v2=3")), read(65, 1, Some((3, 3))));
        for (p, q) in [("read/99/1", None), ("read/0/1", None), ("read/45/17", None), ("read/45/0", None), ("read/45/999", None), ("read/45", None), ("read/45/11/3", None), ("read/+45/11", None), ("read/45/1e1", None),
            ("read/45/11", Some("v=0")), ("read/45/11", Some("v=x")), ("read/45/11", Some("v=")), ("read/45/11", Some("v=36&v2=33")), ("read/45/11", Some("v=33&v2=x")), ("read/45/11", Some("v=-1")), ("read/45/11", Some("v=33333"))] {
            assert_eq!(page(p, q), Page::Other, "{p} {q:?}");
        }
        assert_eq!(page("o/Ab3dE6gh1J", Some("x=1")), Page::Jotting("Ab3dE6gh1J".into()));
        for p in ["o", "o/", "o/a/b", "o/a%20b", "o/a-b", "u/anna", "outlines/3", "groups/romans", "friends", "index.html", ""] { assert_eq!(page(p, None), Page::Other, "{p}"); }
        assert_eq!(page(&format!("o/{}", "a".repeat(65)), None), Page::Other);
    }

    #[test]
    fn text_is_escaped_read_back_tidied_and_cut_at_a_word() {
        assert_eq!(esc(r#"a & b <c> "d" 'e'"#), "a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;");
        assert_eq!(unesc("Tom &amp; Jerry &lt;3 &quot;x&quot; &#39;y&#39; &apos;z&apos; a&nbsp;b &#8212; &#x2014; &ndash; &hellip;"), "Tom & Jerry <3 \"x\" 'y' 'z' a\u{a0}b — — – …");
        assert_eq!(unesc("AT&T &unknown; &#xZZ; &#99999999999; & &"), "AT&T &unknown; &#xZZ; &#99999999999; & &");
        assert_eq!(unesc(&esc(r#"<a href="x">Tom & 'Jerry'</a>"#)), r#"<a href="x">Tom & 'Jerry'</a>"#);
        assert_eq!(tidy("  a\n\tb \u{a0} c\u{0}d\u{202e}e\u{200b}  "), "a b cde");
        assert_eq!(cut("short", 10), "short");
        assert_eq!(cut("exactly ten", 11), "exactly ten");
        assert_eq!(cut("one two three four", 12), "one two…");
        assert_eq!(cut("one two, three four", 9), "one two…");
        assert_eq!(cut("one two three", 8), "one two…", "the cut falls after a whole word");
        assert_eq!(cut(&"x".repeat(50), 10), format!("{}…", "x".repeat(9)));
        let long = "word ".repeat(100);
        let c = cut(long.trim(), 300);
        assert!(c.chars().count() <= 300 && c.ends_with("word…"), "{c}");
        assert_eq!(cut("héllo wörld ünïcode", 12), "héllo wörld…");
    }

    #[test]
    fn the_generic_set_repeats_the_shell_and_writes_nothing_of_the_path_back() {
        let (b, shell) = (brand::get(), shell());
        let (shell, title, origin) = (shell.as_str(), esc(&b.store_name), b.site.as_str());
        let html = render(shell, None, false).unwrap();
        assert!(html.contains(&format!("<title>{title}</title>")) && html.contains("<meta name=\"description\" content=\"Darby's New Translation &amp; more.\" />"));
        assert!(html.contains(&format!("<meta property=\"og:title\" content=\"{title}\" />")));
        assert!(html.contains("<meta property=\"og:description\" content=\"Darby&#39;s New Translation &amp; more.\" />"), "{html}");
        assert!(html.contains("<meta name=\"twitter:description\" content=\"Darby&#39;s New Translation &amp; more.\" />"));
        assert!(html.contains(&format!("<meta property=\"og:image\" content=\"{origin}/og.png\" />")) && html.contains("<meta property=\"og:image:width\" content=\"1024\" />") && html.contains("<meta property=\"og:image:height\" content=\"500\" />"));
        assert!(!html.contains("og:url"));
        assert!(render(shell, None, true).unwrap().contains(&format!("<meta property=\"og:url\" content=\"{origin}/\" />")));
        assert_eq!(html.split_once("</head>").unwrap().1, shell.split_once("</head>").unwrap().1);
        assert_eq!(render("<html><body>no head</body></html>", None, false), None);
        let bare = render("<html><head><title>x</title></head><body></body></html>", None, false).unwrap();
        assert!(bare.contains("og:title") && !bare.contains("og:description") && !bare.contains("twitter:description"), "{bare}");
    }

    #[test]
    fn a_page_of_its_own_takes_the_title_and_description_too_all_escaped() {
        let (b, shell) = (brand::get(), shell());
        let (shell, title, origin) = (shell.as_str(), esc(&b.store_name), b.site.as_str());
        let t = Tags { title: "Notes on \"grace\" <1>".into(), description: "Tom & 'Jerry'".into(), url: format!("{origin}/o/abc") };
        let html = render(shell, Some(&t), false).unwrap();
        assert!(html.contains("<title>Notes on &quot;grace&quot; &lt;1&gt;</title>"), "{html}");
        assert!(html.contains("<meta name=\"description\" content=\"Tom &amp; &#39;Jerry&#39;\" />"));
        assert!(html.contains("<meta property=\"og:title\" content=\"Notes on &quot;grace&quot; &lt;1&gt;\" />") && html.contains("<meta name=\"twitter:title\" content=\"Notes on &quot;grace&quot; &lt;1&gt;\" />"));
        assert!(html.contains("<meta property=\"og:description\" content=\"Tom &amp; &#39;Jerry&#39;\" />"));
        assert!(html.contains(&format!("<meta property=\"og:url\" content=\"{origin}/o/abc\" />")));
        assert!(!html.contains("Darby's New Translation") && !html.contains("<1>"));
        assert_eq!(html.split_once("</head>").unwrap().1, shell.split_once("</head>").unwrap().1);
        // every tag once, in the head
        for k in ["og:title", "og:description", "og:type", "og:site_name", "og:url", "og:image\"", "og:image:width", "og:image:height", "twitter:card", "twitter:title", "twitter:description", "twitter:image"] {
            assert_eq!(html.split_once("</head>").unwrap().0.matches(&format!("=\"{k}")).count(), 1, "{k}");
        }
        // a shell whose title comes before its description
        let other = shell.replace(&format!("    <title>{title}</title>\n"), "").replace("<head>\n", &format!("<head>\n    <title>{title}</title>\n"));
        let html = render(&other, Some(&t), false).unwrap();
        assert!(html.contains("<title>Notes on &quot;grace&quot; &lt;1&gt;</title>") && html.contains("<meta name=\"description\" content=\"Tom &amp; &#39;Jerry&#39;\" />"), "{html}");
    }
}
