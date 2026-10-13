//! Reports, blocks and the admin queue. A report is first judged by Claude (raw HTTP, no Rust SDK) with a
//! structured verdict; `hide` takes the content down at once and queues it for the admin, `escalate` (or a
//! refusal, a missing key, an API error) leaves it up and queues it. Every queued report can ping a webhook
//! (BEREAN_MOD_WEBHOOK: Slack/Discord-compatible JSON). Nothing is silently dropped: `allow` is logged too.
//! What a reader may report under, what the judge is told, which scan hits always go on to it and which categories it
//! may `ban` for are the rules' (rules.rs, rs/moderation/): none of that is here. A sure `ban` verdict in a category
//! the rules let a judge ban for, or a second upheld strike under the same rule, suspends the author until the admin
//! allows or unbans.
use crate::auth::AuthUser;
use crate::db::{now_iso, DbPool};
use crate::scan;
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::{extract::{Path, Query, State}, routing::{get, post}, Json, Router};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

const MODEL: &str = "claude-opus-5";
/// The reason of a takedown notice: not a content rule, so no rule set decides it (see create_report).
const NOTICE: &str = "copyright";
/// What the rules say of the judge: its instructions and answer format, the scan categories sent on to it even when
/// the scan already decided (only the judge can ban), and the categories it may suspend an account for.
fn judge_rules() -> &'static crate::rules::Judge { &crate::rules::get().judge }
fn listed(list: &[String], category: &str) -> bool { list.iter().any(|c| c == category) }

#[derive(Deserialize)] struct ReportIn { kind: String, id: i64, reason: String, details: Option<String> }

/// The content under review, as text, with its author.
struct Target { preview: String, author_id: i64, author_handle: String, hidden: i64 }
fn load_target(conn: &Connection, kind: &str, id: i64) -> rusqlite::Result<Option<Target>> {
    let q = match kind {
        // a post is the jotting it shares (versionCode 36: no text of its own), read as the outline arm reads one
        "post" => "SELECT p.body || char(10) || coalesce((SELECT o.title || char(10) || coalesce(o.description,'') || char(10) || coalesce((SELECT group_concat(coalesce(i.text,''), char(10)) FROM outline_items i WHERE i.outline_id=o.id AND i.kind IN ('note','heading','link')), '') FROM outlines o WHERE o.id=p.outline_id), ''), u.id, u.handle, p.hidden FROM group_posts p JOIN users u ON u.id=p.user_id WHERE p.id=?1",
        "outline" => "SELECT o.title || char(10) || coalesce(o.description,'') || char(10) || coalesce((SELECT group_concat(coalesce(i.text,''), char(10)) FROM outline_items i WHERE i.outline_id=o.id AND i.kind IN ('note','heading','link')), ''), u.id, u.handle, o.hidden FROM outlines o JOIN users u ON u.id=o.user_id WHERE o.id=?1",
        _ => "SELECT u.display_name || ' (@' || u.handle || ')', u.id, u.handle, u.disabled FROM users u WHERE u.id=?1",
    };
    conn.query_row(q, params![id], |r| Ok(Target { preview: r.get::<_, String>(0)?.chars().take(4000).collect(), author_id: r.get(1)?, author_handle: r.get(2)?, hidden: r.get(3)? })).optional()
}

async fn create_report(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<ReportIn>) -> ApiResult<Json<Value>> {
    if !["post", "outline", "user"].contains(&b.kind.as_str()) { return Err(ApiError::bad("kind")); }
    if !listed(&crate::rules::get().report_reasons, &b.reason) { return Err(ApiError::bad("reason")); }
    let details = b.details.map(|d| d.chars().take(500).collect::<String>());
    let (id, target) = {
        let conn = s.pool.get()?;
        let Some(t) = load_target(&conn, &b.kind, b.id)? else { return Err(ApiError::not_found("nothing to report")) };
        if t.author_id == u.id { return Err(ApiError::bad("you cannot report your own content")); }
        // one open report per reporter per target
        let dup: Option<i64> = conn.query_row("SELECT id FROM reports WHERE reporter_id=?1 AND kind=?2 AND target_id=?3 AND status IN ('pending','hidden','escalated')", params![u.id, b.kind, b.id], |r| r.get(0)).optional()?;
        if let Some(d) = dup { return Ok(Json(json!({ "id": d, "status": "pending" }))); }
        conn.execute("INSERT INTO reports (reporter_id, kind, target_id, reason, details, author_id) VALUES (?1,?2,?3,?4,?5,?6)", params![u.id, b.kind, b.id, b.reason, details, t.author_id])?;
        (conn.last_insert_rowid(), t)
    };
    // a copyright report is a takedown notice, not a content-rule question: the post or jotting is hidden at once for
    // the admin (/copyright has the notice and counter-notice process), no judge sees it and nobody is banned by it.
    // An account is not hidden on one unverified claim; its report waits in the queue, visible.
    if b.reason == NOTICE {
        let hide = b.kind != "user";
        let (status, why) = if hide { ("hidden", "Copyright notice: hidden for a human to review; no AI review.") } else { ("escalated", "Copyright notice on an account: not hidden on one claim; a human reviews it.") };
        let conn = s.pool.get()?;
        conn.execute("UPDATE reports SET status=?1, ai_verdict='notice', ai_reason=?2, ai_category='copyright', ai_model='notice' WHERE id=?3", params![status, why, id])?;
        if hide { hide_target(&conn, &b.kind, target.author_id, id, true)?; }
        let text = format!("{} copyright notice: report #{id} ({}) by @{} is {status}", crate::brand::get().name, b.kind, target.author_handle);
        tokio::spawn(async move { webhook(&text).await });
        return Ok(Json(json!({ "id": id, "status": status })));
    }
    // rule scan first (free); a hard hit hides at once. Everything else is queued for the judge, and so is a hide in a
    // category the judge can ban for.
    let sv = scan::scan(&target.preview);
    let judged = sv.verdict != "hide" || listed(&judge_rules().always, &sv.category);
    {
        let conn = s.pool.get()?;
        conn.execute("INSERT INTO moderation_jobs (kind, target_id, source, report_id, status, scan_verdict, scan_reason) VALUES (?1,?2,'report',?3,'queued',?4,?5)", params![b.kind, b.id, id, sv.verdict, sv.reason])?;
        if sv.verdict == "hide" {
            conn.execute("UPDATE reports SET status='hidden', ai_verdict='rules', ai_reason=?1, ai_category=?2, ai_model='rules' WHERE id=?3", params![sv.reason, sv.category, id])?;
            if !judged { conn.execute("UPDATE moderation_jobs SET status='done', verdict='hide', reason=?1, category=?2, judged_by='rules', judged_at=?3 WHERE report_id=?4", params![sv.reason, sv.category, now_iso(), id])?; }
            hide_target(&conn, &b.kind, target.author_id, id, true)?;
        }
    }
    if judged && worker_token().is_none() && std::env::var("ANTHROPIC_API_KEY").is_ok() {
        let pool = s.pool.clone();
        let (kind, reason, det) = (b.kind.clone(), b.reason.clone(), details.clone().unwrap_or_default());
        tokio::spawn(async move { judge(pool, id, kind, reason, det, target).await });
    }
    Ok(Json(json!({ "id": id, "status": "pending" })))
}

fn worker_token() -> Option<String> { std::env::var("BEREAN_MOD_WORKER_TOKEN").ok().filter(|t| t.len() >= 16) }

/// Automatic scan of anything that becomes visible to others. Rule-based (no tokens). A hide hides the content and
/// opens an admin report attributed to the system; an escalate opens a visible one; allow records nothing. A hit in a
/// category the rules always send on is also queued for the worker's judge, which alone can ban.
pub fn auto_scan(conn: &Connection, kind: &str, target_id: i64) -> rusqlite::Result<()> {
    let Some(t) = load_target(conn, kind, target_id)? else { return Ok(()) };
    let sv = scan::scan(&t.preview);
    if sv.verdict == "allow" { return Ok(()); }
    let status = if sv.verdict == "hide" { "hidden" } else { "escalated" };
    // one open system report per target
    let open: Option<i64> = conn.query_row("SELECT id FROM reports WHERE reporter_id=0 AND kind=?1 AND target_id=?2 AND status IN ('pending','hidden','escalated')", params![kind, target_id], |r| r.get(0)).optional()?;
    if open.is_some() { return Ok(()); }
    conn.execute("INSERT INTO reports (reporter_id, kind, target_id, reason, details, status, ai_verdict, ai_reason, ai_category, ai_model, author_id) VALUES (0, ?1, ?2, ?3, 'automatic scan of shared content', ?4, ?5, ?6, ?3, 'rules', ?7)",
        params![kind, target_id, sv.category, status, sv.verdict, sv.reason, t.author_id])?;
    let rid = conn.last_insert_rowid();
    if listed(&judge_rules().always, &sv.category) && worker_token().is_some() {
        conn.execute("INSERT INTO moderation_jobs (kind, target_id, source, report_id, status, scan_verdict, scan_reason) VALUES (?1,?2,'auto',?3,'queued',?4,?5)", params![kind, target_id, rid, sv.verdict, sv.reason])?;
    } else {
        conn.execute("INSERT INTO moderation_jobs (kind, target_id, source, report_id, status, scan_verdict, scan_reason, verdict, reason, category, judged_by, judged_at) VALUES (?1,?2,'auto',?3,'done',?4,?5,?4,?5,?6,'rules',?7)", params![kind, target_id, rid, sv.verdict, sv.reason, sv.category, now_iso()])?;
    }
    if sv.verdict == "hide" { hide_target(conn, kind, t.author_id, rid, true)?; }
    let text = format!("{} auto-scan: {kind} by @{} is {status} — {}", crate::brand::get().name, t.author_handle, snippet(&sv.reason, 200));
    tokio::spawn(async move { webhook(&text).await });
    Ok(())
}

// ---------------- worker endpoints (the Grok judge on the MCP host) ----------------
#[derive(Deserialize)] struct TokenQ { token: String }
fn check_worker(q: &TokenQ) -> ApiResult<()> {
    let Some(t) = worker_token() else { return Err(ApiError::new(503, "no worker token configured")) };
    if q.token.as_bytes().len() != t.as_bytes().len() || !constant_eq(q.token.as_bytes(), t.as_bytes()) { return Err(ApiError::new(401, "bad worker token")); }
    Ok(())
}
fn constant_eq(a: &[u8], b: &[u8]) -> bool { a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0 }
async fn worker_jobs(State(s): State<AppState>, Query(q): Query<TokenQ>) -> ApiResult<Json<Vec<Value>>> {
    check_worker(&q)?;
    let conn = s.pool.get()?;
    conn.execute("UPDATE meta SET value=?1 WHERE key='worker_seen'", params![now_iso()])?;
    conn.execute("INSERT OR IGNORE INTO meta (key, value) VALUES ('worker_seen', ?1)", params![now_iso()])?;
    let mut st = conn.prepare_cached("SELECT j.id, j.kind, j.target_id, j.report_id, j.scan_verdict, j.scan_reason, r.reason, r.details FROM moderation_jobs j LEFT JOIN reports r ON r.id=j.report_id WHERE j.status='queued' ORDER BY j.id LIMIT 10")?;
    let rows: Vec<(i64, String, i64, Option<i64>, Option<String>, Option<String>, Option<String>, Option<String>)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)))?.collect::<Result<_, _>>()?;
    let mut out = Vec::new();
    for (id, kind, target_id, _rid, sv, sr, reason, details) in rows {
        let t = load_target(&conn, &kind, target_id)?;
        conn.execute("UPDATE moderation_jobs SET status='running' WHERE id=?1", params![id])?;
        out.push(json!({ "id": id, "kind": kind, "reason": reason, "details": details, "author": t.as_ref().map(|t| t.author_handle.clone()), "preview": t.map(|t| t.preview).unwrap_or_else(|| "(content no longer exists)".into()), "rules": judge_rules().instructions, "answer": judge_rules().worker_answer, "scan": format!("{} — {}", sv.unwrap_or_default(), sr.unwrap_or_default()) }));
    }
    Ok(Json(out))
}
#[derive(Deserialize)] struct VerdictIn { verdict: String, category: Option<String>, reason: Option<String>, confidence: Option<f64>, judged_by: Option<String> }
async fn worker_verdict(State(s): State<AppState>, Path(id): Path<i64>, Query(q): Query<TokenQ>, Json(v): Json<VerdictIn>) -> ApiResult<Json<Value>> {
    check_worker(&q)?;
    let conn = s.pool.get()?;
    let Some((kind, target_id, report_id)) = conn.query_row("SELECT kind, target_id, report_id FROM moderation_jobs WHERE id=?1 AND status IN ('queued','running')", params![id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, Option<i64>>(2)?))).optional()? else { return Err(ApiError::not_found("no such open job")) };
    if !["allow", "hide", "ban", "escalate"].contains(&v.verdict.as_str()) { return Err(ApiError::bad("verdict")); }
    let (category, reason, by) = (v.category.unwrap_or_else(|| "other".into()), v.reason.unwrap_or_default(), v.judged_by.unwrap_or_else(|| "worker".into()));
    let (final_verdict, reason) = match report_id {
        Some(rid) => settle(&conn, &kind, target_id, rid, &v.verdict, v.confidence.unwrap_or(0.5), &category, &reason, &by)?,
        None => ("escalate", reason),
    };
    conn.execute("UPDATE moderation_jobs SET status='done', verdict=?1, reason=?2, category=?3, judged_by=?4, judged_at=?5 WHERE id=?6", params![final_verdict, reason, category, by, now_iso(), id])?;
    Ok(Json(json!({ "ok": true, "verdict": final_verdict })))
}

/// Apply a judge's verdict to its report; returns the verdict applied and the reason recorded. Low confidence
/// downgrades (allow < 0.7, hide < 0.6 → escalate). `ban` needs a category the rules let a judge ban for and 0.85,
/// else it counts as a hide. A hide in such a category on an author with an earlier strike in it that a judge upheld
/// (never the rule scan alone) is a ban. An admin is never banned by a judge, and content the rules already hid is
/// never unhidden by one: the human decides.
fn settle(conn: &Connection, kind: &str, target_id: i64, rid: i64, verdict: &str, conf: f64, category: &str, reason: &str, by: &str) -> rusqlite::Result<(&'static str, String)> {
    let bannable = listed(&judge_rules().may_ban, category);
    let mut fv = match verdict { "ban" if bannable && conf >= 0.85 => "ban", "ban" | "hide" if conf >= 0.6 => "hide", "allow" if conf >= 0.7 => "allow", _ => "escalate" };
    let mut reason = reason.to_string();
    let target = load_target(conn, kind, target_id)?;
    let author = target.as_ref().map(|t| t.author_id);
    if let Some(a) = author { conn.execute("UPDATE reports SET author_id=?1 WHERE id=?2", params![a, rid])?; }
    if fv == "hide" && bannable {
        if let Some(a) = author {
            let strikes: i64 = conn.query_row("SELECT count(*) FROM reports WHERE author_id=?1 AND id<>?2 AND ai_category=?3 AND ai_verdict IN ('hide','ban') AND coalesce(ai_model,'') NOT IN ('rules','timeout') AND coalesce(resolution,'') NOT IN ('allow','unban')", params![a, rid, category], |r| r.get(0))?;
            if strikes > 0 { fv = "ban"; reason = format!("{reason} Repeat {category}-rule strike ({strikes} before): account suspended."); }
        }
    }
    if fv == "ban" && author.is_some_and(|a| conn.query_row("SELECT is_admin FROM users WHERE id=?1", params![a], |r| r.get::<_, i64>(0)).unwrap_or(0) == 1) { fv = "hide"; }
    let was_hidden = target.as_ref().is_some_and(|t| t.hidden == 1);
    if fv == "allow" && was_hidden { fv = "escalate"; }
    let status = match fv { "allow" => "allowed", "hide" | "ban" => "hidden", _ if was_hidden => "hidden", _ => "escalated" };
    conn.execute("UPDATE reports SET status=?1, ai_verdict=?2, ai_reason=?3, ai_category=?4, ai_model=?5 WHERE id=?6", params![status, fv, reason, category, by, rid])?;
    match (fv, author) {
        ("hide", Some(a)) => hide_target(conn, kind, a, rid, true)?,
        ("ban", Some(a)) => crate::bans::nuke(conn, a)?,
        _ => {}
    }
    if fv != "allow" {
        let who = target.map(|t| t.author_handle).unwrap_or_else(|| "?".into());
        let text = format!("{} moderation: report #{rid} ({kind}) by @{who} is {}{} — {by}: {}", crate::brand::get().name, status, if fv == "ban" { ", AUTHOR SUSPENDED" } else { "" }, snippet(&reason, 200));
        tokio::spawn(async move { webhook(&text).await });
    }
    Ok((fv, reason))
}



/// Jobs nobody judged in time go to the admin so a report never waits on a dead worker.
pub fn sweep_stale_jobs(conn: &Connection) -> rusqlite::Result<usize> {
    let secs: i64 = std::env::var("BEREAN_MOD_TIMEOUT_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(900);
    let mut st = conn.prepare_cached("SELECT id, report_id FROM moderation_jobs WHERE status IN ('queued','running') AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?1)")?;
    let stale: Vec<(i64, Option<i64>)> = st.query_map(params![format!("-{secs} seconds")], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    for (id, rid) in &stale {
        conn.execute("UPDATE moderation_jobs SET status='done', verdict='escalate', reason='No judge answered in time', judged_by='timeout', judged_at=?1 WHERE id=?2", params![now_iso(), id])?;
        if let Some(rid) = rid { conn.execute("UPDATE reports SET status='escalated', ai_verdict='escalate', ai_reason='No judge answered in time; needs a human.', ai_model='timeout' WHERE id=?1 AND status='pending'", params![rid])?; }
    }
    Ok(stale.len())
}

#[derive(Deserialize)] struct Verdict { verdict: String, category: String, reason: String, confidence: f64 }

/// Ask Claude for a structured verdict. Any failure path ends in `escalated` so a human sees it.
async fn judge(pool: DbPool, report_id: i64, kind: String, reason: String, details: String, t: Target) {
    let outcome = judge_inner(&kind, &reason, &details, &t).await;
    let (status, verdict, ai_reason, category) = match outcome {
        Ok(v) => {
            let Ok(conn) = pool.get() else { return };
            let _ = conn.query_row("SELECT target_id FROM reports WHERE id=?1", params![report_id], |r| r.get::<_, i64>(0))
                .and_then(|tid| settle(&conn, &kind, tid, report_id, &v.verdict, v.confidence, &v.category, &v.reason, MODEL));
            return;
        }
        Err(JudgeError::Refused(cat)) => ("escalated", "refused".to_string(), "The model declined to assess this content; it needs a human.".to_string(), cat),
        Err(JudgeError::NotConfigured) => ("escalated", "none".to_string(), "AI moderation is not configured (ANTHROPIC_API_KEY unset).".to_string(), String::new()),
        Err(JudgeError::Other(e)) => ("escalated", "error".to_string(), format!("AI moderation failed: {e}"), String::new()),
    };
    let notify = {
        let Ok(conn) = pool.get() else { return };
        let _ = conn.execute("UPDATE reports SET status=?1, ai_verdict=?2, ai_reason=?3, ai_category=?4, ai_model=?5 WHERE id=?6", params![status, verdict, ai_reason, category, MODEL, report_id]);
        if status == "hidden" { let _ = hide_target(&conn, &kind, t.author_id, report_id, true); }
        status != "allowed"
    };
    if notify { webhook(&format!("{} moderation: report #{report_id} ({kind}, {reason}) by @{} is {status} — AI: {verdict}. {}", crate::brand::get().name, t.author_handle, snippet(&ai_reason, 200))).await; }
}

enum JudgeError { Refused(String), NotConfigured, Other(String) }

async fn judge_inner(kind: &str, reason: &str, details: &str, t: &Target) -> Result<Verdict, JudgeError> {
    let key = std::env::var("ANTHROPIC_API_KEY").map_err(|_| JudgeError::NotConfigured)?;
    let system = judge_rules().instructions.as_str();
    let user = format!("Report kind: {kind}\nReporter's reason: {reason}\nReporter's details: {details}\nAuthor: @{}\n\nContent under review:\n<<<\n{}\n>>>\n\n{}", t.author_handle, t.preview, judge_rules().answer);
    let body = json!({
        "model": MODEL,
        "max_tokens": 1024,
        "fallbacks": "default",
        "system": system,
        "output_config": { "effort": "low", "format": { "type": "json_schema", "schema": {
            "type": "object",
            "properties": { "verdict": { "type": "string", "enum": ["allow", "hide", "ban", "escalate"] }, "category": { "type": "string" }, "reason": { "type": "string" }, "confidence": { "type": "number" } },
            "required": ["verdict", "category", "reason", "confidence"], "additionalProperties": false } } },
        "messages": [{ "role": "user", "content": user }]
    });
    let client = reqwest::Client::new();
    let res = client.post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key).header("anthropic-version", "2023-06-01").header("anthropic-beta", "server-side-fallback-2026-07-01").header("content-type", "application/json")
        .timeout(std::time::Duration::from_secs(90)).json(&body).send().await.map_err(|e| JudgeError::Other(e.to_string()))?;
    let status = res.status();
    let v: Value = res.json().await.map_err(|e| JudgeError::Other(e.to_string()))?;
    if !status.is_success() { return Err(JudgeError::Other(format!("HTTP {status}: {}", v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).unwrap_or("?")))); }
    // branch on stop_reason before reading content: a classifier decline is HTTP 200 with stop_reason "refusal"
    if v.get("stop_reason").and_then(|s| s.as_str()) == Some("refusal") {
        let cat = v.pointer("/stop_details/category").and_then(|c| c.as_str()).unwrap_or("unspecified").to_string();
        return Err(JudgeError::Refused(cat));
    }
    if v.get("stop_reason").and_then(|s| s.as_str()) == Some("max_tokens") { return Err(JudgeError::Other("verdict truncated".into())); }
    let text = v.get("content").and_then(|c| c.as_array()).and_then(|blocks| blocks.iter().find(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))).and_then(|b| b.get("text")).and_then(|t| t.as_str()).ok_or_else(|| JudgeError::Other("no text block".into()))?;
    serde_json::from_str::<Verdict>(text).map_err(|e| JudgeError::Other(format!("bad verdict json: {e}")))
}

fn snippet(s: &str, n: usize) -> String { s.chars().take(n).collect() }

pub(crate) async fn webhook(text: &str) {
    let Ok(url) = std::env::var("BEREAN_MOD_WEBHOOK") else { return };
    let _ = reqwest::Client::new().post(url).timeout(std::time::Duration::from_secs(10)).json(&json!({ "text": text, "content": text })).send().await;
}

/// Hide (or unhide) the reported content. For a user report, hides everything they wrote.
fn hide_target(conn: &Connection, kind: &str, author_or_id: i64, report_id: i64, hidden: bool) -> rusqlite::Result<()> {
    let h = hidden as i64;
    let target_id: i64 = conn.query_row("SELECT target_id FROM reports WHERE id=?1", params![report_id], |r| r.get(0))?;
    match kind {
        "post" => { conn.execute("UPDATE group_posts SET hidden=?1 WHERE id=?2", params![h, target_id])?; }
        "outline" => { conn.execute("UPDATE outlines SET hidden=?1 WHERE id=?2", params![h, target_id])?; }
        _ => { conn.execute("UPDATE group_posts SET hidden=?1 WHERE user_id=?2", params![h, author_or_id])?; conn.execute("UPDATE outlines SET hidden=?1 WHERE user_id=?2", params![h, author_or_id])?; }
    }
    Ok(())
}

// ---------------- blocks ----------------
#[derive(Deserialize)] struct BlockIn { user_id: i64 }
async fn block(State(s): State<AppState>, AuthUser(u): AuthUser, Json(b): Json<BlockIn>) -> ApiResult<Json<Value>> {
    if b.user_id == u.id { return Err(ApiError::bad("you cannot block yourself")); }
    let conn = s.pool.get()?;
    conn.execute("INSERT OR IGNORE INTO blocks (user_id, blocked_id) VALUES (?1, ?2)", params![u.id, b.user_id])?;
    // a block ends a friendship and everything shared along it (friends.rs)
    crate::friends::sever(&conn, u.id, b.user_id)?;
    Ok(Json(json!({ "ok": true })))
}
async fn unblock(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = s.pool.get()?;
    conn.execute("DELETE FROM blocks WHERE user_id=?1 AND blocked_id=?2", params![u.id, id])?;
    Ok(Json(json!({ "ok": true })))
}
async fn list_blocks(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Vec<Value>>> {
    let conn = s.pool.get()?;
    let mut st = conn.prepare_cached("SELECT u.id, u.handle, u.display_name FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=?1 ORDER BY b.created_at DESC")?;
    let v: Vec<Value> = st.query_map(params![u.id], |r| Ok(json!({ "user_id": r.get::<_, i64>(0)?, "handle": r.get::<_, String>(1)?, "display_name": r.get::<_, String>(2)? })))?.collect::<Result<_, _>>()?;
    Ok(Json(v))
}

// ---------------- admin ----------------
pub(crate) fn require_admin(u: &crate::auth::User) -> ApiResult<()> { if u.is_admin == 1 { Ok(()) } else { Err(ApiError::forbidden("site admins only")) } }
#[derive(Deserialize)] struct ListQ { status: Option<String> }
async fn admin_list(State(s): State<AppState>, AuthUser(u): AuthUser, Query(q): Query<ListQ>) -> ApiResult<Json<Vec<Value>>> {
    require_admin(&u)?;
    let conn = s.pool.get()?;
    let all = q.status.as_deref() == Some("all");
    let sql = format!("SELECT r.id, r.kind, r.target_id, r.reason, r.details, r.status, r.ai_verdict, r.ai_reason, r.ai_category, r.created_at, ru.handle, r.resolution FROM reports r LEFT JOIN users ru ON ru.id=r.reporter_id {} ORDER BY r.created_at DESC LIMIT 200", if all { "" } else { "WHERE r.status IN ('pending','hidden','escalated')" });
    let mut st = conn.prepare(&sql)?;
    let rows: Vec<(i64, String, i64, String, Option<String>, String, Option<String>, Option<String>, Option<String>, String, Option<String>, Option<String>)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?)))?.collect::<Result<_, _>>()?;
    let mut out = Vec::with_capacity(rows.len());
    for (id, kind, target_id, reason, details, status, ai_verdict, ai_reason, ai_category, created_at, reporter, resolution) in rows {
        let target = load_target(&conn, &kind, target_id)?.map(|t| {
            let banned: i64 = conn.query_row("SELECT disabled FROM users WHERE id=?1", params![t.author_id], |r| r.get(0)).unwrap_or(0);
            json!({ "preview": t.preview, "author": { "id": t.author_id, "handle": t.author_handle, "banned": banned }, "hidden": t.hidden })
        }).unwrap_or(json!({ "preview": "(content no longer exists)", "author": null, "hidden": 0 }));
        out.push(json!({ "id": id, "kind": kind, "target_id": target_id, "reason": reason, "details": details, "status": status, "ai_verdict": ai_verdict, "ai_reason": ai_reason, "ai_category": ai_category, "created_at": created_at, "reporter": { "handle": reporter.unwrap_or_else(|| "system".into()) }, "resolution": resolution, "target": target }));
    }
    Ok(Json(out))
}
#[derive(Deserialize)] struct ActionIn { action: String }
async fn admin_act(State(s): State<AppState>, AuthUser(u): AuthUser, Path(id): Path<i64>, Json(b): Json<ActionIn>) -> ApiResult<Json<Value>> {
    require_admin(&u)?;
    let conn = s.pool.get()?;
    let Some((kind, target_id)) = conn.query_row("SELECT kind, target_id FROM reports WHERE id=?1", params![id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).optional()? else { return Err(ApiError::not_found("no such report")) };
    let author: Option<i64> = load_target(&conn, &kind, target_id)?.map(|t| t.author_id);
    let judge_banned: bool = conn.query_row("SELECT ai_verdict='ban' FROM reports WHERE id=?1", params![id], |r| r.get::<_, Option<bool>>(0))?.unwrap_or(false);
    match b.action.as_str() {
        // allowing what a judge banned for also lifts the ban
        "allow" => { if let Some(a) = author { hide_target(&conn, &kind, a, id, false)?; if judge_banned { crate::bans::unnuke(&conn, a, id)?; } } }
        "unban" => { if let Some(a) = author { crate::bans::unnuke(&conn, a, id)?; } }
        "remove" => match kind.as_str() {
            "post" => { conn.execute("DELETE FROM group_posts WHERE id=?1", params![target_id])?; }
            "outline" => { conn.execute("DELETE FROM outlines WHERE id=?1", params![target_id])?; }
            _ => { if let Some(a) = author { hide_target(&conn, &kind, a, id, true)?; } }
        },
        "ban" => {
            if let Some(a) = author {
                if a == u.id { return Err(ApiError::bad("you cannot ban yourself")); }
                crate::bans::nuke(&conn, a)?;
            }
        }
        _ => return Err(ApiError::bad("action")),
    }
    conn.execute("UPDATE reports SET status='resolved', resolved_at=?1, resolved_by=?2, resolution=?3 WHERE id=?4", params![now_iso(), u.id, b.action, id])?;
    // the same content may carry other open reports; close them with the same decision
    conn.execute("UPDATE reports SET status='resolved', resolved_at=?1, resolved_by=?2, resolution=?3 WHERE kind=?4 AND target_id=?5 AND status IN ('pending','hidden','escalated')", params![now_iso(), u.id, b.action, kind, target_id])?;
    Ok(Json(json!({ "ok": true })))
}
async fn admin_summary(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Value>> {
    require_admin(&u)?;
    let conn = s.pool.get()?;
    let pending: i64 = conn.query_row("SELECT count(*) FROM reports WHERE status IN ('pending','hidden','escalated')", [], |r| r.get(0))?;
    let queued: i64 = conn.query_row("SELECT count(*) FROM moderation_jobs WHERE status IN ('queued','running')", [], |r| r.get(0))?;
    let seen: Option<String> = conn.query_row("SELECT value FROM meta WHERE key='worker_seen'", [], |r| r.get(0)).optional()?;
    let judge = if worker_token().is_some() { "worker" } else if std::env::var("ANTHROPIC_API_KEY").is_ok() { "claude" } else { "none" };
    Ok(Json(json!({ "pending": pending, "jobs_queued": queued, "judge": judge, "last_worker_seen": seen, "blocklist_domains": scan::BLOCKLIST.size(), "blocklist_age_secs": scan::BLOCKLIST.age_secs(), "ai_configured": std::env::var("ANTHROPIC_API_KEY").is_ok(), "webhook_configured": std::env::var("BEREAN_MOD_WEBHOOK").is_ok() })))
}

/// Every group, most recently active first, for the admin panel; each opens to a site admin in Admin mode.
async fn admin_groups(State(s): State<AppState>, AuthUser(u): AuthUser) -> ApiResult<Json<Vec<Value>>> {
    require_admin(&u)?;
    let conn = s.pool.get()?;
    let mut st = conn.prepare_cached("SELECT g.id, g.name, g.slug, g.created_at, o.handle,
        (SELECT count(*) FROM group_members m WHERE m.group_id=g.id),
        (SELECT count(*) FROM group_posts p WHERE p.group_id=g.id AND (p.outline_id IS NOT NULL OR p.notice=1)),
        (SELECT max(p.created_at) FROM group_posts p WHERE p.group_id=g.id),
        (SELECT role FROM group_members m WHERE m.group_id=g.id AND m.user_id=?1)
        FROM groups g JOIN users o ON o.id=g.owner_id ORDER BY coalesce((SELECT max(p.created_at) FROM group_posts p WHERE p.group_id=g.id), g.created_at) DESC")?;
    let v: Vec<Value> = st.query_map(params![u.id], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "name": r.get::<_, String>(1)?, "slug": r.get::<_, String>(2)?, "created_at": r.get::<_, String>(3)?, "owner": r.get::<_, String>(4)?,
        "member_count": r.get::<_, i64>(5)?, "post_count": r.get::<_, i64>(6)?, "last_post_at": r.get::<_, Option<String>>(7)?, "my_role": r.get::<_, Option<String>>(8)? })))?.collect::<Result<_, _>>()?;
    Ok(Json(v))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/reports", post(create_report))
        .route("/blocks", get(list_blocks).post(block))
        .route("/blocks/{id}", axum::routing::delete(unblock))
        .route("/admin/reports", get(admin_list))
        .route("/admin/reports/{id}", post(admin_act))
        .route("/admin/summary", get(admin_summary))
        .route("/admin/groups", get(admin_groups))
        .route("/mod/jobs", get(worker_jobs))
        .route("/mod/jobs/{id}/verdict", post(worker_verdict))
}

#[cfg(test)]
mod tests {
    use crate::testkit::{app, call, user};
    use axum::Router;
    use rusqlite::params;
    use serde_json::{json, Value};
    const TOK: &str = "test-worker-token-0123456789";
    fn worker_on() { static ONCE: std::sync::Once = std::sync::Once::new(); ONCE.call_once(|| std::env::set_var("BEREAN_MOD_WORKER_TOKEN", TOK)); }
    /// The texts and categories a test posts and answers with are the rules' own examples (tests.json, `flows`), since
    /// what they must be depends on the rules: each test says what it needs of them.
    fn flow(test: &str) -> Value { let v = crate::testkit::policy_tests()["flows"][test].clone(); assert!(v.is_object(), "tests.json has no flows.{test}"); v }
    fn s<'a>(f: &'a Value, key: &str) -> &'a str { f[key].as_str().unwrap_or_else(|| panic!("tests.json: a flow has no {key}")) }

    /// anna (reporter) and ben (author) in one group; returns (app, pool, anna, ben_id, ben, slug).
    async fn setup() -> (Router, crate::db::DbPool, String, i64, String, String) {
        worker_on();
        let (app, pool) = app();
        let (_, anna) = user(&pool, "anna");
        let (ben_id, ben) = user(&pool, "ben");
        let (_, g) = call(&app, "POST", "/groups", Some(&anna), json!({ "name": "Psalms" })).await;
        call(&app, "POST", "/groups/join", Some(&ben), json!({ "invite_code": g["invite_code"] })).await;
        (app, pool, anna, ben_id, ben, g["slug"].as_str().unwrap().to_string())
    }
    /// Shares into the group a private jotting whose one note is `body` (a group shares jottings only).
    async fn post(app: &Router, tok: &str, slug: &str, body: &str) -> i64 {
        let (_, o) = call(app, "POST", "/outlines", Some(tok), json!({ "title": "Notes" })).await;
        let oid = o["id"].as_i64().unwrap();
        call(app, "PUT", &format!("/outlines/{oid}/items"), Some(tok), json!({ "items": [{ "kind": "note", "text": body }] })).await;
        call(app, "POST", &format!("/groups/{slug}/posts"), Some(tok), json!({ "outline_id": oid })).await.1["id"].as_i64().unwrap()
    }
    /// Answer every queued job with `verdict`; returns the verdicts the server applied. Each job carries the rules'
    /// instructions and the worker's answer format, whole.
    async fn judge_all(app: &Router, verdict: Value) -> Vec<String> {
        let (_, jobs) = call(app, "GET", &format!("/mod/jobs?token={TOK}"), None, Value::Null).await;
        let mut out = Vec::new();
        for j in jobs.as_array().unwrap() {
            let told = &crate::rules::get().judge;
            assert_eq!((j["rules"].as_str(), j["answer"].as_str()), (Some(told.instructions.as_str()), Some(told.worker_answer.as_str())));
            let (_, r) = call(app, "POST", &format!("/mod/jobs/{}/verdict?token={TOK}", j["id"]), None, verdict.clone()).await;
            out.push(r["verdict"].as_str().unwrap().to_string());
        }
        out
    }
    async fn report(app: &Router, tok: &str, id: i64) { assert_eq!(call(app, "POST", "/reports", Some(tok), json!({ "kind": "post", "id": id, "reason": crate::testkit::report_reason() })).await.0, 200); }
    fn disabled(pool: &crate::db::DbPool, uid: i64) -> i64 { pool.get().unwrap().query_row("SELECT disabled FROM users WHERE id=?1", params![uid], |r| r.get(0)).unwrap() }
    fn hidden(pool: &crate::db::DbPool, pid: i64) -> i64 { pool.get().unwrap().query_row("SELECT hidden FROM group_posts WHERE id=?1", params![pid], |r| r.get(0)).unwrap() }

    /// `category`: one a judge may ban for. `post`: a violation of it that no scan rule hides.
    #[tokio::test]
    async fn a_sure_verdict_under_a_rule_that_bans_suspends_and_the_admin_can_lift_it() {
        let f = flow("a_sure_verdict");
        let (app, pool, anna, ben_id, ben, slug) = setup().await;
        let other = post(&app, &ben, &slug, "Good reading in Romans 8").await;
        // only the judge sees it for what it is
        let p = post(&app, &ben, &slug, s(&f, "post")).await;
        report(&app, &anna, p).await;
        assert_eq!(judge_all(&app, json!({ "verdict": "ban", "category": s(&f, "category"), "reason": s(&f, "judge_reason"), "confidence": 0.92 })).await, ["ban"]);
        assert_eq!(disabled(&pool, ben_id), 1);
        assert_eq!((hidden(&pool, p), hidden(&pool, other)), (1, 1));
        let sessions: i64 = pool.get().unwrap().query_row("SELECT count(*) FROM sessions WHERE user_id=?1", params![ben_id], |r| r.get(0)).unwrap();
        assert_eq!(sessions, 0);
        let (admin_id, admin) = user(&pool, "admin");
        pool.get().unwrap().execute("UPDATE users SET is_admin=1 WHERE id=?1", params![admin_id]).unwrap();
        let (_, q) = call(&app, "GET", "/admin/reports", Some(&admin), Value::Null).await;
        assert_eq!((q[0]["ai_verdict"].as_str(), q[0]["status"].as_str(), q[0]["target"]["author"]["banned"].as_i64()), (Some("ban"), Some("hidden"), Some(1)));
        call(&app, "POST", &format!("/admin/reports/{}", q[0]["id"]), Some(&admin), json!({ "action": "allow" })).await;
        assert_eq!(disabled(&pool, ben_id), 0);
        assert_eq!((hidden(&pool, p), hidden(&pool, other)), (0, 0));
    }

    /// `other_category`: one no judge may ban for. `category`: one a judge may ban for; `second` and `third`: two
    /// violations of it that no scan rule hides.
    #[tokio::test]
    async fn an_unsure_ban_or_one_under_another_rule_is_a_hide_and_the_second_strike_bans() {
        let f = flow("second_strike");
        let (app, pool, anna, ben_id, ben, slug) = setup().await;
        let p1 = post(&app, &ben, &slug, "you are all fools").await;
        report(&app, &anna, p1).await;
        assert_eq!(judge_all(&app, json!({ "verdict": "ban", "category": s(&f, "other_category"), "reason": "insult", "confidence": 0.95 })).await, ["hide"]);
        let p2 = post(&app, &ben, &slug, s(&f, "second")).await;
        report(&app, &anna, p2).await;
        assert_eq!(judge_all(&app, json!({ "verdict": "ban", "category": s(&f, "category"), "reason": "insinuation", "confidence": 0.7 })).await, ["hide"]);
        assert_eq!(disabled(&pool, ben_id), 0);
        let p3 = post(&app, &ben, &slug, s(&f, "third")).await;
        report(&app, &anna, p3).await;
        assert_eq!(judge_all(&app, json!({ "verdict": "hide", "category": s(&f, "category"), "reason": "again", "confidence": 0.8 })).await, ["ban"]);
        assert_eq!(disabled(&pool, ben_id), 1);
    }

    /// `post` and `quoted`: two texts a scan rule hides, in a `category` the rules always send on to the judge and let
    /// it ban for. `allow_category`: what the judge says of a text it allows.
    #[tokio::test]
    async fn what_the_rules_hide_at_once_the_judge_may_ban_for_and_never_unhides() {
        let f = flow("hidden_at_once");
        let (app, pool, _, ben_id, ben, slug) = setup().await;
        let p = post(&app, &ben, &slug, s(&f, "post")).await;
        assert_eq!(hidden(&pool, p), 1);
        assert_eq!(judge_all(&app, json!({ "verdict": "ban", "category": s(&f, "category"), "reason": s(&f, "judge_reason"), "confidence": 0.95 })).await, ["ban"]);
        assert_eq!(disabled(&pool, ben_id), 1);
        // a judge that disagrees never unhides what the rules hid
        let (app, pool, _, ben_id, ben, slug) = setup().await;
        let p = post(&app, &ben, &slug, s(&f, "quoted")).await;
        assert_eq!(judge_all(&app, json!({ "verdict": "allow", "category": s(&f, "allow_category"), "reason": "discussion", "confidence": 0.9 })).await, ["escalate"]);
        assert_eq!((hidden(&pool, p), disabled(&pool, ben_id)), (1, 0));
    }

    /// `category`: one a judge may ban for; `post`: a violation of it that no scan rule hides. `threat`: a text the scan
    /// only escalates, in a category the rules always send on to the judge. A blocklisted link must be a hide in
    /// `category`, sent on too.
    #[tokio::test]
    async fn a_ban_under_another_rule_and_the_scan_hits_only_a_judge_can_ban_for_reach_the_judge() {
        let f = flow("another_rule");
        let (app, pool, anna, ben_id, ben, slug) = setup().await;
        let p = post(&app, &ben, &slug, s(&f, "post")).await;
        report(&app, &anna, p).await;
        assert_eq!(judge_all(&app, json!({ "verdict": "ban", "category": s(&f, "category"), "reason": s(&f, "judge_reason"), "confidence": 0.9 })).await, ["ban"]);
        assert_eq!(disabled(&pool, ben_id), 1);
        // a threat escalates on the scan and still reaches the judge; a malware link hides and still reaches it
        let (app, pool, _, ben_id, ben, slug) = setup().await;
        post(&app, &ben, &slug, s(&f, "threat")).await;
        crate::scan::BLOCKLIST.domains.write().unwrap().insert("malware.example".into());
        let p = post(&app, &ben, &slug, "free study guide http://malware.example/guide").await;
        assert_eq!(hidden(&pool, p), 1);
        assert_eq!(judge_all(&app, json!({ "verdict": "hide", "category": s(&f, "category"), "reason": "x", "confidence": 0.8 })).await, ["hide", "ban"]);
        assert_eq!(disabled(&pool, ben_id), 1);
    }

    /// `category`: one a judge may ban for. `post`: any text no scan rule hides.
    #[tokio::test]
    async fn a_judge_never_bans_an_admin() {
        let f = flow("an_admin");
        let (app, pool, anna, ben_id, ben, slug) = setup().await;
        pool.get().unwrap().execute("UPDATE users SET is_admin=1 WHERE id=?1", params![ben_id]).unwrap();
        let p = post(&app, &ben, &slug, s(&f, "post")).await;
        report(&app, &anna, p).await;
        assert_eq!(judge_all(&app, json!({ "verdict": "ban", "category": s(&f, "category"), "reason": "x", "confidence": 0.99 })).await, ["hide"]);
        assert_eq!(disabled(&pool, ben_id), 0);
    }

    #[tokio::test]
    async fn a_copyright_report_hides_for_the_admin_and_never_bans() {
        let (app, pool, anna, ben_id, ben, slug) = setup().await;
        let p = post(&app, &ben, &slug, "Chapter one of a book I did not write, pasted whole").await;
        let (st, r) = call(&app, "POST", "/reports", Some(&anna), json!({ "kind": "post", "id": p, "reason": "copyright", "details": "my book" })).await;
        assert_eq!((st, r["status"].as_str()), (200, Some("hidden")));
        assert_eq!((hidden(&pool, p), disabled(&pool, ben_id)), (1, 0));
        // no judge sees it: nothing queued for the worker
        let (_, jobs) = call(&app, "GET", &format!("/mod/jobs?token={TOK}"), None, Value::Null).await;
        assert!(jobs.as_array().unwrap().is_empty());
        let (admin_id, admin) = user(&pool, "admin");
        pool.get().unwrap().execute("UPDATE users SET is_admin=1 WHERE id=?1", params![admin_id]).unwrap();
        let (_, q) = call(&app, "GET", "/admin/reports", Some(&admin), Value::Null).await;
        assert_eq!((q[0]["reason"].as_str(), q[0]["status"].as_str(), q[0]["ai_verdict"].as_str(), q[0]["target"]["hidden"].as_i64()), (Some("copyright"), Some("hidden"), Some("notice"), Some(1)));
        // a counter-notice upheld: allow puts it back
        call(&app, "POST", &format!("/admin/reports/{}", q[0]["id"]), Some(&admin), json!({ "action": "allow" })).await;
        assert_eq!(hidden(&pool, p), 0);
        // an account is not hidden on one unverified claim: its report waits in the queue, visible
        let (st, r) = call(&app, "POST", "/reports", Some(&anna), json!({ "kind": "user", "id": ben_id, "reason": "copyright" })).await;
        assert_eq!((st, r["status"].as_str()), (200, Some("escalated")));
        assert_eq!((hidden(&pool, p), disabled(&pool, ben_id)), (0, 0));
        let (_, q) = call(&app, "GET", "/admin/reports", Some(&admin), Value::Null).await;
        assert_eq!((q[0]["kind"].as_str(), q[0]["status"].as_str()), (Some("user"), Some("escalated")));
    }

    /// `handle`: a handle the rules refuse. `display_refused` and `display_taken`: a display name they refuse and one
    /// close to it that they take.
    #[tokio::test]
    async fn names_the_rules_refuse_are_refused_at_sign_up_and_on_rename() {
        let f = flow("names");
        let (app, _pool) = app();
        let (st, _) = call(&app, "POST", "/auth/register", None, json!({ "handle": s(&f, "handle"), "password": "correct horse battery" })).await;
        assert_eq!(st, 400);
        let (st, v) = call(&app, "POST", "/auth/register", None, json!({ "handle": "reader_1", "password": "correct horse battery" })).await;
        assert_eq!(st, 200);
        let tok = v["token"].as_str().unwrap();
        assert_eq!(call(&app, "PATCH", "/me", Some(tok), json!({ "display_name": s(&f, "display_refused") })).await.0, 400);
        assert_eq!(call(&app, "PATCH", "/me", Some(tok), json!({ "display_name": s(&f, "display_taken") })).await.0, 200);
    }
}
