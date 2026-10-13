//! Test helpers: a router on a fresh database, users with sessions, and one-shot requests.
use crate::AppState;
use axum::{body::Body, http::Request, Router};
use rusqlite::params;
use serde_json::Value;
use tower::ServiceExt;

pub fn app() -> (Router, crate::db::DbPool) { app_with_net(std::sync::Arc::new(Offline)) }
/// A router whose link previews (link_preview.rs) are fetched through `net`.
pub fn app_with_net(net: std::sync::Arc<dyn crate::link_preview::Net>) -> (Router, crate::db::DbPool) {
    let state = state(net);
    (with_guard(state.clone()), state.pool)
}
/// The whole site as main.rs mounts it: the API under /api and the embedded web app (client/dist) behind it.
pub fn site() -> (Router, crate::db::DbPool) {
    let state = state(std::sync::Arc::new(Offline));
    let api = crate::routes::router().layer(axum::middleware::from_fn_with_state(state.clone(), crate::edition::guard)).fallback(|| async { crate::error::ApiError::not_found("no such API") });
    (Router::new().nest("/api", api).fallback(crate::r#static::serve).with_state(state.clone()), state.pool)
}
fn state(net: std::sync::Arc<dyn crate::link_preview::Net>) -> AppState {
    let path = std::env::temp_dir().join(format!("berean-test-{}.db", crate::auth::random_token(8)));
    let pool = crate::db::open_pool(path.to_str().unwrap(), None).unwrap();
    AppState { pool, ministry: None, edition: edition_cache(), net }
}
/// No network in a test: no name resolves and no page answers.
pub struct Offline;
impl crate::link_preview::Net for Offline {
    fn resolve<'a>(&'a self, _: &'a str, _: u16) -> futures::future::BoxFuture<'a, Vec<std::net::IpAddr>> { Box::pin(async { Vec::new() }) }
    fn get<'a>(&'a self, _: &'a reqwest::Url, _: &'a [std::net::SocketAddr]) -> futures::future::BoxFuture<'a, crate::link_preview::Got> { Box::pin(async { crate::link_preview::Got::Nothing }) }
}
/// The edition read on every request, so a test can switch it between two calls.
fn edition_cache() -> std::sync::Arc<crate::edition::Cache> { std::sync::Arc::new(crate::edition::Cache::new(std::time::Duration::ZERO)) }
/// The API router as main.rs mounts it: the edition's cache guard included.
fn with_guard(state: AppState) -> Router {
    crate::routes::router().layer(axum::middleware::from_fn_with_state(state.clone(), crate::edition::guard)).with_state(state)
}
/** A router whose ministry library is the database at `path` (crate::ministry::tests::fixture). */
pub fn app_with_ministry(path: &str) -> (Router, crate::db::DbPool) {
    let (_, pool) = app();
    let state = AppState { pool: pool.clone(), ministry: crate::ministry::Ministry::open(path).unwrap(), edition: edition_cache(), net: std::sync::Arc::new(Offline) };
    (with_guard(state), pool)
}
/// A user with a session; returns (id, token).
pub fn user(pool: &crate::db::DbPool, handle: &str) -> (i64, String) {
    let c = pool.get().unwrap();
    c.execute("INSERT INTO users (handle, display_name, password_hash) VALUES (?1, ?2, 'x')", params![handle, format!("{}{}", handle[..1].to_uppercase(), &handle[1..])]).unwrap();
    let id = c.last_insert_rowid();
    (id, crate::auth::create_session(&c, id).unwrap().0)
}
pub async fn call(app: &Router, method: &str, uri: &str, token: Option<&str>, body: Value) -> (u16, Value) {
    call_h(app, method, uri, token, body, &[]).await
}
/// `call` with extra headers; an `x-forwarded-for` among them replaces the default address.
pub async fn call_h(app: &Router, method: &str, uri: &str, token: Option<&str>, body: Value, headers: &[(&str, &str)]) -> (u16, Value) {
    let mut req = Request::builder().method(method).uri(uri).header("content-type", "application/json");
    if !headers.iter().any(|(k, _)| k.eq_ignore_ascii_case("x-forwarded-for")) { req = req.header("x-forwarded-for", "203.0.113.9"); }
    for (k, v) in headers { req = req.header(*k, *v); }
    if let Some(t) = token { req = req.header("authorization", format!("Bearer {t}")); }
    let res = app.clone().oneshot(req.body(Body::from(if body.is_null() { String::new() } else { body.to_string() })).unwrap()).await.unwrap();
    let status = res.status().as_u16();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 22).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}
/// A plain GET of any path, as a browser or a crawler makes it: status, headers and the bytes.
pub async fn fetch(app: &Router, uri: &str, headers: &[(&str, &str)]) -> (u16, axum::http::HeaderMap, Vec<u8>) {
    let mut req = Request::builder().uri(uri).header("x-forwarded-for", "203.0.113.9");
    for (k, v) in headers { req = req.header(*k, *v); }
    let res = app.clone().oneshot(req.body(Body::empty()).unwrap()).await.unwrap();
    let (status, headers) = (res.status().as_u16(), res.headers().clone());
    (status, headers, axum::body::to_bytes(res.into_body(), 1 << 22).await.unwrap().to_vec())
}
/// The texts database the tests read verses from: data/scripture.db, or the file BEREAN_TEST_DB names. A copy of the
/// code without the texts has none (data/README.md): the test stops on that sentence, not on a failed open.
pub fn seed() -> String {
    let path = std::env::var("BEREAN_TEST_DB").unwrap_or_else(|_| "../data/scripture.db".into());
    assert!(std::path::Path::new(&path).exists(), "this test reads the texts database and there is no {path}: `npm run data` builds it from the texts put under data/ (data/README.md)");
    path
}
/// For a test of the texts compiled into the server (the dictionary, the companions, the notices): a copy of the code
/// without them compiles their empty stand-ins, and the test stops on that sentence, not on an empty answer.
pub fn texts() {
    assert!(include_str!("../../data/cbd/index.json").trim() != "[]", "this test reads the texts compiled into the server, and data/ holds only their empty stand-ins (data/README.md)");
}
/// The examples that go with the rules built in (rs/moderation/tests.json, see rules.rs): what a policy-specific test
/// posts and expects is data beside the policy, never in the tests.
pub const POLICY_TESTS: &str = include_str!("../moderation/tests.json");
pub fn policy_tests() -> serde_json::Value { serde_json::from_str(POLICY_TESTS).expect("rs/moderation/tests.json") }
/// A reason a reader may report under that is a content rule's (not the takedown notice's).
pub fn report_reason() -> String { policy_tests()["flows"]["report_reason"].as_str().expect("tests.json: flows.report_reason").to_string() }
