#!/usr/bin/env bash
# deploy-local.sh — Stand up the whole Manabrew stack on a single machine,
# prod-like but self-contained (own network, own relay, published ports). No
# GitHub remote, no shared prod network, no merge required — it builds and runs
# whatever is checked out in this repo.
#
#   ./deploy-local.sh                       # http://localhost, design-system on
#   RELAY_HOST=192.168.1.50 ./deploy-local.sh   # reachable from the LAN
#   DESIGN_SYSTEM=0 ./deploy-local.sh       # hide the /design-system route
#
# Env:
#   RELAY_HOST   address the browser uses to reach this box's relay
#                (default: localhost). Use the box's IP/hostname for LAN access.
#   RELAY_PORT   relay port, also the published port (default: 9443).
#   WEB_PORT     port to serve the app on (default: 80).
#   DESIGN_SYSTEM  1/0 — expose the /design-system route (default: 1 here).
#   MANABREW_SERVER_KEY  relay access token (default: forge).
#
# HTTPS caveat: the WASM engine needs SharedArrayBuffer, which browsers grant
# only in a secure context. That means http://localhost works on the box
# itself, but accessing this stack from ANOTHER machine over plain http (a LAN
# IP) will NOT be cross-origin isolated — put it behind HTTPS (a TLS proxy, or
# mount a real-hostname Caddyfile over /etc/caddy/Caddyfile and set RELAY_PORT=443).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-compose.selfhost.yml}"
export RELAY_HOST="${RELAY_HOST:-localhost}"
export RELAY_PORT="${RELAY_PORT:-9443}"
export WEB_PORT="${WEB_PORT:-80}"
export DESIGN_SYSTEM="${DESIGN_SYSTEM:-1}"
export MANABREW_SERVER_KEY="${MANABREW_SERVER_KEY:-forge}"

if [ -f "$REPO_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$REPO_DIR/.env"
    set +a
fi

# The web image builds the card dataset from the forge submodule's res/ tree.
git submodule sync --recursive || true
git submodule update --init --recursive

export DOCKER_BUILDKIT=1
export BUILDKIT_PROGRESS=plain

echo "🔨 Building the stack (first run compiles WASM + the card set — this is slow)…"
docker compose -f "$COMPOSE_FILE" build

echo "🚀 Starting…"
docker compose -f "$COMPOSE_FILE" up -d --force-recreate --remove-orphans

echo
echo "✅ Manabrew is up."
echo "   App:   http://${RELAY_HOST}:${WEB_PORT}/"
[ "$DESIGN_SYSTEM" = "1" ] && echo "   Design system: http://${RELAY_HOST}:${WEB_PORT}/design-system"
echo "   Relay: ws://${RELAY_HOST}:${RELAY_PORT}"
