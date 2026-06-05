-- OTP codes for signup verification (email via SMTP/Postfix, SMS via Twilio).
CREATE TABLE IF NOT EXISTS registration_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  sms_destination TEXT,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registration_otps_user_created ON registration_otps (user_id, created_at DESC);

COMMENT ON TABLE registration_otps IS 'Short-lived signup OTP; code_hash is SHA-256 hex of user-bound secret code.';
