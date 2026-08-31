//! Reacoes de mensagem.
//!
//! Uma tabela so serve canal e conversa, como `attachments`: o id da mensagem e
//! unico entre as duas, e o que muda entre os escopos e a audiencia do evento,
//! nao o dado.

use std::collections::HashMap;

use anyhow::Result;
use rusqlite::{Connection, params_from_iter};

use super::Db;
use crate::protocol::{Reaction, UserId};

/// Alterna a reacao. `true` = ficou reagido, `false` = a reacao saiu.
pub fn toggle(
    conn: &Connection,
    message_id: &str,
    emoji: &str,
    user_id: &UserId,
    created_at: i64,
) -> Result<bool> {
    let removidas = conn.execute(
        "DELETE FROM message_reactions
          WHERE message_id = ?1 AND emoji = ?2 AND user_id = ?3",
        (message_id, emoji, user_id),
    )?;
    if removidas > 0 {
        return Ok(false);
    }

    conn.execute(
        "INSERT INTO message_reactions (message_id, emoji, user_id, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        (message_id, emoji, user_id, created_at),
    )?;
    Ok(true)
}

/// As reacoes de um lote inteiro de mensagens, em **uma** consulta.
///
/// O historico ja carrega anexo e enquete uma mensagem por vez (divida da V5 e
/// da V6). Reacao nao entra nessa fila: um canal de 200 mensagens faria 200
/// consultas so por causa de emoji.
pub fn list_for_messages(
    conn: &Connection,
    message_ids: &[String],
) -> Result<HashMap<String, Vec<Reaction>>> {
    let mut agrupado: HashMap<String, Vec<Reaction>> = HashMap::new();
    // O SQLite nao aceita `IN ()`, e um lote vazio nao tem o que buscar.
    if message_ids.is_empty() {
        return Ok(agrupado);
    }

    let marcadores = vec!["?"; message_ids.len()].join(",");
    let mut stmt = conn.prepare(&format!(
        "SELECT message_id, emoji, user_id
           FROM message_reactions
          WHERE message_id IN ({marcadores})
          ORDER BY message_id, created_at ASC"
    ))?;

    let linhas = stmt.query_map(params_from_iter(message_ids), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    for linha in linhas {
        let (message_id, emoji, user_id) = linha?;
        let reacoes = agrupado.entry(message_id).or_default();
        // A ordem dos emojis segue a primeira reacao de cada um, e a dos users
        // segue a chegada — e o `ORDER BY created_at` que garante as duas.
        match reacoes.iter_mut().find(|r| r.emoji == emoji) {
            Some(reacao) => reacao.users.push(user_id),
            None => reacoes.push(Reaction {
                emoji,
                users: vec![user_id],
            }),
        }
    }

    Ok(agrupado)
}

pub fn list_for_message(conn: &Connection, message_id: &str) -> Result<Vec<Reaction>> {
    let ids = [message_id.to_string()];
    Ok(list_for_messages(conn, &ids)?
        .remove(message_id)
        .unwrap_or_default())
}

pub fn delete_for_message(conn: &Connection, message_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM message_reactions WHERE message_id = ?1",
        [message_id],
    )?;
    Ok(())
}

impl Db {
    pub fn toggle_reaction(
        &self,
        message_id: &str,
        emoji: &str,
        user_id: &UserId,
        created_at: i64,
    ) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        toggle(&conn, message_id, emoji, user_id, created_at)
    }

    pub fn reactions_of_message(&self, message_id: &str) -> Result<Vec<Reaction>> {
        let conn = self.conn.lock().unwrap();
        list_for_message(&conn, message_id)
    }
}
