#!/usr/bin/env bash
# Run by the staging deploy webhook (ops/staging-deploy-hook.json via
# adnanh/webhook) once GitHub's push to `staging` passes HMAC verification.
# Runs the production deploy.sh pointed at staging and posts its summary to
# Discord. flock serialises overlapping pushes; deploy.sh early-exits the
# redundant ones as "no new commits".
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

exec 9>/tmp/staging-deploy-hook.lock
flock 9

SUMMARY="$(DEPLOY_BRANCH=staging MANABREW_IMAGE_TAG=staging \
  COMPOSE_FILE=compose.staging.yml CADDYFILE_PATH=ops/staging.Caddyfile \
  ./deploy.sh 2>&1)" || SUMMARY="${SUMMARY}"$'\n💥 deploy.sh exited non-zero — see /tmp/deploy-raw.log'

printf '%s\n' "$SUMMARY"

if [ -n "${DISCORD_WEBHOOK_URL:-}" ] && command -v python3 >/dev/null 2>&1; then
  printf '%s' "$SUMMARY" \
    | python3 -c 'import json,sys; print(json.dumps({"content": sys.stdin.read()[:1900] or "staging deploy: (no output)"}))' \
    | curl -sf -H "Content-Type: application/json" -d @- "$DISCORD_WEBHOOK_URL" >/dev/null 2>&1 || true
fi
