# Deployment Guide

These are operator notes for deploying the manabrew web client and parity
dashboard. They are not required for local development.

## Internal Web Deployment (Twingate + SSO)

For the browser/WASM client, the critical requirement is not public internet exposure, it is preserving cross-origin isolation through every proxy layer. The web game worker uses `SharedArrayBuffer`, so the final browser response must include:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

If your Twingate or SSO layer strips or overrides those headers, browser gameplay will fail even if the app shell loads.

### Internal alpha checklist

- Build and publish with `yarn build:web`
- Serve `dist/` as a static site
- Ensure the final HTML, JS worker, and WASM responses preserve `COOP` and `COEP`
- Verify the app is loaded from a single origin
- Confirm `/wasm/cards-bundle.json` and `/wasm/preset-decks.json` are reachable through the same internal path

### Verify in browser

Open DevTools on the deployed site and check:

```js
window.crossOriginIsolated;
typeof SharedArrayBuffer !== "undefined";
```

Expected result:

- `window.crossOriginIsolated === true`
- `SharedArrayBuffer` is available

The app now also emits a toast and console error when this is misconfigured.

### Verify at the edge

Check the final response headers after Twingate/SSO, not just the origin server:

```bash
curl -I https://<internal-host>/
curl -I https://<internal-host>/assets/game-engine.worker-<hash>.js
curl -I https://<internal-host>/assets/wasm_bg-<hash>.wasm
```

You should see:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

### Nginx example

```nginx
location / {
  add_header Cross-Origin-Opener-Policy same-origin always;
  add_header Cross-Origin-Embedder-Policy credentialless always;
  try_files $uri /index.html;
}
```

### Caddy example

```caddy
header {
  Cross-Origin-Opener-Policy same-origin
  Cross-Origin-Embedder-Policy credentialless
}
```

### Current internal-scope caveats

- The browser card bundle currently covers preset-deck cards, not the full Forge card pool
- The generated bundle still reports two missing preset scripts: `Thrum of the Vestige` and `Leonardo, Big Brother`
- The web path is not offline-capable today
- Scryfall metadata/images are still fetched remotely from the browser

## Prerequisites

- Docker + Docker Compose (with BuildKit support)
- Git
- SSH access to the server from GitHub Actions (see Auto-Deploy section)

## Initial Server Setup

### 1. Clone the repo

```bash
cd ~
git clone git@github.com:<org>/<repo>.git manabrew
cd manabrew
```

### 2. Create a `.env` file

```bash
cp manabrew-rs/crates/manabrew-server/.env.example .env  # or create manually
```

Add your keys:

```env
ANALYZE=1
ANTHROPIC_API_KEY=sk-ant-...
# Or use local LLM:
# OPENAI_API_BASE=http://localhost:8190/v1
# OPENAI_MODEL=qwen3-14b
# OPENAI_API_KEY=not-needed
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
GITHUB_TOKEN=ghp_...          # PAT with `repo` scope — used by the GitHub REST API to create parity issues
GITHUB_REPO=<org>/<repo>
```

### 3. Create preset decks directory

```bash
mkdir -p public/preset_decks/
```

### 4. First build & run

```bash
export DOCKER_BUILDKIT=1
docker compose -f manabrew-rs/crates/manabrew-server/compose.yml build parity-dashboard
docker compose -f manabrew-rs/crates/manabrew-server/compose.yml up -d parity-dashboard
```

Dashboard will be at `http://<server-ip>:8080`.

## Auto-Deploy with GitHub Actions

Every release tag (pushed by the **Release** workflow's `cargo xtask release`
on merges to `main`) triggers **Publish**
(`.github/workflows/publish.yml`): it builds the Tauri installers
(`.dmg` / `.exe` / `.msi`), attaches them plus the updater manifest
(`tauri.json`) to the GitHub Release, and its final `deploy` job SSHes into
the server, runs `deploy.sh` to rebuild the Wasm/web stack (manabrew,
manabrew-server, optional parity-dashboard) under Docker, and posts a
success/failure embed to the community Discord channel via the project's
Discord bot. Deploy runs last so the live site never references release
assets that don't exist yet. Plain `main` commits do not deploy.

### 1. Generate an SSH keypair for the deploy

On any local machine:

```bash
ssh-keygen -t ed25519 -C "manabrew-deploy" -f ~/.ssh/manabrew_deploy -N ""
```

On the **server**, append the **public** half to the deploy user's
`authorized_keys`:

```bash
# (run on the server as the user who owns ~/manabrew)
mkdir -p ~/.ssh && chmod 700 ~/.ssh
cat >> ~/.ssh/authorized_keys < ~/.ssh/manabrew_deploy.pub   # paste here, then Ctrl-D
chmod 600 ~/.ssh/authorized_keys
```

### 2. Confirm the server clone uses the public HTTPS URL

The repo is public, so the server no longer needs a PAT (the deploy script
still rewrites the remote to a PAT URL when `GITHUB_TOKEN` is set in the
host's `.env`, purely to avoid public-API rate limits — optional). On the
server:

```bash
cd <DEPLOY_PATH>     # e.g. /opt/manabrew
git remote set-url origin https://github.com/<owner>/manabrew.git
git pull --ff-only origin main
```

### 3. Prep the Discord bot

Use the bot you've already added to the community server.

1. Grab the **bot token**: [Discord Developer Portal](https://discord.com/developers/applications) → your application → **Bot** → **Reset Token** (if you don't have it saved). Treat this like a password.
2. Enable **Developer Mode** in Discord: **User Settings → Advanced → Developer Mode**.
3. Right-click the channel that should receive deploy notifications → **Copy Channel ID**.
4. Make sure the bot's role has **Send Messages** and **Embed Links** on that channel (**Channel → Edit Channel → Permissions**).

### 4. Add the repo secrets

GitHub repo → **Settings → Secrets and variables → Actions → New repository
secret**. Add:

| Secret                      | Value                                                          |
| --------------------------- | -------------------------------------------------------------- |
| `DEPLOY_HOST`               | Server hostname or IP                                          |
| `DEPLOY_USER`               | Login user (the one who owns the deploy clone)                 |
| `DEPLOY_PATH`               | Absolute path to the repo on the server (e.g. `/opt/manabrew`) |
| `DEPLOY_SSH_KEY`            | Contents of the **private** key (`~/.ssh/manabrew_deploy`)     |
| `DISCORD_BOT_TOKEN`         | Bot token from the Developer Portal                            |
| `DISCORD_DEPLOY_CHANNEL_ID` | ID of the channel that should receive deploy embeds            |

### 5. Remove the old GitHub webhook (if any)

GitHub repo → **Settings → Webhooks**. Delete any entry pointing at the old
n8n endpoint (`/webhook/github-deploy`).

### 6. Test it

The pipeline only runs on release tags, so exercise it end to end: merge any
change to `main`, let the **Release** workflow tag it, and watch the resulting
**Publish** run's final `deploy` job.

Verify:

- The workflow's `SSH and run deploy.sh` step is green.
- The configured Discord channel receives a green "🚀 Wasm deploy successful" embed posted by your bot.
- `docker compose -f compose.production.yml ps` on the server (or the dev
  compose path, if that's what `$COMPOSE_FILE` points to) shows the expected
  containers as `Up`.

## Manual Deploy

```bash
cd ~/manabrew
./deploy.sh
```

The script will:

- `git pull origin main`
- Diff what changed since last deploy
- Only rebuild if Java/Rust/infra files changed
- Restart the container

`manabrew-server` (the relay) gets extra protection because restarting it
kills every live game: after a rebuild, the script compares the
`manabrew-server` binary inside the fresh image (`manabrew-server:production`)
against the one in the running container and skips the restart when they are
identical. Root `Cargo.lock`/`Cargo.toml` churn (release bumps, Tauri/UI
dependency updates) therefore no longer bounces the relay. Changes to the
relay's Dockerfile, any compose file, `.dockerignore`, or `deploy.sh` itself
always rebuild with `--no-cache` and restart, since those can change the
container beyond the binary.

## Useful Commands

```bash
# View logs
docker compose -f manabrew-rs/crates/manabrew-server/compose.yml logs -f parity-dashboard

# Restart without rebuild
docker compose -f manabrew-rs/crates/manabrew-server/compose.yml restart parity-dashboard

# Full rebuild (no cache)
docker compose -f manabrew-rs/crates/manabrew-server/compose.yml build --no-cache parity-dashboard

# Check parity database
docker compose -f manabrew-rs/crates/manabrew-server/compose.yml exec parity-dashboard sqlite3 /app/data/parity.db ".tables"
```

### When the relay does restart

Live games survive a relay restart as long as the game hosts stay up. On
`SIGTERM` the relay broadcasts `ServerShuttingDown` and drains for 10s; after
the restart, hosts (self-hosted nodes and web-hosting browsers) re-register
their rooms via `ResumeRoom` using the `resume_token` from `RoomCreated`, and
guests rejoin their seats and resync. The token guards rooms the relay still
holds; a room the restarted relay has forgotten is resurrected on first claim.

## Investigating relay disconnects

`manabrew-server` exposes a healthcheck on port 9444 (`/health`), and every
disconnect emits a single tagged log line of the form
`[disconnect] user='…' id=… reason=<…> connected_for_s=… room=…`. The reason
attributes the drop to one of: `idle_timeout`, `read_error`, `stream_closed`,
`client_close`, `writer_stopped`, `writer_failed`. Combined with the browser
`[relay-disconnect]` console log on the client side, this is what we use to
attribute "relay disconnected" reports to a specific cause.

### Quick status

```bash
# Container health (look for "healthy"; "unhealthy" means /health failed
# 3× in a row → Docker will restart it under restart: unless-stopped).
docker compose -f compose.production.yml ps

# Live resource usage. Sustained RSS near the 1g mem_limit, or CPU pinned
# at 150%, indicates we're hitting the limits we set.
docker stats --no-stream
```

### OOM kills

```bash
# Anything from oom_reaper or the kernel? Hetzner VMs surface OOM in dmesg
# even when Docker's "OOMKilled: true" is missed.
journalctl -u docker -k --since "1h ago" | grep -iE 'oom|killed process'
```

### Disconnect reason tally

```bash
# Histogram of disconnect reasons over the last hour. If `idle_timeout`
# dominates we're losing connections in the network path (Hetzner NAT,
# Caddy, kernel). If `client_close` dominates it's clean exits — not a
# reliability problem.
docker compose -f compose.production.yml logs --since 1h manabrew-server \
  | grep '\[disconnect\]' \
  | sed -n 's/.*reason=\([a-z_]*\).*/\1/p' \
  | sort | uniq -c | sort -rn
```

### Health probe from outside

```bash
# Direct probe against the container's health port (only reachable from
# inside the docker network):
docker compose -f compose.production.yml exec manabrew-server curl -fsS http://localhost:9444/health
```
