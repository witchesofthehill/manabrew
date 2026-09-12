#!/usr/bin/env python3
"""Materialise the hub's relay_events feed and sanitized Hub analytics into
SQLite; stdlib only. Idempotent: every relay event is keyed by the SHA-256 of
its line, offline games by the reported_at watermark; --watch N loops."""

import argparse
import datetime
import hashlib
import json
import sqlite3
import sys
import time
from pathlib import Path

RELAY_EVENTS_WATERMARK = "hub:relay_events"
RELAY_EVENTS_PAGE = 5000

SCHEMA = """
CREATE TABLE IF NOT EXISTS ingest_state (
  file TEXT PRIMARY KEY,
  byte_offset INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS games (
  game_id TEXT PRIMARY KEY,
  room_id TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_s REAL,
  format TEXT,
  engine TEXT,
  hosted INTEGER,
  official INTEGER,
  starting_life INTEGER,
  player_count INTEGER,
  end_reason TEXT,
  game_over INTEGER,
  winner TEXT
);
CREATE TABLE IF NOT EXISTS game_players (
  game_id TEXT NOT NULL,
  username TEXT NOT NULL,
  is_bot INTEGER,
  deck_name TEXT,
  commander TEXT,
  published_deck_id TEXT,
  deck_fingerprint TEXT,
  PRIMARY KEY (game_id, username)
);
CREATE TABLE IF NOT EXISTS decks (
  deck_id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT,
  room_id TEXT,
  username TEXT,
  is_bot INTEGER,
  deck_name TEXT,
  commander TEXT,
  sideboard_count INTEGER
);
CREATE TABLE IF NOT EXISTS deck_cards (
  deck_id INTEGER NOT NULL REFERENCES decks(deck_id),
  name TEXT NOT NULL,
  set_code TEXT,
  count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT,
  event TEXT,
  room_id TEXT,
  payload TEXT
);
CREATE TABLE IF NOT EXISTS client_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  username TEXT NOT NULL,
  platform TEXT NOT NULL,
  reconnected INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_client_connections_ts ON client_connections(ts);
CREATE TABLE IF NOT EXISTS plane_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  room_id TEXT,
  username TEXT NOT NULL,
  peer TEXT NOT NULL,
  plane TEXT NOT NULL,
  outcome TEXT NOT NULL,
  phase TEXT NOT NULL,
  connect_ms INTEGER,
  rtt_ms INTEGER,
  relay_rtt_ms INTEGER,
  candidate_pair TEXT
);
CREATE INDEX IF NOT EXISTS idx_plane_attempts_ts ON plane_attempts(ts);
CREATE INDEX IF NOT EXISTS idx_games_started ON games(started_at);
CREATE INDEX IF NOT EXISTS idx_games_ranking ON games(official, format, started_at);
CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(username);
CREATE INDEX IF NOT EXISTS idx_game_players_publication
  ON game_players(published_deck_id, deck_fingerprint)
  WHERE is_bot = 0 AND published_deck_id IS NOT NULL AND deck_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deck_cards_name ON deck_cards(name);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS engine_stats (
  report_id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  source TEXT NOT NULL,
  game_id TEXT,
  engine TEXT NOT NULL,
  client_version TEXT,
  platform TEXT,
  format TEXT,
  seats INTEGER,
  multiplayer INTEGER,
  duration_s INTEGER,
  end_reason TEXT,
  decisions INTEGER,
  turnaround_p50 INTEGER,
  turnaround_p90 INTEGER,
  turnaround_max INTEGER,
  engine_p50 INTEGER,
  engine_p90 INTEGER,
  engine_max INTEGER,
  engine_same_p50 INTEGER,
  engine_same_p90 INTEGER,
  engine_same_max INTEGER,
  engine_cross_p50 INTEGER,
  engine_cross_p90 INTEGER,
  engine_cross_max INTEGER,
  think_hidden INTEGER NOT NULL DEFAULT 0,
  reply_wait_p50 INTEGER,
  reply_wait_p90 INTEGER,
  reply_wait_max INTEGER,
  client_work_p50 INTEGER,
  client_work_p90 INTEGER,
  client_work_max INTEGER
);
CREATE INDEX IF NOT EXISTS idx_engine_stats_ts ON engine_stats(ts);
CREATE INDEX IF NOT EXISTS idx_engine_stats_engine ON engine_stats(engine, ts);
CREATE TABLE IF NOT EXISTS hub_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  synced_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hub_metric_snapshots (
  snapshot_at TEXT NOT NULL,
  metric TEXT NOT NULL,
  dimension TEXT NOT NULL DEFAULT '',
  value REAL NOT NULL,
  PRIMARY KEY (snapshot_at, metric, dimension)
);
CREATE INDEX IF NOT EXISTS idx_hub_metric_snapshots_metric
  ON hub_metric_snapshots(metric, snapshot_at);
CREATE TABLE IF NOT EXISTS hub_daily_metrics (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  dimension TEXT NOT NULL DEFAULT '',
  value REAL NOT NULL,
  PRIMARY KEY (day, metric, dimension)
);
CREATE INDEX IF NOT EXISTS idx_hub_daily_metrics_metric
  ON hub_daily_metrics(metric, day);
CREATE TABLE IF NOT EXISTS hub_collection_cards (
  card_key TEXT PRIMARY KEY,
  collectors INTEGER NOT NULL,
  copies INTEGER NOT NULL,
  refreshed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hub_public_deck_cards (
  card_name TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT '',
  zone TEXT NOT NULL,
  decks INTEGER NOT NULL,
  copies INTEGER NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (card_name, format, zone)
);
"""


def open_db(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript(SCHEMA)
    ensure_column(db, "game_players", "published_deck_id", "TEXT")
    ensure_column(db, "game_players", "deck_fingerprint", "TEXT")
    # Anything predating the `source` column is by definition a relay game.
    # An events.db created before the split still has the old engine_stats.
    for column in (
        "engine_same_p50",
        "engine_same_p90",
        "engine_same_max",
        "engine_cross_p50",
        "engine_cross_p90",
        "engine_cross_max",
    ):
        ensure_column(db, "engine_stats", column, "INTEGER")
    ensure_column(db, "engine_stats", "think_hidden", "INTEGER NOT NULL DEFAULT 0")
    # The turnaround split: server, wire and transfer on one side of the first
    # reply frame, parse, apply and render on the other.
    for column in (
        "reply_wait_p50",
        "reply_wait_p90",
        "reply_wait_max",
        "client_work_p50",
        "client_work_p90",
        "client_work_max",
    ):
        ensure_column(db, "engine_stats", column, "INTEGER")
    ensure_column(db, "games", "source", "TEXT")
    ensure_column(db, "games", "reported_at", "TEXT")
    # Whether the engine host filed the outcome. Relay rows from before the
    # host reported it carry NULL: their outcome was read off the state stream.
    ensure_column(db, "games", "reported", "INTEGER")
    ensure_column(db, "games", "turns", "INTEGER")
    # Seats the host served off the relay, from its transport report; NULL
    # when none did. Compare with player_count for the room's shape.
    ensure_column(db, "games", "direct_seats", "INTEGER")
    db.execute("UPDATE games SET source = 'relay' WHERE source IS NULL")
    ensure_column(db, "events", "event_id", "TEXT")
    db.execute("CREATE INDEX IF NOT EXISTS idx_events_event_id ON events(event_id)")
    backfill_event_ids(db)
    db.commit()
    return db


def event_id(line: str) -> str:
    return hashlib.sha256(line.encode("utf-8")).hexdigest()


def backfill_event_ids(db):
    """Rows ingested from the JSONL files predate the key; hash them once so
    the same lines arriving through the hub are recognised, not duplicated."""
    while True:
        rows = db.execute(
            "SELECT id, payload FROM events WHERE event_id IS NULL LIMIT 10000"
        ).fetchall()
        if not rows:
            return
        db.executemany(
            "UPDATE events SET event_id = ? WHERE id = ?",
            [(event_id(payload), row_id) for row_id, payload in rows],
        )
        db.commit()


def ensure_column(db, table: str, column: str, declaration: str):
    columns = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")


def ingest_game_started(db, ev):
    players = ev.get("players") or []
    db.execute(
        """INSERT INTO games (game_id, room_id, started_at, format, engine, hosted,
                              official, starting_life, player_count, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'relay')
           ON CONFLICT(game_id) DO UPDATE SET
             room_id=excluded.room_id, started_at=excluded.started_at,
             format=excluded.format, engine=excluded.engine,
             hosted=excluded.hosted, official=excluded.official,
             starting_life=excluded.starting_life,
             player_count=excluded.player_count""",
        (
            ev.get("game_id"),
            ev.get("room_id"),
            ev.get("ts"),
            ev.get("format"),
            ev.get("engine"),
            int(bool(ev.get("hosted"))),
            int(bool(ev.get("official"))),
            ev.get("starting_life"),
            len(players),
        ),
    )
    for seat in players:
        db.execute(
            """INSERT OR REPLACE INTO game_players
               (game_id, username, is_bot, deck_name, commander,
                published_deck_id, deck_fingerprint)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                ev.get("game_id"),
                seat.get("username"),
                int(bool(seat.get("is_bot"))),
                seat.get("deck_name"),
                seat.get("commander"),
                seat.get("published_deck_id"),
                seat.get("deck_fingerprint"),
            ),
        )


def ingest_game_ended(db, ev):
    reported = ev.get("reported")
    db.execute(
        """INSERT INTO games (game_id, room_id, ended_at, duration_s, end_reason,
                              game_over, winner, reported, turns, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'relay')
           ON CONFLICT(game_id) DO UPDATE SET
             ended_at=excluded.ended_at, duration_s=excluded.duration_s,
             end_reason=excluded.end_reason, game_over=excluded.game_over,
             winner=excluded.winner, reported=excluded.reported,
             turns=excluded.turns""",
        (
            ev.get("game_id"),
            ev.get("room_id"),
            ev.get("ts"),
            ev.get("duration_s"),
            ev.get("reason"),
            int(bool(ev.get("game_over"))),
            ev.get("winner"),
            None if reported is None else int(bool(reported)),
            ev.get("turns"),
        ),
    )


def ingest_transport_used(db, ev):
    seats = ev.get("seats") or []
    direct = sum(1 for seat in seats if seat.get("transport") == "webrtc")
    db.execute(
        """INSERT INTO games (game_id, room_id, direct_seats, source)
           VALUES (?, ?, ?, 'relay')
           ON CONFLICT(game_id) DO UPDATE SET direct_seats=excluded.direct_seats""",
        (ev.get("game_id"), ev.get("room_id"), direct),
    )


def ingest_plane_quality(db, ev):
    db.execute(
        """INSERT INTO plane_attempts
             (ts, room_id, username, peer, plane, outcome, phase,
              connect_ms, rtt_ms, relay_rtt_ms, candidate_pair)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            ev.get("ts"),
            ev.get("room_id"),
            ev.get("username"),
            ev.get("peer"),
            ev.get("plane"),
            ev.get("outcome"),
            ev.get("phase"),
            ev.get("connect_ms"),
            ev.get("rtt_ms"),
            ev.get("relay_rtt_ms"),
            ev.get("candidate_pair"),
        ),
    )


def ingest_deck_selected(db, ev):
    cur = db.execute(
        """INSERT INTO decks (ts, room_id, username, is_bot, deck_name, commander,
                              sideboard_count)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            ev.get("ts"),
            ev.get("room_id"),
            ev.get("username"),
            int(bool(ev.get("is_bot"))),
            ev.get("deck_name"),
            ev.get("commander"),
            ev.get("sideboard_count"),
        ),
    )
    deck_id = cur.lastrowid
    for card in ev.get("cards") or []:
        db.execute(
            "INSERT INTO deck_cards (deck_id, name, set_code, count) VALUES (?, ?, ?, ?)",
            (deck_id, card.get("name"), card.get("set_code"), card.get("count")),
        )


ENGINE_STATS_COLUMNS = (
    "report_id, ts, source, game_id, engine, client_version, platform, format, "
    "seats, multiplayer, duration_s, end_reason, decisions, turnaround_p50, "
    "turnaround_p90, turnaround_max, engine_p50, engine_p90, engine_max, "
    "engine_same_p50, engine_same_p90, engine_same_max, "
    "engine_cross_p50, engine_cross_p90, engine_cross_max, think_hidden, "
    "reply_wait_p50, reply_wait_p90, reply_wait_max, "
    "client_work_p50, client_work_p90, client_work_max"
)


def ingest_engine_stats(db, ev):
    db.execute(
        f"""INSERT OR IGNORE INTO engine_stats ({ENGINE_STATS_COLUMNS})
           VALUES ({", ".join("?" * 32)})""",
        (
            # A relay from before the report id was forwarded still identifies a
            # report well enough to keep re-ingestion idempotent. The room is
            # absent on a report that outlived its seat's membership, which is
            # most of them, so the timestamp carries the fallback on its own.
            ev.get("report_id") or f"{ev.get('room_id') or ''}:{ev.get('ts')}",
            ev.get("ts"),
            "relay",
            ev.get("game_id"),
            ev.get("engine"),
            ev.get("client_version"),
            ev.get("platform"),
            ev.get("format"),
            ev.get("seats"),
            int(bool(ev.get("multiplayer"))),
            ev.get("duration_s"),
            ev.get("end_reason"),
            ev.get("decisions"),
            ev.get("turnaround_p50"),
            ev.get("turnaround_p90"),
            ev.get("turnaround_max"),
            ev.get("engine_p50"),
            ev.get("engine_p90"),
            ev.get("engine_max"),
            ev.get("engine_same_p50"),
            ev.get("engine_same_p90"),
            ev.get("engine_same_max"),
            ev.get("engine_cross_p50"),
            ev.get("engine_cross_p90"),
            ev.get("engine_cross_max"),
            ev.get("think_hidden") or 0,
            ev.get("reply_wait_p50"),
            ev.get("reply_wait_p90"),
            ev.get("reply_wait_max"),
            ev.get("client_work_p50"),
            ev.get("client_work_p90"),
            ev.get("client_work_max"),
        ),
    )


def ingest_client_connected(db, ev):
    db.execute(
        """INSERT INTO client_connections (ts, username, platform, reconnected)
           VALUES (?, ?, ?, ?)""",
        (
            ev.get("ts"),
            ev.get("username"),
            ev.get("platform") or "unknown",
            int(bool(ev.get("reconnected"))),
        ),
    )


INGESTERS = {
    "client_connected": ingest_client_connected,
    "game_started": ingest_game_started,
    "game_ended": ingest_game_ended,
    "deck_selected": ingest_deck_selected,
    "engine_stats": ingest_engine_stats,
    "transport_used": ingest_transport_used,
    "plane_quality": ingest_plane_quality,
}


def ingest_line(db, line: str, key: str | None = None) -> bool:
    try:
        ev = json.loads(line)
    except json.JSONDecodeError:
        return False
    key = key or event_id(line)
    if db.execute("SELECT 1 FROM events WHERE event_id = ?", (key,)).fetchone():
        return False
    kind = ev.get("event")
    db.execute(
        "INSERT INTO events (ts, event, room_id, payload, event_id) VALUES (?, ?, ?, ?, ?)",
        (ev.get("ts"), kind, ev.get("room_id"), line, key),
    )
    handler = INGESTERS.get(kind)
    if handler:
        handler(db, ev)
    return True


def ingest_relay_events(db, hub) -> int:
    """Pull relay_events past the last hub row id seen. The watermark advances
    per page and a line already present by event_id is skipped, so a restart,
    a rebuilt events.db or a re-imported history all converge."""
    row = db.execute(
        "SELECT byte_offset FROM ingest_state WHERE file = ?", (RELAY_EVENTS_WATERMARK,)
    ).fetchone()
    last_id = row[0] if row else 0
    ingested = 0
    while True:
        rows = hub_rows(
            hub,
            "SELECT id, event_id, payload FROM relay_events WHERE id > ? ORDER BY id LIMIT ?",
            (last_id, RELAY_EVENTS_PAGE),
        )
        if not rows:
            break
        for row_id, key, payload in rows:
            if ingest_line(db, payload, key):
                ingested += 1
            last_id = row_id
        db.execute(
            """INSERT INTO ingest_state (file, byte_offset) VALUES (?, ?)
               ON CONFLICT(file) DO UPDATE SET byte_offset=excluded.byte_offset""",
            (RELAY_EVENTS_WATERMARK, last_id),
        )
        db.commit()
    return ingested


def utc_hour() -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    return now.replace(minute=0, second=0, microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def utc_now() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def sync_offline_games(db, hub) -> int:
    """Expand the hub's offline-play records into the relay's own tables.

    Tagged `source='offline'` so they stay separable from relay games.
    """
    watermark = db.execute(
        "SELECT coalesce(max(reported_at), '') FROM games WHERE source = 'offline'"
    ).fetchone()[0]
    games = hub_rows(
        hub,
        """SELECT id, reported_at, started_at, ended_at, duration_s, format, engine,
                  starting_life, end_reason, game_over, winner, seats
           FROM offline_play_games
           WHERE reported_at > ?
           ORDER BY reported_at""",
        (watermark,),
    )
    if not games:
        return 0
    ids = [row[0] for row in games]
    seats_by_game = {}
    # SQLite caps variables per statement.
    for start in range(0, len(ids), 500):
        chunk = ids[start : start + 500]
        placeholders = ", ".join("?" * len(chunk))
        for row in hub_rows(
            hub,
            f"""SELECT game_id, seat_index, username, is_bot, deck_name, commander,
                       published_deck_id, deck_fingerprint, sideboard_count, cards
                FROM offline_play_seats
                WHERE game_id IN ({placeholders})
                ORDER BY seat_index""",
            tuple(chunk),
        ):
            seats_by_game.setdefault(row[0], []).append(row)

    written = 0
    with db:
        for (
            game_id,
            reported_at,
            started_at,
            ended_at,
            duration_s,
            fmt,
            engine,
            starting_life,
            end_reason,
            game_over,
            winner,
            seat_count,
        ) in games:
            cursor = db.execute(
                """INSERT OR IGNORE INTO games
                     (game_id, room_id, started_at, ended_at, duration_s, format,
                      engine, hosted, official, starting_life, player_count,
                      end_reason, game_over, winner, reported, source, reported_at)
                   VALUES (?, NULL, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, 1, 'offline', ?)""",
                (
                    game_id,
                    started_at,
                    ended_at,
                    duration_s,
                    fmt,
                    engine,
                    starting_life,
                    seat_count,
                    end_reason,
                    game_over,
                    winner,
                    reported_at,
                ),
            )
            # `decks` has an autoincrement key, so a game already on file must
            # not reach the deck inserts below.
            if not cursor.rowcount:
                continue
            written += 1
            for seat in seats_by_game.get(game_id, []):
                (
                    _,
                    _seat_index,
                    username,
                    is_bot,
                    deck_name,
                    commander,
                    published_deck_id,
                    deck_fingerprint,
                    sideboard_count,
                    cards_json,
                ) = seat
                db.execute(
                    """INSERT OR REPLACE INTO game_players
                       (game_id, username, is_bot, deck_name, commander,
                        published_deck_id, deck_fingerprint)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        game_id,
                        username,
                        int(bool(is_bot)),
                        deck_name,
                        commander,
                        published_deck_id,
                        deck_fingerprint,
                    ),
                )
                try:
                    cards = json.loads(cards_json) or []
                except (TypeError, ValueError):
                    cards = []
                if not cards and not deck_name:
                    continue
                # No room offline, so `room_id` carries the game id: it is the
                # only join back to the game the deck was played in.
                deck_cursor = db.execute(
                    """INSERT INTO decks (ts, room_id, username, is_bot, deck_name,
                                          commander, sideboard_count)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        started_at,
                        game_id,
                        username,
                        int(bool(is_bot)),
                        deck_name,
                        commander,
                        sideboard_count,
                    ),
                )
                deck_key = deck_cursor.lastrowid
                db.executemany(
                    "INSERT INTO deck_cards (deck_id, name, set_code, count) VALUES (?, ?, ?, ?)",
                    (
                        (
                            deck_key,
                            card.get("name"),
                            card.get("setCode"),
                            card.get("count"),
                        )
                        for card in cards
                        if isinstance(card, dict) and card.get("name")
                    ),
                )
    return written


def hub_rows(hub, query, params=()):
    try:
        return hub.execute(query, params).fetchall()
    except sqlite3.Error as error:
        print(f"Hub analytics query failed: {error}", file=sys.stderr, flush=True)
        return []


def refresh_hub_analytics(db, hub_path: Path) -> bool:
    if not hub_path.is_file():
        return False
    started = time.monotonic()
    snapshot_at = utc_hour()
    hub = sqlite3.connect(f"file:{hub_path}?mode=ro", uri=True)
    try:
        hub.execute("BEGIN")
        schema_version_row = hub.execute(
            "SELECT version FROM schema_version WHERE id = 1"
        ).fetchone()
        if schema_version_row is None:
            raise RuntimeError("Hub schema version row is missing")
        schema_version = schema_version_row[0]
        snapshots = []
        for table_name in (
            "schema_version",
            "accounts",
            "identities",
            "sessions",
            "login_tokens",
            "oauth_states",
            "auth_codes",
            "decks",
            "deck_versions",
            "deck_cards",
            "deckhub_entries",
            "deckhub_tags",
            "deckhub_entry_tags",
            "deckhub_favorites",
            "top_deck_buckets",
            "top_deck_snapshots",
            "deck_play_reports",
            "engine_play_stats",
            "card_collection",
            "card_collection_versions",
            "data_migrations",
        ):
            snapshots.extend(
                (snapshot_at, "table_rows", table_name, count)
                for (count,) in hub_rows(hub, f"SELECT count(*) FROM {table_name}")
            )

        snapshot_queries = {
            "accounts": "SELECT '', count(*) FROM accounts",
            "accounts_handle_set": "SELECT '', count(*) FROM accounts WHERE handle_set = 1",
            "collection_cards": "SELECT '', count(DISTINCT card_key) FROM card_collection",
            "collection_collectors": "SELECT '', count(DISTINCT account_id) FROM card_collection",
            "collection_copies": "SELECT '', coalesce(sum(quantity), 0) FROM card_collection",
            "collection_size_buckets": "SELECT CASE WHEN cards < 100 THEN '<100' WHEN cards < 500 THEN '100-499' WHEN cards < 1000 THEN '500-999' WHEN cards < 5000 THEN '1k-5k' ELSE '5k+' END, count(*) FROM (SELECT account_id, count(*) AS cards FROM card_collection GROUP BY account_id) GROUP BY 1",
            "active_sessions": "SELECT '', count(*) FROM sessions WHERE datetime(expires_at) > datetime('now')",
            "pending_login_tokens": "SELECT '', count(*) FROM login_tokens WHERE datetime(expires_at) > datetime('now')",
            "pending_oauth_states": "SELECT '', count(*) FROM oauth_states WHERE datetime(expires_at) > datetime('now')",
            "pending_auth_codes": "SELECT '', count(*) FROM auth_codes WHERE datetime(expires_at) > datetime('now')",
            "identities_by_provider": "SELECT provider, count(*) FROM identities GROUP BY provider",
            "decks_by_kind": "SELECT kind, count(*) FROM decks WHERE deleted_at IS NULL GROUP BY kind",
            "decks_by_visibility": "SELECT visibility, count(*) FROM decks WHERE deleted_at IS NULL GROUP BY visibility",
            "decks_by_format": "SELECT coalesce(format, 'unknown'), count(*) FROM decks WHERE deleted_at IS NULL GROUP BY 1",
            "publications_by_status": "SELECT status, count(*) FROM deckhub_entries GROUP BY status",
            "publications_by_format": "SELECT coalesce(v.format, 'unknown'), count(*) FROM deckhub_entries e JOIN deck_versions v ON v.id = e.published_version_id WHERE e.status = 'published' GROUP BY 1",
            "play_reports_by_source": "SELECT source, count(*) FROM deck_play_reports GROUP BY source",
            "ranking_entries": "SELECT b.key, count(s.id) FROM top_deck_buckets b LEFT JOIN top_deck_snapshots s ON s.bucket_id = b.id AND s.snapshot_date = b.latest_snapshot_date GROUP BY b.key",
        }
        for metric, query in snapshot_queries.items():
            snapshots.extend(
                (snapshot_at, metric, dimension or "", value or 0)
                for dimension, value in hub_rows(hub, query)
            )

        daily_queries = {
            "accounts_created": "SELECT date(created_at), '', count(*) FROM accounts GROUP BY 1",
            "identities_created": "SELECT date(created_at), provider, count(*) FROM identities GROUP BY 1, 2",
            "decks_created": "SELECT date(created_at), kind, count(*) FROM decks GROUP BY 1, 2",
            "deck_versions_created": "SELECT date(created_at), coalesce(format, 'unknown'), count(*) FROM deck_versions GROUP BY 1, 2",
            "publications_created": "SELECT date(created_at), status, count(*) FROM deckhub_entries GROUP BY 1, 2",
            "favorites_created": "SELECT date(created_at), '', count(*) FROM deckhub_favorites GROUP BY 1",
            "plays": "SELECT date(played_at), source || ' / ' || CASE hosted WHEN 1 THEN 'hosted' ELSE 'local' END, count(*) FROM deck_play_reports GROUP BY 1, 2",
            "completed_plays": "SELECT date(played_at), source, sum(completed_game) FROM deck_play_reports GROUP BY 1, 2",
            "wins": "SELECT date(played_at), source, sum(won) FROM deck_play_reports GROUP BY 1, 2",
        }
        daily = []
        for metric, query in daily_queries.items():
            daily.extend(
                (day, metric, dimension or "", value or 0)
                for day, dimension, value in hub_rows(hub, query)
                if day is not None
            )

        mirrored_through = db.execute(
            "SELECT coalesce(max(ts), '') FROM engine_stats WHERE source = 'hub'"
        ).fetchone()[0]
        engine_reports = hub_rows(
            hub,
            """SELECT id, reported_at, game_id, engine, client_version, platform, format,
                      seats, multiplayer, duration_s, end_reason, decisions,
                      turnaround_p50, turnaround_p90, turnaround_max,
                      engine_p50, engine_p90, engine_max,
                      engine_same_p50, engine_same_p90, engine_same_max,
                      engine_cross_p50, engine_cross_p90, engine_cross_max,
                      coalesce(think_hidden, 0),
                      reply_wait_p50, reply_wait_p90, reply_wait_max,
                      client_work_p50, client_work_p90, client_work_max
               FROM engine_play_stats
               WHERE reported_at > ?""",
            (mirrored_through,),
        )

        collection_cards = hub_rows(
            hub,
            """SELECT card_key, count(DISTINCT account_id), sum(quantity)
               FROM card_collection
               GROUP BY card_key
               HAVING count(DISTINCT account_id) >= 2"""
        )
        public_deck_cards = hub_rows(
            hub,
            """SELECT c.card_name, coalesce(v.format, 'unknown'), c.zone,
                      count(DISTINCT v.deck_id), sum(c.quantity)
               FROM deckhub_entries e
               JOIN deck_versions v ON v.id = e.published_version_id
               JOIN deck_cards c ON c.deck_version_id = v.id
               WHERE e.status = 'published'
               GROUP BY c.card_name, coalesce(v.format, 'unknown'), c.zone"""
        )
        # Games, not a hub metric, so they bypass the snapshot machinery below.
        offline_written = sync_offline_games(db, hub)
        if offline_written:
            print(f"offline games ingested: {offline_written}", flush=True)
    finally:
        hub.close()

    with db:
        db.execute(
            "DELETE FROM hub_metric_snapshots WHERE snapshot_at = ?", (snapshot_at,)
        )
        db.executemany(
            "INSERT INTO hub_metric_snapshots (snapshot_at, metric, dimension, value) VALUES (?, ?, ?, ?)",
            snapshots,
        )
        db.execute("DELETE FROM hub_daily_metrics")
        db.executemany(
            "INSERT INTO hub_daily_metrics (day, metric, dimension, value) VALUES (?, ?, ?, ?)",
            daily,
        )
        db.executemany(
            f"""INSERT OR IGNORE INTO engine_stats ({ENGINE_STATS_COLUMNS})
                VALUES (?, ?, 'hub', {", ".join("?" * 29)})""",
            engine_reports,
        )
        db.execute("DELETE FROM hub_collection_cards")
        db.executemany(
            "INSERT INTO hub_collection_cards (card_key, collectors, copies, refreshed_at) VALUES (?, ?, ?, ?)",
            ((*row, snapshot_at) for row in collection_cards),
        )
        db.execute("DELETE FROM hub_public_deck_cards")
        db.executemany(
            """INSERT INTO hub_public_deck_cards
               (card_name, format, zone, decks, copies, refreshed_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            ((*row, snapshot_at) for row in public_deck_cards),
        )
        duration_ms = round((time.monotonic() - started) * 1000)
        db.execute(
            """INSERT INTO hub_sync_state (id, synced_at, schema_version, duration_ms)
               VALUES (1, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET synced_at=excluded.synced_at,
                 schema_version=excluded.schema_version,
                 duration_ms=excluded.duration_ms""",
            (utc_now(), schema_version, duration_ms),
        )
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="analytics database to materialise")
    parser.add_argument("--hub-db", required=True, help="Hub database to read from")
    parser.add_argument("--hub-refresh", type=int, default=300)
    parser.add_argument("--watch", type=int, help="loop every N seconds")
    args = parser.parse_args()

    db = open_db(Path(args.db))
    hub_path = Path(args.hub_db)
    next_hub_refresh = 0.0

    while True:
        if hub_path.is_file():
            hub = sqlite3.connect(f"file:{hub_path}?mode=ro", uri=True)
            try:
                count = ingest_relay_events(db, hub)
            finally:
                hub.close()
            if count:
                print(f"ingested {count} events", flush=True)
        if time.monotonic() >= next_hub_refresh:
            try:
                refresh_hub_analytics(db, hub_path)
            except Exception as error:
                print(f"Hub analytics refresh failed: {error}", file=sys.stderr, flush=True)
            next_hub_refresh = time.monotonic() + args.hub_refresh
        if not args.watch:
            return
        time.sleep(args.watch)


if __name__ == "__main__":
    sys.exit(main())
