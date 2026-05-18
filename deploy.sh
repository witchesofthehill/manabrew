#!/usr/bin/env bash
# deploy.sh — Smart rebuild: only rebuilds what changed since last deploy.
# Triggered automatically via n8n webhook on push to main.
# See DEPLOY.md for setup instructions.
# Docker BuildKit layer caching handles unchanged layers within each build.
#
#
#
# stdout  = clean summary (suitable for Discord)
# Raw build output goes to /tmp/deploy-raw.log
set -euo pipefail

on_failure() {
    echo "**Deploy FAILED** at $(date '+%H:%M:%S')"
    echo "Check raw log: \`${RAW_LOG:-/tmp/deploy-raw.log}\`"
    tail -20 "${RAW_LOG:-/tmp/deploy-raw.log}" 2>/dev/null | sed 's/^/> /'
}
trap on_failure ERR

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-forge-engine/crates/forge-server/compose.yml}"
RAW_LOG="/tmp/deploy-raw.log"
: > "$RAW_LOG"   # truncate

# ── Load .env files ──────────────────────────────────────────────────
# Root .env (for GITHUB_TOKEN and other global settings)
if [ -f "$REPO_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$REPO_DIR/.env"
    set +a
fi
# Server .env (for COMPOSE_PROFILES and dashboard settings)
SERVER_ENV="$REPO_DIR/forge-engine/crates/forge-server/.env"
if [ -f "$SERVER_ENV" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$SERVER_ENV"
    set +a
fi

# Check if parity dashboard profile is active
SKIP_DASHBOARD=true
if echo "${COMPOSE_PROFILES:-}" | grep -q "parity"; then
    SKIP_DASHBOARD=false
fi

# ── Configure git to use PAT instead of SSH ─────────────────────────
if [ -n "${GITHUB_TOKEN:-}" ]; then
    DEPLOY_GITHUB_REPO="${GITHUB_REPO:-witchesofthehill/manabrew}"
    git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${DEPLOY_GITHUB_REPO}.git"
fi

# ── Pull latest changes ──────────────────────────────────────────────
PREV=$(git rev-parse --short HEAD)
git pull origin main --ff-only >> "$RAW_LOG" 2>&1
CURR=$(git rev-parse --short HEAD)

if [ "$PREV" = "$CURR" ]; then
    echo "No new commits. Nothing to deploy."
    exit 0
fi

# Gather commit info
COMMIT_COUNT=$(git rev-list "${PREV}..${CURR}" --count)
COMMIT_MSG=$(git log -1 --format="%s" "$CURR")
AUTHOR=$(git log -1 --format="%an" "$CURR")

# Changelog of every commit being deployed (newest first), trimmed so the full
# Discord message stays well under the 2000-char single-message limit.
CHANGELOG=$(git log --pretty=format:'- %s (%h, %an)' "${PREV}..${CURR}")
CHANGELOG_MAX=1500
if [ "${#CHANGELOG}" -gt "$CHANGELOG_MAX" ]; then
    CHANGELOG="${CHANGELOG:0:$CHANGELOG_MAX}
… (truncated)"
fi

# ── Determine what changed ───────────────────────────────────────────
CHANGED=$(git diff --name-only "${PREV}..${CURR}")

JAVA_CHANGED=false
RUST_CHANGED=false
WEB_CHANGED=false
INFRA_CHANGED=false

while IFS= read -r file; do
    case "$file" in
        forge/forge-core/*|forge/forge-game/*|forge/forge-ai/*|forge/forge-gui/*|forge/forge-harness/*|forge/pom.xml)
            JAVA_CHANGED=true ;;
        forge-engine/*|Cargo.toml|Cargo.lock)
            RUST_CHANGED=true ;;
    esac
    case "$file" in
        src/*|public/*|scripts/build-wasm.sh|scripts/bundle-cards.mjs|package.json|package-lock.json|vite.config.ts|tsconfig*.json|index.html|nginx.web.conf)
            WEB_CHANGED=true ;;
        forge-engine/crates/forge-wasm/*)
            WEB_CHANGED=true ;;
    esac
    case "$file" in
        *Dockerfile*|*compose*|.dockerignore|deploy.sh|nginx.web.conf)
            INFRA_CHANGED=true ;;
    esac
done <<< "$CHANGED"

# ── Build & deploy ───────────────────────────────────────────────────
export DOCKER_BUILDKIT=1
export BUILDKIT_PROGRESS=plain

SERVICES_TO_RESTART=""
BUILD_START=$(date +%s)
BUILD_ARGS="--build-arg GIT_COMMIT_SHA=${CURR}"

# -- parity-dashboard (Java + Rust) --
# Only build if the parity profile is active (COMPOSE_PROFILES contains "parity")
if ! $SKIP_DASHBOARD; then
    if $INFRA_CHANGED; then
        echo "Building parity-dashboard (full)..." >> "$RAW_LOG"
        docker compose -f "$COMPOSE_FILE" --profile parity build --progress=plain --no-cache $BUILD_ARGS parity-dashboard >> "$RAW_LOG" 2>&1
        SERVICES_TO_RESTART="parity-dashboard"
    elif $JAVA_CHANGED || $RUST_CHANGED; then
        echo "Building parity-dashboard (cached)..." >> "$RAW_LOG"
        docker compose -f "$COMPOSE_FILE" --profile parity build --progress=plain $BUILD_ARGS parity-dashboard >> "$RAW_LOG" 2>&1
        SERVICES_TO_RESTART="parity-dashboard"
    fi
else
    echo "Parity dashboard skipped (COMPOSE_PROFILES does not include 'parity')" >> "$RAW_LOG"
fi

# -- forge-server (Rust only) --
if $INFRA_CHANGED; then
    echo "Building forge-server (full)..." >> "$RAW_LOG"
    docker compose -f "$COMPOSE_FILE" build --progress=plain --no-cache forge-server >> "$RAW_LOG" 2>&1
    SERVICES_TO_RESTART="$SERVICES_TO_RESTART forge-server"
elif $RUST_CHANGED; then
    echo "Building forge-server (cached)..." >> "$RAW_LOG"
    docker compose -f "$COMPOSE_FILE" build --progress=plain forge-server >> "$RAW_LOG" 2>&1
    SERVICES_TO_RESTART="$SERVICES_TO_RESTART forge-server"
fi

# -- manabrew (WASM + React static site served via nginx) --
if $INFRA_CHANGED; then
    echo "Building manabrew (full)..." >> "$RAW_LOG"
    docker compose -f "$COMPOSE_FILE" build --progress=plain --no-cache $BUILD_ARGS manabrew >> "$RAW_LOG" 2>&1
    SERVICES_TO_RESTART="$SERVICES_TO_RESTART manabrew"
elif $WEB_CHANGED || $RUST_CHANGED; then
    echo "Building manabrew (cached)..." >> "$RAW_LOG"
    docker compose -f "$COMPOSE_FILE" build --progress=plain $BUILD_ARGS manabrew >> "$RAW_LOG" 2>&1
    SERVICES_TO_RESTART="$SERVICES_TO_RESTART manabrew"
fi

if [ -z "$SERVICES_TO_RESTART" ]; then
    echo "No Java/Rust/infra changes — skipping build."
    exit 0
fi

# Pass --profile parity when dashboard is included in the restart list
PROFILE_FLAG=""
if echo "$SERVICES_TO_RESTART" | grep -q "parity-dashboard"; then
    PROFILE_FLAG="--profile parity"
fi
docker compose -f "$COMPOSE_FILE" $PROFILE_FLAG up -d $SERVICES_TO_RESTART >> "$RAW_LOG" 2>&1

BUILD_END=$(date +%s)
BUILD_DURATION=$(( BUILD_END - BUILD_START ))

# ── Pretty summary for Discord ───────────────────────────────────────
SERVICES_FMT=$(echo "$SERVICES_TO_RESTART" | xargs -n1 | sed 's/^/  - /' | tr '\n' '\n')

# Build change flags string
CHANGES=""
$JAVA_CHANGED && CHANGES="${CHANGES} Java"
$RUST_CHANGED && CHANGES="${CHANGES} Rust"
$WEB_CHANGED && CHANGES="${CHANGES} Web"
$INFRA_CHANGED && CHANGES="${CHANGES} Infra"
CHANGES=$(echo "$CHANGES" | xargs)

cat <<EOF
**Deploy complete** (\`${PREV}\` -> \`${CURR}\`)

> ${COMMIT_MSG}
> — ${AUTHOR} (${COMMIT_COUNT} commit(s))

**Changed:** ${CHANGES}
**Services rebuilt:**
${SERVICES_FMT}
**Build time:** ${BUILD_DURATION}s
**Log:** \`${RAW_LOG}\`

**Changelog:**
${CHANGELOG}
EOF
