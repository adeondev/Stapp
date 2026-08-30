//! Persistencia SQLite de contas e mensagens.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result, bail};
use rusqlite::{Connection, ErrorCode};
use uuid::Uuid;

use crate::protocol::{Message, now_ms};

const SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone)]
pub struct Account {
    pub id: String,
    pub username: String,
    pub username_key: String,
    pub password_hash: String,
    pub created_at: i64,
    pub disabled_at: Option<i64>,
}

#[derive(Debug)]
pub enum CreateAccountError {
    UsernameTaken,
    Other(anyhow::Error),
}

pub struct Db {
    conn: Mutex<Connection>,
    path: PathBuf,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)
                .with_context(|| format!("nao consegui criar {}", dir.display()))?;
        }

        let conn = Connection::open(path)
            .with_context(|| format!("nao consegui abrir o banco {}", path.display()))?;

        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version == 0 && has_any_stapp_table(&conn)? {
            let absolute = absolute_path(path);
            bail!(
                "o banco {} usa o esquema antigo sem contas; mova ou remova esse arquivo conscientemente e inicie o servidor novamente",
                absolute.display()
            );
        }
        if version > SCHEMA_VERSION {
            bail!(
                "o banco usa o esquema {version}, mas este servidor conhece ate {SCHEMA_VERSION}"
            );
        }

        if version == 0 {
            conn.execute_batch(
                "BEGIN IMMEDIATE;
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
                 PRAGMA user_version = 1;
                 COMMIT;",
            )?;
        }

        Ok(Self {
            conn: Mutex::new(conn),
            path: path.to_path_buf(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn account_by_key(&self, username_key: &str) -> Result<Option<Account>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, username, username_key, password_hash, created_at, disabled_at
               FROM users WHERE username_key = ?1",
        )?;
        let mut rows = stmt.query([username_key])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        Ok(Some(Account {
            id: row.get(0)?,
            username: row.get(1)?,
            username_key: row.get(2)?,
            password_hash: row.get(3)?,
            created_at: row.get(4)?,
            disabled_at: row.get(5)?,
        }))
    }

    pub fn create_account(
        &self,
        username: String,
        username_key: String,
        password_hash: String,
    ) -> std::result::Result<Account, CreateAccountError> {
        let account = Account {
            id: Uuid::new_v4().to_string(),
            username,
            username_key,
            password_hash,
            created_at: now_ms(),
            disabled_at: None,
        };
        let conn = self.conn.lock().unwrap();
        let result = conn.execute(
            "INSERT INTO users (id, username, username_key, password_hash, created_at, disabled_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
            (
                &account.id,
                &account.username,
                &account.username_key,
                &account.password_hash,
                account.created_at,
            ),
        );
        match result {
            Ok(_) => Ok(account),
            Err(rusqlite::Error::SqliteFailure(error, _))
                if error.code == ErrorCode::ConstraintViolation =>
            {
                Err(CreateAccountError::UsernameTaken)
            }
            Err(error) => Err(CreateAccountError::Other(error.into())),
        }
    }

    pub fn list_accounts(&self) -> Result<Vec<Account>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, username, username_key, password_hash, created_at, disabled_at
               FROM users ORDER BY username_key",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Account {
                id: row.get(0)?,
                username: row.get(1)?,
                username_key: row.get(2)?,
                password_hash: row.get(3)?,
                created_at: row.get(4)?,
                disabled_at: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn update_password(&self, username_key: &str, password_hash: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.execute(
            "UPDATE users SET password_hash = ?1 WHERE username_key = ?2",
            (password_hash, username_key),
        )? > 0)
    }

    pub fn set_disabled(&self, username_key: &str, disabled: bool) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let disabled_at = disabled.then(now_ms);
        Ok(conn.execute(
            "UPDATE users SET disabled_at = ?1 WHERE username_key = ?2",
            (disabled_at, username_key),
        )? > 0)
    }

    pub fn insert(&self, msg: &Message) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages
                (id, channel, author_id, author_username, text, ts)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (
                &msg.id,
                &msg.channel,
                &msg.author_id,
                &msg.author_username,
                &msg.text,
                msg.ts,
            ),
        )?;
        Ok(())
    }

    pub fn history(&self, channel: &str, limit: usize) -> Result<Vec<Message>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, channel, author_id, author_username, text, ts
               FROM messages
              WHERE channel = ?1
              ORDER BY ts DESC, rowid DESC
              LIMIT ?2",
        )?;

        let rows = stmt.query_map((channel, limit as i64), |row| {
            Ok(Message {
                id: row.get(0)?,
                channel: row.get(1)?,
                author_id: row.get(2)?,
                author_username: row.get(3)?,
                text: row.get(4)?,
                ts: row.get(5)?,
            })
        })?;

        let mut msgs = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        msgs.reverse();
        Ok(msgs)
    }
}

fn has_any_stapp_table(conn: &Connection) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master
          WHERE type = 'table' AND name IN ('messages', 'users')",
        [],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn absolute_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| {
        std::env::current_dir()
            .map(|dir| dir.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
