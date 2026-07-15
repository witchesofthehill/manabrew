# Staging Workflow

Staging is a **mirror of production**. It runs on its own VM — a separate
machine with its own SSH key and its own DNS — but it is deployed by the exact
same engine as production: the identical `deploy.sh` smart rollout, the same
four ghcr images (built per-push, tagged `:staging` instead of the release
`latest`), and a `compose.staging.yml` that clones `compose.production.yml`
service-for-service (web + relay + hub + hosted node, its own TLS edge). The
only differences are the branch it tracks, the image tag, and the hostnames —
nothing behavioural.

Its purpose: give changes a production-shaped home to bake in **before** they
reach real users, so a backend-breaking or infra-breaking change is caught on a
box that looks exactly like prod but isn't prod.

## The loop

```
  local branch ──(PR / merge)──▶ staging ──(auto)──▶ staging environment
                                    ▲
                                    │ merge latest main in
                                    │
  main ──(every merge)─────────────┘
```

1. **Develop on a local feature branch.** Normal work, normal PRs.
2. **Merge the feature branch into `staging`.** This is what puts a change in
   front of the staging environment. A change can go to `staging` before its
   PR to `main` has landed, so it can be exercised end-to-end while review is
   still in flight.
3. **`staging` deploys automatically.** Any push to `staging` does two things in
   parallel: `.github/workflows/staging-deploy.yml` builds + pushes the
   `:staging` images to ghcr, and a **GitHub push webhook** POSTs to the staging
   VM, where a receiver runs the production `deploy.sh` against the `staging`
   branch. `deploy.sh`'s ghcr pull-retry waits out the image build, so the two
   self-order. See [Deploy trigger](#deploy-trigger-github-webhook) for why it's
   a webhook and not SSH.
4. **Every merge to `main`, the latest `main` is merged into `staging`.** This
   keeps staging honest: it is always _`main` + whatever is still pending on
   staging_, never a stale fork that has silently drifted from production. The
   merge itself is a push to `staging`, so it re-triggers a staging deploy on
   the fresh base.

This follows the repo's **merge, never rebase** rule (see the root `AGENTS.md`)
like every other branch — `staging` is kept current by merging `main` in, not
by rebasing or force-pushing:

```bash
git fetch origin
git checkout staging
git merge origin/main
git push origin staging
```

## What makes it a mirror, mechanically

| Aspect        | Production               | Staging                                           |
| ------------- | ------------------------ | ------------------------------------------------- |
| Trigger       | `v*` tag (release)       | push to `staging` branch                          |
| Deploy engine | `deploy.sh` over SSH     | **the same** `deploy.sh`, `DEPLOY_BRANCH=staging` |
| Deploy reach  | CI SSHes the box         | GitHub webhook → on-box receiver (Twingate)       |
| Compose file  | `compose.production.yml` | `compose.staging.yml` (clone)                     |
| Images        | ghcr `:latest`           | ghcr `:staging`                                   |
| Edge / TLS    | `ops/Caddyfile`          | `ops/staging.Caddyfile`                           |
| Hosts         | hardcoded `manabrew.app` | from env (`STAGING_APP/RELAY/API_HOST`)           |
| Box           | production VM + key      | staging VM (SSH via Twingate)                     |

Because `deploy.sh` is shared, staging inherits production's change-detection,
ghcr pull-retry, relay binary-diff gate (a relay restart drops live games, so
it only restarts when the binary actually changed), and health-checked rollout
with automatic rollback.

## Deploy trigger (GitHub webhook)

Production's `deploy.sh` is invoked by CI over SSH. The staging VM sits behind
**Twingate**, so a GitHub-hosted runner can't SSH in. But the box serves the app
publicly on 443, so the rollout is triggered by an inbound HTTPS webhook instead:

```
push to staging ─┬─▶ Actions: build + push :staging images to ghcr
                 └─▶ GitHub push webhook ──HTTPS 443──▶ Caddy /_deploy
                                                          └─▶ on-box receiver ─▶ deploy.sh
```

- **Receiver:** [adnanh/webhook](https://github.com/adnanh/webhook) as a systemd
  service (`ops/staging-deploy-hook.service` + `ops/staging-deploy-hook.json`),
  listening on `127.0.0.1`-adjacent port `9099`. Caddy's `/_deploy` route
  (`ops/staging.Caddyfile`) reverse-proxies to it via `host.docker.internal`.
- **Auth:** GitHub signs each delivery (`X-Hub-Signature-256`, HMAC-SHA256 with
  `DEPLOY_HOOK_SECRET`); the receiver verifies it and checks `ref` is
  `refs/heads/staging` before running `ops/staging-deploy-hook.sh` → `deploy.sh`.
  A forged or unsigned call is rejected, so it's safe on the public edge. **Only
  80/443 should be open publicly — never expose 9099**; it's reached solely
  through Caddy.
- **Visibility:** `deploy.sh`'s summary is posted to `DISCORD_WEBHOOK_URL`, and
  GitHub logs every delivery + retry under Settings → Webhooks.

## Hosts are not hardcoded

The staging stack is host-agnostic so the environment can move domains without a
code change:

- **Runtime hosts** (app / relay / api) come from the staging box's `.env` —
  `STAGING_APP_HOST`, `STAGING_RELAY_HOST`, `STAGING_API_HOST` — consumed by
  `ops/staging.Caddyfile` (`{$STAGING_APP_HOST}` etc., which also drives ACME
  certs) and by the web runtime relay config.
- **The one build-time host** (the hub API URL baked into the web bundle) comes
  from the GitHub Actions repo **variable** `STAGING_HUB_API_URL`.

Moving staging to a different domain is a `.env` edit plus that one repo
variable — never a commit.

## First-time setup (ops)

Required before the first staging deploy can succeed:

1. **GitHub repo variable:** `STAGING_HUB_API_URL` (e.g.
   `https://api.<staging-domain>`). If unset, the web build falls back to the
   **production** hub — set it before the first push. (No GitHub _secrets_ are
   needed for the deploy — there is no SSH from CI.)
2. **DNS A records → staging VM** for the app / relay / api hosts you choose.
3. **Provision the VM** like the prod box: docker + compose, the repo cloned on
   the `staging` branch, and a box-local `.env` (see `.env.example`) with its
   own `MANABREW_SERVER_KEY`, the `STAGING_APP_HOST` / `STAGING_RELAY_HOST` /
   `STAGING_API_HOST` trio (matching the DNS and the `STAGING_HUB_API_URL` host),
   and a `DEPLOY_HOOK_SECRET` (`openssl rand -hex 32`).
4. **Install the deploy receiver** on the VM (`ops/staging-deploy-hook.service` —
   edit `DEPLOY_PATH` / `User`, then `systemctl enable --now
staging-deploy-hook`). It reads `DEPLOY_HOOK_SECRET` from the box `.env`.
   Ensure the host firewall exposes only 80/443, not 9099.
5. **Add the GitHub webhook** (repo → Settings → Webhooks → Add):
   - Payload URL: `https://<STAGING_APP_HOST>/_deploy/hooks/deploy-staging`
   - Content type: `application/json`
   - Secret: the same `DEPLOY_HOOK_SECRET`
   - Events: **Just the push event**

The hosted Java "Play vs AI" node is under the `hosted-ai` compose profile and,
exactly as in production, is not auto-started by `deploy.sh`. Start it once on
the box (it restarts unless stopped):

```bash
docker compose -f compose.staging.yml --profile hosted-ai up -d self-hosted-node
```

## See also

- `docs/DEPLOY.md` — production/operator deployment notes.
- `.github/workflows/staging-deploy.yml` — the `:staging` image build.
- `ops/staging-deploy-hook.{json,service,sh}` — the on-box webhook receiver.
- `deploy.sh` — the shared rollout script (`DEPLOY_BRANCH` / `CADDYFILE_PATH`).
