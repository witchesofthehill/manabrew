# Observability — Prometheus metrics, Loki logs, relay analytics

Production observability for the hosted-play stack (relay + self-hosted nodes),
motivated by launch weekend: every incident (wire skew, engine crashes, room
collisions, a silent 13-day node outage) was diagnosed by grepping container
logs after the fact. This design makes the same signals visible live, keeps the
analytics trail durable, and records enough per-game data to replay games later.

## Goals

1. Live operational dashboard: rooms, players, games, error rates — visible
   without SSH.
2. Alerting on the failure modes we have actually had: node fleet down, relay
   unreachable, engine-error spike, outdated-client rejections.
3. Durable game/deck analytics, queryable with SQL (retention, decks, cards,
   durations, winners), decoupled from container lifecycles — covering **all**
   games, including human-vs-human rooms that never touch a node.
4. Queryable logs from every container without SSH, surviving container churn.
5. Full game-stream capture for future replay tooling and crash forensics.

## Non-goals

- Client-side telemetry (web/desktop RUM) — separate effort, privacy questions.
- Distributed tracing — deferred; cross-service trace value requires
  trace-context propagation through the wire protocol. Revisit with the
  version-handshake protocol work.
- Replay viewer UI — the capture lane persists the data; the viewer is its own
  project.

## Architecture — three lanes

```
┌─────────────┐ scrape :9444/metrics ┌────────────┐
│ manabrew-   │◀─────────────────────│ prometheus │──┐
│ server      │                      └────────────┘  │
└──────┬──────┘                            ▲         ▼
       │ events.jsonl + captures           │   ┌──────────┐
       ▼                                   │   │ grafana  │
┌─────────────┐   ingest (sidecar)   ┌───────────┐  ▲
│ host FS     │──────────────────────▶ events.db │──┘
└─────────────┘                      │ (SQLite)  │  ▲
┌─────────────┐ push HTTPS           └───────────┘  │
│ self-hosted-│───▶ push.manabrew.app ─▶ pushgateway (scraped by prometheus)
│ node fleet  │───▶ loki.manabrew.app ─▶ loki ◀─ alloy (docker logs, on-box)
└─────────────┘                                     │
                                                    └──▶ grafana
```

**Lane 1 — metrics (`metrics` crate + Prometheus).** Both Rust services use the
`metrics` facade. The relay exposes `/metrics` on its existing health listener
(port 9444, already internal-only) and Prometheus scrapes it directly. The node
runs wherever it runs (currently a collaborator's machine, NATed) and pushes
outbound to a `prom/pushgateway` behind Caddy basic-auth at
`push.manabrew.app`. Pushgateway metrics persisting after process death is the
fleet-down signal: `time() - push_time_seconds > 900` catches a silent node.
No OTel collector — fewer moving parts, same instrumentation call sites; the
exporter can be swapped later without touching them.

**Lane 2 — analytics events (relay-emitted JSONL → SQLite).** The **relay** is
the sole event source: it already sees, fully typed, the players, decklists,
commanders, format, and lifecycle of every room — node-hosted and
player-hosted alike. Game traffic itself is routed as opaque JSON, but the
game-over signal sits at a known path inside the state envelope
(`state.gameOver` / `state.winnerId` in the `GameViewDto`), so the replay cache
peeks those three fields right where it already reads the routing fields
(`replay.rs::observe`). Events append to daily JSONL files on the host
filesystem; an ingester sidecar upserts them into SQLite for Grafana/DuckDB.

**Lane 3 — logs (Loki + Alloy).** A Grafana Alloy container scrapes all docker
container logs on the box as-is (no log-format changes) and pushes to Loki.
The remote node host runs a minimal Alloy pushing outbound to
`loki.manabrew.app` behind the same basic-auth. Container logs stay unchanged
and remain available via `docker logs`; Loki is additive.

**Game-stream capture (part of lane 2).** When enabled, the relay tees every
relayed game envelope (states, prompts, responses) into a per-game
zstd-compressed file: first line is the `game_started` event, then one line per
envelope (`{ts, from, envelope}`), last line the `game_ended` event. This is
enough to drive a step-through replay viewer (the envelopes are exactly what
clients render) and to autopsy engine crashes. Captures include player-targeted
prompts, i.e. information no single player sees — admin-only data, same trust
level as the launch archive.

## Relay configuration

All env-gated; unset = feature off, zero behavior change:

| Env                            | Effect                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `MANABREW_EVENTS_DIR`          | append analytics events to `events-YYYY-MM-DD.jsonl` in this dir                    |
| `MANABREW_GAME_CAPTURE_DIR`    | write per-game `YYYY-MM-DD/<game_id>.jsonl.zst` streams                             |
| `MANABREW_GAME_CAPTURE_MAX_GB` | retention cap for the capture dir (default 20; oldest deleted first, checked daily) |

The `/metrics` route is always on (port 9444 is not exposed publicly; Caddy
does not route to it). Event emission never blocks the relay hot path: events
go through a bounded channel to a dedicated writer thread; overflow drops the
event and increments `manabrew_relay_analytics_dropped_total`.

## Metric catalog

All metrics prefixed `manabrew_`. Labels kept low-cardinality (no player
names, no room ids).

Relay (`manabrew-server`) — implemented:

| Metric                          | Type    | Labels                                                            | Source                                                                                                         |
| ------------------------------- | ------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `relay_connections`             | gauge   | `kind` = human \| bot \| service                                  | scrape-time walk of `ServerState::players`; `service` from the auth flag, `bot` = username seated as a bot     |
| `relay_rooms`                   | gauge   | `status` = lobby \| in_game, `hosted` = bool                      | scrape-time walk of `ServerState::rooms`                                                                       |
| `relay_games_started_total`     | counter | `engine`                                                          | `StartGame` success                                                                                            |
| `relay_games_ended_total`       | counter | `reason` (see below)                                              | the two teardown funnels (`reset_room_to_lobby`, `remove_room_and_clear_sessions`) plus abandoned-room removal |
| `relay_client_rejections_total` | counter | `reason` = outdated_wire \| parse_error \| any `ServerError` code | `send_error` helper + parse-error classification                                                               |
| `relay_reconnect_resyncs_total` | counter | —                                                                 | `RequestResync` success                                                                                        |
| `relay_analytics_dropped_total` | counter | —                                                                 | bounded-channel overflow                                                                                       |

Game end reasons: `game_over` (observed in the state stream), `engine_fatal`
(fatal envelope observed), `host_ended`, `reconnect_timeout`, `host_lost`,
`stale_expired`, `abandoned`. An observed game-over/fatal always wins over the
teardown-path fallback.

`outdated_wire` is inferred: legacy deck payloads fail deserialization with the
shared `OUTDATED_CLIENT_MESSAGE` constant (`manabrew-protocol/src/deck_dto.rs`),
which the relay recognizes in the parse error. The wire error code stays
`parse_error` — clients are unaffected. Labeling rejections by client version
needs a `version` field on `Authenticate` (version-handshake follow-up).

Node (`self-hosted-node`) — env-gated push exporter: set
`SELF_HOSTED_NODE_METRICS_PUSH_URL` (plus `_USERNAME`/`_PASSWORD` for the
Caddy basic auth) to e.g.
`https://push.manabrew.app/metrics/job/self-hosted-node/instance/<name>`;
unset = no exporter, all instruments are no-ops. Pushes every 15s:

| Metric                        | Type      | Labels                    | Source                                  |
| ----------------------------- | --------- | ------------------------- | --------------------------------------- |
| `node_rooms_hosted`           | gauge     | `pool` = solo \| pod      | `host_one_room` guard                   |
| `node_games_active`           | gauge     | —                         | engine session lifecycle                |
| `node_game_duration_seconds`  | histogram | `players`, `clean` = bool | `finish_hosted_engine`                  |
| `node_engine_errors_total`    | counter   | `signature` (bucketed)    | `finish_hosted_engine` error/panic path |
| `node_relay_reconnects_total` | counter   | —                         | reconnect supervisor                    |
| `node_build_info`             | gauge     | `version`                 | startup                                 |

Known gap: `node_invalid_answers_total` needs the engine's structured
`GameLogEvent` stream, which the node's relay transport currently discards
(`MpscTransport::new_relay` sets `notify_tx: None`) — runtime-crate follow-up.

## Analytics event schema

One JSON object per line, `event` discriminator, `ts` RFC3339:

- `game_started` — `game_id`, `room_id`, `format`, `engine`, `hosted`,
  `official`, `starting_life`, `players: [{username, is_bot, deck_name, commander}]`
- `game_ended` — `game_id`, `room_id`, `reason`, `duration_s`, `game_over`,
  `winner`, `conceded`, `fatal_message`
- `deck_selected` — `room_id`, `username`, `is_bot`, `deck_name`, `commander`,
  `cards: [{name, set_code, count}]`, `sideboard_count`
- `seat_joined` / `seat_left` — `room_id`, `username` (+ `is_bot`, `observer` on join)

`game_id` is minted by the relay at `StartGame` and links `game_started` ↔
`game_ended` ↔ the capture file name. A room resumed after a relay restart
mints a fresh `game_id`, so its `game_ended` may lack a matching
`game_started`; the ingester treats those as end-only rows.

Privacy: usernames yes (same as the launch archive), IPs never, no card data
in metric labels. Scrub-on-request (EU-hosted, EU users): usernames live only
in `events.db` (`DELETE FROM game_players/decks WHERE username = ?`, null out
`games.winner`), in JSONL lines awaiting their daily roll (grep them out), and
in captures, which age out via the size cap or can be deleted by `game_id`.

## Deployment (part 2 of this rollout)

Added to `compose.production.yml` behind the `observability` compose profile —
a merge deploys nothing until the box opts in with
`COMPOSE_PROFILES=observability` (same pattern as `parity` / `hosted-ai`).
On the production box (3.7 GB RAM, ~2.6 GB free; stack limits total ≈1.3 GB,
realistic RSS well under):

- `prometheus` — 30d retention, scrapes relay + pushgateway, volume.
- `pushgateway` — persistence file + volume, reached internally and via
  `push.manabrew.app` (Caddy basic-auth) from outside.
- `grafana` — behind Caddy at `grafana.manabrew.app`, admin-only, provisioned
  datasources (Prometheus, SQLite, Loki) and dashboards as code.
- `loki` + `alloy` — logs lane; alloy mounts the docker socket read-only.
- `events-ingester` — python sidecar running `scripts/ingest-events.py`.

**Durability rule (launch lesson):** every stateful service gets a named
volume; the events JSONL, captures, and SQLite live on the host filesystem,
not in a container layer. Nothing observability-related may depend on a
container's local disk or a laptop staying awake.

## Dashboards & alerts (part 4 of this rollout)

1. **Live ops** — connections by kind, rooms by status/hosted, games active,
   start/end rates, ends by reason, rejections, resyncs, node push freshness,
   engine errors by signature, duration heatmap, node version table, error-log
   streams from Loki.
2. **Product** (SQLite lane) — games/day, distinct and returning players,
   duration histogram, completion ratio, top decks/commanders/cards,
   bot/human seat mix, format split.

Alert rules (Discord webhook): relay `up == 0` (2m); node fleet silent
(`time() - push_time_seconds > 900`); `node_rooms_hosted` below expected;
engine-error spike (`increase > 1/10min`); `outdated_wire` burst after a
release; zero human connections for 30 min during EU daytime.

Ad-hoc analysis with DuckDB (on the box or a synced copy of `events.db`):

```sql
INSTALL sqlite; LOAD sqlite;
ATTACH '/var/manabrew/events/events.db' AS ev (TYPE sqlite);
-- retention cohort: players by number of distinct days seen
SELECT days_seen, count(*) FROM (
  SELECT p.username, count(DISTINCT date_trunc('day', g.started_at::TIMESTAMP)) AS days_seen
  FROM ev.games g JOIN ev.game_players p USING (game_id)
  WHERE p.is_bot = 0 GROUP BY 1
) GROUP BY 1 ORDER BY 1;
-- commander winrate
SELECT p.commander, count(*) AS games,
       avg(CASE WHEN g.winner = p.username THEN 1.0 ELSE 0.0 END) AS winrate
FROM ev.games g JOIN ev.game_players p USING (game_id)
WHERE g.game_over = 1 AND p.commander IS NOT NULL
GROUP BY 1 HAVING count(*) >= 5 ORDER BY winrate DESC;
```

Captures: `zstd -dc <capture>.jsonl.zst | jq .` streams a full game.

## Rollout

One PR, four parts, each inert until the box's env/secrets are set:

1. **Relay** — `/metrics` + analytics events + game capture + this doc. ✅
2. **Compose stack** — prometheus, pushgateway, grafana, loki, alloy, Caddy
   routes, secrets. ✅ **Before merging**: add `GRAFANA_ADMIN_PASSWORD` to
   `ops/production.secrets` — compose interpolation requires it (`:?`, like
   `MANABREW_SERVER_KEY`), so the deploy fails loudly rather than ever
   shipping a default-password Grafana. To activate: DNS A records for
   `grafana.`/`push.`/`loki.manabrew.app`; `COMPOSE_PROFILES=observability`;
   `PUSHGATEWAY_PASSWORD_HASH` (single-quoted — bcrypt hashes contain `$`)
   in `ops/production.secrets`. Until the auth hash is set, `push.`/`loki.`
   fall back to a locked placeholder hash that matches no password; until
   the profile is on, nothing new runs.
3. **Node metrics** — push-gateway exporter, engine-health instruments. ✅
4. **Ingester + dashboards + alerts.** ✅ `scripts/ingest-events.py` runs as
   the `events-ingester` sidecar (5-min watch loop); dashboards and alert
   rules are provisioned from `ops/observability/grafana/`. Alerts post to
   Discord once `DISCORD_WEBHOOK_URL` is in `ops/production.secrets` (until
   then they fire into a placeholder URL).

## Open questions

- `version` field on `Authenticate` so outdated-client rejections can be
  labeled by app version (protocol change; ties into the version handshake).
- Wiring the engine's structured game-log events through the node's relay
  transport (unlocks invalid-answer metrics and richer node-side signals).
- Whether captures should eventually redact player-targeted prompts so
  replays can be player-visible rather than admin-only.
