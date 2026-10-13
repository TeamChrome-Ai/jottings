use once_cell::sync::Lazy;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct Badge { pub code: &'static str, pub name: &'static str, pub description: &'static str, pub icon: &'static str, #[serde(skip_serializing_if = "Option::is_none")] pub earned_at: Option<String> }

struct Def { code: &'static str, name: &'static str, description: &'static str, icon: &'static str, test: fn(&Connection, i64, &str) -> bool }

fn count(c: &Connection, sql: &str, uid: i64) -> i64 { c.query_row(sql, params![uid], |r| r.get(0)).unwrap_or(0) }
fn seconds(c: &Connection, uid: i64) -> i64 { count(c, "SELECT coalesce(sum(active_seconds),0) FROM activity_days WHERE user_id=?1", uid) }
fn credits(c: &Connection, uid: i64) -> i64 { count(c, "SELECT count(*) FROM page_credits WHERE user_id=?1", uid) }
fn streak(c: &Connection, uid: i64, today: &str) -> i64 { crate::activity::streak_info(c, uid, today).map(|s| s.current).unwrap_or(0) }
fn book_done(c: &Connection, uid: i64, book: i64) -> bool { c.query_row("SELECT (SELECT count(*) FROM chapters_read WHERE user_id=?1 AND book=?2) >= (SELECT count(*) FROM chapters WHERE book=?2)", params![uid, book], |r| r.get::<_, i64>(0)).unwrap_or(0) == 1 }
fn books_done(c: &Connection, uid: i64) -> i64 { count(c, "SELECT count(*) FROM (SELECT r.book FROM chapters_read r WHERE r.user_id=?1 GROUP BY r.book HAVING count(*) >= (SELECT count(*) FROM chapters c WHERE c.book=r.book))", uid) }
fn all_between(c: &Connection, uid: i64, a: i64, b: i64) -> bool { c.query_row("SELECT (SELECT count(*) FROM chapters_read WHERE user_id=?1 AND book BETWEEN ?2 AND ?3) >= (SELECT count(*) FROM chapters WHERE book BETWEEN ?2 AND ?3)", params![uid, a, b], |r| r.get::<_, i64>(0)).unwrap_or(0) == 1 }

static DEFS: Lazy<Vec<Def>> = Lazy::new(|| vec![
    Def { code: "first_page", name: "First page", description: "Read your first full chapter", icon: "📖", test: |c, u, _| credits(c, u) >= 1 },
    Def { code: "streak_3", name: "Three days", description: "A 3-day reading streak", icon: "🔥", test: |c, u, t| streak(c, u, t) >= 3 },
    Def { code: "streak_7", name: "One week", description: "A 7-day reading streak", icon: "🔥", test: |c, u, t| streak(c, u, t) >= 7 },
    Def { code: "streak_30", name: "One month", description: "A 30-day reading streak", icon: "🏆", test: |c, u, t| streak(c, u, t) >= 30 },
    Def { code: "streak_100", name: "Hundred days", description: "A 100-day reading streak", icon: "💎", test: |c, u, t| streak(c, u, t) >= 100 },
    Def { code: "streak_365", name: "A year", description: "A 365-day reading streak", icon: "👑", test: |c, u, t| streak(c, u, t) >= 365 },
    Def { code: "hour_1", name: "First hour", description: "One hour of active reading", icon: "⏱️", test: |c, u, _| seconds(c, u) >= 3600 },
    Def { code: "hour_10", name: "Ten hours", description: "Ten hours of active reading", icon: "⏱️", test: |c, u, _| seconds(c, u) >= 36000 },
    Def { code: "hour_100", name: "Hundred hours", description: "A hundred hours of active reading", icon: "🕰️", test: |c, u, _| seconds(c, u) >= 360000 },
    Def { code: "pages_50", name: "Fifty chapters", description: "Fifty chapters credited", icon: "📚", test: |c, u, _| credits(c, u) >= 50 },
    Def { code: "pages_100", name: "Hundred chapters", description: "100 chapters credited", icon: "💯", test: |c, u, _| credits(c, u) >= 100 },
    Def { code: "pages_500", name: "Five hundred", description: "500 chapters credited", icon: "📚", test: |c, u, _| credits(c, u) >= 500 },
    Def { code: "book_1", name: "Whole book", description: "Read every chapter of one book", icon: "✅", test: |c, u, _| books_done(c, u) >= 1 },
    Def { code: "gospels", name: "The Gospels", description: "Matthew, Mark, Luke and John complete", icon: "✝️", test: |c, u, _| [40, 41, 42, 43].iter().all(|b| book_done(c, u, *b)) },
    Def { code: "pentateuch", name: "Pentateuch", description: "Genesis through Deuteronomy complete", icon: "📜", test: |c, u, _| [1, 2, 3, 4, 5].iter().all(|b| book_done(c, u, *b)) },
    Def { code: "psalms", name: "Psalter", description: "All 150 Psalms", icon: "🎵", test: |c, u, _| book_done(c, u, 19) },
    Def { code: "nt", name: "New Testament", description: "Every New Testament chapter", icon: "🌟", test: |c, u, _| all_between(c, u, 40, 66) },
    Def { code: "ot", name: "Old Testament", description: "Every Old Testament chapter", icon: "🌟", test: |c, u, _| all_between(c, u, 1, 39) },
    Def { code: "bible", name: "Whole Bible", description: "Every chapter, Genesis to Revelation", icon: "🏅", test: |c, u, _| all_between(c, u, 1, 66) },
    Def { code: "outline_1", name: "First outline", description: "Created an outline", icon: "✏️", test: |c, u, _| count(c, "SELECT count(*) FROM outlines WHERE user_id=?1", u) >= 1 },
    Def { code: "outline_shared", name: "Shared", description: "Shared an outline with others", icon: "🔗", test: |c, u, _| count(c, "SELECT count(*) FROM outlines WHERE user_id=?1 AND visibility<>'private'", u) >= 1 },
    Def { code: "early_bird", name: "Early bird", description: "Read before 6 am", icon: "🌅", test: |c, u, _| count(c, "SELECT count(*) FROM page_credits WHERE user_id=?1 AND cast(strftime('%H', credited_at, printf('%+d minutes', tz_offset_min)) AS INTEGER) < 6", u) >= 1 },
    Def { code: "night_owl", name: "Night owl", description: "Read after 11 pm", icon: "🦉", test: |c, u, _| count(c, "SELECT count(*) FROM page_credits WHERE user_id=?1 AND cast(strftime('%H', credited_at, printf('%+d minutes', tz_offset_min)) AS INTEGER) >= 23", u) >= 1 },
    Def { code: "group_joined", name: "Fellowship", description: "Joined a reading group", icon: "🤝", test: |c, u, _| count(c, "SELECT count(*) FROM group_members WHERE user_id=?1", u) >= 1 },
    // a friend streak: consecutive days on which both friends met their goal (friends.rs); both must share their streak
    Def { code: "friend_streak_7", name: "Kept together", description: "A 7-day friend streak", icon: "🤝", test: |c, u, t| crate::friends::best_pair_streak(c, u, t) >= 7 },
    Def { code: "friend_streak_30", name: "A month together", description: "A 30-day friend streak", icon: "💞", test: |c, u, t| crate::friends::best_pair_streak(c, u, t) >= 30 },
    Def { code: "friend_streak_100", name: "Hundred days together", description: "A 100-day friend streak", icon: "♾️", test: |c, u, t| crate::friends::best_pair_streak(c, u, t) >= 100 },
    // a group streak: consecutive days on which every member met their goal (groups.rs); for members who were in the
    // group on all of those days
    Def { code: "group_streak_7", name: "Gathered", description: "A 7-day group streak", icon: "🔥", test: |c, u, t| crate::groups::best_group_streak(c, u, t) >= 7 },
    Def { code: "group_streak_30", name: "Of one mind", description: "A 30-day group streak", icon: "🐝", test: |c, u, t| crate::groups::best_group_streak(c, u, t) >= 30 },
    Def { code: "group_streak_100", name: "Planted together", description: "A 100-day group streak", icon: "🌲", test: |c, u, t| crate::groups::best_group_streak(c, u, t) >= 100 },
    // granted by the admin (PATCH /api/admin/users/{id} { supporter }), never earned by reading
    Def { code: "supporter", name: "Supporter", description: Box::leak(format!("Helped {} along", crate::brand::get().name).into_boxed_str()), icon: "💝", test: |c, u, _| count(c, "SELECT supporter FROM users WHERE id=?1", u) == 1 },
]);

/// Badges that are not listed until they are earned, so nobody sees them locked.
const SECRET: &[&str] = &["supporter"];

/// Badges newly earned, the streak ones judged on the reader's today by their latest offset.
pub fn check_badges(conn: &Connection, uid: i64) -> rusqlite::Result<Vec<Badge>> { check_badges_on(conn, uid, &crate::activity::user_today(conn, uid)) }

/// As `check_badges`, on a day already resolved (a beat's own day).
pub fn check_badges_on(conn: &Connection, uid: i64, today: &str) -> rusqlite::Result<Vec<Badge>> {
    let have: Vec<String> = { let mut st = conn.prepare_cached("SELECT code FROM badges WHERE user_id=?1")?; let rows_ = st.query_map(params![uid], |r| r.get(0))?.collect::<Result<_, _>>()?; rows_ };
    let mut fresh = Vec::new();
    for d in DEFS.iter() {
        if have.iter().any(|h| h == d.code) { continue; }
        if (d.test)(conn, uid, today) {
            conn.execute("INSERT OR IGNORE INTO badges (user_id, code) VALUES (?1, ?2)", params![uid, d.code])?;
            fresh.push(Badge { code: d.code, name: d.name, description: d.description, icon: d.icon, earned_at: None });
        }
    }
    Ok(fresh)
}

/// As `check_badges_on`, for the badges whose code starts with `prefix` only (a friend's friend-streak badges).
pub fn check_badges_prefixed(conn: &Connection, uid: i64, today: &str, prefix: &str) -> rusqlite::Result<Vec<Badge>> {
    let mut fresh = Vec::new();
    for d in DEFS.iter().filter(|d| d.code.starts_with(prefix)) {
        if conn.query_row("SELECT 1 FROM badges WHERE user_id=?1 AND code=?2", params![uid, d.code], |_| Ok(())).optional()?.is_some() { continue; }
        if (d.test)(conn, uid, today) {
            conn.execute("INSERT OR IGNORE INTO badges (user_id, code) VALUES (?1, ?2)", params![uid, d.code])?;
            fresh.push(Badge { code: d.code, name: d.name, description: d.description, icon: d.icon, earned_at: None });
        }
    }
    Ok(fresh)
}

pub fn user_badges(conn: &Connection, uid: i64) -> rusqlite::Result<Vec<Badge>> {
    let earned: Vec<(String, String)> = { let mut st = conn.prepare_cached("SELECT code, earned_at FROM badges WHERE user_id=?1")?; let v: Vec<(String, String)> = st.query_map(params![uid], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?; v };
    Ok(DEFS.iter().filter(|d| !SECRET.contains(&d.code) || earned.iter().any(|e| e.0 == d.code)).map(|d| Badge { code: d.code, name: d.name, description: d.description, icon: d.icon, earned_at: earned.iter().find(|e| e.0 == d.code).map(|e| e.1.clone()) }).collect())
}
