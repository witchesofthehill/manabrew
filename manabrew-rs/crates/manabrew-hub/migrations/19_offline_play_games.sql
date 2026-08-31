-- One finished offline game, reported by the client that ran it. The ingester
-- expands these into the same `games`, `game_players`, `decks` and `deck_cards`
-- tables the relay path fills, which is where they landed until Play vs AI
-- moved off the hosted nodes and into the browser.
--
-- Unlike `engine_play_stats`, this is NOT anonymous: `username` is an account
-- handle when the player has one and their local display name otherwise. So
-- account erasure has to reach in here, and `Storage::delete_account` scrubs
-- the handle out of `offline_play_seats.username`, `offline_play_games.winner`
-- and `offline_play_games.conceded`.
--
-- `id` is client-generated so a retry cannot double-count a game.
CREATE TABLE offline_play_games (
    id              TEXT PRIMARY KEY,
    reported_at     TEXT NOT NULL,
    started_at      TEXT NOT NULL,
    ended_at        TEXT NOT NULL,
    duration_s      INTEGER NOT NULL,
    format          TEXT,
    engine          TEXT NOT NULL,
    starting_life   INTEGER NOT NULL,
    end_reason      TEXT NOT NULL,
    game_over       INTEGER NOT NULL,
    winner          TEXT,
    -- JSON array of usernames, same as the relay's `conceded`.
    conceded        TEXT NOT NULL,
    client_version  TEXT NOT NULL,
    platform        TEXT NOT NULL,
    seats           INTEGER NOT NULL
);

-- `cards` is the decklist as a JSON array of {name, setCode, count}, inline
-- because the ingester is its only reader and expands it into `deck_cards`.
CREATE TABLE offline_play_seats (
    game_id            TEXT NOT NULL REFERENCES offline_play_games(id) ON DELETE CASCADE,
    seat_index         INTEGER NOT NULL,
    username           TEXT NOT NULL,
    is_bot             INTEGER NOT NULL,
    deck_name          TEXT,
    commander          TEXT,
    published_deck_id  TEXT,
    deck_fingerprint   TEXT,
    sideboard_count    INTEGER NOT NULL,
    cards              TEXT NOT NULL,
    PRIMARY KEY (game_id, seat_index)
);

CREATE INDEX idx_offline_play_games_reported ON offline_play_games(reported_at);
CREATE INDEX idx_offline_play_seats_username ON offline_play_seats(username);
