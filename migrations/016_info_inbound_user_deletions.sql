-- Messages UI: dismissed info@ inbound threads must not respawn after the next maildir/IMAP sync.

CREATE TABLE IF NOT EXISTS info_inbound_user_deletions (
  imap_message_id TEXT PRIMARY KEY,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS info_inbound_user_deletions_deleted_idx
  ON info_inbound_user_deletions (deleted_at DESC);
