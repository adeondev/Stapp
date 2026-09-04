//! Persistencia SQLite com SQLx.
//!
//! `mod.rs` guarda so o pool e a abertura do banco. O esquema e as migracoes
//! ficam em [`schema`], e cada assunto tem o proprio arquivo de consultas —
//! contas em [`accounts`], mensagens em [`messages`].

mod accounts;
pub mod attachments;
mod auth_sessions;
mod direct;
pub mod lookup;
mod messages;
pub mod polls;
mod profiles;
pub mod reactions;
mod schema;
mod social;

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use sqlx::SqlitePool;

pub use accounts::{Account, CreateAccountError};
pub use direct::{conversation_id, conversation_pair};
pub use lookup::MessageLocation;
pub use social::Relationship;

pub struct Db {
    pool: SqlitePool,
    path: PathBuf,
    server_id: String,
}

impl Db {
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn insert_channel_message_with_attachments(
        &self,
        msg: &crate::protocol::Message,
        client_nonce: Option<&str>,
        attachment_ids: &[String],
        max_attachments: usize,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        messages::insert_on(&mut tx, msg, client_nonce).await?;
        attachments::bind_owned(
            &mut tx,
            &msg.id,
            attachment_ids,
            &msg.author_id,
            "channel",
            &msg.channel,
            max_attachments,
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn insert_direct_message_with_attachments(
        &self,
        conversation: &str,
        msg: &crate::protocol::DirectMessage,
        client_nonce: Option<&str>,
        attachment_ids: &[String],
        max_attachments: usize,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        direct::insert_on(&mut tx, conversation, msg, client_nonce).await?;
        attachments::bind_owned(
            &mut tx,
            &msg.id,
            attachment_ids,
            &msg.author_id,
            "direct",
            conversation,
            max_attachments,
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)
                .with_context(|| format!("nao consegui criar {}", dir.display()))?;
        }

        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .synchronous(sqlx::sqlite::SqliteSynchronous::Normal)
            .foreign_keys(true)
            .busy_timeout(std::time::Duration::from_secs(5));

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(10)
            .connect_with(options)
            .await
            .with_context(|| format!("nao consegui abrir o banco {}", path.display()))?;

        schema::migrate(&pool, path).await?;

        let server_id: (String,) = sqlx::query_as(
            "SELECT value FROM server_meta WHERE key = 'server_id'",
        )
        .fetch_one(&pool)
        .await?;

        Ok(Self {
            pool,
            path: path.to_path_buf(),
            server_id: server_id.0,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn server_id(&self) -> Result<String> {
        Ok(self.server_id.clone())
    }

    pub async fn insert_attachment(
        &self,
        id: &str,
        user_id: &str,
        filename: &str,
        content_type: &str,
        size_bytes: usize,
        s3_key: &str,
        created_at: i64,
    ) -> Result<()> {
        attachments::insert_attachment(
            &self.pool,
            id,
            user_id,
            filename,
            content_type,
            size_bytes,
            s3_key,
            created_at,
        )
        .await
    }

    pub async fn bind_attachments(&self, message_id: &str, attachment_ids: &[String]) -> Result<()> {
        attachments::bind_attachments(&self.pool, message_id, attachment_ids).await
    }

    pub async fn list_attachments(
        &self,
        message_id: &str,
        legacy_public_base: Option<&str>,
    ) -> Result<Vec<crate::protocol::Attachment>> {
        attachments::list_for_message(&self.pool, message_id, legacy_public_base).await
    }

    pub async fn insert_ready_attachment(&self, value: &attachments::NewAttachment<'_>) -> Result<()> {
        attachments::insert_ready(&self.pool, value).await
    }

    pub async fn attachment(&self, id: &str) -> Result<Option<attachments::AttachmentRecord>> {
        attachments::get(&self.pool, id).await
    }

    pub async fn update_attachment_metadata(
        &self,
        id: &str,
        owner: &str,
        filename: Option<&str>,
        description_set: bool,
        description: Option<&str>,
        duration_ms: Option<u64>,
        waveform: Option<&[u8]>,
        width: Option<u32>,
        height: Option<u32>,
    ) -> Result<bool> {
        attachments::update_metadata(
            &self.pool,
            id,
            owner,
            filename,
            description_set,
            description,
            duration_ms,
            waveform,
            width,
            height,
        )
        .await
    }

    pub async fn delete_orphan_attachment(&self, id: &str, owner: &str) -> Result<Option<String>> {
        attachments::delete_orphan(&self.pool, id, owner).await
    }

    pub async fn expired_orphan_attachments(&self, now: i64) -> Result<Vec<(String, String)>> {
        attachments::expired_orphans(&self.pool, now).await
    }

    pub async fn delete_expired_orphan_attachment(&self, id: &str, now: i64) -> Result<bool> {
        attachments::delete_expired_orphan(&self.pool, id, now).await
    }

    pub async fn create_attachment_ticket(
        &self,
        id: &str,
        user: &str,
        ticket: &str,
        expires_at: i64,
    ) -> Result<bool> {
        if !attachments::can_access(&self.pool, id, user).await? {
            return Ok(false);
        }
        attachments::create_ticket(&self.pool, id, user, ticket, expires_at).await?;
        Ok(true)
    }

    pub async fn attachment_by_ticket(
        &self,
        ticket: &str,
        now: i64,
    ) -> Result<Option<attachments::AttachmentRecord>> {
        attachments::by_ticket(&self.pool, ticket, now).await
    }

    pub async fn insert_poll(
        &self,
        message_id: &str,
        channel_id: Option<&str>,
        author_id: &crate::protocol::UserId,
        question: &str,
        allow_mult: bool,
        options: &[String],
        ts: i64,
    ) -> Result<crate::protocol::Poll> {
        polls::insert_poll(
            &self.pool, message_id, channel_id, author_id, question, allow_mult, options, ts,
        )
        .await
    }

    pub async fn get_poll_by_id(
        &self,
        poll_id: &str,
        current_user_id: Option<&crate::protocol::UserId>,
    ) -> Result<Option<crate::protocol::Poll>> {
        polls::get_poll_by_id(&self.pool, poll_id, current_user_id).await
    }

    pub async fn get_poll_by_message(
        &self,
        message_id: &str,
        current_user_id: Option<&crate::protocol::UserId>,
    ) -> Result<Option<crate::protocol::Poll>> {
        polls::get_poll_by_message(&self.pool, message_id, current_user_id).await
    }

    pub async fn vote_poll(
        &self,
        poll_id: &str,
        option_id: &str,
        user_id: &crate::protocol::UserId,
        ts: i64,
    ) -> Result<crate::protocol::Poll> {
        polls::vote_poll(&self.pool, poll_id, option_id, user_id, ts).await
    }

    pub async fn close_poll(
        &self,
        poll_id: &str,
        user_id: &crate::protocol::UserId,
    ) -> Result<crate::protocol::Poll> {
        polls::close_poll(&self.pool, poll_id, user_id).await
    }

    pub async fn delete_message_cascade(
        &self,
        message_id: &str,
        author_id: &crate::protocol::UserId,
    ) -> Result<Option<Vec<String>>> {
        let mut tx = self.pool.begin().await?;

        let chaves = attachments::keys_for_message(&mut tx, message_id).await?;

        reactions::delete_for_message(&mut tx, message_id).await?;
        attachments::delete_for_message(&mut tx, message_id).await?;

        sqlx::query("DELETE FROM polls WHERE message_id = $1")
            .bind(message_id)
            .execute(&mut *tx)
            .await?;

        let res1 = sqlx::query("DELETE FROM messages WHERE id = $1 AND author_id = $2")
            .bind(message_id)
            .bind(author_id)
            .execute(&mut *tx)
            .await?;
        let mut apagadas = res1.rows_affected();
        if apagadas == 0 {
            let res2 = sqlx::query("DELETE FROM dm_messages WHERE id = $1 AND author_id = $2")
                .bind(message_id)
                .bind(author_id)
                .execute(&mut *tx)
                .await?;
            apagadas = res2.rows_affected();
        }

        if apagadas == 0 {
            return Ok(None);
        }
        tx.commit().await?;
        Ok(Some(chaves))
    }
}

pub(crate) fn mentions_para_json(mentions: &[crate::protocol::UserId]) -> String {
    serde_json::to_string(mentions).unwrap_or_else(|_| "[]".into())
}

pub(crate) fn mentions_de_json(bruto: String) -> Vec<crate::protocol::UserId> {
    serde_json::from_str(&bruto).unwrap_or_default()
}

pub(crate) fn montar_reply_ref(
    message_id: String,
    author_id: Option<String>,
    author_username: Option<String>,
    texto: Option<String>,
) -> crate::protocol::ReplyRef {
    crate::protocol::ReplyRef {
        message_id,
        author_id,
        author_username,
        excerpt: texto.map(|t| messages::recortar(&t)),
    }
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_v7;
