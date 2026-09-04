CREATE TABLE attachments (
    id           TEXT PRIMARY KEY,
    message_id   TEXT,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename     TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes   INTEGER NOT NULL,
    s3_key       TEXT NOT NULL,
    created_at   INTEGER NOT NULL
);

CREATE INDEX idx_attachments_message ON attachments (message_id);
