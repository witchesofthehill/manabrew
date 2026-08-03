ALTER TABLE deck_versions ADD COLUMN format TEXT;
ALTER TABLE deck_versions ADD COLUMN color_identity TEXT NOT NULL DEFAULT 'C';
ALTER TABLE deck_versions ADD COLUMN card_count INTEGER NOT NULL DEFAULT 0 CHECK (card_count >= 0);
ALTER TABLE deck_versions ADD COLUMN commander_names TEXT NOT NULL DEFAULT '[]';

CREATE INDEX idx_deck_versions_discovery
    ON deck_versions(format, color_identity, card_count);
CREATE INDEX idx_deck_cards_version_name
    ON deck_cards(deck_version_id, card_name COLLATE NOCASE);
CREATE INDEX idx_deck_cards_commanders
    ON deck_cards(deck_version_id, is_commander, card_name COLLATE NOCASE);
