//! Onde uma mensagem mora.
//!
//! O id de mensagem e um UUID e nao se repete entre `messages` e `dm_messages`,
//! entao da para descobrir o escopo a partir dele sozinho. E o que permite os
//! comandos `message.edit` / `message.delete` / `message.react` serem um so para
//! canal e conversa: quem sabe onde a mensagem esta e o servidor, nao o cliente.
//!
//! Tambem e o que substitui o `channel: "geral"` que `services/polls` chutava
//! por nao existir essa consulta.

use anyhow::Result;
use rusqlite::{Connection, OptionalExtension};

use super::Db;
use crate::protocol::{DirectMessageKind, UserId};

/// Onde a mensagem esta e quem a escreveu.
///
/// Carrega o autor junto porque quem localiza quase sempre precisa decidir
/// permissao logo depois — evita uma segunda ida ao banco.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageLocation {
    Channel {
        channel: String,
        author_id: UserId,
    },
    Direct {
        conversation_id: String,
        author_id: UserId,
        kind: DirectMessageKind,
    },
}

impl MessageLocation {
    pub fn author_id(&self) -> &UserId {
        match self {
            MessageLocation::Channel { author_id, .. } => author_id,
            MessageLocation::Direct { author_id, .. } => author_id,
        }
    }
}

pub fn locate_message(conn: &Connection, message_id: &str) -> Result<Option<MessageLocation>> {
    let canal = conn
        .query_row(
            "SELECT channel, author_id FROM messages WHERE id = ?1",
            [message_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;

    if let Some((channel, author_id)) = canal {
        return Ok(Some(MessageLocation::Channel { channel, author_id }));
    }

    let conversa = conn
        .query_row(
            "SELECT conversation_id, author_id, kind FROM dm_messages WHERE id = ?1",
            [message_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;

    Ok(conversa.map(
        |(conversation_id, author_id, kind)| MessageLocation::Direct {
            conversation_id,
            author_id,
            kind: match kind.as_str() {
                "call" => DirectMessageKind::Call,
                _ => DirectMessageKind::Text,
            },
        },
    ))
}

impl Db {
    pub fn locate_message(&self, message_id: &str) -> Result<Option<MessageLocation>> {
        let conn = self.conn.lock().unwrap();
        locate_message(&conn, message_id)
    }
}

/// A previa de uma resposta, montada a partir do alvo atual.
///
/// O historico monta isso por um LEFT JOIN em lote, mas o evento de envio
/// precisa de **uma** mensagem so — e sem isto o `chat.new` sairia com a
/// citacao vazia e a previa so apareceria depois de recarregar o historico.
pub fn reply_ref(conn: &Connection, message_id: &str) -> Result<Option<crate::protocol::ReplyRef>> {
    for tabela in ["messages", "dm_messages"] {
        let achado = conn
            .query_row(
                &format!("SELECT author_id, author_username, text FROM {tabela} WHERE id = ?1"),
                [message_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;

        if let Some((author_id, author_username, texto)) = achado {
            return Ok(Some(super::montar_reply_ref(
                message_id.to_string(),
                Some(author_id),
                Some(author_username),
                Some(texto),
            )));
        }
    }
    Ok(None)
}

impl Db {
    pub fn reply_ref(&self, message_id: &str) -> Result<Option<crate::protocol::ReplyRef>> {
        let conn = self.conn.lock().unwrap();
        reply_ref(&conn, message_id)
    }
}
