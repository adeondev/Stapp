//! Consultas de mensagem.

use anyhow::Result;

use super::Db;
use crate::protocol::Message;

impl Db {
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

    /// As `limit` mensagens mais recentes do canal, ja em ordem cronologica.
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
                attachments: Vec::new(),
                poll: None,
            })
        })?;

        let mut msgs = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        for msg in &mut msgs {
            if let Ok(atts) = super::attachments::list_for_message(&conn, &msg.id, None) {
                msg.attachments = atts;
            }
            if let Ok(poll) = super::polls::get_poll_by_message(&conn, &msg.id, None) {
                msg.poll = poll;
            }
        }
        msgs.reverse();
        Ok(msgs)
    }
}
