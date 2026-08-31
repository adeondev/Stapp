//! Consultas de mensagem direta.
//!
//! A conversa nao tem tabela: o par de contas ja e a identidade dela, e o id sai
//! de [`conversation_id`]. Sem linha de conversa para criar, mandar a primeira
//! mensagem para alguem e igual a mandar a centesima.

use anyhow::Result;
use rusqlite::Row;

use super::Db;
use crate::protocol::{DirectMessage, DirectMessageKind, UserId};

/// Id deterministico da conversa entre duas contas: os dois ids em ordem.
/// Os dois lados calculam o mesmo valor sem combinar nada.
pub fn conversation_id(a: &str, b: &str) -> String {
    if a <= b {
        format!("{a}:{b}")
    } else {
        format!("{b}:{a}")
    }
}

const COLUNAS: &str = "id, author_id, author_username, kind, text, ts";

impl Db {
    pub fn insert_direct(&self, conversation: &str, msg: &DirectMessage) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO dm_messages
                (id, conversation_id, author_id, author_username, kind, text, ts)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (
                &msg.id,
                conversation,
                &msg.author_id,
                &msg.author_username,
                kind_para_texto(msg.kind),
                &msg.text,
                msg.ts,
            ),
        )?;
        Ok(())
    }

    /// As `limit` mensagens mais recentes, ja em ordem cronologica.
    pub fn direct_history(&self, conversation: &str, limit: usize) -> Result<Vec<DirectMessage>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUNAS} FROM dm_messages
              WHERE conversation_id = ?1
              ORDER BY ts DESC, rowid DESC
              LIMIT ?2"
        ))?;
        let rows = stmt.query_map((conversation, limit as i64), ler_mensagem)?;
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

    pub fn direct_last(&self, conversation: &str) -> Result<Option<DirectMessage>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUNAS} FROM dm_messages
              WHERE conversation_id = ?1
              ORDER BY ts DESC, rowid DESC
              LIMIT 1"
        ))?;
        let mut rows = stmt.query([conversation])?;
        match rows.next()? {
            Some(row) => {
                let mut msg = ler_mensagem(row)?;
                if let Ok(atts) = super::attachments::list_for_message(&conn, &msg.id, None) {
                    msg.attachments = atts;
                }
                if let Ok(poll) = super::polls::get_poll_by_message(&conn, &msg.id, None) {
                    msg.poll = poll;
                }
                Ok(Some(msg))
            }
            None => Ok(None),
        }
    }

    /// Quantas mensagens da outra pessoa chegaram depois da ultima leitura.
    /// O que voce mesmo escreveu nunca conta como nao lido.
    pub fn direct_unread(&self, reader: &UserId, conversation: &str) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM dm_messages
              WHERE conversation_id = ?1
                AND author_id <> ?2
                AND ts > COALESCE(
                      (SELECT last_read_ts FROM dm_reads
                        WHERE user_id = ?2 AND conversation_id = ?1),
                      0)",
            (conversation, reader),
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }

    pub fn mark_direct_read(&self, reader: &UserId, conversation: &str, ts: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        // MAX evita que uma marcacao atrasada "desleia" o que ja tinha sido lido.
        conn.execute(
            "INSERT INTO dm_reads (user_id, conversation_id, last_read_ts)
             VALUES (?1, ?2, ?3)
             ON CONFLICT (user_id, conversation_id)
             DO UPDATE SET last_read_ts = MAX(last_read_ts, excluded.last_read_ts)",
            (reader, conversation, ts),
        )?;
        Ok(())
    }

    /// Com quem esta conta ja trocou mensagem, mais recente primeiro.
    pub fn direct_partners(&self, user_id: &UserId) -> Result<Vec<UserId>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT conversation_id, MAX(ts) AS ultima
               FROM dm_messages
              WHERE conversation_id LIKE ?1 || ':%'
                 OR conversation_id LIKE '%:' || ?1
              GROUP BY conversation_id
              ORDER BY ultima DESC",
        )?;
        let rows = stmt.query_map([user_id], |row| row.get::<_, String>(0))?;

        let mut parceiros = Vec::new();
        for conversa in rows {
            let conversa = conversa?;
            if let Some(outro) = outro_lado(&conversa, user_id) {
                parceiros.push(outro);
            }
        }
        Ok(parceiros)
    }
}

/// Extrai a outra ponta de um `conversation_id`.
fn outro_lado(conversation: &str, eu: &str) -> Option<UserId> {
    let (a, b) = conversation.split_once(':')?;
    if a == eu {
        Some(b.to_string())
    } else if b == eu {
        Some(a.to_string())
    } else {
        None
    }
}

fn kind_para_texto(kind: DirectMessageKind) -> &'static str {
    match kind {
        DirectMessageKind::Text => "text",
        DirectMessageKind::Call => "call",
    }
}

fn ler_mensagem(row: &Row) -> rusqlite::Result<DirectMessage> {
    let kind: String = row.get(3)?;
    Ok(DirectMessage {
        id: row.get(0)?,
        author_id: row.get(1)?,
        author_username: row.get(2)?,
        kind: match kind.as_str() {
            "call" => DirectMessageKind::Call,
            _ => DirectMessageKind::Text,
        },
        text: row.get(4)?,
        ts: row.get(5)?,
        attachments: Vec::new(),
        poll: None,
    })
}
