#!/bin/sh
set -e

# Regenerate the app's runtime config from env so one published image serves any
# deployment without a rebuild.
#   relay: from RELAY_* (empty RELAY_HOST leaves the app on its compiled-in
#     VITE_RELAY_* default; port defaults to 443 for wss://, set 9443 for ws://).
#   hostedAiEnabled: from HOSTED_AI_ENABLED — gates the Forge "Play vs AI"
#     option, off in the published image.
#   designSystem: from DESIGN_SYSTEM — exposes the dev-only /design-system
#     reference route on a production build, off by default.
#   featureFlags: runtime opt-in for flags shipped dark in src/featureFlags.ts;
#     accounts from ACCOUNTS, deckHub from DECK_HUB, emailSignIn from
#     EMAIL_SIGN_IN, forgeWasm from FORGE_WASM. Can only enable, never disable.
#   hubApiUrl: from HUB_API_URL — deck hub + auth API origin; unset leaves the
#     app on its compiled-in VITE_HUB_API_URL / api.manabrew.app default.
json_string() {
	printf '%sX' "$1" | LC_ALL=C awk '
		BEGIN {
			for (i = 1; i < 32; i++) controls[sprintf("%c", i)] = sprintf("\\u%04x", i)
		}
		{ value = value (NR > 1 ? "\n" : "") $0 }
		END {
			value = substr(value, 1, length(value) - 1)
			printf "\""
			for (i = 1; i <= length(value); i++) {
				char = substr(value, i, 1)
				if (char == "\\") printf "\\\\"
				else if (char == "\"") printf "\\\""
				else if (char in controls) printf "%s", controls[char]
				else if (substr(value, i, 3) == "\342\200\250") { printf "\\u2028"; i += 2 }
				else if (substr(value, i, 3) == "\342\200\251") { printf "\\u2029"; i += 2 }
				else printf "%s", char
			}
			printf "\""
		}'
}

{
	echo 'window.__MANABREW_RUNTIME__ = {'
	if [ -n "${RELAY_HOST:-}" ]; then
		port=$(printf '%s' "${RELAY_PORT:-443}" | awk '/^[0-9]+$/ && $0 + 0 > 0 && $0 + 0 < 65536 { printf "%d", $0; valid = 1 } END { if (!valid) exit 1 }')
		printf '  relay: { host: %s, port: %s, password: %s },\n' \
			"$(json_string "$RELAY_HOST")" "$port" "$(json_string "${RELAY_PASSWORD:-forge}")"
	fi
	case "$(printf '%s' "${HOSTED_AI_ENABLED:-}" | tr '[:upper:]' '[:lower:]')" in
	1 | true | yes | on) echo '  hostedAiEnabled: true,' ;;
	esac
	case "$(printf '%s' "${DESIGN_SYSTEM:-}" | tr '[:upper:]' '[:lower:]')" in
	1 | true | yes | on) echo '  designSystem: true,' ;;
	esac
	flags=""
	case "$(printf '%s' "${ACCOUNTS:-}" | tr '[:upper:]' '[:lower:]')" in
	1 | true | yes | on) flags="${flags} accounts: true," ;;
	esac
	case "$(printf '%s' "${DECK_HUB:-}" | tr '[:upper:]' '[:lower:]')" in
	1 | true | yes | on) flags="${flags} deckHub: true," ;;
	esac
	case "$(printf '%s' "${EMAIL_SIGN_IN:-}" | tr '[:upper:]' '[:lower:]')" in
	1 | true | yes | on) flags="${flags} emailSignIn: true," ;;
	esac
	# Only advertise the browser engine if this image actually carries it. The
	# flag reveals a Settings toggle, and a toggle with no engine behind it is
	# a dead switch a player can flip: the image build has to have run the Web
	# Image step (see docker-images.yml / staging-deploy.yml).
	case "$(printf '%s' "${FORGE_WASM:-}" | tr '[:upper:]' '[:lower:]')" in
	1 | true | yes | on)
		if ls /srv/manabrew/assets/forgeharness*.wasm >/dev/null 2>&1; then
			flags="${flags} forgeWasm: true,"
		else
			echo "[entrypoint] FORGE_WASM is set but this image has no engine at" \
				"/srv/manabrew/assets/forgeharness*.wasm; leaving the toggle hidden." >&2
		fi
		;;
	esac
	if [ -n "${flags}" ]; then
		echo "  featureFlags: {${flags} },"
	fi
	if [ -n "${HUB_API_URL:-}" ]; then
		printf '  hubApiUrl: %s,\n' "$(json_string "$HUB_API_URL")"
	fi
	enabled=false
	case "$(printf '%s' "${FARO_ENABLED:-}" | tr '[:upper:]' '[:lower:]')" in
	1 | true | yes | on) enabled=true ;;
	esac
	printf '  observability: { enabled: %s, collectorUrl: %s, environment: %s },\n' \
		"$enabled" "$(json_string "${FARO_COLLECTOR_URL:-}")" "$(json_string "${FARO_ENVIRONMENT:-}")"
	echo '};'
} >/srv/manabrew/config.js

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
