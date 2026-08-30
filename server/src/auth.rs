use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use argon2::password_hash::{
    PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng,
};
use argon2::{Algorithm, Argon2, Params, Version};
use tokio::sync::Semaphore;

use crate::db::{Account, CreateAccountError, Db};

const MIN_PASSWORD_CHARS: usize = 12;
const MAX_PASSWORD_CHARS: usize = 128;
const LOGIN_STATE_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_HASH_JOBS: usize = 2;
const REGISTRATION_WINDOW: Duration = Duration::from_secs(60);
const REGISTRATION_ATTEMPTS: usize = 5;

#[derive(Debug, Clone)]
pub struct ValidUsername {
    pub display: String,
    pub key: String,
}

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

struct LoginFailure {
    failures: u32,
    next_allowed: Instant,
    last_seen: Instant,
}

pub struct AuthService {
    hashes: Arc<Semaphore>,
    dummy_hash: String,
    login_failures: Mutex<HashMap<String, LoginFailure>>,
    registration_attempts: Mutex<HashMap<IpAddr, VecDeque<Instant>>>,
}

impl AuthService {
    pub fn new() -> Result<Self> {
        Ok(Self {
            hashes: Arc::new(Semaphore::new(MAX_HASH_JOBS)),
            dummy_hash: hash_password_sync("esta-senha-nao-e-de-ninguem")?,
            login_failures: Mutex::new(HashMap::new()),
            registration_attempts: Mutex::new(HashMap::new()),
        })
    }

    pub async fn login(
        &self,
        db: &Db,
        username: &str,
        password: String,
    ) -> std::result::Result<Account, LoginError> {
        let key = username.trim().to_ascii_lowercase();
        if let Some(wait) = self.login_wait(&key) {
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
                self.clear_login_failure(&key);
                Ok(account)
            }
            _ => {
                self.record_login_failure(key);
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
        if let Some(wait) = self.record_registration_attempt(origin) {
            return Err(RegisterError::RateLimited(wait));
        }
        let username = validate_username(username).ok_or(RegisterError::InvalidUsername)?;
        validate_password(&password).map_err(|_| RegisterError::InvalidPassword)?;
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
            verify_password_sync(&password, &stored)
        })
        .await
        .unwrap_or(false)
    }

    fn login_wait(&self, key: &str) -> Option<Duration> {
        let now = Instant::now();
        let mut failures = self.login_failures.lock().unwrap();
        failures.retain(|_, entry| now.duration_since(entry.last_seen) < LOGIN_STATE_TTL);
        failures
            .get(key)
            .and_then(|entry| entry.next_allowed.checked_duration_since(now))
    }

    fn record_login_failure(&self, key: String) {
        let now = Instant::now();
        let mut failures = self.login_failures.lock().unwrap();
        let entry = failures.entry(key).or_insert(LoginFailure {
            failures: 0,
            next_allowed: now,
            last_seen: now,
        });
        entry.failures = entry.failures.saturating_add(1);
        let seconds = 1u64
            .checked_shl(entry.failures.saturating_sub(1))
            .unwrap_or(30)
            .min(30);
        entry.next_allowed = now + Duration::from_secs(seconds);
        entry.last_seen = now;
    }

    fn clear_login_failure(&self, key: &str) {
        self.login_failures.lock().unwrap().remove(key);
    }

    fn record_registration_attempt(&self, origin: IpAddr) -> Option<Duration> {
        let now = Instant::now();
        let mut attempts = self.registration_attempts.lock().unwrap();
        // PROTOTYPE: a origem e o peer TCP. Atrás de um proxy local todos compartilham
        // este limite; uma futura configuracao de proxies confiaveis deve recuperar o IP real.
        let entries = attempts.entry(origin).or_default();
        while entries
            .front()
            .is_some_and(|at| now.duration_since(*at) >= REGISTRATION_WINDOW)
        {
            entries.pop_front();
        }
        if entries.len() >= REGISTRATION_ATTEMPTS {
            return entries
                .front()
                .and_then(|at| (*at + REGISTRATION_WINDOW).checked_duration_since(now));
        }
        entries.push_back(now);
        None
    }
}

pub fn validate_username(raw: &str) -> Option<ValidUsername> {
    let display = raw.trim();
    if !(3..=24).contains(&display.len())
        || !display
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
    {
        return None;
    }
    Some(ValidUsername {
        display: display.into(),
        key: display.to_ascii_lowercase(),
    })
}

pub fn validate_password(password: &str) -> std::result::Result<(), ()> {
    let chars = password.chars().count();
    if (MIN_PASSWORD_CHARS..=MAX_PASSWORD_CHARS).contains(&chars) {
        Ok(())
    } else {
        Err(())
    }
}

pub fn hash_password_sync(password: &str) -> Result<String> {
    validate_password(password).map_err(|_| {
        anyhow::anyhow!(
            "a senha precisa ter entre {MIN_PASSWORD_CHARS} e {MAX_PASSWORD_CHARS} caracteres"
        )
    })?;
    let salt = SaltString::generate(&mut OsRng);
    argon2_config()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| anyhow::anyhow!("falha gerando hash: {error}"))
}

fn verify_password_sync(password: &str, stored: &str) -> bool {
    let Ok(hash) = PasswordHash::new(stored) else {
        return false;
    };
    argon2_config()
        .verify_password(password.as_bytes(), &hash)
        .is_ok()
}

fn argon2_config() -> Argon2<'static> {
    let params = Params::new(19_456, 2, 1, None).expect("parametros Argon2id validos");
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::test_support::TestDir;

    #[test]
    fn validates_and_normalizes_usernames() {
        let username = validate_username("  Da.Niel-1  ").unwrap();
        assert_eq!(username.display, "Da.Niel-1");
        assert_eq!(username.key, "da.niel-1");
        assert!(validate_username("ab").is_none());
        assert!(validate_username("daniel espaço").is_none());
        assert!(validate_username(&"a".repeat(25)).is_none());
    }

    #[test]
    fn hashes_passwords_without_storing_the_secret() {
        let password = "uma senha bem comprida";
        let hash = hash_password_sync(password).unwrap();
        assert!(hash.starts_with("$argon2id$v=19$m=19456,t=2,p=1$"));
        assert!(!hash.contains(password));
        assert!(verify_password_sync(password, &hash));
        assert!(!verify_password_sync("outra senha comprida", &hash));
    }

    #[test]
    fn password_policy_counts_unicode_characters() {
        assert!(validate_password("frase-segura").is_ok());
        assert!(validate_password("curta").is_err());
        assert!(validate_password(&"ç".repeat(128)).is_ok());
        assert!(validate_password(&"ç".repeat(129)).is_err());
    }

    #[tokio::test]
    async fn registers_and_authenticates_case_insensitively() {
        let dir = TestDir::new();
        let db = Db::open(&dir.database()).unwrap();
        let auth = AuthService::new().unwrap();
        let account = auth
            .register(
                &db,
                "127.0.0.1".parse().unwrap(),
                "Daniel",
                "uma senha realmente segura".into(),
            )
            .await
            .unwrap();
        let logged = auth
            .login(&db, "DANIEL", "uma senha realmente segura".into())
            .await
            .unwrap();
        assert_eq!(logged.id, account.id);

        db.set_disabled("daniel", true).unwrap();
        assert!(matches!(
            auth.login(&db, "daniel", "uma senha realmente segura".into())
                .await,
            Err(LoginError::InvalidCredentials)
        ));
    }

    #[tokio::test]
    async fn throttles_login_and_registration_attempts() {
        let dir = TestDir::new();
        let db = Db::open(&dir.database()).unwrap();
        let auth = AuthService::new().unwrap();
        assert!(matches!(
            auth.login(&db, "ninguém", "senha errada comprida".into())
                .await,
            Err(LoginError::InvalidCredentials)
        ));
        assert!(matches!(
            auth.login(&db, "ninguém", "senha errada comprida".into())
                .await,
            Err(LoginError::RateLimited(_))
        ));

        let origin = "127.0.0.2".parse().unwrap();
        for _ in 0..REGISTRATION_ATTEMPTS {
            assert!(matches!(
                auth.register(&db, origin, "x", "senha de registro segura".into())
                    .await,
                Err(RegisterError::InvalidUsername)
            ));
        }
        assert!(matches!(
            auth.register(&db, origin, "x", "senha de registro segura".into())
                .await,
            Err(RegisterError::RateLimited(_))
        ));
    }
}
