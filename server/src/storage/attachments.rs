use crate::protocol::Attachment;
use anyhow::{Result, bail};
use sqlx::{SqliteConnection, SqlitePool};

#[derive(Debug, Clone)]
pub struct AttachmentRecord {
    pub id: String,
    pub message_id: Option<String>,
    pub user_id: String,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: usize,
    pub storage_key: String,
    pub checksum_sha256: Option<String>,
    pub backend: String,
    pub description: Option<String>,
    pub duration_ms: Option<u64>,
    pub waveform: Option<Vec<u8>>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub scope_kind: Option<String>,
    pub scope_id: Option<String>,
}

pub struct NewAttachment<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub filename: &'a str,
    pub content_type: &'a str,
    pub size_bytes: usize,
    pub storage_key: &'a str,
    pub checksum_sha256: &'a str,
    pub backend: &'a str,
    pub created_at: i64,
    pub expires_at: i64,
    pub scope_kind: &'a str,
    pub scope_id: &'a str,
}

pub async fn insert_ready(pool: &SqlitePool, value: &NewAttachment<'_>) -> Result<()> {
    sqlx::query(
        "INSERT INTO attachments
            (id, user_id, filename, content_type, size_bytes, s3_key, created_at,
             status, checksum_sha256, backend, expires_at, scope_kind, scope_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready', $8, $9, $10, $11, $12)",
    )
    .bind(value.id)
    .bind(value.user_id)
    .bind(value.filename)
    .bind(value.content_type)
    .bind(value.size_bytes as i64)
    .bind(value.storage_key)
    .bind(value.created_at)
    .bind(value.checksum_sha256)
    .bind(value.backend)
    .bind(value.expires_at)
    .bind(value.scope_kind)
    .bind(value.scope_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn insert_attachment(
    pool: &SqlitePool,
    id: &str,
    user_id: &str,
    filename: &str,
    content_type: &str,
    size_bytes: usize,
    storage_key: &str,
    created_at: i64,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO attachments
            (id, user_id, filename, content_type, size_bytes, s3_key, created_at,
             status, backend, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready', 's3', $8)",
    )
    .bind(id)
    .bind(user_id)
    .bind(filename)
    .bind(content_type)
    .bind(size_bytes as i64)
    .bind(storage_key)
    .bind(created_at)
    .bind(created_at + 86_400_000)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn bind_attachments(
    pool: &SqlitePool,
    message_id: &str,
    attachment_ids: &[String],
) -> Result<()> {
    for id in attachment_ids {
        sqlx::query("UPDATE attachments SET message_id = $1, expires_at = NULL WHERE id = $2")
            .bind(message_id)
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn bind_owned(
    conn: &mut SqliteConnection,
    message_id: &str,
    attachment_ids: &[String],
    owner_id: &str,
    scope_kind: &str,
    scope_id: &str,
    max_count: usize,
) -> Result<()> {
    if attachment_ids.len() > max_count {
        bail!("uma mensagem aceita no maximo {max_count} anexos");
    }
    let unique: std::collections::HashSet<&str> =
        attachment_ids.iter().map(String::as_str).collect();
    if unique.len() != attachment_ids.len() {
        bail!("o mesmo anexo foi informado mais de uma vez");
    }

    for id in attachment_ids {
        let changed = sqlx::query(
            "UPDATE attachments
                SET message_id = $1, expires_at = NULL
              WHERE id = $2
                AND user_id = $3
                AND status = 'ready'
                AND message_id IS NULL
                AND (scope_kind = $4 OR scope_kind IS NULL)
                AND (scope_id = $5 OR scope_id IS NULL)",
        )
        .bind(message_id)
        .bind(id)
        .bind(owner_id)
        .bind(scope_kind)
        .bind(scope_id)
        .execute(&mut *conn)
        .await?
        .rows_affected();
        if changed != 1 {
            bail!("anexo invalido, ja usado ou pertencente a outra conversa");
        }
    }
    Ok(())
}

#[derive(sqlx::FromRow)]
struct RawAttachment {
    id: String,
    filename: String,
    content_type: String,
    size_bytes: i64,
    description: Option<String>,
    duration_ms: Option<i64>,
    waveform: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
    backend: String,
}

pub async fn list_for_message(
    pool: &SqlitePool,
    message_id: &str,
    _legacy_public_base: Option<&str>,
) -> Result<Vec<Attachment>> {
    let rows: Vec<RawAttachment> = sqlx::query_as(
        "SELECT id, filename, content_type, size_bytes, description, duration_ms,
                waveform, width, height, backend
           FROM attachments
          WHERE message_id = $1 AND status = 'ready'
          ORDER BY created_at ASC",
    )
    .bind(message_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| Attachment {
            id: r.id,
            filename: r.filename,
            content_type: r.content_type,
            size_bytes: r.size_bytes as usize,
            description: r.description,
            duration_ms: r.duration_ms.map(|n| n as u64),
            waveform: r.waveform.and_then(|raw| serde_json::from_str(&raw).ok()),
            width: r.width.map(|n| n as u32),
            height: r.height.map(|n| n as u32),
            backend: r.backend,
        })
        .collect())
}

#[derive(sqlx::FromRow)]
struct RawAttachmentRecord {
    id: String,
    message_id: Option<String>,
    user_id: String,
    filename: String,
    content_type: String,
    size_bytes: i64,
    s3_key: String,
    checksum_sha256: Option<String>,
    backend: String,
    description: Option<String>,
    duration_ms: Option<i64>,
    waveform: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
    scope_kind: Option<String>,
    scope_id: Option<String>,
}

impl From<RawAttachmentRecord> for AttachmentRecord {
    fn from(r: RawAttachmentRecord) -> Self {
        Self {
            id: r.id,
            message_id: r.message_id,
            user_id: r.user_id,
            filename: r.filename,
            content_type: r.content_type,
            size_bytes: r.size_bytes as usize,
            storage_key: r.s3_key,
            checksum_sha256: r.checksum_sha256,
            backend: r.backend,
            description: r.description,
            duration_ms: r.duration_ms.map(|n| n as u64),
            waveform: r.waveform.and_then(|raw| serde_json::from_str(&raw).ok()),
            width: r.width.map(|n| n as u32),
            height: r.height.map(|n| n as u32),
            scope_kind: r.scope_kind,
            scope_id: r.scope_id,
        }
    }
}

pub async fn get(pool: &SqlitePool, id: &str) -> Result<Option<AttachmentRecord>> {
    let row: Option<RawAttachmentRecord> = sqlx::query_as(
        "SELECT id, message_id, user_id, filename, content_type, size_bytes, s3_key,
                checksum_sha256, backend, description, duration_ms, waveform, width, height,
                scope_kind, scope_id
           FROM attachments WHERE id = $1 AND status = 'ready'",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(Into::into))
}

pub async fn update_metadata(
    pool: &SqlitePool,
    id: &str,
    owner_id: &str,
    filename: Option<&str>,
    description_set: bool,
    description: Option<&str>,
    duration_ms: Option<u64>,
    waveform: Option<&[u8]>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<bool> {
    let waveform = waveform.map(serde_json::to_string).transpose()?;
    let changed = sqlx::query(
        "UPDATE attachments
            SET filename = COALESCE($3, filename),
                description = CASE WHEN $4 THEN $5 ELSE description END,
                duration_ms = COALESCE($6, duration_ms),
                waveform = COALESCE($7, waveform),
                width = COALESCE($8, width),
                height = COALESCE($9, height)
          WHERE id = $1 AND user_id = $2 AND message_id IS NULL AND status = 'ready'",
    )
    .bind(id)
    .bind(owner_id)
    .bind(filename)
    .bind(description_set)
    .bind(description)
    .bind(duration_ms.map(|value| value as i64))
    .bind(waveform)
    .bind(width.map(i64::from))
    .bind(height.map(i64::from))
    .execute(pool)
    .await?
    .rows_affected();
    Ok(changed == 1)
}

pub async fn delete_orphan(pool: &SqlitePool, id: &str, owner_id: &str) -> Result<Option<String>> {
    let key: Option<(String,)> = sqlx::query_as(
        "SELECT s3_key FROM attachments
          WHERE id = $1 AND user_id = $2 AND message_id IS NULL",
    )
    .bind(id)
    .bind(owner_id)
    .fetch_optional(pool)
    .await?;

    let Some((key,)) = key else {
        return Ok(None);
    };
    sqlx::query("DELETE FROM attachments WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(Some(key))
}

pub async fn expired_orphans(pool: &SqlitePool, now: i64) -> Result<Vec<(String, String)>> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, s3_key FROM attachments
          WHERE message_id IS NULL AND status = 'ready'
            AND expires_at IS NOT NULL AND expires_at <= $1",
    )
    .bind(now)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn delete_expired_orphan(pool: &SqlitePool, id: &str, now: i64) -> Result<bool> {
    let changed = sqlx::query(
        "DELETE FROM attachments
          WHERE id = $1 AND message_id IS NULL AND status = 'ready'
            AND expires_at IS NOT NULL AND expires_at <= $2",
    )
    .bind(id)
    .bind(now)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(changed == 1)
}

pub async fn can_access(pool: &SqlitePool, id: &str, user_id: &str) -> Result<bool> {
    let Some(record) = get(pool, id).await? else {
        return Ok(false);
    };
    if record.user_id == user_id || record.message_id.is_none() {
        return Ok(record.user_id == user_id);
    }
    let message_id = record.message_id.as_deref().unwrap_or_default();
    let channel: (bool,) = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE id = $1)",
    )
    .bind(message_id)
    .fetch_one(pool)
    .await?;

    if channel.0 {
        return Ok(true);
    }

    let conversation: Option<(String,)> = sqlx::query_as(
        "SELECT conversation_id FROM dm_messages WHERE id = $1",
    )
    .bind(message_id)
    .fetch_optional(pool)
    .await?;

    Ok(conversation
        .and_then(|(value,)| super::conversation_pair(&value))
        .is_some_and(|(a, b)| a == user_id || b == user_id))
}

pub async fn create_ticket(
    pool: &SqlitePool,
    attachment_id: &str,
    user_id: &str,
    ticket: &str,
    expires_at: i64,
) -> Result<()> {
    sqlx::query("DELETE FROM attachment_tickets WHERE expires_at <= $1")
        .bind(crate::protocol::now_ms())
        .execute(pool)
        .await?;

    sqlx::query(
        "INSERT INTO attachment_tickets (ticket, attachment_id, user_id, expires_at)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(ticket)
    .bind(attachment_id)
    .bind(user_id)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn by_ticket(
    pool: &SqlitePool,
    ticket: &str,
    now: i64,
) -> Result<Option<AttachmentRecord>> {
    let id: Option<(String,)> = sqlx::query_as(
        "SELECT attachment_id FROM attachment_tickets WHERE ticket = $1 AND expires_at > $2",
    )
    .bind(ticket)
    .bind(now)
    .fetch_optional(pool)
    .await?;

    match id {
        Some((id,)) => get(pool, &id).await,
        None => Ok(None),
    }
}

pub async fn keys_for_message(conn: &mut SqliteConnection, message_id: &str) -> Result<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT s3_key FROM attachments WHERE message_id = $1")
        .bind(message_id)
        .fetch_all(&mut *conn)
        .await?;
    Ok(rows.into_iter().map(|(k,)| k).collect())
}

pub async fn delete_for_message(conn: &mut SqliteConnection, message_id: &str) -> Result<()> {
    sqlx::query("DELETE FROM attachments WHERE message_id = $1")
        .bind(message_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}
