# Report judge worker

This worker answers queued moderation reports with an AI model. It runs on any machine where the `grok` CLI is signed
in, so it needs no API key.

Every 20 seconds it asks the server for queued report jobs. For each job it gets a structured verdict from the model
and posts it back. The instructions and the answer format come from the server with each job, so the worker holds no
policy of its own. They are defined in `rs/moderation/rules.json`.

The server's automatic scan handles most shared content by rule. Only reports, and hits in the categories the rules
always send on, reach the worker. The server honors a `ban` verdict only in the categories the rules allow, and only
at a confidence of 0.85 or more.

## Run

```bash
BDB_WORKER_TOKEN=<the server's BEREAN_MOD_WORKER_TOKEN> node tools/mod-worker/worker.mjs
```

Set `BDB_API` to point at a different server. The default is `site` from `shared/brand.json`.

If the worker is down, the server sends queued reports to the site admin after `BEREAN_MOD_TIMEOUT_SECS`. Nothing is
lost.
