#!/usr/bin/env bash
# deploy-staging.sh — Lean rollout of the staging stack on the staging VM.
# Pulls the staging branch + the CI-built `:staging` ghcr images and rolls them
# out with a health-checked recreate + rollback. Deliberately NOT deploy.sh:
# none of production's release machinery (manifest hold, --release-manifest,
# sidestore, observability/parity profiles) lives here — staging just tracks a
# branch and swaps in fresh images. Driven by staging-deploy.yml over SSH.
#
# stdout = clean summary (captured by the workflow and posted to Discord).
# Raw output goes to /tmp/deploy-staging-raw.log.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

BRANCH="${DEPLOY_BRANCH:-staging}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.staging.yml}"
export MANABREW_IMAGE_TAG="${MANABREW_IMAGE_TAG:-staging}"
GHCR_OWNER="witchesofthehill"
RAW_LOG="/tmp/deploy-staging-raw.log"
: > "$RAW_LOG"

on_failure() {
    echo "💥 **Staging deploy FAILED** at $(date '+%H:%M:%S')"
    echo "📄 Raw log: \`$RAW_LOG\`"
    tail -20 "$RAW_LOG" 2>/dev/null | sed 's/^/> /'
}
trap on_failure ERR

# Box .env: MANABREW_SERVER_KEY, the STAGING_*_HOST trio, optional GITHUB_TOKEN
# (git pull rate limits) and DISCORD_WEBHOOK_URL.
if [ -f "$REPO_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$REPO_DIR/.env"
    set +a
fi

if [ -n "${GITHUB_TOKEN:-}" ]; then
    git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPO:-witchesofthehill/manabrew}.git"
fi

# ── Pull the branch ──────────────────────────────────────────────────
# Only the compose file + ops/ configs are used from the checkout (images come
# prebuilt from ghcr), so no submodules and no local build.
PREV=$(git rev-parse --short HEAD)
git pull origin "$BRANCH" --ff-only >> "$RAW_LOG" 2>&1
CURR=$(git rev-parse --short HEAD)

# ── Pull the CI-built images ─────────────────────────────────────────
# The deploy job needs build-images, so these normally exist already; the retry
# is a safety net if ghcr is briefly behind.
export DOCKER_BUILDKIT=1
SERVICES="manabrew manabrew-server manabrew-hub"
echo "Pulling :${MANABREW_IMAGE_TAG} images ($SERVICES)…" >> "$RAW_LOG"
PULLED=false
for attempt in $(seq 1 20); do
    if docker compose -f "$COMPOSE_FILE" pull --quiet $SERVICES >> "$RAW_LOG" 2>&1; then
        PULLED=true; break
    fi
    echo "  pull attempt $attempt failed (CI images not pushed yet?); retry in 30s" >> "$RAW_LOG"
    sleep 30
done
$PULLED || { echo "❌ ghcr image pull failed after retries — aborting."; exit 1; }

# ── Health-checked rollout with rollback ─────────────────────────────
# Snapshot each running service's current image so an unhealthy rollout can be
# re-tagged back. `up -d` only recreates services whose image/config changed.
declare -A ROLLBACK_IMG=()
declare -A GHCR_REF=(
    [manabrew]="ghcr.io/${GHCR_OWNER}/manabrew-web:${MANABREW_IMAGE_TAG}"
    [manabrew-server]="ghcr.io/${GHCR_OWNER}/manabrew-server:${MANABREW_IMAGE_TAG}"
    [manabrew-hub]="ghcr.io/${GHCR_OWNER}/manabrew-hub:${MANABREW_IMAGE_TAG}"
)
for svc in $SERVICES; do
    cid=$(docker compose -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null || true)
    [ -n "$cid" ] && ROLLBACK_IMG[$svc]=$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null || true)
done

if docker compose -f "$COMPOSE_FILE" up -d --remove-orphans --wait --wait-timeout 180 >> "$RAW_LOG" 2>&1; then
    echo "✅ rollout healthy" >> "$RAW_LOG"
else
    echo "⚠️ rollout unhealthy — rolling back to the previous images" | tee -a "$RAW_LOG"
    ROLLED=""
    for svc in $SERVICES; do
        ref="${GHCR_REF[$svc]:-}"; old="${ROLLBACK_IMG[$svc]:-}"
        if [ -n "$ref" ] && [ -n "$old" ]; then
            docker tag "$old" "$ref" >> "$RAW_LOG" 2>&1 && ROLLED="$ROLLED $svc"
        fi
    done
    [ -n "$ROLLED" ] && docker compose -f "$COMPOSE_FILE" up -d --no-deps $ROLLED >> "$RAW_LOG" 2>&1 || true
    echo "↩️ rolled back:$ROLLED" | tee -a "$RAW_LOG"
    exit 1
fi

# The Caddyfile is bind-mounted and caddy doesn't watch it; a recreate already
# picks up changes, but reload covers the case where the web image was unchanged.
docker compose -f "$COMPOSE_FILE" exec -T manabrew \
    caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >> "$RAW_LOG" 2>&1 \
    || echo "caddy reload skipped/failed (see raw log)" >> "$RAW_LOG"

CHANGELOG=$(git log --pretty=format:'- %s (%h, %an)' "${PREV}..${CURR}" 2>/dev/null | head -c 1500)
[ -z "$CHANGELOG" ] && CHANGELOG="(no new commits — image-only redeploy)"

cat <<EOF
🧪 **Staging deploy complete** (\`${PREV}\` → \`${CURR}\`)

🔁 **Rolled out:** ${SERVICES} (tag \`${MANABREW_IMAGE_TAG}\`)
📄 **Log:** \`${RAW_LOG}\`

📝 **Changelog:**
${CHANGELOG}
EOF
