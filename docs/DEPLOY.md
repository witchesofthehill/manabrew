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
curl -I https://<internal-host>/assets/forge_wasm_bg-<hash>.wasm
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
cp forge-engine/crates/forge-server/.env.example .env  # or create manually
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
docker compose -f forge-engine/crates/forge-server/compose.yml build parity-dashboard
docker compose -f forge-engine/crates/forge-server/compose.yml up -d parity-dashboard
```

Dashboard will be at `http://<server-ip>:8080`.

## Auto-Deploy with GitHub Actions

Every push to `main` triggers `.github/workflows/deploy.yml`, which SSHes into
the server, runs `deploy.sh`, and posts a success/failure embed to the
community Discord channel.

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

The repo is public, so the server no longer needs a PAT. On the server:

```bash
cd ~/manabrew
git remote set-url origin https://github.com/<owner>/manabrew.git
git pull --ff-only origin main
```

### 3. Create a Discord webhook

In Discord: **Server Settings → Integrations → Webhooks → New Webhook**. Point
it at the community channel that should receive deploy notifications. Copy the
webhook URL.

### 4. Add the repo secrets

GitHub repo → **Settings → Secrets and variables → Actions → New repository
secret**. Add:

| Secret                       | Value                                                      |
| ---------------------------- | ---------------------------------------------------------- |
| `SSH_HOST`                   | Server hostname or IP                                      |
| `SSH_USER`                   | Login user (the one who owns `~/manabrew` on the server)   |
| `SSH_PORT`                   | Optional — defaults to 22 if unset                         |
| `SSH_PRIVATE_KEY`            | Contents of the **private** key (`~/.ssh/manabrew_deploy`) |
| `DISCORD_DEPLOY_WEBHOOK_URL` | The Discord webhook URL from step 3                        |

### 5. Remove the old GitHub webhook (if any)

GitHub repo → **Settings → Webhooks**. Delete any entry pointing at the old
n8n endpoint (`/webhook/github-deploy`).

### 6. Test it

Trigger manually first: **Actions → Auto deploy → Run workflow → branch `main`**.

Verify:

- The workflow's `Deploy via SSH` step is green.
- The Discord channel receives a green "Deploy complete" embed.
- `docker compose -f forge-engine/crates/forge-server/compose.yml ps` on the
  server shows the expected containers as `Up`.

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

## Useful Commands

```bash
# View logs
docker compose -f forge-engine/crates/forge-server/compose.yml logs -f parity-dashboard

# Restart without rebuild
docker compose -f forge-engine/crates/forge-server/compose.yml restart parity-dashboard

# Full rebuild (no cache)
docker compose -f forge-engine/crates/forge-server/compose.yml build --no-cache parity-dashboard

# Check parity database
docker compose -f forge-engine/crates/forge-server/compose.yml exec parity-dashboard sqlite3 /app/data/parity.db ".tables"
```
