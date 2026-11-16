# A guide to {app}

What each screen and each setting does, in plain steps. It is written from the tour (`client/src/lib/tour.ts`), the
inventory in docs/SIMPLIFY.md and the screens themselves. Ask reads it, a section at a time, to answer questions about
the app (`app_guide` in rs/src/assistant.rs), so every routed screen and every row of Settings has a section; a test
(tests/assistantTools.test.ts) fails when one has none. The comment under a heading names the routes and the Settings
rows the section covers; the model is not shown it. Ask reads `{authors}` as the authors of the edition the server
serves (": J. N. Darby and C. A. Coates"), so it names no author that edition hides.

## Home
<!-- route: / -->

Home opens on today's verse, a new one each day; tap it, or Read the chapter, to open its chapter. Under it is Continue
reading, which opens the chapter where you left off (or your path, while one is on). Signed in, your streak card shows
your daily streak and the week; signed out, a card offers to sign in. Library lists Bookmarks, your {nouns}, the
Chronological table, the Dictionary and concordance, Ministry, Ask and Paths. Together has your friends and Reading
groups. The Theme strip changes the theme with one tap; All themes opens the gallery.

## Reading the Bible
<!-- route: /read /read/[book]/[chapter] -->

The Read tab keeps your place. The book and chapter at the top (▾) open the chapter picker: any book and chapter; hold
one to bookmark it. Swipe sideways, tap the edges, or pull on past the end of a chapter for the next. Darby's footnotes
open in place from the small letters. Tap a word to look it up: the Hebrew or Greek behind it (Strong's), its subject in
the dictionary, its footnotes, and the ministry that uses it.

Tap a verse to select it. The bar that opens has four highlight colours (twelve with More highlight colours on, in
Settings, Page), Clear, Copy, Bookmark, + {Noun}, Share, Listen, and Ministry when the ministry has something on it.
The toolbar has Read aloud, Theme, and More: text size a step at a time, Bookmark this chapter, Ministry on this
chapter, Paged mode and Reading settings (Settings, Text). Ask can open a chapter or a verse for you.

## Paged mode
<!-- route: /flip/[book]/[chapter] -->

Paged mode sets the chapter out as pages you turn, like a printed Bible. Open it from the reader's More menu, Paged
mode. Back to reading returns to the scrolling chapter; on the web it can go fullscreen.

## Read aloud
Read aloud reads the chapter with each word lit as it is read. Tap Read aloud in the reader's toolbar, or select verses
and tap Listen. The player bar has the verse before, pause and play, the verse after, the listening settings and stop.
The voice, speed and pauses are in Settings, Listening. Ask can start and stop reading aloud for you.

## Search
<!-- route: /search -->

Search, on the tab bar, finds verses. A reference such as Rom 8:28 opens the chapter; words find every verse with them,
in the whole Bible or one Testament. To search the ministry, open Ministry from Home and search there. While Ask is
available, a bubble marked Ask at the bottom right of Search opens it, with the words in the search field written in
its box for you to send.

## Stats
<!-- route: /stats -->

Stats shows your streak, today's reading and the week day by day, badges for milestones with any reactions from
friends, and progress through each book; Progress by book can mark a book's chapters read. It needs an account.

## Bookmarks
<!-- route: /bookmarks -->

Bookmarks lists your bookmarks, grouped as books, chapters and verses; tap one to open it. To add one, select a verse in
the reader and tap Bookmark, or hold a book or chapter in the chapter picker, or use More, Bookmark this chapter. Remove
one from its row. Signed out they are kept on this device; signed in they follow your account. Ask can open Bookmarks
and add a bookmark for you.

## {Nouns}
<!-- route: /outlines /outlines/[id] /outlines/[id]/edit /o/[code] -->

{Nouns} are your own studies and notes. Open them from Home, Library. New starts one with a title; or select verses in
the reader and tap + {Noun}. In the editor, add a passage by its reference, a note, a link or a heading; lines move up,
down and in, so points can sit under points. If the editor says the {noun} was changed somewhere else (on another
device, say), it has stopped saving so that nothing is written over: what you typed is still in front of you, and
Load it again shows the {noun} as it now is. Visibility makes one private or shared by its link; Print style and
Print / PDF print it at Bible-insert size or larger. A shared {noun} opens from its link for anyone; Publish puts it
among the public {nouns}. Signed out, {nouns} are kept on this device until you sign in to share them. Signed in, Ask
can list your {nouns}, read one, open one, make a new private one and change one for you; publishing, sharing by link
and deleting stay with you, on this screen and in the editor.

## Ministry
<!-- route: /companion -->

Ministry is the library of the written ministry{authors}. Open it
from Home. Search it by passage, title or words; a plain question gets other wordings to try. Continue reading returns to
the last work read. A work reads like the Bible: swipe or pull on for the next section, ▾ for its contents, A− and A+
for the size. In the reader, select a verse and tap Ministry to see what the writers said on it, best first. Ask
answers questions from this library, each sentence with the paragraphs it rests on.

## Ask
<!-- route: /ask -->

Ask answers a question about the Bible from the ministry library. A small number after a sentence is the paragraph it
rests on, and the sources are listed under the answer by author and work: tap a number or a source to open it. A
sentence with no source in the library is marked "no source". It also answers questions about the app, opens chapters
and screens, changes settings, reads aloud, adds bookmarks and highlights, and drafts feedback for you to send. It can
search the Bible for where something is said, and a reference in its answer, such as John 3:16, is a link: tap it to
open the verse. Going back returns to the conversation. Every change it makes shows a line with Undo. Write in the box
at the bottom of the screen and tap Send; Stop ends an answer on its way. Open it from Home, Ministry or the bubble on
Search. It needs an account, and answers a limited number of messages a day. What you write is sent to the AI model's
provider. New conversation, at the top of the screen, clears the conversation from the device. Ask cannot sign you
out, delete your account or data, or do anything about another person.

Ask also works with your own {nouns}, the ones kept with your account: ask what {nouns} you have on a subject, to
read one back or open it, to make a new one, or to add, change, move or take out lines of one. A new {noun} is
private. When you ask for one in your own words it is made at once. When Ask has read something first (the library,
the Bible, the dictionary, or one of your {nouns}), it shows you what it would make or change, each passage with its
words, and writes it only when you tap Apply; Not now writes nothing. When a note in it says what one of the
library's writers wrote, the line under the note is a link to the paragraph it rests on, named by its writer, its
work and its section: tap it, in what Ask shows you or later in the {noun}, to read the paragraph itself. Take your time over it: if you answer more than
an hour later, what you chose is still done, and Ask says it will not go on from there, so send a new message. Each {noun} it makes or changes shows a line
with Undo, and tapping the line opens the {noun}. Undo works while the {noun} is as Ask left it: once you have changed
it yourself, Undo says so and leaves your work alone. If the {noun} is open in the editor, you cannot type in it for the
moment Ask is writing to it: the editor says so, nothing you typed before is lost, and Ask's lines then appear with
yours. A {noun} that Ask reads is sent to the AI model's provider, as
its title is when Ask lists your {nouns}; if you never ask about them, none is sent. Ask cannot publish a {noun}, share
it by link, copy someone else's or delete one: do those from Home, Library, {Nouns}.

## Dictionary and concordance
<!-- route: /dictionary -->

Morrish's Concise Bible Dictionary, A to Z: search by headword, browse by letter, or open the New Testament synonyms.
An article shows its Greek and Hebrew words. Strong's concordance is reached by tapping a word in the reader. Open it
from Home, Library. Ask can look a word up and open its article.

## Chronological table
<!-- route: /chronology -->

Darby's table of the kings and prophets of Judah and Israel; every reference is a link to its chapter. Open it from Home,
Library.

## Paths
<!-- route: /paths -->

Paths are reading plans with no dates unless you set one: the whole Bible, a Testament, or other orders. Choose one and
Continue reading follows it. Open Paths from Home, Library.

## Themes
<!-- route: /themes -->
<!-- setting: theme -->

Twenty-five themes, in light, dark and true black. Tap one in the gallery to try it, or use the strip on Home. System
follows the device between a light theme and a dark one. Open it from Settings, Theme, or All themes on Home. Ask can
change the theme for you.

## Friends
<!-- route: /friends /friends/[id] /friends/contacts /friends/scan -->

Friends needs an account. Add a friend by their exact handle, or with your QR code (Show my code, Scan a code on a
phone); there is no search by name. Invites for you can be accepted or declined. A friend streak counts the days you both
meet your goal; a friend's page shows their reading, badges and reactions, with Remove friend and Block. Contacts finds
friends in your phone's contacts if you allow it. Ask does not act on friends.

## Reading groups
<!-- route: /groups /groups/[slug] -->

Reading groups are for a few reading together, once you sign in. Start a group and invite people with its code, or join
one with a code someone sent you. A group has its streak (the days every member met their own goal), its members, events
with their own leaderboards, and a feed of shared {nouns}. Ask does not act on groups.

## Profiles
<!-- route: /u/[handle] -->

A reader's profile: their name and picture, and, when they have made it public, their badges, reading totals and
streak. Report user and Block are on it.

## Sign in
<!-- route: /login -->

Sign in with a handle and password, or with Google, or create an account. Signing in keeps your bookmarks, highlights
and {nouns} with your account, and gives a streak, friends, groups and Ask.

## About the translation
<!-- route: /about -->

Darby's introductory notices and his note on dates. Open it from Settings, About.

## Credits and licences
<!-- route: /credits -->

The sources of the texts, fonts, icons, voices, AI models and open-source software, with their licences. Open it from
Settings, About.

## Acknowledgments
<!-- route: /acknowledgments -->

The people behind the app. Open it from Settings, About.

## Your data
<!-- route: /your-data -->

Back up your bookmarks, highlights and {nouns} to a file, restore one, or import a backup of the old Darby Bible app.
Signed in, it also deletes chosen categories of what the server holds. Open it from Settings, Account. Ask cannot
delete data.

## Settings
<!-- route: /settings -->

Settings is an index: your profile (or Sign in), then rows for Text, Page, Theme, Listening, Daily, Language, Motion,
Offline and About, each with a line saying how it is set; then Reset, which puts the text, page, theme, motion and
listening back as they came. Ask can open any of them, and change a setting for you.

## Settings: Text (typeface, size, spacing, adding a font)
<!-- route: /settings/text -->
<!-- setting: text -->

Text sets the typeface, the text size, the line height, and letter and word spacing, with a preview of the reading text
at the top. Open it from Settings, Text, or from the reader's Reading settings. The fonts are Serif, Sans and Dyslexic.

To add your own font: open Settings, Text, tap Add a font, then either type a Google Fonts family name as
fonts.google.com shows it and tap Add (its Regular, Bold and Italic are kept on the device), or choose From a file and
pick a .ttf or .otf file on the device. The new font appears beside the others; added fonts are removed under Fonts.
Ask can change the text size, line height, spacing and font for you, but cannot add a font.

## Settings: Page
<!-- route: /settings/page -->
<!-- setting: page -->

Page sets Paragraphs (on: verses run together in paragraphs; off: every verse starts on its own line), Verse numbers,
Footnote markers, Footnote letters (through the chapter, or as printed, starting again on each page of the 1961
edition), More highlight colours (eight more when you tap a verse), and, on a wide screen, the width and position of the
page.

## Settings: Listening
<!-- setting: listening -->

Listening sets the voice (AI voices, or the device's own voice, which reads offline), the speed, the pause between
verses, whether verse numbers and the book and chapter are said, whether each word is highlighted, and whether reading
continues into the next chapter. The AI voices read Darby's English translation: while you read the King James Version
or Young's Literal Translation they are not offered, and your device's own voice reads. Open it from Settings,
Listening, or from the player bar while it reads.

## Settings: Daily
<!-- route: /settings/daily -->
<!-- setting: daily -->

Daily sets your goal in minutes a day (the streak still counts at ten) and, on a phone, the streak reminder at a time
you choose and up to four morning verses. Open it from Settings, Daily.

## Settings: Language
<!-- setting: language -->

Language sets the app's language and the Bible you read, and a second Bible to show under or beside it, verse for
verse. The Bibles are listed under their languages: under English, Darby's translation, the King James Version and
Young's Literal Translation; Darby's French; the German Elberfelder. Darby's is the Bible read unless you choose
another. Footnotes, word lookup, the recorded voices and the ministry's verse links are Darby's and follow his text
whichever Bible you read; another Bible is read aloud by your device's own voice. Your highlights, notes and reading
stay with their verses whichever Bible you read; the ministry is in English. Open it from Settings, Language.

## Settings: Motion
<!-- route: /settings/motion -->
<!-- setting: motion -->

Motion has Reduce animation, which switches chapters and screens instantly, and Animation speed, for every motion in the
app. Open it from Settings, Motion.

## Settings: Offline
<!-- route: /settings/offline -->
<!-- setting: offline -->

On a phone, Offline downloads the Bible, the dictionary and the ministry so they read without a connection. Open it from
Settings, Offline.

## Settings: About
<!-- route: /settings/about -->
<!-- setting: about -->

About has About the translation, Credits and licences, Source code (a link to where the app's code is published, free
and open, when the app names a place), Acknowledgments, Send feedback (a fault, a wish or a kind word, to the
developer), and the Welcome and the Full tour again. Ask can draft feedback for you to read and send.

## Settings: Account (sign out, delete the account)
<!-- route: /settings/account -->
<!-- setting: account -->

Account has your picture and name, Friends, Public profile, Blocked users, Your data, Sign out and Delete account. To
sign out or to delete your account, open Settings, then Account. Ask cannot do either for you.

## Admin
<!-- route: /admin/feedback /admin/groups /admin/live /admin/reports -->

The owner's screens: feedback, all groups, live numbers and the moderation queue. Readers do not see them.
