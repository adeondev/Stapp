use anyhow::{Result, bail};

use crate::auth::{hash_password_sync, validate_username};
use crate::db::{CreateAccountError, Db};

pub fn add_user(db: &Db, username: &str, password: &str) -> Result<()> {
    let username = validate_username(username).ok_or_else(|| {
        anyhow::anyhow!(
            "username invalido: use de 3 a 24 letras, numeros, ponto, hifen ou sublinhado"
        )
    })?;
    let hash = hash_password_sync(password)?;
    match db.create_account(username.display.clone(), username.key, hash) {
        Ok(_) => {
            println!("conta \"{}\" criada", username.display);
            Ok(())
        }
        Err(CreateAccountError::UsernameTaken) => bail!("esse username ja esta em uso"),
        Err(CreateAccountError::Other(error)) => Err(error),
    }
}

pub fn change_password(db: &Db, username: &str, password: &str) -> Result<()> {
    let username =
        validate_username(username).ok_or_else(|| anyhow::anyhow!("username invalido"))?;
    let hash = hash_password_sync(password)?;
    if !db.update_password(&username.key, &hash)? {
        bail!("conta nao encontrada");
    }
    // PROTOTYPE: CLI e servidor sao processos separados. A senha nova vale na
    // proxima autenticacao; sessoes existentes so caem ao desconectar ou reiniciar.
    println!("senha de \"{}\" atualizada", username.display);
    Ok(())
}

pub fn set_user_disabled(db: &Db, username: &str, disabled: bool) -> Result<()> {
    let username =
        validate_username(username).ok_or_else(|| anyhow::anyhow!("username invalido"))?;
    if !db.set_disabled(&username.key, disabled)? {
        bail!("conta nao encontrada");
    }
    // PROTOTYPE: nao existe canal administrativo para expulsar uma sessao viva.
    // FUTURE: um painel/evento interno podera revogar as sessoes imediatamente.
    println!(
        "conta \"{}\" {} — sessoes atuais permanecem ate desconectar",
        username.display,
        if disabled { "desativada" } else { "reativada" }
    );
    Ok(())
}

pub fn list_users(db: &Db) -> Result<()> {
    let accounts = db.list_accounts()?;
    if accounts.is_empty() {
        println!("nenhuma conta criada");
        return Ok(());
    }
    for account in accounts {
        println!(
            "{}\t{}\t{}",
            account.username,
            if account.disabled_at.is_some() {
                "desativada"
            } else {
                "ativa"
            },
            account.id
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestDir;

    #[test]
    fn manages_accounts_without_exposing_plaintext_passwords() {
        let dir = TestDir::new();
        let db = Db::open(&dir.database()).unwrap();
        add_user(&db, "Daniel", "senha inicial segura").unwrap();
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
}
