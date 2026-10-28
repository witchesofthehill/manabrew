# Faro implementation plan

Status: implementation is present on `feat/faro-error-reporting`. Managed production/staging web and official macOS, Windows, iOS, and Android builds report by default; generic images and local builds stay off. This plan records the identifier-free reporting contract and outstanding manual rollout gates, not a production deployment or completed platform verification.

## Decision and scope

Use the Grafana Faro Web SDK to report frontend failures to the isolated collector, store them in existing Loki, and investigate them through provisioned Grafana dashboards and alerts.

The deliverable is actionable frontend error reporting for the managed web app and supported packaged Tauri frontends. Each report needs a readable stack where source maps exist, the exact frontend build, and allowlisted runtime categories without personal identifiers. Engine failures that are already delivered to the frontend need explicit reporting too.

This is not the Grafana Cloud Frontend Observability product, and it does not provide a Sentry-style issue database, assignment, or resolution workflow. Do not build those features as part of this change.

Native Rust panics, native Forge child-process dumps, WebView process crashes, OS kills, and out-of-memory termination are not covered by Faro. They remain a separate crash-reporting decision. Do not describe frontend exception counts as native crash counts.

Other exclusions: session replay, general product analytics, automatic console collection, distributed tracing/Tempo, automatic network tracing, new engine-liveness detection, and rules-correctness detection. Preserve the existing engine timing and offline game reporting pipelines.

## Repository baseline

| Area                  | Existing implementation                                                                                                                          | Consequence                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Frontend startup      | `src/main.tsx` initializes safe areas, console hooks, localization, and fonts before mounting React                                              | Initialize reporting before asynchronous startup work; do not await collector availability            |
| React failures        | `src/components/ErrorBoundary.tsx` owns caught React errors                                                                                      | Report once with the bounded React source category and sanitized code locations                       |
| Worker failures       | `src/platform/web.ts` owns engine workers, init failures, response rejection, and remote fatal events                                            | Report at the owning boundary, not at every rejected caller                                           |
| Forge supervision     | `packages/forge-wasm/forge-engine.worker.js` emits `game:forced_end` with `worker_error`; rewind candidate failures can preserve the active game | Distinguish fatal game termination from a failed rewind and normal teardown                           |
| Other workers         | `src/lib/cardCompositionWorker.ts` handles rendering failures; `src/workers/manabot.worker.ts` catches some failures internally                  | Main-page capture alone will not cover every worker failure                                           |
| Engine categories     | Existing engine labels are shared with other diagnostics                                                                                         | Reuse only the bounded engine vocabulary; leave game IDs and analytics correlation outside Faro       |
| Platform detection    | `src/platform/clientPlatform.ts` defines web, PWA, desktop, and mobile                                                                           | Reuse detection rather than adding a second Tauri probe                                               |
| Build version         | `vite.config.ts` reads `ops/manifest.json` and defines `__APP_VERSION__`                                                                         | Keep that version source; add an immutable build/artifact identifier                                  |
| Runtime configuration | `ops/web-entrypoint.sh` generates `window.__MANABREW_RUNTIME__`; types are in `src/vite-env.d.ts`                                                | Configure managed web deployments at runtime; published self-hosted images must remain off by default |
| Collection            | Alloy forwards backend Docker logs; an isolated Node collector validates Faro input and writes exceptions to Loki                                | Keep public exception processing out of backend logging                                               |
| Versions and limits   | `compose.production.yml` pins the existing observability images and a separately built `manabrew-faro` image                                     | Bound map admission, caching, request work, and event bytes                                           |
| Local observability   | `compose.dev.yaml` builds the collector beside local Loki under the observability profile                                                        | Keep local ingestion opt-in with separate storage                                                     |
| Retention             | `ops/observability/loki/loki.yml` specifies 720 hours                                                                                            | Start with the existing 30-day event retention                                                        |
| Release paths         | `Dockerfile.web`, `.github/workflows/docker-images.yml`, `staging-deploy.yml`, and `publish.yml` build shipped frontends                         | Source maps must come from each exact build, including separate desktop/mobile bundles                |

## Data contract and operating defaults

Use `src/lib/errorReporting.ts` for Faro initialization, allowlist sanitization, bounded duplicate suppression, and explicit failure reporting. The SDK remains responsible for transport and batching.

Configuration:

- An optional runtime `observability` object supplies `enabled`, `collectorUrl`, and `environment`. It takes precedence over compiled settings; explicit `enabled: false` means no collector requests or background reporting setup.
- `ops/web-entrypoint.sh` serializes the corresponding deployment environment variables safely, without interpolating arbitrary strings into executable JavaScript.
- Managed production and staging web deployments default on with distinct environment values. Published generic web images and ordinary local development remain off unless explicitly enabled.
- Official macOS, Windows, iOS, and Android builds receive equivalent nonsecret build-time settings with reporting enabled. Local Tauri builds stay off. Explicit false remains the kill switch.
- Release/build identity is compiled into the bundle, never supplied by the browser's deployment configuration.

Allowed event fields:

| Field          | Rule                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| Application    | Fixed value `manabrew-client`                                                                                 |
| Environment    | Explicit production, staging, or development value                                                            |
| Version/build  | Existing app version plus immutable commit SHA and build variant                                              |
| Platform       | Existing web/PWA/desktop/mobile classification; platform build target where available                         |
| Route          | Router pattern or normalized route category, never arbitrary path parameters, query strings, or fragments     |
| Failure source | Bounded categories such as startup, react, unhandled, engine-worker, render-worker, bot-worker, remote-engine |
| Engine         | Allowlisted engine category only, without game context or identifiers                                         |
| Exception      | Fixed safe error category and approved compiled-asset frames with line/column coordinates                     |

Use only fixed application/environment/source categories as additional Loki labels. Keep version, build, exception signature, and code locations in event fields. Inspect the receiver's actual emitted labels and remove unwanted high-cardinality labels before Loki ingestion.

Start with all eligible error events, subject to duplicate suppression and explicit client/collector limits. Disable unrelated default instrumentations and inspect serialized SDK envelopes, not only explicit exception fields.

Never send account, user, device, game, or session IDs, SDK session metadata, or a persistent diagnostic identity. Do not collect session lifecycle events, affected-session/user metrics, or backend-game correlation. Arbitrary text, names, email addresses, tokens, cookies, messages, decks, raw URLs, and console/network captures are outside the allowlist.

## Implementation sequence

### 1. Prove the ingestion contract and pin compatible versions

Files: `ops/observability/collector/`, `compose.production.yml`, `compose.dev.yaml`, and the existing backend Alloy configuration.

- Pin the Faro SDK and trace-mapping dependency.
- Share the client privacy helpers with the collector build, and rebuild incoming records instead of forwarding arbitrary bodies.
- Bound request size, batches, frames, concurrency, source-map admission/work/cache, and persisted daily event bytes.
- Keep backend Docker-to-Loki collection independent of public exception traffic.
- Run local collector/Loki under the observability profile with loopback-only ports and separate storage.
- Inspect actual Faro exception payloads in Loki, including the SDK envelope. Confirm session/user/device metadata is absent. Freeze field names and any necessary transformations before writing dashboards.

Acceptance: a synthetic, sanitized Faro exception reaches local Loki with the expected environment and fields. Existing container log ingestion remains intact. Validation uses the pinned binaries, not only a syntax inspection.

### 2. Publish private source maps from every shipped build

Files: `vite.config.ts`, `Dockerfile.web`, `.github/workflows/docker-images.yml`, `.github/workflows/staging-deploy.yml`, `.github/workflows/publish.yml`, and the existing deployment implementation under `xtask/src/deploy.rs` if map synchronization belongs there.

- Define one artifact identity from app version, source commit, and build variant. Distinguish the web image from macOS, Windows, Linux, iOS, and Android builds wherever those artifacts are shipped.
- Pass the checked-out source commit explicitly into Docker builds; do not rely on Git metadata being copied into the builder. Use the actual checked-out staging commit, not an unrelated workflow trigger SHA.
- Generate hidden JavaScript source maps, including worker bundles. Export them from the same build that produces the shipped assets. Never rebuild separately to create maps.
- Add a dedicated Docker artifact export stage or extract maps from the exact builder output. Keep `.map` files out of `/srv/manabrew` and out of installed public assets after private extraction.
- Publish maps atomically to a private release directory, proposed as `ops/observability/data/sourcemaps/<artifact-id>/`, mounted read-only into Alloy. Preserve asset-relative paths.
- Configure `sourcemaps.download = false` and filesystem locations. Resolve the SDK's release metadata to the matching artifact directory. Prove matching for actual browser and packaged origins before settling the path layout.
- Keep downloads disabled even when a map is missing. An unavailable map must produce an unsymbolicated event, not an arbitrary outbound request.
- Publish maps before rollout or installer publication, since managed and official clients report by default. Missing required map artifacts should fail that build's telemetry release gate. Keep previous directories through rollback and for the supported lifetime of installed clients; do not prune maps merely because their release is over 30 days old.
- Ensure deployment config synchronization cannot delete the map store. Use the existing tag-pinned deployment mechanism; do not add a second ad hoc deployment script.

Acceptance: submit a synthetic exception with a real minified frame from each built variant and observe its original file/line in Loki. Repeat for an older artifact after a newer one is installed. Public HTTP requests cannot fetch `.map` files, and an attacker-supplied stack URL causes no network fetch.

### 3. Protect the public collector endpoint

Files: `ops/Caddyfile`, `compose.production.yml`, `compose.staging.yml`, and the receiver configuration.

- Add a narrow HTTPS ingestion endpoint, proposed as `https://telemetry.manabrew.app/collect`, proxied only to the Faro collection route. Provision DNS/TLS through the existing ingress arrangement.
- Do not expose Alloy's administration or metrics endpoints. Do not send browsers directly to the existing authenticated Loki endpoint or embed its credentials in the app.
- Permit only the required request methods and headers. Configure explicit browser origins for production, staging, and verified packaged origins. Local development uses its own collector.
- Start with a 256 KiB request-body ceiling, collector rate of 20 requests/second and burst of 40, subject to the compatibility and load checks. Set matching client event/batch limits below the server ceiling. Define an ingress per-client limit if supported by the deployed edge; Caddy modules must be verified, not assumed.
- Treat the endpoint as public and all payload metadata as untrusted. CORS and any SDK-visible key do not authenticate a user, release, or environment. Rate limits must not depend only on client-declared app names.
- Keep connection metadata forwarding off and retain no collector access logs or ingestion bodies. The sender's IP necessarily reaches the collector at transport; do not add it to diagnostic events. Review reverse-proxy logging as well as Faro payloads.
- Preserve COOP/COEP on app assets and explicitly validate telemetry requests from cross-origin-isolated clients.

Acceptance: valid payloads ingest; oversized and over-limit requests are rejected; unsupported methods and administration paths are inaccessible. Missing/invalid origins do not gain browser CORS access. No backend secret appears in the shipped client configuration.

### 4. Initialize Faro and capture frontend exceptions

Files: `package.json`, `yarn.lock`, `src/main.tsx`, `src/components/ErrorBoundary.tsx`, `src/vite-env.d.ts`, `ops/web-entrypoint.sh`, and `src/lib/errorReporting.ts`.

- Initialize once before localization/font awaits and before React mounts. Keep initialization independent of game stores so module imports do not eagerly initialize platform workers or create circular dependencies.
- Use Faro's uncaught-error and unhandled-rejection instrumentation. Do not install a second competing set of global handlers.
- Report React-boundary errors with the bounded React source category and sanitized code locations, not arbitrary component-stack text. Preserve the current recovery behavior and local console diagnostics.
- Ensure caught startup failures are reported once without suppressing the original failure. Static-module evaluation failures that occur before the initializer runs are a documented coverage limit, not a reason to claim complete startup coverage.
- Disable automatic console collection, interaction capture, resource/network collection, and performance instrumentation for this error-focused scope.
- Make initialization idempotent across repeated calls and development reloads. Reporting must never block mounting, alter game state, or recursively report collector failures.
- Use bounded SDK batching and bounded duplicate suppression. No custom persistent retry queue. Document that offline/abruptly killed clients can lose reports.

Acceptance: uncaught errors, rejected promises, React exceptions, and post-initialization startup failures each yield one useful report. Disabled configuration emits nothing. Collector outage, 429 responses, or malformed configuration do not prevent app startup or produce a reporting loop.

### 5. Capture game and worker failures at their owners

Files: `src/platform/web.ts`, `src/lib/cardCompositionWorker.ts`, `src/workers/manabot.worker.ts`, and the frontend lifecycle owner discovered during implementation. Change `packages/forge-wasm/` only if its current events cannot carry the needed bounded failure details.

- Report fatal engine-worker errors, worker initialization failures, and `game:forced_end` with `reason: worker_error`.
- Report `game:fatal` remote-engine events separately from a local frontend exception. Ordinary `game:error` and `game:remote_error` protocol rejections are not automatically bugs; classify existing codes before opting unexpected failures into reporting.
- Forward original bounded worker exception names/stacks for sanitization into fixed error categories and approved code locations. Do not serialize commands, request arguments, shared buffers, engine state, or decision journals.
- Capture card-render worker crashes and unexpected job failures. Exclude user cancellation, normal teardown, and unsupported-capability selection of the main-thread renderer.
- Forward internally caught Manabot failures to the main thread with a bounded failure event. Do not run the browser Faro SDK inside a worker.
- Treat failed rewind candidates as a recoverable operation failure when the active game survives. Do not count normal termination or an expected cancellation as a crash.
- Attach only the allowlisted engine category before failure cleanup clears it. Never read or attach game IDs for Faro reporting.
- Define one reporting owner per failure path. A worker crash rejecting several pending requests must not produce one report per request plus another global rejection report. Retain the existing rejection/recovery semantics.

Acceptance: engine init failure, runtime worker crash, remote fatal event, render-worker failure, and caught bot failure arrive with distinct sources. A multi-request worker crash yields one incident report. Cancellation, legal-move rejection, normal game exit, and renderer capability fallback do not create error incidents. No game identifier reaches the payload.

### 6. Apply privacy rules to every report

Files: the reporting module and deployment logging configuration. Update the published privacy policy at `website/src/content/docs/privacy.md` as required by the finalized collection policy.

- Allowlist metadata. Never attach account/user/device/game/session IDs, SDK session metadata, persistent diagnostic identity, Zustand snapshots, account profiles, names, email addresses, tokens, cookies, request/response bodies, chat, deck contents, card choices, or private game journals.
- Use normalized route categories and approved compiled-asset paths with positive line/column coordinates. Discard raw URLs, private path parameters, credentials, query strings, fragments, function names, and user-agent metadata from every field, including nested SDK metadata.
- Replace arbitrary error text with a fixed safe category. Do not trust token regexes or call `String` or JSON serialization on arbitrary rejected objects and ship the result.
- Keep only bounded platform/build-target and engine categories needed for debugging.
- Apply truncation and frame limits after sanitization; keep serialized reports below the batch ceiling. Review every enabled automatic instrumentation for fields outside the explicit reporting API.
- Finalize notice, collection basis, and any required consent/opt-out behavior before enabling a managed deployment. If consent is required, initialize only after it is granted. A deployment flag is not user consent.
- Keep the existing 30-day event retention and authenticated Grafana access. Do not correlate Faro reports with backend game records.

Acceptance: synthetic secret-bearing errors, stack URLs, rejected objects, routes, and nested SDK metadata contain no seeded private values in the outgoing serialized payload or stored event. Repeat for all enabled automatic instrumentations. Privacy-policy requirements are satisfied before production enablement.

### 7. Provision investigation and operational alerts

Files: a new dashboard under `ops/observability/grafana/dashboards/`, existing alert provisioning under `ops/observability/grafana/provisioning/alerting/`, `ops/observability/prometheus/prometheus.yml`, and `docs/OBSERVABILITY.md`.

- Add a Client Errors dashboard with filters for environment, version/build, platform, failure source, and engine.
- Show exception volume, frequent exception signatures, and a detail table with readable stack, build, platform, route category, and engine category. Derive signatures from fixed error categories, source, operation, and safe asset coordinates. Do not build an issue service.
- Keep backend-game correlation outside Faro; the payload contains no game IDs.
- Do not collect session lifecycle data or display affected-session, affected-user, or crash-free-user metrics.
- Reuse the existing contact-point/routing conventions. Trigger the production error-burst alert at 10 or more exceptions in 10 minutes, based on event count only.
- Scrape the collector's private metrics and monitor health, export failures, byte budget, and memory. Public DNS/TLS/Caddy reachability still requires an external check.
- Alert on sustained collector/export failures separately from app error bursts. Group notifications by bounded operational dimensions. Do not place exception text or personal context into Discord notifications.

Acceptance: non-UI Loki queries return the expected reports and grouping from controlled fixtures; Grafana provisioning loads; alert rules evaluate against synthetic data and route a controlled notification. Dashboard appearance is left for the user's manual review.

## Verification and rollout

Default-on settings do not complete the rollout gates below. Browser/PWA/packaged WebView behavior, release CI, production DNS/TLS, and privacy authorization remain manual deployment gates. No UI or platform verification is claimed.

Current non-UI verification exercised the actual SDK: primitive startup ownership deduplicates across global rejection capture, repeated Error identity stays deduplicated, and stackless global events retain sanitized filename/line/column. Five expected reports excluded seeded private text and non-app SDK metadata. A separate Node scenario ran the actual bridge/renderer code with fake workers: all five owned ErrorEvent handlers canceled propagation, query initialization retained name/stack, and rejected Errors preserved identity. Actual browser/WebView behavior remains manual.

The isolated collector image built and became healthy against Loki. Direct HTTP submissions proved removal of raw messages, user/session fields, arbitrary context, and client-supplied function names. Alias, path, batch/frame, and body limits were exercised. Real main, engine-worker, render-worker, and nested Card Glint locations reached Loki. Three identical batch events retained distinct timestamps. Daily-budget exhaustion returned 429 and survived a collector restart; a Loki outage returned 503, updated readiness/export metrics, and consumed its reservation. Recovery returned 202.

Resolver scenarios exercised 64-entry eviction, five-minute expiry, non-retained misses, pre-decode segment rejection, and load/read/decode budget boundaries. Two hundred coordinates of the admitted real main map required no additional map loads.

Authenticated artifact scenarios covered exact roundtrip bytes, wrong keys, tampering, archive paths/symlinks/sizes, checksums, and immutable collisions. Actual xtask-generated staging shell was exercised through fake SSH/rsync/Docker for exact tags, manual selection, rollback image IDs, and scoped old-image retention. No production host or cleanup command was used.

`yarn vite:build` passed with an 8192 MiB Node heap, including `tsc -b` and hidden maps. The iOS wrapper passed argument/environment verification. Targeted ESLint, formatting, Compose parsing, and pinned Caddy/Alloy/Prometheus configuration validation passed. Grafana 11.6.1 loaded all five alert rules; their queries executed against isolated Loki/Prometheus. Scheduled evaluation and notifications were not exercised. Full iOS packaging, registry publication, hosted rollout, and platform UI acceptance remain unverified locally.

Verification checklist for the integration owner when requested:

- Run `yarn tsc -b` and targeted lint/format checks for changed files. Validate Compose, Caddy, Alloy, and Grafana alert configuration with the exact selected binaries. Read `scripts/AGENTS.md` before adding or running repository scripts.
- Use a throwaway non-UI SDK harness with browser APIs stubbed only as needed to inspect real serialized transport output. This proves configuration and sanitization, not browser/WebView compatibility. Do not add permanent unit tests unless requested.
- Exercise the actual collector-to-Loki path with HTTP payloads, real minified frames, local private maps, outage/limit cases, and old/new artifacts. Observe stored events, not only HTTP success responses.
- Validate private-map lookup against malicious URL/release inputs, including traversal attempts. Keep map mounts read-only, disable URL downloads, and verify lookups stay within approved artifact directories.
- Observe collector RSS and Loki disk usage during staging acceptance. Cache accounting and event-byte quotas are not physical disk/RSS measurements.
- Leave actual browser/PWA/packaged WebView checks to the user unless explicitly requested. The manual matrix covers browser exceptions, React recovery, startup failures, workers, multiple games, collector outage, desktop origins/CSP, and supported mobile builds. Passing a Node harness does not mark these cases complete.

Rollout order:

1. Complete the pinned-version/local ingestion proof and source-map security checks.
2. For first rollout, explicitly set `FARO_ENABLED=false` while deploying the collector, validating ingress, and provisioning private map storage and metrics.
3. Publish release maps, then remove the staging override to restore its default-on setting. Keep staging notifications separate from production.
4. Obtain the user's manual web verification, review identifier-free stored payloads and resource use, and finalize the privacy/notice policy.
5. Remove the managed production override after acceptance. Keep generic self-hosted images off.
6. Publish each default-on official macOS, Windows, iOS, and Android frontend only after maps are published and its WebView/origin matrix is manually verified. Do not advertise native crash reporting.

Rollback: disable web reporting through runtime configuration and restart/reload the managed web configuration using the existing deployment flow. Packaged clients have compiled settings, so stopping their ingestion requires disabling the collector route or rejecting that client application at ingress until an update ships; this does not uninstall their SDK. Do not invent a mandatory remote-config request just for rollback. Preserve previous map directories and existing backend logging throughout rollback.

## Completion criteria

- Every supported frontend failure path named above has a reporting owner and a demonstrated event, or is explicitly identified as an unsupported platform coverage limit before rollout.
- Managed deployments can enable/disable web reporting without rebuilding; local and third-party deployments do not silently report to Manabrew.
- Exceptions identify the exact build, retain only allowlisted error/platform/engine/normalized-route/code-location metadata, and resolve against the correct private maps when maps exist.
- Event payloads contain no personal identifiers or SDK session metadata, queues and ingestion are bounded, and telemetry failure never prevents play.
- Grafana queries, provisioned alerts, operational documentation, retention, and privacy disclosures match the deployed behavior.
- User-run browser/WebView verification is recorded before claiming coverage for those environments. Native crash reporting is not claimed.

## Documentation updates during implementation

Update `docs/OBSERVABILITY.md` with event fields, dashboard queries, alert thresholds, local startup, and coverage limits. Update `docs/DEPLOY.md` with runtime settings, collector/map provisioning, artifact retention, rollout, and rollback. Update the relevant frontend, desktop, Forge package, script, and website guidance only where implementation changes their documented contracts; read their scoped guides before editing those areas.

## References

- [Faro SDK and supported environments](https://github.com/grafana/faro-web-sdk)
- [Source-map lookup implementation](https://github.com/jridgewell/trace-mapping)
- [Grafana Cloud Frontend Observability](https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/)

The references describe current upstream behavior. The implementation must validate features against the versions actually pinned in this repository.
