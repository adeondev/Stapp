ALTER TABLE attachments ADD COLUMN status          TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE attachments ADD COLUMN checksum_sha256 TEXT;
ALTER TABLE attachments ADD COLUMN backend         TEXT NOT NULL DEFAULT 's3';
ALTER TABLE attachments ADD COLUMN expires_at      INTEGER;
ALTER TABLE attachments ADD COLUMN description     TEXT;
ALTER TABLE attachments ADD COLUMN duration_ms     INTEGER;
ALTER TABLE attachments ADD COLUMN waveform        TEXT;
ALTER TABLE attachments ADD COLUMN width           INTEGER;
ALTER TABLE attachments ADD COLUMN height          INTEGER;
ALTER TABLE attachments ADD COLUMN scope_kind      TEXT;
ALTER TABLE attachments ADD COLUMN scope_id        TEXT;
CREATE INDEX idx_attachments_orphans ON attachments (status, message_id, expires_at);

ALTER TABLE messages ADD COLUMN client_nonce TEXT;
ALTER TABLE dm_messages ADD COLUMN client_nonce TEXT;
CREATE UNIQUE INDEX idx_messages_nonce
  ON messages (author_id, channel, client_nonce) WHERE client_nonce IS NOT NULL;
CREATE UNIQUE INDEX idx_dm_messages_nonce
  ON dm_messages (author_id, conversation_id, client_nonce) WHERE client_nonce IS NOT NULL;

ALTER TABLE dm_reads ADD COLUMN last_message_id TEXT;
CREATE TABLE channel_reads (
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id      TEXT NOT NULL,
    last_message_id TEXT,
    last_read_ts    INTEGER NOT NULL,
    PRIMARY KEY (user_id, channel_id)
);
CREATE TABLE attachment_tickets (
    ticket        TEXT PRIMARY KEY,
    attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at    INTEGER NOT NULL
);
CREATE INDEX idx_attachment_tickets_expiry ON attachment_tickets (expires_at);
