//! Read-aloud: pre-recorded chapters in a few voices, with word timings, served from disk.
//!
//! One canonical recording per voice per chapter (heading, then the verses, no verse numbers), made once by
//! `berean-tts-batch` through Speechify and kept under `BEREAN_DATA/tts/<voice>/<book>-<chapter>.{mp3,json}`.
//! The app plays verse by verse from the timings, so verse numbers (a per-voice numbers clip), pauses and the
//! heading are the client's choice and never need a second recording. Nothing here calls Speechify at request
//! time: a chapter that has not been recorded is simply reported as unavailable.
use crate::error::{ApiError, ApiResult};
use axum::{body::Body, extract::Path, http::{header, HeaderMap, StatusCode}, response::{IntoResponse, Response}, routing::get, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;

/// The voices we record. Ids are Speechify voice ids; names are what the app shows.
pub const VOICES: &[(&str, &str, &str)] = &[
    ("alec", "Alec", "British, low and unhurried"),
    ("beatrice_32", "Beatrice", "British, warm"),
    ("dominic", "Dominic", "American, clear"),
];
pub const NUMBERS_MAX: i64 = 176; // Psalm 119

pub fn voice_ok(v: &str) -> bool { VOICES.iter().any(|(id, _, _)| *id == v) }
pub fn tts_dir() -> PathBuf { PathBuf::from(std::env::var("BEREAN_DATA").unwrap_or_else(|_| "data".into())).join("tts") }
pub fn chapter_paths(voice: &str, book: i64, chapter: i64) -> (PathBuf, PathBuf) {
    let d = tts_dir().join(voice);
    (d.join(format!("{book}-{chapter}.mp3")), d.join(format!("{book}-{chapter}.json")))
}
pub fn numbers_paths(voice: &str) -> (PathBuf, PathBuf) { let d = tts_dir().join(voice); (d.join("numbers.mp3"), d.join("numbers.json")) }

// ---------------------------------------------------------------- text and timing model

#[derive(Serialize, Deserialize, Clone)]
pub struct WordMark { pub off: i64, pub start: i64, pub end: i64 }
/// A clause of a verse: recorded (`start`/`end` set) or refused by the content filter (no times), in reading order.
#[derive(Serialize, Deserialize, Clone)]
pub struct Part { pub a: i64, pub b: i64, #[serde(skip_serializing_if = "Option::is_none")] pub start: Option<i64>, #[serde(skip_serializing_if = "Option::is_none")] pub end: Option<i64> }
#[derive(Serialize, Deserialize, Clone)]
pub struct VerseMark { pub v: i64, pub start: i64, pub end: i64, pub words: Vec<WordMark>, #[serde(default, skip_serializing_if = "Vec::is_empty")] pub parts: Vec<Part> }
/// What the app needs to follow along: the heading's span, then each verse's span and its words.
/// Times are milliseconds into the recording; `off` is a character offset into the verse's own text.
#[derive(Serialize, Deserialize, Clone)]
pub struct ChapterMarks { pub voice: String, pub book: i64, pub chapter: i64, pub duration: i64, pub heading: Option<(i64, i64)>, pub verses: Vec<VerseMark> }

/// A chapter as read aloud: the heading, a blank line, then the verses one per line. Verse text goes in
/// exactly as displayed (brackets included) so Speechify's character offsets map straight back to it.
pub struct Script { pub text: String, pub heading: Option<(usize, usize)>, pub verses: Vec<ScriptVerse> }
/// A verse's line in the script: its span in `text`, and the display-text byte offsets of the brackets left out
/// of it (Darby's [supplied words]: read as words, so the voice neither names nor pauses at the marks).
pub struct ScriptVerse { pub v: i64, pub start: usize, pub end: usize, pub removed: Vec<usize> }
/// A mark offset into the verse's spoken (bracket-less) text, as an offset into its display text.
pub fn display_off(removed: &[usize], off: usize) -> usize {
    let mut d = off;
    for &r in removed { if r <= d { d += 1 } else { break } }
    d
}
pub fn script(book_name: &str, ch: &crate::bible::Chapter) -> Script {
    let mut text = String::new();
    let heading = format!("{book_name}, chapter {}.", ch.c);
    text.push_str(&heading);
    let heading_span = Some((0usize, heading.len()));
    // one newline, not a blank line: a paragraph break here made Speechify (alec, dominic) silently drop the rest of
    // verse 1 through verse 3 from the audio (Lev 1, Gen 5, Ex 31 ...), with no marks for the dropped text
    text.push('\n');
    let mut verses = Vec::with_capacity(ch.verses.len());
    for v in &ch.verses {
        if v.t.trim().is_empty() { continue }   // Darby omits Matt 23:14 etc.
        let start = text.len();
        let mut removed = Vec::new();
        for (i, ch) in v.t.trim().char_indices() { if ch == '[' || ch == ']' { removed.push(i) } else { text.push(ch) } }
        verses.push(ScriptVerse { v: v.v, start, end: text.len(), removed });
        text.push('\n');
    }
    Script { text, heading: heading_span, verses }
}

#[derive(Deserialize)]
pub struct SpeechMark { pub start: i64, pub end: i64, pub start_time: i64, pub end_time: i64, #[serde(rename = "type")] pub kind: String }

/// Fold Speechify's word marks (offsets into `script.text`) onto the verses of the script.
pub fn fold_marks(voice: &str, book: i64, chapter: i64, script: &Script, marks: &[SpeechMark], silent: &[Silent]) -> ChapterMarks {
    let words: Vec<&SpeechMark> = marks.iter().filter(|m| m.kind == "word").collect();
    let duration = words.iter().map(|m| m.end_time).max().unwrap_or(0);
    let heading = script.heading.and_then(|(s, e)| {
        let in_h: Vec<&&SpeechMark> = words.iter().filter(|m| (m.start as usize) >= s && (m.start as usize) < e).collect();
        Some((in_h.first()?.start_time, in_h.last()?.end_time))
    });
    let verses = script.verses.iter().map(|sv| {
        let (v, s, e) = (sv.v, sv.start, sv.end);
        let disp = |off: usize| display_off(&sv.removed, off) as i64;
        let ws: Vec<WordMark> = words.iter().filter(|m| (m.start as usize) >= s && (m.start as usize) < e)
            .map(|m| WordMark { off: disp(m.start as usize - s), start: m.start_time, end: m.end_time }).collect();
        let start = ws.first().map(|w| w.start).unwrap_or(0);
        let end = ws.last().map(|w| w.end).unwrap_or(start);
        // ordered clauses for a verse the filter partly refused: recorded ones carry times, refused ones none
        let gaps: Vec<&Silent> = silent.iter().filter(|g| g.a >= s && g.a < e).collect();
        let mut parts = Vec::new();
        if !gaps.is_empty() || ws.is_empty() && e > s {
            let mut cursor = s;
            let push_recorded = |a: usize, b: usize, parts: &mut Vec<Part>| {
                let in_range: Vec<&WordMark> = ws.iter().filter(|w| w.off >= disp(a - s) && w.off < disp(b - s)).collect();
                if let (Some(f), Some(l)) = (in_range.first(), in_range.last()) { parts.push(Part { a: disp(a - s), b: disp(b - s), start: Some(f.start), end: Some(l.end) }); }
            };
            for g in &gaps {
                if g.a > cursor { push_recorded(cursor, g.a, &mut parts); }
                parts.push(Part { a: disp(g.a - s), b: disp(g.b - s), start: None, end: None });
                cursor = g.b;
            }
            if cursor < e { push_recorded(cursor, e, &mut parts); }
        }
        VerseMark { v, start, end, words: ws, parts }
    }).collect();
    let mut verses: Vec<VerseMark> = verses;
    // Speechify now and then returns no word marks for a verse it did record (alec: Gen 5, Ex 31, ...). The audio
    // is there between its neighbours, so give such a verse that span (no word highlight) rather than the device voice.
    let h_end = heading.map(|(_, e)| e).unwrap_or(0);
    for i in 0..verses.len() {
        if !verses[i].words.is_empty() || !verses[i].parts.is_empty() { continue }
        let start = verses[..i].iter().rev().find(|v| v.end > v.start).map(|v| v.end).unwrap_or(h_end);
        let end = verses[i + 1..].iter().find(|v| v.end > v.start).map(|v| v.start).unwrap_or(duration);
        if end > start { verses[i].start = start; verses[i].end = end; }
    }
    ChapterMarks { voice: voice.into(), book, chapter, duration, heading, verses }
}

// ---------------------------------------------------------------- Speechify client (batch only)

#[derive(Deserialize)]
struct SpeechResponse { audio_data: String, speech_marks: Option<Value>, billable_characters_count: Option<i64> }

/// One synthesis call. Returns the mp3 bytes, the word marks and the billable character count.
pub async fn synthesize(client: &reqwest::Client, key: &str, voice: &str, text: &str) -> anyhow::Result<(Vec<u8>, Vec<SpeechMark>, i64)> {
    let body = json!({ "input": text, "voice_id": voice, "audio_format": "mp3", "options": { "loudness_normalization": true } });
    let r = client.post("https://api.sws.speechify.com/v1/audio/speech").bearer_auth(key).json(&body).send().await?;
    if !r.status().is_success() { anyhow::bail!("speechify {}: {}", r.status(), r.text().await.unwrap_or_default().chars().take(300).collect::<String>()); }
    let resp: SpeechResponse = r.json().await?;
    let audio = base64_decode(&resp.audio_data)?;
    // marks arrive as one sentence/document node with `chunks` of words, or as a flat list; take every word
    let mut marks = Vec::new();
    fn collect(v: &Value, out: &mut Vec<SpeechMark>) {
        if let Ok(m) = serde_json::from_value::<SpeechMark>(v.clone()) { if m.kind == "word" { out.push(m); } }
        if let Some(arr) = v.get("chunks").and_then(|c| c.as_array()) { for c in arr { collect(c, out); } }
        if let Some(arr) = v.as_array() { for c in arr { collect(c, out); } }
    }
    if let Some(sm) = &resp.speech_marks { collect(sm, &mut marks); }
    // Speechify counts offsets in UTF-16 units; everything here is byte offsets into `text`. Left unconverted, every
    // word after a curly apostrophe drifted into the previous verse (877 chapters carried such text).
    let mut bytes_at: Vec<usize> = Vec::with_capacity(text.len() + 1);
    for (i, ch) in text.char_indices() { for _ in 0..ch.len_utf16() { bytes_at.push(i); } }
    bytes_at.push(text.len());
    let to_byte = |u: i64| bytes_at[(u.max(0) as usize).min(bytes_at.len() - 1)] as i64;
    for m in &mut marks { m.start = to_byte(m.start); m.end = to_byte(m.end); }
    marks.sort_by_key(|m| m.start);
    Ok((audio, marks, resp.billable_characters_count.unwrap_or(text.len() as i64)))
}

/// Speechify accepts 2,000 characters per request, so a chapter is read in pieces cut at verse boundaries
/// (`script.text` lines) and the pieces are joined: MP3 frames concatenate cleanly, and each piece's marks are
/// shifted by its character offset and by the true decoded length of the audio before it (from the frame
/// headers, not the last word's end time, or verses would drift later in the chapter).
pub const MAX_INPUT: usize = 2000;
pub struct Silent { pub a: usize, pub b: usize }
struct Joined { audio: Vec<u8>, marks: Vec<SpeechMark>, chars: i64, base_ms: i64, silent: Vec<Silent> }
pub async fn synthesize_long(client: &reqwest::Client, key: &str, voice: &str, text: &str) -> anyhow::Result<(Vec<u8>, Vec<SpeechMark>, i64, Vec<Silent>)> {
    let mut pieces: Vec<(usize, usize)> = Vec::new();
    let (mut start, mut cursor) = (0usize, 0usize);
    for line in text.split_inclusive('\n') {
        if cursor + line.len() - start > MAX_INPUT && cursor > start { pieces.push((start, cursor)); start = cursor; }
        cursor += line.len();
    }
    if cursor > start { pieces.push((start, cursor)); }
    let mut st = Joined { audio: Vec::new(), marks: Vec::new(), chars: 0, base_ms: 0, silent: Vec::new() };
    for (a, b) in pieces {
        if text[a..b].trim().is_empty() { continue }
        synth_unit(client, key, voice, text, a, b, 0, &mut st).await?;
    }
    Ok((st.audio, st.marks, st.chars, st.silent))
}

/// One unit of the script at a level of the split: 0 = a piece of verse lines, 1 = one verse line, 2 = one clause.
/// Two things send a unit down a level: the content filter refusing it (Genesis 19, Judges 19 ...), and the engine
/// silently leaving part of it out of the audio, which shows as a line with no word marks (2 Sam 23:38-39, Neh 12:21
/// and a blank-line-after-heading case were all such drops). At the clause level a refusal or a drop goes silent,
/// and the app reads that clause with the device voice in its place.
async fn synth_unit(client: &reqwest::Client, key: &str, voice: &str, text: &str, a: usize, b: usize, depth: u8, st: &mut Joined) -> anyhow::Result<()> {
    let unit = &text[a..b];
    match retry(|| synthesize(client, key, voice, unit)).await {
        Ok((pa, pm, pc)) => {
            let missing = uncovered(unit, &pm, depth);
            if missing.is_empty() { append(st, a, pa, pm, pc); return Ok(()) }
            if depth == 2 { eprintln!("  no audio came back for: {}", unit.trim().chars().take(70).collect::<String>()); st.silent.push(Silent { a, b }); return Ok(()) }
            eprintln!("  engine skipped {} of {} lines, reading them {}", missing.len(), unit.lines().filter(|l| !l.trim().is_empty()).count(), if depth == 0 { "one verse at a time" } else { "one clause at a time" });
        }
        Err(e) if is_policy(&e) => {
            if depth == 2 { eprintln!("  refused, left to the device voice: {}", unit.trim().chars().take(70).collect::<String>()); st.silent.push(Silent { a, b }); return Ok(()) }
        }
        Err(e) => return Err(e),
    }
    for (sa, sb) in subunits(unit, depth) {
        if text[a + sa..a + sb].trim().is_empty() { continue }
        Box::pin(synth_unit(client, key, voice, text, a + sa, a + sb, depth + 1, st)).await?;
    }
    Ok(())
}
/// Offsets (into `unit`) of the parts one level finer: lines of a piece, clauses of a line.
fn subunits(unit: &str, depth: u8) -> Vec<(usize, usize)> {
    if depth == 0 {
        let mut out = Vec::new(); let mut off = 0usize;
        for line in unit.split_inclusive('\n') { out.push((off, off + line.len())); off += line.len(); }
        out
    } else { clauses(unit) }
}
/// Non-empty lines of the unit (the whole unit below piece level) that no word mark falls into.
fn uncovered(unit: &str, marks: &[SpeechMark], depth: u8) -> Vec<(usize, usize)> {
    let ranges = if depth == 0 { subunits(unit, 0) } else { vec![(0, unit.len())] };
    ranges.into_iter().filter(|&(ua, ub)| !unit[ua..ub].trim().is_empty() && !marks.iter().any(|m| m.kind == "word" && (m.start as usize) >= ua && (m.start as usize) < ub)).collect()
}
/// A Xing frame (frame count, byte count, 100-point TOC) in front of the joined pieces. Browsers decode and seek
/// exactly without one; Android's ExoPlayer cannot seek an MP3 that has no seek table beyond what it has read, so
/// a jump to a verse landed wherever the buffer ended. Pieces are constant bitrate, so the TOC is linear.
pub fn with_seek_table(audio: &[u8]) -> Vec<u8> {
    let frames = mp3_frames(audio);
    let Some(&(off0, len0)) = frames.first() else { return audio.to_vec() };
    if audio[off0..off0 + len0].windows(4).any(|w| w == b"Xing" || w == b"Info") { return audio.to_vec() }
    let h = &audio[off0..off0 + 4];
    let ver = (h[1] >> 3) & 3; let mode = (h[3] >> 6) & 3;
    let side = if ver == 3 { if mode == 3 { 17 } else { 32 } } else if mode == 3 { 9 } else { 17 };
    let body_len: usize = frames.iter().map(|&(_, l)| l).sum();
    let total_bytes = (len0 + body_len) as u32;
    let mut frame = Vec::with_capacity(len0);
    frame.extend_from_slice(h); frame.extend(std::iter::repeat(0u8).take(side));
    frame.extend_from_slice(b"Xing"); frame.extend_from_slice(&7u32.to_be_bytes());
    frame.extend_from_slice(&((frames.len() + 1) as u32).to_be_bytes()); frame.extend_from_slice(&total_bytes.to_be_bytes());
    for p in 0..100u64 { let byte = (frames.len() as u64 * p / 100) as usize * len0 + len0; frame.push(((256 * byte as u64 / total_bytes as u64).min(255)) as u8); }
    if frame.len() > len0 { return audio.to_vec() }
    frame.resize(len0, 0);
    let mut out = Vec::with_capacity(len0 + body_len);
    // keep a leading ID3 tag, drop the tags of later pieces so byte positions stay linear
    if audio.starts_with(b"ID3") { let n = 10 + ((audio[6] as usize) << 21 | (audio[7] as usize) << 14 | (audio[8] as usize) << 7 | audio[9] as usize); out.extend_from_slice(&audio[..n.min(audio.len())]); }
    out.extend_from_slice(&frame);
    for &(o, l) in &frames { out.extend_from_slice(&audio[o..o + l]); }
    out
}
/// (offset, length) of every MPEG audio frame, skipping ID3 tags and junk between pieces.
fn mp3_frames(data: &[u8]) -> Vec<(usize, usize)> {
    const BR1: [u32; 15] = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    const BR2: [u32; 15] = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    let mut out = Vec::new(); let mut i = 0usize; let n = data.len();
    while i + 4 <= n {
        if data[i..].starts_with(b"ID3") && i + 10 <= n { i += 10 + ((data[i + 6] as usize) << 21 | (data[i + 7] as usize) << 14 | (data[i + 8] as usize) << 7 | data[i + 9] as usize); continue }
        let h = &data[i..i + 4];
        if h[0] == 0xFF && (h[1] & 0xE0) == 0xE0 {
            let ver = (h[1] >> 3) & 3; let layer = (h[1] >> 1) & 3; let bri = (h[2] >> 4) as usize; let sri = ((h[2] >> 2) & 3) as usize; let pad = ((h[2] >> 1) & 1) as usize;
            if ver != 1 && layer == 1 && bri != 0 && bri != 15 && sri != 3 {
                let (br, spf) = if ver == 3 { (BR1[bri], 1152) } else { (BR2[bri], 576) };
                let sr = match ver { 3 => [44100, 48000, 32000][sri], 2 => [22050, 24000, 16000][sri], _ => [11025, 12000, 8000][sri] };
                let flen = (spf / 8 * br as usize * 1000 / sr) + pad;
                out.push((i, flen)); i += flen.max(1); continue
            }
        }
        i += 1;
    }
    out
}

/// Clause boundaries of a verse: after `,` `;` `:` `.` `?` `!` followed by a space (offsets into the line).
fn clauses(line: &str) -> Vec<(usize, usize)> {
    let b = line.as_bytes(); let mut out = Vec::new(); let mut start = 0usize;
    for i in 0..b.len() { if matches!(b[i], b',' | b';' | b':' | b'.' | b'?' | b'!') && i + 1 < b.len() && b[i + 1] == b' ' { out.push((start, i + 1)); start = i + 1; } }
    if start < b.len() { out.push((start, b.len())); }
    out
}
fn is_policy(e: &anyhow::Error) -> bool { e.to_string().contains("content_policy_violation") }
fn is_credits(e: &anyhow::Error) -> bool { e.to_string().contains("payment_required") }
fn append(st: &mut Joined, a: usize, pa: Vec<u8>, pm: Vec<SpeechMark>, pc: i64) {
    let dur = mp3_duration_ms(&pa);
    for m in pm { st.marks.push(SpeechMark { start: m.start + a as i64, end: m.end + a as i64, start_time: m.start_time + st.base_ms, end_time: m.end_time + st.base_ms, kind: m.kind }); }
    st.base_ms += dur; st.chars += pc; st.audio.extend_from_slice(&pa);
}

/// Decoded length of an MP3 from its frame headers (MPEG-1/2 Layer III, ID3v2 skipped).
pub fn mp3_duration_ms(b: &[u8]) -> i64 {
    const BITRATES_V1: [u32; 16] = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
    const BITRATES_V2: [u32; 16] = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
    const RATES: [[u32; 4]; 3] = [[44100, 48000, 32000, 0], [22050, 24000, 16000, 0], [11025, 12000, 8000, 0]];
    let mut i = 0usize;
    if b.len() > 10 && &b[0..3] == b"ID3" { i = 10 + (((b[6] as usize) << 21) | ((b[7] as usize) << 14) | ((b[8] as usize) << 7) | b[9] as usize); }
    let mut samples = 0f64;
    while i + 4 <= b.len() {
        if b[i] != 0xFF || (b[i + 1] & 0xE0) != 0xE0 { i += 1; continue }
        let ver = (b[i + 1] >> 3) & 3;      // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
        let layer = (b[i + 1] >> 1) & 3;    // 1 = layer III
        let br_i = (b[i + 2] >> 4) as usize; let sr_i = ((b[i + 2] >> 2) & 3) as usize; let pad = ((b[i + 2] >> 1) & 1) as usize;
        if layer != 1 || ver == 1 || br_i == 0 || br_i == 15 || sr_i == 3 { i += 1; continue }
        let (bitrate, rate, spf) = match ver { 3 => (BITRATES_V1[br_i], RATES[0][sr_i], 1152.0), 2 => (BITRATES_V2[br_i], RATES[1][sr_i], 576.0), _ => (BITRATES_V2[br_i], RATES[2][sr_i], 576.0) };
        if bitrate == 0 || rate == 0 { i += 1; continue }
        let len = (spf as u32 / 8 * bitrate * 1000 / rate) as usize + pad;
        if len < 24 { i += 1; continue }
        samples += spf / rate as f64;
        i += len;
    }
    (samples * 1000.0).round() as i64
}

fn base64_decode(s: &str) -> anyhow::Result<Vec<u8>> {
    // standard alphabet with padding, as Speechify sends it
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut buf, mut bits) = (0u32, 0u32);
    for &c in s.as_bytes() {
        if c == b'=' || c == b'\n' || c == b'\r' { continue }
        let Some(v) = T.iter().position(|&t| t == c) else { anyhow::bail!("bad base64") };
        buf = (buf << 6) | v as u32; bits += 6;
        if bits >= 8 { bits -= 8; out.push((buf >> bits) as u8); buf &= (1 << bits) - 1; }
    }
    Ok(out)
}

// ---------------------------------------------------------------- routes

async fn voices() -> Json<Value> {
    let dir = tts_dir();
    let list: Vec<Value> = VOICES.iter().map(|(id, name, blurb)| {
        let recorded = std::fs::read_dir(dir.join(id)).map(|d| d.filter_map(|e| e.ok()).filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false) && e.file_name() != "numbers.json").count()).unwrap_or(0);
        let numbers = numbers_paths(id).1.exists();
        json!({ "id": id, "name": name, "blurb": blurb, "chapters": recorded, "numbers": numbers })
    }).collect();
    Json(json!({ "voices": list, "total_chapters": 1189 }))
}

async fn marks(Path((voice, book, chapter)): Path<(String, i64, i64)>, headers: HeaderMap) -> ApiResult<Response> {
    if !voice_ok(&voice) { return Err(ApiError::bad("unknown voice")); }
    let (_, j) = chapter_paths(&voice, book, chapter);
    json_file(j, &headers, "this chapter has not been recorded in that voice yet").await
}
async fn audio(Path((voice, book, chapter)): Path<(String, i64, i64)>, headers: HeaderMap) -> ApiResult<Response> {
    if !voice_ok(&voice) { return Err(ApiError::bad("unknown voice")); }
    let (m, _) = chapter_paths(&voice, book, chapter);
    file(m, &headers).await
}
/// Timing JSON: revalidated on every request (an ETag from size and mtime), because a repair of the marks must
/// reach players that cached the old file; the body is small, so a 304 round trip is all it costs.
async fn json_file(p: PathBuf, headers: &HeaderMap, missing: &'static str) -> ApiResult<Response> {
    let Ok(meta) = tokio::fs::metadata(&p).await else { return Err(ApiError::not_found(missing)) };
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let etag = format!("\"{:x}-{:x}\"", meta.len(), mtime);
    if headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()).map(|v| v.split(',').any(|t| t.trim() == etag)).unwrap_or(false) {
        return Ok((StatusCode::NOT_MODIFIED, [(header::ETAG, etag)]).into_response());
    }
    let Ok(bytes) = tokio::fs::read(&p).await else { return Err(ApiError::not_found(missing)) };
    Ok(([(header::CONTENT_TYPE, "application/json".to_string()), (header::CACHE_CONTROL, "public, no-cache".to_string()), (header::ETAG, etag)], bytes).into_response())
}
async fn numbers_marks(Path(voice): Path<String>, headers: HeaderMap) -> ApiResult<Response> {
    if !voice_ok(&voice) { return Err(ApiError::bad("unknown voice")); }
    json_file(numbers_paths(&voice).1, &headers, "numbers not recorded").await
}
/// One spoken verse number as its own clip (numbers/<n>.mp3): the player plays the whole file, so no seek inside
/// the long numbers recording can start early or run on into the next number.
async fn audio_opus(Path((voice, book, chapter)): Path<(String, i64, i64)>, headers: HeaderMap) -> ApiResult<Response> {
    if !voice_ok(&voice) { return Err(ApiError::bad("unknown voice")); }
    let (m, _) = chapter_paths(&voice, book, chapter);
    file_typed(m.with_extension("opus"), &headers, "audio/ogg").await
}
async fn number_audio_opus(Path((voice, n)): Path<(String, u32)>, headers: HeaderMap) -> ApiResult<Response> {
    if !voice_ok(&voice) || n == 0 || i64::from(n) > NUMBERS_MAX { return Err(ApiError::bad("unknown voice or number")); }
    file_typed(tts_dir().join(&voice).join("numbers").join(format!("{n}.opus")), &headers, "audio/ogg").await
}
async fn number_audio(Path((voice, n)): Path<(String, u32)>, headers: HeaderMap) -> ApiResult<Response> {
    if !voice_ok(&voice) || n == 0 || i64::from(n) > NUMBERS_MAX { return Err(ApiError::bad("unknown voice or number")); }
    file(tts_dir().join(&voice).join("numbers").join(format!("{n}.mp3")), &headers).await
}
async fn numbers_audio(Path(voice): Path<String>, headers: HeaderMap) -> ApiResult<Response> {
    if !voice_ok(&voice) { return Err(ApiError::bad("unknown voice")); }
    file(numbers_paths(&voice).0, &headers).await
}

/// A `Range` header against a body of `len` bytes: one `(first, last)` inclusive span, unsatisfiable, or ignored
/// (absent, malformed, another unit, or several ranges) so the whole file is sent, as RFC 9110 allows.
#[derive(Debug, PartialEq)]
enum ByteRange { Whole, Span(u64, u64), Unsatisfiable }
fn byte_range(h: Option<&str>, len: u64) -> ByteRange {
    let Some(spec) = h.and_then(|h| h.trim().strip_prefix("bytes=")) else { return ByteRange::Whole };
    if spec.contains(',') { return ByteRange::Whole; }
    let Some((a, b)) = spec.trim().split_once('-') else { return ByteRange::Whole };
    let (a, b) = (a.trim(), b.trim());
    if a.is_empty() {
        let Ok(n) = b.parse::<u64>() else { return ByteRange::Whole };
        return if n == 0 || len == 0 { ByteRange::Unsatisfiable } else { ByteRange::Span(len.saturating_sub(n), len - 1) };
    }
    let Ok(first) = a.parse::<u64>() else { return ByteRange::Whole };
    let last = if b.is_empty() { u64::MAX } else { match b.parse::<u64>() { Ok(l) if l >= first => l, _ => return ByteRange::Whole } };
    if first >= len { ByteRange::Unsatisfiable } else { ByteRange::Span(first, last.min(len - 1)) }
}

/// An mp3 streamed from disk (up to ~8 MB, so never read whole per request) with a long cache life: recordings
/// never change once made, so size + mtime is a sound validator. Single byte ranges are served (players seek
/// with them; Safari and AVPlayer will not play without them).
async fn file(p: PathBuf, h: &HeaderMap) -> ApiResult<Response> { file_typed(p, h, "audio/mpeg").await }
/// The Opus twin of a recording (Ogg, 32 kb/s, about a quarter of the MP3), for Android and browsers other than
/// Safari; the MP3 masters stay for everything else. Same timeline, so the marks apply unchanged.
async fn file_typed(p: PathBuf, h: &HeaderMap, ctype: &'static str) -> ApiResult<Response> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    let Ok(mut f) = tokio::fs::File::open(&p).await else { return Err(ApiError::not_found("not recorded yet")) };
    let meta = f.metadata().await.map_err(|_| ApiError::not_found("not recorded yet"))?;
    let len = meta.len();
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
    let etag = format!("\"{len:x}-{mtime:x}\"");
    let res = Response::builder()
        .header(header::CONTENT_TYPE, ctype)
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ETAG, &etag);
    let matches = |v: &str| v.split(',').any(|t| { let t = t.trim(); t == "*" || t.trim_start_matches("W/") == etag });
    if h.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()).is_some_and(matches) {
        return Ok(res.status(StatusCode::NOT_MODIFIED).body(Body::empty()).unwrap());
    }
    // If-Range names the representation the client already holds part of; any other validator gets the whole file
    let range = h.get(header::RANGE).and_then(|v| v.to_str().ok())
        .filter(|_| h.get(header::IF_RANGE).is_none_or(|v| v.as_bytes() == etag.as_bytes()));
    let (res, first, n) = match byte_range(range, len) {
        ByteRange::Whole => (res.status(StatusCode::OK), 0, len),
        ByteRange::Span(a, b) => (res.status(StatusCode::PARTIAL_CONTENT).header(header::CONTENT_RANGE, format!("bytes {a}-{b}/{len}")), a, b - a + 1),
        ByteRange::Unsatisfiable => return Ok(res.status(StatusCode::RANGE_NOT_SATISFIABLE).header(header::CONTENT_RANGE, format!("bytes */{len}")).body(Body::empty()).unwrap()),
    };
    if first > 0 { f.seek(std::io::SeekFrom::Start(first)).await.map_err(|_| ApiError::internal("read error"))?; }
    let body = Body::from_stream(tokio_util::io::ReaderStream::with_capacity(f.take(n), 64 * 1024));
    Ok(res.header(header::CONTENT_LENGTH, n).body(body).unwrap())
}

/// The voice sample: Psalm 23:1-3 cut out of the voice's own recording (its verse marks give the span), so the
/// preview is exactly the reading, not a fresh synthesis. Frames are 24 ms, so the cut lands within a breath of
/// the marks; a Xing table goes in front so Android can seek and report a duration. Cut once, kept beside the
/// recording as preview.mp3 (best effort: a read-only data dir just cuts again next time).
const PREVIEW: (i64, i64, i64, i64) = (19, 23, 1, 3);
fn cut_preview(voice: &str) -> Option<Vec<u8>> {
    let (book, chapter, v1, v2) = PREVIEW;
    let (m, j) = chapter_paths(voice, book, chapter);
    let marks: ChapterMarks = serde_json::from_slice(&std::fs::read(j).ok()?).ok()?;
    let start = marks.verses.iter().find(|v| v.v == v1)?.start;
    let end = marks.verses.iter().find(|v| v.v == v2)?.end;
    let audio = std::fs::read(m).ok()?;
    let frames = mp3_frames(&audio);
    let mut out = Vec::new(); let mut t = 0f64;
    for &(o, l) in &frames {
        let h = &audio[o..o + 4];
        let ver = (h[1] >> 3) & 3; let sri = ((h[2] >> 2) & 3) as usize;
        let (spf, sr) = if ver == 3 { (1152f64, [44100f64, 48000., 32000.][sri]) } else if ver == 2 { (576f64, [22050f64, 24000., 16000.][sri]) } else { (576f64, [11025f64, 12000., 8000.][sri]) };
        let ms = spf * 1000. / sr;
        if t >= start as f64 && t < end as f64 { out.extend_from_slice(&audio[o..o + l]); }
        t += ms;
        if t >= end as f64 { break }
    }
    if out.is_empty() { return None }
    Some(with_seek_table(&out))
}
async fn preview_audio(Path(voice): Path<String>, headers: HeaderMap) -> ApiResult<Response> {
    if !voice_ok(&voice) { return Err(ApiError::bad("unknown voice")); }
    let p = tts_dir().join(&voice).join("preview.mp3");
    if !p.exists() {
        let v = voice.clone();
        let bytes = tokio::task::spawn_blocking(move || cut_preview(&v)).await.ok().flatten().ok_or_else(|| ApiError::not_found("this voice has no sample yet"))?;
        if tokio::fs::write(&p, &bytes).await.is_err() {
            return Ok(([(header::CONTENT_TYPE, "audio/mpeg"), (header::CACHE_CONTROL, "public, max-age=86400")], bytes).into_response());
        }
    }
    file(p, &headers).await
}

pub fn router() -> Router<crate::AppState> {
    Router::new()
        .route("/voices", get(voices))
        .route("/{voice}/numbers", get(numbers_marks))
        .route("/{voice}/numbers/audio", get(numbers_audio))
        .route("/{voice}/numbers/{n}/audio", get(number_audio))
        .route("/{voice}/numbers/{n}/audio.opus", get(number_audio_opus))
        .route("/{voice}/preview/audio", get(preview_audio))
        .route("/{voice}/{book}/{chapter}", get(marks))
        .route("/{voice}/{book}/{chapter}/audio", get(audio))
        .route("/{voice}/{book}/{chapter}/audio.opus", get(audio_opus))
}

// ---------------------------------------------------------------- the recorder (`berean tts-batch`)

/// Record every chapter in every voice, once. Resumable: a chapter whose .json exists is skipped. Run on the
/// server as the berean user with SPEECHIFY_API_KEY and BEREAN_DATA set; reads the plaintext scripture seed.
///   berean tts-batch [voice ...] [--only <book> [--chapter <n>]] [--redo]
/// `--redo` records a chapter again (the old .mp3/.json/.opus are moved aside as .bak-<unix time>): for a chapter
/// re-read without its brackets, say. Redo every chapter you mean to, one --only/--chapter at a time.
pub async fn batch(args: &[String]) -> anyhow::Result<()> {
    use std::time::{Duration, Instant};
    let key = std::env::var("SPEECHIFY_API_KEY").map_err(|_| anyhow::anyhow!("SPEECHIFY_API_KEY is not set"))?;
    let data = std::env::var("BEREAN_DATA").unwrap_or_else(|_| "data".into());
    let only_book: Option<i64> = args.iter().position(|a| a == "--only").and_then(|i| args.get(i + 1)).and_then(|s| s.parse().ok());
    // --from / --to (book numbers, inclusive) partition a voice across processes; each skips chapters already on disk
    let arg_num = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).and_then(|s| s.parse::<i64>().ok());
    let (from_book, to_book) = (arg_num("--from").unwrap_or(1), arg_num("--to").unwrap_or(66));
    let only_chapter = arg_num("--chapter");
    let redo = args.iter().any(|a| a == "--redo");
    if redo && (only_book.is_none() || only_chapter.is_none()) { anyhow::bail!("--redo needs --only <book> --chapter <n>") }
    let voices: Vec<&str> = { let v: Vec<&str> = args.iter().filter(|a| voice_ok(a)).map(|s| s.as_str()).collect(); if v.is_empty() { VOICES.iter().map(|(id, _, _)| *id).collect() } else { v } };
    let conn = rusqlite::Connection::open_with_flags(format!("{data}/scripture.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(300)).build()?;
    let mut chars_total = 0i64; let t0 = Instant::now();
    for voice in &voices {
        std::fs::create_dir_all(tts_dir().join(voice))?;
        // the numbers clip: "1." ... "176." each on its own line, so the marks slice cleanly per number
        let (nm, nj) = numbers_paths(voice);
        if !nj.exists() {
            let text: String = (1..=NUMBERS_MAX).map(|n| format!("{n}.\n")).collect();
            let (audio, marks, chars) = retry(|| synthesize(&client, &key, voice, &text)).await?;
            chars_total += chars;
            let mut off = 0usize; let mut out = Vec::new();
            for n in 1..=NUMBERS_MAX {
                let line = format!("{n}.\n");
                if let Some(m) = marks.iter().find(|m| (m.start as usize) >= off && (m.start as usize) < off + line.len()) { out.push(json!([n, m.start_time, m.end_time])); }
                off += line.len();
            }
            std::fs::write(&nm, &audio)?;
            std::fs::write(&nj, serde_json::to_vec(&json!({ "voice": voice, "numbers": out }))?)?;
            eprintln!("[{voice}] numbers: {} KB, {} marks", audio.len() / 1024, out.len());
        }
        for b in crate::books::BOOKS.iter() {
            if let Some(o) = only_book { if o != b.n as i64 { continue } }
            if (b.n as i64) < from_book || (b.n as i64) > to_book { continue }
            for c in 1..=b.chapters as i64 {
                if let Some(oc) = only_chapter { if oc != c { continue } }
                let (mp3, jpath) = chapter_paths(voice, b.n as i64, c);
                if jpath.exists() {
                    if !redo { continue }
                    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                    for p in [&mp3, &jpath, &mp3.with_extension("opus")] {
                        if !p.exists() { continue }
                        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
                        std::fs::rename(p, p.with_extension(format!("{ext}.bak-{ts}")))?;
                    }
                }
                let Some(ch) = crate::bible::get_chapter(&conn, &crate::edition::T1961, b.n as i64, c, false)? else { continue };
                let sc = script(b.name, &ch);
                let (audio, marks, chars, silent) = match synthesize_long(&client, &key, voice, &sc.text).await { Ok(x) => x, Err(e) => { eprintln!("[{voice}] {} {}: FAILED, skipped: {e}", b.abbr, c); continue } };
                let folded = fold_marks(voice, b.n as i64, c, &sc, &marks, &silent);
                chars_total += chars;
                std::fs::write(&mp3, &with_seek_table(&audio))?;
                std::fs::write(&jpath, serde_json::to_vec(&folded)?)?;
                let missing = folded.verses.iter().filter(|v| v.words.is_empty()).count();
                eprintln!("[{voice}] {} {}: {} KB, {} verses, {} without marks, {:.0}s audio, {} chars so far, {:.0} min", b.abbr, c, audio.len() / 1024, folded.verses.len(), missing, folded.duration as f64 / 1000.0, chars_total, t0.elapsed().as_secs_f64() / 60.0);
            }
        }
    }
    eprintln!("done: {chars_total} billable characters in {:.0} min", t0.elapsed().as_secs_f64() / 60.0);
    Ok(())
}

/// Speechify rate-limits and occasionally 5xxs; back off and try again a few times before giving up.
async fn retry<T, F, Fut>(mut f: F) -> anyhow::Result<T> where F: FnMut() -> Fut, Fut: std::future::Future<Output = anyhow::Result<T>> {
    let mut wait = 5u64;
    let mut attempt = 0;
    loop {
        attempt += 1;
        match f().await {
            Ok(v) => return Ok(v),
            Err(e) if is_policy(&e) => return Err(e),
            // out of credits: nothing to skip, just wait for the top-up (the recorders run unattended for hours)
            Err(e) if is_credits(&e) => { eprintln!("  no Speechify credits, waiting 5 min: {e}"); tokio::time::sleep(std::time::Duration::from_secs(300)).await; attempt -= 1; continue }
            Err(e) if attempt < 6 => { eprintln!("  retry {attempt} after {wait}s: {e}"); tokio::time::sleep(std::time::Duration::from_secs(wait)).await; wait *= 2; }
            Err(e) => return Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn brackets_leave_the_script_and_marks_land_on_the_printed_text() {
        // "the things [we have] heard": spoken "the things we have heard"; each word's mark maps back to the page
        let display = "the things [we have] heard";
        let mut spoken = String::new(); let mut removed = Vec::new();
        for (i, ch) in display.char_indices() { if ch == '[' || ch == ']' { removed.push(i) } else { spoken.push(ch) } }
        assert_eq!(spoken, "the things we have heard");
        for w in ["the", "things", "we", "have", "heard"] {
            let off = spoken.find(w).unwrap();
            let want = display.find(w).unwrap();
            assert_eq!(display_off(&removed, off), want, "{w}");
        }
        assert_eq!(display_off(&[], 7), 7);
    }
    #[test]
    fn byte_ranges() {
        use ByteRange::*;
        assert_eq!(byte_range(None, 100), Whole);
        assert_eq!(byte_range(Some("bytes=0-1"), 100), Span(0, 1));
        assert_eq!(byte_range(Some("bytes=10-"), 100), Span(10, 99));
        assert_eq!(byte_range(Some("bytes=90-500"), 100), Span(90, 99));
        assert_eq!(byte_range(Some("bytes=-30"), 100), Span(70, 99));
        assert_eq!(byte_range(Some("bytes=-500"), 100), Span(0, 99));
        assert_eq!(byte_range(Some("bytes=100-"), 100), Unsatisfiable);
        assert_eq!(byte_range(Some("bytes=-0"), 100), Unsatisfiable);
        assert_eq!(byte_range(Some("bytes=0-"), 0), Unsatisfiable);
        assert_eq!(byte_range(Some("bytes=5-1"), 100), Whole);
        assert_eq!(byte_range(Some("bytes=0-1,5-9"), 100), Whole);
        assert_eq!(byte_range(Some("items=0-1"), 100), Whole);
        assert_eq!(byte_range(Some("bytes=x-"), 100), Whole);
    }
}
