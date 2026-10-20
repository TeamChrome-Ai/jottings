/**
 * The books' names in each language the app speaks (docs/LANGUAGES.md): the name a heading shows, the short form a tight
 * place shows, and the name a reference is written with where that differs ("Psaume 23" of the book "Psaumes"). French
 * follows Darby's French edition, German the Elberfelder, Dutch the Statenvertaling's spellings, Swedish the modern
 * numbered forms. Canadian French writes them as French does.
 */
export type NamesLang = 'en' | 'fr' | 'de' | 'nl' | 'sv'
/** name, short form, and the reference name when it is not the name. */
export type BookName = [name: string, abbr: string, ref?: string]

const fr: BookName[] = [
  ['Genèse', 'Gn'], ['Exode', 'Ex'], ['Lévitique', 'Lv'], ['Nombres', 'Nb'], ['Deutéronome', 'Dt'], ['Josué', 'Jos'], ['Juges', 'Jg'], ['Ruth', 'Rt'],
  ['1 Samuel', '1 S'], ['2 Samuel', '2 S'], ['1 Rois', '1 R'], ['2 Rois', '2 R'], ['1 Chroniques', '1 Ch'], ['2 Chroniques', '2 Ch'], ['Esdras', 'Esd'],
  ['Néhémie', 'Né'], ['Esther', 'Est'], ['Job', 'Jb'], ['Psaumes', 'Ps', 'Psaume'], ['Proverbes', 'Pr'], ['Ecclésiaste', 'Ec'],
  ['Cantique des cantiques', 'Ct', 'Cantique'], ['Ésaïe', 'És'], ['Jérémie', 'Jr'], ['Lamentations', 'Lm'], ['Ézéchiel', 'Éz'], ['Daniel', 'Dn'],
  ['Osée', 'Os'], ['Joël', 'Jl'], ['Amos', 'Am'], ['Abdias', 'Ab'], ['Jonas', 'Jon'], ['Michée', 'Mi'], ['Nahum', 'Na'], ['Habakuk', 'Ha'],
  ['Sophonie', 'So'], ['Aggée', 'Ag'], ['Zacharie', 'Za'], ['Malachie', 'Ml'],
  ['Matthieu', 'Mt'], ['Marc', 'Mc'], ['Luc', 'Lc'], ['Jean', 'Jn'], ['Actes', 'Ac'], ['Romains', 'Rm'], ['1 Corinthiens', '1 Co'], ['2 Corinthiens', '2 Co'],
  ['Galates', 'Ga'], ['Éphésiens', 'Ép'], ['Philippiens', 'Ph'], ['Colossiens', 'Col'], ['1 Thessaloniciens', '1 Th'], ['2 Thessaloniciens', '2 Th'],
  ['1 Timothée', '1 Tm'], ['2 Timothée', '2 Tm'], ['Tite', 'Tt'], ['Philémon', 'Phm'], ['Hébreux', 'Hé'], ['Jacques', 'Jc'], ['1 Pierre', '1 P'],
  ['2 Pierre', '2 P'], ['1 Jean', '1 Jn'], ['2 Jean', '2 Jn'], ['3 Jean', '3 Jn'], ['Jude', 'Jd'], ['Apocalypse', 'Ap'],
]
const de: BookName[] = [
  ['1. Mose', '1. Mo'], ['2. Mose', '2. Mo'], ['3. Mose', '3. Mo'], ['4. Mose', '4. Mo'], ['5. Mose', '5. Mo'], ['Josua', 'Jos'], ['Richter', 'Ri'], ['Ruth', 'Rt'],
  ['1. Samuel', '1. Sam'], ['2. Samuel', '2. Sam'], ['1. Könige', '1. Kön'], ['2. Könige', '2. Kön'], ['1. Chronika', '1. Chr'], ['2. Chronika', '2. Chr'],
  ['Esra', 'Esra'], ['Nehemia', 'Neh'], ['Esther', 'Est'], ['Hiob', 'Hiob'], ['Psalmen', 'Ps', 'Psalm'], ['Sprüche', 'Spr'], ['Prediger', 'Pred'],
  ['Hohelied', 'Hld'], ['Jesaja', 'Jes'], ['Jeremia', 'Jer'], ['Klagelieder', 'Klgl'], ['Hesekiel', 'Hes'], ['Daniel', 'Dan'], ['Hosea', 'Hos'],
  ['Joel', 'Joel'], ['Amos', 'Amos'], ['Obadja', 'Obad'], ['Jona', 'Jona'], ['Micha', 'Mich'], ['Nahum', 'Nah'], ['Habakuk', 'Hab'], ['Zephanja', 'Zeph'],
  ['Haggai', 'Hag'], ['Sacharja', 'Sach'], ['Maleachi', 'Mal'],
  ['Matthäus', 'Mt'], ['Markus', 'Mk'], ['Lukas', 'Lk'], ['Johannes', 'Joh'], ['Apostelgeschichte', 'Apg'], ['Römer', 'Röm'], ['1. Korinther', '1. Kor'],
  ['2. Korinther', '2. Kor'], ['Galater', 'Gal'], ['Epheser', 'Eph'], ['Philipper', 'Phil'], ['Kolosser', 'Kol'], ['1. Thessalonicher', '1. Thes'],
  ['2. Thessalonicher', '2. Thes'], ['1. Timotheus', '1. Tim'], ['2. Timotheus', '2. Tim'], ['Titus', 'Tit'], ['Philemon', 'Phlm'], ['Hebräer', 'Heb'],
  ['Jakobus', 'Jak'], ['1. Petrus', '1. Pet'], ['2. Petrus', '2. Pet'], ['1. Johannes', '1. Joh'], ['2. Johannes', '2. Joh'], ['3. Johannes', '3. Joh'],
  ['Judas', 'Jud'], ['Offenbarung', 'Offb'],
]
const nl: BookName[] = [
  ['Genesis', 'Gen'], ['Exodus', 'Ex'], ['Leviticus', 'Lev'], ['Numeri', 'Num'], ['Deuteronomium', 'Deut'], ['Jozua', 'Joz'], ['Richteren', 'Richt'], ['Ruth', 'Ruth'],
  ['1 Samuël', '1 Sam'], ['2 Samuël', '2 Sam'], ['1 Koningen', '1 Kon'], ['2 Koningen', '2 Kon'], ['1 Kronieken', '1 Kron'], ['2 Kronieken', '2 Kron'],
  ['Ezra', 'Ezra'], ['Nehemia', 'Neh'], ['Esther', 'Est'], ['Job', 'Job'], ['Psalmen', 'Ps', 'Psalm'], ['Spreuken', 'Spr'], ['Prediker', 'Pred'],
  ['Hooglied', 'Hoogl'], ['Jesaja', 'Jes'], ['Jeremia', 'Jer'], ['Klaagliederen', 'Klaagl'], ['Ezechiël', 'Ezech'], ['Daniël', 'Dan'], ['Hosea', 'Hos'],
  ['Joël', 'Joël'], ['Amos', 'Am'], ['Obadja', 'Ob'], ['Jona', 'Jona'], ['Micha', 'Mi'], ['Nahum', 'Nah'], ['Habakuk', 'Hab'], ['Zefanja', 'Zef'],
  ['Haggaï', 'Hag'], ['Zacharia', 'Zach'], ['Maleachi', 'Mal'],
  ['Mattheüs', 'Matt'], ['Markus', 'Mark'], ['Lukas', 'Luk'], ['Johannes', 'Joh'], ['Handelingen', 'Hand'], ['Romeinen', 'Rom'], ['1 Korinthiërs', '1 Kor'],
  ['2 Korinthiërs', '2 Kor'], ['Galaten', 'Gal'], ['Efeziërs', 'Ef'], ['Filippenzen', 'Fil'], ['Kolossenzen', 'Kol'], ['1 Thessalonicenzen', '1 Thess'],
  ['2 Thessalonicenzen', '2 Thess'], ['1 Timotheüs', '1 Tim'], ['2 Timotheüs', '2 Tim'], ['Titus', 'Tit'], ['Filemon', 'Filem'], ['Hebreeën', 'Hebr'],
  ['Jakobus', 'Jak'], ['1 Petrus', '1 Petr'], ['2 Petrus', '2 Petr'], ['1 Johannes', '1 Joh'], ['2 Johannes', '2 Joh'], ['3 Johannes', '3 Joh'],
  ['Judas', 'Jud'], ['Openbaring', 'Openb'],
]
const sv: BookName[] = [
  ['1 Moseboken', '1 Mos'], ['2 Moseboken', '2 Mos'], ['3 Moseboken', '3 Mos'], ['4 Moseboken', '4 Mos'], ['5 Moseboken', '5 Mos'], ['Josua', 'Jos'],
  ['Domarboken', 'Dom'], ['Rut', 'Rut'], ['1 Samuelsboken', '1 Sam'], ['2 Samuelsboken', '2 Sam'], ['1 Kungaboken', '1 Kung'], ['2 Kungaboken', '2 Kung'],
  ['1 Krönikeboken', '1 Krön'], ['2 Krönikeboken', '2 Krön'], ['Esra', 'Esra'], ['Nehemja', 'Neh'], ['Ester', 'Est'], ['Job', 'Job'], ['Psaltaren', 'Ps'],
  ['Ordspråksboken', 'Ords'], ['Predikaren', 'Pred'], ['Höga visan', 'Höga v'], ['Jesaja', 'Jes'], ['Jeremia', 'Jer'], ['Klagovisorna', 'Klag'],
  ['Hesekiel', 'Hes'], ['Daniel', 'Dan'], ['Hosea', 'Hos'], ['Joel', 'Joel'], ['Amos', 'Am'], ['Obadja', 'Ob'], ['Jona', 'Jona'], ['Mika', 'Mika'],
  ['Nahum', 'Nah'], ['Habackuk', 'Hab'], ['Sefanja', 'Sef'], ['Haggai', 'Hagg'], ['Sakarja', 'Sak'], ['Malaki', 'Mal'],
  ['Matteus', 'Matt'], ['Markus', 'Mark'], ['Lukas', 'Luk'], ['Johannes', 'Joh'], ['Apostlagärningarna', 'Apg'], ['Romarbrevet', 'Rom'],
  ['1 Korinthierbrevet', '1 Kor'], ['2 Korinthierbrevet', '2 Kor'], ['Galaterbrevet', 'Gal'], ['Efesierbrevet', 'Ef'], ['Filipperbrevet', 'Fil'],
  ['Kolosserbrevet', 'Kol'], ['1 Tessalonikerbrevet', '1 Tess'], ['2 Tessalonikerbrevet', '2 Tess'], ['1 Timoteusbrevet', '1 Tim'],
  ['2 Timoteusbrevet', '2 Tim'], ['Titusbrevet', 'Tit'], ['Filemonbrevet', 'Filem'], ['Hebreerbrevet', 'Hebr'], ['Jakobsbrevet', 'Jak'],
  ['1 Petrusbrevet', '1 Petr'], ['2 Petrusbrevet', '2 Petr'], ['1 Johannesbrevet', '1 Joh'], ['2 Johannesbrevet', '2 Joh'], ['3 Johannesbrevet', '3 Joh'],
  ['Judasbrevet', 'Jud'], ['Uppenbarelseboken', 'Upp'],
]

/** Every language's names but English's, which live in books.ts with the parsing aliases. */
export const BOOK_NAMES: Record<Exclude<NamesLang, 'en'>, readonly BookName[]> = { fr, de, nl, sv }
/** More ways each language writes a book, for reading what a person types ("1 Moïse", "Offenbarung Johannes"). */
export const BOOK_ALIASES: Partial<Record<Exclude<NamesLang, 'en'>, Record<number, string[]>>> = {
  fr: { 1: ['gen'], 19: ['ps', 'psaume'], 22: ['cantique', 'cant'], 23: ['esaie', 'is', 'isaie'], 26: ['ezechiel', 'ez'], 66: ['apoc'] },
  de: { 1: ['1mo', '1mos', 'genesis'], 2: ['2mo', '2mos', 'exodus'], 3: ['3mo', '3mos'], 4: ['4mo', '4mos'], 5: ['5mo', '5mos'], 18: ['ijob'], 19: ['psalm'], 66: ['offenbarung', 'apk'] },
  nl: { 19: ['psalm'], 40: ['matteus', 'mattheus', 'mt'], 66: ['op', 'openb'] },
  sv: { 1: ['1mosebok'], 2: ['2mosebok'], 3: ['3mosebok'], 4: ['4mosebok'], 5: ['5mosebok'], 19: ['psalm', 'psalmerna'], 66: ['uppenbarelsen'] },
}
