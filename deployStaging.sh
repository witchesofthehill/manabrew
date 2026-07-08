#!/usr/bin/env bash
# deployStaging.sh — Deploy a branch to the staging preview stack
# (compose.staging.yml) without merging to main. Unlike deploy.sh (which only
# ever deploys main and no-ops when there are no new commits), this always
# rebuilds the staging web image from the target branch and refreshes the
# container, so a feature branch — and runtime toggles like DESIGN_SYSTEM — take
# effect immediately.
#
# Usage:
#   STAGING_BRANCH=feat/design-system-page DESIGN_SYSTEM=1 ./deployStaging.sh
#   # STAGING_BRANCH defaults to the currently checked-out branch.
#   # DESIGN_SYSTEM=1 exposes the /design-system route on the preview.
#
# Requires MANABREW_SERVER_KEY (from ./.env or the environment) — the staging
# build/relay need it.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-compose.staging.yml}"
STAGING_BRANCH="${STAGING_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

if [ -f "$REPO_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$REPO_DIR/.env"
    set +a
fi

echo "🚚 Staging deploy: branch '$STAGING_BRANCH' (DESIGN_SYSTEM=${DESIGN_SYSTEM:-unset})"

# ── Check out + fast-forward the target branch ───────────────────────
git fetch origin "$STAGING_BRANCH"
git checkout "$STAGING_BRANCH"
git pull --ff-only origin "$STAGING_BRANCH"
# Forge submodule holds the card data the web cardset archive is built from.
git submodule sync --recursive || true
git submodule update --init --recursive

# ── Build + (re)start the staging stack ──────────────────────────────
export DOCKER_BUILDKIT=1
export BUILDKIT_PROGRESS=plain
BUILD_ARGS="--build-arg GIT_COMMIT_SHA=$(git rev-parse --short HEAD)"

echo "🔨 Building staging web image…"
docker compose -f "$COMPOSE_FILE" build $BUILD_ARGS manabrew-staging

echo "🚀 Bringing up the staging stack…"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
# Force-recreate only the web container so its entrypoint re-emits config.js
# (relay/node keep running — --no-deps leaves them untouched).
docker compose -f "$COMPOSE_FILE" up -d --force-recreate --no-deps manabrew-staging

echo "✅ Staging updated to '$STAGING_BRANCH' ($(git rev-parse --short HEAD))."
