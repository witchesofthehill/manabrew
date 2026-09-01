-- `engine_p50/p90/max` is not per-decision time. The window it measures is
-- answer-received to next-prompt-ready, so in a game against the AI it carries
-- the opponents' whole turns. Seat count dominates it: on 2026-08-31 two-seat
-- games averaged a 77ms median against 997ms for four-seat ones.
--
-- These columns split the same samples by whether a turn passed inside the
-- window, so the same-turn half is the engine resolving what the player just
-- did and the cross-turn half is the opponents playing.
--
-- `think_hidden` counts windows dropped for being measured across a
-- backgrounded tab, where wall clock keeps running and the worker does not.
ALTER TABLE engine_play_stats ADD COLUMN engine_same_p50 INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN engine_same_p90 INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN engine_same_max INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN engine_cross_p50 INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN engine_cross_p90 INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN engine_cross_max INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN think_hidden INTEGER NOT NULL DEFAULT 0;
