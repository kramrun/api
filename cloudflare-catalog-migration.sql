CREATE TABLE IF NOT EXISTS catalog_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  slug TEXT,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  released_at TEXT,
  release_year INTEGER,
  genres_json TEXT NOT NULL DEFAULT '[]',
  cover_url TEXT,
  source_updated_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  synced_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_games_normalized_title ON catalog_games(normalized_title);
CREATE INDEX IF NOT EXISTS idx_catalog_games_release_year ON catalog_games(release_year);
CREATE TABLE IF NOT EXISTS user_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_game_id INTEGER NOT NULL REFERENCES catalog_games(id) ON DELETE RESTRICT,
  completed INTEGER NOT NULL DEFAULT 0,
  personal_rating REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, catalog_game_id)
);
CREATE INDEX IF NOT EXISTS idx_user_games_catalog_game_id ON user_games(catalog_game_id);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_game_id INTEGER NOT NULL REFERENCES catalog_games(id) ON DELETE RESTRICT,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('pending','published','hidden','rejected')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, catalog_game_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_catalog_status ON reviews(catalog_game_id, status);
CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed','skipped')),
  trigger_type TEXT NOT NULL,
  processed_count INTEGER NOT NULL DEFAULT 0,
  added_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
