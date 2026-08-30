//! Refresh tokens persistentes. O banco guarda somente hashes; o segredo cru
//! existe no cliente e durante a resposta HTTP que o criou.

use anyhow::Result;
use rusqlite::OptionalExtension;

use super::Db;
use crate::protocol::now_ms;

#[derive(Debug, Clone)]
pub struct RefreshSession {
    pub id: String,
    pub user_id: String,
    pub token_hash: String,
    pub previous_token_hash: Option<String>,
    pub previous_valid_until: Option<i64>,
    pub remember: bool,
    pub expires_at: i64,
    pub revoked_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct RotatedRefresh {
    pub user_id: String,
    pub remember: bool,
    pub expires_at: i64,
}

impl Db {
    pub fn create_refresh_session(
        &self,
        id: &str,
        user_id: &str,
        token_hash: &str,
        remember: bool,
        expires_at: i64,
    ) -> Result<()> {
        let now = now_ms();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO auth_sessions
                (id, user_id, token_hash, previous_token_hash, previous_valid_until,
                 remember, created_at, last_used_at, expires_at, revoked_at)
             VALUES (?1, ?2, ?3, NULL, NULL, ?4, ?5, ?5, ?6, NULL)",
            (id, user_id, token_hash, remember, now, expires_at),
        )?;
        Ok(())
    }

    pub fn refresh_session(&self, id: &str) -> Result<Option<RefreshSession>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, user_id, token_hash, previous_token_hash,
                    previous_valid_until, remember, expires_at, revoked_at
               FROM auth_sessions WHERE id = ?1",
            [id],
            |row| {
                Ok(RefreshSession {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    token_hash: row.get(2)?,
                    previous_token_hash: row.get(3)?,
                    previous_valid_until: row.get(4)?,
                    remember: row.get(5)?,
                    expires_at: row.get(6)?,
                    revoked_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn rotate_refresh_session(
        &self,
        id: &str,
        expected_hash: &str,
        new_hash: &str,
        grace_until: i64,
    ) -> Result<Option<RotatedRefresh>> {
        let now = now_ms();
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let session = tx
            .query_row(
                "SELECT user_id, token_hash, previous_token_hash,
                        previous_valid_until, remember, expires_at, revoked_at
                   FROM auth_sessions WHERE id = ?1",
                [id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, bool>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, Option<i64>>(6)?,
                    ))
                },
            )
            .optional()?;

        let Some((user_id, current, previous, previous_until, remember, expires_at, revoked)) =
            session
        else {
            return Ok(None);
        };
        let valid_current = current == expected_hash;
        let valid_previous = previous.as_deref() == Some(expected_hash)
            && previous_until.is_some_and(|until| until >= now);
        if revoked.is_some() || expires_at <= now || (!valid_current && !valid_previous) {
            return Ok(None);
        }

        tx.execute(
            "UPDATE auth_sessions
                SET previous_token_hash = token_hash,
                    previous_valid_until = ?2,
                    token_hash = ?3,
                    last_used_at = ?4
              WHERE id = ?1",
            (id, grace_until, new_hash, now),
        )?;
        tx.commit()?;
        Ok(Some(RotatedRefresh {
            user_id,
            remember,
            expires_at,
        }))
    }

    pub fn revoke_refresh_session(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?2) WHERE id = ?1",
            (id, now_ms()),
        )?;
        Ok(())
    }

    pub fn revoke_user_sessions(&self, user_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?2) WHERE user_id = ?1",
            (user_id, now_ms()),
        )?;
        Ok(())
    }
}
