//! Berean server: axum + SQLite, one static binary with the client and data embedded.
mod activity; mod auth; mod bans; mod avatars; mod badges; mod bible; mod brand; mod books; mod cleanse; mod companion; mod dictionary; mod db; mod edition; mod error; mod feedback; mod friends; mod google; mod groups; mod link_preview; mod me_data; mod ministry; mod ministry_offline; mod moderation; mod og; mod scan; mod outlines; mod refparse; mod search; mod tts; mod routes; mod rules; mod r#static; mod paths; mod store; mod live; mod marks; mod readthrough;
#[cfg(test)] mod testkit;

use axum::{http::{header, HeaderValue}, Router};
use db::DbPool;
use std::net::SocketAddr;
use error::{ApiError, ApiResult};
use tower_http::{compression::{predicate::{NotForContentType, Predicate}, CompressionLayer, DefaultPredicate}, cors::CorsLayer, trace::TraceLayer};

/// The certificates the Android app is signed with: Play's app-signing key, then the upload key (sideloaded builds).
static ASSETLINKS: once_cell::sync::Lazy<String> = once_cell::sync::Lazy::new(|| format!(r#"[{{"relation": ["delegate_permission/common.handle_all_urls"], "target": {{"namespace": "android_app", "package_name": "{}", "sha256_cert_fingerprints": ["{}"]}}}}]"#, brand::get().android_package, brand::get().android_certs.join("\", \"")));

#[derive(Clone)]
pub struct AppState { pub pool: DbPool, /** data/ministry.db, read-only; None when the file is absent */ pub ministry: Option<std::sync::Arc<ministry::Ministry>>,
    /** the edition served (edition.rs), as last read from the database */ pub edition: std::sync::Arc<edition::Cache>,
    /** how a link preview reaches the page it is of (link_preview.rs): the web, or a test's table */ pub net: std::sync::Arc<dyn link_preview::Net> }

impl AppState {
    /// Runs `f` on the blocking pool with a pooled connection. rusqlite is synchronous, and on a 2-vCPU host a
    /// slow query (search, Strong's) or a full pool on a runtime worker stalls every other request.
    pub async fn db<T: Send + 'static>(&self, f: impl FnOnce(&mut db::Conn) -> ApiResult<T> + Send + 'static) -> ApiResult<T> {
        let pool = self.pool.clone();
        tokio::task::spawn_blocking(move || { let mut c = pool.get()?; f(&mut c) }).await.map_err(|_| ApiError::internal("server error"))?
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // `berean tts-batch ...` records the read-aloud audio and exits; everything else is the server
    // the brand and the moderation rules are data embedded in the binary: read here, so one that cannot be read stops
    // the server now with what is wrong in it, not at the first request that needs it
    brand::get();
    rules::get();
    let argv: Vec<String> = std::env::args().collect();
    if argv.get(1).map(|s| s.as_str()) == Some("tts-batch") { return tts::batch(&argv[2..]).await; }
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "berean=info,tower_http=warn".into())).init();
    let data_dir = std::env::var("BEREAN_DATA").unwrap_or_else(|_| "data".into());
    let db_path = std::env::var("BEREAN_DB").unwrap_or_else(|_| format!("{data_dir}/berean.db"));
    // Encryption at rest: BEREAN_DB_KEY (64 hex chars) turns the user database into a SQLCipher file.
    // Without it the database is plaintext; in prod (BEREAN_PROD) the key is required.
    let db_key = std::env::var("BEREAN_DB_KEY").ok().filter(|k| !k.is_empty());
    if db_key.is_none() && std::env::var("BEREAN_PROD").is_ok() { anyhow::bail!("BEREAN_PROD is set but BEREAN_DB_KEY is not: refusing to run with a plaintext user database"); }
    // ship the scripture db as a seed file; copy (or encrypt-copy) it into place on first boot
    if !std::path::Path::new(&db_path).exists() {
        let seed = format!("{data_dir}/scripture.db");
        // what a copy of the code without the texts meets first (data/README.md): one sentence, not an error's debug form
        if !std::path::Path::new(&seed).exists() {
            eprintln!("The texts database is missing: there is no {db_path} and no seed to make it from at {seed}, which `npm run data` builds from the texts put under data/ (data/README.md).");
            std::process::exit(1);
        }
        match &db_key { Some(k) => db::export_encrypted(&seed, None, &db_path, k)?, None => { std::fs::copy(&seed, &db_path)?; } }
        tracing::info!("seeded {db_path} from {seed} (encrypted: {})", db_key.is_some());
    } else if let Some(k) = &db_key { db::ensure_encrypted(&db_path, k)?; }
    let pool = db::open_pool(&db_path, db_key)?;
    // `berean reseed-scripture`: the scripture tables were copied in on first boot only; after a data rebuild this
    // replaces them from the seed file in place (user tables untouched) and exits. Run with the server stopped.
    if argv.get(1).map(|s| s.as_str()) == Some("reseed-scripture") {
        let seed = format!("{data_dir}/scripture.db");
        let conn = pool.get()?;
        let n = db::reseed_scripture(&conn, &seed)?;
        println!("scripture reseeded from {seed}: {n} verses");
        return Ok(());
    }
    // `berean list-users`: who has signed up (handle, name, admin, joined), newest first; for the owner's eye only
    if argv.get(1).map(|s| s.as_str()) == Some("list-users") {
        let conn = pool.get()?;
        let mut st = conn.prepare("SELECT id, handle, display_name, is_admin, created_at FROM users ORDER BY created_at DESC")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?, r.get::<_, String>(4)?)))?;
        let mut n = 0;
        for row in rows { let (id, handle, name, admin, at) = row?; n += 1; println!("{:>4}  @{:<20} {:<28} {}{}", id, handle, name, &at[..at.len().min(10)], if admin != 0 { "  admin" } else { "" }); }
        println!("{n} users");
        return Ok(());
    }
    // `berean store-clicks`: how many followed the site's /get to the store
    if argv.get(1).map(|s| s.as_str()) == Some("store-clicks") { let conn = pool.get()?; store::report(&conn)?; return Ok(()); }
    // `berean feedback`: the inbox; `berean feedback-thank <handle>`: the standard thank-you on that reader's messages
    if argv.get(1).map(|s| s.as_str()) == Some("feedback") { let conn = pool.get()?; feedback::report(&conn)?; return Ok(()); }
    if argv.get(1).map(|s| s.as_str()) == Some("feedback-thank") {
        let Some(who) = argv.get(2) else { anyhow::bail!("feedback-thank <handle | message number>") };
        let conn = pool.get()?; println!("{} message(s) answered for {who}", feedback::thank(&conn, who)?); return Ok(());
    }
    // `berean store-click-hours < lines`: fills the hourly record (live.rs) for hours before the server kept one
    if argv.get(1).map(|s| s.as_str()) == Some("store-click-hours") {
        let mut text = String::new(); std::io::Read::read_to_string(&mut std::io::stdin(), &mut text)?;
        let conn = pool.get()?; println!("{} hour(s) written", live::import_hours(&conn, &text)?); return Ok(());
    }
    // `berean reading <handle> [days]`: a reader's recent days (minutes, chapters, goal met) and the chapters that
    // credited them, to answer "why did my streak count today"
    if argv.get(1).map(|s| s.as_str()) == Some("reading") {
        let Some(handle) = argv.get(2) else { anyhow::bail!("reading <handle> [days]") };
        let days: i64 = argv.get(3).and_then(|d| d.parse().ok()).unwrap_or(7);
        let conn = pool.get()?;
        let uid: i64 = conn.query_row("SELECT id FROM users WHERE handle=?1 COLLATE NOCASE", [handle.trim_start_matches('@')], |r| r.get(0))?;
        let goal = activity::daily_goal_seconds(&conn, uid);
        println!("@{} goal {} min", handle.trim_start_matches('@'), goal / 60);
        let mut st = conn.prepare("SELECT date, active_seconds, pages FROM activity_days WHERE user_id=?1 ORDER BY date DESC LIMIT ?2")?;
        for row in st.query_map(rusqlite::params![uid, days], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))? {
            let (date, secs, pages) = row?;
            println!("{date}  {:>3} min {:>2} s  chapters {pages}  {}", secs / 60, secs % 60, if activity::day_met(secs, goal) { "goal met" } else { "not met" });
            let mut cs = conn.prepare("SELECT book, chapter, dwell_seconds, credited_at FROM page_credits WHERE user_id=?1 AND date=?2 ORDER BY credited_at")?;
            for c in cs.query_map(rusqlite::params![uid, date], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?)))? {
                let (b, ch, dwell, at) = c?;
                println!("      {b}:{ch}  {dwell} s on it (needs {} s)  at {at}", bible::chapter_required_seconds(&conn, b, ch));
            }
        }
        return Ok(());
    }
    // `berean rename-user <handle> [display name]`: the admin takes a name off an account: the handle becomes
    // reader<id> (unless it already is) and the display name "Reader", or the one given. The reader stays signed in.
    if argv.get(1).map(|s| s.as_str()) == Some("rename-user") {
        let Some(handle) = argv.get(2) else { anyhow::bail!("rename-user <handle> [display name]") };
        let display = argv.get(3).map(|s| s.trim()).filter(|s| !s.is_empty() && s.chars().count() <= 60).unwrap_or("Reader");
        let conn = pool.get()?;
        let Some(id): Option<i64> = rusqlite::OptionalExtension::optional(conn.query_row("SELECT id FROM users WHERE handle=?1 COLLATE NOCASE", rusqlite::params![handle.trim_start_matches('@')], |r| r.get(0)))? else { anyhow::bail!("no such user: {handle}") };
        feedback::force_rename(&conn, id, Some(display)).map_err(|e| anyhow::anyhow!("{e:?}"))?;
        println!("{handle} is now @reader{id} ({display}); they will be asked for a new name and handle");
        return Ok(());
    }
    // `berean set-admin <handle> on|off`: the owner grants or takes back admin (the first account is admin by rule,
    // which caught a tester who signed up before the owner)
    if argv.get(1).map(|s| s.as_str()) == Some("set-admin") {
        let (Some(handle), Some(flag)) = (argv.get(2), argv.get(3)) else { anyhow::bail!("set-admin <handle> on|off") };
        let on = match flag.as_str() { "on" => 1, "off" => 0, _ => anyhow::bail!("set-admin <handle> on|off") };
        let conn = pool.get()?;
        let n = conn.execute("UPDATE users SET is_admin=?1 WHERE handle=?2 COLLATE NOCASE", rusqlite::params![on, handle.trim_start_matches('@')])?;
        println!("{}: admin {}", handle, if n == 0 { "— no such user".to_string() } else if on == 1 { "on".into() } else { "off".into() });
        return Ok(());
    }
    // `berean edition` prints the edition served; `berean edition set 1890|1961` switches it (docs/EDITION.md). A running
    // server follows within edition::TTL; nothing else is rewritten, so setting it back restores everything
    if argv.get(1).map(|s| s.as_str()) == Some("edition") {
        let conn = pool.get()?;
        match (argv.get(2).map(|s| s.as_str()), argv.get(3)) {
            (None, _) => println!("{}", edition::get(&conn).as_str()),
            (Some("set"), Some(v)) => {
                let Some(ed) = edition::Edition::parse(v) else { anyhow::bail!("edition set 1890|1961") };
                if cleanse::get(&conn) && ed != edition::Edition::E1890 { anyhow::bail!("the cleanse is on and keeps the 1890 edition; `berean cleanse undo` first") }
                let was = edition::get(&conn);
                edition::set(&conn, ed)?;
                println!("edition {} (was {}); the server follows within {} s", ed.as_str(), was.as_str(), edition::TTL.as_secs());
            }
            _ => anyhow::bail!("edition [set 1890|1961]"),
        }
        return Ok(());
    }
    // `berean cleanse` sets the 1890 edition and hides what cleanse.rs lists; `cleanse undo` puts everything back (the
    // edition too, to what the cleanse found); `cleanse status` prints the state. A running server follows within edition::TTL
    if argv.get(1).map(|s| s.as_str()) == Some("cleanse") {
        let conn = pool.get()?;
        match argv.get(2).map(|s| s.as_str()) {
            None => { cleanse::apply(&conn)?; println!("cleanse on; edition 1890; the server follows within {} s", edition::TTL.as_secs()); }
            Some("undo") => { let back = cleanse::undo(&conn)?; println!("cleanse off; edition {}; the server follows within {} s", back.as_str(), edition::TTL.as_secs()); }
            Some("status") => {
                let s = edition::served(&conn);
                println!("cleanse {}; edition {}{}", if s.cleanse { "on" } else { "off" }, s.edition.as_str(), cleanse::prior_edition(&conn).map(|e| format!(" (was {} before the cleanse)", e.as_str())).unwrap_or_default());
            }
            _ => anyhow::bail!("cleanse [undo|status]"),
        }
        return Ok(());
    }
    // the ministry library and its verse index: a read-only file beside the seed, replaced whole on a data rebuild
    let ministry_path = std::env::var("BEREAN_MINISTRY_DB").unwrap_or_else(|_| format!("{data_dir}/ministry.db"));
    let ministry = ministry::Ministry::open(&ministry_path)?;
    if ministry.is_none() { tracing::warn!("no {ministry_path}: the ministry library is empty (run tools/ministry_index.ts)"); }
    let state = AppState { pool: pool.clone(), ministry, edition: std::sync::Arc::new(edition::Cache::new(edition::TTL)), net: std::sync::Arc::new(link_preview::Web) };
    // URL reputation lists for the rule scanner, refreshed twice a day; stale report jobs and ended repeating group
    // events swept every minute
    tokio::spawn(async move { loop { scan::refresh_blocklists().await; tokio::time::sleep(std::time::Duration::from_secs(12 * 3600)).await; } });
    tokio::spawn(async move { loop { tokio::time::sleep(std::time::Duration::from_secs(60)).await; if let Ok(c) = pool.get() {
        if let Ok(n) = moderation::sweep_stale_jobs(&c) { if n > 0 { tracing::warn!("{n} moderation job(s) escalated after timeout"); } }
        match groups::sweep_repeats(&c, &activity::day_key(time::OffsetDateTime::now_utc().date())) { Ok(n) if n > 0 => tracing::info!("{n} repeating group event(s) renewed"), Err(e) => tracing::warn!("event repeat sweep: {e}"), _ => {} }
    } } });
    let api = routes::router().layer(axum::middleware::from_fn_with_state(state.clone(), edition::guard)).layer(axum::middleware::from_fn(|req: axum::extract::Request, next: axum::middleware::Next| async move {
        let mut res = next.run(req).await;
        res.headers_mut().entry(header::CACHE_CONTROL).or_insert(HeaderValue::from_static("no-store"));
        res
    }));
    // development: the Expo/Metro dev server runs on another port, so allow any origin (Bearer tokens, no cookies
    // needed cross-origin). Production serves the client from this binary and stays same-origin.
    let api = if std::env::var("BEREAN_PROD").is_ok() { api } else { api.layer(CorsLayer::permissive()) };
    // an /api path that does not exist is a 404, never the web app's page: an app newer than the server once read
    // that 200 as "sent" (feedback answers, 2026-10-12)
    let api = api.fallback(|| async { error::ApiError::not_found("no such API") });
    let app = Router::new()
        .nest("/api", api)
        // Android App Links: invite and share links on the site open the installed app, verified against
        // the Play app-signing certificate (from the Play API's generated APKs) and the upload key (sideloaded builds)
        .route("/.well-known/assetlinks.json", axum::routing::get(|| async {
            ([(header::CONTENT_TYPE, "application/json"), (header::CACHE_CONTROL, "public, max-age=3600")], ASSETLINKS.as_str())
        }))
        .route("/get", axum::routing::get(store::get))
        .fallback(r#static::serve)
        // mp3 does not shrink (brotli spent ~0.3 s of CPU per 8 MB recording for nothing) and must keep its byte ranges;
        // the offline ministry packs are gzip already
        .layer(CompressionLayer::new().br(true).gzip(true).compress_when(DefaultPredicate::new().and(NotForContentType::const_new("audio/")).and(NotForContentType::const_new("application/gzip"))))
        .layer(TraceLayer::new_for_http())
        // the admin's live numbers (live.rs): every request into its hour's bucket
        .layer(axum::middleware::from_fn(live::measure))
        .with_state(state);
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8787);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("berean listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    // the peer address keys the feedback rate limit (see feedback::ClientAddr)
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}
