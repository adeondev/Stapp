//! Historico de mensagens em SQLite.
//!
//! Um `Mutex<Connection>` basta: o volume aqui e de um grupo de amigos, nao
//! justifica pool nem `spawn_blocking`.

use std::path::Path;
use std::sync::Mutex;

use anyhow::{Context, Result};
use rusqlite::Connection;

use crate::protocol::Message;

pub struct Db {
    conn: Mutex<Connection>,
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
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS messages (
                 id      TEXT PRIMARY KEY,
                 channel TEXT NOT NULL,
                 nick    TEXT NOT NULL,
                 text    TEXT NOT NULL,
                 ts      INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_messages_channel_ts
                 ON messages (channel, ts);",
        )?;

        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn insert(&self, msg: &Message) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages (id, channel, nick, text, ts) VALUES (?1, ?2, ?3, ?4, ?5)",
            (&msg.id, &msg.channel, &msg.nick, &msg.text, msg.ts),
        )?;
        Ok(())
    }

    /// As `limit` mensagens mais recentes do canal, ja em ordem cronologica.
    pub fn history(&self, channel: &str, limit: usize) -> Result<Vec<Message>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, channel, nick, text, ts
               FROM messages
              WHERE channel = ?1
              ORDER BY ts DESC, rowid DESC
              LIMIT ?2",
        )?;

        let rows = stmt.query_map((channel, limit as i64), |row| {
            Ok(Message {
                id: row.get(0)?,
                channel: row.get(1)?,
                nick: row.get(2)?,
                text: row.get(3)?,
                ts: row.get(4)?,
            })
        })?;

        let mut msgs = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        msgs.reverse();
        Ok(msgs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestDir;

    fn message(id: &str, ts: i64) -> Message {
        Message {
            id: id.into(),
            channel: "geral".into(),
            nick: "Daniel".into(),
            text: id.into(),
            ts,
        }
    }

    #[test]
    fn history_returns_the_latest_messages_in_chronological_order() {
        let dir = TestDir::new();
        let db = Db::open(&dir.database()).unwrap();

        db.insert(&message("old", 100)).unwrap();
        db.insert(&message("tie-first", 200)).unwrap();
        db.insert(&message("tie-second", 200)).unwrap();

        let history = db.history("geral", 2).unwrap();
        let ids: Vec<_> = history.iter().map(|message| message.id.as_str()).collect();
        assert_eq!(ids, ["tie-first", "tie-second"]);
    }
}
