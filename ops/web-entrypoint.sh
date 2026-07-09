#!/bin/sh
set -e

# Regenerate the app's runtime relay config from env so one published image can
# point at any relay without a rebuild. Empty RELAY_HOST leaves the app on its
# compiled-in default (VITE_RELAY_* / the official relay). Port defaults to 443
# (the client dials wss://); set RELAY_PORT=9443 for a bare ws:// relay.
if [ -n "${RELAY_HOST:-}" ]; then
	cat >/srv/manabrew/config.js <<EOF
window.__MANABREW_RUNTIME__ = {
  relay: {
    host: "${RELAY_HOST}",
    port: ${RELAY_PORT:-443},
    password: "${RELAY_PASSWORD:-forge}"
  }
};
EOF
else
	echo 'window.__MANABREW_RUNTIME__ = {};' >/srv/manabrew/config.js
fi

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
