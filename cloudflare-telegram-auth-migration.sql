CREATE TABLE IF NOT EXISTS telegram_auth_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_token TEXT NOT NULL UNIQUE,
  telegram_user_id TEXT,
  telegram_chat_id TEXT,
  phone TEXT,
  confirmation_code_hash TEXT,
  code_expires_at INTEGER,
  code_attempts INTEGER NOT NULL DEFAULT 0,
  completed_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telegram_auth_requests_token ON telegram_auth_requests(auth_token);
