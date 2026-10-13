# Contributing

Thanks for wanting to help. Read this first, because sending a change here has a licensing consequence.

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

## What we don't take by pull request

- Changes to the name, the icon or the wordmark. See `TRADEMARK.md`.
- Texts. This repository holds none.

## Before you send it

Run `npm test` and `npm run typecheck`. If you have built the texts database, also run `cargo test` in `rs/`.
