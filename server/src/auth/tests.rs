use super::credentials::{validate_password, verify_password_sync};
use super::throttle::{HTTP_ATTEMPTS, REGISTRATION_ATTEMPTS};
use super::*;
use crate::storage::Db;
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

#[test]
fn throttles_http_bursts_per_origin() {
    let auth = AuthService::new().unwrap();
    let origin = "127.0.0.3".parse().unwrap();
    for _ in 0..HTTP_ATTEMPTS {
        assert!(auth.http_wait(origin).is_none());
    }
    assert!(auth.http_wait(origin).is_some());
}
