//! Regras de administracao de contas.
//!
//! Nenhuma funcao daqui imprime: todas devolvem o resultado para quem chamou
//! formatar. Hoje quem chama e o subcomando `user`; amanha pode ser um painel.

use anyhow::{Result, bail};

use crate::auth::{hash_password_sync, validate_username};
use crate::storage::{Account, CreateAccountError, Db};

const USERNAME_INVALIDO: &str =
    "username invalido: use de 3 a 24 letras, numeros, ponto, hifen ou sublinhado";

/// Cria a conta e devolve o username como sera exibido.
pub async fn add_user(db: &Db, username: &str, password: &str) -> Result<String> {
    let username = validate_username(username).ok_or_else(|| anyhow::anyhow!(USERNAME_INVALIDO))?;
    let hash = hash_password_sync(password)?;
    match db.create_account(username.display.clone(), username.key, hash).await {
        Ok(_) => Ok(username.display),
        Err(CreateAccountError::UsernameTaken) => bail!("esse username ja esta em uso"),
        Err(CreateAccountError::Other(error)) => Err(error),
    }
}

/// Revoga as sessoes persistentes. Como CLI e servidor sao processos separados,
/// conexoes WebSocket ja autenticadas permanecem ate cair ou o servidor reiniciar.
pub async fn change_password(db: &Db, username: &str, password: &str) -> Result<String> {
    let username = validate_username(username).ok_or_else(|| anyhow::anyhow!(USERNAME_INVALIDO))?;
    let hash = hash_password_sync(password)?;
    if !db.update_password(&username.key, &hash).await? {
        bail!("conta nao encontrada");
    }
    Ok(username.display)
}

/// Desativar revoga sessoes persistentes e impede novas autenticacoes. A CLI nao
/// consegue expulsar uma conexao WebSocket viva de outro processo imediatamente.
pub async fn set_user_disabled(db: &Db, username: &str, disabled: bool) -> Result<String> {
    let username = validate_username(username).ok_or_else(|| anyhow::anyhow!(USERNAME_INVALIDO))?;
    if !db.set_disabled(&username.key, disabled).await? {
        bail!("conta nao encontrada");
    }
    Ok(username.display)
}

pub async fn list_users(db: &Db) -> Result<Vec<Account>> {
    db.list_accounts().await
}

#[cfg(test)]
mod tests;
