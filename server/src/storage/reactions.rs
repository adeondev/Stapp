//! Reacoes de mensagem.

use std::collections::HashMap;

use anyhow::Result;
use sqlx::{SqliteConnection, SqlitePool};

use super::Db;
use crate::protocol::{Reaction, UserId};

pub async fn toggle(
    pool: &SqlitePool,
    message_id: &str,
    emoji: &str,
    user_id: &UserId,
    created_at: i64,
) -> Result<bool> {
    let removidas = sqlx::query(
        "DELETE FROM message_reactions
          WHERE message_id = $1 AND emoji = $2 AND user_id = $3",
    )
    .bind(message_id)
    .bind(emoji)
    .bind(user_id)
    .execute(pool)
    .await?
    .rows_affected();

    if removidas > 0 {
        return Ok(false);
    }

    sqlx::query(
        "INSERT INTO message_reactions (message_id, emoji, user_id, created_at)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(message_id)
    .bind(emoji)
    .bind(user_id)
    .bind(created_at)
    .execute(pool)
    .await?;

    Ok(true)
}

pub async fn list_for_messages(
    pool: &SqlitePool,
    message_ids: &[String],
) -> Result<HashMap<String, Vec<Reaction>>> {
    let mut agrupado: HashMap<String, Vec<Reaction>> = HashMap::new();
    if message_ids.is_empty() {
        return Ok(agrupado);
    }

    let mut builder = sqlx::QueryBuilder::new(
        "SELECT message_id, emoji, user_id FROM message_reactions WHERE message_id IN (",
    );
    let mut separated = builder.separated(", ");
    for id in message_ids {
        separated.push_bind(id);
    }
    separated.push_unseparated(") ORDER BY message_id, created_at ASC");

    let rows: Vec<(String, String, String)> = builder.build_query_as().fetch_all(pool).await?;

    for (message_id, emoji, user_id) in rows {
        let reacoes = agrupado.entry(message_id).or_default();
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

pub async fn list_for_message(pool: &SqlitePool, message_id: &str) -> Result<Vec<Reaction>> {
    let ids = [message_id.to_string()];
    Ok(list_for_messages(pool, &ids)
        .await?
        .remove(message_id)
        .unwrap_or_default())
}

pub async fn delete_for_message(conn: &mut SqliteConnection, message_id: &str) -> Result<()> {
    sqlx::query("DELETE FROM message_reactions WHERE message_id = $1")
        .bind(message_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

impl Db {
    pub async fn toggle_reaction(
        &self,
        message_id: &str,
        emoji: &str,
        user_id: &UserId,
        created_at: i64,
    ) -> Result<bool> {
        toggle(&self.pool, message_id, emoji, user_id, created_at).await
    }

    pub async fn reactions_of_message(&self, message_id: &str) -> Result<Vec<Reaction>> {
        list_for_message(&self.pool, message_id).await
    }
}
