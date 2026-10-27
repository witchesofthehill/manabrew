# Faro implementation plan

Status: implementation is present on `feat/faro-error-reporting`; managed and packaged collection remain disabled. Non-UI verification and manual rollout gates are recorded below. This document does not claim a production deployment.

## Decision and scope

Use the Grafana Faro Web SDK to report frontend failures to a self-hosted Alloy receiver, store them in the existing Loki, and investigate them through provisioned Grafana dashboards and alerts.

The deliverable is actionable frontend error reporting for the managed web app and supported packaged Tauri frontends. Each report needs a readable stack where source maps exist, the exact frontend build, safe runtime context, and a session identifier. Engine failures that are already delivered to the frontend need explicit reporting too.

This is not the Grafana Cloud Frontend Observability product, and it does not provide a Sentry-style issue database, assignment, or resolution workflow. Do not build those features as part of this change.

Native Rust panics, native Forge child-process dumps, WebView process crashes, OS kills, and out-of-memory termination are not covered by Faro. They remain a separate crash-reporting decision. Do not describe frontend exception counts or unexpectedly ended sessions as native crash counts.

Other exclusions: session replay, general product analytics, automatic console collection, distributed tracing/Tempo, automatic network tracing, new engine-liveness detection, and rules-correctness detection. Preserve the existing engine timing and offline game reporting pipelines.

## Repository baseline

| Area                  | Existing implementation                                                                                                                          | Consequence                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Frontend startup      | `src/main.tsx` initializes safe areas, console hooks, localization, and fonts before mounting React                                              | Initialize reporting before asynchronous startup work; do not await collector availability            |
| React failures        | `src/components/ErrorBoundary.tsx` only logs caught errors                                                                                       | Report caught exceptions and component stacks explicitly                                              |
| Worker failures       | `src/platform/web.ts` owns engine workers, init failures, response rejection, and remote fatal events                                            | Report at the owning boundary, not at every rejected caller                                           |
| Forge supervision     | `packages/forge-wasm/forge-engine.worker.js` emits `game:forced_end` with `worker_error`; rewind candidate failures can preserve the active game | Distinguish fatal game termination from a failed rewind and normal teardown                           |
| Other workers         | `src/lib/cardCompositionWorker.ts` handles rendering failures; `src/workers/manabot.worker.ts` catches some failures internally                  | Main-page capture alone will not cover every worker failure                                           |
| Game correlation      | `src/lib/engineStatsReport.ts` defines `engineReportGameId` and engine labels                                                                    | Reuse the existing online/offline game-ID semantics and label vocabulary                              |
| Platform detection    | `src/platform/clientPlatform.ts` defines web, PWA, desktop, and mobile                                                                           | Reuse detection rather than adding a second Tauri probe                                               |
| Build version         | `vite.config.ts` reads `ops/manifest.json` and defines `__APP_VERSION__`                                                                         | Keep that version source; add an immutable build/artifact identifier                                  |
| Runtime configuration | `ops/web-entrypoint.sh` generates `window.__MANABREW_RUNTIME__`; types are in `src/vite-env.d.ts`                                                | Configure managed web deployments at runtime; published self-hosted images must remain off by default |
| Collection            | `ops/observability/alloy/config.alloy` forwards Docker logs to Loki                                                                              | Add a separate Faro input without replacing container log collection                                  |
| Versions and limits   | `compose.production.yml` pins Alloy `v1.9.1`, Loki `3.5.0`, and Grafana `11.6.1`; Alloy has a 128 MB memory limit                                | Verify configuration support against the selected image and measure resource use                      |
| Local observability   | `compose.dev.yaml` has Grafana but no local Loki/Alloy services                                                                                  | Provide an opt-in local ingestion path rather than sending development reports to production          |
| Retention             | `ops/observability/loki/loki.yml` specifies 720 hours                                                                                            | Start with the existing 30-day event retention                                                        |
| Release paths         | `Dockerfile.web`, `.github/workflows/docker-images.yml`, `staging-deploy.yml`, and `publish.yml` build shipped frontends                         | Source maps must come from each exact build, including separate desktop/mobile bundles                |

## Data contract and operating defaults

Use one small frontend reporting module, proposed as `src/lib/errorReporting.ts`, rather than an application-wide logging framework. It owns Faro initialization, sanitization, bounded duplicate suppression, and explicit failure reporting. The SDK remains responsible for transport and batching.

Configuration:

- Web runtime configuration gains an optional `observability` object with `enabled`, `collectorUrl`, and `environment`. Absence or `enabled: false` means no collector requests and no background reporting setup.
- Extend `ops/web-entrypoint.sh` with corresponding deployment environment variables. Serialize values safely; do not interpolate arbitrary strings into executable JavaScript without escaping.
- Published generic web images and ordinary local development remain disabled. Production and staging opt in explicitly with distinct environment values.
- Official packaged builds receive equivalent nonsecret build-time settings. Local Tauri builds stay disabled. Runtime web configuration takes precedence where present, including an explicit disable.
- Release/build identity is compiled into the bundle, never supplied by the browser's deployment configuration.

Proposed event fields:

| Field          | Rule                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| Application    | Fixed value `manabrew-client`                                                                                 |
| Environment    | Explicit production, staging, or development value                                                            |
| Version/build  | Existing app version plus immutable commit SHA and build variant                                              |
| Platform       | Existing web/PWA/desktop/mobile classification; platform build target where available                         |
| Session        | Random, session-scoped identifier; no persistent account identity                                             |
| Route          | Router pattern or normalized route category, never arbitrary path parameters, query strings, or fragments     |
| Failure source | Bounded categories such as startup, react, unhandled, engine-worker, render-worker, bot-worker, remote-engine |
| Game context   | Engine label and game ID when known; snapshot before teardown and clear when leaving the game                 |
| Exception      | Sanitized name, message, stack frames, and optional React component stack                                     |

Use only fixed application/environment/source categories as additional Loki labels. Keep version, build, session, game ID, exception signature, URLs, and stack data in event fields. Inspect the receiver's actual emitted labels and remove unwanted high-cardinality labels before Loki ingestion.

Start with all eligible error events, subject to duplicate suppression and explicit client/collector limits. Do not enable session-wide sampling that silently discards rare errors. Disable unrelated default instrumentations; review the selected SDK's actual defaults rather than assuming they are privacy-safe.

Retain only the minimum session lifecycle events needed to count reporting sessions if the dashboard includes an affected-session rate. Otherwise display affected reporting-session counts, not a percentage of all users or a crash-free-user metric.

## Implementation sequence

### 1. Prove the ingestion contract and pin compatible versions

Files: `ops/observability/alloy/config.alloy`, `compose.production.yml`, `compose.dev.yaml`, and opt-in development configuration if separation is needed.

- Select and pin compatible Faro packages. Start with `@grafana/faro-web-sdk`; add `@grafana/faro-react` only if its integration provides behavior we actually use.
- Validate `faro.receiver`, JSON output, request limits, and filesystem source-map resolution against the selected Alloy image. Current online documentation may describe options absent from `v1.9.1`.
- If a required feature is unavailable, make the smallest supported Alloy upgrade and verify the existing Docker-to-Loki path as well. Do not upgrade the whole observability stack by default.
- Add the receiver on an internal container port and route its logs through a dedicated processing stage into the existing Loki writer. No traces output is required.
- Add local Loki and Alloy under an explicit observability profile, with development-only ports bound to loopback and separate storage. Do not mount the production data directory or discover the developer's unrelated Docker containers.
- Inspect actual Faro exception and session payloads in Loki. Freeze field names and any necessary transformations before writing dashboards.

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
- Include maps before enabling telemetry for a new build. Missing required map artifacts should fail that build's telemetry release gate. Keep previous directories through rollback and for the supported lifetime of installed clients; do not prune maps merely because their release is over 30 days old.
- Ensure deployment config synchronization cannot delete the map store. Use the existing tag-pinned deployment mechanism; do not add a second ad hoc deployment script.

Acceptance: submit a synthetic exception with a real minified frame from each built variant and observe its original file/line in Loki. Repeat for an older artifact after a newer one is installed. Public HTTP requests cannot fetch `.map` files, and an attacker-supplied stack URL causes no network fetch.

### 3. Protect the public collector endpoint

Files: `ops/Caddyfile`, `compose.production.yml`, `compose.staging.yml`, and the receiver configuration.

- Add a narrow HTTPS ingestion endpoint, proposed as `https://telemetry.manabrew.app/collect`, proxied only to the Faro collection route. Provision DNS/TLS through the existing ingress arrangement.
- Do not expose Alloy's administration or metrics endpoints. Do not send browsers directly to the existing authenticated Loki endpoint or embed its credentials in the app.
- Permit only the required request methods and headers. Configure explicit browser origins for production, staging, and verified packaged origins. Local development uses its own collector.
- Start with a 256 KiB request-body ceiling, collector rate of 20 requests/second and burst of 40, subject to the compatibility and load checks. Set matching client event/batch limits below the server ceiling. Define an ingress per-client limit if supported by the deployed edge; Caddy modules must be verified, not assumed.
- Treat the endpoint as public and all payload metadata as untrusted. CORS and any SDK-visible key do not authenticate a user, release, or environment. Rate limits must not depend only on client-declared app names.
- Keep connection metadata forwarding off and avoid retaining client IP addresses or full ingestion bodies in access logs. Review reverse-proxy logging as well as Faro payloads.
- Preserve COOP/COEP on app assets and explicitly validate telemetry requests from cross-origin-isolated clients.

Acceptance: valid payloads ingest; oversized and over-limit requests are rejected; unsupported methods and administration paths are inaccessible. Missing/invalid origins do not gain browser CORS access. No backend secret appears in the shipped client configuration.

### 4. Initialize Faro and capture frontend exceptions

Files: `package.json`, `yarn.lock`, `src/main.tsx`, `src/components/ErrorBoundary.tsx`, `src/vite-env.d.ts`, `ops/web-entrypoint.sh`, and the proposed reporting module.

- Initialize once before localization/font awaits and before React mounts. Keep initialization independent of game stores so module imports do not eagerly initialize platform workers or create circular dependencies.
- Use Faro's uncaught-error and unhandled-rejection instrumentation. Do not install a second competing set of global handlers.
- Report React-boundary errors with the boundary context and component stack. Preserve the current recovery behavior and local console diagnostics.
- Ensure caught startup failures are reported once without suppressing the original failure. Static-module evaluation failures that occur before the initializer runs are a documented coverage limit, not a reason to claim complete startup coverage.
- Disable automatic console collection, interaction capture, resource/network collection, and performance instrumentation for this error-focused scope.
- Make initialization idempotent across repeated calls and development reloads. Reporting must never block mounting, alter game state, or recursively report collector failures.
- Use bounded SDK batching and bounded duplicate suppression. No custom persistent retry queue. Document that offline/abruptly killed clients can lose reports.

Acceptance: uncaught errors, rejected promises, React exceptions, and post-initialization startup failures each yield one useful report. Disabled configuration emits nothing. Collector outage, 429 responses, or malformed configuration do not prevent app startup or produce a reporting loop.

### 5. Capture game and worker failures at their owners

Files: `src/platform/web.ts`, `src/lib/cardCompositionWorker.ts`, `src/workers/manabot.worker.ts`, and the frontend lifecycle owner discovered during implementation. Change `packages/forge-wasm/` only if its current events cannot carry the needed bounded failure details.

- Report fatal engine-worker errors, worker initialization failures, and `game:forced_end` with `reason: worker_error`.
- Report `game:fatal` remote-engine events separately from a local frontend exception. Ordinary `game:error` and `game:remote_error` protocol rejections are not automatically bugs; classify existing codes before opting unexpected failures into reporting.
- Preserve genuine exception names/stacks when available across worker messages. Do not serialize commands, request arguments, shared buffers, engine state, or decision journals.
- Capture card-render worker crashes and unexpected job failures. Exclude user cancellation, normal teardown, and unsupported-capability selection of the main-thread renderer.
- Forward internally caught Manabot failures to the main thread with a bounded failure event. Do not run the browser Faro SDK inside a worker.
- Treat failed rewind candidates as a recoverable operation failure when the active game survives. Do not count normal termination or an expected cancellation as a crash.
- Attach the active game's context before failure cleanup drains it. Reuse the online/offline selection semantics in `engineReportGameId`; never attach an old relay game ID to an offline game.
- Define one reporting owner per failure path. A worker crash rejecting several pending requests must not produce one report per request plus another global rejection report. Retain the existing rejection/recovery semantics.

Acceptance: engine init failure, runtime worker crash, remote fatal event, render-worker failure, and caught bot failure arrive with distinct sources. A multi-request worker crash yields one incident report. Cancellation, legal-move rejection, normal game exit, and renderer capability fallback do not create error incidents. Game context clears between games.

### 6. Apply privacy rules before enabling collection

Files: the reporting module and deployment logging configuration. Update the published privacy policy at `website/src/content/docs/privacy.md` as required by the finalized collection policy.

- Allowlist metadata. Never attach Zustand snapshots, account profiles, usernames, email addresses, tokens, cookies, request/response bodies, chat, deck contents, card choices, or private game journals.
- Normalize routes and strip URL credentials, query strings, fragments, and private path parameters from all URL-bearing fields, including SDK metadata and stack frames. Retain the asset path needed for source-map resolution.
- Scrub bounded error messages and stacks for credentials and user data. For known errors containing arbitrary user payloads, replace the message with a stable safe category rather than trusting token regexes. Do not call `String` or JSON serialization on arbitrary rejected objects and ship the result.
- Preserve only the platform/browser information needed for debugging. Do not send stable account identity or create a cross-session tracking identifier.
- Apply truncation and frame limits after sanitization; keep serialized reports below the batch ceiling. Review every enabled automatic instrumentation for fields outside the explicit reporting API.
- Finalize notice, collection basis, and any required consent/opt-out behavior before enabling a managed deployment. If consent is required, initialize only after it is granted. A deployment flag is not user consent.
- Keep the existing 30-day event retention and authenticated Grafana access. Document that game IDs are correlation identifiers and can still link to other retained operational records.

Acceptance: synthetic secret-bearing errors, stack URLs, rejected objects, routes, and nested SDK metadata contain no seeded private values in the outgoing serialized payload or stored event. Repeat for all enabled automatic instrumentations. Privacy-policy requirements are satisfied before production enablement.

### 7. Provision investigation and operational alerts

Files: a new dashboard under `ops/observability/grafana/dashboards/`, existing alert provisioning under `ops/observability/grafana/provisioning/alerting/`, `ops/observability/prometheus/prometheus.yml`, and `docs/OBSERVABILITY.md`.

- Add a Client Errors dashboard with filters for environment, version/build, platform, failure source, and engine.
- Show exception volume, affected reporting sessions, frequent exception signatures, and a detail table with readable stack, build, session, and game ID. Derive signatures from stable error data, excluding session/game IDs and variable message values. Use the selected receiver's fingerprint if suitable; do not build an issue service.
- Link reports to matching backend logs when they include a game ID. Missing game IDs remain valid frontend reports.
- Do not divide exception counts by session counts to claim an affected-user percentage. Include session lifecycle ingestion before displaying an affected-session rate, and label the reporting population accurately.
- Reuse the existing contact-point/routing conventions. Start with a production error-burst alert, proposed at 10 incidents across at least 3 reporting sessions in 10 minutes. Tune after staging validation and observed traffic.
- Scrape Alloy's private metrics and add collector/export failure monitoring. Verify metric names for the pinned image. No-client-traffic periods are not themselves ingestion failures.
- Alert on sustained collector/export failures separately from app error bursts. Group notifications by bounded dimensions rather than per-session or per-stack labels. Do not place raw exceptions or user context into Discord notifications.

Acceptance: non-UI Loki queries return the expected reports and grouping from controlled fixtures; Grafana provisioning loads; alert rules evaluate against synthetic data and route a controlled notification. Dashboard appearance is left for the user's manual review.

## Verification and rollout

The implementation preserves the rollout gates below. Non-UI SDK execution has demonstrated outgoing sanitization, global/explicit capture, identity deduplication, cleared game context, and collector outage/429 isolation. Pinned Caddy/Alloy/Loki have demonstrated actual storage, minified-source resolution for current and older artifacts, CORS/preflight, malformed/oversized/chunked bodies, rate rejection, traversal containment, and disabled map downloads. Grafana provisioning, dashboard LogQL, production burst thresholds, and a real alert notification to a local sink have passed. Browser/PWA/packaged WebView behavior, release CI, production DNS/TLS, and privacy authorization remain user-run deployment gates. No UI was launched or visually checked.

The final non-UI ownership harness exercised actual bridge/renderer handlers with simulated worker events: repeated game initialization produced one rewind report; a worker crash rejected three pending requests and produced one report despite global propagation; normal startup cancellation was excluded; bot and renderer failures retained their worker locations. A 1,000-error SDK burst admitted 20 batches of ten events with one request in flight. Actual Vite main/engine/bot/render/nested Card Glint maps and both main/worker WASM helper maps resolved through Alloy to original file, line, and column; all 27 maps were absent from `dist/`. Worker shared chunks now have distinct paths, eliminating the observed main/worker map overwrite. Real SSH/rsync publication passed identical re-publication, exact variant selection, old-release retention, checksum/symlink rejection, and immutable local/remote identity checks. The BusyBox entrypoint preserved quotes, backslashes, control characters, Unicode separators, existing runtime fields, and explicit disable. Runtime disable also overrode an enabled compiled configuration.

Actual map decoding brought Alloy to 120.5 MiB under the previous 128 MiB limit; the initial limit is now 256 MiB. Resolving seven precise locations under each of two artifact identities using the actual Vite maps passed without a collector restart; measured memory was 199.5 MiB for Alloy and 90.06 MiB for Loki. This is a two-identity load exercise, not packaged-platform verification. The pinned map cache has no expiry or entry bound. Concurrent-release capacity and public-ingress cache growth remain staging rollout checks, not a claim of production headroom.

Final non-UI checks passed TypeScript compilation, targeted ESLint/Prettier, JavaScript/shell syntax, all seven Forge supervisor regressions, production/staging/dev Compose validation, pinned production/dev Alloy validation, and pinned Caddy validation. Buildx parsed the actual runtime/maps Bake graph with runtime-only `mode=min` caching; a complete Docker release build, registry publication, and installer CI were not run.

During implementation:

- Run `yarn tsc -b` and targeted lint/format checks for changed files. Validate Compose, Caddy, Alloy, and Grafana alert configuration with the exact selected binaries. Read `scripts/AGENTS.md` before adding or running repository scripts.
- Use a throwaway non-UI SDK harness with browser APIs stubbed only as needed to inspect real serialized transport output. This proves configuration and sanitization, not browser/WebView compatibility. Do not add permanent unit tests unless requested.
- Exercise the actual collector-to-Loki path with HTTP payloads, real minified frames, local private maps, outage/limit cases, and old/new artifacts. Observe stored events, not only HTTP success responses.
- Validate private-map lookup against malicious URL/release inputs, including traversal attempts. Keep map mounts read-only, disable URL downloads, and verify lookups stay within approved artifact directories.
- Measure bounded client queue behavior, ingest volume, and Alloy/Loki memory/disk growth under error bursts. Revisit the current 128 MB Alloy and 384 MB Loki limits only with evidence.
- Leave actual browser/PWA/packaged WebView checks to the user unless explicitly requested. The manual matrix covers browser exceptions, React recovery, startup failures, workers, multiple games, collector outage, desktop origins/CSP, and supported mobile builds. Passing a Node harness does not mark these cases complete.

Rollout order:

1. Complete the pinned-version/local ingestion proof and source-map security checks.
2. Deploy the collector disabled at the client, validate ingress, and provision private map storage and metrics.
3. Publish release maps, then enable the instrumented staging web app. Keep staging notifications separate from production.
4. Obtain the user's manual web verification, review sanitized stored payloads and resource use, and finalize the privacy/notice policy.
5. Enable managed production web reporting through runtime configuration. Keep generic self-hosted images off.
6. Enable each official packaged frontend only after maps are published and its WebView/origin matrix is manually verified. Do not advertise native crash reporting.

Rollback: disable web reporting through runtime configuration and restart/reload the managed web configuration using the existing deployment flow. Packaged clients have compiled settings, so stopping their ingestion requires disabling the collector route or rejecting that client application at ingress until an update ships; this does not uninstall their SDK. Do not invent a mandatory remote-config request just for rollback. Preserve previous map directories and existing backend logging throughout rollback.

## Completion criteria

- Every supported frontend failure path named above has a reporting owner and a demonstrated event, or is explicitly identified as an unsupported platform coverage limit before rollout.
- Managed deployments can enable/disable web reporting without rebuilding; local and third-party deployments do not silently report to Manabrew.
- Exceptions identify the exact build, retain safe session/game context, and resolve against the correct private maps when maps exist.
- Event payloads are sanitized, queues and ingestion are bounded, and telemetry failure never prevents play.
- Grafana queries, provisioned alerts, operational documentation, retention, and privacy disclosures match the deployed behavior.
- User-run browser/WebView verification is recorded before claiming coverage for those environments. Native crash reporting is not claimed.

## Documentation updates during implementation

Update `docs/OBSERVABILITY.md` with event fields, dashboard queries, alert thresholds, local startup, and coverage limits. Update `docs/DEPLOY.md` with runtime settings, collector/map provisioning, artifact retention, rollout, and rollback. Update the relevant frontend, desktop, Forge package, script, and website guidance only where implementation changes their documented contracts; read their scoped guides before editing those areas.

## References

- [Faro SDK and supported environments](https://github.com/grafana/faro-web-sdk)
- [Alloy Faro receiver, source maps, and security](https://grafana.com/docs/alloy/latest/reference/components/faro.receiver/)
- [Grafana Cloud Frontend Observability](https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/)

The references describe current upstream behavior. The implementation must validate features against the versions actually pinned in this repository.
