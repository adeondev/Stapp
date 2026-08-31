use crate::protocol::Attachment;
use anyhow::{Result, bail};
use rusqlite::{Connection, OptionalExtension, Transaction, params};

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

pub fn insert_ready(conn: &Connection, value: &NewAttachment<'_>) -> Result<()> {
    conn.execute(
        "INSERT INTO attachments
            (id, user_id, filename, content_type, size_bytes, s3_key, created_at,
             status, checksum_sha256, backend, expires_at, scope_kind, scope_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'ready', ?8, ?9, ?10, ?11, ?12)",
        params![
            value.id,
            value.user_id,
            value.filename,
            value.content_type,
            value.size_bytes as i64,
            value.storage_key,
            value.created_at,
            value.checksum_sha256,
            value.backend,
            value.expires_at,
            value.scope_kind,
            value.scope_id,
        ],
    )?;
    Ok(())
}

/// Compatibilidade dos testes e do endpoint antigo de confirmacao.
pub fn insert_attachment(
    conn: &Connection,
    id: &str,
    user_id: &str,
    filename: &str,
    content_type: &str,
    size_bytes: usize,
    storage_key: &str,
    created_at: i64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO attachments
            (id, user_id, filename, content_type, size_bytes, s3_key, created_at,
             status, backend, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'ready', 's3', ?8)",
        params![
            id,
            user_id,
            filename,
            content_type,
            size_bytes as i64,
            storage_key,
            created_at,
            created_at + 86_400_000
        ],
    )?;
    Ok(())
}

pub fn bind_attachments(
    conn: &Connection,
    message_id: &str,
    attachment_ids: &[String],
) -> Result<()> {
    for id in attachment_ids {
        conn.execute(
            "UPDATE attachments SET message_id = ?1, expires_at = NULL WHERE id = ?2",
            params![message_id, id],
        )?;
    }
    Ok(())
}

pub fn bind_owned(
    tx: &Transaction<'_>,
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
        let changed = tx.execute(
            "UPDATE attachments
                SET message_id = ?1, expires_at = NULL
              WHERE id = ?2
                AND user_id = ?3
                AND status = 'ready'
                AND message_id IS NULL
                AND (scope_kind = ?4 OR scope_kind IS NULL)
                AND (scope_id = ?5 OR scope_id IS NULL)",
            params![message_id, id, owner_id, scope_kind, scope_id],
        )?;
        if changed != 1 {
            bail!("anexo invalido, ja usado ou pertencente a outra conversa");
        }
    }
    Ok(())
}

pub fn list_for_message(
    conn: &Connection,
    message_id: &str,
    _legacy_public_base: Option<&str>,
) -> Result<Vec<Attachment>> {
    let mut stmt = conn.prepare(
        "SELECT id, filename, content_type, size_bytes, description, duration_ms,
                waveform, width, height, backend
           FROM attachments
          WHERE message_id = ?1 AND status = 'ready'
          ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([message_id], attachment_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn attachment_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Attachment> {
    let waveform: Option<String> = row.get(6)?;
    Ok(Attachment {
        id: row.get(0)?,
        filename: row.get(1)?,
        content_type: row.get(2)?,
        size_bytes: row.get::<_, i64>(3)? as usize,
        description: row.get(4)?,
        duration_ms: row.get::<_, Option<i64>>(5)?.map(|n| n as u64),
        waveform: waveform.and_then(|raw| serde_json::from_str(&raw).ok()),
        width: row.get::<_, Option<i64>>(7)?.map(|n| n as u32),
        height: row.get::<_, Option<i64>>(8)?.map(|n| n as u32),
        backend: row.get(9)?,
    })
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<AttachmentRecord>> {
    conn.query_row(
        "SELECT id, message_id, user_id, filename, content_type, size_bytes, s3_key,
                checksum_sha256, backend, description, duration_ms, waveform, width, height,
                scope_kind, scope_id
           FROM attachments WHERE id = ?1 AND status = 'ready'",
        [id],
        record_from_row,
    )
    .optional()
    .map_err(Into::into)
}

fn record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AttachmentRecord> {
    let waveform: Option<String> = row.get(11)?;
    Ok(AttachmentRecord {
        id: row.get(0)?,
        message_id: row.get(1)?,
        user_id: row.get(2)?,
        filename: row.get(3)?,
        content_type: row.get(4)?,
        size_bytes: row.get::<_, i64>(5)? as usize,
        storage_key: row.get(6)?,
        checksum_sha256: row.get(7)?,
        backend: row.get(8)?,
        description: row.get(9)?,
        duration_ms: row.get::<_, Option<i64>>(10)?.map(|n| n as u64),
        waveform: waveform.and_then(|raw| serde_json::from_str(&raw).ok()),
        width: row.get::<_, Option<i64>>(12)?.map(|n| n as u32),
        height: row.get::<_, Option<i64>>(13)?.map(|n| n as u32),
        scope_kind: row.get(14)?,
        scope_id: row.get(15)?,
    })
}

pub fn update_metadata(
    conn: &Connection,
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
    let changed = conn.execute(
        "UPDATE attachments
            SET filename = COALESCE(?3, filename),
                description = CASE WHEN ?4 THEN ?5 ELSE description END,
                duration_ms = COALESCE(?6, duration_ms),
                waveform = COALESCE(?7, waveform),
                width = COALESCE(?8, width),
                height = COALESCE(?9, height)
          WHERE id = ?1 AND user_id = ?2 AND message_id IS NULL AND status = 'ready'",
        params![
            id,
            owner_id,
            filename,
            description_set,
            description,
            duration_ms.map(|value| value as i64),
            waveform,
            width.map(i64::from),
            height.map(i64::from),
        ],
    )?;
    Ok(changed == 1)
}

pub fn delete_orphan(conn: &Connection, id: &str, owner_id: &str) -> Result<Option<String>> {
    let Some(key): Option<String> = conn
        .query_row(
            "SELECT s3_key FROM attachments
              WHERE id = ?1 AND user_id = ?2 AND message_id IS NULL",
            params![id, owner_id],
            |row| row.get(0),
        )
        .optional()?
    else {
        return Ok(None);
    };
    conn.execute("DELETE FROM attachments WHERE id = ?1", [id])?;
    Ok(Some(key))
}

pub fn expired_orphans(conn: &Connection, now: i64) -> Result<Vec<(String, String)>> {
    let mut statement = conn.prepare(
        "SELECT id, s3_key FROM attachments
          WHERE message_id IS NULL AND status = 'ready'
            AND expires_at IS NOT NULL AND expires_at <= ?1",
    )?;
    let rows = statement.query_map([now], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn delete_expired_orphan(conn: &Connection, id: &str, now: i64) -> Result<bool> {
    Ok(conn.execute(
        "DELETE FROM attachments
          WHERE id = ?1 AND message_id IS NULL AND status = 'ready'
            AND expires_at IS NOT NULL AND expires_at <= ?2",
        params![id, now],
    )? == 1)
}

pub fn can_access(conn: &Connection, id: &str, user_id: &str) -> Result<bool> {
    let Some(record) = get(conn, id)? else {
        return Ok(false);
    };
    if record.user_id == user_id || record.message_id.is_none() {
        return Ok(record.user_id == user_id);
    }
    let message_id = record.message_id.as_deref().unwrap_or_default();
    let channel: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE id = ?1)",
        [message_id],
        |row| row.get(0),
    )?;
    if channel {
        return Ok(true);
    }
    let conversation: Option<String> = conn
        .query_row(
            "SELECT conversation_id FROM dm_messages WHERE id = ?1",
            [message_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(conversation
        .and_then(|value| super::conversation_pair(&value))
        .is_some_and(|(a, b)| a == user_id || b == user_id))
}

pub fn create_ticket(
    conn: &Connection,
    attachment_id: &str,
    user_id: &str,
    ticket: &str,
    expires_at: i64,
) -> Result<()> {
    conn.execute(
        "DELETE FROM attachment_tickets WHERE expires_at <= ?1",
        [crate::protocol::now_ms()],
    )?;
    conn.execute(
        "INSERT INTO attachment_tickets (ticket, attachment_id, user_id, expires_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![ticket, attachment_id, user_id, expires_at],
    )?;
    Ok(())
}

pub fn by_ticket(conn: &Connection, ticket: &str, now: i64) -> Result<Option<AttachmentRecord>> {
    let id: Option<String> = conn
        .query_row(
            "SELECT attachment_id FROM attachment_tickets WHERE ticket = ?1 AND expires_at > ?2",
            params![ticket, now],
            |row| row.get(0),
        )
        .optional()?;
    id.map(|id| get(conn, &id)).transpose().map(Option::flatten)
}

pub fn keys_for_message(conn: &Connection, message_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT s3_key FROM attachments WHERE message_id = ?1")?;
    let rows = stmt.query_map([message_id], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn delete_for_message(conn: &Connection, message_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM attachments WHERE message_id = ?1",
        [message_id],
    )?;
    Ok(())
}
