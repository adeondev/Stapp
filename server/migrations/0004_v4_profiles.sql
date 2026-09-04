CREATE TABLE user_profiles (
    user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT,
    accent       TEXT NOT NULL DEFAULT 'blue',
    bio          TEXT NOT NULL DEFAULT '',
    avatar_ext   TEXT,
    updated_at   INTEGER NOT NULL DEFAULT 0
);

INSERT INTO user_profiles (user_id, accent, bio, updated_at)
     SELECT id, 'blue', '', 0 FROM users;
