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
                                    │ reset onto latest main
                                    │
  main ──(every merge)─────────────┘
```

1. **Develop on a local feature branch.** Normal work, normal PRs.
2. **Merge the feature branch into `staging`.** This is what puts a change in
   front of the staging environment. A change can go to `staging` before its
   PR to `main` has landed, so it can be exercised end-to-end while review is
   still in flight.
3. **`staging` deploys automatically.** Any push to `staging` triggers
   `.github/workflows/staging-deploy.yml`, which builds the `:staging` images
   and SSHes the staging VM to run the production `deploy.sh` against the
   `staging` branch. Result lands on the staging hosts.
4. **Every merge to `main`, `staging` is reset onto the latest `main`.** This
   keeps staging honest: it is always _`main` + whatever is still pending on
   staging_, never a stale fork that has silently drifted from production. The
   reset re-writes `staging` to `main` and replays the pending staging-only
   commits on top, then force-pushes — which re-triggers a staging deploy on
   the fresh base.

## `staging` is the one force-pushed branch

The repo rule everywhere else is **merge, never rebase** (see the root
`AGENTS.md`): feature branches integrate `main` with `git merge`, and
already-pushed history is never rewritten. `staging` is the deliberate
exception. It is a **disposable integration branch** owned by the deploy
process, not shared feature work — resetting it onto `main` and force-pushing is
expected and safe precisely because nobody bases long-lived work on it. Do
**not** generalise this to any other branch.

Reset `staging` onto `main`:

```bash
git fetch origin
git checkout staging
git reset --hard origin/main
# replay any staging-only commits that must stay ahead of main, if any, then:
git push --force-with-lease origin staging
```

If `staging` carries no commits that aren't yet on `main` (the common case once
everything has merged), the reset is just `git reset --hard origin/main` and a
force-push.

## What makes it a mirror, mechanically

| Aspect        | Production               | Staging                                           |
| ------------- | ------------------------ | ------------------------------------------------- |
| Trigger       | `v*` tag (release)       | push to `staging` branch                          |
| Deploy engine | `deploy.sh` over SSH     | **the same** `deploy.sh`, `DEPLOY_BRANCH=staging` |
| Compose file  | `compose.production.yml` | `compose.staging.yml` (clone)                     |
| Images        | ghcr `:latest`           | ghcr `:staging`                                   |
| Edge / TLS    | `ops/Caddyfile`          | `ops/staging.Caddyfile`                           |
| Hosts         | hardcoded `manabrew.app` | from env (`STAGING_APP/RELAY/API_HOST`)           |
| Box           | production VM + key      | staging VM + its own key                          |

Because `deploy.sh` is shared, staging inherits production's change-detection,
ghcr pull-retry, relay binary-diff gate (a relay restart drops live games, so
it only restarts when the binary actually changed), and health-checked rollout
with automatic rollback.

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

1. **GitHub secrets:** `STAGING_DEPLOY_SSH_KEY`, `STAGING_DEPLOY_HOST`,
   `STAGING_DEPLOY_USER`, `STAGING_DEPLOY_PATH`.
2. **GitHub repo variable:** `STAGING_HUB_API_URL` (e.g.
   `https://api.<staging-domain>`). If unset, the web build falls back to the
   **production** hub — set it before the first push.
3. **DNS A records → staging VM** for the app / relay / api hosts you choose.
4. **Provision the VM** like the prod box: docker + compose, the repo cloned at
   `STAGING_DEPLOY_PATH` on the `staging` branch, and a box-local `.env` with
   its own `MANABREW_SERVER_KEY` plus `STAGING_APP_HOST` / `STAGING_RELAY_HOST`
   / `STAGING_API_HOST` (matching the DNS and the `STAGING_HUB_API_URL` host).

The hosted Java "Play vs AI" node is under the `hosted-ai` compose profile and,
exactly as in production, is not auto-started by `deploy.sh`. Start it once on
the box (it restarts unless stopped):

```bash
docker compose -f compose.staging.yml --profile hosted-ai up -d self-hosted-node
```

## See also

- `docs/DEPLOY.md` — production/operator deployment notes.
- `.github/workflows/staging-deploy.yml` — the staging pipeline.
- `deploy.sh` — the shared rollout script (`DEPLOY_BRANCH` / `CADDYFILE_PATH`).
