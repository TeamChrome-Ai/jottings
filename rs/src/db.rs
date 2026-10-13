//! SQLite schema + pool. One file, WAL, FTS5 (unicode61 + trigram) for scripture.
use anyhow::Result;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, OptionalExtension};

pub type DbPool = Pool<SqliteConnectionManager>;
pub type Conn = r2d2::PooledConnection<SqliteConnectionManager>;

pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS chapters (
  book INTEGER NOT NULL, chapter INTEGER NOT NULL,
  title TEXT, division INTEGER NOT NULL DEFAULT 0, words INTEGER NOT NULL DEFAULT 0, verse_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book, chapter)
);
CREATE TABLE IF NOT EXISTS verses (
  id INTEGER PRIMARY KEY,
  book INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL,
  text TEXT NOT NULL, html TEXT, para INTEGER NOT NULL DEFAULT 0, strophe INTEGER NOT NULL DEFAULT 0, head TEXT
);
CREATE INDEX IF NOT EXISTS verses_bcv ON verses(book, chapter, verse);
CREATE VIRTUAL TABLE IF NOT EXISTS verses_fts USING fts5(text, content='verses', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE IF NOT EXISTS verses_tri USING fts5(text, content='verses', content_rowid='id', tokenize='trigram');
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  verse_id INTEGER NOT NULL, marker TEXT NOT NULL, word_index INTEGER NOT NULL DEFAULT -1, text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_verse ON notes(verse_id);
-- the 1890 edition's notes (edition.rs, docs/EDITION.md): Darby's own from the 1884 and 1890 printings and the El / Eloah
-- glosses, beside the 1961 edition's in `notes`; the server reads the one the edition served names
CREATE TABLE IF NOT EXISTS notes_1890 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  verse_id INTEGER NOT NULL, marker TEXT NOT NULL, word_index INTEGER NOT NULL DEFAULT -1, text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_1890_verse ON notes_1890(verse_id);
CREATE TABLE IF NOT EXISTS verse_words (
  verse_id INTEGER NOT NULL, word_index INTEGER NOT NULL, word TEXT NOT NULL, strongs TEXT NOT NULL,
  PRIMARY KEY (verse_id, word_index)
);
CREATE INDEX IF NOT EXISTS verse_words_strongs ON verse_words(strongs) WHERE strongs <> '';
CREATE INDEX IF NOT EXISTS verse_words_strongs_verse ON verse_words(strongs, verse_id) WHERE strongs <> '';
-- the numbers behind an English word (bible::word_codes: `word = ? COLLATE NOCASE`), made on open for a database from before it
CREATE INDEX IF NOT EXISTS verse_words_word ON verse_words(word COLLATE NOCASE, strongs) WHERE strongs <> '';
-- Strong's Exhaustive Concordance: the word, transliteration, pronunciation and KJV renderings per number. A database
-- from before 2026-09-26 also has `gloss` (the lexicon definitions, no longer read) and gains pron / kjv below.
CREATE TABLE IF NOT EXISTS strongs (code TEXT PRIMARY KEY, lemma TEXT, translit TEXT, pron TEXT, kjv TEXT);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0, settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_identities (
  provider TEXT NOT NULL, subject TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT, created_at TEXT NOT NULL, PRIMARY KEY (provider, subject)
);
-- three kinds, told by what is null: a verse (book, chapter, verse), a chapter (verse NULL), a book (chapter and verse
-- NULL). One per user and target: `bookmarks_target`, made in open_pool once an older table has been rebuilt
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book INTEGER NOT NULL, chapter INTEGER, verse INTEGER, label TEXT, color TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS bookmarks_user ON bookmarks(user_id, book, chapter);
CREATE TABLE IF NOT EXISTS highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verse_id INTEGER NOT NULL, color TEXT NOT NULL DEFAULT 'yellow',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, verse_id)
);
CREATE TABLE IF NOT EXISTS reading_positions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, book INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (user_id)
);
CREATE TABLE IF NOT EXISTS outlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','link','public')),
  share_code TEXT UNIQUE, print_style TEXT NOT NULL DEFAULT 'verses-first',
  forked_from INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS outlines_user ON outlines(user_id, updated_at);
CREATE TABLE IF NOT EXISTS outline_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, outline_id INTEGER NOT NULL REFERENCES outlines(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('verse','note','link','heading')),
  book INTEGER, chapter INTEGER, v1 INTEGER, v2 INTEGER, text TEXT, url TEXT, depth INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outline_items_outline ON outline_items(outline_id, position);
CREATE INDEX IF NOT EXISTS outline_items_verse ON outline_items(book, chapter) WHERE kind = 'verse';
CREATE TABLE IF NOT EXISTS activity_sessions (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL, last_beat_at TEXT NOT NULL, active_seconds INTEGER NOT NULL DEFAULT 0, device TEXT
);
CREATE TABLE IF NOT EXISTS chapter_dwell (
  session_id TEXT NOT NULL REFERENCES activity_sessions(id) ON DELETE CASCADE,
  book INTEGER NOT NULL, chapter INTEGER NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0, max_progress REAL NOT NULL DEFAULT 0, signal_events INTEGER NOT NULL DEFAULT 0,
  credited INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (session_id, book, chapter)
);
CREATE TABLE IF NOT EXISTS page_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book INTEGER NOT NULL, chapter INTEGER NOT NULL, date TEXT NOT NULL, dwell_seconds INTEGER NOT NULL,
  credited_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, book, chapter, date)
);
CREATE TABLE IF NOT EXISTS activity_days (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0, pages INTEGER NOT NULL DEFAULT 0, chapters INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS chapters_read (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, book INTEGER NOT NULL, chapter INTEGER NOT NULL,
  first_read_at TEXT NOT NULL, times INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (user_id, book, chapter)
);
-- the reader's path (docs/PATHS.md): one active path; the ones left behind ride in history_json with their starts
CREATE TABLE IF NOT EXISTS user_paths (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, path_id TEXT NOT NULL,
  started_at TEXT NOT NULL, target_date TEXT, pace_per_week INTEGER, with_ministry INTEGER NOT NULL DEFAULT 0, custom_json TEXT, history_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS badges (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, code TEXT NOT NULL,
  earned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (user_id, code)
);
-- me_data.rs, restore: the reading history of a deleted account goes to one account only. No foreign keys: the source
-- is gone by rule (user ids are AUTOINCREMENT, never given twice), and the claim outlives its claimant
CREATE TABLE IF NOT EXISTS activity_claims (source_user_id INTEGER PRIMARY KEY, claimed_by INTEGER NOT NULL, claimed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT,
  owner_id INTEGER NOT NULL REFERENCES users(id), invite_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS group_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL, metric TEXT NOT NULL CHECK (metric IN ('active_minutes','pages','chapters','score','streak')),
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  time_weight REAL NOT NULL DEFAULT 1, page_weight REAL NOT NULL DEFAULT 4, goal REAL,
  book_from INTEGER, book_to INTEGER,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- rs/src/groups.rs, Event: the books as a JSON array of book numbers (NULL = book_from/book_to, or every book),
  -- who sees the board, where each member's counting starts, the renewal cadence and when this row was renewed
  description TEXT, books_json TEXT,
  visibility TEXT NOT NULL DEFAULT 'members' CHECK (visibility IN ('members','private_admin')),
  counts_from TEXT NOT NULL DEFAULT 'event_start' CHECK (counts_from IN ('event_start','group_join')),
  repeat TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none','weekly','monthly')),
  late_join INTEGER NOT NULL DEFAULT 1, renewed_at TEXT
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('post','outline','user')), target_id INTEGER NOT NULL,
  reason TEXT NOT NULL, details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','allowed','hidden','escalated','resolved')),
  ai_verdict TEXT, ai_reason TEXT, ai_category TEXT, ai_model TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), resolved_at TEXT, resolved_by INTEGER, resolution TEXT
);
CREATE INDEX IF NOT EXISTS reports_status ON reports(status, created_at);
CREATE TABLE IF NOT EXISTS moderation_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, target_id INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('auto','report')), report_id INTEGER,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done')),
  scan_verdict TEXT, scan_reason TEXT, verdict TEXT, reason TEXT, category TEXT, judged_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), judged_at TEXT
);
CREATE INDEX IF NOT EXISTS moderation_jobs_status ON moderation_jobs(status, created_at);
CREATE TABLE IF NOT EXISTS blocks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (user_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS group_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, outline_id INTEGER REFERENCES outlines(id) ON DELETE SET NULL,
  body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL, email TEXT, app_version TEXT, platform TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS feedback_created ON feedback(created_at);
-- friends (rs/src/friends.rs): mutual, invite-only; see docs/API.md, Friends, for the privacy rules. An invite's
-- to_id is SET NULL, not deleted, when its addressee goes: the sender's own record never changes for it
CREATE TABLE IF NOT EXISTS friendships (
  a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (a, b), CHECK (a < b)
);
CREATE INDEX IF NOT EXISTS friendships_b ON friendships(b);
CREATE TABLE IF NOT EXISTS friend_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT, from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_handle TEXT NOT NULL COLLATE NOCASE, to_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  delivered INTEGER NOT NULL DEFAULT 0, via TEXT NOT NULL DEFAULT 'handle' CHECK (via IN ('handle','qr','contacts')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), declined_at TEXT, cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS friend_invites_from ON friend_invites(from_id, created_at);
CREATE INDEX IF NOT EXISTS friend_invites_to ON friend_invites(to_id, created_at);
CREATE TABLE IF NOT EXISTS friend_tokens (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), expires_at TEXT NOT NULL,
  used_at TEXT, used_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS friend_tokens_user ON friend_tokens(user_id);
CREATE TABLE IF NOT EXISTS friend_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, target TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('heart','smile','clap','seal')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), seen_at TEXT, UNIQUE (from_id, to_id, target)
);
CREATE INDEX IF NOT EXISTS friend_reactions_to ON friend_reactions(to_id, created_at);
CREATE TABLE IF NOT EXISTS contact_hashes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, hash TEXT NOT NULL, PRIMARY KEY (user_id, hash)
);
CREATE INDEX IF NOT EXISTS contact_hashes_hash ON contact_hashes(hash);
CREATE TABLE IF NOT EXISTS friend_events (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS friend_events_user ON friend_events(user_id, kind, at);
-- rs/src/bans.rs: where each account has been seen, and what a ban marked (SHA-256 of "kind:value", never the value)
CREATE TABLE IF NOT EXISTS user_marks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, hash TEXT NOT NULL,
  first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, kind, hash)
);
CREATE INDEX IF NOT EXISTS user_marks_hash ON user_marks(kind, hash);
CREATE TABLE IF NOT EXISTS ban_marks (
  kind TEXT NOT NULL, hash TEXT NOT NULL, user_id INTEGER NOT NULL, expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (kind, hash, user_id)
);
CREATE INDEX IF NOT EXISTS ban_marks_hash ON ban_marks(kind, hash);
CREATE TABLE IF NOT EXISTS store_clicks (day TEXT NOT NULL, src TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, src));
-- the same clicks by UTC hour (`2026-10-12T14`), for the admin's live numbers (live.rs)
CREATE TABLE IF NOT EXISTS store_click_hours (hour TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);
-- rs/src/link_preview.rs: what a linked page says of itself (text only), by the address as asked; a NULL title is a
-- fetch that failed, kept a day so a dead link is not asked again and again
CREATE TABLE IF NOT EXISTS link_previews (url TEXT PRIMARY KEY, host TEXT NOT NULL, title TEXT, description TEXT, fetched_at TEXT NOT NULL);
-- a jotting's links by address: whether a preview may be asked for without signing in
CREATE INDEX IF NOT EXISTS outline_items_link ON outline_items(url) WHERE kind = 'link';
"#;

/// The 1890 edition's own text, written by the data build only when data/darby_1890.json exists (edition::tables reads
/// it then): the same tables as the shared text, suffixed.
pub const SCHEMA_TEXT_1890: &str = r#"
CREATE TABLE chapters_1890 (
  book INTEGER NOT NULL, chapter INTEGER NOT NULL,
  title TEXT, division INTEGER NOT NULL DEFAULT 0, words INTEGER NOT NULL DEFAULT 0, verse_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book, chapter)
);
CREATE TABLE verses_1890 (
  id INTEGER PRIMARY KEY,
  book INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL,
  text TEXT NOT NULL, html TEXT, para INTEGER NOT NULL DEFAULT 0, strophe INTEGER NOT NULL DEFAULT 0, head TEXT
);
CREATE INDEX verses_1890_bcv ON verses_1890(book, chapter, verse);
CREATE VIRTUAL TABLE verses_1890_fts USING fts5(text, content='verses_1890', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE verses_1890_tri USING fts5(text, content='verses_1890', content_rowid='id', tokenize='trigram');
CREATE TABLE verse_words_1890 (
  verse_id INTEGER NOT NULL, word_index INTEGER NOT NULL, word TEXT NOT NULL, strongs TEXT NOT NULL,
  PRIMARY KEY (verse_id, word_index)
);
CREATE INDEX verse_words_1890_strongs_verse ON verse_words_1890(strongs, verse_id) WHERE strongs <> '';
CREATE INDEX verse_words_1890_word ON verse_words_1890(word COLLATE NOCASE, strongs) WHERE strongs <> '';
"#;
/// Rebuilds the full-text indexes of the shared text, and of the 1890 text when there is one.
pub const FTS_REBUILD: &str = "INSERT INTO verses_fts(verses_fts) VALUES('rebuild'); INSERT INTO verses_tri(verses_tri) VALUES('rebuild'); INSERT INTO verses_fts(verses_fts) VALUES('optimize'); INSERT INTO verses_tri(verses_tri) VALUES('optimize');";
pub const FTS_REBUILD_1890: &str = "INSERT INTO verses_1890_fts(verses_1890_fts) VALUES('rebuild'); INSERT INTO verses_1890_tri(verses_1890_tri) VALUES('rebuild'); INSERT INTO verses_1890_fts(verses_1890_fts) VALUES('optimize'); INSERT INTO verses_1890_tri(verses_1890_tri) VALUES('optimize');";
/// main. explicitly: an unqualified DROP of a table main lacks finds the attached seed's and drops that.
const TEXT_1890_DROP: &str = "DROP TABLE IF EXISTS main.verses_1890_fts; DROP TABLE IF EXISTS main.verses_1890_tri; DROP TABLE IF EXISTS main.verses_1890; DROP TABLE IF EXISTS main.chapters_1890; DROP TABLE IF EXISTS main.verse_words_1890;";

pub fn configure(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;
         PRAGMA temp_store = MEMORY; PRAGMA cache_size = -32000; PRAGMA mmap_size = 268435456;",
    )
}

/// SQLCipher key pragma. Must be the first statement on a connection. A 64-hex-char key is used raw
/// (`x'…'`, no KDF); anything else is a passphrase run through SQLCipher's PBKDF2.
fn key_pragma(key: &str) -> String {
    if key.len() == 64 && key.chars().all(|c| c.is_ascii_hexdigit()) { format!("PRAGMA key = \"x'{key}'\";") } else { format!("PRAGMA key = '{}';", key.replace('\'', "''")) }
}

fn is_plaintext_sqlite(path: &str) -> bool {
    std::fs::File::open(path).ok().and_then(|mut f| { let mut h = [0u8; 16]; std::io::Read::read_exact(&mut f, &mut h).ok().map(|_| h.starts_with(b"SQLite format 3")) }).unwrap_or(false)
}

/// Copy `src` (plaintext or encrypted with `src_key`) into a new SQLCipher database at `dst` under `key`.
/// Used to seed the user DB from the plaintext scripture seed and to migrate a pre-encryption database.
pub fn export_encrypted(src: &str, src_key: Option<&str>, dst: &str, key: &str) -> Result<()> {
    if std::path::Path::new(dst).exists() { std::fs::remove_file(dst)?; }
    let conn = Connection::open(src)?;
    if let Some(k) = src_key { conn.execute_batch(&key_pragma(k))?; }
    conn.execute_batch(&format!("ATTACH DATABASE '{}' AS enc KEY \"{}\";", dst.replace('\'', "''"), key_attach(key)))?;
    conn.query_row("SELECT sqlcipher_export('enc')", [], |_| Ok(()))?;
    conn.execute_batch("DETACH DATABASE enc;")?;
    Ok(())
}
fn key_attach(key: &str) -> String {
    if key.len() == 64 && key.chars().all(|c| c.is_ascii_hexdigit()) { format!("x'{key}'") } else { key.replace('"', "") }
}

/// Bring `path` to the encrypted state when a key is configured: a plaintext file (pre-encryption deploy)
/// is exported to `<path>.enc` and swapped in; the plaintext copy is kept as `<path>.plaintext.bak`
/// for the operator to delete once the encrypted one is verified.
pub fn ensure_encrypted(path: &str, key: &str) -> Result<()> {
    if !std::path::Path::new(path).exists() || !is_plaintext_sqlite(path) { return Ok(()); }
    let enc = format!("{path}.enc");
    tracing::warn!("{path} is plaintext and BEREAN_DB_KEY is set: encrypting it in place");
    // fold the WAL in first so the export sees every committed row
    { let c = Connection::open(path)?; c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?; }
    export_encrypted(path, None, &enc, key)?;
    std::fs::rename(path, format!("{path}.plaintext.bak"))?;
    for suf in ["-wal", "-shm"] { let _ = std::fs::remove_file(format!("{path}{suf}")); }
    std::fs::rename(&enc, path)?;
    tracing::info!("encrypted {path}; plaintext kept at {path}.plaintext.bak — delete it once verified");
    Ok(())
}

pub fn open_pool(path: &str, key: Option<String>) -> Result<DbPool> {
    let manager = SqliteConnectionManager::file(path).with_init(move |c| {
        if let Some(k) = &key { c.execute_batch(&key_pragma(k))?; }
        // the default of 16 is fewer than the distinct statements one connection serves (chapter, search per scope, auth ...)
        c.set_prepared_statement_cache_capacity(64);
        configure(c)
    });
    let pool = Pool::builder().max_size(8).build(manager)?;
    let conn = pool.get()?;
    conn.execute_batch(SCHEMA)?;
    // columns added after the first release; ALTER is not idempotent, so probe first
    for (table, col, ddl) in [("group_posts", "hidden", "INTEGER NOT NULL DEFAULT 0"), ("outlines", "hidden", "INTEGER NOT NULL DEFAULT 0"), ("users", "disabled", "INTEGER NOT NULL DEFAULT 0"), ("users", "supporter", "INTEGER NOT NULL DEFAULT 0"),
        // the reader's latest UTC offset (minutes east), NULL until a client reports one; page credits keep the offset
        // they were earned at so the hour badges read local time (0 = UTC for credits from before it was recorded)
        ("users", "tz_offset_min", "INTEGER"), ("page_credits", "tz_offset_min", "INTEGER NOT NULL DEFAULT 0"),
        // the reader reached the chapter's end at least once in the session: half of what a credit needs
        ("chapter_dwell", "reached_end", "INTEGER NOT NULL DEFAULT 0"),
        // an outline's publication (visibility 'public'): when, for the public list's order; NULL otherwise
        ("outlines", "published_at", "TEXT"),
        // a preset avatar id (shared/avatars.ts, avatars::IDS); NULL shows the default for the user id
        ("users", "avatar", "TEXT"),
        // whose content a report is about, so repeat strikes under one rule are counted per author (moderation::settle)
        ("reports", "author_id", "INTEGER"),
        // an account an admin unbanned is not caught again by the ban-evasion check (bans.rs)
        ("users", "ban_exempt", "INTEGER NOT NULL DEFAULT 0"),
        // a reading group's shared streak is on unless its owner turns it off
        ("groups", "streak_enabled", "INTEGER NOT NULL DEFAULT 1"),
        // Strong's own pronunciation and KJV renderings; `reseed-scripture` fills them
        ("strongs", "pron", "TEXT"), ("strongs", "kjv", "TEXT"),
        // when the chapter was last credited (first_read_at only counts the first time): a path counts a chapter read
        // at or after its start. Backfilled from first_read_at below
        ("chapters_read", "last_read_at", "TEXT"),
        // the path a group walks together (paths::BUILT_IN) and when it set out; members' places come from their own chapters_read
        ("groups", "path_id", "TEXT"), ("groups", "path_started_at", "TEXT"), ("groups", "path_target_date", "TEXT"),
        // event options added for versionCode 32 (groups.rs, Event); an older row keeps its book_from/book_to and the
        // defaults, which are exactly what it did before
        ("group_events", "description", "TEXT"), ("group_events", "books_json", "TEXT"),
        ("group_events", "visibility", "TEXT NOT NULL DEFAULT 'members'"), ("group_events", "counts_from", "TEXT NOT NULL DEFAULT 'event_start'"),
        ("group_events", "repeat", "TEXT NOT NULL DEFAULT 'none'"), ("group_events", "late_join", "INTEGER NOT NULL DEFAULT 1"), ("group_events", "renewed_at", "TEXT"),
        // a site admin's notice in a group feed (groups.rs post_create): free text, the one kind of post that is not a jotting
        ("group_posts", "notice", "INTEGER NOT NULL DEFAULT 0"),
        // the admin's answer to a piece of feedback (feedback.rs), read by its sender in the app; seen_at once they have
        ("feedback", "reply", "TEXT"), ("feedback", "replied_at", "TEXT"), ("feedback", "reply_seen_at", "TEXT"),
        // the admin took this account's name away (feedback.rs admin_rename): the app asks for a new name and handle
        ("users", "must_rename", "INTEGER NOT NULL DEFAULT 0")] {
        let has: i64 = conn.query_row(&format!("SELECT count(*) FROM pragma_table_info('{table}') WHERE name='{col}'"), [], |r| r.get(0))?;
        if has == 0 { conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {col} {ddl}"))?; }
    }
    conn.execute("UPDATE chapters_read SET last_read_at=first_read_at WHERE last_read_at IS NULL", [])?;
    // a table from before book bookmarks has chapter NOT NULL, which SQLite cannot drop in place: rebuild it once from
    // SCHEMA, keeping every row (the oldest of any duplicate, which the unique index below would refuse)
    let chapter_required: i64 = conn.query_row("SELECT \"notnull\" FROM pragma_table_info('bookmarks') WHERE name='chapter'", [], |r| r.get(0))?;
    if chapter_required == 1 {
        conn.execute_batch(&format!("BEGIN IMMEDIATE; ALTER TABLE bookmarks RENAME TO bookmarks_old; DROP INDEX bookmarks_user; {SCHEMA}
            INSERT INTO bookmarks (id, user_id, book, chapter, verse, label, color, created_at)
              SELECT id, user_id, book, chapter, verse, label, color, created_at FROM bookmarks_old
              WHERE id IN (SELECT min(id) FROM bookmarks_old GROUP BY user_id, book, chapter, verse);
            DROP TABLE bookmarks_old; COMMIT;"))?;
    }
    conn.execute_batch("CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_target ON bookmarks(user_id, book, ifnull(chapter, 0), ifnull(verse, 0))")?;
    conn.execute("INSERT OR IGNORE INTO users (id, handle, display_name, password_hash, is_admin, disabled) VALUES (0, 'system', 'Automatic scan', 'system:no-login', 0, 1)", [])?;
    // the first public directory was removed and every outline then public became link-only; that ran on every boot,
    // which would now unpublish what readers publish (outlines.rs, publish), so it runs once and is remembered
    if conn.query_row("SELECT 1 FROM meta WHERE key='outlines_public_reset'", [], |_| Ok(())).optional()?.is_none() {
        conn.execute("UPDATE outlines SET visibility='link' WHERE visibility='public' AND published_at IS NULL", [])?;
        conn.execute("INSERT INTO meta (key, value) VALUES ('outlines_public_reset', '1')", [])?;
    }
    Ok(pool)
}

#[inline]
pub fn verse_id(book: i64, chapter: i64, verse: i64) -> i64 { book * 1_000_000 + chapter * 1000 + verse }

pub fn now_iso() -> String {
    let now = time::OffsetDateTime::now_utc();
    now.format(&time::format_description::well_known::Rfc3339).unwrap_or_default()
}

/// Replace the scripture tables of an open (possibly encrypted) user database with the contents of the plaintext
/// seed at `seed`: chapters, verses, notes (both editions'), verse_words, strongs, and both full-text indexes; the 1890
/// edition's own text tables are replaced by the seed's, or dropped when the seed has none. Everything else stays.
pub fn reseed_scripture(conn: &Connection, seed: &str) -> Result<i64> {
    conn.execute_batch(&format!("ATTACH DATABASE '{}' AS seed KEY '';", seed.replace('\'', "''")))?;
    let r = (|| -> Result<i64> {
        conn.execute_batch("BEGIN;")?;
        let in_seed = |t: &str| conn.query_row("SELECT count(*) FROM seed.sqlite_master WHERE type='table' AND name=?1", [t], |r| r.get::<_, i64>(0)).map(|n| n > 0);
        let text_1890 = in_seed("verses_1890")?;
        conn.execute_batch(TEXT_1890_DROP)?;
        if text_1890 { conn.execute_batch(SCHEMA_TEXT_1890)?; }
        for t in ["notes", "notes_1890", "verse_words", "verses", "chapters", "strongs", "verses_1890", "chapters_1890", "verse_words_1890"] {
            if !in_seed(t)? { if t == "notes_1890" { conn.execute_batch("DELETE FROM notes_1890;")?; } continue }
            // by the seed's column names: a table here can hold a column the seed has dropped (strongs.gloss)
            let cols: String = conn.query_row(&format!("SELECT group_concat(name, ', ') FROM pragma_table_info('{t}', 'seed')"), [], |r| r.get(0))?;
            conn.execute_batch(&format!("DELETE FROM {t}; INSERT INTO {t} ({cols}) SELECT {cols} FROM seed.{t};"))?;
        }
        conn.execute_batch(FTS_REBUILD)?;
        if text_1890 { conn.execute_batch(FTS_REBUILD_1890)?; }
        conn.execute_batch("COMMIT;")?;
        Ok(conn.query_row("SELECT count(*) FROM verses", [], |r| r.get(0))?)
    })();
    if r.is_err() { let _ = conn.execute_batch("ROLLBACK;"); }
    let _ = conn.execute_batch("DETACH DATABASE seed;");
    r
}


#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reseed_fills_strongs_from_a_seed_without_gloss() {
        let dir = std::env::temp_dir();
        // db.rs is also compiled into berean-build-data, which has no crate::auth for a random name
        let tag = format!("{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
        let (live, seed) = (dir.join(format!("berean-test-live-{tag}.db")), dir.join(format!("berean-test-seed-{tag}.db")));
        // a server database from before the concordance: strongs holds the lexicon's gloss
        Connection::open(&live).unwrap().execute_batch("CREATE TABLE strongs (code TEXT PRIMARY KEY, lemma TEXT, translit TEXT, gloss TEXT); INSERT INTO strongs VALUES ('G1320', 'διδάσκαλος', 'didáskalos', 'an instructor');").unwrap();
        let s = Connection::open(&seed).unwrap();
        s.execute_batch(SCHEMA).unwrap();
        s.execute("INSERT INTO strongs (code, lemma, translit, pron, kjv) VALUES ('G1320', 'διδάσκαλος', 'didáskalos', 'did-as''-kal-os', 'doctor, master, teacher')", []).unwrap();
        drop(s);
        let pool = open_pool(live.to_str().unwrap(), None).unwrap();
        let c = pool.get().unwrap();
        reseed_scripture(&c, seed.to_str().unwrap()).unwrap();
        let row: (Option<String>, Option<String>, Option<String>) = c.query_row("SELECT pron, kjv, gloss FROM strongs WHERE code='G1320'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!(row, (Some("did-as'-kal-os".into()), Some("doctor, master, teacher".into()), None));
        drop(c); drop(pool);
        for p in [live, seed] { let _ = std::fs::remove_file(p); }
    }

    #[test]
    fn reseed_carries_the_1890_notes_and_its_text_only_when_the_seed_has_it() {
        let dir = std::env::temp_dir();
        let tag = format!("{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
        let (live, seed) = (dir.join(format!("berean-test-live1890-{tag}.db")), dir.join(format!("berean-test-seed1890-{tag}.db")));
        let s = Connection::open(&seed).unwrap();
        s.execute_batch(SCHEMA).unwrap();
        s.execute_batch(SCHEMA_TEXT_1890).unwrap();
        s.execute_batch("INSERT INTO verses (id, book, chapter, verse, text) VALUES (43003016, 43, 3, 16, 'For God so loved the world');
            INSERT INTO verses_1890 (id, book, chapter, verse, text) VALUES (43003016, 43, 3, 16, 'For God so loved the world, that he gave');
            INSERT INTO notes (verse_id, marker, word_index, text) VALUES (43003016, 'a', 4, 'a 1961 note');
            INSERT INTO notes_1890 (verse_id, marker, word_index, text) VALUES (43003016, 'a', 4, 'an 1890 note');").unwrap();
        drop(s);
        let pool = open_pool(live.to_str().unwrap(), None).unwrap();
        let c = pool.get().unwrap();
        reseed_scripture(&c, seed.to_str().unwrap()).unwrap();
        let note: String = c.query_row("SELECT text FROM notes_1890", [], |r| r.get(0)).unwrap();
        assert_eq!(note, "an 1890 note");
        let hit: i64 = c.query_row("SELECT rowid FROM verses_1890_fts WHERE verses_1890_fts MATCH 'gave'", [], |r| r.get(0)).unwrap();
        assert_eq!(hit, 43003016);
        // a later seed without the 1890 text: its tables go, the notes stay the seed's
        let s = Connection::open(&seed).unwrap();
        s.execute_batch("DROP TABLE verses_1890_fts; DROP TABLE verses_1890_tri; DROP TABLE verses_1890; DROP TABLE chapters_1890; DROP TABLE verse_words_1890;").unwrap();
        drop(s);
        reseed_scripture(&c, seed.to_str().unwrap()).unwrap();
        let tables: i64 = c.query_row("SELECT count(*) FROM sqlite_master WHERE name LIKE 'verses_1890%'", [], |r| r.get(0)).unwrap();
        assert_eq!(tables, 0);
        assert_eq!(c.query_row("SELECT count(*) FROM notes_1890", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        drop(c); drop(pool);
        for p in [live, seed] { for suf in ["", "-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{suf}", p.display())); } }
    }

    #[test]
    fn bookmarks_from_before_book_bookmarks_keep_their_rows() {
        let tag = format!("{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
        let path = std::env::temp_dir().join(format!("berean-test-bm-{tag}.db"));
        // the table as it was: chapter NOT NULL, and a duplicate the old check-then-insert could let through
        Connection::open(&path).unwrap().execute_batch("
            CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, handle TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
              is_admin INTEGER NOT NULL DEFAULT 0, settings TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
            INSERT INTO users (id, handle, display_name, password_hash) VALUES (7, 'anna', 'Anna', 'x');
            CREATE TABLE bookmarks (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              book INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER, label TEXT, color TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
            CREATE INDEX bookmarks_user ON bookmarks(user_id, book, chapter);
            INSERT INTO bookmarks (id, user_id, book, chapter, verse, label, created_at) VALUES
              (3, 7, 43, 3, 16, 'love', '2026-01-01T00:00:00Z'), (5, 7, 19, 23, NULL, NULL, '2026-01-02T00:00:00Z'), (9, 7, 43, 3, 16, NULL, '2026-01-03T00:00:00Z');").unwrap();
        for _ in 0..2 {
            // twice: the second boot finds the new table and leaves it alone
            let pool = open_pool(path.to_str().unwrap(), None).unwrap();
            let c = pool.get().unwrap();
            let rows: Vec<(i64, i64, Option<i64>, Option<i64>, Option<String>)> = c.prepare("SELECT id, book, chapter, verse, label FROM bookmarks ORDER BY id").unwrap()
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).unwrap().collect::<Result<_, _>>().unwrap();
            assert_eq!(rows, [(3, 43, Some(3), Some(16), Some("love".into())), (5, 19, Some(23), None, None)]);
            let nullable: i64 = c.query_row("SELECT \"notnull\" FROM pragma_table_info('bookmarks') WHERE name='chapter'", [], |r| r.get(0)).unwrap();
            assert_eq!(nullable, 0);
            c.execute("INSERT INTO bookmarks (user_id, book) VALUES (7, 19) ON CONFLICT DO NOTHING", []).unwrap();
            assert_eq!(c.execute("INSERT INTO bookmarks (user_id, book) VALUES (7, 19) ON CONFLICT DO NOTHING", []).unwrap(), 0, "one book bookmark");
            assert_eq!(c.execute("INSERT INTO bookmarks (user_id, book, chapter) VALUES (7, 19, 23) ON CONFLICT DO NOTHING", []).unwrap(), 0, "one chapter bookmark");
            c.execute("DELETE FROM bookmarks WHERE chapter IS NULL", []).unwrap();
            let indexes: i64 = c.query_row("SELECT count(*) FROM sqlite_master WHERE type='index' AND name IN ('bookmarks_user', 'bookmarks_target')", [], |r| r.get(0)).unwrap();
            assert_eq!(indexes, 2);
        }
        for suf in ["", "-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{suf}", path.display())); }
    }
}
