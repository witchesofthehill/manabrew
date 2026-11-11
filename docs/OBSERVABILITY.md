# Observability

Inventory of every Grafana panel and queryable data source in the stack. Config lives under `ops/observability/`; metric names are defined in code (`manabrew-server/src/metrics.rs`, `self-hosted-node/src/metrics.rs`) and the analytics schema in `scripts/ingest-events.py`. Keep this file in sync when adding a panel, metric, event, or column.

Frontend exception reporting and explicit client analytics use the Faro SDK, an isolated self-hosted collector, and Loki. Managed web and official macOS/Windows/iOS/Android builds report by default; generic/local builds stay off. Explicit `false` disables both. See [deployment settings](DEPLOY.md#frontend-error-reporting) and [rollout and rollback](DEPLOY.md#rollout-and-rollback).

## Dashboards

Provisioned from `ops/observability/grafana/dashboards/` via `provisioning/dashboards/provider.yml`.

For local product-dashboard testing, start the normal stack and the dev Grafana profile:

```bash
./dev start
docker compose -f compose.dev.yaml --profile observability up -d grafana
```

Open `http://localhost:3000` and sign in with `admin` / `admin`. The SQLite dashboards use `ops/hub-data/dev/events/events.db`. For Loki/Prometheus dashboards, start `grafana prometheus faro-collector loki` with the observability profile. Development ports bind only to loopback; no Docker log discovery is enabled.

### Client errors (`client-errors.json`)

Faro SDK `2.13.0` sends frontend exceptions through Caddy to the isolated Node collector, which enforces the shared privacy policy, resolves private maps, and writes to Loki. Backend container logs still use Alloy. The dashboard counts delivered exceptions, not affected sessions or users.

Filters cover environment, version, immutable build, platform, source, and engine. Sources are `startup`, `react`, `unhandled`, `engine-worker`, `render-worker`, `bot-worker`, `remote-engine`, and `engine-operation`. Normal cancellation, renderer capability fallback, Card Glint layout limits that fall back to the original scan, and ordinary protocol rejections are excluded. Recovery behavior and local console diagnostics remain unchanged.

The `unhandled` source covers uncaught exceptions and unhandled promise rejections, including non-Error thrown values. Global error handling preserves the existing `window.onerror` callback and reports each exception once.

The collector emits flat JSON. `type` contains an allowlisted error type, and `value` retains bounded error text after targeted best-effort scrubbing. `stacktrace` includes the scrubbed header, captured code locations and code-like function names, and bounded `Error.cause`/`AggregateError` descendants with scrubbed messages. `app_release` identifies the build. `context_source`, `context_operation`, `context_platform`, `context_build_target`, `context_route`, `context_engine`, and `context_signature` carry allowlisted context. Only `app`, `environment`, and `source` become Loki labels. Signatures use sanitized minified coordinates, so source-map cache state does not change grouping.

```logql
{app="manabrew-client",environment="production"} | json | kind="exception"
```

Report metadata excludes account, user, device, game, and session IDs, SDK session metadata, and persistent diagnostic identity. It provides no identity key to link a frontend exception to backend game records or count unique affected people. Existing Activity and Engagement dashboards still define a player by their full relay handle, including the guest suffix; error counts and signatures are not a second user-identity scheme. The collector necessarily receives the sender's IP address at transport, but does not add it to diagnostic events or retain collector access logs.

Stacks retain up to 50 root frames and five cause/aggregate descendants with at most 20 additional frames in total. App frames keep approved hashed `/assets/` paths; private maps restore developer source locations and function names inside authenticated Loki/Grafana. Browser-generated `VM` numbers, `debugger eval code`, and `<anonymous>` locations are retained as code-location labels, not user identity. Other recognized locations become fixed `app:///console`, `app:///eval`, `app:///native`, `app:///wasm`, `app:///blob`, `app:///external`, or `app:///local` markers. Origins, blob IDs, and local paths are removed from frame locations. Bounded code-like runtime function names survive filtering and targeted scrubbing; other function labels become `<anonymous>`. WASM function indices and numeric offsets are retained. Available positive line/column coordinates survive filtering. Missing maps leave compiled locations intact, and only approved app asset paths trigger map lookup.

Error and cause text is retained after bounded best-effort scrubbing of recognizable email addresses, guest handles, credentials, labeled personal fields, URLs and local paths, IP addresses, UUIDs, and long numeric or opaque tokens. These patterns cannot reliably detect arbitrary personal names or sensitive free prose, so do not put personal data or secrets in errors. Scrubbing does not guarantee anonymity or removal of all sensitive data. Context is rebuilt from allowlisted fields; raw user-agent strings, cookies, console output, request/network bodies, chat, deck contents, decision journals, and arbitrary app stores are not collected as context. Neither the original `Error.stack` header nor arbitrary cause objects are uploaded.

Each error also captures the following bounded `diagnostic_*` fields when available. The client and collector independently enforce the same schema; unknown keys and values are omitted. These are error-time snapshots, not independent page-view, click, or session events.

| Field                                  | Retained values                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `diagnostic_browser`                   | Chrome, Chromium, Edge, Firefox, Safari, Opera, or Samsung Internet family          |
| `diagnostic_browser_major`             | Major version only, from 1 to 999                                                   |
| `diagnostic_os`                        | Windows, macOS, iOS, Android, Linux, or ChromeOS family                             |
| `diagnostic_network`                   | `online` or `offline`, as reported by the browser                                   |
| `diagnostic_connection`                | `slow-2g`, `2g`, `3g`, or `4g` when supported                                       |
| `diagnostic_visibility`                | `visible`, `hidden`, or `prerender`                                                 |
| `diagnostic_viewport`                  | Width bucket: under 640, 640–1023, 1024–1439, or 1440+ CSS pixels                   |
| `diagnostic_orientation`               | `portrait` or `landscape`                                                           |
| `diagnostic_page_uptime`               | Under 10 seconds, 10 seconds–1 minute, 1–10 minutes, 10 minutes–1 hour, or 1+ hours |
| `diagnostic_cross_origin_isolated`     | Boolean                                                                             |
| `diagnostic_secure_context`            | Boolean                                                                             |
| `diagnostic_service_worker_controlled` | Boolean                                                                             |

Browser/OS classification is approximate, and `online` does not establish collector reachability. No high-entropy client hints, exact screen dimensions, hardware identifiers, or absolute page-start timestamp are collected. Omitting explicit identifiers does not guarantee that combinations of diagnostic fields are anonymous.

To check production delivery from the app's developer console, throw asynchronously so the page's global handler receives the exception:

```js
setTimeout(() => {
  throw new Error("Faro production smoke test");
}, 100);
```

Expect a `/collect` POST with HTTP 202, then inspect `stacktrace` in the Client Errors dashboard's Exception details or with the Loki query above. The message retains `Faro production smoke test`, with available positive line/column coordinates. The console frame may retain a browser `VM` label or `<anonymous>`, or use a synthetic `app:///console` or `app:///eval` marker. This validates reporting, not source-map resolution or native crash capture. Source maps require an error from a shipped app asset. Test outside an active game.

Events expire under Loki's existing 30-day retention. Client batches contain at most 10 items; transport queues at most 20 batches with one request in flight, a five-second timeout, and two attempts. There is no persistent retry queue. Offline clients, abrupt termination, static module failures before initialization, and WebView/process termination can lose reports. Native Rust/Forge dumps, OS kills, and rules correctness are outside this coverage.

For an isolated local collector without starting the app:

```bash
LOKI_DEV_PORT=13100 GRAFANA_DEV_PORT=13000 \
  docker compose -p manabrew-faro-local -f compose.dev.yaml \
  --profile observability up -d --build faro-collector loki
```

The collector is `http://127.0.0.1:12347/collect`; allowed browser origins are `http://localhost:1420` and `http://127.0.0.1:1420`. For a local frontend build set `VITE_FARO_ENABLED=true`, `VITE_FARO_ENVIRONMENT=development`, and `VITE_FARO_COLLECTOR_URL` to that collector. A runtime `observability` object takes precedence, including an explicit disable. Initialization runs once per page load.

Local `local-development` builds replace unpublished maps under `target/faro-sourcemaps/`. The collector checks size/mtime before reusing a map and retains no misses, so missing maps become available without a restart. Published directories remain immutable.

Collector metrics and `/health` are private on port 12347. Health includes Loki readiness. The collector also caps bytes per `context_signature` per UTC day (`FARO_SIGNATURE_DAILY_BYTES`, default 1/20 of the daily budget) and drops the excess as `faro_collector_signature_capped_total`, so one repeating error cannot exhaust the shared budget; the client separately reports each signature at most five times and at most 200 errors per page load. Prometheus scrapes `faro-collector`; `cargo xtask deploy` sends Prometheus `SIGHUP` so a changed scrape config takes effect without a recreate; alerts cover unreachable/unready collection, sustained export failures, daily budget usage above 90 percent, and RSS above 80 percent of the 512 MiB limit. These checks do not establish public DNS/TLS/Caddy reachability. No-client-traffic periods are not failures.

Metrics include `faro_collector_accepted_total`, `rejected_total`, `export_errors_total`, `mapped_frames_total`, `unmapped_frames_total`, `cache_entries`, `cache_bytes`, `cache_hits_total`, `cache_misses_total`, `cache_evictions_total`, `daily_bytes`, `daily_limit_bytes`, `resident_memory_bytes`, and `loki_ready`, all with the `faro_collector_` prefix. Cache bytes are an accounting estimate, not RSS. Read [collector limits](DEPLOY.md#private-source-maps) before changing quotas or interpreting partial source mapping.

### Client analytics (`client-analytics.json`)

Explicit client interactions, separate from backend game/account metrics. The dashboard shows screen views, import and lobby outcomes, feature uses, platform categories, an activity log, and a first observed match funnel. Loki panels count delivered events, not unique people or sessions. The funnel counts exact relay handles using durable SQLite summaries. A handle groups activity across launches, not necessarily the same person. Offline clients, abrupt termination, queue limits, retries, and quotas can lose or duplicate events. Collector arrival order is not guaranteed action order. Backend gameplay and account metrics remain authoritative.

| Event               | Attributes                              | Meaning                                                                                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screen_view`       | `screen`, `url`                         | Screen category and visited page URL on initial visits and pathname changes. The URL retains origin and pathname, including path IDs, but strips credentials, query strings, and fragments. Auth callbacks and developer routes are excluded; query/hash-only changes do not emit another view. |
| `deck_import`       | `source`, `mode`, `outcome`, `duration` | Completed create/add imports from text or the explicit clipboard action. Outcomes are `success`, `partial` for missing cards, or `failure`. An editor-session change that cancels application emits no result. Printing substitutions alone remain success.                                     |
| `lobby_wait`        | `outcome`, `duration`                   | Confirmed room waiting followed by `started` or explicit `left`, including switching rooms through an invite. Disconnects and room refreshes do not imply abandonment. This is not a matchmaking queue or a completed-game metric.                                                              |
| `feature_used`      | `feature`                               | Successful deck clipboard export or nonempty-deck playtest initiation, including opening Commander setup. Playtest initiation does not claim a game successfully started.                                                                                                                       |
| `first_game_funnel` | `stage`, `visit_id`, `clicks`           | Cumulative click checkpoints before the first observed match against AI or other players. Stages are `observed`, `match_requested`, and `game_started`. Deck-editor playtests, spectators, and engine-validation runs cannot complete the funnel.                                               |

Duration buckets are `under-1s`, `1-10s`, `10-60s`, `1-5m`, and `5m-plus`. Import sources are `text` and `clipboard`; modes are `create` and `add`; features are `deck_export` and `deck_playtest`. Screen values and every event-specific attribute live in `src/lib/clientAnalyticsPrivacy.ts`.

Use the client wrapper from an action handler:

```ts
import { trackClientEvent } from "@/lib/clientAnalytics";

function handleExportSuccess() {
  trackClientEvent("feature_used", { feature: "deck_export" });
}
```

`trackClientEvent(name, attributes)` is typed against `CLIENT_ANALYTICS_SCHEMA`. Add new event names and approved attribute values there before adding a callsite. The collector consumes the same schema, so deploy its update before clients send a new event or field. `screen_view.url` is the only permitted URL attribute, supplied by the navigation hook. `analyticsPageUrl` accepts HTTP(S) and Tauri URLs up to 2048 characters, strips credentials/query/fragment, and excludes auth callbacks and developer routes. The collector repeats this normalization and stores `event_url` as a JSON field, never a Loki label. Path IDs are retained. Invalid URLs reject the event; older records without a URL remain countable. Other attributes follow their approved categorical, UUID, or count rules. The funnel alone supplies its in-memory visit token and canonical decimal click count from `0` to `999999999`. Do not supply identity fields, other raw URLs/paths, separate account/device/game/session IDs, deck/card contents, search text, or arbitrary prose. Call only at the owning action boundary, rather than duplicating the same interaction across component layers. Do not import Faro in app handlers.

The wrapper automatically supplies platform metadata and `relay_username` from the shared `relayUsername()` helper at event creation. Signed-in accounts use their account handle; guests use the full persisted name including `@NNNN`. Renames, sign-in, and sign-out affect subsequent events, not events already queued. Callers cannot override the identity. Handles retain exact case and suffix, must be nonempty, at most 256 UTF-16 code units, and contain neither surrounding whitespace nor Unicode control characters. Invalid handles reject the event rather than truncating or merging identities. Missing handles from older clients remain uncorrelated events.

The isolated SDK instance has no SDK session tracking, SDK-generated persistent identity, or default page/browser/user metadata. Its privacy filter reconstructs app metadata and events from allowlists. Only the explicit funnel listener counts clicks; no raw click stream is sent. Reporting is a no-op when disabled or unavailable. Ordinary events are limited to 500 per page load and batches of at most 10. Coalesced funnel checkpoints bypass that cap and SDK batching so navigation and a later game start remain reportable; the same bounded transport queue and collector quota still apply. Repeated legitimate events are not deduplicated. This does not guarantee exactly-once delivery.

The collector independently rebuilds each record as `kind="event"`, `event_name`, approved `event_*` attributes, `context_platform`, optional `context_user_id`, and app name/version/release/environment. `context_user_id` contains the exact readable `relay_username`, including the guest suffix, and is displayed as **Activity user ID**. It is not hashed. Other client identity metadata and client-supplied `context_user_id` overrides are dropped. Only `app`, `environment`, and `source="analytics"` become Loki labels; handles stay in JSON fields. Records expire after 30 days under the existing Loki retention.

This is identifiable usage history, not anonymous analytics. Maintainers can read the handle and relate activity directly to relay game records. The same handle is recognizable across environments, although the dashboard scopes queries to the selected environment. Renaming or moving between guest and account handles creates separate histories, while the same account handle across devices shares one. The collector does not authenticate these client identity claims, so the ID is neither account proof nor authorization. Exception-report metadata remains unchanged and does not receive this ID. Earlier hashed records remain unchanged until retention removes them; new readable handles do not retroactively recover that history.

Enter the full relay handle, such as `player-gpf64i@6564`, into the dashboard's **Activity user ID** field to inspect delivered activity. A case-sensitive literal prefix also matches; empty shows all activity, including older hashed or unidentified records. The filter applies to the activity log and both first observed match panels, not the other aggregate panels. Equivalent exact-handle query:

```logql
{app="manabrew-client",environment="production",source="analytics"}
  | json | kind="event" | context_user_id="player-gpf64i@6564"
```

```logql
{app="manabrew-client",environment="production",source="analytics"} | json | kind="event"
```

Analytics reserves bytes in its own persisted budget and has independent rate/concurrency pools. `FARO_ANALYTICS_DAILY_BYTES` defaults to 10 MiB per UTC day. Metrics use `faro_collector_analytics_`: counters `accepted_total`, `rejected_total`, `export_errors_total`, `funnel_errors_total`, `rate_limited_total`, `concurrency_limited_total`, and `budget_limited_total`; gauges `daily_bytes`, `daily_limit_bytes`, `inflight`, and `rate_tokens`. Accepted counts records; rejected counts requests. Analytics quota exhaustion cannot consume the exception byte budget. Collector/Loki process and host failures can still affect both. A funnel SQLite failure returns 503 for the analytics request after Loki export; retrying may duplicate raw logs but cannot double count an accepted checkpoint.

#### First observed match funnel

The funnel accumulates recorded clicks across visits and devices under the exact environment and relay handle. It starts with this instrumentation, not a person's historical first-ever game. Renames and account/guest changes start separate histories. An actual playable match against AI or other players completes it; pressing Play, opening `/game`, optimistic launch state, failed starts, spectators, and deck-editor playtests do not.

The client counts trusted primary clicks and taps during navigation and setup without sending clicked elements, coordinates, text, or input values. Keyboard activation, scrolling, forwarded label clicks, and in-game interactions do not add clicks. Checkpoints coalesce for three seconds and flush on navigation, hide, and cleanup with their captured handle. Each visit uses an in-memory random UUID, a retry-deduplication token rather than a persistent device identifier. The token and count are JSON fields, never Loki labels. Auth callback and developer routes remain excluded. Setup clicks before a playtest can contribute to the count, but the playtest cannot complete the funnel.

The collector stores `client-funnel.db` in its existing state volume. `client_funnel_players` holds each handle's first/last observation, match-request and game-start timestamps, and recorded click total. `client_funnel_visits` holds pending per-visit high-water counts. Transactions add only positive count increases, so retries and older checkpoints do not add the same clicks again. The first received `game_started` checkpoint freezes the summary and deletes its visit state. Later visits and delayed checkpoints cannot change that completed total.

These are recorded counts, not a guarantee that every physical click arrived. A final checkpoint recovers earlier missing snapshots within its visit, but cannot recover a lost visit, clicks before instrumentation, or checkpoints arriving after completion. Milestone times use collector observation, not client action timestamps.

The time picker selects the cohort by **first observation**. Its funnel counts and per-player rows show that cohort's current lifetime status, even if completion falls outside the selected time range. Pending rows show clicks so far; completed rows show recorded clicks to the first observed match.

Raw checkpoint events expire from Loki after 30 days. Player summaries remain until explicitly deleted; pending visit high-water state remains until completion or deletion. Account deletion does not remove these handle-keyed records. To erase a summary on a writable collector database connection, bind the environment and exact handle:

```sql
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
DELETE FROM client_funnel_players
WHERE environment = ? AND relay_username = ? COLLATE BINARY;
COMMIT;
```

Pending visits cascade on deletion. Later telemetry can create a new summary. Preserve the separate budget files and source maps when removing a player's data. Deployment and the read-only Grafana mount are described in [DEPLOY.md](DEPLOY.md).

### Executive Health (`executive.json`)

The default product entry point. It is organized around four questions: current health, usage direction, drivers, and data confidence. It combines relay gameplay with sanitized Hub aggregates and links to each deeper dashboard.

| Section             | Main signals                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Are we healthy?     | active players, games, completion, accounts, collection adoption, user decks             |
| Is usage improving? | daily games/players, new accounts, new user decks                                        |
| What drives it?     | new/returning players, completion trend, format demand, play mode, non-game-over endings |
| Can we trust it?    | relay-event freshness, sanitized Hub-export freshness, dropped analytics/evidence        |
| Previous period     | player/game percentage change and completion percentage-point change                     |

### Activity (`activity.json`)

Active-user size, growth and retention. Every panel counts distinct handles over a rolling window, so no series on this dashboard is cumulative and none of them change meaning when the time picker moves.

| Section                     | Main signals                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| How many people are active? | DAU, WAU, MAU, DAU/MAU stickiness, WAU/MAU, new handles in range                                        |
| Is the active base growing? | rolling 1/7/28-day actives per day, stickiness trend, new/returning/resurrected, days active per player |
| Do they come back?          | weekly cohort retention grid, share returning within N days of first activity                           |

The `Counts as active` variable picks what activity means: `played` is a game started, relay or offline; `connected` is a relay authentication, which is relay only but catches a session that never reached a game; `any` is either. `played` is the default because it matches the Active players stat on Executive Health.

A player is one relay handle. Guest handles carry a `@NNNN` tag that disambiguates two people choosing the same name, so the whole handle is the identity and stripping the tag would merge them. A handle is not an account: the same person appears twice if they play signed out and signed in, and a guest who reinstalls gets a new tag. Both push the counts the same way — players over-counted, retention under-counted — so read retention as a floor.

The rolling windows are computed against all history, not just the selected range, so the left edge of the DAU/WAU/MAU chart is a true 28-day window rather than a partial one. DAU on the last day of the range is partial whenever the range ends at now. Cohort cells are blank, never zero, until their window has fully elapsed. Bot seats are excluded by handle: a bot reaches `client_connections` like any other client, and only `game_players.is_bot` records which handles are bots.

### Engagement & Gameplay (`engagement.json`)

Filtered diagnosis for player behavior and game friction. Global variables apply format, engine, hosted, and official-game filters consistently to the selected-period panels.

| Section            | Main signals                                                                    |
| ------------------ | ------------------------------------------------------------------------------- |
| Selected segment   | players, games, games/player, median and p90 duration, completion               |
| Behavior over time | games/players, completion, seven-day return cohorts, anonymous player frequency |
| Where is friction? | duration distribution, human participation, non-game-over ending reasons        |
| Platform usage     | distinct users and daily users across web, PWA, desktop, and mobile             |
| Tables             | table background mix — `table_style` on `game_started`, relay games only        |

The retention panel uses first relay appearance as the cohort date. Recent cohorts have not had a full seven-day observation window and are explicitly labelled incomplete.

### Decks & Collections (`decks-collections.json`)

Deck creation, publishing, discovery, collection adoption, and published-deck play evidence. Current-state panels say so explicitly; collection history begins with deployment of the sanitized exporter.

| Section                       | Main signals                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| Adoption now                  | collection users/cards/copies, user decks, publications, published-deck plays              |
| Is adoption growing?          | collection snapshots, deck/publication/favorite creation, play/completion/win evidence     |
| What do people build and own? | privacy-safe collection sizes, deck/publication formats, popular owned and published cards |
| Is discovery healthy?         | latest ranking-category coverage and publication lifecycle                                 |

### Live Ops (`live-ops.json`)

Datasources: Prometheus (`prometheus`), Loki (`loki`). Engine and decision latency live on Engine Health below.

| Panel                                     | Type       | Query                                                                                                                                |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Humans connected                          | stat       | `sum(manabrew_relay_connections{kind="human"})`                                                                                      |
| Games in progress                         | stat       | relay rooms in game plus `manabrew_relay_local_games`                                                                                |
| Hosted rooms (node)                       | stat       | `sum(manabrew_node_rooms_hosted)`                                                                                                    |
| Node push age (s)                         | stat       | `time() - max(push_time_seconds{job="self-hosted-node"})`                                                                            |
| Analytics events dropped                  | stat       | `sum(manabrew_relay_analytics_dropped_total)`                                                                                        |
| Node versions                             | table      | `manabrew_node_build_info`                                                                                                           |
| Connections by kind                       | timeseries | `sum by (kind) (manabrew_relay_connections)`                                                                                         |
| Rooms by status / hosted                  | timeseries | `sum by (status, hosted) (manabrew_relay_rooms)`                                                                                     |
| Games started / ended (per hour)          | timeseries | `sum(rate(manabrew_relay_games_started_total[1h])) * 3600` and `sum by (reason) (rate(manabrew_relay_games_ended_total[1h])) * 3600` |
| Client rejections by reason (per hour)    | timeseries | `sum by (reason) (rate(manabrew_relay_client_rejections_total[1h])) * 3600`                                                          |
| Engine errors by signature (10m increase) | timeseries | `sum by (signature) (increase(manabrew_node_engine_errors_total[10m]))`                                                              |
| Hosted game duration p50 / p95 (s)        | timeseries | `max(manabrew_node_game_duration_seconds{quantile="0.5"})` / `{quantile="0.95"}`                                                     |
| Reconnect resyncs (per hour)              | timeseries | `sum(rate(manabrew_relay_reconnect_resyncs_total[1h])) * 3600` and `sum(rate(manabrew_node_relay_reconnects_total[1h])) * 3600`      |
| Warnings & errors                         | logs       | Loki warnings/errors from relay, Hub, node, and events ingester                                                                      |
| Stuck-room signal                         | timeseries | Abandoned game reaps compared with other game endings over two hours                                                                 |
| Analytics waiting on the hub              | stat       | `spooled` minus `drained` of `manabrew_relay_analytics_delivered_total`                                                              |
| Hub analytics age                         | stat       | Seconds since the latest successful sanitized Hub export in `events.db`                                                              |
| Lobby players record                      | stat       | 30-day maximum of connected human player seats in lobby rooms                                                                        |
| Concurrent games record                   | stat       | 30-day maximum of the same sum                                                                                                       |
| Solo games in progress                    | timeseries | `sum by (kind) (manabrew_relay_local_games)`                                                                                         |
| Connected humans record                   | stat       | 30-day maximum of `manabrew_relay_connections{kind="human"}`                                                                         |
| Open rooms record                         | stat       | 30-day maximum of all lobby and in-game relay rooms                                                                                  |

### Engine Health (`engine-health.json`)

Everything about how fast an engine answers, in one place. The hosted half was the `#684` watch section of Live Ops and moved here whole. Datasources: Prometheus (`prometheus`), Loki (`loki`), SQLite (`events-sqlite`).

| Panel                                      | Type       | Query                                                                                                             |
| ------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Engine stopped (fraction of wall clock)    | timeseries | `rate(manabrew_node_engine_stall_millis_total[5m])` beside `rate(manabrew_node_engine_gc_pause_millis_total[5m])` |
| Engine heap used vs ceiling                | timeseries | `manabrew_node_engine_heap_used_bytes / manabrew_node_engine_heap_max_bytes`                                      |
| Decision stages p99                        | timeseries | `manabrew_node_forge_decision_stage_seconds{quantile="0.99"}` by `stage`                                          |
| Engine decision p99 by room shape          | timeseries | `histogram_quantile(0.99, …manabrew_node_forge_decision_seconds_bucket…)` by `seats`                              |
| Slow decisions per 5m                      | timeseries | bucket counts over 1s and 2s, which a quantile cannot show                                                        |
| Slow decisions (10s or more), with game id | logs       | Loki `{service="self-hosted-node"}` filtered on `slow engine decision`                                            |
| Relay state handling p99 by seats          | timeseries | `histogram_quantile(…manabrew_relay_state_handling_seconds_bucket…)`                                              |
| Outbound socket write and backlog          | timeseries | `manabrew_relay_socket_write_seconds_bucket`, `manabrew_relay_outbound_backlog_bucket`                            |
| Player round trip (heartbeat echo)         | timeseries | `manabrew_relay_client_rtt_ms`                                                                                    |
| Games measured                             | stat       | `engine_stats` rows in range                                                                                      |
| Reporting engines                          | stat       | distinct `engine_stats.engine`                                                                                    |
| forge-wasm / forge-hosted / manabrew p50   | stat       | median across games of `turnaround_p50` for that engine                                                           |
| Last report age                            | stat       | seconds since the newest `engine_stats.ts`                                                                        |
| Turnaround p50 / p90 by engine             | timeseries | daily median across games of each game's own percentile                                                           |
| Engines compared                           | table      | games, decisions, median p50/p90 and worst decision per engine and platform                                       |
| Engine think, split                        | table      | `engine_same_*` against `engine_cross_*` per engine and seat count, with windows dropped as hidden                |
| Engine think, owner                        | table      | `engine_bot_*` against `engine_rules_*` per seat count: who owned the wait, the bots or the rules engine          |
| Games reported per day by engine           | timeseries | `engine_stats` count by day and engine, which is also browser-engine adoption                                     |
| forge-wasm think time against turnaround   | timeseries | `engine_p50` against `turnaround_p50`; only the browser build reports its own think time                          |
| Client versions reporting                  | table      | `client_version`, `platform`, `engine`, games, average duration                                                   |
| Games with a player, and how many reported | timeseries | `games` with a human seat against those with an `engine_stats` row, per day                                       |
| Engine reports at the relay, by outcome    | timeseries | `sum by (outcome) (increase(manabrew_relay_engine_reports_total[1h]))`                                            |

Turnaround is measured on the client: the answer leaving to the next prompt landing. It includes the network for a hosted engine and nothing but the engine for a local one, which is what makes the engines comparable at all. Per-game percentiles are aggregated as medians across games, never as an average of averages. A game reports once, when it ends, and only if it had at least five decisions in it.

**`engine_*` is not per-decision time, and the unsplit number is dominated by seat count.** A think sample is the window from the player's answer landing to the next prompt being ready, so in a game against the AI it contains the opponents' whole turns. On 2026-08-31, two-seat forge-wasm games averaged a 77ms median against 997ms for four-seat ones: 13x for 3x the opponents. The node side already accounts for this, which is why `manabrew_node_forge_decision_stage_seconds` is split by seat count. **Cut by `seats` before comparing anything**, and prefer the split columns: `engine_same_*` is the engine resolving what the player just did, `engine_cross_*` is the opponents playing. `think_hidden` counts windows dropped for being measured across a backgrounded tab, where the wall clock keeps running and the worker does not.

**`engine_*` is also split by owner: `engine_bot_*` and `engine_rules_*`.** At a solo pod the board repaints only when the player is prompted, so every window is a frozen board, and the turn split above cannot say whose fault a long one was. The engine tags each window with the time its bot prompts took, snapshot, think and reply included; `engine_bot_*` is that part, `engine_rules_*` is the rest, the rules engine resolving what the table did. The two sum to `engine_*` per window. Read solo rows (`multiplayer = 0`): at a table the rules half also holds the other people's think. A game whose `engine_bot_max` is close to `engine_max` stalled on a bot; one whose `engine_rules_max` is, stalled on the rules. Null from clients before 2026-09-20 and from engines that do not tag their windows.

**`turnaround_*` is split into `client_work_*` and `reply_wait_*`.** `client_work_*` is the time the client spent handling the frames that arrived between its answer and the next prompt: parsing and applying each one, the prompt's own frame included. `reply_wait_*` is the rest. The two sum to `turnaround_*` per decision.

`reply_wait_*` is a residual and not a network measurement, so what is in it depends on the engine. On `forge-hosted` and `forge-remote` it is the server, the hop, the player's link, the transfer, and whatever the other seats did. On `forge-wasm` and `forge-desktop` there is no wire in it at all: it is the engine's own think plus the seat drain, and it tracks `engine_*` rather than anything about the player's connection. Never read it as latency without cutting by `engine`.

Render is in neither half, on any engine. The window closes when the prompt is routed into the store, before React commits it, so the paint that shows the prompt falls outside the window and is not measured here.

**Two boundary changes, and the series does not join across either.**

- **2026-09-17 (v3.44.4)** the cut moved off the first frame after the answer. In a room that frame is the echo of the player's own action, so an opponent's whole turn had been landing in `client_work_*`: it scaled with seat count and hit tens of seconds at p90. Rows from clients older than v3.44.4 carry that reading. Solo forge-wasm rows were unaffected (one frame, ~17ms).
- **2026-09-22** the browser engine's stamp moved ahead of its `JSON.parse`. Until then it was taken in `dispatchEngineMessage`, after the seat reader had already parsed, so parsing a state frame was billed to `reply_wait_*`. Both transports now cut in the same place. Expect `client_work_*` on `forge-wasm` to step up and `reply_wait_*` to step down by the parse cost, with `turnaround_*` unchanged; the versions either side of it are not comparable on the split.

Null from clients that predate the split and from engines with no frame boundary.

`engine` names what ran, not what the room asked for: `forge-hosted` (a node), `forge-desktop` (the desktop build hosting its own room), `forge-wasm` (the browser build in this tab), `forge-remote` (Forge in another player's client), `manabrew`, `ironsmith`. The label is fixed when the game starts, because a hosted game is driven through the Manabrew runtime like any other and cannot be recognised afterwards.

**The vocabulary changed twice, so a window that spans either date mixes two meanings.** Before 3.34.2 a seat in a browser-hosted room reported `forge-hosted`, which is what the node fleet reports, so peer-hosted and node-hosted games pooled. From 3.34.2 the seats of a node-hosted room reported `forge-remote`, which pooled them the other way, with the fleet's own games nearly disappearing from `forge-hosted`. Since `roomEngineLabel` gained the room's `hosted` flag, the four labels above each mean one thing. Clients update when the player reloads, so both old vocabularies keep arriving for a while after each date: cut by `client_version`, or join `games.hosted` and trust that instead.

The last two panels are the ones to read before believing any of the others. A report that is never sent leaves no row anywhere and the engine panels above simply undercount, silently and without a gap in the series. A report that arrives after the seat has left its room is kept and counted as `accepted_roomless`: the relay used to drop those, which cost about two reports in three on the hosted path.

### Offline games

An offline game never touches the relay, so no relay `game_id` exists for it and it cannot be counted from relay traffic. The client mints its own id at launch and reports the game to the hub instead (`POST /api/stats/game`, table `offline_play_games`), and `scripts/ingest-events.py` expands it into `games`, `game_players`, `decks` and `deck_cards` alongside relay games under that id. The engine report for the same game carries the id too, so `engine_stats.game_id` joins to `games.game_id` on both routes. `games.source` separates the two (`relay` or `offline`) and `games.reported_at` is the ingest watermark; rows predating the column are relay games.

This restores what the hosted nodes recorded for Play vs AI before the engine moved into the browser, so those games count again in duration, completion, format mix, winrate and card popularity. Two caveats. It names players, unlike `engine_play_stats` next to it, which is why `Storage::delete_account` scrubs erased handles out of the offline tables. And a game reports once, at game over or teardown, from a queue that survives a reload: a player who never reopens the app is a game that never arrives.

That covers a game after it ends. While one is running the relay has nothing to go on either, so the client says so directly: `ClientMessage::SetLocalGame` carries a `LocalGameKind` (today only `Singleplayer`), the relay holds it on the session, and it surfaces in two places. `manabrew_relay_local_games{kind}` counts it, and the lobby's player list shows the player under Playing instead of Available.

Three things follow from where that number comes from. It counts only clients connected to the relay, and a solo game needs no relay, so read it as a floor rather than a count. It is session state, so a dropped socket clears it and the client re-asserts after a reconnect. And it is a claim by the client, not something the relay observed, which is the opposite of every other series on these dashboards: `manabrew_relay_rooms` stays purely relay-side, and the two are summed in the panel rather than merged in the exporter so the distinction survives.

### Analytics Explorer (`product.json`)

Broad all-in-one inventory retained for ad hoc analysis and schema inspection. The curated dashboards above should be the normal operational entry points. Datasource: SQLite (`events-sqlite`, `frser-sqlite-datasource`) over the analytics DB built by `scripts/ingest-events.py`.

| Panel                    | Type       | Queries against                                                   |
| ------------------------ | ---------- | ----------------------------------------------------------------- |
| Games                    | stat       | `games`                                                           |
| Distinct players         | stat       | `game_players` (humans only, de-tagged)                           |
| Median game (min)        | stat       | `games.duration_s`                                                |
| p90 game (min)           | stat       | `games.duration_s`                                                |
| Completion rate          | stat       | `games.game_over` / `ended_at`                                    |
| Games started per hour   | timeseries | `games.started_at`, bucketed hourly                               |
| Active players per hour  | timeseries | `games` ⋈ `game_players`, distinct de-tagged humans               |
| Game length              | barchart   | `games.duration_s` bucketed (`<3` … `30+` min)                    |
| Games per player         | barchart   | anonymous human activity buckets in the selected range            |
| Game ends by reason      | barchart   | `games.end_reason`                                                |
| Format split             | barchart   | `games.format`                                                    |
| Games by human count     | barchart   | `games` ⋈ `game_players` (bots only / solo vs AI / 2 humans / 3+) |
| Top commanders           | table      | `decks.commander` (humans, top 20)                                |
| Top decks by games       | table      | `game_players.deck_name` (humans, top 20)                         |
| Top cards                | table      | `deck_cards` (copies + distinct decks, top 25)                    |
| Player growth            | timeseries | first-seen day per de-tagged player, cumulative                   |
| Accounts                 | stat       | latest sanitized Hub account count                                |
| Collection users         | stat       | accounts with a non-empty synced collection                       |
| User decks               | stat       | current non-deleted user decks                                    |
| Active sessions          | stat       | current unexpired sessions, aggregate only                        |
| Account growth           | timeseries | daily account creation                                            |
| Deck creation            | timeseries | daily deck creation by kind                                       |
| Auth providers           | barchart   | linked identity counts by provider                                |
| Deck visibility          | barchart   | current non-deleted decks by visibility                           |
| Publication status       | barchart   | current Deck Hub entries by status                                |
| Collection adoption      | timeseries | hourly collector and unique-card snapshots                        |
| Published deck plays     | timeseries | daily play evidence by source and hosting mode                    |
| Popular collection cards | table      | aggregate ownership, suppressed below two collectors              |
| Cards in published decks | table      | aggregate card inclusion in current published versions            |
| Analytics coverage       | table      | sanitized row counts for every Hub table                          |
| Hub export health        | stat       | export age, source schema version, and export duration            |

## Queryable sources

### Prometheus — relay metrics

Defined in `manabrew-rs/crates/manabrew-server/src/metrics.rs`, served on the health port at `/metrics`, scraped per `ops/observability/prometheus/prometheus.yml` (job `relay`).

| Metric                                     | Kind    | Labels                                |
| ------------------------------------------ | ------- | ------------------------------------- |
| `manabrew_relay_connections`               | gauge   | `kind`                                |
| `manabrew_relay_players`                   | gauge   | `kind`, `status`                      |
| `manabrew_relay_rooms`                     | gauge   | `status`, `hosted`                    |
| `manabrew_relay_games_started_total`       | counter | `engine`                              |
| `manabrew_relay_engine_reports_total`      | counter | `outcome`                             |
| `manabrew_relay_games_ended_total`         | counter | `reason`                              |
| `manabrew_relay_client_rejections_total`   | counter | `reason` (e.g. `outdated_wire`)       |
| `manabrew_relay_reconnect_resyncs_total`   | counter | —                                     |
| `manabrew_relay_analytics_dropped_total`   | counter | —                                     |
| `manabrew_relay_analytics_delivered_total` | counter | `path` (`live`, `spooled`, `drained`) |

### Prometheus — self-hosted-node metrics

Defined in `manabrew-rs/crates/self-hosted-node/src/metrics.rs`; pushed to the push gateway (`SELF_HOSTED_NODE_METRICS_PUSH_URL` / `_USERNAME` / `_PASSWORD`), which adds `push_time_seconds{job="self-hosted-node"}` used for staleness checks.

| Metric                                       | Kind    | Labels                            |
| -------------------------------------------- | ------- | --------------------------------- |
| `manabrew_node_rooms_hosted`                 | gauge   | `pool`                            |
| `manabrew_node_games_active`                 | gauge   | —                                 |
| `manabrew_node_game_duration_seconds`        | summary | `clean`, `players` (+ `quantile`) |
| `manabrew_node_forge_decision_stage_seconds` | summary | `stage` (+ `quantile`)            |
| `manabrew_node_engine_errors_total`          | counter | `signature`                       |
| `manabrew_node_relay_reconnects_total`       | counter | —                                 |
| `manabrew_node_build_info`                   | gauge   | `version`                         |

`manabrew_node_forge_decision_stage_seconds` splits Forge-hosted decisions into `bridge_mutex`, `submit_action`, `next_prompt`, `decision_total`, and `snapshots`. `decision_total` begins when the hosted engine thread accepts a validated remote response; relay capture remains the source for time spent before that boundary.

### Engine JVM GC logs

`SELF_HOSTED_NODE_JAVA_GC_LOG=stderr` makes the engine JVM emit `-Xlog:gc*` on stderr, which the
node forwards at `info`, so a containerised node's GC log reaches Loki through the same
`discovery.docker` path as everything else. `staging` sets it by default. Query with
`{service="self-hosted-node-staging"} |= "[gc"`. The `gc,init` lines at startup record what the JVM
picked for heap and GC threads, which is the `jcmd VM.flags` evidence #684 asks for. Point the
variable at a directory instead to write rotating files, for a node that is not in a container.

### SQLite analytics DB

The hub is the store. The relay posts every analytics event, one JSON line each, to `POST /internal/analytics/events` (bearer `HUB_RELAY_DECK_PLAYS_TOKEN`), and the hub keeps the line verbatim in `relay_events` (migration 23) keyed by the SHA-256 of the line, so a redelivered batch is one row. `MANABREW_EVENTS_DIR` on the relay is now a spool: a batch the hub refuses or cannot be reached for is written there as `spool-*.jsonl` and drained on a timer, along with any `events-*.jsonl` daily file from before the change, which is how the history reached the hub. `manabrew_relay_analytics_delivered_total{path}` counts `live`, `spooled` and `drained` lines; `spooled` running ahead of `drained` means the hub is down. A relay with the directory and no hub URL (self-hosted) keeps writing the daily files.

`scripts/ingest-events.py` opens `hub.db` query-only, pulls `relay_events` past the last row id it saw (`ingest_state`, key `hub:relay_events`) and materialises them into `events.db`; Grafana reads that via the `events-sqlite` datasource and never mounts or queries `hub.db`. `events.event_id` carries the same hash, so a line already present is skipped: the ingester can be pointed at a fresh `events.db` to rebuild it from the hub, or left on the existing one, and neither duplicates. The same process materialises the sanitized Hub analytics below.

| Table                   | Columns                                                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `games`                 | `game_id`, `room_id`, `started_at`, `ended_at`, `duration_s`, `format`, `engine`, `hosted`, `official`, `starting_life`, `player_count`, `end_reason`, `game_over`, `winner`, `reported`, `turns`, `direct_seats`, `source`  |
| `game_players`          | `game_id`, `username`, `is_bot`, `deck_name`, `commander`, `published_deck_id`, `deck_fingerprint`                                                                                                                           |
| `decks`                 | `deck_id`, `ts`, `room_id`, `username`, `is_bot`, `deck_name`, `commander`, `sideboard_count`                                                                                                                                |
| `deck_cards`            | `deck_id`, `name`, `set_code`, `count`                                                                                                                                                                                       |
| `events`                | `id`, `ts`, `event`, `room_id`, `payload` (raw JSON), `event_id` (SHA-256 of the payload, the idempotency key)                                                                                                               |
| `engine_stats`          | `report_id`, `ts`, `source` (`relay` or `hub`), `game_id`, `engine`, `client_version`, `platform`, `format`, `seats`, `multiplayer`, `duration_s`, `end_reason`, `decisions`, `turnaround_p50/p90/max`, `engine_p50/p90/max` |
| `client_connections`    | `id`, `ts`, `username`, classified `platform`, reconnect flag, `acquisition_source`                                                                                                                                          |
| `plane_attempts`        | one row per `plane_quality` report: `username`, `peer`, `plane`, `outcome`, `phase`, `connect_ms`, `rtt_ms`, `relay_rtt_ms`, `candidate_pair`                                                                                |
| `ingest_state`          | `file`, `byte_offset`; `hub:relay_events` holds the last `relay_events.id` materialised, older rows are the retired JSONL offsets                                                                                            |
| `hub_sync_state`        | latest successful export time, Hub schema version, export duration                                                                                                                                                           |
| `hub_metric_snapshots`  | hourly aggregate Hub metrics with a non-identifying dimension                                                                                                                                                                |
| `hub_daily_metrics`     | recomputed daily account, identity, deck, publication, favorite, and play-evidence aggregates                                                                                                                                |
| `hub_collection_cards`  | current card ownership totals; cards with fewer than two collectors are omitted                                                                                                                                              |
| `hub_public_deck_cards` | current aggregate card inclusion across published deck versions                                                                                                                                                              |

The Hub export covers row counts for `schema_version`, `accounts`, `identities`, `sessions`, `login_tokens`, `oauth_states`, `auth_codes`, `decks`, `deck_versions`, `deck_cards`, `deckhub_entries`, `deckhub_tags`, `deckhub_entry_tags`, `deckhub_favorites`, `top_deck_buckets`, `top_deck_snapshots`, `deck_play_reports`, `engine_play_stats`, `card_collection`, `card_collection_versions`, and `data_migrations`. It additionally exports only the aggregates needed for product analysis.

The Hub analytics boundary excludes emails, usernames, account IDs, provider user IDs, session/token/code/state hashes, IP addresses, private deck snapshots, raw per-account collections, and Hub game/player keys. Collection-card rankings suppress cards held by fewer than two accounts, and collection-size distributions export only aggregate buckets. Collection history starts when the exporter is deployed because the source schema stores only current collection state and a version counter. Daily source-derived aggregates are rebuilt on every refresh so late data and corrections converge.

Source events (`manabrew-server/src/analytics/event.rs`, snake_case `event` tag): `client_connected`, `game_started`, `game_ended`, `deck_selected`, `seat_joined`, `seat_left`, `engine_stats`, `transport_used`, `plane_quality`. Clients classify themselves as `web`, `pwa`, `desktop`, or `mobile` during relay authentication; older clients appear as `unknown`. Raw user-agent strings are never sent or stored. `client_connected.acquisition_source` is a bucket the client derives on page load from `?src=` (set by the landing page), `utm_source`, or the referrer host (`src/lib/acquisitionSource.ts`); the relay records anything outside `ACQUISITION_SOURCES` as `other`, and clients before the field omit it. Desktop and mobile shells always report `direct`. Read it from each username's first connection of a day; reconnects repeat it.

The outcome of a game (`game_over`, `winner`, concessions, `turns`, an engine fatal) is filed by the seat that ran the engine, over the lobby socket for relay games (`ReportGameOutcome`, see `docs/agents/RELAY.md`) and over `POST /api/stats/game` for offline ones. The relay no longer reads it off the state stream, which since `docs/TRANSPORT.md` need not pass through it. `games.reported` is 1 when a report arrived, 1 for every offline row, and NULL for relay rows written before the change, whose outcome was observed. A relay row with `reported = 0` has a lifecycle `end_reason` and a `game_over` of 0 that means "nobody said", so completion rate should be read over `reported = 1` or over `reported IS NULL` from before the change, never mixed. `games.direct_seats` counts the seats the host served off the relay, from its `transport_used` report, and is NULL when none did; the report names only those seats, so read it against `player_count`.

Migrations 7 and 8 establish the Hub evidence schema, migration 9 adds the expanded Top Deck categories, and migration 10 tracks the latest refresh even when a category is empty. The first Hub startup after migration 8 performs a one-time import of eligible publication-linked analytics rows into `hub.db.deck_play_reports`. Top Decks has no live analytics-database dependency after that import. Managed-relay starts and outcomes are the `game_started` and `game_ended` lines of the relay's analytics feed (`relay_events`): the hub applies each new line to `deck_play_reports` as it stores it, so the evidence rides the same durable channel as the analytics and a redelivered line cannot count twice. `/internal/deckhub/relay-games` remains for a relay from before the feed. Offline and hosted-AI clients use the public play-report endpoint. Hosted Relay rooms are excluded from the dedicated channel to avoid counting the same human play twice, and bot seats never contribute. Ranking refreshes read Hub evidence, favorites, publication dates, and snapshot tables. Stored relay game/player keys are hashed, and no username or card list is retained in the Hub.

Automated snapshots cover 30-day Most Played, seven-day Rising, confidence-adjusted Highest Win Rate, Commander Most Played, Most Favorited, and New & Notable. Highest Win Rate requires 20 completed managed-relay matches and uses the 95% Wilson lower bound. Staff Picks remains an editorial snapshot.

Staging additionally applies `ops/staging-migrations/001_top_deck_filler.sql` after Hub is healthy. That environment-only data migration inserts current-dated evidence for five preset publications and records `staging-top-deck-filler-v1` in `data_migrations`; production Compose never mounts or executes it.

Known gap: "Player growth" is cumulative, so it only ever rises, and it is the one panel that keys players on the handle with its `@NNNN` tag stripped, which merges two players who picked the same name. Activity above supersedes it.

Known gap: `game_players.commander` and `decks.commander` hold a single name, so the second partner commander never reaches "Top commanders".

### Loki

Service logs shipped by Alloy (`ops/observability/alloy/config.alloy`). It discovers every container on the Docker socket with no allowlist, so each one ships, labelled `service` with its compose service name and `container` with its container name.

## Provisioned alerts

`ops/observability/grafana/provisioning/alerting/rules.yml` (contact points and routing in `contactpoints.yml` / `policies.yml`):

| Alert                            | Signal                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| relay down                       | `up{job="relay"}`                                                                    |
| node fleet silent                | `time() - push_time_seconds{job="self-hosted-node"}`                                 |
| hosted rooms below expected      | `sum(manabrew_node_rooms_hosted)`                                                    |
| engine error spike               | `sum(increase(manabrew_node_engine_errors_total[10m]))`                              |
| outdated client burst            | `sum(increase(manabrew_relay_client_rejections_total{reason="outdated_wire"}[15m]))` |
| traffic cliff (EU daytime)       | `max_over_time(manabrew_relay_connections{kind="human"}[30m])` gated on hour-of-day  |
| client error burst               | At least 10 production exceptions in 10 minutes, based on event count only           |
| client telemetry collector down  | Alloy scrape unavailable for two minutes, including missing scrape data              |
| client telemetry export failures | Faro exporter errors or dropped Loki entries sustained for five minutes              |

Client rules live in `client-errors.yml` and reuse the existing contact point. Notifications contain bounded operational summaries, not exception details or game/session IDs. Staging errors do not trigger the production burst alert.

## Datasources

`ops/observability/grafana/provisioning/datasources/datasources.yml`:

| Name       | uid             | Type                      |
| ---------- | --------------- | ------------------------- |
| Prometheus | `prometheus`    | `prometheus`              |
| Loki       | `loki`          | `loki`                    |
| Events     | `events-sqlite` | `frser-sqlite-datasource` |
