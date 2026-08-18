CREATE TABLE decks_new (
    id                   TEXT PRIMARY KEY,
    account_id           TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
    kind                 TEXT NOT NULL DEFAULT 'user'
        CHECK (kind IN ('user', 'preset')),
    preset_key           TEXT,
    derived_from_deck_id TEXT REFERENCES decks(id) ON DELETE SET NULL,
    name                 TEXT NOT NULL,
    format               TEXT,
    description          TEXT,
    visibility           TEXT NOT NULL DEFAULT 'private'
        CHECK (visibility IN ('private', 'unlisted', 'public')),
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    deleted_at           TEXT,
    engines              TEXT,
    CHECK (
        (kind = 'user' AND preset_key IS NULL)
        OR (kind = 'preset' AND account_id IS NULL AND preset_key IS NOT NULL)
    ),
    CHECK (kind = 'user' OR derived_from_deck_id IS NULL)
);

INSERT INTO decks_new (
    id, account_id, kind, preset_key, derived_from_deck_id, name, format,
    description, visibility, created_at, updated_at, deleted_at, engines
)
SELECT
    id, account_id, kind, preset_key, derived_from_deck_id, name, format,
    description, visibility, created_at, updated_at, deleted_at, engines
FROM decks;

DROP TABLE decks;
ALTER TABLE decks_new RENAME TO decks;

CREATE INDEX idx_decks_account_updated
    ON decks(account_id, deleted_at, updated_at DESC);
CREATE UNIQUE INDEX idx_decks_preset_key
    ON decks(preset_key) WHERE kind = 'preset';
CREATE UNIQUE INDEX idx_decks_account_preset_fork
    ON decks(account_id, derived_from_deck_id)
    WHERE derived_from_deck_id IS NOT NULL AND deleted_at IS NULL;
