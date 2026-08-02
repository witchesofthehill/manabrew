UPDATE top_deck_buckets
SET label = 'Commander Most Played'
WHERE key = 'commander';

INSERT INTO top_deck_buckets (id, key, label, scope, created_at) VALUES
    ('top-decks-rising', 'rising', 'Rising', 'all', '1970-01-01T00:00:00Z'),
    ('top-decks-win-rate', 'win-rate', 'Highest Win Rate', 'online', '1970-01-01T00:00:00Z'),
    ('top-decks-favorites', 'favorites', 'Most Favorited', 'community', '1970-01-01T00:00:00Z'),
    ('top-decks-new-notable', 'new-notable', 'New & Notable', 'community', '1970-01-01T00:00:00Z');
