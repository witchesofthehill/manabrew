#!/bin/sh
set -e

# Regenerate the app's runtime config from env so one published image serves any
# deployment without a rebuild.
#   relay: from RELAY_* (empty RELAY_HOST leaves the app on its compiled-in
#     VITE_RELAY_* default; port defaults to 443 for wss://, set 9443 for ws://).
#   hostedAiEnabled: from HOSTED_AI_ENABLED — gates the Forge "Play vs AI"
#     option, off in the published image.
{
	echo 'window.__MANABREW_RUNTIME__ = {'
	if [ -n "${RELAY_HOST:-}" ]; then
		echo "  relay: { host: \"${RELAY_HOST}\", port: ${RELAY_PORT:-443}, password: \"${RELAY_PASSWORD:-forge}\" },"
	fi
	case "$(printf '%s' "${HOSTED_AI_ENABLED:-}" | tr '[:upper:]' '[:lower:]')" in
	1 | true | yes | on) echo '  hostedAiEnabled: true,' ;;
	esac
	echo '};'
} >/srv/manabrew/config.js

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
