# Deployment Guide

These are operator notes for deploying the manabrew web client and parity
dashboard. They are not required for local development.

## Internal Web Deployment (Twingate + SSO)

For the browser/WASM client, the critical requirement is not public internet exposure, it is preserving cross-origin isolation through every proxy layer. The web game worker uses `SharedArrayBuffer`, so the final browser response must include:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
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
Cross-Origin-Embedder-Policy: require-corp
```

### Nginx example

```nginx
location / {
  add_header Cross-Origin-Opener-Policy same-origin always;
  add_header Cross-Origin-Embedder-Policy require-corp always;
  try_files $uri /index.html;
}
```

### Caddy example

```caddy
header {
  Cross-Origin-Opener-Policy same-origin
  Cross-Origin-Embedder-Policy require-corp
}
```

### Current internal-scope caveats

- The browser card bundle currently covers preset-deck cards, not the full Forge card pool
- The generated bundle still reports two missing preset scripts: `Thrum of the Vestige` and `Leonardo, Big Brother`
- The web path is not offline-capable today
- Scryfall metadata/images are fetched by the browser directly from Scryfall or the asset bucket. Never put a proxy in front of image data; see `src/AGENTS.md`.

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
(`.dmg` / `.exe` / `.msi`), attaches them plus the updater manifests
(`tauri.json`, `manifest.json`) to the GitHub Release, and its deploy jobs
run `cargo xtask deploy` FROM THE RUNNER at the tag checkout: rsync the
tracked config to the box, pull this release's ghcr images, reconcile with
docker compose (health-checked, redeploying the previous tag on failure),
and post a success/failure embed to the community Discord channel. The box
holds no deploy scripts and its git checkout is never consulted, so config
and images always come from the same commit. The full deploy runs last so
the live site never references release assets that don't exist yet. Plain
`main` commits do not deploy.

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

### 2. Box prerequisites

The box needs docker + compose, the data dirs under `<DEPLOY_PATH>` (ops/
hub-data, ops/observability/data), and the `.env` with the compose secrets.
It does NOT need a usable git checkout: `xtask deploy` rsyncs the tracked
config files (compose.production.yml, ops/, scripts/ingest-events.py) at the
release tag before every rollout, and never runs git on the box.

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

- The workflow's `Deploy production (xtask, from the runner)` step is green.
- The configured Discord channel receives a green "🚀 Wasm deploy successful" embed posted by your bot.
- `docker compose -f compose.production.yml ps` on the server (or the dev
  compose path, if that's what `$COMPOSE_FILE` points to) shows the expected
  containers as `Up`.

## Manual Deploy

From any machine with SSH access to the box (the runner does exactly this).
No Rust toolchain? Every release attaches the tool prebuilt
(`manabrew-xtask-linux-x86_64`, static musl) — an **evergreen** binary: it
fetches the deployed ref's config from GitHub at run time (codeload
tarball, tracked files only), so one download deploys any release and
needs **no checkout and no git** — just ssh, rsync, curl and tar on the
machine. Rollback is `deploy --tag <older>` from the same binary. If a
future release changes the deploy contract, `ops/deploy-tool-version` in
the fetched config makes the old binary refuse with a download hint.
`--ref <sha>` pins the config fetch exactly; `--config-from <dir>` uses a
local checkout instead (airgap):

```bash
# full rollout of a release tag
git checkout vX.Y.Z
cargo xtask deploy --tag vX.Y.Z --host <ssh-host> --path /opt/manabrew

# recreate one bind-mount-configured service (e.g. after a grafana
# provisioning change), no tag checkout required
cargo xtask deploy --tag vX.Y.Z --only grafana --host <ssh-host> --path /opt/manabrew

# the staging slot (what staging-deploy.yml runs)
cargo xtask deploy --staging --branch <branch> --host <ssh-host> --path /opt/manabrew-staging

# build + run THIS checkout on THIS machine (selfhost VM / laptop)
cargo xtask deploy --local
```

The command rsyncs the tracked config at the tag, pulls the tag's images
(waiting out CI if they are still building), reconciles with
`docker compose up -d --wait`, and redeploys the previously running tag if
the rollout comes up unhealthy.

`manabrew-server` (the relay) gets extra protection because restarting it
kills every live game: xtask compares the `manabrew-server` binary inside the
freshly pulled image against the one in the running container and skips the
restart when they are identical. Root `Cargo.lock`/`Cargo.toml` churn
(release bumps, Tauri/UI dependency updates) therefore never bounces the
relay.

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

## iOS distribution (SideStore)

The iOS app ships as an **unsigned IPA** sideloaded via [SideStore](https://sidestore.io), which re-signs on-device with the user's own Apple ID (no paid Apple Developer account required; free accounts get a 7-day refresh cycle).

**How it's published.** `publish.yml`'s `ios-ipa` job builds the IPA on `macos-latest` with `yarn tauri ios build --no-sign`, and the `deploy-sidestore` job (after the web deploy) regenerates `apps.json` (`scripts/gen-sidestore-source.mjs`) and rsyncs it plus `Manabrew-<version>.ipa` and `icon.png` to the host's `ops/sidestore/`. That dir is bind-mounted into the caddy container at `/srv/manabrew/sidestore` and served under `play.manabrew.app/sidestore/`.

Unreferenced `Manabrew-*.ipa` files older than 30 days are removed after a successful upload. Installers referenced by `apps.json` are always retained; cleanup refuses to run if any referenced installer is missing.

**Add the source in SideStore:** Sources → **+** → `https://play.manabrew.app/sidestore/apps.json` → Browse → **Manabrew** → Install.

**Build one locally** (macOS + Xcode required):

```bash
yarn build:wasm
yarn tauri ios build --no-sign
# → src-tauri/gen/apple/build/arm64/Manabrew.ipa
```

Mobile builds skip the GraalVM/Maven harness (`tauri.{ios,android}.conf.json` override `beforeBuildCommand`) and do **not** bundle the desktop-only 64 MB Forge runtime — only `cardset.rkyv` ships. On Android that archive is embedded in the binary (`card_db.rs`), because the APK `asset://` path can't be mmap'd. See `src-tauri/AGENTS.md`.

### Android APK

`publish.yml`'s `android-apk` job builds an arm64 APK (`node scripts/mobile-dev.mjs android build --apk --target aarch64`) on `ubuntu-latest` and the `release` job attaches it to the GitHub Release alongside the desktop installers. The release APK is **unsigned** — installing it requires signing with a keystore (wire an `ANDROID_KEYSTORE` secret + a signing step to ship an installable build).

## Frontend error reporting

Reporting defaults on in managed production/staging Compose and official macOS, Windows, iOS, and Android builds. Generic images and local builds stay off. Explicit `false` remains the kill switch. Reports contain only allowlisted error/build/platform/engine/normalized-route/code-location metadata, with no account, user, device, game, or session IDs, SDK session metadata, or persistent diagnostic identity. This covers frontend exceptions and forwarded engine failures, not native process crash dumps. Default-on settings do not mark the manual rollout checks below as complete.

Create DNS for `telemetry.manabrew.app` pointing to the existing ingress. Caddy terminates HTTPS and exposes only `/collect` for approved origins. Alloy's receiver, administration API, metrics, and private maps stay internal. The collector accepts at most 256 KiB per request and 20 POST requests/second globally, with burst 40. Stock Caddy has no configured per-client rate limiter. CORS is not authentication, and client-supplied app/environment metadata is untrusted.

Managed web configuration comes from the container environment:

| Variable             | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `FARO_ENABLED`       | Managed Compose defaults to `true`; `false` disables |
| `FARO_COLLECTOR_URL` | HTTPS endpoint ending exactly in `/collect`          |
| `FARO_ENVIRONMENT`   | `production`, `staging`, or `development`            |

Production/staging Compose set separate environments, the managed collector URL, and `FARO_ENABLED=true` by default. Recreate the web container through the normal tag-pinned deployment flow after changing settings. Generic images and ordinary local builds remain off. `ops/web-entrypoint.sh` writes safely serialized `window.__MANABREW_RUNTIME__.observability`; explicit runtime disable overrides compiled settings. Reload the frontend after changes because initialization is one-shot.

Official macOS, Windows, iOS, and Android jobs set the equivalent `VITE_FARO_*` variables in `publish.yml`, with `VITE_FARO_ENABLED=true`. Packaged settings require a new build to change. Each platform still needs its manual verification before release. The approved origins include Tauri origins and the packaged macOS/Linux asset-server origin `http://localhost:9527`. Keep ingress and Alloy origin lists in sync with any asset-server change.

### Private source maps

Vite generates hidden maps and removes them from `dist/` before packaging. The identity is `<manifest-app-version>-<40-character-checkout-SHA>-<variant>`; variants distinguish `web`, `staging-web`, `macos-arm64`, `windows-x86-64`, `ios-aarch64`, and `android-aarch64`. Local builds use `local-development`. Keep `__APP_VERSION__` sourced from `ops/manifest.json`.

`target/faro-sourcemaps/<build-id>/` contains the exact emitted maps, relative asset paths, and a SHA-256 manifest. Main bundles, compiled workers, and nested Card Glint chunks retain their own paths. Worker shared chunks use `assets/worker-*` to prevent main/worker source-map collisions. Raw unminified Forge assets may remain unsymbolicated. `scripts/build-faro-web.mjs` exports runtime and maps from one Buildx Bake graph, so maps cannot come from a second rebuild.

CI transfers private maps with the existing deployment SSH credentials before web rollout or public installer publication. The host needs Python 3 and rsync in addition to existing Docker prerequisites. Publication checksum-validates artifacts, rejects symlinks, and atomically renames immutable release directories into `<DEPLOY_PATH>/ops/observability/data/sourcemaps/`. Staging maps go to the production observability store because staging uses the shared collector. Source-map artifacts are authenticated Actions artifacts with seven-day retention, never GitHub Release assets.

Restore Cargo caches **before** downloading maps under `target/`; partial `rust-cache` restores can delete non-Cargo files there. Public web runtime registry caches use `mode=min`. Cache warming ends at the pre-frontend `builder` stage; exporting frontend build layers with `mode=max` would publish private maps.

Alloy mounts the store read-only at `/var/lib/faro/sourcemaps`. Reports canonicalize compiled asset URLs to `app:///assets/...`; `app.release` selects the build directory. Downloads are disabled, including on misses. Alloy `v1.9.1` caches successful maps and misses without expiry or an entry limit. Publish maps before the first report from a release; restart Alloy after repairing a missed map or replacing unpublished local-development maps. Monitor memory across active releases; the 256 MiB initial container limit is not a bounded-cache guarantee.

Retain old directories for the supported lifetime of installed clients and rollback, not merely Loki's 30-day event retention. Deployment synchronization preserves the data directory. Do not prune source maps as part of image, installer, or event-log cleanup.

### Rollout and rollback

1. For first rollout, hold web clients off with `FARO_ENABLED=false` while deploying the collector and private map mount. Check DNS/TLS, approved-origin preflight, private metrics, and authenticated Grafana access.
2. Publish exact maps, then remove the staging override to restore its default-on setting. Inspect identifier-free stored events, source locations, queue behavior, and resource use.
3. Obtain manual browser/PWA checks and finalize notice, legal basis, and any required consent or opt-out. A deployment flag is not consent.
4. Remove the managed production override after acceptance. Publish each default-on packaged target only after its maps and manual WebView checks are complete.

Disable web reporting by setting `FARO_ENABLED=false`, recreating its container, and reloading the frontend. Packaged settings are compiled; stop their collection by closing the collector route until an updated package ships. Preserve maps and existing backend logging. See [OBSERVABILITY.md](OBSERVABILITY.md) for event fields, query examples, alert thresholds, and local collection.
