#!/usr/bin/env bash
# deploy-staging.sh — Lean rollout of the staging slot (/opt/manabrew-staging
# on the prod box, staging.manabrew.app). Pulls the staging branch + the
# CI-built `:staging` ghcr images and rolls them out with a health-checked
# recreate + rollback. Deliberately NOT deploy.sh: none of production's release
# machinery (manifest hold, --release-manifest, sidestore, observability/parity
# profiles) lives here — staging just tracks a branch and swaps in fresh
# images. Driven by staging-deploy.yml over SSH.
#
# DEPLOY_BRANCH selects what lands in the slot: `staging` (the default, and the
# only branch that gets a hosted-AI node) or a labelled PR's head branch.
#
# stdout = clean summary (captured by the workflow and posted to Discord).
# Raw output goes to /tmp/deploy-staging-raw.log.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

BRANCH="${DEPLOY_BRANCH:-staging}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.staging.yml}"
export MANABREW_IMAGE_TAG="${MANABREW_IMAGE_TAG:-staging}"
RAW_LOG="/tmp/deploy-staging-raw.log"
: > "$RAW_LOG"

# ── Hosted AI: staging branch only ───────────────────────────────────
# The self-hosted node is a Forge JVM — ~500 MiB resident and CPU-bound during
# games, on a box that also runs production. The `staging` branch gets one; PR
# previews (any other branch) do not, so a labelled PR costs web + relay + hub
# only. The node sits behind the `hosted-ai` compose profile, and
# `up --remove-orphans` below drops its container when the profile is off — so
# switching the slot from staging to a preview reclaims it.
PROFILE_FLAG=""
HOSTED_AI_NOTE="off (preview — node not started)"
if [ "$BRANCH" = "staging" ]; then
    PROFILE_FLAG="--profile hosted-ai"
    HOSTED_AI_NOTE="on (staging branch)"
fi

on_failure() {
    echo "💥 **Staging deploy FAILED** at $(date '+%H:%M:%S')"
    echo "📄 Raw log: \`$RAW_LOG\`"
    tail -20 "$RAW_LOG" 2>/dev/null | sed 's/^/> /'
}
trap on_failure ERR

# Slot .env: MANABREW_SERVER_KEY + hub auth secrets, written by the workflow's
# secret sync; optional GITHUB_TOKEN (git pull rate limits).
if [ -f "$REPO_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$REPO_DIR/.env"
    set +a
fi

# ── Fetch + hard-reset to origin/<branch> ────────────────────────────
# Pin origin to HTTPS regardless of how the box was cloned: the repo is public,
# so this works anonymously (or token-authed for rate limits) and a box cloned
# over SSH doesn't need a GitHub key. fetch + `checkout -f -B` force the local
# branch to exactly match the remote — robust to a diverged/detached/dirty
# checkout where a plain `pull --ff-only` would bail. Only the compose file +
# ops/ configs are used from the checkout (images come prebuilt from ghcr), so
# no submodules and no local build.
REPO_SLUG="${GITHUB_REPO:-witchesofthehill/manabrew}"
if [ -n "${GITHUB_TOKEN:-}" ]; then
    git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO_SLUG}.git"
else
    git remote set-url origin "https://github.com/${REPO_SLUG}.git"
fi
# DEPLOY_STAGING_ORIG_PREV preserves the pre-fetch commit across the self-update
# re-exec below, so the re-run still reports the right range instead of an empty
# "no new commits" changelog.
PREV="${DEPLOY_STAGING_ORIG_PREV:-$(git rev-parse --short HEAD)}"
git fetch origin "$BRANCH" >> "$RAW_LOG" 2>&1
git checkout -f -B "$BRANCH" FETCH_HEAD >> "$RAW_LOG" 2>&1
CURR=$(git rev-parse --short HEAD)

# Self-update: the checkout may have changed this very script, but bash already
# has the old copy in memory — without this, script edits only take effect the
# NEXT deploy. Re-exec the updated script once (guarded so it can't loop).
if [ -z "${DEPLOY_STAGING_ORIG_PREV:-}" ] && [ "$PREV" != "$CURR" ] \
   && ! git diff --quiet "${PREV}..${CURR}" -- deploy-staging.sh; then
    echo "deploy-staging.sh changed in this pull — re-exec'ing the updated script" >> "$RAW_LOG"
    export DEPLOY_STAGING_ORIG_PREV="$PREV"
    exec bash "$0" "$@"
fi

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "❌ $COMPOSE_FILE does not exist on this ref — merge the branch that introduced it and redeploy."
    exit 1
fi

# ── Pull the CI-built images ─────────────────────────────────────────
# The deploy job needs build-images, so these normally exist already; the retry
# is a safety net if ghcr is briefly behind.
export DOCKER_BUILDKIT=1
SERVICES="manabrew-staging manabrew-server-staging manabrew-hub-staging"
[ -n "$PROFILE_FLAG" ] && SERVICES="$SERVICES self-hosted-node-staging"
WEB_SERVICE="manabrew-staging"
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
# The ghcr ref per service comes from the compose file itself.
ghcr_ref() {
    docker compose -f "$COMPOSE_FILE" config "$1" 2>/dev/null \
        | awk '/^ *image:/ {print $2; exit}'
}
declare -A ROLLBACK_IMG=()
declare -A GHCR_REF=()
for svc in $SERVICES; do
    GHCR_REF[$svc]=$(ghcr_ref "$svc")
    cid=$(docker compose -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null || true)
    [ -n "$cid" ] && ROLLBACK_IMG[$svc]=$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null || true)
done

# shellcheck disable=SC2086
if docker compose -f "$COMPOSE_FILE" $PROFILE_FLAG up -d --remove-orphans --wait --wait-timeout 180 >> "$RAW_LOG" 2>&1; then
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
docker compose -f "$COMPOSE_FILE" exec -T "$WEB_SERVICE" \
    caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >> "$RAW_LOG" 2>&1 \
    || echo "caddy reload skipped/failed (see raw log)" >> "$RAW_LOG"

# ── Reclaim superseded images ────────────────────────────────────────
# Every deploy pulls a fresh `:staging` tag, which leaves the previous one
# dangling (untagged, unreferenced). Nothing reclaimed them before, and this box
# shares its docker volume with production. `image prune` (no -a) only touches
# dangling images, so nothing tagged or in use by a running container can be
# caught, and the rollback re-tag above has already happened by this point.
RECLAIMED=$(docker image prune -f 2>> "$RAW_LOG" | tail -1)
echo "🧹 ${RECLAIMED:-nothing to reclaim}" >> "$RAW_LOG"

# No pipe here: `| head -c` SIGPIPEs git log on large merge ranges, and with
# pipefail + the ERR trap that flagged an already-healthy rollout as failed.
CHANGELOG=$(git log --pretty=format:'- %s (%h, %an)' "${PREV}..${CURR}" 2>/dev/null || true)
CHANGELOG=${CHANGELOG:0:1500}
[ -z "$CHANGELOG" ] && CHANGELOG="(no new commits — image-only redeploy)"

cat <<EOF
🧪 **Staging deploy complete** (\`${PREV}\` → \`${CURR}\`)

🔁 **Rolled out:** ${SERVICES} (tag \`${MANABREW_IMAGE_TAG}\`, branch \`${BRANCH}\`)
🤖 **Hosted AI:** ${HOSTED_AI_NOTE}
🧹 **Reclaimed:** ${RECLAIMED:-nothing}
📄 **Log:** \`${RAW_LOG}\`

📝 **Changelog:**
${CHANGELOG}
EOF
