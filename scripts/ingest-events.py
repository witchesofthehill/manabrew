#!/usr/bin/env python3
"""Ingest relay events and sanitized Hub analytics into SQLite; stdlib only.
Idempotent via per-file offsets and snapshot timestamps; --watch N loops."""

import argparse
import datetime
import json
import sqlite3
import sys
import time
from pathlib import Path

DB_NAME = "events.db"
FILE_GLOB = "events-*.jsonl"

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
CREATE INDEX IF NOT EXISTS idx_games_started ON games(started_at);
CREATE INDEX IF NOT EXISTS idx_games_ranking ON games(official, format, started_at);
CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(username);
CREATE INDEX IF NOT EXISTS idx_game_players_publication
  ON game_players(published_deck_id, deck_fingerprint)
  WHERE is_bot = 0 AND published_deck_id IS NOT NULL AND deck_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deck_cards_name ON deck_cards(name);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
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
    return db


def ensure_column(db, table: str, column: str, declaration: str):
    columns = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")


def ingest_game_started(db, ev):
    players = ev.get("players") or []
    db.execute(
        """INSERT INTO games (game_id, room_id, started_at, format, engine, hosted,
                              official, starting_life, player_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    db.execute(
        """INSERT INTO games (game_id, room_id, ended_at, duration_s, end_reason,
                              game_over, winner)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(game_id) DO UPDATE SET
             ended_at=excluded.ended_at, duration_s=excluded.duration_s,
             end_reason=excluded.end_reason, game_over=excluded.game_over,
             winner=excluded.winner""",
        (
            ev.get("game_id"),
            ev.get("room_id"),
            ev.get("ts"),
            ev.get("duration_s"),
            ev.get("reason"),
            int(bool(ev.get("game_over"))),
            ev.get("winner"),
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
}


def ingest_line(db, line: str):
    try:
        ev = json.loads(line)
    except json.JSONDecodeError:
        return
    kind = ev.get("event")
    db.execute(
        "INSERT INTO events (ts, event, room_id, payload) VALUES (?, ?, ?, ?)",
        (ev.get("ts"), kind, ev.get("room_id"), line),
    )
    handler = INGESTERS.get(kind)
    if handler:
        handler(db, ev)


def ingest_file(db, path: Path) -> int:
    row = db.execute(
        "SELECT byte_offset FROM ingest_state WHERE file = ?", (path.name,)
    ).fetchone()
    offset = row[0] if row else 0
    size = path.stat().st_size
    if size <= offset:
        return 0
    ingested = 0
    with path.open("rb") as fh:
        fh.seek(offset)
        for raw in fh:
            if not raw.endswith(b"\n"):
                break
            ingest_line(db, raw.decode("utf-8", errors="replace").rstrip("\n"))
            offset += len(raw)
            ingested += 1
    db.execute(
        """INSERT INTO ingest_state (file, byte_offset) VALUES (?, ?)
           ON CONFLICT(file) DO UPDATE SET byte_offset=excluded.byte_offset""",
        (path.name, offset),
    )
    return ingested


def run_once(db, events_dir: Path) -> int:
    total = 0
    for path in sorted(events_dir.glob(FILE_GLOB)):
        total += ingest_file(db, path)
    db.commit()
    return total


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


def hub_rows(hub, query, params=()):
    return hub.execute(query, params).fetchall()


def refresh_hub_analytics(db, hub_path: Path) -> bool:
    if not hub_path.is_file():
        return False
    started = time.monotonic()
    snapshot_at = utc_hour()
    hub = sqlite3.connect(f"file:{hub_path}?mode=ro", uri=True)
    try:
        hub.execute("BEGIN")
        schema_version = hub.execute(
            "SELECT version FROM schema_version WHERE id = 1"
        ).fetchone()[0]
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
            "card_collection",
            "card_collection_versions",
            "data_migrations",
        ):
            count = hub.execute(f"SELECT count(*) FROM {table_name}").fetchone()[0]
            snapshots.append((snapshot_at, "table_rows", table_name, count))

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

        collection_cards = hub_rows(
            hub,
            """SELECT card_key, count(DISTINCT account_id), sum(quantity)
               FROM card_collection
               GROUP BY card_key
               HAVING count(DISTINCT account_id) >= 2"""
        )
        public_deck_cards = hub_rows(
            hub,
            """SELECT c.card_name, coalesce(v.format, ''), c.zone,
                      count(DISTINCT v.deck_id), sum(c.quantity)
               FROM deckhub_entries e
               JOIN deck_versions v ON v.id = e.published_version_id
               JOIN deck_cards c ON c.deck_version_id = v.id
               WHERE e.status = 'published'
               GROUP BY c.card_name, coalesce(v.format, ''), c.zone"""
        )
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
    parser.add_argument("--dir", required=True, help="events directory")
    parser.add_argument("--db", help="database path (default: <dir>/events.db)")
    parser.add_argument("--hub-db", help="Hub database to export sanitized analytics from")
    parser.add_argument("--hub-refresh", type=int, default=300)
    parser.add_argument("--watch", type=int, help="loop every N seconds")
    args = parser.parse_args()

    events_dir = Path(args.dir)
    db_path = Path(args.db) if args.db else events_dir / DB_NAME
    db = open_db(db_path)
    next_hub_refresh = 0.0

    while True:
        count = run_once(db, events_dir)
        if count:
            print(f"ingested {count} events", flush=True)
        if args.hub_db and time.monotonic() >= next_hub_refresh:
            try:
                refresh_hub_analytics(db, Path(args.hub_db))
            except sqlite3.Error as error:
                print(f"Hub analytics refresh failed: {error}", file=sys.stderr, flush=True)
            next_hub_refresh = time.monotonic() + args.hub_refresh
        if not args.watch:
            return
        time.sleep(args.watch)


if __name__ == "__main__":
    sys.exit(main())
