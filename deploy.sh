#!/usr/bin/env bash
# deploy.sh — Smart rebuild of the Wasm/web stack on the production host.
# Scope: builds manabrew (Wasm + React, served by caddy), manabrew-server, and
# optionally parity-dashboard. Native Tauri installers (.dmg / .exe) are
# built separately by .github/workflows/publish.yml.
# Triggered by the final `deploy` job of .github/workflows/publish.yml
# via SSH on every release tag (or a manual dispatch with `deploy` ticked).
# Docker BuildKit layer caching handles unchanged layers within each build.
#
# stdout = clean summary (captured by the workflow and posted to Discord).
# Raw build output goes to /tmp/deploy-raw.log.
set -euo pipefail

on_failure() {
    echo "💥 **Wasm deploy FAILED** at $(date '+%H:%M:%S')"
    echo "📄 Check raw log: \`${RAW_LOG:-/tmp/deploy-raw.log}\`"
    tail -20 "${RAW_LOG:-/tmp/deploy-raw.log}" 2>/dev/null | sed 's/^/> /'
}
trap on_failure ERR

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"
RAW_LOG="/tmp/deploy-raw.log"
: > "$RAW_LOG"   # truncate

# ── Load .env files ──────────────────────────────────────────────────
# Root .env (production secrets via ops/production.secrets symlink, plus
# optional GITHUB_TOKEN for git rate-limit avoidance on the pull below).
if [ -f "$REPO_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$REPO_DIR/.env"
    set +a
fi
# Server .env (COMPOSE_PROFILES + dashboard settings)
SERVER_ENV="$REPO_DIR/manabrew-rs/crates/manabrew-server/.env"
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

# ── Optional: use GITHUB_TOKEN for the pull (avoids public rate limits) ──
if [ -n "${GITHUB_TOKEN:-}" ]; then
    DEPLOY_GITHUB_REPO="${GITHUB_REPO:-witchesofthehill/manabrew}"
    git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${DEPLOY_GITHUB_REPO}.git"
fi

# ── Pull latest changes ──────────────────────────────────────────────
PREV=$(git rev-parse --short HEAD)
git pull origin main --ff-only >> "$RAW_LOG" 2>&1
CURR=$(git rev-parse --short HEAD)

# Forge is a git submodule (engine + cardsfolder). Pulling main only moves the
# gitlink pointer; the working tree must be checked out explicitly or the wasm
# / cardset build fails with "cardsfolder does not exist: forge/forge-gui/res".
git submodule sync --recursive >> "$RAW_LOG" 2>&1 || true
git submodule update --init --recursive >> "$RAW_LOG" 2>&1
# Ironsmith is `update = none` (so it never inflates the other build paths), so
# the line above skips it. Force-check-out its working tree — git only, no
# toolchains — so Dockerfile.web's ironsmith stage can compile the WASM from it.
# Best-effort: a fetch failure leaves the dir empty and Ironsmith ships dark.
git -c submodule.ironsmith.update=checkout submodule update --init ironsmith >> "$RAW_LOG" 2>&1 || true

if [ "$PREV" = "$CURR" ]; then
    echo "😴 No new commits. Nothing to deploy."
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
# The web cardset archive is built inside the manabrew image from forge's card
# data (forge/forge-gui/res/{cardsfolder,tokenscripts,editions,blockdata}). A
# forge submodule bump shows up only as a change to the `forge` gitlink, which
# would otherwise be classified JAVA_CHANGED and skip the web rebuild — leaving
# the deployed archive stale (missing newly-added sets).
CARDDATA_CHANGED=false
# manabrew-server (the relay) — restarting it kills every live game, so this
# flag only decides whether to REBUILD its image. The restart itself is gated
# further down on whether the binary inside the fresh image actually differs
# from the one in the running container: the path filter over-triggers
# constantly (root Cargo.lock churns with release bumps and tauri/UI dep
# updates that are outside the relay's dep closure of manabrew-server +
# manabrew-protocol).
FORGE_SERVER_CHANGED=false
# The Caddyfile is volume-mounted into the manabrew container, not baked into
# the image, and caddy does not watch its config file. Rebuilding the image
# can't apply it (identical image → `up -d` won't recreate the container), so
# it needs an explicit `caddy reload`.
CADDYFILE_CHANGED=false
# Observability stack: pulled images with bind-mounted config, so a config
# edit only recreates the affected services — never an image build.
OBSERVABILITY_CHANGED=false

while IFS= read -r file; do
    case "$file" in
        forge|forge/*|forge-harness/*)
            JAVA_CHANGED=true ;;
        manabrew-engine/*|Cargo.toml|Cargo.lock)
            RUST_CHANGED=true ;;
    esac
    case "$file" in
        # manabrew-server's whole closure (see `cargo tree -p manabrew-server`).
        manabrew-rs/crates/manabrew-server/*|manabrew-rs/crates/manabrew-protocol/*|Cargo.toml|Cargo.lock)
            FORGE_SERVER_CHANGED=true ;;
    esac
    case "$file" in
        forge|forge/*)
            CARDDATA_CHANGED=true ;;
    esac
    case "$file" in
        src/*|public/*|scripts/build-wasm.mjs|scripts/ensure-wasm.mjs|package.json|yarn.lock|vite.config.ts|tsconfig*.json|index.html|website/*)
            WEB_CHANGED=true ;;
        manabrew-rs/crates/wasm/*)
            WEB_CHANGED=true ;;
        # An Ironsmith submodule bump moves the `ironsmith` gitlink; rebuild the
        # web image so its ironsmith stage recompiles the WASM.
        ironsmith|scripts/sync-ironsmith-wasm.mjs)
            WEB_CHANGED=true ;;
    esac
    case "$file" in
        ops/Caddyfile)
            CADDYFILE_CHANGED=true ;;
    esac
    case "$file" in
        ops/observability/*|scripts/ingest-events.py)
            OBSERVABILITY_CHANGED=true ;;
    esac
    case "$file" in
        *Dockerfile*|*compose*|.dockerignore|deploy.sh)
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

# -- manabrew-server (relay; restarted only when the shipped binary differs) --
RELAY_IMAGE="manabrew-server:production"
RELAY_UNCHANGED=false
if $INFRA_CHANGED; then
    echo "Building manabrew-server (full)..." >> "$RAW_LOG"
    docker compose -f "$COMPOSE_FILE" build --progress=plain --no-cache manabrew-server >> "$RAW_LOG" 2>&1
    SERVICES_TO_RESTART="$SERVICES_TO_RESTART manabrew-server"
elif $FORGE_SERVER_CHANGED; then
    echo "Building manabrew-server (cached)..." >> "$RAW_LOG"
    docker compose -f "$COMPOSE_FILE" build --progress=plain manabrew-server >> "$RAW_LOG" 2>&1
    # Dockerfile/compose changes take the INFRA branch above, so on this branch
    # an identical binary means the deployment is identical: skip the restart
    # and point the tag back at the running image so `up -d` (here or manual)
    # keeps considering the container up to date.
    RELAY_CID=$(docker compose -f "$COMPOSE_FILE" ps -q manabrew-server)
    if [ -n "$RELAY_CID" ]; then
        RELAY_OLD_IMAGE=$(docker inspect --format '{{.Image}}' "$RELAY_CID")
        OLD_SHA=$(docker run --rm --entrypoint sha256sum "$RELAY_OLD_IMAGE" /usr/local/bin/manabrew-server 2>> "$RAW_LOG" | cut -d' ' -f1 || true)
        NEW_SHA=$(docker run --rm --entrypoint sha256sum "$RELAY_IMAGE" /usr/local/bin/manabrew-server 2>> "$RAW_LOG" | cut -d' ' -f1 || true)
        if [ -n "$OLD_SHA" ] && [ "$OLD_SHA" = "$NEW_SHA" ]; then
            docker tag "$RELAY_OLD_IMAGE" "$RELAY_IMAGE" >> "$RAW_LOG" 2>&1
            RELAY_UNCHANGED=true
            echo "manabrew-server binary unchanged (${NEW_SHA:0:12}) — relay not restarted" >> "$RAW_LOG"
        fi
    fi
    if ! $RELAY_UNCHANGED; then
        SERVICES_TO_RESTART="$SERVICES_TO_RESTART manabrew-server"
    fi
fi

# -- manabrew (WASM + React static site served via caddy) --
if $INFRA_CHANGED; then
    echo "Building manabrew (full)..." >> "$RAW_LOG"
    docker compose -f "$COMPOSE_FILE" build --progress=plain --no-cache $BUILD_ARGS manabrew >> "$RAW_LOG" 2>&1
    SERVICES_TO_RESTART="$SERVICES_TO_RESTART manabrew"
elif $WEB_CHANGED || $RUST_CHANGED || $CARDDATA_CHANGED; then
    echo "Building manabrew (cached)..." >> "$RAW_LOG"
    docker compose -f "$COMPOSE_FILE" build --progress=plain $BUILD_ARGS manabrew >> "$RAW_LOG" 2>&1
    SERVICES_TO_RESTART="$SERVICES_TO_RESTART manabrew"
fi

# -- observability stack (config-only; images are pulled, never built) --
if $OBSERVABILITY_CHANGED; then
    if echo "${COMPOSE_PROFILES:-}" | grep -q "observability"; then
        SERVICES_TO_RESTART="$SERVICES_TO_RESTART prometheus pushgateway grafana loki alloy events-ingester"
    else
        echo "Observability config changed but profile inactive — skipped" >> "$RAW_LOG"
    fi
fi

if [ -z "$SERVICES_TO_RESTART" ] && ! $CADDYFILE_CHANGED; then
    if $RELAY_UNCHANGED; then
        echo "🧹 Relay rebuilt but binary unchanged — nothing to restart."
    else
        echo "🧹 No Java/Rust/infra changes — skipping build."
    fi
    exit 0
fi

# Pass --profile flags for any profile-gated services in the restart list
PROFILE_FLAG=""
if echo "$SERVICES_TO_RESTART" | grep -q "parity-dashboard"; then
    PROFILE_FLAG="--profile parity"
fi
if echo "$SERVICES_TO_RESTART" | grep -q "prometheus"; then
    PROFILE_FLAG="$PROFILE_FLAG --profile observability"
fi
# --remove-orphans: when a service is renamed or removed (e.g. the
# nginx→caddy consolidation that dropped the separate `caddy` service),
# the old container otherwise lingers and can hold the host ports the new
# one needs — exactly what took prod down on the #19 merge deploy.
if [ -n "$SERVICES_TO_RESTART" ]; then
    docker compose -f "$COMPOSE_FILE" $PROFILE_FLAG up -d --remove-orphans $SERVICES_TO_RESTART >> "$RAW_LOG" 2>&1
fi

if $CADDYFILE_CHANGED; then
    echo "Reloading caddy config..." >> "$RAW_LOG"
    docker compose -f "$COMPOSE_FILE" exec -T manabrew \
        caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >> "$RAW_LOG" 2>&1
fi

BUILD_END=$(date +%s)
BUILD_DURATION=$(( BUILD_END - BUILD_START ))

# ── Pretty summary for Discord ───────────────────────────────────────
SERVICES_FMT=$(echo "$SERVICES_TO_RESTART" | xargs -n1 | sed 's/^/  - /' | tr '\n' '\n')

RELAY_NOTE=""
if $RELAY_UNCHANGED; then
    RELAY_NOTE=$'🛡️ **Relay:** binary unchanged — not restarted, live games preserved\n'
fi

# Build change flags string (with per-stack emoji)
CHANGES=""
$JAVA_CHANGED      && CHANGES="${CHANGES} ☕ Java"
$RUST_CHANGED      && CHANGES="${CHANGES} 🦀 Rust"
$WEB_CHANGED       && CHANGES="${CHANGES} 🌐 Web"
$INFRA_CHANGED     && CHANGES="${CHANGES} 🐳 Infra"
$CADDYFILE_CHANGED && CHANGES="${CHANGES} ⚙️ Caddy"
CHANGES=$(echo "$CHANGES" | xargs)

cat <<EOF
🎉 **Wasm deploy complete** (\`${PREV}\` → \`${CURR}\`)

> ${COMMIT_MSG}
> — ${AUTHOR} (${COMMIT_COUNT} commit(s))

📦 **Changed:** ${CHANGES}
🔁 **Services rebuilt:**
${SERVICES_FMT}
${RELAY_NOTE}⏱️ **Build time:** ${BUILD_DURATION}s
📄 **Log:** \`${RAW_LOG}\`

📝 **Changelog:**
${CHANGELOG}
EOF
