CREATE TABLE deck_play_reports (
    id                TEXT PRIMARY KEY,
    deckhub_entry_id  TEXT NOT NULL REFERENCES deckhub_entries(id) ON DELETE CASCADE,
    deck_fingerprint  TEXT NOT NULL,
    format            TEXT,
    played_at         TEXT NOT NULL
);

CREATE INDEX idx_deck_play_reports_ranking
    ON deck_play_reports(played_at, format, deckhub_entry_id, deck_fingerprint);
