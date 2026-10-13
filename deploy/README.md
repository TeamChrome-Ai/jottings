# Deploy

One t3.micro in us-east-2 is enough: the API idles in ~60 MB and every request is a prepared-statement lookup.

```bash
# from a machine with the release binary, data/scripture.db and data/ministry.db (npm run ministry)
scp -r rs/target/release/berean data/scripture.db data/ministry.db deploy/install.sh deploy/berean.service ubuntu@HOST:/tmp/bdb-deploy/
ssh ubuntu@HOST sudo bash /tmp/bdb-deploy/install.sh SITE_HOSTNAME   # for Caddy's certificate: `host` of shared/brand.json
```

`install.sh` creates the `berean` user, installs the binary and seed database (the database is never overwritten
once present), enables the systemd unit, installs Caddy and writes its Caddyfile. Re-running it upgrades the binary
only. `ministry.db` (the ministry library and its verse index) is read-only and replaced whole: copy a rebuilt one to
`/var/lib/berean/ministry.db` and restart; without it the library is empty and the selection bar never offers Ministry. Environment for the unit: `BEREAN_PROD=1` (secure cookies, no CORS), `BEREAN_DATA=/var/lib/berean`,
add `BEREAN_GOOGLE_CLIENT_IDS=<web>,<android>,<ios>` to enable Google sign-in.

## Moderation

Two layers, neither costs tokens on the server:

1. **Automatic rule scan** of everything shared (group posts at creation, outlines whenever they are shared or edited
   while shared) and of every report on arrival. Hard-term list and sexual-solicitation patterns hide the content at once;
   links are checked against the URLhaus and Phishing Army blocklists (fetched at boot and every 12 h, no account needed);
   threats, profanity (LDNOOBW lexicon), personal data and spam heuristics escalate to the queue. Hits in the
   categories the rules name (`judge.always`) are always sent on to the judge too, since only it can ban. The rules and
   their word lists live in `rs/moderation/` (`rules.json`; `rs/src/rules.rs` says what each key means) and are compiled
   into the binary; edit and redeploy to change them. A rules file that cannot be read stops the server at start-up
   with the name of the rule.
2. **Report judge**: queued reports are answered by the Grok worker (`tools/mod-worker/`, runs on the MCP host under
   the owner's Grok subscription; it polls `GET /api/mod/jobs?token=…`). Set the same random token as
   `BEREAN_MOD_WORKER_TOKEN` in `/etc/berean.env` and in the worker's env file. Any report unanswered for
   `BEREAN_MOD_TIMEOUT_SECS` (default 900) is escalated to you. `ANTHROPIC_API_KEY` is only used if no worker token is set.
   In the categories the rules let it (`judge.may_ban`) the judge can ban: the account is suspended at once and the webhook message says
   "AUTHOR SUSPENDED"; confirm with Ban, or undo with Allow / Unban in the queue. A ban (anyone's) is a nuke that also
   marks the person's IPs, devices, Google account/email and contact fingerprints (`rs/src/bans.rs`); the IP rule
   relies on Caddy being the only proxy in front (the last X-Forwarded-For entry is the client). Putting Cloudflare
   or another proxy in front would make every visitor share its addresses: fix `bans::Seen` first.

Everything queued shows in the app's Moderation queue (site admin only) and is posted to `BEREAN_MOD_WEBHOOK` if set
(Slack or Discord incoming webhook). Restart with `systemctl restart berean` after editing `/etc/berean.env`.

## Encryption at rest

`BEREAN_DB_KEY` (64 hex chars, `openssl rand -hex 32`) makes the user database a SQLCipher file; the service refuses to
start in prod without it. On the first boot after setting it, an existing plaintext `berean.db` is encrypted in place and
the plaintext copy kept as `berean.db.plaintext.bak` — verify sign-in works, then `shred -u` that file. Losing the key
loses every account, so keep a copy of `/etc/berean.env` somewhere safe (it is root-only, mode 600). The root EBS
volume is encrypted at the AWS level as well (default KMS key).
