use rusqlite::Connection;

use super::*;
use crate::protocol::Message;
use crate::test_support::TestDir;

fn account(db: &Db, username: &str) -> Account {
    db.create_account(
        username.into(),
        username.to_ascii_lowercase(),
        "$argon2id$test".into(),
    )
    .unwrap()
}

fn message(author: &Account, id: &str, ts: i64) -> Message {
    Message {
        id: id.into(),
        channel: "geral".into(),
        author_id: author.id.clone(),
        author_username: author.username.clone(),
        text: id.into(),
        ts,
    }
}

#[test]
fn history_returns_latest_messages_in_chronological_order() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).unwrap();
    let author = account(&db, "Daniel");

    db.insert(&message(&author, "old", 100)).unwrap();
    db.insert(&message(&author, "tie-first", 200)).unwrap();
    db.insert(&message(&author, "tie-second", 200)).unwrap();

    let history = db.history("geral", 2).unwrap();
    let ids: Vec<_> = history.iter().map(|message| message.id.as_str()).collect();
    assert_eq!(ids, ["tie-first", "tie-second"]);
    assert_eq!(history[0].author_id, author.id);
}

#[test]
fn refuses_the_unversioned_nickname_schema() {
    let dir = TestDir::new();
    let path = dir.database();
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE messages (id TEXT PRIMARY KEY, nick TEXT NOT NULL);")
        .unwrap();
    drop(conn);

    let error = Db::open(&path).err().unwrap().to_string();
    assert!(error.contains("esquema antigo"));
    assert!(error.contains("stapp.db"));
}

#[test]
fn refuses_a_schema_from_the_future() {
    let dir = TestDir::new();
    let path = dir.database();
    let conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "user_version", super::schema::SCHEMA_VERSION + 1)
        .unwrap();
    drop(conn);

    let error = Db::open(&path).err().unwrap().to_string();
    assert!(error.contains("conhece ate"));
}

#[test]
fn migrates_v2_without_losing_accounts_channel_messages_or_dms() {
    let dir = TestDir::new();
    let path = dir.database();
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(
        "CREATE TABLE users (
            id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, disabled_at INTEGER
         );
         CREATE TABLE messages (
            id TEXT PRIMARY KEY, channel TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id),
            author_username TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL
         );
         CREATE INDEX idx_messages_channel_ts ON messages (channel, ts);
         CREATE TABLE dm_messages (
            id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
            author_id TEXT NOT NULL REFERENCES users(id), author_username TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'text', text TEXT NOT NULL, ts INTEGER NOT NULL
         );
         CREATE INDEX idx_dm_messages_conversation_ts ON dm_messages (conversation_id, ts);
         CREATE TABLE dm_reads (
            user_id TEXT NOT NULL REFERENCES users(id), conversation_id TEXT NOT NULL,
            last_read_ts INTEGER NOT NULL, PRIMARY KEY (user_id, conversation_id)
         );
         INSERT INTO users VALUES ('u1', 'Daniel', 'daniel', 'hash1', 1, NULL);
         INSERT INTO users VALUES ('u2', 'Alice', 'alice', 'hash2', 2, NULL);
         INSERT INTO messages VALUES ('m1', 'geral', 'u1', 'Daniel', 'mensagem antiga', 10);
         INSERT INTO dm_messages VALUES ('d1', 'u1:u2', 'u2', 'Alice', 'text', 'dm antiga', 11);
         PRAGMA user_version = 2;",
    )
    .unwrap();
    drop(conn);

    let db = Db::open(&path).unwrap();
    assert_eq!(db.account_by_id("u1").unwrap().unwrap().username, "Daniel");
    assert_eq!(db.history("geral", 10).unwrap()[0].text, "mensagem antiga");
    assert_eq!(db.direct_history("u1:u2", 10).unwrap()[0].text, "dm antiga");
    assert!(db.allow_member_dms("u1").unwrap());
    let server_id = db.server_id().unwrap();
    drop(db);
    assert_eq!(Db::open(&path).unwrap().server_id().unwrap(), server_id);
}

#[test]
fn username_key_is_unique_and_accounts_can_be_disabled() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).unwrap();
    account(&db, "Daniel");
    let duplicate = db.create_account("daniel".into(), "daniel".into(), "hash".into());
    assert!(matches!(duplicate, Err(CreateAccountError::UsernameTaken)));

    assert!(db.set_disabled("daniel", true).unwrap());
    assert!(
        db.account_by_key("daniel")
            .unwrap()
            .unwrap()
            .disabled_at
            .is_some()
    );
    assert!(db.set_disabled("daniel", false).unwrap());
    assert!(
        db.account_by_key("daniel")
            .unwrap()
            .unwrap()
            .disabled_at
            .is_none()
    );
}
