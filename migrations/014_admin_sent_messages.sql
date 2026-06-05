-- Log admin replies sent from the Messages page (for the Sent tab).

CREATE TABLE IF NOT EXISTS admin_sent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  related_kind TEXT NOT NULL CHECK (related_kind IN ('contact', 'recruitment', 'info')),
  related_id UUID NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  reply_from TEXT NOT NULL CHECK (reply_from IN ('noreply', 'info')),
  body_text TEXT NOT NULL,
  admin_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_sent_messages_created_idx ON admin_sent_messages (created_at DESC);
