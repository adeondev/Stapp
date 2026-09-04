//! Consultas de mensagem direta.

use std::collections::HashMap;

use anyhow::Result;
use sqlx::{SqliteConnection, SqlitePool};

use super::Db;
use crate::protocol::{DirectMessage, DirectMessageKind, ReplyRef, UserId};

pub fn conversation_id(a: &str, b: &str) -> String {
    if a <= b {
        format!("{a}:{b}")
    } else {
        format!("{b}:{a}")
    }
}

const COLUNAS: &str = "id, author_id, author_username, kind, text, ts, reply_to, edited_at, mentions, mentions_everyone";

#[derive(sqlx::FromRow)]
struct RawDirectMessage {
    id: String,
    author_id: String,
    author_username: String,
    kind: String,
    text: String,
    ts: i64,
    reply_to: Option<String>,
    edited_at: Option<i64>,
    mentions: String,
    mentions_everyone: bool,
}

impl From<RawDirectMessage> for DirectMessage {
    fn from(r: RawDirectMessage) -> Self {
        Self {
            id: r.id,
            author_id: r.author_id,
            author_username: r.author_username,
            kind: match r.kind.as_str() {
                "call" => DirectMessageKind::Call,
                _ => DirectMessageKind::Text,
            },
            text: r.text,
            ts: r.ts,
            attachments: Vec::new(),
            poll: None,
            reactions: Vec::new(),
            reply_to: r.reply_to.map(|id| ReplyRef {
                message_id: id,
                author_id: None,
                author_username: None,
                excerpt: None,
            }),
            edited_at: r.edited_at,
            mentions: super::mentions_de_json(r.mentions),
            mentions_everyone: r.mentions_everyone,
        }
    }
}

impl Db {
    pub async fn insert_direct(&self, conversation: &str, msg: &DirectMessage) -> Result<()> {
        let mut conn = self.pool.acquire().await?;
        insert_on(&mut conn, conversation, msg, None).await
    }

    pub async fn direct_id_for_nonce(
        &self,
        author_id: &UserId,
        conversation: &str,
        nonce: &str,
    ) -> Result<Option<String>> {
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM dm_messages WHERE author_id = $1 AND conversation_id = $2 AND client_nonce = $3",
        )
        .bind(author_id)
        .bind(conversation)
        .bind(nonce)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| r.0))
    }
}

pub(super) async fn insert_on(
    conn: &mut SqliteConnection,
    conversation: &str,
    msg: &DirectMessage,
    client_nonce: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO dm_messages
                (id, conversation_id, author_id, author_username, kind, text, ts,
                 reply_to, mentions, mentions_everyone, client_nonce)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    )
    .bind(&msg.id)
    .bind(conversation)
    .bind(&msg.author_id)
    .bind(&msg.author_username)
    .bind(kind_para_texto(msg.kind))
    .bind(&msg.text)
    .bind(msg.ts)
    .bind(msg.reply_to.as_ref().map(|r| r.message_id.clone()))
    .bind(super::mentions_para_json(&msg.mentions))
    .bind(msg.mentions_everyone)
    .bind(client_nonce)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

impl Db {
    pub async fn direct_history(&self, conversation: &str, limit: usize) -> Result<Vec<DirectMessage>> {
        let query = format!(
            "SELECT {COLUNAS} FROM dm_messages
              WHERE conversation_id = $1
              ORDER BY ts DESC, rowid DESC
              LIMIT $2"
        );
        let rows: Vec<RawDirectMessage> = sqlx::query_as(&query)
            .bind(conversation)
            .bind(limit as i64)
            .fetch_all(&self.pool)
            .await?;

        let mut msgs: Vec<DirectMessage> = rows.into_iter().map(Into::into).collect();
        hidratar(&self.pool, &mut msgs).await?;
        msgs.reverse();
        Ok(msgs)
    }

    pub async fn direct_last(&self, conversation: &str) -> Result<Option<DirectMessage>> {
        let query = format!(
            "SELECT {COLUNAS} FROM dm_messages
              WHERE conversation_id = $1
              ORDER BY ts DESC, rowid DESC
              LIMIT 1"
        );
        let raw: Option<RawDirectMessage> = sqlx::query_as(&query)
            .bind(conversation)
            .fetch_optional(&self.pool)
            .await?;

        let Some(raw) = raw else {
            return Ok(None);
        };
        let mut msgs = vec![DirectMessage::from(raw)];
        hidratar(&self.pool, &mut msgs).await?;
        Ok(msgs.pop())
    }

    pub async fn direct_by_id(&self, id: &str) -> Result<Option<DirectMessage>> {
        let query = format!("SELECT {COLUNAS} FROM dm_messages WHERE id = $1");
        let raw: Option<RawDirectMessage> = sqlx::query_as(&query)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        let Some(raw) = raw else {
            return Ok(None);
        };
        let mut msgs = vec![DirectMessage::from(raw)];
        hidratar(&self.pool, &mut msgs).await?;
        Ok(msgs.pop())
    }

    pub async fn update_direct_text(
        &self,
        id: &str,
        author_id: &UserId,
        text: &str,
        mentions: &[UserId],
        mentions_everyone: bool,
        edited_at: i64,
    ) -> Result<bool> {
        let alteradas = sqlx::query(
            "UPDATE dm_messages
                SET text = $3, mentions = $4, mentions_everyone = $5, edited_at = $6
              WHERE id = $1 AND author_id = $2",
        )
        .bind(id)
        .bind(author_id)
        .bind(text)
        .bind(super::mentions_para_json(mentions))
        .bind(mentions_everyone)
        .bind(edited_at)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(alteradas > 0)
    }

    pub async fn direct_unread(&self, reader: &UserId, conversation: &str) -> Result<usize> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM dm_messages
              WHERE conversation_id = $1
                AND author_id <> $2
                AND ts > COALESCE(
                      (SELECT last_read_ts FROM dm_reads
                        WHERE user_id = $2 AND conversation_id = $1),
                      0)",
        )
        .bind(conversation)
        .bind(reader)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0 as usize)
    }

    pub async fn mark_direct_read(&self, reader: &UserId, conversation: &str, ts: i64) -> Result<()> {
        self.mark_direct_read_message(reader, conversation, ts, None)
            .await
            .map(|_| ())
    }

    pub async fn mark_direct_read_message(
        &self,
        reader: &UserId,
        conversation: &str,
        ts: i64,
        message_id: Option<&str>,
    ) -> Result<bool> {
        let read_ts = if let Some(message_id) = message_id {
            let message_ts: Option<(i64,)> = sqlx::query_as(
                "SELECT ts FROM dm_messages WHERE id = $1 AND conversation_id = $2",
            )
            .bind(message_id)
            .bind(conversation)
            .fetch_optional(&self.pool)
            .await?;
            let Some((message_ts,)) = message_ts else {
                return Ok(false);
            };
            message_ts
        } else {
            ts
        };

        sqlx::query(
            "INSERT INTO dm_reads (user_id, conversation_id, last_read_ts, last_message_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, conversation_id)
             DO UPDATE SET
                last_read_ts = MAX(last_read_ts, excluded.last_read_ts),
                last_message_id = CASE
                    WHEN excluded.last_read_ts >= last_read_ts THEN excluded.last_message_id
                    ELSE last_message_id
                END",
        )
        .bind(reader)
        .bind(conversation)
        .bind(read_ts)
        .bind(message_id)
        .execute(&self.pool)
        .await?;
        Ok(true)
    }

    pub async fn direct_partners(&self, user_id: &UserId) -> Result<Vec<UserId>> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT conversation_id
               FROM dm_messages
              WHERE conversation_id LIKE $1 || ':%'
                 OR conversation_id LIKE '%:' || $1
              GROUP BY conversation_id
              ORDER BY MAX(ts) DESC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        let mut parceiros = Vec::new();
        for (conversa,) in rows {
            if let Some(outro) = outro_lado(&conversa, user_id) {
                parceiros.push(outro);
            }
        }
        Ok(parceiros)
    }
}

async fn hidratar(pool: &SqlitePool, msgs: &mut [DirectMessage]) -> Result<()> {
    for msg in msgs.iter_mut() {
        if let Ok(atts) = super::attachments::list_for_message(pool, &msg.id, None).await {
            msg.attachments = atts;
        }
        if let Ok(poll) = super::polls::get_poll_by_message(pool, &msg.id, None).await {
            msg.poll = poll;
        }
    }

    let ids: Vec<String> = msgs.iter().map(|m| m.id.clone()).collect();
    let mut reacoes = super::reactions::list_for_messages(pool, &ids).await?;
    let mut respostas = previas_de_resposta(pool, &ids).await?;
    for msg in msgs.iter_mut() {
        if let Some(lista) = reacoes.remove(&msg.id) {
            msg.reactions = lista;
        }
        if let Some(previa) = respostas.remove(&msg.id) {
            msg.reply_to = Some(previa);
        }
    }
    Ok(())
}

async fn previas_de_resposta(
    pool: &SqlitePool,
    ids: &[String],
) -> Result<HashMap<String, ReplyRef>> {
    let mut mapa = HashMap::new();
    if ids.is_empty() {
        return Ok(mapa);
    }

    let mut builder = sqlx::QueryBuilder::new(
        "SELECT origem.id, origem.reply_to, alvo.author_id, alvo.author_username, alvo.text
           FROM dm_messages origem
           LEFT JOIN dm_messages alvo ON alvo.id = origem.reply_to
          WHERE origem.reply_to IS NOT NULL AND origem.id IN (",
    );
    let mut separated = builder.separated(", ");
    for id in ids {
        separated.push_bind(id);
    }
    separated.push_unseparated(")");

    let linhas: Vec<(String, String, Option<String>, Option<String>, Option<String>)> =
        builder.build_query_as().fetch_all(pool).await?;

    for (origem, reply_to, author_id, author_username, texto) in linhas {
        let previa = super::montar_reply_ref(reply_to, author_id, author_username, texto);
        mapa.insert(origem, previa);
    }
    Ok(mapa)
}

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

pub fn conversation_pair(conversation: &str) -> Option<(UserId, UserId)> {
    let (a, b) = conversation.split_once(':')?;
    Some((a.to_string(), b.to_string()))
}
