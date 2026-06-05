-- Email verification gate for new accounts (existing rows backfilled as verified).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

UPDATE users
SET email_verified_at = created_at
WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_token_hash ON email_verification_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_tokens (user_id);

COMMENT ON COLUMN users.email_verified_at IS 'NULL until the user completes the email verification link; legacy users backfilled from created_at.';
COMMENT ON TABLE email_verification_tokens IS 'One-time links emailed at registration; token_hash is SHA-256 hex of the secret token.';
