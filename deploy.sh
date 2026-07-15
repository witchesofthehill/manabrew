#!/usr/bin/env bash
# deploy.sh — Smart rollout of the Wasm/web stack on the production host.
# Scope: pulls + rolls out manabrew (Wasm + React, served by caddy),
# manabrew-server, manabrew-hub, and optionally parity-dashboard. Native
# Tauri installers (.dmg / .exe) are built separately by
# .github/workflows/publish.yml.
#
# Invocations (all from publish.yml over SSH, or manually on the host):
#   ./deploy.sh                          full rollout of whatever main has
#   HOLD_MANIFEST=1 ./deploy.sh          early rollout (deploy-web job): same,
#                                        but keeps serving the previous
#                                        release's /manifest.json until the
#                                        installers are published
#   ./deploy.sh --release-manifest vX.Y.Z
#                                        flip the served /manifest.json to
#                                        that tag's (final deploy job, after
#                                        the Release has its assets)
#   ./deploy.sh --only grafana           pull + recreate just the named
#                                        compose service(s); no change
#                                        classification, no early-exit
#   FORCE_DEPLOY=1 ./deploy.sh           skip the "no new commits" early exit
#                                        (recovery after a failed early run)
#
# stdout = clean summary (captured by the workflow and posted to Discord).
# Raw output goes to /tmp/deploy-raw.log.
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
# Branch this host tracks. Production pulls main; the staging VM sets
# DEPLOY_BRANCH=staging (staging-deploy.yml) to run the identical rollout off
# the staging branch.
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
# Bind-mounted Caddyfile this host serves; the staging VM overrides it so a
# staging.Caddyfile edit is detected and reloaded like ops/Caddyfile is on prod.
CADDYFILE_PATH="${CADDYFILE_PATH:-ops/Caddyfile}"
RAW_LOG="/tmp/deploy-raw.log"

HOLD_MARKER="ops/.manifest-hold"

# ── Manifest release mode ────────────────────────────────────────────
# (Appends to RAW_LOG without truncating: this runs right after a full
# deploy in the same SSH command, and must not wipe that deploy's log.)
# Run by publish.yml's final deploy job once the tag's installers are
# attached to the GitHub Release. Writes that tag's ops/manifest.json bytes
# in place — the file is single-file bind-mounted into caddy, so replacing it
# (rename/git checkout) would strand the mount on the old inode — and drops
# the hold left by an early HOLD_MANIFEST=1 deploy. With two releases in
# flight the hold advances to this tag instead: the served manifest never
# gets ahead of the newest release whose installers actually exist.
if [ "${1:-}" = "--release-manifest" ]; then
    TAG="${2:?usage: deploy.sh --release-manifest <tag>}"
    git fetch origin tag "$TAG" --no-tags >> "$RAW_LOG" 2>&1 || true
    git show "${TAG}:ops/manifest.json" > ops/manifest.json
    if [ "$(git rev-parse "${TAG}^{commit}")" = "$(git rev-parse HEAD)" ]; then
        rm -f "$HOLD_MARKER"
        echo "📣 Served /manifest.json released for ${TAG}."
    else
        git rev-parse --short "${TAG}^{commit}" > "$HOLD_MARKER"
        echo "📣 Served /manifest.json advanced to ${TAG}; hold kept (HEAD is newer)."
    fi
    exit 0
fi

# ── Single-service mode ──────────────────────────────────────────────
# `deploy.sh --only <service> [service...]` pulls the latest config (git) and
# image, then recreates just the named services — e.g. `--only grafana` after
# a dashboard/provisioning change, without touching the relay or web. The
# actual work happens after the shared pull/hold handling below.
ONLY_SERVICES=""
if [ "${1:-}" = "--only" ]; then
    shift
    [ $# -gt 0 ] || { echo "usage: deploy.sh --only <service> [service...]"; exit 1; }
    ONLY_SERVICES="$*"
fi

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
# An active manifest hold leaves ops/manifest.json rewritten to an older
# release's bytes, which would make the --ff-only pull bail when the incoming
# release commit touches the same file. Restore HEAD's bytes in place first;
# the hold is re-applied right after the pull.
if [ -f "$HOLD_MARKER" ]; then
    git show HEAD:ops/manifest.json > ops/manifest.json
fi

# DEPLOY_ORIG_PREV preserves the pre-pull commit across the self-update re-exec
# below, so the re-run still deploys the right range instead of early-exiting as
# "no new commits".
PREV="${DEPLOY_ORIG_PREV:-$(git rev-parse --short HEAD)}"
git pull origin "$DEPLOY_BRANCH" --ff-only >> "$RAW_LOG" 2>&1
CURR=$(git rev-parse --short HEAD)

# Self-update: the pull may have changed this very script. deploy.sh is already
# loaded into memory, so without this the *old* logic runs and script edits only
# take effect the NEXT deploy — exactly how the Ironsmith submodule checkout was
# missed and the runtime shipped dark on its first deploy. Re-exec the updated
# script once (guarded so it can't loop).
if [ -z "${DEPLOY_ORIG_PREV:-}" ] && [ "$PREV" != "$CURR" ] \
   && ! git diff --quiet "${PREV}..${CURR}" -- deploy.sh; then
    echo "deploy.sh changed in this pull — re-exec'ing the updated script" >> "$RAW_LOG"
    export DEPLOY_ORIG_PREV="$PREV"
    exec bash "$0" "$@"
fi

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

# ── Manifest hold (early deploys) ────────────────────────────────────
# HOLD_MANIFEST=1 (publish.yml's deploy-web job) rolls the stack out ahead of
# the installer builds. Installed apps poll /manifest.json to detect they are
# behind, and /tauri.json redirects to the *latest* GitHub Release's assets —
# which don't exist yet at that point. So keep serving the pre-pull release's
# manifest (in-place write: the file is single-file bind-mounted into caddy)
# until `deploy.sh --release-manifest <tag>` releases it. An existing hold is
# never advanced here: with two releases in flight, the served manifest stays
# at the oldest one whose installers are fully published.
if [ -n "${HOLD_MANIFEST:-}" ] && [ ! -f "$HOLD_MARKER" ]; then
    git rev-parse --short "$PREV" > "$HOLD_MARKER"
fi
if [ -f "$HOLD_MARKER" ]; then
    git show "$(cat "$HOLD_MARKER"):ops/manifest.json" > ops/manifest.json
    echo "/manifest.json held at $(cat "$HOLD_MARKER") until the installers publish" >> "$RAW_LOG"
fi

# ── Single-service rollout (--only) ──────────────────────────────────
if [ -n "$ONLY_SERVICES" ]; then
    PROFILE_FLAG=""
    case " $ONLY_SERVICES " in *" parity-dashboard "*) PROFILE_FLAG="--profile parity" ;; esac
    case " $ONLY_SERVICES " in
        *" grafana "*|*" prometheus "*|*" loki "*|*" alloy "*|*" pushgateway "*|*" events-ingester "*)
            PROFILE_FLAG="$PROFILE_FLAG --profile observability" ;;
    esac
    echo "Pulling images for: $ONLY_SERVICES" >> "$RAW_LOG"
    # shellcheck disable=SC2086
    docker compose -f "$COMPOSE_FILE" $PROFILE_FLAG pull --quiet $ONLY_SERVICES >> "$RAW_LOG" 2>&1 || true
    # --force-recreate: these services' configs are bind-mounted (grafana
    # provisioning, prometheus rules, ...), so `up -d` alone would consider an
    # unchanged image up-to-date and never pick the new config up.
    # shellcheck disable=SC2086
    docker compose -f "$COMPOSE_FILE" $PROFILE_FLAG up -d --no-deps --force-recreate $ONLY_SERVICES >> "$RAW_LOG" 2>&1
    echo "🎯 **Single-service rollout complete** (\`${CURR}\`)"
    echo "🔁 Recreated: ${ONLY_SERVICES}"
    echo "📄 **Log:** \`${RAW_LOG}\`"
    exit 0
fi

if [ "$PREV" = "$CURR" ] && [ -z "${FORCE_DEPLOY:-}" ]; then
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
# manabrew-hub (deck hub API) — stateless HTTP over sqlite, so a restart is
# harmless; no binary-diff gate needed. Same over-triggering closure filter.
HUB_CHANGED=false
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
        manabrew-rs/crates/manabrew-hub/*|manabrew-rs/crates/manabrew-protocol/*|Cargo.toml|Cargo.lock)
            HUB_CHANGED=true ;;
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
        "$CADDYFILE_PATH")
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

# -- ghcr images: manabrew (web), manabrew-server (relay), manabrew-hub --
# These are built + pushed by CI (docker-images.yml) on the same release tag and
# pulled here instead of built locally (the web image is a ~1h WASM+Vite build
# that no longer fits the prod host's disk). Pull with retry: the image workflow
# runs in parallel with this deploy, so the new images may not be pushed yet.
RELAY_UNCHANGED=false
echo "Pulling ghcr images (manabrew manabrew-server manabrew-hub)..." >> "$RAW_LOG"
PULLED=false
for attempt in $(seq 1 40); do
    if docker compose -f "$COMPOSE_FILE" pull --quiet manabrew manabrew-server manabrew-hub >> "$RAW_LOG" 2>&1; then
        PULLED=true; break
    fi
    echo "  pull attempt $attempt failed (CI images not pushed yet?); retrying in 30s" >> "$RAW_LOG"
    sleep 30
done
$PULLED || { echo "❌ ghcr image pull failed after retries — aborting deploy."; exit 1; }

# A service needs recreating only when the pulled image differs from what its
# container is running — otherwise `up -d` would needlessly churn it (a web
# recreate briefly blips Caddy; a relay recreate drops every live game).
image_changed() {  # $1 service, $2 image ref
    local cid running pulled
    cid=$(docker compose -f "$COMPOSE_FILE" ps -q "$1" 2>/dev/null || true)
    [ -z "$cid" ] && return 0
    running=$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null || echo "")
    pulled=$(docker image inspect --format '{{.Id}}' "$2" 2>/dev/null || echo "x")
    [ "$running" != "$pulled" ]
}
GHCR_TAG="${MANABREW_IMAGE_TAG:-latest}"
image_changed manabrew "ghcr.io/witchesofthehill/manabrew-web:${GHCR_TAG}" \
    && SERVICES_TO_RESTART="$SERVICES_TO_RESTART manabrew"
image_changed manabrew-hub "ghcr.io/witchesofthehill/manabrew-hub:${GHCR_TAG}" \
    && SERVICES_TO_RESTART="$SERVICES_TO_RESTART manabrew-hub"

# Relay: extra-conservative — restart only when the actual binary differs (an
# image-digest change from an unrelated base bump must not kill live games).
RELAY_IMAGE="ghcr.io/witchesofthehill/manabrew-server:${GHCR_TAG}"
RELAY_CID=$(docker compose -f "$COMPOSE_FILE" ps -q manabrew-server 2>/dev/null || true)
if [ -n "$RELAY_CID" ]; then
    RELAY_OLD_IMAGE=$(docker inspect --format '{{.Image}}' "$RELAY_CID")
    OLD_SHA=$(docker run --rm --entrypoint sha256sum "$RELAY_OLD_IMAGE" /usr/local/bin/manabrew-server 2>> "$RAW_LOG" | cut -d' ' -f1 || true)
    NEW_SHA=$(docker run --rm --entrypoint sha256sum "$RELAY_IMAGE" /usr/local/bin/manabrew-server 2>> "$RAW_LOG" | cut -d' ' -f1 || true)
    if [ -n "$OLD_SHA" ] && [ "$OLD_SHA" = "$NEW_SHA" ]; then
        RELAY_UNCHANGED=true
        echo "manabrew-server binary unchanged (${NEW_SHA:0:12}) — relay not restarted" >> "$RAW_LOG"
    else
        SERVICES_TO_RESTART="$SERVICES_TO_RESTART manabrew-server"
    fi
else
    SERVICES_TO_RESTART="$SERVICES_TO_RESTART manabrew-server"
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
    # Snapshot each service's current image so an unhealthy rollout can be rolled
    # back to the last-good one. GHCR_REF maps the pulled services to the tag we
    # re-point on rollback.
    declare -A ROLLBACK_IMG=()
    declare -A GHCR_REF=(
        [manabrew]="ghcr.io/witchesofthehill/manabrew-web:${GHCR_TAG:-latest}"
        [manabrew-server]="ghcr.io/witchesofthehill/manabrew-server:${GHCR_TAG:-latest}"
        [manabrew-hub]="ghcr.io/witchesofthehill/manabrew-hub:${GHCR_TAG:-latest}"
    )
    for svc in $SERVICES_TO_RESTART; do
        cid=$(docker compose -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null || true)
        [ -n "$cid" ] && ROLLBACK_IMG[$svc]=$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null || true)
    done

    # --no-deps: recreate only the listed services, never their dependencies as a
    # side effect (an `up manabrew` without this recreates the relay it
    # depends_on — dropping live games, and aborting the deploy if the relay tag
    # is ever missing). --wait: block until healthchecks pass.
    if docker compose -f "$COMPOSE_FILE" $PROFILE_FLAG up -d --no-deps --remove-orphans --wait --wait-timeout 180 $SERVICES_TO_RESTART >> "$RAW_LOG" 2>&1; then
        echo "✅ rollout healthy: $SERVICES_TO_RESTART" >> "$RAW_LOG"
    else
        echo "⚠️ rollout unhealthy — rolling back to the previous images" | tee -a "$RAW_LOG"
        ROLLED=""
        for svc in $SERVICES_TO_RESTART; do
            ref="${GHCR_REF[$svc]:-}"; old="${ROLLBACK_IMG[$svc]:-}"
            if [ -n "$ref" ] && [ -n "$old" ]; then
                docker tag "$old" "$ref" >> "$RAW_LOG" 2>&1 && ROLLED="$ROLLED $svc"
            fi
        done
        if [ -n "$ROLLED" ]; then
            docker compose -f "$COMPOSE_FILE" $PROFILE_FLAG up -d --no-deps $ROLLED >> "$RAW_LOG" 2>&1 || true
            echo "↩️ rolled back:$ROLLED" | tee -a "$RAW_LOG"
        fi
        exit 1
    fi
fi

if $CADDYFILE_CHANGED; then
    echo "Reloading caddy config ($CADDYFILE_PATH)..." >> "$RAW_LOG"
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

HOLD_NOTE=""
if [ -f "$HOLD_MARKER" ]; then
    HOLD_NOTE=$'🔒 **Manifest:** held at previous release until the installers publish\n'
fi

# Build change flags string (with per-stack emoji)
CHANGES=""
$JAVA_CHANGED      && CHANGES="${CHANGES} ☕ Java"
$RUST_CHANGED      && CHANGES="${CHANGES} 🦀 Rust"
$WEB_CHANGED       && CHANGES="${CHANGES} 🌐 Web"
$HUB_CHANGED       && CHANGES="${CHANGES} 🗂️ Hub"
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
${RELAY_NOTE}${HOLD_NOTE}⏱️ **Build time:** ${BUILD_DURATION}s
📄 **Log:** \`${RAW_LOG}\`

📝 **Changelog:**
${CHANGELOG}
EOF
