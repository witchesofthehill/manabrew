-- `turnaround` cut at the first reply frame reaching the client. On
-- 2026-09-10 a per-seat join of relay captures against client reports put the
-- server, hop and player round trip at ~300ms p50 for a hosted 2-seat game
-- while the client reported ~550ms on web and 1.5-2s on two desktop machines,
-- and nothing measured could say whether the rest was the link or the machine.
--
-- `reply_wait` is answer sent to first reply frame arrived: server, wire and
-- the transfer of the reply. `client_work` is first frame to prompt handled:
-- parsing, applying the state, rendering. Null for clients that predate the
-- cut and for engines with no frame boundary.
ALTER TABLE engine_play_stats ADD COLUMN reply_wait_p50 INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN reply_wait_p90 INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN reply_wait_max INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN client_work_p50 INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN client_work_p90 INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN client_work_max INTEGER;
