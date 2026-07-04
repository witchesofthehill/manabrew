# Observability — OTel metrics + Grafana, DuckDB analytics

Spec for production observability of the hosted-play stack (relay + self-hosted
nodes), motivated by launch weekend: every incident (wire skew, engine crashes,
room collisions, a silent 13-day node outage) was diagnosed by grepping
container logs after the fact. This design makes the same signals visible live
and keeps the analytics trail durable.

## Goals

1. Live operational dashboard: rooms, players, games, error rates — visible
   without SSH.
2. Alerting on the failure modes we have actually had: node fleet down, relay
   unreachable, engine-error spike, wire-format rejections (outdated clients).
3. Durable game/deck analytics, queryable with SQL (retention, decks, cards,
   durations), decoupled from container lifecycles.
4. Zero new bespoke infrastructure where an existing signal already exists —
   the relay and node already use `tracing` everywhere; the launch archive
   already proved out the SQLite schema.

## Non-goals

- Client-side telemetry (web/desktop RUM) — separate effort, privacy questions.
- Distributed tracing across web → relay → node for individual games (nice
  later; metrics + events cover today's questions).
- Replacing the relay's JSON logs (they stay; OTel is additive).

## Architecture — two lanes

```
┌─────────────┐  OTLP/gRPC   ┌────────────────┐   scrape/remote-write
│ manabrew-   │─────────────▶│ otel-collector │──────────────┐
│ server      │              │ (contrib)      │              ▼
└─────────────┘              └────────────────┘        ┌──────────┐
┌─────────────┐  OTLP/gRPC          ▲                  │ Grafana  │
│ self-hosted-│─────────────────────┘                  │ (+ Prom/ │
│ node fleet  │                                        │  Mimir)  │
└─────────────┘                                        └──────────┘
       │ append game events (JSONL)                          ▲
       ▼                                                     │ DuckDB /
┌─────────────┐   ingest (cron)   ┌───────────┐   sqlite_scanner
│ events.jsonl│──────────────────▶│ events.db │─────────────┘
└─────────────┘                   │ (SQLite)  │
                                  └───────────┘
```

**Lane 1 — operational metrics (OTel).** Both Rust services attach a
`tracing-opentelemetry` layer next to the existing `tracing_subscriber::fmt()`
and export OTLP to a collector. Existing `info!`/`warn!` call sites become
counters/histograms via explicit metric instruments (see catalog); log lines
are unchanged.

**Lane 2 — analytics events (SQLite + DuckDB).** The node appends structured
game events to a JSONL file (replacing the launch-weekend approach of scraping
stderr logs); a small ingester upserts them into SQLite on a schedule. Grafana
reads it through DuckDB (`sqlite_scanner`) or the SQLite datasource for
dashboard panels; ad-hoc analysis uses DuckDB directly. The schema is the
launch archive's `launch.db`, promoted to first-class.

## Metric catalog (lane 1)

All metrics prefixed `manabrew_`. Labels kept low-cardinality (no player names,
no room ids).

Relay (`manabrew-server`):

| Metric                          | Type    | Labels                                                                 | Source                                                                                                                    |
| ------------------------------- | ------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `relay_connections`             | gauge   | `kind` = human \| bot \| service                                       | `ServerState::players` (uses `is_service` + bot join flag — fixes the "102 connected, 30 in lobby" ambiguity permanently) |
| `relay_rooms`                   | gauge   | `status` = lobby \| in_game, `hosted` = bool                           | `ServerState::rooms`                                                                                                      |
| `relay_games_started_total`     | counter | `engine`                                                               | `start_game_sync`                                                                                                         |
| `relay_games_ended_total`       | counter | `reason` = game_over \| aborted \| host_lost                           | end/abort/cleanup paths                                                                                                   |
| `relay_client_rejections_total` | counter | `reason` = outdated_wire \| parse_error \| not_controller \| room_full | connection/lobby error paths — `outdated_wire` is the #322 update-nudge, i.e. a live count of outdated desktop clients    |
| `relay_reconnect_resyncs_total` | counter | —                                                                      | `RequestResync` handler                                                                                                   |

Node (`self-hosted-node`):

| Metric                        | Type      | Labels                                                                                         | Source                                                             |
| ----------------------------- | --------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `node_rooms_hosted`           | gauge     | `pool` = solo \| pod                                                                           | room host startup/exit                                             |
| `node_games_active`           | gauge     | —                                                                                              | engine session lifecycle                                           |
| `node_game_duration_seconds`  | histogram | `players`, `clean` = bool                                                                      | session end                                                        |
| `node_engine_errors_total`    | counter   | `signature` (bucketed: index_oob \| unsupported_kind \| comparator \| npe \| trigger \| other) | `finish_hosted_engine` error path                                  |
| `node_invalid_answers_total`  | counter   | `prompt` = priority \| mana_payment                                                            | the discarded-answer path (currently only visible as stderr lines) |
| `node_relay_reconnects_total` | counter   | —                                                                                              | supervisor/reconnect path                                          |

## Event schema (lane 2)

The node emits one JSON line per event to `MANABREW_EVENTS_PATH` (env; unset =
disabled). Events carry `ts`, `event`, `room_id`, and event-specific fields:

- `game_started` — `players` (names), `engine`, `pool`
- `game_ended` — `duration_s`, `reached_game_over`, `error_signature?`
- `deck_selected` — `player`, `deck_name`, `commander?`, `cards`
  (name/set/cmc/types per card), `via` = selection \| spawn_bot
- `seat_joined` / `seat_left` — `player`, `is_bot`

Ingester: `scripts/ingest-events.py` (cron or systemd timer) appends into
SQLite tables `games`, `decks`, `deck_cards`, `events` — same shapes as the
launch archive's `build_db.py`, which serves as the reference implementation
and backfill tool for pre-OTel history.

Retention: JSONL rotated weekly, SQLite kept forever (it is small: launch
weekend ≈ 350 games ≈ single-digit MB).

## Deployment

On the production host, added to `compose.production.yml`:

- `otel-collector` (contrib image, ~renders 100 MB RSS) — OTLP in, Prometheus
  exporter out.
- `prometheus` with `--storage.tsdb.retention.time=30d` (~300 MB) or Grafana
  Alloy/Mimir if preferred.
- `grafana` (~200 MB) behind Caddy at `grafana.manabrew.app`, admin-only.

RAM check: the box has 3.7 GB with ~2.6 GB free today; the stack above fits
with margin. If it gets tight, Grafana Cloud free tier can replace the local
Prometheus+Grafana pair and the collector just remote-writes.

**Durability rule (launch lesson):** every stateful service gets a named
volume, and the events JSONL/SQLite live on the host filesystem, not in a
container layer. Nothing observability-related may depend on a container's
local disk or a laptop staying awake.

Node-side: hosted nodes run wherever they run (currently a dev machine,
eventually the mini or a proper host); they push OTLP outbound to the
collector, so NAT placement does not matter, and `MANABREW_EVENTS_PATH` is a
local file synced/ingested wherever the node lives.

## Dashboards

1. **Live ops** — humans connected, rooms by status, games active, games
   started/ended rate, error counters, rejection counters. Alert rules:
   `node_rooms_hosted < expected` (fleet down — would have caught the 13-day
   dead mini and the Friday 04:11 outage), `relay_connections{kind="human"} == 0`
   for >30 min during EU daytime (traffic cliff), `rate(node_engine_errors_total) >
1/10min` (crash spike), `relay_client_rejections_total{reason="outdated_wire"}`
   burst (a wave of outdated clients after a release).
2. **Product** (DuckDB lane) — daily/hourly games, distinct players, retention
   (players seen on >1 day), duration histogram, top decks/commanders, top
   cards, pool utilization solo vs pod.

## Rollout

1. **PR 1 — relay metrics:** `tracing-opentelemetry` + `opentelemetry-otlp`
   in `manabrew-server`, the six relay metrics, OTLP endpoint from env
   (`OTEL_EXPORTER_OTLP_ENDPOINT`, disabled when unset). No behavior change.
2. **PR 2 — compose stack:** collector + prometheus + grafana + Caddy route +
   volumes + the live-ops dashboard as provisioned JSON.
3. **PR 3 — node metrics + events:** node instruments + the JSONL emitter +
   ingester script; retire the log-scraping collector scripts.
4. **PR 4 — alerts + product dashboard.**

Each phase is independently shippable; phase 1+2 alone would have surfaced
every launch-weekend incident in minutes instead of via log archaeology.

## Open questions

- Prometheus locally vs Grafana Cloud (cost: none vs none at this scale;
  ops burden: volumes/upgrades vs external dependency).
- Should the web client's relay connection report its app version at auth so
  `outdated_wire` rejections can be labeled by version (needs a protocol field —
  ties into the version-handshake idea from #316)?
- Whether the relay should also emit lane-2 events (multiplayer games between
  humans never touch a node, so today they are only visible as relay metrics,
  not analytics rows).
