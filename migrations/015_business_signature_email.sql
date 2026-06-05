-- Optional reply-signature email (shown in Messages replies); falls back to MAIL_INFO_ADDRESS when empty.
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS signature_email TEXT NOT NULL DEFAULT '';
