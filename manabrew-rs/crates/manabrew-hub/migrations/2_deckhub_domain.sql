ALTER TABLE accounts ADD COLUMN username TEXT;
ALTER TABLE accounts ADD COLUMN display_name TEXT;
ALTER TABLE accounts ADD COLUMN email TEXT;
ALTER TABLE accounts ADD COLUMN avatar_url TEXT;
ALTER TABLE accounts ADD COLUMN updated_at TEXT;

UPDATE accounts
SET username = handle,
    display_name = handle,
    email = (
        SELECT i.email
        FROM identities i
        WHERE i.account_id = accounts.id
          AND i.email_verified = 1
          AND i.email IS NOT NULL
        ORDER BY i.created_at ASC
        LIMIT 1
    ),
    updated_at = created_at;

UPDATE accounts AS current
SET email = NULL
WHERE email IS NOT NULL
  AND EXISTS (
      SELECT 1
      FROM accounts AS earlier
      WHERE earlier.email = current.email COLLATE NOCASE
        AND (
            earlier.created_at < current.created_at
            OR (
                earlier.created_at = current.created_at
                AND earlier.rowid < current.rowid
            )
        )
  );

CREATE UNIQUE INDEX idx_accounts_username
    ON accounts(username COLLATE NOCASE);
CREATE UNIQUE INDEX idx_accounts_email
    ON accounts(email COLLATE NOCASE) WHERE email IS NOT NULL;

CREATE TABLE decks (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    name        TEXT NOT NULL,
    format      TEXT,
    description TEXT,
    visibility  TEXT NOT NULL DEFAULT 'private'
        CHECK (visibility IN ('private', 'unlisted', 'public')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);
CREATE INDEX idx_decks_account_updated
    ON decks(account_id, deleted_at, updated_at DESC);

CREATE TABLE deck_versions (
    id            TEXT PRIMARY KEY,
    deck_id       TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    version_no    INTEGER NOT NULL CHECK (version_no > 0),
    notes         TEXT,
    snapshot_json TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    UNIQUE(deck_id, version_no),
    UNIQUE(deck_id, id)
);
CREATE INDEX idx_deck_versions_deck_created
    ON deck_versions(deck_id, version_no DESC);

CREATE TABLE deck_cards (
    id              TEXT PRIMARY KEY,
    deck_version_id TEXT NOT NULL REFERENCES deck_versions(id) ON DELETE CASCADE,
    card_oracle_id  TEXT,
    card_name       TEXT NOT NULL,
    set_code        TEXT,
    collector_number TEXT,
    foil            INTEGER NOT NULL DEFAULT 0 CHECK (foil IN (0, 1)),
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    zone            TEXT NOT NULL CHECK (
        zone IN (
            'main', 'sideboard', 'commander', 'companion', 'maybeboard',
            'attraction', 'contraption', 'scheme', 'plane', 'token'
        )
    ),
    is_commander    INTEGER NOT NULL DEFAULT 0 CHECK (is_commander IN (0, 1))
);
CREATE INDEX idx_deck_cards_version_zone
    ON deck_cards(deck_version_id, zone);
CREATE INDEX idx_deck_cards_oracle
    ON deck_cards(card_oracle_id) WHERE card_oracle_id IS NOT NULL;

CREATE TABLE deckhub_entries (
    id                       TEXT PRIMARY KEY,
    deck_id                  TEXT NOT NULL,
    published_version_id     TEXT NOT NULL,
    slug                     TEXT NOT NULL UNIQUE COLLATE NOCASE,
    title                    TEXT NOT NULL,
    summary                  TEXT,
    cover_card_id            TEXT,
    cover_card_name          TEXT,
    status                   TEXT NOT NULL DEFAULT 'published'
        CHECK (status IN ('draft', 'published', 'unlisted', 'archived')),
    published_at             TEXT,
    created_at               TEXT NOT NULL,
    updated_at               TEXT NOT NULL,
    legacy_author            TEXT,
    legacy_management_token_hash TEXT,
    publish_ip               TEXT,
    FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE RESTRICT,
    FOREIGN KEY (deck_id, published_version_id)
        REFERENCES deck_versions(deck_id, id) ON DELETE RESTRICT,
    CHECK (
        (status = 'published' AND published_at IS NOT NULL)
        OR status != 'published'
    )
);
CREATE INDEX idx_deckhub_entries_browse
    ON deckhub_entries(status, published_at DESC);
CREATE INDEX idx_deckhub_entries_deck
    ON deckhub_entries(deck_id, created_at DESC);
CREATE INDEX idx_deckhub_entries_version
    ON deckhub_entries(published_version_id);
CREATE INDEX idx_deckhub_entries_ip_day
    ON deckhub_entries(publish_ip, created_at);

CREATE TABLE deckhub_tags (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    slug TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE deckhub_entry_tags (
    deckhub_entry_id TEXT NOT NULL REFERENCES deckhub_entries(id) ON DELETE CASCADE,
    tag_id            TEXT NOT NULL REFERENCES deckhub_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (deckhub_entry_id, tag_id)
);
CREATE INDEX idx_deckhub_entry_tags_tag
    ON deckhub_entry_tags(tag_id, deckhub_entry_id);

CREATE TABLE deckhub_favorites (
    account_id       TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    deckhub_entry_id TEXT NOT NULL REFERENCES deckhub_entries(id) ON DELETE CASCADE,
    created_at       TEXT NOT NULL,
    PRIMARY KEY (account_id, deckhub_entry_id)
);
CREATE INDEX idx_deckhub_favorites_entry
    ON deckhub_favorites(deckhub_entry_id, created_at DESC);

CREATE TABLE top_deck_buckets (
    id         TEXT PRIMARY KEY,
    key        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    label      TEXT NOT NULL,
    scope      TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE top_deck_snapshots (
    id               TEXT PRIMARY KEY,
    bucket_id        TEXT NOT NULL REFERENCES top_deck_buckets(id) ON DELETE CASCADE,
    deckhub_entry_id TEXT NOT NULL REFERENCES deckhub_entries(id) ON DELETE RESTRICT,
    rank             INTEGER NOT NULL CHECK (rank > 0),
    score            REAL,
    reason           TEXT,
    snapshot_date    TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    UNIQUE(bucket_id, snapshot_date, rank),
    UNIQUE(bucket_id, snapshot_date, deckhub_entry_id)
);
CREATE INDEX idx_top_deck_snapshots_latest
    ON top_deck_snapshots(bucket_id, snapshot_date DESC, rank ASC);

INSERT INTO top_deck_buckets (id, key, label, scope, created_at) VALUES
    ('top-decks-trending', 'trending', 'Trending', 'all', '1970-01-01T00:00:00Z'),
    ('top-decks-commander', 'commander', 'Commander', 'commander', '1970-01-01T00:00:00Z'),
    ('top-decks-staff-picks', 'staff-picks', 'Staff Picks', 'editorial', '1970-01-01T00:00:00Z');
