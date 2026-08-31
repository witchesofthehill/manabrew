# Observability

Inventory of every Grafana panel and queryable data source in the stack. Config lives under `ops/observability/`; metric names are defined in code (`manabrew-server/src/metrics.rs`, `self-hosted-node/src/metrics.rs`) and the analytics schema in `scripts/ingest-events.py`. Keep this file in sync when adding a panel, metric, event, or column.

## Dashboards

Provisioned from `ops/observability/grafana/dashboards/` via `provisioning/dashboards/provider.yml`.

For local product-dashboard testing, start the normal stack and the dev Grafana profile:

```bash
./dev start
docker compose -f compose.dev.yaml --profile observability up -d grafana
```

Open `http://localhost:3000` and sign in with `admin` / `admin`. The SQLite dashboards use `ops/hub-data/dev/events/events.db`, refreshed from the local Hub every five minutes. Live Ops Prometheus and Loki panels do not have local datasources in `compose.dev.yaml`; validate those panels against the production observability stack.

### Executive Health (`executive.json`)

The default product entry point. It is organized around four questions: current health, usage direction, drivers, and data confidence. It combines relay gameplay with sanitized Hub aggregates and links to each deeper dashboard.

| Section             | Main signals                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Are we healthy?     | active players, games, completion, accounts, collection adoption, user decks             |
| Is usage improving? | daily games/players, new accounts, new user decks                                        |
| What drives it?     | new/returning players, completion trend, format demand, play mode, non-game-over endings |
| Can we trust it?    | relay-event freshness, sanitized Hub-export freshness, dropped analytics/evidence        |
| Previous period     | player/game percentage change and completion percentage-point change                     |

### Engagement & Gameplay (`engagement.json`)

Filtered diagnosis for player behavior and game friction. Global variables apply format, engine, hosted, and official-game filters consistently to the selected-period panels.

| Section            | Main signals                                                                    |
| ------------------ | ------------------------------------------------------------------------------- |
| Selected segment   | players, games, games/player, median and p90 duration, completion               |
| Behavior over time | games/players, completion, seven-day return cohorts, anonymous player frequency |
| Where is friction? | duration distribution, human participation, non-game-over ending reasons        |
| Platform usage     | distinct users and daily users across web, PWA, desktop, and mobile             |

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
| Deck-play events dropped                  | stat       | `sum(manabrew_relay_deck_play_events_dropped_total)`                                                                                 |
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
| Games reported per day by engine           | timeseries | `engine_stats` count by day and engine, which is also browser-engine adoption                                     |
| forge-wasm think time against turnaround   | timeseries | `engine_p50` against `turnaround_p50`; only the browser build reports its own think time                          |
| Client versions reporting                  | table      | `client_version`, `platform`, `engine`, games, average duration                                                   |
| Games with a player, and how many reported | timeseries | `games` with a human seat against those with an `engine_stats` row, per day                                       |
| Engine reports at the relay, by outcome    | timeseries | `sum by (outcome) (increase(manabrew_relay_engine_reports_total[1h]))`                                            |

Turnaround is measured on the client: the answer leaving to the next prompt landing. It includes the network for a hosted engine and nothing but the engine for a local one, which is what makes the engines comparable at all. Per-game percentiles are aggregated as medians across games, never as an average of averages. A game reports once, when it ends, and only if it had at least five decisions in it.

**`engine_*` is not per-decision time, and the unsplit number is dominated by seat count.** A think sample is the window from the player's answer landing to the next prompt being ready, so in a game against the AI it contains the opponents' whole turns. On 2026-08-31, two-seat forge-wasm games averaged a 77ms median against 997ms for four-seat ones: 13x for 3x the opponents. The node side already accounts for this, which is why `manabrew_node_forge_decision_stage_seconds` is split by seat count. **Cut by `seats` before comparing anything**, and prefer the split columns: `engine_same_*` is the engine resolving what the player just did, `engine_cross_*` is the opponents playing. `think_hidden` counts windows dropped for being measured across a backgrounded tab, where the wall clock keeps running and the worker does not.

`engine` names what ran, not what the room asked for: `forge-hosted` (a self-hosted node), `forge-desktop` (the desktop build hosting its own room), `forge-wasm` (the browser build), `manabrew`, `ironsmith`. The label is fixed when the game starts, because a hosted game is driven through the Manabrew runtime like any other and cannot be recognised afterwards.

The last two panels are the ones to read before believing any of the others. A report that is never sent, or that arrives after the seat is gone, leaves no row anywhere: the engine panels above simply undercount, silently and without a gap in the series.

### Offline games

An offline game never touches the relay, so it has no `game_id` and cannot be counted from relay traffic. The client reports it to the hub instead (`POST /api/stats/game`, table `offline_play_games`), and `scripts/ingest-events.py` expands it into `games`, `game_players`, `decks` and `deck_cards` alongside relay games. `games.source` separates the two (`relay` or `offline`) and `games.reported_at` is the ingest watermark; rows predating the column are relay games.

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

| Metric                                          | Kind    | Labels                          |
| ----------------------------------------------- | ------- | ------------------------------- |
| `manabrew_relay_connections`                    | gauge   | `kind`                          |
| `manabrew_relay_players`                        | gauge   | `kind`, `status`                |
| `manabrew_relay_rooms`                          | gauge   | `status`, `hosted`              |
| `manabrew_relay_games_started_total`            | counter | `engine`                        |
| `manabrew_relay_engine_reports_total`           | counter | `outcome`                       |
| `manabrew_relay_games_ended_total`              | counter | `reason`                        |
| `manabrew_relay_client_rejections_total`        | counter | `reason` (e.g. `outdated_wire`) |
| `manabrew_relay_reconnect_resyncs_total`        | counter | —                               |
| `manabrew_relay_analytics_dropped_total`        | counter | —                               |
| `manabrew_relay_deck_play_events_dropped_total` | counter | —                               |

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

`scripts/ingest-events.py` tails the relay's analytics JSONL (`MANABREW_EVENTS_DIR`) into SQLite; Grafana reads it via the `events-sqlite` datasource. The same process opens `hub.db` query-only when `--hub-db` is configured and materializes sanitized analytics into `events.db`. Grafana never mounts or queries `hub.db`.

| Table                   | Columns                                                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `games`                 | `game_id`, `room_id`, `started_at`, `ended_at`, `duration_s`, `format`, `engine`, `hosted`, `official`, `starting_life`, `player_count`, `end_reason`, `game_over`, `winner`                                                 |
| `game_players`          | `game_id`, `username`, `is_bot`, `deck_name`, `commander`, `published_deck_id`, `deck_fingerprint`                                                                                                                           |
| `decks`                 | `deck_id`, `ts`, `room_id`, `username`, `is_bot`, `deck_name`, `commander`, `sideboard_count`                                                                                                                                |
| `deck_cards`            | `deck_id`, `name`, `set_code`, `count`                                                                                                                                                                                       |
| `events`                | `id`, `ts`, `event`, `room_id`, `payload` (raw JSON)                                                                                                                                                                         |
| `engine_stats`          | `report_id`, `ts`, `source` (`relay` or `hub`), `game_id`, `engine`, `client_version`, `platform`, `format`, `seats`, `multiplayer`, `duration_s`, `end_reason`, `decisions`, `turnaround_p50/p90/max`, `engine_p50/p90/max` |
| `client_connections`    | `id`, `ts`, `username`, classified `platform`, reconnect flag                                                                                                                                                                |
| `ingest_state`          | `file`, `byte_offset`                                                                                                                                                                                                        |
| `hub_sync_state`        | latest successful export time, Hub schema version, export duration                                                                                                                                                           |
| `hub_metric_snapshots`  | hourly aggregate Hub metrics with a non-identifying dimension                                                                                                                                                                |
| `hub_daily_metrics`     | recomputed daily account, identity, deck, publication, favorite, and play-evidence aggregates                                                                                                                                |
| `hub_collection_cards`  | current card ownership totals; cards with fewer than two collectors are omitted                                                                                                                                              |
| `hub_public_deck_cards` | current aggregate card inclusion across published deck versions                                                                                                                                                              |

The Hub export covers row counts for `schema_version`, `accounts`, `identities`, `sessions`, `login_tokens`, `oauth_states`, `auth_codes`, `decks`, `deck_versions`, `deck_cards`, `deckhub_entries`, `deckhub_tags`, `deckhub_entry_tags`, `deckhub_favorites`, `top_deck_buckets`, `top_deck_snapshots`, `deck_play_reports`, `engine_play_stats`, `card_collection`, `card_collection_versions`, and `data_migrations`. It additionally exports only the aggregates needed for product analysis.

The Hub analytics boundary excludes emails, usernames, account IDs, provider user IDs, session/token/code/state hashes, IP addresses, private deck snapshots, raw per-account collections, and Hub game/player keys. Collection-card rankings suppress cards held by fewer than two accounts, and collection-size distributions export only aggregate buckets. Collection history starts when the exporter is deployed because the source schema stores only current collection state and a version counter. Daily source-derived aggregates are rebuilt on every refresh so late data and corrections converge.

Source events (`manabrew-server/src/analytics/event.rs`, snake_case `event` tag): `client_connected`, `game_started`, `game_ended`, `deck_selected`, `seat_joined`, `seat_left`, `engine_stats`. Clients classify themselves as `web`, `pwa`, `desktop`, or `mobile` during relay authentication; older clients appear as `unknown`. Raw user-agent strings are never sent or stored.

Migrations 7 and 8 establish the Hub evidence schema, migration 9 adds the expanded Top Deck categories, and migration 10 tracks the latest refresh even when a category is empty. The first Hub startup after migration 8 performs a one-time import of eligible publication-linked analytics rows into `hub.db.deck_play_reports`. Top Decks has no live analytics-database dependency after that import. New managed-relay starts and outcomes use a dedicated Deck Play evidence channel and write directly to the Hub through `/internal/deckhub/relay-games`; offline and hosted-AI clients use the public play-report endpoint. Hosted Relay rooms are excluded from the dedicated channel to avoid counting the same human play twice, and bot seats never contribute. Ranking refreshes read Hub evidence, favorites, publication dates, and snapshot tables. Stored relay game/player keys are hashed, and no username or card list is retained in the Hub.

Automated snapshots cover 30-day Most Played, seven-day Rising, confidence-adjusted Highest Win Rate, Commander Most Played, Most Favorited, and New & Notable. Highest Win Rate requires 20 completed managed-relay matches and uses the 95% Wilson lower bound. Staff Picks remains an editorial snapshot.

Staging additionally applies `ops/staging-migrations/001_top_deck_filler.sql` after Hub is healthy. That environment-only data migration inserts current-dated evidence for five preset publications and records `staging-top-deck-filler-v1` in `data_migrations`; production Compose never mounts or executes it.

Known gap: `game_players.commander` and `decks.commander` hold a single name, so the second partner commander never reaches "Top commanders".

### Loki

Service logs shipped by Alloy (`ops/observability/alloy/config.alloy`). It discovers every container on the Docker socket with no allowlist, so each one ships, labelled `service` with its compose service name and `container` with its container name.

## Provisioned alerts

`ops/observability/grafana/provisioning/alerting/rules.yml` (contact points and routing in `contactpoints.yml` / `policies.yml`):

| Alert                       | Signal                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------ |
| relay down                  | `up{job="relay"}`                                                                    |
| node fleet silent           | `time() - push_time_seconds{job="self-hosted-node"}`                                 |
| hosted rooms below expected | `sum(manabrew_node_rooms_hosted)`                                                    |
| engine error spike          | `sum(increase(manabrew_node_engine_errors_total[10m]))`                              |
| outdated client burst       | `sum(increase(manabrew_relay_client_rejections_total{reason="outdated_wire"}[15m]))` |
| traffic cliff (EU daytime)  | `max_over_time(manabrew_relay_connections{kind="human"}[30m])` gated on hour-of-day  |

## Datasources

`ops/observability/grafana/provisioning/datasources/datasources.yml`:

| Name       | uid             | Type                      |
| ---------- | --------------- | ------------------------- |
| Prometheus | `prometheus`    | `prometheus`              |
| Loki       | `loki`          | `loki`                    |
| Events     | `events-sqlite` | `frser-sqlite-datasource` |
