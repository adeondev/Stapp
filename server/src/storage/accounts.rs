//! Consultas de conta.

use anyhow::Result;
use uuid::Uuid;

use super::Db;
use crate::protocol::now_ms;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Account {
    pub id: String,
    pub username: String,
    pub username_key: String,
    pub password_hash: String,
    pub created_at: i64,
    pub disabled_at: Option<i64>,
}

#[derive(Debug)]
pub enum CreateAccountError {
    UsernameTaken,
    Other(anyhow::Error),
}

const COLUNAS: &str = "id, username, username_key, password_hash, created_at, disabled_at";

impl Db {
    pub async fn account_by_key(&self, username_key: &str) -> Result<Option<Account>> {
        let query = format!("SELECT {COLUNAS} FROM users WHERE username_key = $1");
        let account = sqlx::query_as::<_, Account>(&query)
            .bind(username_key)
            .fetch_optional(&self.pool)
            .await?;
        Ok(account)
    }

    pub async fn account_by_id(&self, id: &str) -> Result<Option<Account>> {
        let query = format!("SELECT {COLUNAS} FROM users WHERE id = $1");
        let account = sqlx::query_as::<_, Account>(&query)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(account)
    }

    pub async fn create_account(
        &self,
        username: String,
        username_key: String,
        password_hash: String,
    ) -> std::result::Result<Account, CreateAccountError> {
        let account = Account {
            id: Uuid::new_v4().to_string(),
            username,
            username_key,
            password_hash,
            created_at: now_ms(),
            disabled_at: None,
        };

        let result = sqlx::query(
            "INSERT INTO users (id, username, username_key, password_hash, created_at, disabled_at)
             VALUES ($1, $2, $3, $4, $5, NULL)",
        )
        .bind(&account.id)
        .bind(&account.username)
        .bind(&account.username_key)
        .bind(&account.password_hash)
        .bind(account.created_at)
        .execute(&self.pool)
        .await;

        match result {
            Ok(_) => {
                sqlx::query(
                    "INSERT OR IGNORE INTO user_privacy (user_id, allow_member_dms) VALUES ($1, 1)",
                )
                .bind(&account.id)
                .execute(&self.pool)
                .await
                .map_err(|error| CreateAccountError::Other(error.into()))?;
                Ok(account)
            }
            Err(sqlx::Error::Database(error)) if error.is_unique_violation() => {
                Err(CreateAccountError::UsernameTaken)
            }
            Err(error) => Err(CreateAccountError::Other(error.into())),
        }
    }

    pub async fn list_accounts(&self) -> Result<Vec<Account>> {
        let query = format!("SELECT {COLUNAS} FROM users ORDER BY username_key");
        let accounts = sqlx::query_as::<_, Account>(&query)
            .fetch_all(&self.pool)
            .await?;
        Ok(accounts)
    }

    pub async fn update_password(&self, username_key: &str, password_hash: &str) -> Result<bool> {
        let rows = sqlx::query("UPDATE users SET password_hash = $1 WHERE username_key = $2")
            .bind(password_hash)
            .bind(username_key)
            .execute(&self.pool)
            .await?
            .rows_affected();
        let changed = rows > 0;
        if changed {
            sqlx::query(
                "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, $2)
                  WHERE user_id = (SELECT id FROM users WHERE username_key = $1)",
            )
            .bind(username_key)
            .bind(now_ms())
            .execute(&self.pool)
            .await?;
        }
        Ok(changed)
    }

    pub async fn set_disabled(&self, username_key: &str, disabled: bool) -> Result<bool> {
        let disabled_at = disabled.then(now_ms);
        let rows = sqlx::query("UPDATE users SET disabled_at = $1 WHERE username_key = $2")
            .bind(disabled_at)
            .bind(username_key)
            .execute(&self.pool)
            .await?
            .rows_affected();
        let changed = rows > 0;
        if changed && disabled {
            sqlx::query(
                "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, $2)
                  WHERE user_id = (SELECT id FROM users WHERE username_key = $1)",
            )
            .bind(username_key)
            .bind(now_ms())
            .execute(&self.pool)
            .await?;
        }
        Ok(changed)
    }
}
