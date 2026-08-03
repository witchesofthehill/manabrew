CREATE TABLE IF NOT EXISTS schema_version (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL
);
INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS hub_decks (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    author                TEXT NOT NULL,
    description           TEXT,
    format                TEXT,
    commanders            TEXT NOT NULL DEFAULT '[]',
    colors                TEXT NOT NULL DEFAULT '',
    card_count            INTEGER NOT NULL,
    cover_card_name       TEXT,
    cover_image_url       TEXT,
    deck_json             TEXT NOT NULL,
    management_token_hash TEXT NOT NULL,
    publish_ip            TEXT NOT NULL,
    created_at            TEXT NOT NULL,
    unlisted              INTEGER NOT NULL DEFAULT 0,
    account_id            TEXT
);
CREATE INDEX IF NOT EXISTS idx_hub_decks_browse ON hub_decks(unlisted, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hub_decks_format ON hub_decks(format);
CREATE INDEX IF NOT EXISTS idx_hub_decks_ip_day ON hub_decks(publish_ip, created_at);
CREATE INDEX IF NOT EXISTS idx_hub_decks_account ON hub_decks(account_id);

CREATE TABLE IF NOT EXISTS accounts (
    id         TEXT PRIMARY KEY,
    handle     TEXT NOT NULL UNIQUE COLLATE NOCASE,
    handle_set INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identities (
    id               TEXT PRIMARY KEY,
    account_id       TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    provider         TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email            TEXT,
    email_verified   INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    UNIQUE(provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_identities_account ON identities(account_id);
CREATE INDEX IF NOT EXISTS idx_identities_email
    ON identities(email COLLATE NOCASE) WHERE email_verified = 1;

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);

CREATE TABLE IF NOT EXISTS login_tokens (
    code_hash  TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    request_ip TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_tokens_email
    ON login_tokens(email COLLATE NOCASE, created_at);

CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash      TEXT PRIMARY KEY,
    provider        TEXT NOT NULL,
    mode            TEXT NOT NULL,
    client          TEXT NOT NULL,
    link_account_id TEXT,
    return_to       TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_codes (
    code_hash  TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

UPDATE schema_version SET version = 1 WHERE version < 1;
