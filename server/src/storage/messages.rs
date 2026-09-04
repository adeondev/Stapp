//! Consultas de mensagem.

use std::collections::HashMap;

use anyhow::Result;
use sqlx::{SqliteConnection, SqlitePool};

use super::Db;
use crate::protocol::{Message, REPLY_EXCERPT_CHARS, ReplyRef, UserId};

const COLUNAS: &str = "id, channel, author_id, author_username, text, ts, reply_to, edited_at, mentions, \
     mentions_everyone";

#[derive(sqlx::FromRow)]
struct RawMessage {
    id: String,
    channel: String,
    author_id: String,
    author_username: String,
    text: String,
    ts: i64,
    reply_to: Option<String>,
    edited_at: Option<i64>,
    mentions: String,
    mentions_everyone: bool,
}

impl From<RawMessage> for Message {
    fn from(r: RawMessage) -> Self {
        Self {
            id: r.id,
            channel: r.channel,
            author_id: r.author_id,
            author_username: r.author_username,
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
    pub async fn insert(&self, msg: &Message) -> Result<()> {
        let mut conn = self.pool.acquire().await?;
        insert_on(&mut conn, msg, None).await
    }

    pub async fn message_id_for_nonce(
        &self,
        author_id: &UserId,
        channel: &str,
        nonce: &str,
    ) -> Result<Option<String>> {
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM messages WHERE author_id = $1 AND channel = $2 AND client_nonce = $3",
        )
        .bind(author_id)
        .bind(channel)
        .bind(nonce)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| r.0))
    }

    pub async fn mark_channel_read(
        &self,
        reader: &UserId,
        channel: &str,
        message_id: &str,
        ts: i64,
    ) -> Result<Vec<UserId>> {
        let message_ts: Option<(i64,)> = sqlx::query_as(
            "SELECT ts FROM messages WHERE id = $1 AND channel = $2",
        )
        .bind(message_id)
        .bind(channel)
        .fetch_optional(&self.pool)
        .await?;

        let Some((message_ts,)) = message_ts else {
            return Ok(Vec::new());
        };

        sqlx::query(
            "INSERT INTO channel_reads (user_id, channel_id, last_message_id, last_read_ts)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, channel_id) DO UPDATE SET
                last_message_id = CASE WHEN excluded.last_read_ts >= last_read_ts THEN excluded.last_message_id ELSE last_message_id END,
                last_read_ts = MAX(last_read_ts, excluded.last_read_ts)",
        )
        .bind(reader)
        .bind(channel)
        .bind(message_id)
        .bind(ts.max(message_ts))
        .execute(&self.pool)
        .await?;

        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT user_id FROM channel_reads WHERE channel_id = $1 AND last_read_ts >= $2 ORDER BY last_read_ts DESC",
        )
        .bind(channel)
        .bind(message_ts)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|r| r.0).collect())
    }
}

pub(super) async fn insert_on(
    conn: &mut SqliteConnection,
    msg: &Message,
    client_nonce: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO messages
                (id, channel, author_id, author_username, text, ts,
                 reply_to, mentions, mentions_everyone, client_nonce)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(&msg.id)
    .bind(&msg.channel)
    .bind(&msg.author_id)
    .bind(&msg.author_username)
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
    pub async fn history(&self, channel: &str, limit: usize) -> Result<Vec<Message>> {
        let query = format!(
            "SELECT {COLUNAS} FROM messages
              WHERE channel = $1
              ORDER BY ts DESC, rowid DESC
              LIMIT $2"
        );
        let rows: Vec<RawMessage> = sqlx::query_as(&query)
            .bind(channel)
            .bind(limit as i64)
            .fetch_all(&self.pool)
            .await?;

        let mut msgs: Vec<Message> = rows.into_iter().map(Into::into).collect();
        hidratar(&self.pool, &mut msgs).await?;
        msgs.reverse();
        Ok(msgs)
    }

    pub async fn message_by_id(&self, id: &str) -> Result<Option<Message>> {
        let query = format!("SELECT {COLUNAS} FROM messages WHERE id = $1");
        let raw: Option<RawMessage> = sqlx::query_as(&query)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        let Some(raw) = raw else {
            return Ok(None);
        };
        let mut msgs = vec![Message::from(raw)];
        hidratar(&self.pool, &mut msgs).await?;
        Ok(msgs.pop())
    }

    pub async fn update_message_text(
        &self,
        id: &str,
        author_id: &UserId,
        text: &str,
        mentions: &[UserId],
        mentions_everyone: bool,
        edited_at: i64,
    ) -> Result<bool> {
        let alteradas = sqlx::query(
            "UPDATE messages
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
}

pub(super) async fn hidratar(pool: &SqlitePool, msgs: &mut [Message]) -> Result<()> {
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
           FROM messages origem
           LEFT JOIN messages alvo ON alvo.id = origem.reply_to
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

pub(super) fn recortar(texto: &str) -> String {
    let mut recorte: String = texto.chars().take(REPLY_EXCERPT_CHARS).collect();
    if recorte.chars().count() < texto.chars().count() {
        recorte.push('…');
    }
    recorte
}
