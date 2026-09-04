use super::*;
use crate::test_support::TestDir;

#[tokio::test]
async fn manages_accounts_without_exposing_plaintext_passwords() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).await.unwrap();
    assert_eq!(
        add_user(&db, "Daniel", "senha inicial segura").await.unwrap(),
        "Daniel"
    );

    let account = db.account_by_key("daniel").await.unwrap().unwrap();
    assert_ne!(account.password_hash, "senha inicial segura");

    change_password(&db, "daniel", "uma senha nova segura").await.unwrap();
    set_user_disabled(&db, "DANIEL", true).await.unwrap();
    assert!(
        db.account_by_key("daniel")
            .await
            .unwrap()
            .unwrap()
            .disabled_at
            .is_some()
    );
}

#[tokio::test]
async fn rejeita_username_invalido_e_conta_inexistente() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).await.unwrap();
    assert!(add_user(&db, "??", "senha inicial segura").await.is_err());
    assert!(change_password(&db, "ninguem", "outra senha segura").await.is_err());
    assert!(set_user_disabled(&db, "ninguem", true).await.is_err());
    assert!(list_users(&db).await.unwrap().is_empty());
}
