//! `GET /api/link-preview?url=…`: what a page a jotting links to says of itself, as text: its title, its description
//! and its host. No pictures (the app shows none from other sites: privacy and moderation). The server fetches the
//! page because the web app cannot (CORS) and a phone should not tell a third party who is reading.
//!
//! A server that fetches addresses its users choose can be aimed at its own network or at someone else's, so:
//! - who may ask: anyone, for a link of a jotting that anyone with its link may read (SHARED_LIMITS fetches an hour
//!   between them all); a signed-in reader for any address, USER_LIMITS fetches an hour. An answer from the cache
//!   costs nobody anything;
//! - the address (`check`): http or https on the scheme's own port, a DNS name, no user or password, not on the
//!   scanner's blocklist;
//! - the name is resolved here, every address it has must be public (`is_public`), and the connection goes to those
//!   addresses and no others, so a second DNS answer cannot differ; the HTTP client follows no redirect: each hop
//!   (MAX_REDIRECTS) is checked and resolved the same way;
//! - one GET without cookies or credentials, HTML only, MAX_BODY bytes at most, TOTAL for all of it.
//! The title and description pass the rule scanner (scan.rs) before they are shown or kept.
use crate::auth::MaybeUser;
use crate::error::{ApiError, ApiResult};
use crate::og::{cut, tidy, unesc};
use crate::AppState;
use axum::{extract::{Query, State}, http::{header, HeaderValue}, response::{IntoResponse, Response}, Json};
use futures::future::BoxFuture;
use reqwest::Url;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::json;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

const URL_MAX: usize = 2000;
const MAX_REDIRECTS: usize = 3;
// 1 MB: a YouTube page has its title about 760 KB in; reading stops at the end of the head, so most pages cost far less
const MAX_BODY: usize = 1024 * 1024;
const TOTAL: Duration = Duration::from_secs(6);
const CONNECT: Duration = Duration::from_secs(3);
const TITLE_CHARS: usize = 140;
const DESCRIPTION_CHARS: usize = 240;
/// An answer is kept this long; a fetch that failed (no title), this long, so a dead link is not asked again and again.
const KEEP_DAYS: i64 = 7;
const FAILED_DAYS: i64 = 1;
/// (max, seconds) for friends::limit: a reader's own fetches, and those for links of shared jottings by everyone
/// together (counted under the system account, id 0): one account can store thousands of links for anyone to ask for.
const KIND: &str = "link_preview";
const USER_LIMITS: &[(i64, i64)] = &[(30, 3600)];
const SHARED_LIMITS: &[(i64, i64)] = &[(300, 3600)];

// ---------------- what may be fetched ----------------

/// An address on the public internet: not this machine, not a private or shared network, not link-local (the cloud
/// metadata address is there), not multicast, broadcast, reserved or kept for documentation or testing.
pub fn is_public(ip: IpAddr) -> bool { match ip { IpAddr::V4(a) => public_v4(a), IpAddr::V6(a) => public_v6(a) } }
fn public_v4(a: Ipv4Addr) -> bool {
    let [x, y, z, _] = a.octets();
    !matches!((x, y, z),
        (0, ..) | (10, ..) | (127, ..)                                  // this network, private, loopback
        | (100, 64..=127, _)                                            // shared between a carrier and its customers
        | (169, 254, _)                                                 // link-local
        | (172, 16..=31, _) | (192, 168, _)                             // private
        | (192, 0, 0) | (192, 0, 2) | (198, 51, 100) | (203, 0, 113)    // protocol assignments, documentation
        | (192, 88, 99) | (198, 18..=19, _)                             // 6to4 relays, benchmarking
        | (224..=255, ..))                                              // multicast, reserved, broadcast
}
/// Global unicast only, and an address that carries an IPv4 one (mapped, NAT64, 6to4) is judged by the one it carries.
/// The old IPv4-compatible form (`::a.b.c.d`, with `::` and `::1`) is outside global unicast with everything local.
fn public_v6(a: Ipv6Addr) -> bool {
    let v4 = |hi: u16, lo: u16| public_v4(Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8));
    match a.segments() {
        [0, 0, 0, 0, 0, 0xffff, hi, lo] | [0x64, 0xff9b, 0, 0, 0, 0, hi, lo] | [0x2002, hi, lo, ..] => v4(hi, lo),
        // protocol assignments (Teredo among them) and documentation
        [0x2001, 0..=0x1ff, ..] | [0x2001, 0xdb8, ..] | [0x3fff, 0..=0xfff, ..] => false,
        // 2000::/3; the rest is unique-local (fc00::/7), link-local (fe80::/10), multicast (ff00::/8) or unassigned
        [first, ..] => first & 0xe000 == 0x2000,
    }
}

/// An address the server will fetch, and the host it names.
#[derive(Debug)]
pub struct Link { pub url: Url, pub host: String }

/// http or https on the scheme's own port, a DNS name with a dot in it (never an address written out, in any
/// notation), no user or password, at most URL_MAX long with no space or control character, and not a host on the
/// scanner's blocklist. Said of the address asked for and of every redirect.
pub fn check(raw: &str) -> Option<Link> {
    if raw.len() > URL_MAX || raw.chars().any(|c| c.is_whitespace() || c.is_control()) { return None }
    let mut url = Url::parse(raw).ok()?;
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() || url.port().is_some() { return None }
    let host = url.domain()?.to_string();
    if !host.contains('.') || host.ends_with('.') || crate::scan::BLOCKLIST.is_listed(&host) { return None }
    url.set_fragment(None);
    Some(Link { url, host })
}

// ---------------- the network ----------------

/// What one GET brought back.
#[derive(Clone, Debug, PartialEq)]
pub enum Got { /** an HTML page: its first bytes, MAX_BODY at most */ Html(Vec<u8>), /** a redirect's Location, as sent */ Redirect(String), /** anything else: an error, a timeout, not HTML */ Nothing }

/// The two things a preview asks of the network (`AppState.net`). The server's is `Web`; the tests answer from a
/// table and never leave the machine.
pub trait Net: Send + Sync {
    /// Every address the name has; none when it has none.
    fn resolve<'a>(&'a self, host: &'a str, port: u16) -> BoxFuture<'a, Vec<IpAddr>>;
    /// One GET of `url`, connecting to `addrs` and nowhere else. A redirect is reported, never followed.
    fn get<'a>(&'a self, url: &'a Url, addrs: &'a [SocketAddr]) -> BoxFuture<'a, Got>;
}

pub struct Web;
impl Net for Web {
    fn resolve<'a>(&'a self, host: &'a str, port: u16) -> BoxFuture<'a, Vec<IpAddr>> {
        Box::pin(async move { tokio::net::lookup_host((host, port)).await.map(|found| found.map(|a| a.ip()).collect()).unwrap_or_default() })
    }
    fn get<'a>(&'a self, url: &'a Url, addrs: &'a [SocketAddr]) -> BoxFuture<'a, Got> {
        Box::pin(async move {
            let Some(host) = url.domain() else { return Got::Nothing };
            // a client of its own: the name answers with the checked addresses only, no proxy from the environment, no
            // redirects, and (as built: no cookie store) nothing carried from one request to the next
            let client = reqwest::Client::builder().resolve_to_addrs(host, addrs).redirect(reqwest::redirect::Policy::none()).no_proxy()
                .connect_timeout(CONNECT).timeout(TOTAL).user_agent(crate::brand::get().agent.as_str()).build();
            let Ok(client) = client else { return Got::Nothing };
            let Ok(mut res) = client.get(url.clone()).header(header::ACCEPT, "text/html").send().await else { return Got::Nothing };
            if res.status().is_redirection() { return res.headers().get(header::LOCATION).and_then(|v| v.to_str().ok()).map_or(Got::Nothing, |to| Got::Redirect(to.to_string())) }
            let kind = res.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).and_then(|v| v.split(';').next()).map(|v| v.trim().to_ascii_lowercase());
            if !res.status().is_success() || !matches!(kind.as_deref(), Some("text/html" | "application/xhtml+xml")) { return Got::Nothing }
            // the head is all that is read: stop at its end, and at MAX_BODY whatever the page says its length is
            let mut body: Vec<u8> = Vec::new();
            while body.len() < MAX_BODY {
                let Ok(Some(chunk)) = res.chunk().await else { break };
                let from = body.len().saturating_sub(6);
                body.extend_from_slice(&chunk[..chunk.len().min(MAX_BODY - body.len())]);
                if find_ci(&body, b"</head", from).is_some() || find_ci(&body, b"<body", from).is_some() { break }
            }
            Got::Html(body)
        })
    }
}

#[derive(Debug, PartialEq)]
enum Fetched { Page(Vec<u8>), /** nothing to show: unreachable, not HTML, a redirect that may not be followed */ Failed, /** the address asked for is not on the public internet */ Refused }

/// The page behind `link`, following MAX_REDIRECTS redirects at most, each one checked as the address asked for was.
async fn fetch(net: &dyn Net, link: &Link) -> Fetched {
    let mut url = link.url.clone();
    for hop in 0..=MAX_REDIRECTS {
        let (Some(host), Some(port)) = (url.domain(), url.port_or_known_default()) else { return Fetched::Failed };
        let found = net.resolve(host, port).await;
        if found.is_empty() { return Fetched::Failed }
        // every one of them: a name with one address inside is refused whole
        if !found.iter().all(|a| is_public(*a)) { return if hop == 0 { Fetched::Refused } else { Fetched::Failed } }
        let addrs: Vec<SocketAddr> = found.into_iter().map(|a| SocketAddr::new(a, port)).collect();
        match net.get(&url, &addrs).await {
            Got::Html(bytes) => return Fetched::Page(bytes),
            Got::Redirect(to) => { let Some(next) = url.join(&to).ok().and_then(|u| check(u.as_str())) else { return Fetched::Failed }; url = next.url; }
            Got::Nothing => return Fetched::Failed,
        }
    }
    Fetched::Failed
}

// ---------------- reading the page ----------------

fn find_ci(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    (from..=hay.len().checked_sub(needle.len())?).find(|i| hay[*i..*i + needle.len()].eq_ignore_ascii_case(needle))
}

/// A tag's attributes from `from` (just after its name) and where the tag ends: names in lower case, values as
/// written, in double quotes, single quotes or none.
fn attrs(s: &str, from: usize) -> (Vec<(String, &str)>, usize) {
    let b = s.as_bytes();
    let (mut out, mut i) = (Vec::new(), from);
    loop {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'/') { i += 1; }
        if i >= b.len() { return (out, i) }
        if b[i] == b'>' { return (out, i + 1) }
        let name_at = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && !matches!(b[i], b'=' | b'>' | b'/') { i += 1; }
        if i == name_at { i += 1; continue }
        let name = s[name_at..i].to_ascii_lowercase();
        while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
        let mut value = "";
        if i < b.len() && b[i] == b'=' {
            i += 1;
            while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
            if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
                let (quote, at) = (b[i], i + 1);
                i = b[at..].iter().position(|c| *c == quote).map_or(b.len(), |p| at + p);
                value = &s[at..i];
                i = (i + 1).min(b.len());
            } else {
                let at = i;
                while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'>' { i += 1; }
                value = &s[at..i];
            }
        }
        out.push((name, value));
    }
}

/// The title and description a page gives in its head: `og:title`, else `<title>`; `og:description`, else the
/// description meta. A tolerant walk over the tags up to `</head>` or `<body`, not an HTML parser: attributes in any
/// order and either quote, any letter case, scripts, styles and comments stepped over. The bytes are read as UTF-8
/// whatever the page says they are. Entities decoded, one line each, cut at TITLE_CHARS and DESCRIPTION_CHARS.
pub fn page_head(bytes: &[u8]) -> (Option<String>, Option<String>) {
    let text = String::from_utf8_lossy(bytes);
    let s: &str = &text;
    let (mut title, mut og_title, mut description, mut og_description): (Option<&str>, Option<&str>, Option<&str>, Option<&str>) = (None, None, None, None);
    let mut i = 0;
    while let Some(lt) = s[i..].find('<').map(|p| p + i) {
        let rest = &s[lt + 1..];
        if rest.starts_with("!--") { i = find_ci(s.as_bytes(), b"-->", lt).map_or(s.len(), |p| p + 3); continue }
        let name: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_lowercase()).collect();
        let after = lt + 1 + name.len();
        match name.as_str() {
            "" if rest.len() >= 5 && rest.as_bytes()[..5].eq_ignore_ascii_case(b"/head") => break,
            "" => i = lt + 1,
            "body" => break,
            "title" | "script" | "style" => {
                let from = attrs(s, after).1;
                let to = find_ci(s.as_bytes(), format!("</{name}").as_bytes(), from).unwrap_or(s.len());
                if name == "title" && title.is_none() { title = Some(&s[from..to]); }
                i = to + usize::from(to < s.len());
            }
            "meta" => {
                let (a, end) = attrs(s, after);
                if let Some(content) = a.iter().find(|(k, _)| k == "content").map(|(_, v)| *v) {
                    for (_, v) in a.iter().filter(|(k, _)| k == "property" || k == "name") {
                        match v.trim().to_ascii_lowercase().as_str() {
                            "og:title" if og_title.is_none() => og_title = Some(content),
                            "og:description" if og_description.is_none() => og_description = Some(content),
                            "description" if description.is_none() => description = Some(content),
                            _ => {}
                        }
                    }
                }
                i = end;
            }
            _ => i = attrs(s, after).1,
        }
    }
    let say = |v: Option<&str>, max: usize| v.map(|v| tidy(&unesc(v))).filter(|v| !v.is_empty()).map(|v| cut(&v, max));
    (say(og_title, TITLE_CHARS).or_else(|| say(title, TITLE_CHARS)), say(og_description, DESCRIPTION_CHARS).or_else(|| say(description, DESCRIPTION_CHARS)))
}

/// What may be shown of a page: nothing of one the rule scanner would hide (scan.rs), as it hides a jotting.
fn moderated(title: Option<String>, description: Option<String>) -> (Option<String>, Option<String>) {
    let text = [title.as_deref(), description.as_deref()].into_iter().flatten().collect::<Vec<_>>().join("\n");
    if !text.is_empty() && crate::scan::scan(&text).verdict == "hide" { (None, None) } else { (title, description) }
}

// ---------------- the endpoint ----------------

/// A link of a jotting that anyone with its link may read (outlines.rs `can_read`), by the address exactly as stored.
fn shared_link(conn: &Connection, url: &str) -> rusqlite::Result<bool> {
    conn.prepare_cached("SELECT 1 FROM outline_items i JOIN outlines o ON o.id=i.outline_id WHERE i.kind='link' AND i.url=?1 AND o.hidden=0 AND o.visibility<>'private' LIMIT 1")?.exists(params![url])
}
const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ','now'";
fn cached(conn: &Connection, url: &str) -> rusqlite::Result<Option<(Option<String>, Option<String>)>> {
    conn.prepare_cached(&format!("SELECT title, description FROM link_previews WHERE url=?1 AND fetched_at > {NOW}, CASE WHEN title IS NULL THEN '-{FAILED_DAYS} days' ELSE '-{KEEP_DAYS} days' END)"))?
        .query_row(params![url], |r| Ok((r.get(0)?, r.get(1)?))).optional()
}
fn store(conn: &Connection, url: &str, host: &str, title: Option<&str>, description: Option<&str>) -> rusqlite::Result<()> {
    conn.execute(&format!("DELETE FROM link_previews WHERE fetched_at <= {NOW}, '-{KEEP_DAYS} days')"), [])?;
    conn.prepare_cached(&format!("INSERT INTO link_previews (url, host, title, description, fetched_at) VALUES (?1, ?2, ?3, ?4, {NOW})) ON CONFLICT(url) DO UPDATE SET host=excluded.host, title=excluded.title, description=excluded.description, fetched_at=excluded.fetched_at"))?
        .execute(params![url, host, title, description]).map(|_| ())
}

/// One message for every address that is not acceptable: which rule it broke is nobody's business.
fn refused() -> ApiError { ApiError::bad("that link cannot be previewed") }

#[derive(Deserialize)] pub struct PreviewQ { url: Option<String> }
/// `{ url, host, title, description }`; `title` and `description` are null when there is nothing to show (the page
/// could not be fetched, is not HTML, says nothing, or the scanner hides what it says): the app shows the plain link.
pub async fn preview(State(s): State<AppState>, MaybeUser(u): MaybeUser, Query(q): Query<PreviewQ>) -> ApiResult<Response> {
    let asked = q.url.unwrap_or_default();
    let Some(link) = check(&asked) else { return Err(refused()) };
    let (uid, key) = (u.map(|u| u.id), asked.clone());
    let hit = s.db(move |conn| {
        let shared = shared_link(conn, &key)?;
        if uid.is_none() && !shared { return Err(ApiError::forbidden("sign in to preview this link")) }
        if let Some(hit) = cached(conn, &key)? { return Ok(Some(hit)) }
        // a fetch: out of the reader's own hour first; a shared jotting's link then, as for anyone, out of the hour all share
        match uid.map(|id| crate::friends::limit(conn, id, KIND, USER_LIMITS)) {
            Some(Ok(())) => {}
            Some(Err(e)) if !shared => return Err(e),
            _ => crate::friends::limit(conn, 0, KIND, SHARED_LIMITS)?,
        }
        Ok(None)
    }).await?;
    // no connection is held while the page is fetched
    let (title, description) = match hit {
        Some((title, description)) => moderated(title, description),
        None => {
            let (title, description) = match tokio::time::timeout(TOTAL, fetch(&*s.net, &link)).await.unwrap_or(Fetched::Failed) {
                Fetched::Refused => return Err(refused()),
                Fetched::Failed => (None, None),
                Fetched::Page(bytes) => { let (title, description) = page_head(&bytes); moderated(title, description) }
            };
            // an answer that could not be kept is still the answer
            let (key, host, t, d) = (asked.clone(), link.host.clone(), title.clone(), description.clone());
            let _ = s.db(move |conn| Ok(store(conn, &key, &host, t.as_deref(), d.as_deref())?)).await;
            (title, description)
        }
    };
    let mut res = Json(json!({ "url": asked, "host": link.host, "title": title, "description": description })).into_response();
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=86400"));
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::{app_with_net, call, fetch as raw, user};
    use serde_json::{json, Value};
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    const NULL: Value = Value::Null;

    /// A network from a table: names without an entry have one public address, pages without one are not there.
    #[derive(Default)]
    struct Fake { dns: HashMap<&'static str, Vec<&'static str>>, pages: HashMap<&'static str, Got>, asked: Mutex<Vec<String>>, dialed: Mutex<Vec<SocketAddr>> }
    impl Fake {
        fn page(mut self, url: &'static str, html: &str) -> Self { self.pages.insert(url, Got::Html(html.as_bytes().to_vec())); self }
        fn redirect(mut self, url: &'static str, to: &str) -> Self { self.pages.insert(url, Got::Redirect(to.into())); self }
        fn name(mut self, host: &'static str, addrs: &[&'static str]) -> Self { self.dns.insert(host, addrs.to_vec()); self }
        fn asked(&self) -> Vec<String> { self.asked.lock().unwrap().clone() }
    }
    impl Net for Fake {
        fn resolve<'a>(&'a self, host: &'a str, _: u16) -> BoxFuture<'a, Vec<IpAddr>> {
            Box::pin(async move { self.dns.get(host).map_or(vec!["93.184.215.14".parse().unwrap()], |a| a.iter().map(|a| a.parse().unwrap()).collect()) })
        }
        fn get<'a>(&'a self, url: &'a Url, addrs: &'a [SocketAddr]) -> BoxFuture<'a, Got> {
            Box::pin(async move {
                self.asked.lock().unwrap().push(url.to_string());
                self.dialed.lock().unwrap().extend_from_slice(addrs);
                self.pages.get(url.as_str()).cloned().unwrap_or(Got::Nothing)
            })
        }
    }
    fn page(title: &str, description: &str) -> String { format!("<html><head><title>{title}</title><meta name=\"description\" content=\"{description}\"></head><body>x</body></html>") }
    fn ask(url: &str) -> String { format!("/link-preview?{}", Url::parse_with_params("http://x/", &[("url", url)]).unwrap().query().unwrap()) }

    #[test]
    fn only_addresses_on_the_public_internet() {
        for a in ["0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.254", "127.0.0.1", "127.8.9.10", "169.254.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
            "192.0.0.8", "192.0.2.1", "192.88.99.1", "192.168.0.1", "192.168.255.255", "198.18.0.1", "198.19.255.255", "198.51.100.7", "203.0.113.9", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
            "::", "::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:192.168.1.1", "::127.0.0.1", "::10.0.0.1", "::8.8.8.8", "64:ff9b::10.0.0.1", "64:ff9b::7f00:1", "64:ff9b:1::1", "100::1",
            "2001::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:2::1", "2001:db8::1", "2002:a00:1::1", "2002:7f00:1::1", "2002:c0a8:101::1", "3fff::1", "fc00::1", "fd12:3456:789a::1", "fe80::1", "febf::1", "fec0::1", "ff02::1", "ff0e::1", "4000::1", "e000::1"] {
            assert!(!is_public(a.parse().unwrap()), "{a}");
        }
        for a in ["1.1.1.1", "8.8.8.8", "9.255.255.255", "11.0.0.1", "100.63.255.255", "100.128.0.1", "126.255.255.255", "128.0.0.1", "169.253.255.255", "169.255.0.1", "172.15.255.255", "172.32.0.1", "192.0.1.1", "192.0.3.1", "192.167.255.255", "192.169.0.1",
            "198.17.255.255", "198.20.0.1", "198.51.99.1", "203.0.112.1", "203.0.114.1", "223.255.255.255", "93.184.215.14",
            "::ffff:8.8.8.8", "64:ff9b::808:808", "2001:200::1", "2001:4860:4860::8888", "2002:808:808::1", "2606:4700:4700::1111", "2a00:1450:4001:81b::200e", "3ffe::1"] {
            assert!(is_public(a.parse().unwrap()), "{a}");
        }
    }

    #[test]
    fn only_a_plain_web_address_of_a_named_host() {
        for (raw, host) in [("https://example.org/a?b=1", "example.org"), ("http://example.org", "example.org"), ("HTTPS://WWW.Example.ORG/Path", "www.example.org"), ("http://example.org:80/", "example.org"), ("https://example.org:443/", "example.org"),
            ("https://sub.domain.example.co.uk/x#frag", "sub.domain.example.co.uk"), ("https://bücher.example/", "xn--bcher-kva.example"), ("https://1.1.1.1.nip.io/", "1.1.1.1.nip.io")] {
            assert_eq!(check(raw).map(|l| l.host).as_deref(), Some(host), "{raw}");
        }
        assert_eq!(check("https://example.org/x#frag").unwrap().url.as_str(), "https://example.org/x");
        for raw in ["", "example.org", "//example.org/", "/etc/passwd", "ftp://example.org/", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,<title>x</title>", "gopher://example.org/", "ws://example.org/",
            "https://user@example.org/", "https://user:pass@example.org/", "https://:pass@example.org/", "http://example.org:8080/", "http://example.org:443/", "https://example.org:80/", "https://example.org:22/",
            "http://127.0.0.1/", "http://10.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://8.8.8.8/", "http://2130706433/", "http://0x7f000001/", "http://0x7f.1/", "http://017700000001/", "http://127.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[2606:4700:4700::1111]/",
            "http://localhost/", "http://intranet/", "http://example.org./", "https://exa mple.org/", "https://example.org/a b", "https://example.org/\n", "https://example.org/\u{0}"] {
            assert!(check(raw).is_none(), "{raw}");
        }
        assert!(check(&format!("https://example.org/{}", "a".repeat(URL_MAX - 20))).is_some());
        assert!(check(&format!("https://example.org/{}", "a".repeat(URL_MAX - 19))).is_none(), "one over the length");
        crate::scan::BLOCKLIST.domains.write().unwrap().insert("blocked-preview.example".into());
        assert!(check("https://blocked-preview.example/").is_none() && check("https://login.blocked-preview.example/x").is_none() && check("https://not-blocked-preview.example/").is_some());
    }

    #[test]
    fn the_head_says_the_title_and_description() {
        let both = |html: &str| { let (t, d) = page_head(html.as_bytes()); (t.unwrap_or_default(), d.unwrap_or_default()) };
        // Open Graph first, whatever the order of tags and attributes
        assert_eq!(both(r#"<html><head><title>Plain</title><meta name="description" content="plain words"><meta property="og:title" content="Graph"><meta content="graph words" property="og:description"></head>"#), ("Graph".into(), "graph words".into()));
        // the title and the description meta when there is no Open Graph, or it is blank
        assert_eq!(both(r#"<head><meta property="og:title" content=" &nbsp; "><title>
            Plain   title
        </title><meta name="description" content="plain words"></head>"#), ("Plain title".into(), "plain words".into()));
        // single quotes, no quotes, upper case, a self-closing slash, name= for an og key
        assert_eq!(both("<HEAD><META NAME='og:title' CONTENT='It&#39;s \"quoted\"'/><meta name=description content=unquoted><TITLE>no</TITLE></HEAD>"), ("It's \"quoted\"".into(), "unquoted".into()));
        // entities, and a > inside a quoted value
        assert_eq!(both(r#"<head><title>Tom &amp; Jerry &lt;3 &#8212; &#x2014; caf&eacute;</title><meta name="description" content="a > b &quot;c&quot; &nbsp;d"></head>"#), ("Tom & Jerry <3 — — caf&eacute;".into(), "a > b \"c\" d".into()));
        // what is in a script, a style or a comment is not the page's word; nothing is read past the head
        assert_eq!(both(r#"<head><script>var t = "<title>script</title><meta property='og:title' content='script'>";</script><style>a::after { content: "<title>style</title>" }</style><!-- <title>comment</title> --><title>Real</title></head><body><meta property="og:title" content="body"><title>body</title></body>"#), ("Real".into(), String::new()));
        assert_eq!(both("<html><title>Headless</title><body><meta name=\"description\" content=\"in the body\"></body></html>"), ("Headless".into(), String::new()));
        assert_eq!(both("<body><p>no head at all</p></body>"), (String::new(), String::new()));
        // control characters go, a long text is cut at a word
        let long = "word ".repeat(100);
        let (t, d) = page_head(format!("<head><title>a\u{0}b\u{202e}c {long}</title><meta name=\"description\" content=\"{long}\"></head>").as_bytes());
        let (t, d) = (t.unwrap(), d.unwrap());
        assert!(t.starts_with("abc word") && t.ends_with("word…") && t.chars().count() <= TITLE_CHARS, "{t}");
        assert!(d.ends_with("word…") && d.chars().count() <= DESCRIPTION_CHARS && d.chars().count() > DESCRIPTION_CHARS - 6, "{d}");
        // not UTF-8, not HTML, cut off mid-tag: never a panic
        assert_eq!(page_head(&[0xff, 0xfe, 0x00, 0x3c, 0x80, 0x3c, 0x74, 0xc3]), (None, None));
        assert_eq!(page_head(b"<head><title>Caf\xe9 de Paris</title>").0.as_deref(), Some("Caf\u{fffd} de Paris"));
        for cut_off in ["<", "<head><title", "<head><title>Open", "<head><meta name=\"description\" content=\"never closed", "<head><meta name=", "<head><!-- never closed", "<head><script>never closed", "<head><meta ====>"] { let _ = page_head(cut_off.as_bytes()); }
        assert_eq!(page_head(b"<head><title>Open").0.as_deref(), Some("Open"));
        let junk: Vec<u8> = (0..20_000u32).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8).collect();
        let _ = page_head(&junk);
    }

    #[tokio::test]
    async fn every_hop_is_checked_and_the_connection_goes_where_the_check_looked() {
        let link = |u: &str| check(u).unwrap();
        // a page; the dial is the address that was resolved, on the scheme's port
        let net = Fake::default().page("https://example.org/a", &page("A", "a")).name("example.org", &["93.184.215.14", "2606:4700:4700::1111"]);
        assert!(matches!(fetch(&net, &link("https://example.org/a")).await, Fetched::Page(_)));
        assert_eq!(*net.dialed.lock().unwrap(), ["93.184.215.14:443".parse().unwrap(), "[2606:4700:4700::1111]:443".parse::<SocketAddr>().unwrap()]);
        // a name with no address, a page that is not there
        assert_eq!(fetch(&Fake::default().name("gone.example", &[]), &link("https://gone.example/")).await, Fetched::Failed);
        assert_eq!(fetch(&Fake::default(), &link("https://example.org/missing")).await, Fetched::Failed);
        // a name that resolves inside is refused before any request, and so is one with a single inside address among public ones
        for inside in [&["127.0.0.1"][..], &["10.0.0.5"], &["169.254.169.254"], &["93.184.215.14", "192.168.1.1"], &["::1"], &["fd00::1"], &["::ffff:10.0.0.1"]] {
            let net = Fake::default().name("rebind.example", inside).page("http://rebind.example/", &page("Inside", "x"));
            assert_eq!(fetch(&net, &link("http://rebind.example/")).await, Fetched::Refused, "{inside:?}");
            assert!(net.asked().is_empty(), "{inside:?}");
        }
        // redirects: relative and absolute, followed by hand, three at most
        let net = Fake::default().redirect("http://example.org/1", "/2").redirect("http://example.org/2", "https://other.example/3").redirect("https://other.example/3", "4").page("https://other.example/4", &page("Four", "x"));
        assert!(matches!(fetch(&net, &link("http://example.org/1")).await, Fetched::Page(_)));
        assert_eq!(net.asked(), ["http://example.org/1", "http://example.org/2", "https://other.example/3", "https://other.example/4"]);
        let net = Fake::default().redirect("http://example.org/1", "/2").redirect("http://example.org/2", "/3").redirect("http://example.org/3", "/4").redirect("http://example.org/4", "/5").page("http://example.org/5", &page("Five", "x"));
        assert_eq!(fetch(&net, &link("http://example.org/1")).await, Fetched::Failed);
        assert_eq!(net.asked().len(), 4, "the fourth redirect is not followed");
        // a redirect to anything the first address could not have been is not followed
        for to in ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://example.org:8080/", "https://user:pw@example.org/", "ftp://example.org/", "file:///etc/passwd", "http://localhost/", "http://inside.example/"] {
            let net = Fake::default().redirect("https://example.org/r", to).name("inside.example", &["10.1.2.3"]).page("http://inside.example/", &page("Inside", "x"));
            assert_eq!(fetch(&net, &link("https://example.org/r")).await, Fetched::Failed, "{to}");
            assert_eq!(net.asked(), ["https://example.org/r"], "{to}");
        }
    }

    #[tokio::test]
    async fn anyone_for_a_shared_jottings_link_a_reader_for_any_address() {
        let net = Arc::new(Fake::default().page("https://example.org/a", &page("Example &amp; Co", "What the page says.")).page("https://example.org/b", &page("B", "b")));
        let (app, pool) = app_with_net(net.clone());
        let (_, anna) = user(&pool, "anna");
        // signed out, an address no jotting holds: no
        let (st, v) = call(&app, "GET", &ask("https://example.org/a"), None, NULL).await;
        assert_eq!((st, v["error"].as_str()), (403, Some("sign in to preview this link")));
        assert!(net.asked().is_empty());
        // in a private jotting: still no; shared by link: yes, for anyone
        let (_, o) = call(&app, "POST", "/outlines", Some(&anna), json!({ "title": "Links" })).await;
        let id = o["id"].as_i64().unwrap();
        call(&app, "PUT", &format!("/outlines/{id}/items"), Some(&anna), json!({ "items": [{ "kind": "link", "url": "https://example.org/a", "text": "a page" }] })).await;
        assert_eq!(call(&app, "GET", &ask("https://example.org/a"), None, NULL).await.0, 403);
        call(&app, "PATCH", &format!("/outlines/{id}"), Some(&anna), json!({ "visibility": "link" })).await;
        let (st, v) = call(&app, "GET", &ask("https://example.org/a"), None, NULL).await;
        assert_eq!((st, v), (200, json!({ "url": "https://example.org/a", "host": "example.org", "title": "Example & Co", "description": "What the page says." })));
        // the address exactly as stored, nothing like it
        assert_eq!(call(&app, "GET", &ask("https://example.org/a?x=1"), None, NULL).await.0, 403);
        assert_eq!(call(&app, "GET", &ask("https://example.org/b"), None, NULL).await.0, 403);
        // hidden by moderation: its links are nobody's to ask for
        pool.get().unwrap().execute("UPDATE outlines SET hidden=1 WHERE id=?1", [id]).unwrap();
        assert_eq!(call(&app, "GET", &ask("https://example.org/a"), None, NULL).await.0, 403);
        // a signed-in reader: any address
        let (st, v) = call(&app, "GET", &ask("https://example.org/b"), Some(&anna), NULL).await;
        assert_eq!((st, v["title"].as_str(), v["host"].as_str()), (200, Some("B"), Some("example.org")));
        // the answer may be kept by the one who asked, for a day
        let (st, h, _) = raw(&app, &ask("https://example.org/b"), &[("authorization", &format!("Bearer {anna}"))]).await;
        assert_eq!((st, h.get("cache-control").and_then(|v| v.to_str().ok())), (200, Some("private, max-age=86400")));
    }

    #[tokio::test]
    async fn an_address_that_may_not_be_fetched_is_400_whatever_the_reason() {
        let net = Arc::new(Fake::default().name("inside.example", &["10.0.0.7"]).page("http://inside.example/", &page("Inside", "x")));
        let (app, pool) = app_with_net(net.clone());
        let (_, anna) = user(&pool, "anna");
        for url in ["", "ftp://example.org/", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "https://user:pw@example.org/", "https://example.org:8443/", "http://inside.example/"] {
            for who in [None, Some(anna.as_str())] {
                if who.is_none() && url == "http://inside.example/" { continue }
                let (st, v) = call(&app, "GET", &ask(url), who, NULL).await;
                assert_eq!((st, v["error"].as_str()), (400, Some("that link cannot be previewed")), "{url}");
            }
        }
        assert_eq!(call(&app, "GET", "/link-preview", Some(&anna), NULL).await.0, 400, "no url at all");
        assert!(net.asked().is_empty(), "nothing was requested");
        let kept: i64 = pool.get().unwrap().query_row("SELECT count(*) FROM link_previews", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, 0);
    }

    #[tokio::test]
    async fn an_answer_is_kept_a_week_a_failure_a_day_and_neither_is_fetched_twice() {
        let net = Arc::new(Fake::default().page("https://example.org/a", &page("A", "a")).redirect("https://example.org/in", "http://10.0.0.1/"));
        let (app, pool) = app_with_net(net.clone());
        let (_, anna) = user(&pool, "anna");
        let age = |url: &str, days: f64| { pool.get().unwrap().execute("UPDATE link_previews SET fetched_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?2) WHERE url=?1", rusqlite::params![url, format!("-{} seconds", (days * 86400.0) as i64)]).unwrap(); };
        for _ in 0..3 { assert_eq!(call(&app, "GET", &ask("https://example.org/a"), Some(&anna), NULL).await.1["title"], "A"); }
        assert_eq!(net.asked(), ["https://example.org/a"], "fetched once");
        // a page that is not there, and a redirect inside: 200 with nothing to show, kept too
        for url in ["https://example.org/missing", "https://example.org/in"] {
            for _ in 0..2 {
                let (st, v) = call(&app, "GET", &ask(url), Some(&anna), NULL).await;
                assert_eq!((st, v), (200, json!({ "url": url, "host": "example.org", "title": null, "description": null })));
            }
        }
        assert_eq!(net.asked().len(), 3, "each failure asked once");
        let row: (String, Option<String>) = pool.get().unwrap().query_row("SELECT host, title FROM link_previews WHERE url='https://example.org/missing'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(row, ("example.org".into(), None));
        // six days on the page is still kept; the failure, a day old, is asked again
        age("https://example.org/a", 6.0); age("https://example.org/missing", 1.1);
        call(&app, "GET", &ask("https://example.org/a"), Some(&anna), NULL).await;
        assert_eq!(net.asked().len(), 3);
        call(&app, "GET", &ask("https://example.org/missing"), Some(&anna), NULL).await;
        assert_eq!(net.asked().len(), 4);
        // past the week the page is fetched again, and rows older than that are swept
        age("https://example.org/a", 7.1); age("https://example.org/in", 8.0);
        call(&app, "GET", &ask("https://example.org/a"), Some(&anna), NULL).await;
        assert_eq!(net.asked().len(), 5);
        let urls: Vec<String> = { let c = pool.get().unwrap(); let mut st = c.prepare("SELECT url FROM link_previews ORDER BY url").unwrap(); let v = st.query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap(); v };
        assert_eq!(urls, ["https://example.org/a", "https://example.org/missing"]);
    }

    #[tokio::test]
    async fn thirty_fetches_an_hour_for_a_reader_and_the_cache_costs_nothing() {
        let net = Arc::new(Fake::default());
        let (app, pool) = app_with_net(net.clone());
        let (anna_id, anna) = user(&pool, "anna");
        let (_, ben) = user(&pool, "ben");
        for i in 0..30 { assert_eq!(call(&app, "GET", &ask(&format!("https://example.org/{i}")), Some(&anna), NULL).await.0, 200, "{i}"); }
        let (st, v) = call(&app, "GET", &ask("https://example.org/30"), Some(&anna), NULL).await;
        assert_eq!((st, v["error"].as_str()), (429, Some("That is a lot at once. Please try again later.")));
        assert_eq!(net.asked().len(), 30);
        // what is kept is still answered, and the limit is each reader's own
        assert_eq!(call(&app, "GET", &ask("https://example.org/7"), Some(&anna), NULL).await.0, 200);
        assert_eq!(call(&app, "GET", &ask("https://example.org/30"), Some(&ben), NULL).await.0, 200);
        assert_eq!(net.asked().len(), 31);
        // an hour on there is room again
        pool.get().unwrap().execute("UPDATE friend_events SET at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-61 minutes') WHERE user_id=?1", [anna_id]).unwrap();
        assert_eq!(call(&app, "GET", &ask("https://example.org/31"), Some(&anna), NULL).await.0, 200);
        // a shared jotting's links draw on one hour for everyone, signed in or not, once a reader's own is spent
        let (_, o) = call(&app, "POST", "/outlines", Some(&ben), json!({ "title": "Links", "visibility": "link" })).await;
        let items: Vec<Value> = (0..3).map(|i| json!({ "kind": "link", "url": format!("https://shared.example/{i}") })).collect();
        call(&app, "PUT", &format!("/outlines/{}/items", o["id"]), Some(&ben), json!({ "items": items })).await;
        pool.get().unwrap().execute("UPDATE friend_events SET at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=?1", [anna_id]).unwrap();
        assert_eq!(call(&app, "GET", &ask("https://shared.example/0"), Some(&anna), NULL).await.0, 200, "her own hour is spent, the shared one is not");
        assert_eq!(call(&app, "GET", &ask("https://example.org/32"), Some(&anna), NULL).await.0, 429);
        { let c = pool.get().unwrap(); for _ in 0..SHARED_LIMITS[0].0 { c.execute("INSERT INTO friend_events (user_id, kind) VALUES (0, ?1)", [KIND]).unwrap(); } }
        assert_eq!(call(&app, "GET", &ask("https://shared.example/1"), None, NULL).await.0, 429);
        assert_eq!(call(&app, "GET", &ask("https://shared.example/1"), Some(&anna), NULL).await.0, 429);
        assert_eq!(call(&app, "GET", &ask("https://shared.example/0"), None, NULL).await.0, 200, "kept: no fetch, no limit");
    }

    #[tokio::test]
    async fn what_the_scanner_hides_is_not_shown_or_kept() {
        // the rules' own examples (tests.json, flows.link_preview): two texts the scan hides, a title and a text it
        // lets through, and a title it hides
        let f = crate::testkit::policy_tests()["flows"]["link_preview"].clone();
        let s = |key: &str| f[key].as_str().unwrap_or_else(|| panic!("tests.json: flows.link_preview has no {key}")).to_string();
        let net = Arc::new(Fake::default().page("https://example.org/bad", &page(&s("hidden_title"), "Read on")).page("https://example.org/worse", &page("Fine title", &s("hidden_text")))
            .page("https://example.org/ok", &page(&s("fine_title"), &s("fine_text"))));
        let (app, pool) = app_with_net(net.clone());
        let (_, anna) = user(&pool, "anna");
        for url in ["https://example.org/bad", "https://example.org/worse"] {
            let (st, v) = call(&app, "GET", &ask(url), Some(&anna), NULL).await;
            assert_eq!((st, v), (200, json!({ "url": url, "host": "example.org", "title": null, "description": null })));
        }
        let kept: i64 = pool.get().unwrap().query_row("SELECT count(*) FROM link_previews WHERE title IS NOT NULL OR description IS NOT NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, 0, "the words are not kept either");
        assert_eq!(call(&app, "GET", &ask("https://example.org/ok"), Some(&anna), NULL).await.1["title"], s("fine_title").as_str());
        // a row from before a rule: scanned again when it is read
        pool.get().unwrap().execute("UPDATE link_previews SET title=?1 WHERE url='https://example.org/ok'", [s("later_hidden")]).unwrap();
        let (st, v) = call(&app, "GET", &ask("https://example.org/ok"), Some(&anna), NULL).await;
        assert_eq!((st, v["title"].clone(), v["description"].clone()), (200, NULL, NULL));
    }
}
