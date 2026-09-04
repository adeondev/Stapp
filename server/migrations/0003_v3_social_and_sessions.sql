CREATE TABLE server_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE auth_sessions (
    id                    TEXT PRIMARY KEY,
    user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash            TEXT NOT NULL,
    previous_token_hash   TEXT,
    previous_valid_until  INTEGER,
    remember              INTEGER NOT NULL,
    created_at            INTEGER NOT NULL,
    last_used_at          INTEGER NOT NULL,
    expires_at            INTEGER NOT NULL,
    revoked_at            INTEGER
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions (user_id);

CREATE TABLE user_privacy (
    user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    allow_member_dms  INTEGER NOT NULL DEFAULT 1
);

INSERT INTO user_privacy (user_id, allow_member_dms)
     SELECT id, 1 FROM users;

CREATE TABLE friend_requests (
    requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (requester_id, addressee_id),
    CHECK (requester_id <> addressee_id)
);

CREATE TABLE friendships (
    user_a     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_a, user_b),
    CHECK (user_a < user_b)
);

CREATE TABLE user_blocks (
    blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);
