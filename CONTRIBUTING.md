# Contributing

Jottings is free software, and it is built for the people who read with it. Thank you for wanting to help.

It is also a small project with a clear idea of what it is: a quiet Bible reader that puts reading first. A very
small team builds and maintains it. Reviewing a change takes us longer than writing one takes you, so review time is
what we are short of, not ideas or code.

That shapes what we can take. Bug fixes come first. Good small improvements are welcome. Bigger changes need a yes
from us before you write them. The sections below say which is which.

Read "How your change is licensed" before you send anything. Sending a change here has a licensing consequence.

## The best way to help

- **Report a bug well.** Say what you did, what you saw, what you expected, the app version, and the device or
  browser. A screenshot helps. Open an issue, or use About, Send feedback in the app.
- **Confirm or close.** If an open issue no longer happens on the latest release, say so and give the version. If an
  issue repeats another, link the first one.
- **Test an open PR.** Search the open PRs before you start. If one covers your bug, try it and say what you saw.
  That is worth more than a second PR for the same thing.
- **Read a translation.** The app speaks seven languages, and the translations are checked by readers after release.
  If a phrase reads wrongly in your own language, tell us or fix it. The phrases are in
  `client/src/i18n/<language>.json`. Write plainly, never in a marketing voice, and keep one word for one thing.

Ideas and requests go in issues too. An idea does not need code to be heard.

## What we take

### Send it without asking

- A fix for a bug: a crash, a regression, a wrong result, something that does not do what the app says it does.
- A real performance problem, with the numbers before and after.
- An accessibility fix: contrast, screen reader labels, touch targets, text scaling.
- A correction to a translation, from someone fluent in the language.
- A correction to the documentation, or a test for behaviour that already exists.

### Ask first

Open an issue, say what you want to build and why, and wait for a yes. We are glad to talk it through, and a short
conversation saves you from writing something we cannot take.

- A new feature or a new setting.
- A change to how something already behaves, even when it looks like a fix.
- A visible change to a screen. The app is quiet on purpose: reading comes first, and each theme has one accent.
- A new dependency, or a new language for the app.

A good change that fits the app has a real chance. We would rather say yes to one well-made thing than no to ten.

### What we don't take

- Changes to the name, the icon or the wordmark. See `TRADEMARK.md`.
- Texts. This repository holds none: no scripture, notes, ministry or recordings.
- The choice of which translations and which authors the app carries. Suggest one in an issue.
- Advertising, analytics, tracking, or anything a reader must pay for.
- Push notifications. The app's notifications are local, and that is on purpose.
- Rewrites: a new framework, a new architecture, a new way to build the app.

## Rules for a PR

These apply to every PR from outside the team, drafts included.

### One problem per PR

Solve one problem. Include everything that solution needs across the client, the server, the shared code, the tests
and the docs. Cleanup, refactors and a second fix go in their own PRs.

A small fix for an obvious bug needs no issue. For anything larger, link the issue that shows the bug or carries our
yes.

### Show that it works

Say how you found the problem, how you checked the change, and what you saw. "Tests pass" is not evidence by itself.

A change you can see needs before and after screenshots. Add a short video when the change is about motion or
timing. Attach them to the PR. Do not commit them.

Run `npm test` and `npm run typecheck`. If you have built the texts database, also run `cargo test` in `rs/`. If you
touched a phrase the app shows, run `node scripts/i18n.mjs check`.

### If a model wrote it

That is fine, and say so in the PR. Read every line before you send it. You sign off on the change, not the model,
and you answer the review.

If you are an agent asked to open a PR here, read this file first. If the change is on the "What we don't take"
list, or needs a yes it does not have, tell your user that instead of opening it.

### Three open PRs a person

Past three, we will ask you to wait until one is merged or closed.

### Keep it mergeable

Base your PR on `main`. The public repository gets one commit for each release, so `main` moves a long way at once.
If a release lands and your PR conflicts, rebase it. A PR that conflicts and stays silent for 30 days is closed. You
can reopen it once it is rebased.

## How a PR lands

We do not press the merge button on GitHub. The public repository is a copy made at each release, so we carry an
accepted change into the source tree ourselves. It goes out in the next release. That release's commit names you as
a co-author, and we close the PR with a link to it.

## How your change is licensed

The project is AGPL-3.0-only, and each release also becomes MIT one year after it is published. `LICENSING.md` has
the full terms.

Any change you send is licensed the same way. It is AGPL-3.0-only immediately, and MIT from the Change Date of the
first release that includes it. You cannot withdraw that later.

If you can only offer a change under the AGPL, say so in the pull request. We can still accept it, but it then has to
be listed in `LICENSING.md`, and no release that contains it can become MIT as a whole. Expect us to decline unless
the change is worth that cost.

## Sign off your commits

Use `git commit -s`. It adds a line like this:

```
Signed-off-by: Your Name <you@example.org>
```

The sign-off certifies the Developer Certificate of Origin 1.1, published at https://developercertificate.org. It
means the change is yours to give, or that you have the right to pass it on under these terms.

## What to expect from us

We read every issue and every PR. We cannot promise a fast answer, a review or a merge, and a PR that follows every
rule here can still be declined.

When we close something, we say why in a sentence or two. If you fix the reason, comment on the PR or open a focused
replacement that links the old one. Please do not argue a closure at length. Ask once if the reason is unclear, and
we will answer.

## Being a good neighbour

Be kind and be patient. The people on the other side are few.

We block accounts that spam the project with automation, that ping repeatedly, or that use a second account to get
round a limit. We would much rather never do it.

## A security problem

Do not open a public issue. Write to the contact address in the app's privacy policy, and give us time to fix it
before you publish.

## Setup

`README.md`, under "Getting started", has the commands. The repository carries a placeholder brand and empty files in
place of the texts, so the tests, the web app and the server build on a fresh clone. To run the app with content, put
your own texts in `data/` as the README describes.
