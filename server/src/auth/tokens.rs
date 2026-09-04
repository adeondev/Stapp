//! Tokens opacos de acesso e refresh.

use std::collections::HashMap;
use std::sync::Mutex;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::protocol::now_ms;
use crate::storage::{Account, Db};

const ACCESS_TTL_MS: i64 = 15 * 60 * 1000;
const REFRESH_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const REFRESH_GRACE_MS: i64 = 30 * 1000;

#[derive(Clone)]
struct AccessGrant {
    user_id: String,
    expires_at: i64,
}

pub struct TokenService {
    access: Mutex<HashMap<String, AccessGrant>>,
}

pub struct IssuedAccess {
    pub token: String,
    pub expires_at: i64,
}

pub struct IssuedRefresh {
    pub token: String,
    pub remember: bool,
    pub expires_at: i64,
}

impl TokenService {
    pub fn new() -> Self {
        Self {
            access: Mutex::new(HashMap::new()),
        }
    }

    pub fn issue_access(&self, account: &Account) -> IssuedAccess {
        let token = random_secret();
        let expires_at = now_ms() + ACCESS_TTL_MS;
        let mut access = self.access.lock().unwrap();
        access.retain(|_, grant| grant.expires_at > now_ms());
        access.insert(
            digest(&token),
            AccessGrant {
                user_id: account.id.clone(),
                expires_at,
            },
        );
        IssuedAccess { token, expires_at }
    }

    pub async fn verify_access(&self, db: &Db, raw: &str) -> Option<Account> {
        let key = digest(raw);
        let grant = {
            let mut access = self.access.lock().unwrap();
            access.retain(|_, grant| grant.expires_at > now_ms());
            access.get(&key).cloned()
        }?;
        db.account_by_id(&grant.user_id)
            .await
            .ok()
            .flatten()
            .filter(|account| account.disabled_at.is_none())
    }

    pub async fn create_refresh(
        &self,
        db: &Db,
        account: &Account,
        remember: bool,
    ) -> anyhow::Result<IssuedRefresh> {
        let id = Uuid::new_v4().to_string();
        let secret = random_secret();
        let expires_at = now_ms() + REFRESH_TTL_MS;
        db.create_refresh_session(&id, &account.id, &digest(&secret), remember, expires_at).await?;
        Ok(IssuedRefresh {
            token: format!("{id}.{secret}"),
            remember,
            expires_at,
        })
    }

    pub async fn rotate_refresh(
        &self,
        db: &Db,
        raw: &str,
    ) -> anyhow::Result<Option<(Account, IssuedRefresh)>> {
        let Some((id, secret)) = raw.split_once('.') else {
            return Ok(None);
        };
        let Some(stored) = db.refresh_session(id).await? else {
            return Ok(None);
        };
        let candidate = digest(secret);
        let current_matches = secure_eq(&stored.token_hash, &candidate);
        let previous_matches = stored
            .previous_token_hash
            .as_deref()
            .is_some_and(|previous| secure_eq(previous, &candidate))
            && stored
                .previous_valid_until
                .is_some_and(|until| until >= now_ms());
        if stored.revoked_at.is_some()
            || stored.expires_at <= now_ms()
            || (!current_matches && !previous_matches)
        {
            return Ok(None);
        }
        let next_secret = random_secret();
        let rotated = db.rotate_refresh_session(
            id,
            &candidate,
            &digest(&next_secret),
            now_ms() + REFRESH_GRACE_MS,
        ).await?;
        let Some(rotated) = rotated else {
            return Ok(None);
        };
        let Some(account) = db.account_by_id(&rotated.user_id).await? else {
            return Ok(None);
        };
        if account.disabled_at.is_some() {
            db.revoke_refresh_session(id).await?;
            return Ok(None);
        }
        Ok(Some((
            account,
            IssuedRefresh {
                token: format!("{id}.{next_secret}"),
                remember: rotated.remember,
                expires_at: rotated.expires_at,
            },
        )))
    }
}

pub fn refresh_id(raw: &str) -> Option<&str> {
    let (id, _) = raw.split_once('.')?;
    (!id.is_empty()).then_some(id)
}

fn random_secret() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn digest(raw: &str) -> String {
    let bytes = Sha256::digest(raw.as_bytes());
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn secure_eq(a: &str, b: &str) -> bool {
    a.as_bytes().ct_eq(b.as_bytes()).into()
}
