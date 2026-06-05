-- Rate-limit only explicit resends (Send code / resend-verification), not the initial signup OTP from POST /register.
ALTER TABLE registration_otps
  ADD COLUMN IF NOT EXISTS is_resend BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN registration_otps.is_resend IS 'TRUE when the code was issued via send-registration-code or resend-verification; inter-resend gap applies only to these rows.';
