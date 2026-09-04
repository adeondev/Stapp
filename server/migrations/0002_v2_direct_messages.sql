CREATE TABLE dm_messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    author_id       TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    author_username TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'text',
    text            TEXT NOT NULL,
    ts              INTEGER NOT NULL
);

CREATE INDEX idx_dm_messages_conversation_ts ON dm_messages (conversation_id, ts);

CREATE TABLE dm_reads (
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL,
    last_read_ts    INTEGER NOT NULL,
    PRIMARY KEY (user_id, conversation_id)
);
