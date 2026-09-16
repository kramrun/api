ALTER TABLE phone_verifications ADD COLUMN confirmation_code_hash TEXT;
ALTER TABLE phone_verifications ADD COLUMN code_expires_at INTEGER;
ALTER TABLE phone_verifications ADD COLUMN code_attempts INTEGER NOT NULL DEFAULT 0;
