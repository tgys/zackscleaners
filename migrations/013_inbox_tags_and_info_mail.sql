-- Tag form submissions as noreply channel; store emails fetched for info@ address.

ALTER TABLE contact_messages
  ADD COLUMN IF NOT EXISTS inbox_tag TEXT NOT NULL DEFAULT 'noreply';

ALTER TABLE recruitment_applications
  ADD COLUMN IF NOT EXISTS inbox_tag TEXT NOT NULL DEFAULT 'noreply';

CREATE TABLE IF NOT EXISTS info_inbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imap_uid BIGINT,
  imap_message_id TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT info_inbound_messages_message_id_unique UNIQUE (imap_message_id)
);

CREATE INDEX IF NOT EXISTS info_inbound_messages_received_idx
  ON info_inbound_messages (received_at DESC);
