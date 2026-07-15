# Staging Workflow

Staging is a **mirror of production**. It runs on its own VM — a separate
machine with its own SSH key and its own DNS — deployed the same shape as
production: the same four ghcr images (built per-push, tagged `:staging` instead
of the release `latest`), a `compose.staging.yml` that clones
`compose.production.yml` service-for-service (web + relay + hub + hosted node,
its own TLS edge), and a lean rollout script (`deploy-staging.sh`) that mirrors
`deploy.sh`'s image-pull + health-checked recreate + rollback without the
release-only machinery. The only differences are the branch it tracks, the image
tag, and the hostnames — nothing behavioural.

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
3. **`staging` deploys automatically.** Any push to `staging` triggers
   `.github/workflows/staging-deploy.yml`, which builds the `:staging` images,
   connects the runner to **Twingate** (the VM only accepts SSH through
   Twingate), then SSHes in and runs `deploy-staging.sh` against the `staging`
   branch. Result lands on the staging hosts.
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
| Deploy engine | `deploy.sh` over SSH     | `deploy-staging.sh` (lean sibling of `deploy.sh`) |
| Deploy reach  | CI SSHes the box         | CI connects Twingate, then SSHes the box          |
| Compose file  | `compose.production.yml` | `compose.staging.yml` (clone)                     |
| Images        | ghcr `:latest`           | ghcr `:staging`                                   |
| Edge / TLS    | `ops/Caddyfile`          | `ops/staging.Caddyfile`                           |
| Hosts         | hardcoded `manabrew.app` | from env (`STAGING_APP/RELAY/API_HOST`)           |
| Box           | production VM + key      | staging VM, SSH gated by Twingate                 |

`deploy-staging.sh` keeps the parts of production's rollout that matter for a
mirror — ghcr image pull with retry, a health-checked `compose up --wait`, and
automatic rollback to the previous images on an unhealthy deploy — but drops the
release-only machinery `deploy.sh` carries (manifest hold / `--release-manifest`,
updater + sidestore, observability/parity profiles, the relay binary-diff gate).
On staging a relay recreate is fine, so `up -d` just recreates whatever image
changed.

## Deploy reach (Twingate)

The staging VM only accepts SSH through **Twingate**, so the GitHub-hosted runner
can't SSH in directly. The `deploy` job first connects to Twingate with a
service-account key, which brings the internal host into reach for the rest of
the job, then SSHes in exactly as production does:

```yaml
- uses: twingate/github-action@v1
  with:
    service-key: ${{ secrets.TWINGATE_SERVICE_KEY }}
# subsequent SSH step reaches STAGING_DEPLOY_HOST over the tunnel
```

Create the key in the Twingate Admin Console under **Team → Service Accounts**,
authorize it on the VM's SSH Resource, and store the downloaded JSON as the
`TWINGATE_SERVICE_KEY` repo secret. `STAGING_DEPLOY_HOST` is the VM's _internal_
address (as defined by the Twingate Resource). The tunnel stays up for the whole
job and tears down when it ends.

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

1. **GitHub secrets:** `TWINGATE_SERVICE_KEY` (Twingate service-account key JSON,
   authorized on the VM's SSH Resource) and `STAGING_DEPLOY_SSH_KEY` /
   `STAGING_DEPLOY_HOST` / `STAGING_DEPLOY_USER` / `STAGING_DEPLOY_PATH`
   (`STAGING_DEPLOY_HOST` is the VM's Twingate-internal address).
2. **GitHub repo variable:** `STAGING_HUB_API_URL` (e.g.
   `https://api.<staging-domain>`). If unset, the web build falls back to the
   **production** hub — set it before the first push.
3. **DNS A records → staging VM** for the app / relay / api hosts you choose.
4. **Provision the VM** like the prod box: docker + compose, the repo cloned at
   `STAGING_DEPLOY_PATH` on the `staging` branch, and a box-local `.env` (see
   `.env.example`) with its own `MANABREW_SERVER_KEY` plus the `STAGING_APP_HOST`
   / `STAGING_RELAY_HOST` / `STAGING_API_HOST` trio (matching the DNS and the
   `STAGING_HUB_API_URL` host).

The hosted Java "Play vs AI" node is under the `hosted-ai` compose profile and,
exactly as in production, is not auto-started by `deploy.sh`. Start it once on
the box (it restarts unless stopped):

```bash
docker compose -f compose.staging.yml --profile hosted-ai up -d self-hosted-node
```

## See also

- `docs/DEPLOY.md` — production/operator deployment notes.
- `.github/workflows/staging-deploy.yml` — the staging pipeline (build + deploy).
- `deploy-staging.sh` — the staging rollout script (run on the VM over SSH).
- `deploy.sh` — production's rollout script (staging does **not** use it).
