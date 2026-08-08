ALTER TABLE deck_play_reports ADD COLUMN hosted INTEGER NOT NULL DEFAULT 0
    CHECK (hosted IN (0, 1));

DROP INDEX idx_deck_play_reports_ranking;
CREATE INDEX idx_deck_play_reports_ranking
    ON deck_play_reports(played_at, format, deckhub_entry_id, deck_fingerprint,
                         completed_game, won, hosted);
