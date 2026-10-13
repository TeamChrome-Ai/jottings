# Report judge worker (Grok subscription, no API key)

Runs anywhere the `grok` CLI is signed in (here: the MCP host). Polls the app server every 20 s for queued
report jobs, gets a structured verdict from Grok (`grok -p … --json-schema`), and posts it back. The rules come from
the server with each job (the judge's instructions and the answer format, `rs/moderation/rules.json`): the worker
holds no policy. Automatic scanning of shared content is rule-based on the server; only the hits in the categories its
rules always send on (`judge.always`) come here, because the judge alone can ban (`ban` verdict, honoured by the server
only for a category of `judge.may_ban` at confidence ≥ 0.85).

```bash
BDB_WORKER_TOKEN=<from /etc/berean.env on the server> node tools/mod-worker/worker.mjs   # BDB_API=<server>: default is `site` of shared/brand.json
```

Installed on the MCP host as a user systemd unit (`~/.config/systemd/user/bdb-mod-worker.service`) with the token in
`~/.config/bdb-mod-worker.env` (mode 600). If the worker is down, the server escalates queued reports to the admin
after `BEREAN_MOD_TIMEOUT_SECS` (default 15 min), so nothing is lost.
