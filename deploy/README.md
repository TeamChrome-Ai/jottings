# Deploying

The server is one binary plus two SQLite files. A small VM is enough. The API idles at about 60 MB of memory.

## Install

Build the release binary and the databases first. Then, from the machine that has them:

```bash
scp -r rs/target/release/berean data/scripture.db data/ministry.db deploy/install.sh deploy/berean.service ubuntu@HOST:/tmp/deploy/
ssh ubuntu@HOST sudo bash /tmp/deploy/install.sh SITE_HOSTNAME
```

`SITE_HOSTNAME` is the public hostname. Caddy uses it to get a certificate. It should match `host` in
`shared/brand.json`.

`install.sh` does the following:

- creates a `berean` user
- installs the binary and the seed database
- enables the systemd unit
- installs Caddy and writes its Caddyfile

It never overwrites an existing user database. Running it again only upgrades the binary.

`ministry.db` holds the ministry library and its verse index. It is read-only. To update it, copy a rebuilt file to
`/var/lib/berean/ministry.db` and restart the service. Without it the library is empty.

## Settings

The unit reads its settings from `/etc/berean.env`. Restart with `systemctl restart berean` after editing it.

| Variable | What it does |
|---|---|
| `BEREAN_PROD=1` | Secure cookies, no CORS |
| `BEREAN_DATA=/var/lib/berean` | Where the databases live |
| `BEREAN_GOOGLE_CLIENT_IDS=<web>,<android>,<ios>` | Turns on Google sign-in |
| `BEREAN_DB_KEY` | Encrypts the user database. See below. |
| `BEREAN_MOD_WORKER_TOKEN` | Shared secret for the report judge worker |
| `BEREAN_MOD_TIMEOUT_SECS` | How long a report waits for the judge before it goes to an admin. Default 900. |
| `BEREAN_MOD_WEBHOOK` | Slack or Discord webhook that receives everything queued for moderation |

## Moderation

There are two layers.

The first is an automatic scan. The server scans group posts when they are created, shared notes whenever they are
shared or edited, and every report when it arrives. The rules and word lists are in `rs/moderation/`, and
`rs/src/rules.rs` explains each key. They are compiled into the binary, so changing them means a rebuild and a
redeploy. If the rules file can't be read, the server refuses to start and names the rule at fault.

The second is the report judge. A worker in `tools/mod-worker/` answers queued reports with an AI model. It polls
`GET /api/mod/jobs` with the worker token. If no worker answers within the timeout, the report goes to the site
admin.

In the categories that the rules allow, the judge can ban. A ban suspends the account immediately. It also marks the
person's IP addresses, devices and sign-in identity, so they can't just sign up again. See `rs/src/bans.rs`. An
admin confirms or undoes the ban in the app's moderation queue.

The IP rule assumes Caddy is the only proxy in front of the server. If you put another proxy in front, such as a
CDN, every visitor will appear to share its addresses. Fix `bans::Seen` before you do that.

## Encryption at rest

Set `BEREAN_DB_KEY` to 64 hex characters. `openssl rand -hex 32` makes one. The user database is then a SQLCipher
file, and the server refuses to start in production without the key.

On the first start after you set the key, the server encrypts an existing plaintext `berean.db` in place and keeps
the old copy as `berean.db.plaintext.bak`. Check that sign-in works, then delete that file with `shred -u`.

If you lose the key you lose every account. Keep a copy of `/etc/berean.env` somewhere safe.
