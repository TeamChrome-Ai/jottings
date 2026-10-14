//! How a chapter comes to count as read (docs/READING.md): every part of it went past the reader, on screen long enough
//! to be taken in or read out by the voice, and the time spent on it is what its length asks. The device holds the same
//! rule in shared/readThrough.ts to say how far off a credit is; both are tested against shared/readThrough.cases.json.
//! Kept per reader per chapter for `KEEP` after it was last read, so two sittings add up; cleared by the credit.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

pub const MS_PER_WORD: i64 = 240; // 250 words a minute
pub const MIN_MS: i64 = 10_000;
pub const MAX_MS: i64 = 600_000;
pub const GLANCE_MS_PER_WORD: i64 = 80; // 750 words a minute
pub const GLANCE_BANK_WORDS: i64 = 250;
const HEARD_NUM: i64 = 19; // a recording at 1.5×, less 5%
const HEARD_DEN: i64 = 30;
const SLACK_DIV: i64 = 20;
pub const BEAT_CAP_MS: i64 = 20_000;
pub const LISTEN_CAP_MS: i64 = 300_000;
pub const MAX_RANGES: usize = 32;
pub const LISTEN_BANK_MS: i64 = 20_000;
/// Hours a part-read chapter is kept after it was last read.
pub const KEEP_HOURS: i64 = 48;

/// A chapter's verses in reading order: numbers, words, and the fastest recording of each (ms; None where none times it).
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Shape { pub verses: Vec<i64>, pub words: Vec<i64>, #[serde(default)] pub audio_ms: Option<Vec<Option<i64>>>, #[serde(default)] pub ms_per_word: Option<i64> }

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadThrough { pub seen: Vec<i64>, pub heard: Vec<i64>, pub bank: i64, pub active_ms: i64, #[serde(default)] pub listen_bank: i64 }

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Judgement { pub covered: bool, pub gaps: Vec<[i64; 2]>, pub required_ms: i64, pub owing_ms: i64, pub read: bool }

pub type Ranges = Vec<[i64; 2]>;

impl Shape {
    fn audio(&self, i: usize) -> Option<i64> { self.audio_ms.as_ref().and_then(|a| a.get(i).copied().flatten()).filter(|a| *a > 0) }
    /// What hearing verse `i` asks of the time.
    pub fn heard_ms(&self, i: usize) -> i64 { self.audio(i).map(|a| a * HEARD_NUM / HEARD_DEN).unwrap_or(self.words[i] * MS_PER_WORD) }
    /// How long the voice takes over verse `i` at the fastest speed.
    fn listen_ms(&self, i: usize) -> i64 { self.audio(i).map(|a| a * 2 / 3).unwrap_or(self.words[i] * MS_PER_WORD) }
    /// Indices of the verses in `ranges`, ascending, once each.
    pub fn indices_in(&self, ranges: Option<&Ranges>) -> Vec<usize> {
        let Some(rs) = ranges else { return vec![] };
        let rs = &rs[..rs.len().min(MAX_RANGES)];
        self.verses.iter().enumerate().filter(|(_, v)| rs.iter().any(|[a, b]| **v >= *a && **v <= *b)).map(|(i, _)| i).collect()
    }
}

pub fn fresh(shape: &Shape) -> ReadThrough { ReadThrough { seen: vec![0; shape.words.len()], heard: vec![0; shape.words.len()], bank: 0, active_ms: 0, listen_bank: 0 } }

/// A stored state for this shape, or a fresh one when it no longer fits.
pub fn fit(t: Option<ReadThrough>, shape: &Shape) -> ReadThrough {
    let n = shape.words.len();
    match t {
        Some(t) if t.seen.len() == n && t.heard.len() == n => ReadThrough {
            seen: t.seen.iter().enumerate().map(|(i, s)| (*s).clamp(0, shape.words[i])).collect(),
            heard: t.heard.iter().map(|h| (*h != 0) as i64).collect(),
            bank: t.bank.clamp(0, GLANCE_BANK_WORDS), active_ms: t.active_ms.max(0), listen_bank: t.listen_bank.clamp(0, LISTEN_BANK_MS),
        },
        _ => fresh(shape),
    }
}

/// What the verses a beat says the voice finished take at the fastest speed, heard before or not: how much of a late
/// beat's gap listening can account for (`earned_ms`).
pub fn heard_cost_ms(shape: &Shape, heard: Option<&Ranges>) -> i64 {
    shape.indices_in(heard).into_iter().map(|i| shape.listen_ms(i)).sum()
}

/// The time a beat brings, from the gap since the previous one.
pub fn earned_ms(elapsed_ms: i64, active: bool, visible: bool, listening: bool, heard_cost_ms: i64) -> i64 {
    if elapsed_ms <= 0 { return 0 }
    let screen = if active && visible { elapsed_ms.min(BEAT_CAP_MS) } else { 0 };
    let voice = if listening { elapsed_ms.min(BEAT_CAP_MS.max(LISTEN_CAP_MS.min(heard_cost_ms * 2 + 5_000))) } else { 0 };
    screen.max(voice)
}

pub fn apply(t: &ReadThrough, shape: &Shape, ms: i64, seen: Option<&Ranges>, heard: Option<&Ranges>) -> ReadThrough {
    let ms = ms.max(0);
    let mut s = ReadThrough { seen: t.seen.clone(), heard: t.heard.clone(), bank: t.bank, active_ms: t.active_ms + ms, listen_bank: 0 };
    let mut allow = ms + t.listen_bank;
    for i in shape.indices_in(heard) {
        if s.heard[i] != 0 { continue }
        let cost = shape.listen_ms(i);
        if cost > allow { break }
        allow -= cost;
        s.heard[i] = 1;
        s.seen[i] = shape.words[i];
    }
    s.listen_bank = allow.min(LISTEN_BANK_MS);
    let mut budget = ms / GLANCE_MS_PER_WORD + s.bank;
    for i in shape.indices_in(seen) {
        if budget <= 0 { break }
        let take = (shape.words[i] - s.seen[i]).min(budget);
        if take <= 0 { continue }
        s.seen[i] += take;
        budget -= take;
    }
    s.bank = budget.min(GLANCE_BANK_WORDS);
    s
}

pub fn judge(t: &ReadThrough, shape: &Shape) -> Judgement {
    let n = shape.words.len();
    let total: i64 = shape.words.iter().sum();
    let (mut uncovered, mut need) = (0i64, 0i64);
    let mut gaps: Vec<[i64; 2]> = vec![];
    for i in 0..n {
        if t.heard[i] == 0 && t.seen[i] < shape.words[i] {
            uncovered += shape.words[i] - t.seen[i];
            match gaps.last_mut() { Some(g) if i > 0 && g[1] == shape.verses[i - 1] => g[1] = shape.verses[i], _ => gaps.push([shape.verses[i], shape.verses[i]]) }
        }
        need += if t.heard[i] != 0 { shape.heard_ms(i) } else { shape.words[i] * shape.ms_per_word.unwrap_or(MS_PER_WORD) };
    }
    let last_in = n == 0 || t.heard[n - 1] != 0 || t.seen[n - 1] >= shape.words[n - 1];
    let covered = last_in && uncovered <= total / SLACK_DIV;
    let required_ms = need.clamp(MIN_MS, MAX_MS);
    let owing_ms = (required_ms - t.active_ms).max(0);
    Judgement { covered, gaps: if covered { vec![] } else { gaps }, required_ms, owing_ms, read: covered && owing_ms == 0 }
}

// ---------------------------------------------------------------- the chapter's shape, from the text and the recordings

/// Words as the scripture build counts them: runs of letters, digits and apostrophes (shared/reading.ts `wordCount`).
pub fn word_count(s: &str) -> i64 { let mut n = 0; let mut in_w = false; for c in s.chars() { let w = c.is_alphanumeric() || c == '\'' || c == '’'; if w && !in_w { n += 1; } in_w = w; } n }

/// The fastest of the recorded voices over each verse: what a reader listening at the top speed in any voice can take.
fn audio_ms(book: i64, chapter: i64, verses: &[i64]) -> Option<Vec<Option<i64>>> {
    let mut best: HashMap<i64, i64> = HashMap::new();
    for (voice, _, _) in crate::tts::VOICES {
        let (_, json) = crate::tts::chapter_paths(voice, book, chapter);
        let Ok(raw) = std::fs::read(&json) else { continue };
        let Ok(m) = serde_json::from_slice::<crate::tts::ChapterMarks>(&raw) else { continue };
        for vm in m.verses { let d = vm.end - vm.start; if d > 0 { best.entry(vm.v).and_modify(|b| *b = (*b).min(d)).or_insert(d); } }
    }
    if best.is_empty() { return None }
    Some(verses.iter().map(|v| best.get(v).copied()).collect())
}

fn load_shape(conn: &Connection, book: i64, chapter: i64) -> rusqlite::Result<Shape> {
    let mut st = conn.prepare_cached("SELECT verse, text FROM verses WHERE book=?1 AND chapter=?2 ORDER BY verse")?;
    let rows: Vec<(i64, String)> = st.query_map(params![book, chapter], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    let verses: Vec<i64> = rows.iter().map(|r| r.0).collect();
    let words = rows.iter().map(|r| word_count(&r.1)).collect();
    let audio_ms = audio_ms(book, chapter, &verses);
    Ok(Shape { verses, words, audio_ms, ms_per_word: None })
}

/// Text and recordings change only with a new data build and a restart, so a shape is read once per chapter. The tests
/// each bring their own database, so they read it every time.
pub fn shape(conn: &Connection, book: i64, chapter: i64) -> rusqlite::Result<Arc<Shape>> {
    if cfg!(test) { return load_shape(conn, book, chapter).map(Arc::new) }
    static CACHE: OnceLock<Mutex<HashMap<(i64, i64), Arc<Shape>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(s) = cache.lock().ok().and_then(|c| c.get(&(book, chapter)).cloned()) { return Ok(s) }
    let s = Arc::new(load_shape(conn, book, chapter)?);
    if !s.words.is_empty() { if let Ok(mut c) = cache.lock() { c.insert((book, chapter), s.clone()); } }
    Ok(s)
}

// ---------------------------------------------------------------- stored per reader

/// Where the chapter stands for the reader, as a beat answers it (the device mirrors the rule from here).
#[derive(Serialize, Clone, Debug)]
pub struct Standing {
    pub book: i64, pub chapter: i64,
    /// The state and the judgement in the shared rule's own form (camelCase, as shared/readThrough.ts has them).
    pub through: ReadThrough,
    pub judgement: Judgement,
    /// Credited today already: nothing more is counted toward it until tomorrow.
    pub credited_today: bool,
    /// The fastest recording of each verse (ms), while any verse has been heard: the device times its estimate by it.
    #[serde(skip_serializing_if = "Option::is_none")] pub audio_ms: Option<Vec<Option<i64>>>,
    /// The reader's own pace (ms a word read) once learned (`pace_ms_per_word`).
    #[serde(skip_serializing_if = "Option::is_none")] pub ms_per_word: Option<i64>,
}

pub struct Stored { pub through: Option<ReadThrough>, pub credited_date: Option<String>, pub updated_at: String }

pub fn load(conn: &Connection, user_id: i64, book: i64, chapter: i64) -> rusqlite::Result<Option<Stored>> {
    conn.query_row("SELECT state, credited_date, updated_at FROM read_throughs WHERE user_id=?1 AND book=?2 AND chapter=?3", params![user_id, book, chapter], |r| {
        let state: String = r.get(0)?;
        Ok(Stored { through: serde_json::from_str(&state).ok(), credited_date: r.get(1)?, updated_at: r.get(2)? })
    }).optional()
}

pub fn save(conn: &Connection, user_id: i64, book: i64, chapter: i64, t: &ReadThrough, credited_date: Option<&str>, now: &str) -> rusqlite::Result<()> {
    conn.prepare_cached("INSERT INTO read_throughs (user_id, book, chapter, state, credited_date, updated_at) VALUES (?1,?2,?3,?4,?5,?6)
        ON CONFLICT(user_id, book, chapter) DO UPDATE SET state=excluded.state, credited_date=excluded.credited_date, updated_at=excluded.updated_at")?
        .execute(params![user_id, book, chapter, serde_json::to_string(t).unwrap_or_default(), credited_date, now])?;
    Ok(())
}

// ---------------------------------------------------------------- the reader's own pace

/// A reader's pace is learned from chapters they read themselves: none of it heard, at least this many words, and touched
/// or scrolled all the way (`PACE_TOUCH_MS`: a burst of touches at least this often, on average, until the last of it was
/// taken in). The touch and scroll sensor is what says a person was reading (the owner, 2026-10-14).
pub const PACE_MIN_WORDS: i64 = 200;
pub const PACE_TOUCH_MS: i64 = 20_000;
/// The median of the last `PACE_KEEP` such chapters, once there are `PACE_NEEDS`, held to 250..=400 words a minute: never
/// asking more than the unhurried pace, never less than a quick reader's.
pub const PACE_KEEP: usize = 9;
pub const PACE_NEEDS: usize = 5;
pub const PACE_MIN_WPM: i64 = 250;
pub const PACE_MAX_WPM: i64 = 400;

/// A chapter's reading pace from how long it took to take all of it in, or None when it says nothing about the reader.
pub fn pace_sample(words: i64, covered_ms: i64, signals: i64, heard_any: bool) -> Option<i64> {
    if heard_any || words < PACE_MIN_WORDS || covered_ms <= 0 || signals * PACE_TOUCH_MS < covered_ms { return None }
    Some((words * 60_000 / covered_ms).clamp(100, 1_000))
}

/// The pace the samples come to (words a minute), once there are enough.
pub fn pace_of(samples: &[i64]) -> Option<i64> {
    if samples.len() < PACE_NEEDS { return None }
    let mut s: Vec<i64> = samples.iter().rev().take(PACE_KEEP).copied().collect();
    s.sort_unstable();
    Some(s[s.len() / 2].clamp(PACE_MIN_WPM, PACE_MAX_WPM))
}

fn pace_samples(conn: &Connection, user_id: i64) -> rusqlite::Result<Vec<i64>> {
    let s: Option<String> = conn.query_row("SELECT samples FROM reading_pace WHERE user_id=?1", params![user_id], |r| r.get(0)).optional()?;
    Ok(s.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
}

/// The reader's own pace as ms a word, once learned and quicker than the unhurried pace.
pub fn pace_ms_per_word(conn: &Connection, user_id: i64) -> rusqlite::Result<Option<i64>> {
    Ok(pace_of(&pace_samples(conn, user_id)?).filter(|w| *w > PACE_MIN_WPM).map(|w| 60_000 / w))
}

/// Counts the touches of a beat toward the chapter until all of it has been taken in, and notes the time that took.
pub fn note_reading(conn: &Connection, user_id: i64, book: i64, chapter: i64, signals: i64, covered: bool, active_ms: i64) -> rusqlite::Result<()> {
    conn.prepare_cached("UPDATE read_throughs SET signals = signals + CASE WHEN covered_ms = 0 THEN ?4 ELSE 0 END,
        covered_ms = CASE WHEN covered_ms = 0 AND ?5 THEN max(?6, 1) ELSE covered_ms END WHERE user_id=?1 AND book=?2 AND chapter=?3")?
        .execute(params![user_id, book, chapter, signals.clamp(0, 50), covered, active_ms])?;
    Ok(())
}

/// At a credit: the chapter's pace joins the reader's samples when it says something about them.
pub fn learn_pace(conn: &Connection, user_id: i64, book: i64, chapter: i64, words: i64, heard_any: bool) -> rusqlite::Result<()> {
    let row: Option<(i64, i64)> = conn.query_row("SELECT covered_ms, signals FROM read_throughs WHERE user_id=?1 AND book=?2 AND chapter=?3", params![user_id, book, chapter], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    let Some(sample) = row.and_then(|(c, s)| pace_sample(words, c, s, heard_any)) else { return Ok(()) };
    let mut samples = pace_samples(conn, user_id)?;
    samples.push(sample);
    let keep = samples.len().saturating_sub(PACE_KEEP);
    samples.drain(..keep);
    conn.prepare_cached("INSERT INTO reading_pace (user_id, samples) VALUES (?1, ?2) ON CONFLICT(user_id) DO UPDATE SET samples=excluded.samples")?
        .execute(params![user_id, serde_json::to_string(&samples).unwrap_or_default()])?;
    Ok(())
}

/// Forgets a stored chapter, so the next save starts it afresh (its touches and timing too).
pub fn drop_row(conn: &Connection, user_id: i64, book: i64, chapter: i64) -> rusqlite::Result<()> {
    conn.prepare_cached("DELETE FROM read_throughs WHERE user_id=?1 AND book=?2 AND chapter=?3")?.execute(params![user_id, book, chapter])?;
    Ok(())
}

/// Part-read chapters not read for `KEEP_HOURS` are forgotten.
pub fn forget_old(conn: &Connection, user_id: i64, now: time::OffsetDateTime) -> rusqlite::Result<()> {
    let cutoff = (now - time::Duration::hours(KEEP_HOURS)).format(time::macros::format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z")).unwrap_or_default();
    conn.prepare_cached("DELETE FROM read_throughs WHERE user_id=?1 AND updated_at < ?2")?.execute(params![user_id, cutoff])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Beat { ms: i64, seen: Option<Ranges>, heard: Option<Ranges> }
    #[derive(Deserialize)]
    struct Expect { state: ReadThrough, judgement: Judgement }
    #[derive(Deserialize)]
    struct Case { name: String, shape: String, beats: Vec<Beat>, expect: Expect }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Earned { elapsed_ms: i64, active: bool, visible: bool, listening: bool, heard_cost_ms: i64, expect: i64 }
    #[derive(Deserialize)]
    struct Cases { shapes: HashMap<String, Shape>, cases: Vec<Case>, earned: Vec<Earned> }

    /// The device's copy of the rule (shared/readThrough.ts) wrote these; the server's must agree to the millisecond.
    #[test]
    fn agrees_with_the_shared_cases() {
        let f: Cases = serde_json::from_str(include_str!("../../shared/readThrough.cases.json")).unwrap();
        for c in &f.cases {
            let shape = &f.shapes[&c.shape];
            let t = c.beats.iter().fold(fresh(shape), |t, b| apply(&t, shape, b.ms, b.seen.as_ref(), b.heard.as_ref()));
            assert_eq!(t, c.expect.state, "{}", c.name);
            assert_eq!(judge(&t, shape), c.expect.judgement, "{}", c.name);
        }
        for e in &f.earned { assert_eq!(earned_ms(e.elapsed_ms, e.active, e.visible, e.listening, e.heard_cost_ms), e.expect, "{:?}", (e.elapsed_ms, e.active, e.visible, e.listening)); }
    }

    #[test]
    fn counts_words_as_the_build_does() {
        assert_eq!(word_count("In [the] beginning God created the heavens and the earth."), 10);
        assert_eq!(word_count("Lord’s — it's"), 2);
    }

    #[test]
    fn a_stored_state_that_no_longer_fits_starts_again() {
        let shape = Shape { verses: vec![1, 2, 3], words: vec![5, 5, 5], audio_ms: None, ms_per_word: None };
        assert_eq!(fit(Some(ReadThrough { seen: vec![1], heard: vec![0], bank: 0, active_ms: 9, listen_bank: 0 }), &shape), fresh(&shape));
        assert_eq!(fit(Some(ReadThrough { seen: vec![9, -1, 2], heard: vec![3, 0, 0], bank: 999, active_ms: -4, listen_bank: 90_000 }), &shape),
            ReadThrough { seen: vec![5, 0, 2], heard: vec![1, 0, 0], bank: 250, active_ms: 0, listen_bank: 20_000 });
    }
}
