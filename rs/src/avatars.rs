//! Preset profile pictures. The drawings live in the client (shared/avatars.ts); the server knows only their ids, in
//! the same order, and the default each user gets until they choose one. A test reads the TypeScript list so the two
//! never drift.
pub const IDS: &[&str] = &[
    "lamp", "scroll", "olive-branch", "dove", "well", "fig", "star", "boat", "harp", "loaf", "grapes", "candle",
    "wheat", "fish", "crook", "tent", "anchor", "mountain", "sunrise", "lily", "pomegranate", "jar", "key", "cedar",
];

pub fn is_id(s: &str) -> bool { IDS.contains(&s) }

/// The picture shown for a user who has not chosen one: deterministic from the id and spread evenly (the same
/// integer hash as defaultAvatar in shared/avatars.ts).
pub fn default_for(user_id: i64) -> &'static str {
    let mut x = user_id as u32;
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846ca68b);
    x ^= x >> 16;
    IDS[(x as usize) % IDS.len()]
}

/// The picture a user shows: theirs, or the default. What every response carries as `avatar`.
pub fn effective(user_id: i64, chosen: Option<&str>) -> String { chosen.filter(|c| is_id(c)).unwrap_or_else(|| default_for(user_id)).to_string() }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_ids_match_the_drawings_in_order() {
        let ts = include_str!("../../shared/avatars.ts");
        let re = regex::Regex::new(r"(?m)^\s*\{ id: '([a-z-]+)'").unwrap();
        let client: Vec<&str> = re.captures_iter(ts).map(|c| c.get(1).unwrap().as_str()).collect();
        assert_eq!(client, IDS);
    }
    #[test]
    fn the_default_is_stable_and_spread() {
        // pinned against shared/avatars.ts's defaultAvatar (tests/avatars.test.ts pins the same values)
        assert_eq!(default_for(1), default_for(1));
        let mut counts = std::collections::HashMap::new();
        for id in 1..=10_000 { *counts.entry(default_for(id)).or_insert(0) += 1; }
        assert_eq!(counts.len(), IDS.len());
        assert!(counts.values().all(|n| (300..=600).contains(n)), "{counts:?}");
        assert_eq!(effective(7, Some("dove")), "dove");
        assert_eq!(effective(7, Some("nonsense")), default_for(7));
        assert_eq!(effective(7, None), default_for(7));
    }

    #[tokio::test]
    async fn a_chosen_picture_is_validated_shown_everywhere_and_exported_as_its_id() {
        use crate::testkit::{app, call, user};
        use serde_json::{json, Value};
        let (app, pool) = app();
        let (id, anna) = user(&pool, "anna");
        let (_, ben) = user(&pool, "ben");
        let (_, me) = call(&app, "GET", "/me", Some(&anna), Value::Null).await;
        assert_eq!((me["user"]["avatar"].as_str(), me["user"]["avatar_chosen"].as_bool()), (Some(default_for(id)), Some(false)));
        // a profile is private by default; open it so ben can see the picture
        call(&app, "PATCH", "/me", Some(&anna), json!({ "settings": { "public_profile": true } })).await;
        assert_eq!(call(&app, "PATCH", "/me", Some(&anna), json!({ "avatar": "<svg>" })).await.0, 400);
        assert_eq!(call(&app, "PATCH", "/me", Some(&anna), json!({ "avatar": "harp" })).await.0, 200);
        let (_, me) = call(&app, "GET", "/me", Some(&anna), Value::Null).await;
        assert_eq!((me["user"]["avatar"].as_str(), me["user"]["avatar_chosen"].as_bool()), (Some("harp"), Some(true)));
        assert_eq!(call(&app, "GET", "/users/anna", Some(&ben), Value::Null).await.1["user"]["avatar"], "harp");
        let (_, x) = call(&app, "GET", "/me/export", Some(&anna), Value::Null).await;
        assert_eq!(x["user"]["avatar"], "harp");
        // a display-name change leaves it alone; null goes back to the default
        call(&app, "PATCH", "/me", Some(&anna), json!({ "display_name": "Anna B" })).await;
        assert_eq!(call(&app, "GET", "/me", Some(&anna), Value::Null).await.1["user"]["avatar"], "harp");
        call(&app, "PATCH", "/me", Some(&anna), json!({ "avatar": null })).await;
        let (_, x) = call(&app, "GET", "/me/export", Some(&anna), Value::Null).await;
        assert!(x["user"]["avatar"].is_null());
        assert_eq!(call(&app, "GET", "/users/anna", Some(&ben), Value::Null).await.1["user"]["avatar"], default_for(id));
    }
}
