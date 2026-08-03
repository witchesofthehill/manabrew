BEGIN IMMEDIATE;

CREATE TEMP TABLE required_staging_publications (
    publication_count INTEGER NOT NULL CHECK (publication_count = 5)
);

INSERT INTO required_staging_publications
SELECT CASE
    WHEN EXISTS (
        SELECT 1 FROM data_migrations WHERE key = 'staging-top-deck-filler-v1'
    ) THEN 5
    ELSE count(*)
END
FROM deckhub_entries
WHERE id IN (
    'preset-entry:ashling_limitless_commander:1',
    'preset-entry:hearthhull_world_shaper_commander:1',
    'preset-entry:kaalia_regression_commander:1',
    'preset-entry:neheb_minotaur_commander:1',
    'preset-entry:ramses_commander:1'
)
AND status = 'published';

WITH RECURSIVE
seed(slug, entry_id, fingerprint, format, plays, relay_plays, completed_games, wins) AS (
    VALUES
        ('ashling', 'preset-entry:ashling_limitless_commander:1', '1a41a6d8005a0dcd27fb82d419096b43bffca752db2e3ea14948fd8e11ecad9e', 'commander', 28, 24, 24, 14),
        ('hearthhull', 'preset-entry:hearthhull_world_shaper_commander:1', '79f19f7d479c5266cc22288fa6ac09253dd4d02b8fe2e008272cdc409aa67f68', 'commander', 21, 15, 15, 8),
        ('kaalia', 'preset-entry:kaalia_regression_commander:1', '28e082897478427c822c1a02edea955c6c911cae32c31361285aa2cb8fe01df3', 'commander', 15, 10, 10, 6),
        ('neheb', 'preset-entry:neheb_minotaur_commander:1', 'f5f4d4cc25db9556dbb4db2c48e702fcd063e17626e774a958573f9eff724e2d', 'commander', 9, 6, 6, 3),
        ('ramses', 'preset-entry:ramses_commander:1', '56426062a153a70a21c408cbab1f39aaa5ff9814f5040b5ead64422c9df6eff0', 'commander', 5, 0, 0, 0)
),
sequence(value) AS (
    SELECT 1
    UNION ALL
    SELECT value + 1 FROM sequence WHERE value < 28
)
INSERT OR IGNORE INTO deck_play_reports (
    id,
    deckhub_entry_id,
    deck_fingerprint,
    format,
    source,
    game_key,
    player_key,
    completed_game,
    won,
    played_at
)
SELECT
    'staging-filler-v1:' || seed.slug || ':' || printf('%03d', sequence.value),
    seed.entry_id,
    seed.fingerprint,
    seed.format,
    CASE WHEN sequence.value <= seed.relay_plays THEN 'relay' ELSE 'offline' END,
    CASE WHEN sequence.value <= seed.relay_plays THEN 'staging-game:' || seed.slug || ':' || printf('%03d', sequence.value) END,
    CASE WHEN sequence.value <= seed.relay_plays THEN 'staging-player:' || seed.slug || ':' || printf('%03d', sequence.value) END,
    CASE WHEN sequence.value <= seed.completed_games THEN 1 ELSE 0 END,
    CASE WHEN sequence.value <= seed.wins THEN 1 ELSE 0 END,
    datetime('now', '-' || ((sequence.value - 1) % 14) || ' days')
FROM seed
JOIN sequence ON sequence.value <= seed.plays
WHERE NOT EXISTS (
    SELECT 1 FROM data_migrations WHERE key = 'staging-top-deck-filler-v1'
);

DELETE FROM top_deck_snapshots
WHERE bucket_id IN ('top-decks-trending', 'top-decks-commander')
AND snapshot_date = date('now')
AND NOT EXISTS (
    SELECT 1 FROM data_migrations WHERE key = 'staging-top-deck-filler-v1'
);

WITH
buckets(bucket_id, format) AS (
    VALUES
        ('top-decks-trending', NULL),
        ('top-decks-commander', 'commander')
),
ranked AS (
    SELECT
        buckets.bucket_id,
        reports.deckhub_entry_id,
        count(*) AS plays,
        sum(reports.completed_game) AS completed_games,
        sum(reports.won) AS wins,
        row_number() OVER (
            PARTITION BY buckets.bucket_id
            ORDER BY count(*) DESC, sum(reports.completed_game) DESC, reports.deckhub_entry_id ASC
        ) AS rank
    FROM buckets
    JOIN deck_play_reports reports
        ON buckets.format IS NULL OR lower(reports.format) = buckets.format
    JOIN deckhub_entries entries
        ON entries.id = reports.deckhub_entry_id AND entries.status = 'published'
    WHERE reports.played_at >= datetime('now', '-30 days')
    GROUP BY buckets.bucket_id, reports.deckhub_entry_id, reports.deck_fingerprint
)
INSERT INTO top_deck_snapshots (
    id,
    bucket_id,
    deckhub_entry_id,
    rank,
    score,
    reason,
    snapshot_date,
    created_at
)
SELECT
    'staging-filler-v1:' || ranked.bucket_id || ':' || ranked.deckhub_entry_id,
    ranked.bucket_id,
    ranked.deckhub_entry_id,
    ranked.rank,
    ranked.plays,
    CASE
        WHEN ranked.plays = 1 THEN 'Played once in the last 30 days'
        ELSE 'Played ' || ranked.plays || ' times in the last 30 days'
    END || CASE
        WHEN ranked.completed_games >= 20 THEN printf(
            ' · %.0f%% win rate across %d completed online matches',
            ranked.wins * 100.0 / ranked.completed_games,
            ranked.completed_games
        )
        ELSE ''
    END,
    date('now'),
    datetime('now')
FROM ranked
WHERE ranked.rank <= 25
AND NOT EXISTS (
    SELECT 1 FROM data_migrations WHERE key = 'staging-top-deck-filler-v1'
);

INSERT OR IGNORE INTO data_migrations (key, completed_at)
VALUES ('staging-top-deck-filler-v1', datetime('now'));

COMMIT;
