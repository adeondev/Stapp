CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL,
    username_key  TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    disabled_at   INTEGER
);

CREATE TABLE messages (
    id              TEXT PRIMARY KEY,
    channel         TEXT NOT NULL,
    author_id       TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    author_username TEXT NOT NULL,
    text            TEXT NOT NULL,
    ts              INTEGER NOT NULL
);

CREATE INDEX idx_messages_channel_ts ON messages (channel, ts);
