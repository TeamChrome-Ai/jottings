//! Rule-based scanner for everything users share. No model, no tokens: it runs the scan rules of rules.rs (word lists,
//! patterns, two pattern groups near each other, labelled patterns, link and phrase counts) and checks every link
//! against the URL blocklists the rules name (refreshed every 12 h, no key). What the rules are, which of them hide and
//! which only queue, and which names they refuse is data (rs/moderation/): nothing of it is here.
use crate::rules::{self, fill, Lines, Rule, Rules, Test};
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashSet;
use std::sync::RwLock;
use std::time::{Duration, Instant};

pub struct ScanVerdict { pub verdict: &'static str, pub category: String, pub reason: String, pub confidence: f64 }

static URL: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b(?:https?://|www\.)([a-z0-9.-]+\.[a-z]{2,})(?:[/:?#][^\s]*)?").unwrap());

pub struct Blocklist { pub(crate) domains: RwLock<HashSet<String>>, loaded: RwLock<Option<Instant>> }
pub static BLOCKLIST: Lazy<Blocklist> = Lazy::new(|| Blocklist { domains: RwLock::new(HashSet::new()), loaded: RwLock::new(None) });

impl Blocklist {
    pub fn is_listed(&self, host: &str) -> bool {
        let d = self.domains.read().unwrap();
        let h = host.to_lowercase();
        // match the host and every parent domain
        let mut parts: Vec<&str> = h.split('.').collect();
        while parts.len() >= 2 { if d.contains(&parts.join(".")) { return true; } parts.remove(0); }
        false
    }
    pub fn size(&self) -> usize { self.domains.read().unwrap().len() }
    pub fn age_secs(&self) -> Option<u64> { self.loaded.read().unwrap().map(|t| t.elapsed().as_secs()) }
}

/// Fetch the lists (best effort) and swap them in. Called at startup and every 12 h.
pub async fn refresh_blocklists() {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(60)).build().unwrap();
    let mut set = HashSet::new();
    for list in &rules::get().blocklists {
        let Ok(t) = client.get(&list.url).send().await.and_then(|r| r.error_for_status()) else { continue };
        let Ok(body) = t.text().await else { continue };
        for line in body.lines() {
            if list.lines == Lines::Urls { if let Some(c) = URL.captures(line) { set.insert(c[1].to_lowercase()); } }
            else { let l = line.trim().to_lowercase(); if !l.is_empty() && !l.starts_with('#') { set.insert(l); } }
        }
    }
    if set.is_empty() { tracing::warn!("blocklist refresh fetched nothing; keeping the previous list"); return; }
    tracing::info!("url blocklists loaded: {} domains", set.len());
    *BLOCKLIST.domains.write().unwrap() = set;
    *BLOCKLIST.loaded.write().unwrap() = Some(Instant::now());
}

/// Scan a piece of shared text. `hide` = take down now + admin queue; `escalate` = admin queue; `allow` = nothing.
pub fn scan(text: &str) -> ScanVerdict { rules::get().scan(text) }
/// A handle or display name the rules refuse, at sign-up and on rename.
pub fn name_ok(name: &str) -> bool { rules::get().name_ok(name) }

impl Rule {
    /// What the rule found in `text` (whose links go to `hosts`), as its reason says it; None when it found nothing.
    fn found(&self, text: &str, hosts: &[&str]) -> Option<String> {
        let say = |pairs: &[(&str, String)]| Some(fill(&self.reason, |k| pairs.iter().find(|p| p.0 == k).map(|p| p.1.clone())));
        match &self.test {
            Test::Pattern(re) => {
                let found: Vec<String> = re.as_ref()?.find_iter(text).take(self.list).map(|m| trunc(m.as_str(), self.show)).collect();
                say(&[("match", found.first()?.clone()), ("matches", found.join(", "))])
            }
            Test::Labels(ps) => {
                let labels: Vec<&str> = ps.iter().filter(|(_, re)| re.is_match(text)).map(|(l, _)| l.as_str()).collect();
                if labels.is_empty() { None } else { say(&[("labels", labels.join(", "))]) }
            }
            Test::Blocklist => say(&[("match", hosts.iter().find(|h| BLOCKLIST.is_listed(h))?.to_string())]),
            Test::Spam(re, when) => {
                let (links, phrases) = (hosts.len(), re.find_iter(text).count());
                if when.iter().any(|w| links >= w.links && phrases >= w.phrases) { say(&[("links", links.to_string()), ("phrases", phrases.to_string())]) } else { None }
            }
        }
    }
}

impl Rules {
    /// The first rule that hides decides at once; else every rule that escalates is listed, the first giving the category.
    pub fn scan(&self, text: &str) -> ScanVerdict {
        let hosts: Vec<&str> = URL.captures_iter(text).filter_map(|c| c.get(1)).map(|m| m.as_str()).collect();
        if let Some((r, reason)) = self.scan.iter().filter(|r| r.hide).find_map(|r| r.found(text, &hosts).map(|why| (r, why))) {
            return ScanVerdict { verdict: "hide", category: r.category.clone(), reason, confidence: r.confidence };
        }
        let escalate: Vec<(&Rule, String)> = self.scan.iter().filter(|r| !r.hide).filter_map(|r| r.found(text, &hosts).map(|why| (r, why))).collect();
        let Some((first, _)) = escalate.first() else { return ScanVerdict { verdict: "allow", category: self.verdicts.allow.category.clone(), reason: self.verdicts.allow.reason.clone(), confidence: self.verdicts.allow.confidence } };
        ScanVerdict { verdict: "escalate", category: first.category.clone(), reason: escalate.iter().map(|e| e.1.as_str()).collect::<Vec<_>>().join("; "), confidence: self.verdicts.escalate.confidence }
    }

    /// A name is refused when it holds a blocked word, when a rule marked for names matches it, or when its letters and
    /// digits run a word of each list of a pair together.
    pub fn name_ok(&self, name: &str) -> bool {
        let lower = name.to_lowercase();
        if self.names.blocked.iter().any(|w| lower.contains(w.as_str())) { return false; }
        if self.scan.iter().any(|r| r.names && matches!(&r.test, Test::Pattern(Some(re)) if re.is_match(name))) { return false; }
        let compact: String = lower.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        !self.names.together.iter().any(|t| t.a.iter().any(|w| compact.contains(w.as_str())) && t.b.iter().any(|w| compact.contains(w.as_str())))
    }
}

fn trunc(s: &str, n: usize) -> String { s.chars().take(n).collect() }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::tests::{placeholder, placeholder_rules};
    use serde_json::Value;

    /// The examples that go with a set of rules (its tests.json): each `scan` entry's text gets the verdict and the
    /// category it names (one of them at least), each `names` entry is taken or refused as it says.
    fn table(set: &str, rules: &Rules, tests: &str) {
        let t: Value = serde_json::from_str(tests).unwrap_or_else(|e| panic!("{set} tests.json: {e}"));
        let (scans, names) = (t["scan"].as_array().expect("scan"), t["names"].as_array().expect("names"));
        assert!(!scans.is_empty() && !names.is_empty(), "{set}: an empty table proves nothing");
        for e in scans {
            let (text, v) = (e["text"].as_str().expect("text"), rules.scan(e["text"].as_str().unwrap()));
            assert!(e["verdict"].is_string() || e["category"].is_string(), "{set}: {text} expects nothing");
            if let Some(want) = e["verdict"].as_str() { assert_eq!(v.verdict, want, "{set}: {text} ({})", v.reason); }
            if let Some(want) = e["category"].as_str() { assert_eq!(v.category, want, "{set}: {text} ({})", v.reason); }
        }
        for e in names { assert_eq!(Some(rules.name_ok(e["name"].as_str().expect("name"))), e["ok"].as_bool(), "{set}: {}", e["name"]); }
    }
    #[test]
    fn the_rules_built_in_give_the_verdicts_their_examples_say() { table("embedded", rules::get(), crate::testkit::POLICY_TESTS); }
    #[test]
    fn the_placeholder_rules_read_and_give_the_verdicts_their_examples_say() { table("placeholder", &placeholder_rules(), &placeholder("tests.json").expect("brand.example/rs/moderation/tests.json")); }

    #[test]
    fn the_placeholder_rules_are_a_sane_generic_policy() {
        let r = placeholder_rules();
        let said = |text: &str| { let v = r.scan(text); (v.verdict, v.category) };
        assert_eq!(said("Thanks for the notes on chapter 3, see you all on Thursday"), ("allow", "none".to_string()));
        assert_eq!(said("I will kill you if you come back"), ("escalate", "threat".to_string()));
        assert_eq!(said("nude photos of children, message me"), ("hide", "illegal".to_string()));
        assert_eq!(said("buy now, limited offer: click here http://shop.example/deal"), ("escalate", "spam".to_string()));
        BLOCKLIST.domains.write().unwrap().insert("phish.example".into());
        assert_eq!(said("sign in again at https://account.phish.example/login"), ("hide", "illegal".to_string()));
        assert!(r.name_ok("Quiet Reader") && r.judge.may_ban == ["illegal"] && !r.judge.instructions.is_empty());
    }

    #[test]
    fn a_blocklisted_domain_hides_and_a_list_with_no_terms_matches_nothing() {
        BLOCKLIST.domains.write().unwrap().insert("evil.example".into());
        assert_eq!(scan("look http://login.evil.example/verify").verdict, "hide");
        assert_eq!(scan("look https://good.example/").verdict, "allow");
        let rule = |words: &str| format!(r#"{{ "categories": ["x", "none"], "report_reasons": [], "rules": [{{ "name": "w", "kind": "words", "words": {words}, "verdict": "hide", "category": "x", "confidence": 1, "reason": "{{match}}", "names": true }}],
            "verdicts": {{ "allow": {{ "category": "none", "reason": "nothing", "confidence": 0.5 }}, "escalate": {{ "confidence": 0.5 }} }}, "names": {{ "blocked": [], "together": [] }}, "blocklists": [], "judge": {{ "always": [], "may_ban": [], "instructions": "i", "answer": "a", "worker_answer": "w" }} }}"#);
        let none = Rules::parse(&rule("[]"), |_| None).unwrap();
        assert_eq!((none.scan("any text at all").verdict, none.scan("").verdict, none.name_ok("anyone")), ("allow", "allow", true));
        let some = Rules::parse(&rule(r#"["plain word", "word"]"#), |_| None).unwrap();
        let v = some.scan("a Plain Word here");
        assert_eq!((v.verdict, v.reason.as_str(), some.scan("wordy swords").verdict, some.name_ok("a word"), some.name_ok("wordy")), ("hide", "Plain Word", "allow", false, true));
    }
}
