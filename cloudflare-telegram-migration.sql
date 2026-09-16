ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN phone_verified_at INTEGER;
ALTER TABLE users ADD COLUMN telegram_id TEXT;
ALTER TABLE users ADD COLUMN telegram_chat_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE TABLE IF NOT EXISTS phone_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  verification_token TEXT NOT NULL UNIQUE,
  telegram_user_id TEXT,
  telegram_chat_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_phone_verifications_token ON phone_verifications(verification_token);
CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL
);
