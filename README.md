# Jottings

Source code for [Jottings](https://jottingsbible.com), an offline reader for J. N. Darby's New Translation of the
Bible. It runs on Android, iOS and the web.

The app does these things:

- Search by word or by reference
- Footnotes shown inline, and word lookup
- Read-aloud
- Bookmarks, highlights and study notes you can share or print
- A page-turning reader
- Reading streaks and small reading groups

## What's in this repo

The client is an Expo app in `client/`, built with React Native and expo-router. The server is Rust in `rs/`, using
axum and SQLite with FTS5. It embeds the web build, so the whole service ships as one binary. Code used by both lives
in `shared/`.

## What's not in this repo

This is the code only. Four things are left out on purpose.

**The brand.** The app builds as "Reader" with grey placeholder artwork. The Jottings name, icon and wordmark are
trademarks and are not licensed. See `TRADEMARK.md`. To use your own brand, edit `shared/brand.json` and replace the
placeholder images and legal pages.

**The texts.** There is no scripture, notes, ministry or dictionary here. `data/` and `client/public/bible1890/`
contain empty files so the build works. To get an app with content, put your own texts in `data/` in the same file
formats and run `npm run data`.

**The moderation rules.** `rs/moderation/` has a small generic rule set. The live service runs its own.

**The history.** The repo starts at the first public release, 1.0.4.

## Getting started

These work on a fresh clone:

```bash
npm install                     # also installs the client's dependencies
npm test && npm run typecheck   # tests that need the texts skip themselves
npm run build                   # builds the web app into client/dist
npm run build:server            # builds the server into rs/target/release
```

The rest needs texts in `data/`:

```bash
npm run data                    # builds data/scripture.db and the chapter files
npm run dev:api                 # runs the API on port 8787
npm run dev                     # runs the web app with Expo
(cd rs && cargo test)           # 18 of the server's tests read the texts
```

Without `scripture.db` the server prints one line saying so and exits. The Android and iOS apps bundle the chapter
files that `npm run data` writes, so build them after it.

## License

AGPL-3.0. One year after each release is published, that release also becomes available under the MIT License.
`LICENSING.md` has the terms and the dates.

## Contributing

Read `CONTRIBUTING.md` first. Sending a change here licenses it on the same terms.
