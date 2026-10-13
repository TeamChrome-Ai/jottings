# Contributing

Thank you for wanting to help. Two things to know before you send a change.

## Your change takes the project's licence, including its change to MIT

`LICENSING.md` sets the terms: the code is AGPL-3.0-only, and each release also becomes MIT one year after it is
published. A change you offer here is licensed the same way: AGPL-3.0-only at once, and MIT from the Change Date of
the first release that contains it, and you cannot take that back later. If you cannot agree to both, say so
plainly in the pull request: a change offered under the AGPL alone can still be taken in, but it is listed in
`LICENSING.md` and keeps every release that contains it from becoming MIT as a whole, so expect it to be declined
unless it is worth that.

Say so in each commit by signing it off (`git commit -s`), which adds:

```
Signed-off-by: Your Name <you@example.org>
```

With that line you certify the Developer Certificate of Origin 1.1 (https://developercertificate.org): the change is
yours to give, or you have the right to pass it on under these terms.

## What is not open to change by pull request

- The scripture text, the notes and the ministry are other people's work and are corrected only against their
  printed sources (`data/corrections.json` shows how).
- The name, the icon and the wordmark (`TRADEMARK.md`).

## Before you send it

`npm test`, `npm run typecheck`, and in `rs/` `cargo test`. `STYLE.md` describes how the code and its comments are
written.
