-- Which game a set of timings came from. Every report that reached the hub
-- before this landed is an orphan: the percentiles are there, but nothing says
-- what format was played, how the game ended or who won, because the only
-- route to that is `offline_play_games`, keyed by the id the client mints at
-- launch.
--
-- Nullable, because the id is what the client knew at game over and a report
-- is worth keeping without it.
ALTER TABLE engine_play_stats ADD COLUMN game_id TEXT;

CREATE INDEX idx_engine_play_stats_game ON engine_play_stats(game_id)
  WHERE game_id IS NOT NULL;
