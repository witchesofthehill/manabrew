-- A game the engine crashed out of, reported by the client with the decks in
-- play so the crash can be reproduced. `end_reason` is `engine_error` for
-- these rows; the column holds the exception and the top of its stack.
ALTER TABLE offline_play_games ADD COLUMN engine_error TEXT;
