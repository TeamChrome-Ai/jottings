#!/bin/bash
# Run on the instance as root with the payload in /tmp/bdb-deploy. Idempotent.
set -euo pipefail
HOST="$1"   # public hostname for Caddy (e.g. 1-2-3-4.sslip.io)
id berean >/dev/null 2>&1 || useradd --system --home /var/lib/berean --shell /usr/sbin/nologin berean
install -d -o berean -g berean /var/lib/berean
install -m 755 /tmp/bdb-deploy/berean /usr/local/bin/berean
[ -e /var/lib/berean/scripture.db ] || install -o berean -g berean -m 644 /tmp/bdb-deploy/scripture.db /var/lib/berean/scripture.db
# the ministry library is read-only data: a newer build replaces it whole (the service reopens it on restart)
if [ -e /tmp/bdb-deploy/ministry.db ]; then install -o berean -g berean -m 644 /tmp/bdb-deploy/ministry.db /var/lib/berean/ministry.db; fi
install -m 644 /tmp/bdb-deploy/berean.service /etc/systemd/system/berean.service
[ -e /etc/berean.env ] || { printf 'BEREAN_DB_KEY=%s\n# BEREAN_MOD_WORKER_TOKEN=...          # shared with tools/mod-worker (Grok judge); unset = reports wait for the timeout then go to the admin\n# BEREAN_MOD_WEBHOOK=https://...       # Slack/Discord incoming webhook pinged for every report that needs a human\n# BEREAN_GOOGLE_CLIENT_IDS=web,android,ios\n# ANTHROPIC_API_KEY=sk-ant-...        # only used when no worker token is set\n' "$(openssl rand -hex 32)" > /etc/berean.env; chmod 600 /etc/berean.env; }
systemctl daemon-reload && systemctl enable --now berean
# Caddy: automatic HTTPS, brotli/gzip passthrough (the app precompresses), HTTP/2 + HTTP/3
if ! command -v caddy >/dev/null; then
  apt-get update -qq && apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
cat > /etc/caddy/Caddyfile <<CADDY
$HOST {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8787
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
	}
}
CADDY
systemctl restart caddy
sleep 2
systemctl is-active berean caddy
