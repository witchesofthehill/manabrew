#!/usr/bin/env python3
"""Ingest relay analytics JSONL into SQLite; stdlib only.
Idempotent via per-file byte offsets; --watch N loops, otherwise one-shot."""

import argparse
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
CREATE INDEX IF NOT EXISTS idx_games_started ON games(started_at);
CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(username);
CREATE INDEX IF NOT EXISTS idx_deck_cards_name ON deck_cards(name);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
"""


def open_db(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript(SCHEMA)
    return db


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
               (game_id, username, is_bot, deck_name, commander)
               VALUES (?, ?, ?, ?, ?)""",
            (
                ev.get("game_id"),
                seat.get("username"),
                int(bool(seat.get("is_bot"))),
                seat.get("deck_name"),
                seat.get("commander"),
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


INGESTERS = {
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", required=True, help="events directory")
    parser.add_argument("--db", help="database path (default: <dir>/events.db)")
    parser.add_argument("--watch", type=int, help="loop every N seconds")
    args = parser.parse_args()

    events_dir = Path(args.dir)
    db_path = Path(args.db) if args.db else events_dir / DB_NAME
    db = open_db(db_path)

    while True:
        count = run_once(db, events_dir)
        if count:
            print(f"ingested {count} events", flush=True)
        if not args.watch:
            return
        time.sleep(args.watch)


if __name__ == "__main__":
    sys.exit(main())
