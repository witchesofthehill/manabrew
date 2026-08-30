CREATE TABLE account_assets (
    id         TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    byte_size  INTEGER NOT NULL CHECK (byte_size > 0),
    state      TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    CHECK ((state = 'pending') = (expires_at IS NOT NULL))
);

CREATE INDEX idx_account_assets_account ON account_assets(account_id);
CREATE INDEX idx_account_assets_expiry ON account_assets(expires_at)
    WHERE state = 'pending';

ALTER TABLE accounts ADD COLUMN avatar_asset_id TEXT
    REFERENCES account_assets(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD COLUMN asset_quota_bytes INTEGER;

ALTER TABLE decks ADD COLUMN playmat_asset_id TEXT
    REFERENCES account_assets(id) ON DELETE SET NULL;
