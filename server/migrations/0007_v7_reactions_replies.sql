ALTER TABLE messages ADD COLUMN reply_to          TEXT;
ALTER TABLE messages ADD COLUMN edited_at         INTEGER;
ALTER TABLE messages ADD COLUMN mentions          TEXT    NOT NULL DEFAULT '[]';
ALTER TABLE messages ADD COLUMN mentions_everyone INTEGER NOT NULL DEFAULT 0;

ALTER TABLE dm_messages ADD COLUMN reply_to          TEXT;
ALTER TABLE dm_messages ADD COLUMN edited_at         INTEGER;
ALTER TABLE dm_messages ADD COLUMN mentions          TEXT    NOT NULL DEFAULT '[]';
ALTER TABLE dm_messages ADD COLUMN mentions_everyone INTEGER NOT NULL DEFAULT 0;

CREATE TABLE message_reactions (
    message_id TEXT NOT NULL,
    emoji      TEXT NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, emoji, user_id)
);
CREATE INDEX idx_message_reactions_message ON message_reactions (message_id, created_at);
