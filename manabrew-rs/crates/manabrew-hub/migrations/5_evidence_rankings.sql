DELETE FROM top_deck_buckets WHERE key = 'official-presets';

DELETE FROM top_deck_snapshots
WHERE reason IS NULL OR trim(reason) = '';

UPDATE top_deck_buckets SET label = 'Most Played' WHERE key = 'trending';
UPDATE top_deck_buckets SET label = 'Popular Commander' WHERE key = 'commander';
