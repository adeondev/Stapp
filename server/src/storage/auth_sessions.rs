//! Refresh tokens persistentes. O banco guarda somente hashes; o segredo cru
//! existe no cliente e durante a resposta HTTP que o criou.

use anyhow::Result;
use sqlx::FromRow;

use super::Db;
use crate::protocol::now_ms;

#[derive(Debug, Clone, FromRow)]
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
    pub async fn create_refresh_session(
        &self,
        id: &str,
        user_id: &str,
        token_hash: &str,
        remember: bool,
        expires_at: i64,
    ) -> Result<()> {
        let now = now_ms();
        sqlx::query(
            "INSERT INTO auth_sessions
                (id, user_id, token_hash, previous_token_hash, previous_valid_until,
                 remember, created_at, last_used_at, expires_at, revoked_at)
             VALUES ($1, $2, $3, NULL, NULL, $4, $5, $5, $6, NULL)",
        )
        .bind(id)
        .bind(user_id)
        .bind(token_hash)
        .bind(remember)
        .bind(now)
        .bind(expires_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn refresh_session(&self, id: &str) -> Result<Option<RefreshSession>> {
        let session = sqlx::query_as::<_, RefreshSession>(
            "SELECT id, user_id, token_hash, previous_token_hash,
                    previous_valid_until, remember, expires_at, revoked_at
               FROM auth_sessions WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(session)
    }

    pub async fn rotate_refresh_session(
        &self,
        id: &str,
        expected_hash: &str,
        new_hash: &str,
        grace_until: i64,
    ) -> Result<Option<RotatedRefresh>> {
        let now = now_ms();
        let mut tx = self.pool.begin().await?;

        let session: Option<(String, String, Option<String>, Option<i64>, bool, i64, Option<i64>)> =
            sqlx::query_as(
                "SELECT user_id, token_hash, previous_token_hash,
                        previous_valid_until, remember, expires_at, revoked_at
                   FROM auth_sessions WHERE id = $1",
            )
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;

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

        sqlx::query(
            "UPDATE auth_sessions
                SET previous_token_hash = token_hash,
                    previous_valid_until = $2,
                    token_hash = $3,
                    last_used_at = $4
              WHERE id = $1",
        )
        .bind(id)
        .bind(grace_until)
        .bind(new_hash)
        .bind(now)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(Some(RotatedRefresh {
            user_id,
            remember,
            expires_at,
        }))
    }

    pub async fn revoke_refresh_session(&self, id: &str) -> Result<()> {
        sqlx::query("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE id = $1")
            .bind(id)
            .bind(now_ms())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn revoke_user_sessions(&self, user_id: &str) -> Result<()> {
        sqlx::query("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE user_id = $1")
            .bind(user_id)
            .bind(now_ms())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
