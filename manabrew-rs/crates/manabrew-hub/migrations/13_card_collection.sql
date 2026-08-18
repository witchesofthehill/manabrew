CREATE TABLE card_collection (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    card_key TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    PRIMARY KEY (account_id, card_key)
);
