//! Consultas de conta.

use anyhow::Result;
use rusqlite::{ErrorCode, Row};
use uuid::Uuid;

use super::Db;
use crate::protocol::now_ms;

#[derive(Debug, Clone)]
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
    pub fn account_by_key(&self, username_key: &str) -> Result<Option<Account>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUNAS} FROM users WHERE username_key = ?1"
        ))?;
        let mut rows = stmt.query([username_key])?;
        match rows.next()? {
            Some(row) => Ok(Some(read_account(row)?)),
            None => Ok(None),
        }
    }

    pub fn account_by_id(&self, id: &str) -> Result<Option<Account>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!("SELECT {COLUNAS} FROM users WHERE id = ?1"))?;
        let mut rows = stmt.query([id])?;
        match rows.next()? {
            Some(row) => Ok(Some(read_account(row)?)),
            None => Ok(None),
        }
    }

    pub fn create_account(
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

        let conn = self.conn.lock().unwrap();
        let result = conn.execute(
            "INSERT INTO users (id, username, username_key, password_hash, created_at, disabled_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
            (
                &account.id,
                &account.username,
                &account.username_key,
                &account.password_hash,
                account.created_at,
            ),
        );

        match result {
            Ok(_) => {
                conn.execute(
                    "INSERT OR IGNORE INTO user_privacy (user_id, allow_member_dms) VALUES (?1, 1)",
                    [&account.id],
                )
                .map_err(|error| CreateAccountError::Other(error.into()))?;
                Ok(account)
            }
            Err(rusqlite::Error::SqliteFailure(error, _))
                if error.code == ErrorCode::ConstraintViolation =>
            {
                Err(CreateAccountError::UsernameTaken)
            }
            Err(error) => Err(CreateAccountError::Other(error.into())),
        }
    }

    pub fn list_accounts(&self) -> Result<Vec<Account>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUNAS} FROM users ORDER BY username_key"
        ))?;
        let rows = stmt.query_map([], read_account)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn update_password(&self, username_key: &str, password_hash: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE users SET password_hash = ?1 WHERE username_key = ?2",
            (password_hash, username_key),
        )? > 0;
        if changed {
            conn.execute(
                "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?2)
                  WHERE user_id = (SELECT id FROM users WHERE username_key = ?1)",
                (username_key, now_ms()),
            )?;
        }
        Ok(changed)
    }

    pub fn set_disabled(&self, username_key: &str, disabled: bool) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let disabled_at = disabled.then(now_ms);
        let changed = conn.execute(
            "UPDATE users SET disabled_at = ?1 WHERE username_key = ?2",
            (disabled_at, username_key),
        )? > 0;
        if changed && disabled {
            conn.execute(
                "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?2)
                  WHERE user_id = (SELECT id FROM users WHERE username_key = ?1)",
                (username_key, now_ms()),
            )?;
        }
        Ok(changed)
    }
}

fn read_account(row: &Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get(0)?,
        username: row.get(1)?,
        username_key: row.get(2)?,
        password_hash: row.get(3)?,
        created_at: row.get(4)?,
        disabled_at: row.get(5)?,
    })
}
