//! Onde uma mensagem mora.

use anyhow::Result;
use sqlx::SqlitePool;

use super::Db;
use crate::protocol::{DirectMessageKind, UserId};

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

pub async fn locate_message(pool: &SqlitePool, message_id: &str) -> Result<Option<MessageLocation>> {
    let canal: Option<(String, String)> = sqlx::query_as(
        "SELECT channel, author_id FROM messages WHERE id = $1",
    )
    .bind(message_id)
    .fetch_optional(pool)
    .await?;

    if let Some((channel, author_id)) = canal {
        return Ok(Some(MessageLocation::Channel { channel, author_id }));
    }

    let conversa: Option<(String, String, String)> = sqlx::query_as(
        "SELECT conversation_id, author_id, kind FROM dm_messages WHERE id = $1",
    )
    .bind(message_id)
    .fetch_optional(pool)
    .await?;

    Ok(conversa.map(|(conversation_id, author_id, kind)| MessageLocation::Direct {
        conversation_id,
        author_id,
        kind: match kind.as_str() {
            "call" => DirectMessageKind::Call,
            _ => DirectMessageKind::Text,
        },
    }))
}

impl Db {
    pub async fn locate_message(&self, message_id: &str) -> Result<Option<MessageLocation>> {
        locate_message(&self.pool, message_id).await
    }
}

pub async fn reply_ref(pool: &SqlitePool, message_id: &str) -> Result<Option<crate::protocol::ReplyRef>> {
    for tabela in ["messages", "dm_messages"] {
        let query = format!("SELECT author_id, author_username, text FROM {tabela} WHERE id = $1");
        let achado: Option<(String, String, String)> = sqlx::query_as(&query)
            .bind(message_id)
            .fetch_optional(pool)
            .await?;

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
    pub async fn reply_ref(&self, message_id: &str) -> Result<Option<crate::protocol::ReplyRef>> {
        reply_ref(&self.pool, message_id).await
    }
}
