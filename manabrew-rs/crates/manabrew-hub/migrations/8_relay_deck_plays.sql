CREATE TABLE data_migrations (
    key          TEXT PRIMARY KEY,
    completed_at TEXT NOT NULL
);

ALTER TABLE deck_play_reports ADD COLUMN source TEXT NOT NULL DEFAULT 'offline'
    CHECK (source IN ('offline', 'relay'));
ALTER TABLE deck_play_reports ADD COLUMN game_key TEXT;
ALTER TABLE deck_play_reports ADD COLUMN player_key TEXT;
ALTER TABLE deck_play_reports ADD COLUMN completed_game INTEGER NOT NULL DEFAULT 0
    CHECK (completed_game IN (0, 1));
ALTER TABLE deck_play_reports ADD COLUMN won INTEGER NOT NULL DEFAULT 0
    CHECK (won IN (0, 1));

DROP INDEX idx_deck_play_reports_ranking;
CREATE INDEX idx_deck_play_reports_ranking
    ON deck_play_reports(played_at, format, deckhub_entry_id, deck_fingerprint,
                         completed_game, won);
CREATE INDEX idx_deck_play_reports_game
    ON deck_play_reports(game_key) WHERE game_key IS NOT NULL;
CREATE UNIQUE INDEX idx_deck_play_reports_relay_player
    ON deck_play_reports(game_key, player_key) WHERE source = 'relay';
