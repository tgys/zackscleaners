-- Up: portable user table; passwords stored as one-way digests only (never plaintext).
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users (email);

COMMENT ON TABLE users IS 'Application accounts; password_hash is a password digest only.';
COMMENT ON COLUMN users.password_hash IS 'Password digest (never plaintext).';
