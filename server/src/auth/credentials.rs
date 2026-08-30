//! Regras de username e senha, e o hash Argon2id.
//!
//! Tudo aqui e sincrono e puro — nao toca banco nem rede. O
//! [`super::AuthService`] e quem tira o hash da thread do runtime.

use anyhow::Result;
use argon2::password_hash::{
    PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng,
};
use argon2::{Algorithm, Argon2, Params, Version};

pub const MIN_PASSWORD_CHARS: usize = 12;
pub const MAX_PASSWORD_CHARS: usize = 128;

/// Username ja validado. `key` e a forma normalizada usada para comparar e
/// indexar; `display` e como a pessoa escreveu.
#[derive(Debug, Clone)]
pub struct ValidUsername {
    pub display: String,
    pub key: String,
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

/// Contamos caracteres, nao bytes: senha com acento nao vale menos.
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

pub fn verify_password_sync(password: &str, stored: &str) -> bool {
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
