# Observability

Inventory of every Grafana panel and queryable data source in the stack. Config lives under `ops/observability/`; metric names are defined in code (`manabrew-server/src/metrics.rs`, `self-hosted-node/src/metrics.rs`) and the analytics schema in `scripts/ingest-events.py`. Keep this file in sync when adding a panel, metric, event, or column.

## Dashboards

Provisioned from `ops/observability/grafana/dashboards/` via `provisioning/dashboards/provider.yml`.

### Live Ops (`live-ops.json`)

Datasources: Prometheus (`prometheus`), Loki (`loki`).

| Panel                                     | Type       | Query                                                                                                                                |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Humans connected                          | stat       | `sum(manabrew_relay_connections{kind="human"})`                                                                                      |
| Games in progress                         | stat       | `sum(manabrew_relay_rooms{status="in_game"})`                                                                                        |
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
| Warnings & errors (relay + node)          | logs       | Loki: `{service=~"manabrew-server\|self-hosted-node"} \|~ "WARN\|ERROR\|panicked"`                                                   |

### Product (`product.json`)

Datasource: SQLite (`events-sqlite`, `frser-sqlite-datasource`) over the analytics DB built by `scripts/ingest-events.py`. Player names are de-tagged in SQL with `substr(username,1,instr(username||'@','@')-1)` — usernames carry a permanent `@NNNN` tag on the relay.

| Panel                   | Type       | Queries against                                                   |
| ----------------------- | ---------- | ----------------------------------------------------------------- |
| Games                   | stat       | `games`                                                           |
| Distinct players        | stat       | `game_players` (humans only, de-tagged)                           |
| Median game (min)       | stat       | `games.duration_s`                                                |
| p90 game (min)          | stat       | `games.duration_s`                                                |
| Completion rate         | stat       | `games.game_over` / `ended_at`                                    |
| Games started per hour  | timeseries | `games.started_at`, bucketed hourly                               |
| Active players per hour | timeseries | `games` ⋈ `game_players`, distinct de-tagged humans               |
| Game length             | barchart   | `games.duration_s` bucketed (`<3` … `30+` min)                    |
| Top players by games    | barchart   | `game_players` (humans, de-tagged, top 12)                        |
| Game ends by reason     | barchart   | `games.end_reason`                                                |
| Format split            | barchart   | `games.format`                                                    |
| Games by human count    | barchart   | `games` ⋈ `game_players` (bots only / solo vs AI / 2 humans / 3+) |
| Top commanders          | table      | `decks.commander` (humans, top 20)                                |
| Top decks by games      | table      | `game_players.deck_name` (humans, top 20)                         |
| Top cards               | table      | `deck_cards` (copies + distinct decks, top 25)                    |
| Player growth           | timeseries | first-seen day per de-tagged player, cumulative                   |

## Queryable sources

### Prometheus — relay metrics

Defined in `manabrew-rs/crates/manabrew-server/src/metrics.rs`, served on the health port at `/metrics`, scraped per `ops/observability/prometheus/prometheus.yml` (job `relay`).

| Metric                                   | Kind    | Labels                          |
| ---------------------------------------- | ------- | ------------------------------- |
| `manabrew_relay_connections`             | gauge   | `kind`                          |
| `manabrew_relay_rooms`                   | gauge   | `status`, `hosted`              |
| `manabrew_relay_games_started_total`     | counter | `engine`                        |
| `manabrew_relay_games_ended_total`       | counter | `reason`                        |
| `manabrew_relay_client_rejections_total` | counter | `reason` (e.g. `outdated_wire`) |
| `manabrew_relay_reconnect_resyncs_total` | counter | —                               |
| `manabrew_relay_analytics_dropped_total` | counter | —                               |

### Prometheus — self-hosted-node metrics

Defined in `manabrew-rs/crates/self-hosted-node/src/metrics.rs`; pushed to the push gateway (`SELF_HOSTED_NODE_METRICS_PUSH_URL` / `_USERNAME` / `_PASSWORD`), which adds `push_time_seconds{job="self-hosted-node"}` used for staleness checks.

| Metric                                 | Kind    | Labels                            |
| -------------------------------------- | ------- | --------------------------------- |
| `manabrew_node_rooms_hosted`           | gauge   | `pool`                            |
| `manabrew_node_games_active`           | gauge   | —                                 |
| `manabrew_node_game_duration_seconds`  | summary | `clean`, `players` (+ `quantile`) |
| `manabrew_node_engine_errors_total`    | counter | `signature`                       |
| `manabrew_node_relay_reconnects_total` | counter | —                                 |
| `manabrew_node_build_info`             | gauge   | `version`                         |

### SQLite analytics DB

`scripts/ingest-events.py` tails the relay's analytics JSONL (`MANABREW_EVENTS_DIR`) into SQLite; Grafana reads it via the `events-sqlite` datasource.

| Table          | Columns                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `games`        | `game_id`, `room_id`, `started_at`, `ended_at`, `duration_s`, `format`, `engine`, `hosted`, `official`, `starting_life`, `player_count`, `end_reason`, `game_over`, `winner` |
| `game_players` | `game_id`, `username`, `is_bot`, `deck_name`, `commander`                                                                                                                    |
| `decks`        | `deck_id`, `ts`, `room_id`, `username`, `is_bot`, `deck_name`, `commander`, `sideboard_count`                                                                                |
| `deck_cards`   | `deck_id`, `name`, `set_code`, `count`                                                                                                                                       |
| `events`       | `id`, `ts`, `event`, `room_id`, `payload` (raw JSON)                                                                                                                         |
| `ingest_state` | `file`, `byte_offset`                                                                                                                                                        |

Source events (`manabrew-server/src/analytics/event.rs`, snake_case `event` tag): `game_started`, `game_ended`, `deck_selected`, `seat_joined`, `seat_left`.

Known gap: `game_players.commander` and `decks.commander` hold a single name, so the second partner commander never reaches "Top commanders".

### Loki

Service logs shipped by Alloy (`ops/observability/alloy/config.alloy`), labelled `service` = `manabrew-server` | `self-hosted-node`.

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
