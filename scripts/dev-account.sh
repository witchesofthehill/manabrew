#!/usr/bin/env bash
# Local-only helper to fake hub accounts for testing the handle/username flow.
# SSO needs real OAuth apps and email needs a RESEND_API_KEY, so for local work
# we write straight into the dev hub.db. Not for any shared/remote environment.
#
#   ./scripts/dev-account.sh create <handle>   # new account + session, prints console JS
#   ./scripts/dev-account.sh login  <handle>   # fresh session for an existing account
#   ./scripts/dev-account.sh delete <handle>   # remove account (+ its sessions/decks)
#   ./scripts/dev-account.sh list              # list accounts
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="$ROOT/ops/hub-data/dev/hub.db"
COMPOSE=(docker compose -f "$ROOT/compose.dev.yaml")

command -v sqlite3 >/dev/null || { echo "sqlite3 not found on PATH"; exit 1; }
[ -f "$DB" ] || { echo "no dev hub.db at $DB — start the stack once so migrations run"; exit 1; }

sha256() { printf %s "$1" | { command -v sha256sum >/dev/null && sha256sum || shasum -a 256; } | cut -d' ' -f1; }

hub_running() { [ -n "$(docker ps -q -f name=manabrew-hub-1 -f status=running)" ]; }

# Host writes must not race the hub's SQLite lock across the bind mount, so
# release it (stop just the hub) for the write, then bring it back.
db_write() {
  local restart=0 rc=0
  if hub_running; then "${COMPOSE[@]}" stop hub >/dev/null 2>&1 && restart=1; fi
  sqlite3 "$DB" "$@" || rc=$?
  [ "$restart" = 1 ] && "${COMPOSE[@]}" start hub >/dev/null 2>&1
  return $rc
}

print_session() {
  local token="$1"
  cat <<EOF

Session ready. Paste this in the browser console at http://localhost:1420 :

  localStorage.setItem('manabrew-auth-storage', JSON.stringify({state:{refreshToken:'$token'},version:1}));location.reload();
EOF
}

new_session() {
  local handle="$1"
  local token="dev-${handle}-$(date +%s)"
  db_write "
    PRAGMA foreign_keys=ON;
    INSERT INTO sessions (token_hash, account_id, created_at, expires_at)
    SELECT '$(sha256 "$token")', id, strftime('%Y-%m-%dT%H:%M:%SZ','now'), '2030-01-01T00:00:00Z'
    FROM accounts WHERE handle='$handle' COLLATE NOCASE;
  "
  print_session "$token"
}

cmd="${1:-}"; handle="${2:-}"
case "$cmd" in
  create)
    [ -n "$handle" ] || { echo "usage: dev-account.sh create <handle>"; exit 1; }
    db_write "INSERT INTO accounts (id, handle, handle_set, created_at)
              VALUES ('acct-$handle', '$handle', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'));" \
      || { echo "handle '$handle' already exists — use 'login' to get a session"; exit 1; }
    echo "created account @$handle"
    new_session "$handle"
    ;;
  login)
    [ -n "$handle" ] || { echo "usage: dev-account.sh login <handle>"; exit 1; }
    [ -n "$(sqlite3 "$DB" "SELECT 1 FROM accounts WHERE handle='$handle' COLLATE NOCASE;")" ] \
      || { echo "no account @$handle — create it first"; exit 1; }
    new_session "$handle"
    ;;
  delete)
    [ -n "$handle" ] || { echo "usage: dev-account.sh delete <handle>"; exit 1; }
    db_write "PRAGMA foreign_keys=ON; DELETE FROM accounts WHERE handle='$handle' COLLATE NOCASE;"
    echo "deleted account @$handle"
    ;;
  list)
    sqlite3 -header -column "$DB" "SELECT handle, handle_set, created_at FROM accounts ORDER BY created_at;"
    ;;
  *)
    echo "usage: dev-account.sh {create|login|delete <handle> | list}"; exit 1
    ;;
esac
