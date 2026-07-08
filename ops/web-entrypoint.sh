#!/bin/sh
set -e

# Regenerate the app's runtime relay config from env so one published image can
# point at any relay without a rebuild. Empty RELAY_HOST leaves the app on its
# compiled-in default (VITE_RELAY_* / the official relay). Port defaults to 443
# (the client dials wss://); set RELAY_PORT=9443 for a bare ws:// relay.
# DESIGN_SYSTEM=1/true exposes the dev-only /design-system reference route on
# this production build (off by default).
case "${DESIGN_SYSTEM:-}" in
	1 | true | TRUE | yes) DESIGN_SYSTEM_JS="  designSystem: true," ;;
	*) DESIGN_SYSTEM_JS="" ;;
esac

{
	echo 'window.__MANABREW_RUNTIME__ = {'
	if [ -n "${RELAY_HOST:-}" ]; then
		echo '  relay: {'
		echo "    host: \"${RELAY_HOST}\","
		echo "    port: ${RELAY_PORT:-443},"
		echo "    password: \"${RELAY_PASSWORD:-forge}\""
		echo '  },'
	fi
	[ -n "$DESIGN_SYSTEM_JS" ] && echo "$DESIGN_SYSTEM_JS"
	echo '};'
} >/srv/manabrew/config.js

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
