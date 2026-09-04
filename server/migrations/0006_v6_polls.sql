CREATE TABLE polls (
    id           TEXT PRIMARY KEY,
    message_id   TEXT NOT NULL UNIQUE,
    channel_id   TEXT,
    author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question     TEXT NOT NULL,
    allow_mult   INTEGER NOT NULL DEFAULT 0,
    closed       INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
);
CREATE INDEX idx_polls_message ON polls (message_id);

CREATE TABLE poll_options (
    id           TEXT PRIMARY KEY,
    poll_id      TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    text         TEXT NOT NULL,
    order_idx    INTEGER NOT NULL
);
CREATE INDEX idx_poll_options_poll ON poll_options (poll_id);

CREATE TABLE poll_votes (
    poll_id      TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id    TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (poll_id, option_id, user_id)
);
CREATE INDEX idx_poll_votes_poll ON poll_votes (poll_id);
