//! The moderation rules as data (docs/BRAND.md). What is hidden, what is queued, which names are refused, what a reader
//! may report, what the judge is told and what it may suspend an account for: all of it is `rs/moderation/rules.json`
//! and the word lists beside it, embedded at compile time, read and compiled once at start. This file is the schema
//! and holds nothing of the policy; scan.rs runs the scan rules and moderation.rs asks the judge. A rules file that
//! does not parse, a pattern that does not compile, a list that is not there, a category nobody declared: each stops
//! the server at start-up with the rule's name, never with no rules.
//!
//! `rules.json`:
//! - `categories`: every category a rule or the judge may name. `report_reasons`: what a reader may report under.
//! - `groups`: named pattern fragments; `{{name}}` in a pattern stands for the group of that name.
//! - `rules`: the scan, in order. Each has `name`, `kind`, `verdict` (`hide`, with its `confidence`, or `escalate`),
//!   `category` and `reason` (what the admin reads; `{..}` keys as below). `names: true` also refuses a handle or a
//!   display name the rule matches. Every pattern is matched without regard to case. The kinds:
//!   - `pattern`: one `pattern`. `{match}` is what it found, cut to `show` characters.
//!   - `words`: the terms of `file` (one a line, `#` comments) or of `words`, whole words only. `{match}`, or
//!     `{matches}`: the first `list` terms found (one, when it gives no `list`). A list with no terms matches nothing.
//!   - `near`: the groups `a` and `b` within `gap` words of each other, either way round, or any pattern of `or`.
//!   - `labels`: `patterns`, each with a `label`. `{labels}` are those that matched.
//!   - `blocklist`: a link to a host on the URL blocklists (`blocklists`: `url`, and `lines`: `urls` or `hosts`).
//!   - `spam`: counts links and the phrases of `pattern`; fires on any entry of `when` (`links` and `phrases`: at
//!     least so many of each). `{links}`, `{phrases}`.
//! - `verdicts`: what the scan says when nothing matched (`allow`), and how sure an `escalate` is.
//! - `names`: `blocked`, refused anywhere in a name; `together`, pairs of word lists: a name that runs a word of `a`
//!   and a word of `b` together (letters and digits only) is refused.
//! - `judge`: `instructions` and the answer format (`answer` for the inline judge, `worker_answer` for the worker),
//!   `always`: the scan categories sent on to the judge whatever the scan decided; `may_ban`: the categories a judge
//!   may suspend an account for.
use once_cell::sync::Lazy;
use regex::{Regex, RegexBuilder};
use rust_embed::Embed;
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Embed)]
#[folder = "moderation/"]
#[exclude = "tests.json"]
#[exclude = "LICENSE.txt"]
struct Files;

pub struct Rules { pub report_reasons: Vec<String>, pub scan: Vec<Rule>, pub verdicts: Verdicts, pub names: Names, pub blocklists: Vec<Blocklist>, pub judge: Judge }
pub struct Rule { pub test: Test, pub hide: bool, pub category: String, pub confidence: f64, pub reason: String, pub show: usize, pub list: usize, pub names: bool }
pub enum Test { /** None: a word list with no terms */ Pattern(Option<Regex>), Labels(Vec<(String, Regex)>), Blocklist, Spam(Regex, Vec<When>) }
#[derive(Deserialize)] #[serde(deny_unknown_fields)] pub struct When { #[serde(default)] pub links: usize, #[serde(default)] pub phrases: usize }
#[derive(Deserialize)] #[serde(deny_unknown_fields)] pub struct Verdicts { pub allow: Allow, pub escalate: Escalate }
#[derive(Deserialize)] #[serde(deny_unknown_fields)] pub struct Allow { pub category: String, pub reason: String, pub confidence: f64 }
#[derive(Deserialize)] #[serde(deny_unknown_fields)] pub struct Escalate { pub confidence: f64 }
#[derive(Deserialize)] #[serde(deny_unknown_fields)] pub struct Names { pub blocked: Vec<String>, pub together: Vec<Together> }
#[derive(Deserialize)] #[serde(deny_unknown_fields)] pub struct Together { pub a: Vec<String>, pub b: Vec<String> }
#[derive(Deserialize)] #[serde(deny_unknown_fields)] pub struct Blocklist { pub url: String, pub lines: Lines }
#[derive(Deserialize, PartialEq)] #[serde(rename_all = "lowercase")] pub enum Lines { Urls, Hosts }
#[derive(Deserialize)] #[serde(deny_unknown_fields)] pub struct Judge { pub always: Vec<String>, pub may_ban: Vec<String>, pub instructions: String, pub answer: String, pub worker_answer: String }

#[derive(Deserialize)] #[serde(deny_unknown_fields)]
struct File { #[serde(rename = "about")] _about: Option<String>, categories: Vec<String>, report_reasons: Vec<String>, #[serde(default)] groups: BTreeMap<String, String>, rules: Vec<serde_json::Value>, verdicts: Verdicts, names: Names, blocklists: Vec<Blocklist>, judge: Judge }
#[derive(Deserialize)] #[serde(deny_unknown_fields)]
struct RawRule { #[serde(rename = "name")] _name: String, kind: String, verdict: String, category: String, reason: String, confidence: Option<f64>, #[serde(default)] names: bool, show: Option<usize>, list: Option<usize>,
    pattern: Option<String>, file: Option<String>, words: Option<Vec<String>>, a: Option<String>, b: Option<String>, gap: Option<usize>, or: Option<Vec<String>>, patterns: Option<Vec<Labelled>>, when: Option<Vec<When>> }
#[derive(Deserialize)] #[serde(deny_unknown_fields)] struct Labelled { label: String, pattern: String }

static RULES: Lazy<Rules> = Lazy::new(|| {
    let text = |name: &str| Files::get(name).and_then(|f| String::from_utf8(f.data.into_owned()).ok());
    let json = text("rules.json").unwrap_or_else(|| panic!("rs/moderation/rules.json is not there"));
    Rules::parse(&json, text).unwrap_or_else(|e| panic!("rs/moderation/rules.json: {e}"))
});
/// The rules this server was built with. The first call reads and compiles them: main.rs makes it at start-up.
pub fn get() -> &'static Rules { &RULES }

/// One whole-word pattern of a list's terms, the longest first so a phrase wins over a word inside it.
fn word_alternation(terms: &mut Vec<String>) -> Option<Result<Regex, regex::Error>> {
    if terms.is_empty() { return None }
    terms.sort_by_key(|t| std::cmp::Reverse(t.len()));
    Some(RegexBuilder::new(&format!(r"(?i)\b(?:{})\b", terms.join("|"))).case_insensitive(true).build())
}

/// The `{key}`s a text names.
fn keys(template: &str) -> Vec<&str> {
    template.split('{').skip(1).filter_map(|s| s.split_once('}').map(|(k, _)| k)).filter(|k| !k.is_empty() && k.bytes().all(|b| b.is_ascii_lowercase())).collect()
}

/// `template` with each `{key}` as `say` gives it, in one pass: nothing of a text under review is read as a key.
pub fn fill(template: &str, say: impl Fn(&str) -> Option<String>) -> String {
    let (mut out, mut rest) = (String::with_capacity(template.len() + 32), template);
    while let Some(i) = rest.find('{') {
        out += &rest[..i];
        let after = &rest[i + 1..];
        match after.split_once('}').and_then(|(k, tail)| say(k).map(|v| (v, tail))) {
            Some((v, tail)) => { out += &v; rest = tail; }
            None => { out.push('{'); rest = after; }
        }
    }
    out + rest
}

impl Rules {
    /// `json` is rules.json; `file` gives a word list by its name.
    pub fn parse(json: &str, file: impl Fn(&str) -> Option<String>) -> Result<Rules, String> {
        let f: File = serde_json::from_str(json).map_err(|e| e.to_string())?;
        let declared = |what: &str, c: &str| if f.categories.iter().any(|k| k == c) { Ok(()) } else { Err(format!("{what}: the category \"{c}\" is not in `categories`")) };
        let mut scan = Vec::with_capacity(f.rules.len());
        for (i, raw) in f.rules.iter().enumerate() {
            let said = raw.get("name").and_then(|n| n.as_str()).map_or_else(|| format!("rule {}", i + 1), |n| format!("rule \"{n}\""));
            scan.push(rule(raw, &f.groups, &file).and_then(|r| declared("its category", &r.category).map(|()| r)).map_err(|e| format!("{said}: {e}"))?);
        }
        declared("verdicts.allow", &f.verdicts.allow.category)?;
        for c in &f.judge.always { declared("judge.always", c)?; }
        for c in &f.judge.may_ban { declared("judge.may_ban", c)?; }
        for (what, s) in [("judge.instructions", &f.judge.instructions), ("judge.answer", &f.judge.answer), ("judge.worker_answer", &f.judge.worker_answer)] { if s.trim().is_empty() { return Err(format!("{what} is empty")) } }
        // an empty word is in every name
        let lower = |what: &str, ws: &[String]| ws.iter().map(|w| { let w = w.trim().to_lowercase(); if w.is_empty() { Err(format!("{what} holds an empty word")) } else { Ok(w) } }).collect::<Result<Vec<_>, _>>();
        let mut together = Vec::with_capacity(f.names.together.len());
        for t in &f.names.together { together.push(Together { a: lower("names.together", &t.a)?, b: lower("names.together", &t.b)? }); }
        let names = Names { blocked: lower("names.blocked", &f.names.blocked)?, together };
        if f.report_reasons.iter().any(|r| r.trim().is_empty()) { return Err("report_reasons holds an empty reason".into()) }
        Ok(Rules { report_reasons: f.report_reasons, scan, verdicts: f.verdicts, names, blocklists: f.blocklists, judge: f.judge })
    }
}

fn rule(raw: &serde_json::Value, groups: &BTreeMap<String, String>, file: &impl Fn(&str) -> Option<String>) -> Result<Rule, String> {
    let r: RawRule = serde_json::from_value(raw.clone()).map_err(|e| e.to_string())?;
    let group = |name: &str| groups.get(name).ok_or_else(|| format!("there is no group \"{name}\""));
    // `{{name}}` is a group; whatever is left of one is a name that is not there
    let whole = |p: &str| {
        let mut p = p.to_string();
        for (k, v) in groups { p = p.replace(&format!("{{{{{k}}}}}"), v); }
        match p.split_once("{{") { Some((_, rest)) => Err(format!("there is no group \"{}\"", rest.split("}}").next().unwrap_or(rest))), None => Ok(p) }
    };
    let compile = |p: &str| RegexBuilder::new(p).case_insensitive(true).build().map_err(|e| format!("its pattern does not compile: {e}"));
    let need = |what: &str, v: &Option<String>| v.clone().ok_or_else(|| format!("a \"{}\" rule needs `{what}`", r.kind));
    let (test, gives): (Test, &[&str]) = match r.kind.as_str() {
        "pattern" => (Test::Pattern(Some(compile(&whole(&need("pattern", &r.pattern)?)?)?)), &["match", "matches"]),
        "words" => {
            let mut terms: Vec<String> = match (&r.file, &r.words) {
                (Some(name), None) => file(name).ok_or_else(|| format!("the list {name} is not in rs/moderation"))?.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')).map(regex::escape).collect(),
                (None, Some(ws)) => ws.iter().map(|w| w.trim()).filter(|w| !w.is_empty()).map(regex::escape).collect(),
                _ => return Err("a \"words\" rule needs `file` or `words`, one of them".into()),
            };
            (Test::Pattern(word_alternation(&mut terms).transpose().map_err(|e| format!("its list does not compile: {e}"))?), &["match", "matches"])
        }
        "near" => {
            let (a, b, gap) = (group(&need("a", &r.a)?)?, group(&need("b", &r.b)?)?, r.gap.ok_or("a \"near\" rule needs `gap`")?);
            let mut p = format!(r"\b{a}\b(?:\W+\w+){{0,{gap}}}?\W+{b}\b|\b{b}\b(?:\W+\w+){{0,{gap}}}?\W+{a}\b");
            for also in r.or.iter().flatten() { p += "|"; p += &whole(also)?; }
            (Test::Pattern(Some(compile(&p)?)), &["match", "matches"])
        }
        "labels" => {
            let ps = r.patterns.as_ref().filter(|ps| !ps.is_empty()).ok_or("a \"labels\" rule needs `patterns`")?;
            (Test::Labels(ps.iter().map(|l| Ok((l.label.clone(), compile(&whole(&l.pattern)?).map_err(|e| format!("\"{}\": {e}", l.label))?))).collect::<Result<_, String>>()?), &["labels"])
        }
        "blocklist" => (Test::Blocklist, &["match"]),
        "spam" => {
            let when = r.when.filter(|w| !w.is_empty() && w.iter().all(|w| w.links + w.phrases > 0)).ok_or("a \"spam\" rule needs `when`, each entry with `links` or `phrases` above 0")?;
            (Test::Spam(compile(&whole(&need("pattern", &r.pattern)?)?)?, when), &["links", "phrases"])
        }
        k => return Err(format!("there is no kind \"{k}\"")),
    };
    if let Some(k) = keys(&r.reason).into_iter().find(|k| !gives.contains(k)) { return Err(format!("its reason says {{{k}}}, which a \"{}\" rule does not give", r.kind)) }
    if r.names && !matches!(test, Test::Pattern(_)) { return Err(format!("`names` is for a rule of one pattern, not a \"{}\" rule", r.kind)) }
    let hide = match r.verdict.as_str() { "hide" => true, "escalate" => false, v => return Err(format!("its verdict is \"{v}\": hide or escalate")) };
    let confidence = match (hide, r.confidence) { (true, Some(c)) => c, (true, None) => return Err("a rule that hides needs `confidence`".into()), (false, Some(_)) => return Err("`confidence` is for a rule that hides; `verdicts.escalate` has the other".into()), (false, None) => 0.0 };
    Ok(Rule { test, hide, category: r.category, confidence, reason: r.reason, show: r.show.unwrap_or(usize::MAX), list: r.list.unwrap_or(1).max(1), names: r.names })
}

#[cfg(test)]
pub mod tests {
    use super::*;
    /// The placeholder rules of the public copy (brand.example/), read from the tree: both sets are tried in one build.
    pub fn placeholder(name: &str) -> Option<String> { std::fs::read_to_string(format!("{}/../brand.example/rs/moderation/{name}", env!("CARGO_MANIFEST_DIR"))).ok() }
    pub fn placeholder_rules() -> Rules { Rules::parse(&placeholder("rules.json").expect("brand.example/rs/moderation/rules.json"), placeholder).unwrap() }

    #[test]
    fn a_reason_is_filled_in_one_pass() {
        let say = |k: &str| match k { "match" => Some("{links} {match}".to_string()), "links" => Some("2".into()), _ => None };
        assert_eq!(fill("a \"{match}\" b {links} {other} {", say), "a \"{links} {match}\" b 2 {other} {");
        assert_eq!(keys("x {match} {Not} {} {links}, {a b}"), ["match", "links"]);
    }

    #[test]
    fn every_category_a_judge_may_ban_for_is_one_the_rules_declare_and_the_judge_is_told() {
        let embedded = String::from_utf8(Files::get("rules.json").unwrap().data.into_owned()).unwrap();
        for (set, r, json) in [("embedded", get(), embedded), ("placeholder", &placeholder_rules(), placeholder("rules.json").unwrap())] {
            let categories: Vec<String> = serde_json::from_value(serde_json::from_str::<serde_json::Value>(&json).unwrap()["categories"].clone()).unwrap();
            assert!(!r.judge.may_ban.is_empty(), "{set}");
            for c in &r.judge.may_ban {
                assert!(categories.contains(c), "{set}: {c} is not a category");
                for (what, text) in [("instructions", &r.judge.instructions), ("answer", &r.judge.answer), ("worker_answer", &r.judge.worker_answer)] { assert!(text.contains(c.as_str()), "{set}: judge.{what} never says {c}"); }
            }
            for c in r.judge.always.iter().chain(r.scan.iter().map(|x| &x.category)).chain([&r.verdicts.allow.category]) { assert!(categories.contains(c), "{set}: {c}"); }
        }
    }

    #[test]
    fn rules_that_cannot_be_read_stop_with_the_name_of_the_rule() {
        let good = placeholder("rules.json").unwrap();
        let v: serde_json::Value = serde_json::from_str(&good).unwrap();
        let broken = |edit: &dyn Fn(&mut serde_json::Value)| { let mut v = v.clone(); edit(&mut v); Rules::parse(&v.to_string(), placeholder).err().unwrap_or_default() };
        let first = v["rules"].as_array().unwrap().iter().position(|r| r["kind"] == "pattern").unwrap();
        let name = v["rules"][first]["name"].as_str().unwrap().to_string();
        for (edit, says) in [
            (Box::new(|v: &mut serde_json::Value| v["rules"][first]["pattern"] = "(unclosed".into()) as Box<dyn Fn(&mut serde_json::Value)>, "does not compile"),
            (Box::new(|v| v["rules"][first]["pattern"] = "{{nobody}} said".into()), "no group \"nobody\""),
            (Box::new(|v| v["rules"][first]["kind"] = "guess".into()), "no kind \"guess\""),
            (Box::new(|v| v["rules"][first]["verdict"] = "ban".into()), "hide or escalate"),
            (Box::new(|v| v["rules"][first]["category"] = "nonesuch".into()), "\"nonesuch\" is not in `categories`"),
            (Box::new(|v| v["rules"][first]["reason"] = "found {labels}".into()), "{labels}"),
            (Box::new(|v| v["rules"][first]["extra"] = 1.into()), "extra"),
            (Box::new(|v| { v["rules"][first]["kind"] = "words".into(); v["rules"][first]["file"] = "no_such_list.txt".into(); v["rules"][first].as_object_mut().unwrap().remove("pattern"); }), "no_such_list.txt is not in rs/moderation"),
        ] {
            let e = broken(&*edit);
            assert!(e.contains(&format!("rule \"{name}\"")) && e.contains(says), "{says}: {e}");
        }
        assert!(broken(&|v| v["judge"]["may_ban"] = serde_json::json!(["nonesuch"])).contains("judge.may_ban: the category \"nonesuch\""));
        assert!(broken(&|v| v["names"]["blocked"] = serde_json::json!([" "])).contains("names.blocked holds an empty word"));
        assert!(broken(&|v| v["judge"]["instructions"] = "".into()).contains("judge.instructions is empty"));
        assert!(broken(&|v| { v.as_object_mut().unwrap().remove("judge"); }).contains("judge"));
        assert!(Rules::parse("{", placeholder).is_err() && Rules::parse("", placeholder).is_err());
    }
}
