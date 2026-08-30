use super::*;
use crate::test_support::TestDir;

#[test]
fn manages_accounts_without_exposing_plaintext_passwords() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).unwrap();
    assert_eq!(add_user(&db, "Daniel", "senha inicial segura").unwrap(), "Daniel");

    let account = db.account_by_key("daniel").unwrap().unwrap();
    assert_ne!(account.password_hash, "senha inicial segura");

    change_password(&db, "daniel", "uma senha nova segura").unwrap();
    set_user_disabled(&db, "DANIEL", true).unwrap();
    assert!(
        db.account_by_key("daniel")
            .unwrap()
            .unwrap()
            .disabled_at
            .is_some()
    );
}

#[test]
fn rejeita_username_invalido_e_conta_inexistente() {
    let dir = TestDir::new();
    let db = Db::open(&dir.database()).unwrap();
    assert!(add_user(&db, "??", "senha inicial segura").is_err());
    assert!(change_password(&db, "ninguem", "outra senha segura").is_err());
    assert!(set_user_disabled(&db, "ninguem", true).is_err());
    assert!(list_users(&db).unwrap().is_empty());
}
