//! `/get`: the one link to hand out for the app. It counts the click and sends the visitor on to the store listing.
//! Counts only: a day, an optional source label (`/get?s=whatsapp`) and a number. No address, no device, no cookie.
use axum::{extract::{Query, State}, http::{header, HeaderMap, StatusCode}, response::{IntoResponse, Response}};
use crate::AppState;

/// Link previews (WhatsApp, iMessage, Slack...) and crawlers fetch the link without anyone tapping it.
fn is_machine(ua: &str) -> bool {
    let ua = ua.to_ascii_lowercase();
    ua.is_empty() || ["bot", "crawl", "spider", "preview", "whatsapp", "facebookexternalhit", "slack", "discord", "telegram", "curl", "wget", "python", "go-http", "headless"].iter().any(|m| ua.contains(m))
}

/// The label as stored: lowercase letters, digits and dashes, at most 24; anything else is no label.
pub fn label(s: Option<&str>) -> String {
    let s = s.unwrap_or("").trim().to_ascii_lowercase();
    if !s.is_empty() && s.len() <= 24 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { s } else { String::new() }
}

#[derive(serde::Deserialize)]
pub struct Q { s: Option<String> }

pub async fn get(State(s): State<AppState>, Query(q): Query<Q>, h: HeaderMap) -> Response {
    let ua = h.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or("");
    if !is_machine(ua) {
        let (day, src) = (crate::activity::day_key(time::OffsetDateTime::now_utc().date()), label(q.s.as_deref()));
        // a failed count never stands between the visitor and the store
        let hour = crate::live::hour_key(time::OffsetDateTime::now_utc());
        let _ = s.db(move |c| {
            c.execute("INSERT INTO store_clicks (day, src, n) VALUES (?1, ?2, 1) ON CONFLICT(day, src) DO UPDATE SET n = n + 1", (day, src))?;
            // the same click by hour, for the admin's live numbers (live.rs)
            Ok(c.execute("INSERT INTO store_click_hours (hour, n) VALUES (?1, 1) ON CONFLICT(hour) DO UPDATE SET n = n + 1", (hour,))?)
        }).await;
    }
    let to = std::env::var("BEREAN_STORE_URL").unwrap_or_else(|_| format!("https://play.google.com/store/apps/details?id={}", crate::brand::get().android_package));
    (StatusCode::FOUND, [(header::LOCATION, to), (header::CACHE_CONTROL, "no-store".into())]).into_response()
}

/// `berean store-clicks`: the count by day and source, newest first, and the total.
pub fn report(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    let mut st = conn.prepare("SELECT day, src, n FROM store_clicks ORDER BY day DESC, n DESC")?;
    let mut total = 0;
    for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))? {
        let (day, src, n) = row?; total += n; println!("{day}  {:<24} {n:>6}", if src.is_empty() { "(no label)" } else { &src });
    }
    println!("{total} clicks");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn labels() { assert_eq!(label(Some("WhatsApp")), "whatsapp"); assert_eq!(label(Some("a b")), ""); assert_eq!(label(None), ""); assert_eq!(label(Some(&"x".repeat(25))), ""); }
    #[test] fn machines() { assert!(is_machine("WhatsApp/2.23")); assert!(is_machine("")); assert!(is_machine("Googlebot/2.1")); assert!(!is_machine("Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile Safari/537.36")); }
}
