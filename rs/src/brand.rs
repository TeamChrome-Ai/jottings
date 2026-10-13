//! The brand (docs/BRAND.md): the names, the address and the package the server says, from `shared/brand.json`,
//! embedded at compile time and read once. No other file of the server names any of them. A key that is missing, empty
//! or not text stops the server at start-up with the key's name: there is no default for any of them.
use once_cell::sync::Lazy;
use serde_json::Value;

pub struct Brand {
    /// `name`, and `storeName`: the title of a page that has none of its own
    pub name: String, pub store_name: String,
    /// `site`, with no slash at its end; `androidPackage`
    pub site: String, pub android_package: String,
    /// `androidCertFingerprints`: the signing certificates the site vouches for in assetlinks.json; none is allowed
    pub android_certs: Vec<String>,
    pub noun: Noun,
    /// The User-Agent of the link-preview fetcher (link_preview.rs): the name's letters and digits, then the site.
    pub agent: String,
}
/// `noun`: what a reader calls an outline. `a` and `a_cap` are `noun.one` with its article, inside a sentence and at its
/// start; `many` is `noun.many`.
pub struct Noun { pub many: String, pub a: String, pub a_cap: String }

static BRAND: Lazy<Brand> = Lazy::new(|| Brand::parse(include_str!("../../shared/brand.json")).unwrap_or_else(|e| panic!("shared/brand.json: {e}")));
pub fn get() -> &'static Brand { &BRAND }

impl Brand {
    pub fn parse(json: &str) -> Result<Brand, String> {
        let v: Value = serde_json::from_str(json).map_err(|e| format!("not JSON: {e}"))?;
        let text = |key: &str| v.pointer(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(String::from).ok_or_else(|| format!("the key {key} is missing or is not text"));
        let (name, site, one) = (text("/name")?, text("/site")?.trim_end_matches('/').to_string(), text("/noun/one")?);
        let article = if one.starts_with(|c: char| "aeiouAEIOU".contains(c)) { "an" } else { "a" };
        let agent = format!("{}LinkPreview/1.0 (+{site})", name.chars().filter(char::is_ascii_alphanumeric).collect::<String>());
        let android_certs = v.pointer("/androidCertFingerprints").and_then(Value::as_array).ok_or("the key /androidCertFingerprints is missing or is not a list")?
            .iter().map(|c| c.as_str().map(String::from).ok_or("/androidCertFingerprints holds something that is not text")).collect::<Result<Vec<_>, _>>()?;
        Ok(Brand { store_name: text("/storeName")?, android_package: text("/androidPackage")?, android_certs, agent,
            noun: Noun { many: text("/noun/many")?, a: format!("{article} {one}"), a_cap: format!("A{} {one}", &article[1..]) }, name, site })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_placeholder_brand_reads_and_says_its_own_names() {
        let b = Brand::parse(include_str!("../../brand.example/shared/brand.json")).unwrap();
        assert_eq!((b.name.as_str(), b.store_name.as_str(), b.site.as_str(), b.android_package.as_str()), ("Reader", "Reader - Darby Bible", "https://example.org", "org.example.reader"));
        assert_eq!(b.agent, "ReaderLinkPreview/1.0 (+https://example.org)");
        assert_eq!((b.noun.many.as_str(), b.noun.a.as_str(), b.noun.a_cap.as_str()), ("outlines", "an outline", "An outline"));
    }
    #[test]
    fn a_missing_key_is_named_and_nothing_is_defaulted() {
        let all = r#"{ "name": "My App", "storeName": "My App - Bible", "site": "https://app.example/", "androidPackage": "example.app", "androidCertFingerprints": ["AA:BB"], "noun": { "one": "note", "many": "notes" } }"#;
        let b = Brand::parse(all).unwrap();
        assert_eq!((b.agent.as_str(), b.site.as_str(), b.noun.a.as_str(), b.noun.a_cap.as_str()), ("MyAppLinkPreview/1.0 (+https://app.example)", "https://app.example", "a note", "A note"));
        assert_eq!(b.android_certs, ["AA:BB"]);
        for (key, said) in [("\"name\"", "/name"), ("\"storeName\"", "/storeName"), ("\"site\"", "/site"), ("\"androidPackage\"", "/androidPackage"), ("\"androidCertFingerprints\"", "/androidCertFingerprints"), ("\"one\"", "/noun/one"), ("\"many\"", "/noun/many")] {
            let e = Brand::parse(&all.replacen(key, "\"x\"", 1)).err().unwrap_or_default();
            assert!(e.contains(said), "{key}: {e}");
        }
        assert!(Brand::parse(&all.replace("\"My App\"", "\" \"")).is_err() && Brand::parse(&all.replace("\"example.app\"", "7")).is_err() && Brand::parse("{").is_err());
    }
    #[test]
    fn the_brand_embedded_reads() {
        let b = get();
        assert!(b.site.starts_with("https://") && !b.site.ends_with('/') && b.agent.ends_with(&format!("(+{})", b.site)) && b.noun.a_cap[1..] == b.noun.a[1..] && !b.noun.many.is_empty());
    }
}
