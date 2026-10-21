//! Error messages in the reader's language (docs/LANGUAGES.md): an app in French, German, Italian, Dutch or Swedish names it in
//! `x-jottings-lang`, and an error's English message is swapped for its catalogue's (rs/i18n/<lang>.json, made by
//! `node scripts/i18n.mjs server-keys`); a message the catalogue lacks stays English.
use axum::{body::Body, extract::Request, http::header, middleware::Next, response::Response};
use std::{collections::HashMap, sync::LazyLock};

static CATALOGS: LazyLock<HashMap<&'static str, HashMap<String, String>>> = LazyLock::new(|| {
    [("fr", include_str!("../i18n/fr.json")), ("fr-CA", include_str!("../i18n/fr-CA.json")), ("de", include_str!("../i18n/de.json")), ("it", include_str!("../i18n/it.json")), ("nl", include_str!("../i18n/nl.json")), ("sv", include_str!("../i18n/sv.json"))]
        .into_iter().map(|(l, s)| (l, serde_json::from_str(s).unwrap_or_default())).collect()
});

/// `msg` in `lang`; Canadian French falls back to French.
pub fn translate(lang: &str, msg: &str) -> Option<&'static str> {
    let own = |l: &str| CATALOGS.get(l).and_then(|c| c.get(msg)).map(String::as_str).filter(|s| !s.is_empty());
    own(lang).or_else(|| if lang == "fr-CA" { own("fr") } else { None })
}

/// An error answer's `error` in the asker's language; everything else passes untouched.
pub async fn errors(req: Request, next: Next) -> Response {
    let lang = req.headers().get("x-jottings-lang").and_then(|v| v.to_str().ok()).filter(|l| *l != "en").map(str::to_owned);
    let res = next.run(req).await;
    let Some(lang) = lang else { return res };
    let json = res.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|v| v.starts_with("application/json"));
    if res.status().as_u16() < 400 || !json { return res }
    let (mut parts, body) = res.into_parts();
    let Ok(bytes) = axum::body::to_bytes(body, 64 * 1024).await else { return Response::from_parts(parts, Body::empty()) };
    let Ok(mut v) = serde_json::from_slice::<serde_json::Value>(&bytes) else { return Response::from_parts(parts, Body::from(bytes)) };
    let Some(own) = v["error"].as_str().and_then(|m| translate(&lang, m)) else { return Response::from_parts(parts, Body::from(bytes)) };
    v["error"] = own.into();
    parts.headers.remove(header::CONTENT_LENGTH);
    Response::from_parts(parts, Body::from(serde_json::to_vec(&v).unwrap_or_else(|_| bytes.to_vec())))
}

#[cfg(test)]
mod tests {
    #[test]
    fn every_catalogue_is_json_and_canadian_french_falls_back() {
        for (l, c) in super::CATALOGS.iter() { assert!(c.values().all(|v| !v.contains('\u{0}')), "{l}") }
        assert_eq!(super::translate("fr-CA", "no such message ever"), None);
    }
}
