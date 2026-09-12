-- Every analytics event the relay emits, verbatim, one row per line it used to
-- write to its events JSONL. The hub is the durable store; `events.db` is
-- materialised from here by `scripts/ingest-events.py`.
--
-- `event_id` is the SHA-256 of the line, so a redelivered batch, a drained
-- spool file and a re-import of the historical JSONL all collapse to one row.
--
-- Payloads carry relay usernames (seats, winners, deck owners), so account
-- erasure rewrites the handle inside them; see `Storage::delete_account`.
CREATE TABLE relay_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id     TEXT NOT NULL UNIQUE,
    received_at  TEXT NOT NULL,
    ts           TEXT,
    event        TEXT NOT NULL,
    room_id      TEXT,
    payload      TEXT NOT NULL
);

CREATE INDEX idx_relay_events_ts ON relay_events(ts);
CREATE INDEX idx_relay_events_event ON relay_events(event, ts);
