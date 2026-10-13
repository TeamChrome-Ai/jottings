//! Canonical book table (mirrors shared/books.ts).
pub struct Book { pub n: u8, pub name: &'static str, pub abbr: &'static str, pub osis: &'static str, pub chapters: u8, pub aliases: &'static [&'static str] }

macro_rules! b { ($n:expr, $name:expr, $abbr:expr, $osis:expr, $ch:expr, [$($a:expr),*]) => { Book { n: $n, name: $name, abbr: $abbr, osis: $osis, chapters: $ch, aliases: &[$($a),*] } }; }

pub static BOOKS: [Book; 66] = [
    b!(1,"Genesis","Gen","Gen",50,["ge","gn"]), b!(2,"Exodus","Ex","Exod",40,["exo","exod"]), b!(3,"Leviticus","Lev","Lev",27,["le","lv"]),
    b!(4,"Numbers","Num","Num",36,["nu","nm","nb"]), b!(5,"Deuteronomy","Deut","Deut",34,["dt","de"]), b!(6,"Joshua","Josh","Josh",24,["jos","jsh"]),
    b!(7,"Judges","Judg","Judg",21,["jdg","jg","jdgs"]), b!(8,"Ruth","Ruth","Ruth",4,["ru","rth"]), b!(9,"1 Samuel","1 Sam","1Sam",31,["1sa","1sm","1s"]),
    b!(10,"2 Samuel","2 Sam","2Sam",24,["2sa","2sm","2s"]), b!(11,"1 Kings","1 Kgs","1Kgs",22,["1ki","1kg","1k"]), b!(12,"2 Kings","2 Kgs","2Kgs",25,["2ki","2kg","2k"]),
    b!(13,"1 Chronicles","1 Chr","1Chr",29,["1ch","1chron"]), b!(14,"2 Chronicles","2 Chr","2Chr",36,["2ch","2chron"]), b!(15,"Ezra","Ezra","Ezra",10,["ezr"]),
    b!(16,"Nehemiah","Neh","Neh",13,["ne"]), b!(17,"Esther","Esth","Esth",10,["es","est"]), b!(18,"Job","Job","Job",42,["jb"]),
    b!(19,"Psalms","Ps","Ps",150,["psa","psalm","pss","psm"]), b!(20,"Proverbs","Prov","Prov",31,["pr","prv","pro"]), b!(21,"Ecclesiastes","Eccl","Eccl",12,["ec","ecc","qoh"]),
    b!(22,"Song of Songs","Song","Song",8,["sos","ss","canticles","songofsolomon","cant"]), b!(23,"Isaiah","Isa","Isa",66,["is"]), b!(24,"Jeremiah","Jer","Jer",52,["je","jr"]),
    b!(25,"Lamentations","Lam","Lam",5,["la"]), b!(26,"Ezekiel","Ezek","Ezek",48,["eze","ezk"]), b!(27,"Daniel","Dan","Dan",12,["da","dn"]),
    b!(28,"Hosea","Hos","Hos",14,["ho"]), b!(29,"Joel","Joel","Joel",3,["jl"]), b!(30,"Amos","Amos","Amos",9,["am"]),
    b!(31,"Obadiah","Obad","Obad",1,["ob"]), b!(32,"Jonah","Jonah","Jonah",4,["jnh","jon"]), b!(33,"Micah","Mic","Mic",7,["mc"]),
    b!(34,"Nahum","Nah","Nah",3,["na"]), b!(35,"Habakkuk","Hab","Hab",3,["hb"]), b!(36,"Zephaniah","Zeph","Zeph",3,["zep","zp"]),
    b!(37,"Haggai","Hag","Hag",2,["hg"]), b!(38,"Zechariah","Zech","Zech",14,["zec","zc"]), b!(39,"Malachi","Mal","Mal",4,["ml"]),
    b!(40,"Matthew","Matt","Matt",28,["mt","mat"]), b!(41,"Mark","Mark","Mark",16,["mk","mr","mrk"]), b!(42,"Luke","Luke","Luke",24,["lk","lu"]),
    b!(43,"John","John","John",21,["jn","jhn","joh"]), b!(44,"Acts","Acts","Acts",28,["ac","act"]), b!(45,"Romans","Rom","Rom",16,["ro","rm"]),
    b!(46,"1 Corinthians","1 Cor","1Cor",16,["1co","1cor"]), b!(47,"2 Corinthians","2 Cor","2Cor",13,["2co","2cor"]), b!(48,"Galatians","Gal","Gal",6,["ga"]),
    b!(49,"Ephesians","Eph","Eph",6,["ep"]), b!(50,"Philippians","Phil","Phil",4,["php","pp","phil"]), b!(51,"Colossians","Col","Col",4,["co"]),
    b!(52,"1 Thessalonians","1 Thess","1Thess",5,["1th","1thes"]), b!(53,"2 Thessalonians","2 Thess","2Thess",3,["2th","2thes"]),
    b!(54,"1 Timothy","1 Tim","1Tim",6,["1ti","1tm"]), b!(55,"2 Timothy","2 Tim","2Tim",4,["2ti","2tm"]), b!(56,"Titus","Titus","Titus",3,["ti","tit"]),
    b!(57,"Philemon","Phlm","Phlm",1,["phm","pm","philem"]), b!(58,"Hebrews","Heb","Heb",13,["he"]), b!(59,"James","Jas","Jas",5,["jm","jam"]),
    b!(60,"1 Peter","1 Pet","1Pet",5,["1pe","1pt","1p"]), b!(61,"2 Peter","2 Pet","2Pet",3,["2pe","2pt","2p"]), b!(62,"1 John","1 John","1John",5,["1jn","1jo","1j"]),
    b!(63,"2 John","2 John","2John",1,["2jn","2jo","2j"]), b!(64,"3 John","3 John","3John",1,["3jn","3jo","3j"]), b!(65,"Jude","Jude","Jude",1,["jd","jud"]),
    b!(66,"Revelation","Rev","Rev",22,["re","rv","apocalypse","revelations"]),
];

fn norm(s: &str) -> String {
    let mut k: String = s.to_lowercase().chars().filter(|c| !c.is_whitespace() && *c != '.').collect();
    for (p, r) in [("first", "1"), ("second", "2"), ("third", "3"), ("1st", "1"), ("2nd", "2"), ("3rd", "3")] {
        if k.starts_with(p) { k = format!("{}{}", r, &k[p.len()..]); break; }
    }
    // roman numerals i/ii/iii before a letter
    if k.starts_with("iii") && k[3..].starts_with(|c: char| c.is_alphabetic()) { k = format!("3{}", &k[3..]); }
    else if k.starts_with("ii") && k[2..].starts_with(|c: char| c.is_alphabetic()) { k = format!("2{}", &k[2..]); }
    else if k.starts_with('i') && k[1..].starts_with(|c: char| c.is_alphabetic()) && !k.starts_with("is") && !k.starts_with("isa") { k = format!("1{}", &k[1..]); }
    k
}

pub fn find_book(text: &str) -> Option<&'static Book> {
    let k = norm(text);
    if k.is_empty() { return None; }
    for b in BOOKS.iter() {
        if norm(b.name) == k || norm(b.abbr) == k || norm(b.osis) == k || b.aliases.iter().any(|a| *a == k) { return Some(b); }
    }
    if k.len() < 2 { return None; }
    BOOKS.iter().find(|b| norm(b.name).starts_with(&k))
}

pub fn book(n: i64) -> Option<&'static Book> { if (1..=66).contains(&n) { Some(&BOOKS[(n - 1) as usize]) } else { None } }
