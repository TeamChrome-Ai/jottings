# Jottings: the source

This is the code of [Jottings](https://jottingsbible.com), a reader for J. N. Darby's *New Translation* that works
offline: search with reference parsing, inline footnotes, word lookup, read-aloud, bookmarks and highlights, study
notes that can be shared and printed, a page-turning reader, reading streaks and small reading groups.

One Expo (React Native, expo-router) client in `client/` for Android, iOS and the web; a Rust server (axum, SQLite
with FTS5) in `rs/` that embeds the web build into one binary; shared TypeScript in `shared/`.

## What is here and what is not

Here: the code, under the terms in `LICENSING.md`.

Not here, on purpose:

- **The name and the artwork.** The app builds under a placeholder brand. Every brand value is in
  `shared/brand.json` and the artwork and legal pages are placeholder files: put your own there. "Jottings", its icon
  and its wordmark are not licensed to you (`TRADEMARK.md`).
- **The texts.** No scripture, notes, ministry or dictionary is included, and neither are the converters that made
  them. `data/` and `client/public/bible1890/` hold empty stand-ins so the code builds; `npm run data` builds the
  database and the chapter files from whatever you put under `data/` in the same shapes.
- **The moderation rules.** `rs/moderation/` holds a small generic rule set. The rules a real service runs are its
  own.
- **The history.** This repository starts at its first public release.

## Licence

GNU Affero General Public License, version 3 (`LICENSE`). Each release also becomes available under the MIT License
one year after it is published. `LICENSING.md` has the terms and the dates; `CONTRIBUTING.md` says what sending a
change means.

## Run

```bash
npm install                     # installs the client's dependencies too
npm test && npm run typecheck   # the tests of the texts skip themselves while the texts are absent
npm run build                   # the web app, into client/dist, which the server embeds
npm run build:server            # the server and the data builder, in rs/target/release
```

That much works on a fresh clone. The rest needs the texts: put them under `data/`, then

```bash
npm run data                    # data/scripture.db and the chapter files, from the texts
npm run dev:api                 # the Rust API on :8787; without scripture.db it says so and stops
npm run dev                     # expo start --web
(cd rs && cargo test)           # some of the server's tests read scripture.db or the texts compiled in
```

The Android and iOS apps bundle the chapter files `npm run data` writes: built before it, they carry no text.
