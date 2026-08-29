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
{
	echo 'window.__MANABREW_RUNTIME__ = {'
	if [ -n "${RELAY_HOST:-}" ]; then
		echo "  relay: { host: \"${RELAY_HOST}\", port: ${RELAY_PORT:-443}, password: \"${RELAY_PASSWORD:-forge}\" },"
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
		if [ -f /srv/manabrew/forge/forgeharness.js.wasm ]; then
			flags="${flags} forgeWasm: true,"
		else
			echo "[entrypoint] FORGE_WASM is set but this image has no engine at" \
				"/srv/manabrew/forge/forgeharness.js.wasm; leaving the toggle hidden." >&2
		fi
		;;
	esac
	if [ -n "${flags}" ]; then
		echo "  featureFlags: {${flags} },"
	fi
	if [ -n "${HUB_API_URL:-}" ]; then
		echo "  hubApiUrl: \"${HUB_API_URL}\","
	fi
	echo '};'
} >/srv/manabrew/config.js

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
