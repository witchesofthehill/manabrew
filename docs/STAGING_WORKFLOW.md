# Staging Workflow

Staging is a **mirror of production that lives next to production**. It runs as
a second compose project on the prod box (`/opt/manabrew-staging`,
`compose.staging.yml`), joined to the prod docker network and fronted by the
prod Caddy at **staging.manabrew.app** (relay at
`relay-staging.manabrew.app`, hub API same-origin under
`https://staging.manabrew.app/api/*`). Same ghcr images as a release would
ship (built per-push, tagged `:staging`), same rollout mechanics
(`cargo xtask deploy --staging`: image pull with retry, health-checked
`up --wait`, rollback), no release-only machinery. The differences are the branch it
tracks, the image tag, the hostnames, and that prod's Caddy terminates TLS for
it — nothing behavioural.

Its purpose: give changes a production-shaped home to bake in **before** they
reach real users, so a backend-breaking or infra-breaking change is caught on
infra that looks exactly like prod but isn't prod.

## The loop

```
  local branch ──(PR / merge)──▶ staging ──(auto)──▶ staging.manabrew.app
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
3. **The slot is label-gated.** A PR labelled `deploy-preview` takes the
   slot via `.github/workflows/staging-deploy.yml`, which builds the
   `:staging` images, syncs the slot's secrets into
   `/opt/manabrew-staging/.env`, then runs `cargo xtask deploy --staging`
   from the runner (production `DEPLOY_*` secrets). `workflow_dispatch` puts
   the `staging` branch back on the slot.
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

| Aspect        | Production               | Staging                                                    |
| ------------- | ------------------------ | ---------------------------------------------------------- |
| Trigger       | `v*` tag (release)       | `deploy-preview` label / `workflow_dispatch`               |
| Deploy engine | `cargo xtask deploy`     | `cargo xtask deploy --staging` (same command, slot target) |
| Compose file  | `compose.production.yml` | `compose.staging.yml` (services `*-staging`)               |
| Images        | ghcr `:latest`           | ghcr `:staging`                                            |
| Edge / TLS    | `ops/Caddyfile`          | prod Caddy vhosts → in-stack `ops/staging.Caddyfile` (:80) |
| Hosts         | `manabrew.app`           | `staging.manabrew.app` / `relay-staging.manabrew.app`      |
| Box           | `/opt/manabrew` project  | `/opt/manabrew-staging` project, shared network            |
| Secrets       | `ops/production.secrets` | `/opt/manabrew-staging/.env`, synced from repo secrets     |

Every staging service name carries a `-staging` suffix (`manabrew-staging`,
`manabrew-server-staging`, `manabrew-hub-staging`, `self-hosted-node-staging`)
because it shares docker DNS with the prod project. The staging hub uses its
own throwaway DB (`/opt/manabrew-staging/ops/hub-data/hub.db`) and its own
OAuth apps — the slot's `.env` is a real file written by the workflow's
secret-sync step, **never** a symlink to prod's `ops/production.secrets`.

`cargo xtask deploy --staging` keeps the parts of production's rollout that
matter for a mirror — ghcr image pull with retry, a health-checked
`compose up --wait`, and automatic re-tag rollback to the previous images on an
unhealthy deploy — but drops the release-only machinery the production mode
carries (updater + sidestore, observability/parity profiles, the relay
binary-diff gate).
On staging a relay recreate is fine, so `up -d` just recreates whatever image
changed.

## Secrets and hosts

- Deploy reach: the production `DEPLOY_SSH_KEY` / `DEPLOY_HOST` / `DEPLOY_USER`
  secrets; the slot path defaults to `/opt/manabrew-staging`
  (`DEPLOY_STAGING_PATH` secret overrides).
- Slot `.env` (synced every deploy from repo secrets): `MANABREW_SERVER_KEY`,
  `HUB_ADMIN_PASSWORD_HASH` (optional), and the hub auth secrets
  `STAGING_OAUTH_GITHUB_*` / `STAGING_OAUTH_DISCORD_*` /
  `STAGING_RESEND_API_KEY` (mapped to the hub's `GITHUB_CLIENT_ID` etc.).
- The one build-time host (the hub API URL baked into the web bundle) comes
  from the repo **variable** `STAGING_HUB_API_URL`
  (= `https://staging.manabrew.app`).
- The prod-edge vhosts (`staging.manabrew.app`, `relay-staging.manabrew.app`)
  live in `ops/Caddyfile`, which the prod box serves from its `main` checkout —
  a change there reaches the box with the next release (or a manual hot-sync).

## The optional VM (manual, self-contained)

A separate VM can run the whole stack for experiments that shouldn't touch the
staging slot (node fleets, relay tests). No CI drives it and it needs no
dedicated compose/Caddyfile: it uses the **selfhost stack**, which builds from
whatever is checked out on the VM:

```bash
cd <checkout>                    # the repo clone on the VM
git fetch origin staging && git checkout -f -B staging FETCH_HEAD
cargo xtask deploy --local       # own network, published ports, builds locally
```

(The VM needs a Rust toolchain for `cargo xtask`; `rustup` is a one-liner.)
See `xtask/src/deploy.rs` (`deploy_local`) for the env knobs (`RELAY_HOST`,
`WEB_PORT`, `MANABREW_SERVER_KEY`, …) and the HTTPS caveat for LAN access. The
VM's edge/env is maintained by hand; nothing in this repo references it.

## First-time setup (ops)

The staging slot needs, once:

1. **DNS**: `staging.manabrew.app` and `relay-staging.manabrew.app` A records →
   the prod box.
2. **Prod Caddyfile** on the box containing the two staging vhosts (ships with
   `ops/Caddyfile`; hot-sync + `caddy reload` if needed before a release lands).
3. **Repo secrets**: `MANABREW_SERVER_KEY` (already used by other workflows)
   plus the `STAGING_OAUTH_*` hub auth secrets; repo variable
   `STAGING_HUB_API_URL`.
4. An `/opt/manabrew-staging` directory owned by the deploy user (the
   deploy rsyncs the tracked config into it every run; no git checkout is
   consulted).

The hosted "Play vs AI" node (`self-hosted-node-staging`) sits behind the
`hosted-ai` compose profile and only the `staging` branch enables it — a PR
preview costs web + relay + hub, not a Forge JVM on the prod box.

## See also

- `docs/DEPLOY.md` — production/operator deployment notes.
- `.github/workflows/staging-deploy.yml` — the staging pipeline (build + deploy).
- `xtask/src/deploy.rs` — the one deploy command (prod / staging slot / local).
