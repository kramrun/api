ALTER TABLE catalog_games ADD COLUMN external_rating REAL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_posts_catalog_game
ON community_posts(catalog_game_id);
