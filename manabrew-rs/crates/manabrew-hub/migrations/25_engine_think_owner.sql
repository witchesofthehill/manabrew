-- `engine_*` is answer-landed to next-prompt-ready, and on a pod that window
-- holds bot prompts as well as the rules engine resolving what the table did.
-- A long wait belongs to one side or the other, and the whole-window figure
-- cannot say which. The engine now tags each window with the time its bot
-- prompts took; `engine_bot_*` is that part, `engine_rules_*` is the rest.
-- Null for clients and engines that predate the tag.
ALTER TABLE engine_play_stats ADD COLUMN engine_bot_p50 INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN engine_bot_p90 INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN engine_bot_max INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN engine_rules_p50 INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN engine_rules_p90 INTEGER;
ALTER TABLE engine_play_stats ADD COLUMN engine_rules_max INTEGER;
