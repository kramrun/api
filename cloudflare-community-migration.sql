CREATE TABLE IF NOT EXISTS community_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  personal_game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  catalog_game_id INTEGER NOT NULL REFERENCES catalog_games(id) ON DELETE RESTRICT,
  review_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden','rejected')),
  published_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, personal_game_id)
);
CREATE INDEX IF NOT EXISTS idx_community_posts_catalog_status ON community_posts(catalog_game_id,status,published_at DESC);
