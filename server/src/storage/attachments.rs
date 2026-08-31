use anyhow::Result;
use rusqlite::{params, Connection};
use crate::protocol::Attachment;

pub fn insert_attachment(
    conn: &Connection,
    id: &str,
    user_id: &str,
    filename: &str,
    content_type: &str,
    size_bytes: usize,
    s3_key: &str,
    created_at: i64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO attachments (id, user_id, filename, content_type, size_bytes, s3_key, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, user_id, filename, content_type, size_bytes as i64, s3_key, created_at],
    )?;
    Ok(())
}

pub fn bind_attachments(conn: &Connection, message_id: &str, attachment_ids: &[String]) -> Result<()> {
    for id in attachment_ids {
        conn.execute(
            "UPDATE attachments SET message_id = ?1 WHERE id = ?2",
            params![message_id, id],
        )?;
    }
    Ok(())
}

pub fn list_for_message(conn: &Connection, message_id: &str, public_base: Option<&str>) -> Result<Vec<Attachment>> {
    let mut stmt = conn.prepare(
        "SELECT id, filename, content_type, size_bytes, s3_key
         FROM attachments
         WHERE message_id = ?1
         ORDER BY created_at ASC",
    )?;

    let rows = stmt.query_map([message_id], |row| {
        let id: String = row.get(0)?;
        let filename: String = row.get(1)?;
        let content_type: String = row.get(2)?;
        let size_bytes: i64 = row.get(3)?;
        let s3_key: String = row.get(4)?;

        let url = if let Some(base) = public_base {
            format!("{}/{}", base.trim_end_matches('/'), s3_key)
        } else {
            format!("/attachments/files/{}", s3_key)
        };

        Ok(Attachment {
            id,
            filename,
            content_type,
            size_bytes: size_bytes as usize,
            url,
        })
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}
/// As chaves S3 dos anexos desta mensagem.
///
/// Precisa ser lida **antes** do delete: depois do commit a linha some e o
/// objeto ficaria no bucket sem nenhum ponteiro para alguem achar.
pub fn keys_for_message(conn: &Connection, message_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT s3_key FROM attachments WHERE message_id = ?1")?;
    let linhas = stmt.query_map([message_id], |row| row.get::<_, String>(0))?;
    Ok(linhas.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn delete_for_message(conn: &Connection, message_id: &str) -> Result<()> {
    conn.execute("DELETE FROM attachments WHERE message_id = ?1", [message_id])?;
    Ok(())
}
