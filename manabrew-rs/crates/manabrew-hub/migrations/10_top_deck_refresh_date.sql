ALTER TABLE top_deck_buckets ADD COLUMN latest_snapshot_date TEXT;

UPDATE top_deck_buckets
SET latest_snapshot_date = (
    SELECT max(snapshot_date)
    FROM top_deck_snapshots
    WHERE bucket_id = top_deck_buckets.id
);
