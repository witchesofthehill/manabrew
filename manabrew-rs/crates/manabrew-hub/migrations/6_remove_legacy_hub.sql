DROP TABLE hub_decks;

ALTER TABLE deckhub_entries DROP COLUMN legacy_author;
ALTER TABLE deckhub_entries DROP COLUMN legacy_management_token_hash;
