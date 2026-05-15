#!/bin/sh
set -eu

config_path="${MANABREW_CONFIG_PATH:-/srv/manabrew/manabrew-config.js}"

json_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

json_bool() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | on) printf 'true' ;;
    *) printf 'false' ;;
  esac
}

json_port() {
  case "${1:-}" in
    '' | *[!0-9]*) printf '9443' ;;
    *) printf '%s' "$1" ;;
  esac
}

cat > "$config_path" <<EOF
window.MANABREW_CONFIG = {
  serverHost: "$(json_string "${MANABREW_SERVER_HOST:-}")",
  serverPort: $(json_port "${MANABREW_SERVER_PORT:-9443}"),
  serverUsername: "$(json_string "${MANABREW_SERVER_USERNAME:-}")",
  serverPassword: "$(json_string "${MANABREW_SERVER_PASSWORD:-forge}")",
  hostedAiEnabled: $(json_bool "${MANABREW_HOSTED_AI_ENABLED:-false}")
};
EOF

if [ "${MANABREW_WRITE_CONFIG_ONLY:-}" = "1" ]; then
  exit 0
fi

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
