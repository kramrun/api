CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, genre TEXT NOT NULL, year INTEGER NOT NULL, rating REAL NOT NULL, completed INTEGER NOT NULL DEFAULT 0, owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS idempotency_records (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT, status_code INTEGER, created_at INTEGER NOT NULL, UNIQUE(user_id, idempotency_key));
CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON idempotency_records(created_at);
