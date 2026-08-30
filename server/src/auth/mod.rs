//! Autenticacao de contas locais.
//!
//! O servico so orquestra: consulta o freio ([`throttle`]), aplica as regras de
//! credencial ([`credentials`]) e fala com o banco. O trabalho pesado de Argon2
//! sai da thread do runtime por `spawn_blocking`, com um semaforo limitando
//! quantos hashes rodam ao mesmo tempo.

mod credentials;
mod throttle;

use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use tokio::sync::Semaphore;

use crate::storage::{Account, CreateAccountError, Db};
use throttle::Throttle;

pub use credentials::{hash_password_sync, validate_username};

/// Quantos hashes Argon2 podem rodar em paralelo. Cada um custa memoria de
/// proposito; sem teto, varias tentativas ao mesmo tempo derrubariam o servidor.
const MAX_HASH_JOBS: usize = 2;

#[derive(Debug)]
pub enum LoginError {
    InvalidCredentials,
    RateLimited(Duration),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum RegisterError {
    InvalidUsername,
    InvalidPassword,
    UsernameUnavailable,
    RateLimited(Duration),
    Internal(anyhow::Error),
}

pub struct AuthService {
    hashes: Arc<Semaphore>,
    /// Hash descartavel usado quando a conta nao existe, para que username
    /// inexistente e senha errada levem o mesmo tempo.
    dummy_hash: String,
    throttle: Throttle,
}

impl AuthService {
    pub fn new() -> Result<Self> {
        Ok(Self {
            hashes: Arc::new(Semaphore::new(MAX_HASH_JOBS)),
            dummy_hash: hash_password_sync("esta-senha-nao-e-de-ninguem")?,
            throttle: Throttle::default(),
        })
    }

    pub async fn login(
        &self,
        db: &Db,
        username: &str,
        password: String,
    ) -> std::result::Result<Account, LoginError> {
        let key = username.trim().to_ascii_lowercase();
        if let Some(wait) = self.throttle.login_wait(&key) {
            return Err(LoginError::RateLimited(wait));
        }

        let account = db.account_by_key(&key).map_err(LoginError::Internal)?;
        let stored = account
            .as_ref()
            .map(|account| account.password_hash.clone())
            .unwrap_or_else(|| self.dummy_hash.clone());
        let valid = self.verify_password(password, stored).await;

        match account {
            Some(account) if valid && account.disabled_at.is_none() => {
                self.throttle.clear_login_failure(&key);
                Ok(account)
            }
            _ => {
                self.throttle.record_login_failure(key);
                Err(LoginError::InvalidCredentials)
            }
        }
    }

    pub async fn register(
        &self,
        db: &Db,
        origin: IpAddr,
        username: &str,
        password: String,
    ) -> std::result::Result<Account, RegisterError> {
        if let Some(wait) = self.throttle.record_registration_attempt(origin) {
            return Err(RegisterError::RateLimited(wait));
        }

        let username = validate_username(username).ok_or(RegisterError::InvalidUsername)?;
        credentials::validate_password(&password).map_err(|_| RegisterError::InvalidPassword)?;
        let hash = self
            .hash_password(password)
            .await
            .map_err(RegisterError::Internal)?;

        match db.create_account(username.display, username.key, hash) {
            Ok(account) => Ok(account),
            Err(CreateAccountError::UsernameTaken) => Err(RegisterError::UsernameUnavailable),
            Err(CreateAccountError::Other(error)) => Err(RegisterError::Internal(error)),
        }
    }

    async fn hash_password(&self, password: String) -> Result<String> {
        let permit = self
            .hashes
            .clone()
            .acquire_owned()
            .await
            .context("semaforo fechado")?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            hash_password_sync(&password)
        })
        .await
        .context("tarefa de hash falhou")?
    }

    async fn verify_password(&self, password: String, stored: String) -> bool {
        let Ok(permit) = self.hashes.clone().acquire_owned().await else {
            return false;
        };
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            credentials::verify_password_sync(&password, &stored)
        })
        .await
        .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests;
