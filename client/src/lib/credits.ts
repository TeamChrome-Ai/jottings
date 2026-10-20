/**
 * Everything in the app that is not our own work, with its licence. Rendered by app/credits.tsx and, for the web,
 * by scripts/credits-html.mjs into public/credits.html (and credits-1890.html, which the server serves in its place
 * while the 1890 edition is on). Keep them in sync by editing only this file. Two sets: the 1961 edition's (CREDITS)
 * and the 1890 edition's (docs/EDITION.md), which has no 1961, CCEL or Coates entry.
 * Its imports are type-only but for the brand (shared/brand.ts) and the words (shared/i18n.ts): scripts/credits-html.mjs
 * runs this file in node, with scripts/brand.mjs resolving those. The font licences ship as text too:
 * client/assets/fonts/Literata-OFL.txt and OpenDyslexic-OFL.txt (the same OFL 1.1 body under each face's own notice).
 */
import { BRAND, NOUN, possessive } from '@shared/brand'
import { N_, peekLang, t, tc } from '@shared/i18n'
import type { Edition } from './editionCore'

/** The brand in the credits' words: `{brands}` is the English possessive; a translation names the app with `{brand}`. */
/** Read as each phrase is shown: the noun is in the app's language only once it is loaded. */
const brandVars = () => ({ brand: BRAND.name, brands: possessive(BRAND.name), many: NOUN.many, year: BRAND.copyrightYear, owner: BRAND.owner })
/** A phrase kept below (marked with N_) in the reader's language; a name or licence that is no phrase stays as it is. */
const tx = (s: string) => t(s, brandVars())

/** The one statement of which edition the app's text and notes come from: Credits lists it, About quotes it. */
export const EDITION = N_('Bible text: J. N. Darby’s New Translation (New Testament 1884, Old Testament 1890), the 1890 edition’s wording. Footnotes: the footnotes of the 1961 edition, revised and added to by its editors. Introductory notices: Mr. Darby’s own of 1871, 1884 and 1890, and the 1961 edition’s. Chronological table: the 1961 edition, as published by CCEL.')
export const FOOTNOTES = N_('The footnotes of the 1961 edition, revised and added to by its editors.')

/** The 1890 edition's statement. `ownText`: its text is from the 1884 and 1890 printings (data/darby_1890.json), not
 *  the published digital copy checked against them. */
export const edition1890 = (ownText: boolean) => (ownText
  ? t('Bible text: J. N. Darby’s New Translation (New Testament 1884, Old Testament 1890), from the 1884 and 1890 printings. Footnotes: Mr. Darby’s own notes, from the 1884 and 1890 printings. Introductory notices: Mr. Darby’s own, to the editions of 1871, 1884 and 1890.')
  : t('Bible text: J. N. Darby’s New Translation (New Testament 1884, Old Testament 1890), from a published digital copy of the text, checked against the 1884 and 1890 printings. Footnotes: Mr. Darby’s own notes, from the 1884 and 1890 printings. Introductory notices: Mr. Darby’s own, to the editions of 1871, 1884 and 1890.'))
export const editionStatement = (e: Edition, ownText: boolean) => (e === '1890' ? edition1890(ownText) : tx(EDITION))

/** `licenceUrl`: the licence text, when it is not a well-known one by name. */
export interface Credit { name: string; what: string; licence: string; url?: string; licenceUrl?: string; note?: string }
export interface CreditSection { title: string; items: Credit[] }

/** A credit as shown: each field is translated when it is read (at render), the English below being its key. */
const shown = ({ name, what, licence, note, ...links }: Credit): Credit => ({
  ...links,
  get name() { return tx(name) }, get what() { return tx(what) }, get licence() { return tx(licence) },
  get note() { return note === undefined ? undefined : tx(note) },
})

/** Mr. Darby's own notices, credited to the printings; shared by both editions' lists. */
const NOTICES: Credit = { name: N_('J. N. Darby’s introductory notices (1871, 1884, 1890)'), what: N_('His notices to the New Testament of 1884 and the Old Testament of 1890, and his preface to the New Testament of 1871, as the printings give them.'), licence: N_('Public domain') }

/** The 1961 edition's Scripture and notes, in English: the 1890 edition's list is cut from it by its words. */
const SCRIPTURE: Credit[] = [
  { name: 'J. N. Darby, The Holy Scriptures: A New Translation from the Original Languages', what: N_('The Bible text: the 1890 edition’s wording (New Testament 1884, Old Testament 1890).'), licence: N_('Public domain'), note: N_('Taken from a published digital copy of the text and checked verse by verse against a second copy; words split across lines are rejoined and four verse divisions follow the usual numbering.') },
  { name: 'ebible.org, engDBY', what: N_('The Strong’s numbers on the words, moved onto the words of this edition when the data is built.'), licence: N_('Public domain'), url: 'https://ebible.org/find/details.php?id=engDBY' },
  { name: 'La Sainte Bible, traduction J. N. Darby (JND v2.0, édition 2024)', what: N_('The French Bible and Darby’s French notes, from Bibles et Publications Chrétiennes’ public-domain edition, kept in the English verses with its own numbering.'), licence: N_('Public domain'), url: 'https://www.editeurbpc.com/telechargements/JND' },
  { name: 'Elberfelder Bibel, unrevidierte Ausgabe (J. N. Darby, Carl Brockhaus u. a.)', what: N_('The German Bible: the unrevised Elberfelder text of 1905 from eBible (deuelo), its footnotes from CrossWire’s GerElb1871, kept in the English verses with its own numbering.'), licence: N_('Public domain'), url: 'https://ebible.org/find/details.php?id=deuelo' },
  { name: N_('The 1961 edition: footnotes'), what: FOOTNOTES, licence: N_('Darby’s notes are public domain; the rights in the 1961 editors’ revisions and additions are the edition’s'), url: 'https://web.archive.org/web/19980514181543/http://bf.org/etexts/bibles/darbybib.zip', note: N_('The 8,834 lettered notes, from the Bible Foundation (bf.org) electronic text of 1998, acknowledged with thanks.') },
  { name: N_('The 1961 edition: introductory notice and chronological table, via the Christian Classics Ethereal Library (CCEL)'), what: N_('The 1961 edition’s own introductory notice, its chronological table of the kings and prophets, and its order of the prophets, as published by CCEL.'), licence: N_('Text of the 1961 edition; CCEL’s edition acknowledged with thanks'), url: 'https://www.ccel.org/bible/jnd/darby.htm' },
  NOTICES,
  { name: 'George Morrish, A New and Concise Bible Dictionary (1897)', what: N_('Text from Bible Truth Publishers’ online edition; public domain.'), licence: N_('Public domain'), url: 'https://bibletruthpublishers.com/concise-bible-dictionary/lrcl16000' },
  { name: 'James Strong, The Exhaustive Concordance of the Bible (1890)', what: N_('Word lookup’s entry for each Strong’s number: the Hebrew or Greek word, its transliteration and pronunciation, and its renderings in the King James Version. Strong’s definitions are not used; meanings come from Morrish’s dictionary.'), licence: N_('Public domain') },
  { name: N_('Open Scriptures, Strong’s dictionaries in XML'), what: N_('The digital text of Strong’s entries: the Hebrew edited by David Troidl and David Instone-Brewer, the Greek by Ulrik Petersen.'), licence: N_('Strong’s text public domain; the app’s file shared alike under CC BY-SA 4.0'), url: 'https://github.com/openscriptures/strongs', note: N_('Only Strong’s own fields are taken (data/strongs.json in the source); the Hebrew file’s Brown-Driver-Briggs outlines and TWOT numbers are not.') },
  { name: 'J. N. Darby, Synopsis of the Books of the Bible', what: N_('Ministry on a chapter and a verse, and in the library. Text from Bible Truth Publishers’ online edition.'), licence: N_('Public domain'), url: 'https://bibletruthpublishers.com/darby-synopsis-1-genesis-to-2-chronicles/lbd15307' },
  { name: N_('J. N. Darby (1800–1882), Collected Writings (ed. W. Kelly), Notes and Comments, Notes and Jottings, Letters, Miscellaneous Writings and other papers'), what: N_('Ministry on a verse, and the library. Text from Bible Truth Publishers’ online library, acknowledged with thanks.'), licence: N_('Public domain'), url: 'https://bibletruthpublishers.com/collected-writings-of-j-n-darby-ecclesiastical-1/lbd15226' },
  { name: N_('J. B. Stoney (1814–1897) and F. E. Raven (1837–1903), their ministry'), what: N_('Ministry on a verse, and the library.'), licence: N_('Public domain') },
  { name: N_('G. V. Wigram (1805–1879) and J. G. Bellett (1795–1864), their writings'), what: N_('Ministry on a verse, and the library: their books and papers. Text from Bible Truth Publishers’ online library, acknowledged with thanks.'), licence: N_('Public domain'), url: 'https://bibletruthpublishers.com/memorials-of-the-ministry-of-g-v-wigram-1-volume-1/g-v-wigram/lbd15145' },
  { name: N_('C. A. Coates (1862–1945), the Outlines of the books of the Bible and his addresses'), what: N_('Ministry on a chapter and a verse, and in the library.'), licence: N_('Public domain'), url: 'https://archive.org/search?query=creator%3A%22C.+A.+Coates%22'},
]

export const CREDITS: CreditSection[] = [
  { get title() { return t('Scripture and notes') }, items: SCRIPTURE.map(shown) },
  { get title() { return t('Voices') }, items: [
    { name: 'Speechify', what: N_('Voices powered by Speechify: the three voices (Alec, Beatrice, Dominic) and their word timings. Synthesized through Speechify’s text-to-speech; the recordings are made and served by {brand}.'), licence: N_('Commercial API'), url: 'https://speechify.com' },
  ].map(shown) },
  { get title() { return tc('typefaces', 'Type') }, items: [
    { name: 'Literata', what: N_('The reading face for scripture, numerals and titles.'), licence: 'SIL Open Font License 1.1', url: 'https://github.com/googlefonts/literata', note: 'Copyright 2015–2020 The Literata Project Authors (TypeTogether for Google).' },
    { name: 'OpenDyslexic', what: N_('The dyslexia-friendly option in Settings → Text.'), licence: 'SIL Open Font License 1.1', url: 'https://opendyslexic.org', note: 'Copyright 2019 Abbie Gonzalez, with Reserved Font Name OpenDyslexic.' },
  ].map(shown) },
  { get title() { return t('Icons') }, items: [
    { name: 'Material Symbols (Rounded)', what: N_('The interface icons, inlined as vector paths rather than an icon font.'), licence: 'Apache License 2.0', url: 'https://fonts.google.com/icons', licenceUrl: 'https://www.apache.org/licenses/LICENSE-2.0', note: 'Copyright Google LLC.' },
  ].map(shown) },
  { get title() { return t('Safety lists (server side)') }, items: [
    { name: N_('LDNOOBW English word list'), what: N_('One tier of the rule scanner that checks shared posts and {many}.'), licence: 'CC BY 4.0', url: 'https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' },
    { name: 'Phishing Army', what: N_('Phishing-domain blocklist, refreshed twice a day.'), licence: 'CC BY-NC 4.0, Andrea Draghetti', url: 'https://phishing.army', licenceUrl: 'https://creativecommons.org/licenses/by-nc/4.0/' },
  ].map(shown) },
  { get title() { return t('Open-source software') }, items: [
    { name: N_('React Native, React, Expo and expo-router'), what: N_('The app framework for Android, iOS and web.'), licence: 'MIT', url: 'https://expo.dev' },
    { name: 'react-native-svg, react-native-reanimated, react-native-gesture-handler, react-native-screens, react-native-safe-area-context', what: N_('Vector icons, page-turn animation, gestures and navigation.'), licence: 'MIT', url: 'https://github.com/software-mansion' },
    { name: 'axum, tokio, tower-http, reqwest, serde', what: N_('The Rust server.'), licence: 'MIT / Apache-2.0', url: 'https://github.com/tokio-rs/axum' },
    { name: N_('rusqlite and SQLite'), what: N_('Storage and full-text search.'), licence: N_('MIT (rusqlite); public domain (SQLite)'), url: 'https://github.com/rusqlite/rusqlite' },
    { name: 'SQLCipher', what: N_('Encryption of the server database at rest.'), licence: 'BSD-3-Clause, © Zetetic LLC', url: 'https://www.zetetic.net/sqlcipher/', licenceUrl: 'https://www.zetetic.net/sqlcipher/license/' },
    { name: 'QR Code generator library (Project Nayuki)', what: N_('The QR code encoder behind the friend-invite code on your profile, adapted in shared/qr.ts.'), licence: 'MIT', url: 'https://www.nayuki.io/page/qr-code-generator-library', note: 'Copyright © Project Nayuki.' },
    { name: 'Brotli', what: N_('Compression of the web app and scripture bundles.'), licence: 'MIT', url: 'https://github.com/google/brotli' },
    { name: N_('argon2, jsonwebtoken, rust-embed and the rest of the Cargo and npm dependency trees'), what: N_('Password hashing, Google sign-in verification, static asset embedding and everything else.'), licence: N_('MIT / Apache-2.0 / BSD; see the lockfiles in the source'), url: 'https://github.com/' },
  ].map(shown) },
  { title: BRAND.name, items: [
    { name: N_('The {brand} name and mark'), what: N_('The app’s code is free and open source: anyone may use, change and share it, and a changed version that is shared or run as a service must share its source too. A year after each release is published, that release becomes free for any use. The name {brand}, the app icon and the wordmark are not part of that licence: they are © {year} {owner}, all rights reserved, so a copy or a changed version needs its own name and icon.'), licence: N_('Code: GNU AGPL 3.0, and MIT one year after each release. Name and artwork: all rights reserved') },
  ].map(shown) },
]

/** The 1890 edition's Scripture and notes. */
function scripture1890(ownText: boolean): Credit[] {
  const keep = SCRIPTURE.filter(i => i !== NOTICES && !/1961|CCEL|Coates|Stoney|Raven|^J\. N\. Darby, The Holy Scriptures/.test(`${i.name} ${i.what} ${i.licence} ${i.note ?? ''}`))
  return [
    { name: N_('J. N. Darby, The Holy Scriptures, New Testament 1884, Old Testament 1890'), what: ownText ? N_('The Bible text, from the 1884 and 1890 printings.') : N_('The Bible text, from a published digital copy of the text, checked against the 1884 and 1890 printings.'), licence: N_('Public domain') },
    { name: N_('J. N. Darby’s notes'), what: N_('Mr. Darby’s own notes, from the 1884 and 1890 printings.'), licence: N_('Public domain') },
    NOTICES,
    ...keep,
  ].map(shown)
}
/** The credits of the edition shown. `ownText`: the 1890 edition has its own text (client/public/bible1890/meta.json). */
export function creditsFor(e: Edition, ownText: boolean): CreditSection[] {
  if (e === '1961') return CREDITS
  return CREDITS.map((s, i) => (i === 0 ? { ...s, items: scripture1890(ownText) } : s))
}
/** The line under the credits: what anyone may copy, and what keeps its own terms. */
export const creditsFootnote = (e: Edition) => e === '1890'
  ? t('The Bible text of Darby’s translation (1884, 1890) and his notes are public domain: you may copy and share them freely. That does not extend to the ministry, which keeps the terms of its editions. {brands} own code is free software under the MIT License.', brandVars())
  : t('The Bible text of Darby’s translation (1884, 1890) is public domain: you may copy and share it freely. That does not extend to the 1961 edition’s footnotes, notices and table, or to the ministry, which keep the terms of their editions. {brands} own code is free software under the MIT License.', brandVars())

/** The pages the app links beside the credits; the server answers each path with its .html (rs/src/static.rs). */
/** The pages translated into each language but English (client/public/<page>-<lang>.html; the English governs). */
const TRANSLATED_PAGES = ['/privacy', '/terms', '/account-deletion']
/** A legal page in the app's language where it has been translated (Canadian French reads the French), else the English. */
export function policyPath(path: string): string {
  const l = peekLang(), own = l === 'fr-CA' ? 'fr' : l
  return own !== 'en' && TRANSLATED_PAGES.includes(path) ? `${path}-${own}` : path
}
export const POLICY_LINKS: { path: string; label: string }[] = [
  { path: '/privacy', label: N_('Privacy policy') },
  { path: '/terms', label: N_('Terms of use') },
  { path: '/copyright', label: N_('Copyright notices') },
  { path: '/third-party.txt', label: N_('Every package and its licence') },
]

/** OpenDyslexic's own OFL notice (client/assets/fonts/OpenDyslexic-OFL.txt); the licence body below it is the one OFL_TEXT carries. */
export const OPENDYSLEXIC_OFL_NOTICE = 'Copyright (c) 2019-07-29, Abbie Gonzalez (https://abbiecod.es|support@abbiecod.es), with Reserved Font Name OpenDyslexic. Copyright (c) 12/2012 - 2019.'
/** The SIL Open Font License 1.1, as shipped with Literata (client/assets/fonts/Literata-OFL.txt); OpenDyslexic is under the same licence. */
export const OFL_TEXT = `Copyright 2017 The Literata Project Authors (https://github.com/googlefonts/literata)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
`
