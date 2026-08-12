CREATE TABLE card_collection_versions (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
);
