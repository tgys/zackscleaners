-- Single-row table: email signature fields for admin inbox replies.
CREATE TABLE IF NOT EXISTS business_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  CONSTRAINT business_settings_single_row CHECK (id = 1),
  signature_display_name TEXT NOT NULL DEFAULT '',
  signature_phone TEXT NOT NULL DEFAULT '',
  signature_address TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO business_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
