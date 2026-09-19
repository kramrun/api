-- One user can publish a verified catalog game only once, even if they created
-- several personal records with different genres.
DELETE FROM community_posts
WHERE id NOT IN (
  SELECT MIN(id) FROM community_posts GROUP BY user_id, catalog_game_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_posts_user_catalog
ON community_posts(user_id, catalog_game_id);
