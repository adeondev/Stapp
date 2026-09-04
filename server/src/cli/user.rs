//! Subcomando `user`: administra as contas locais do servidor.

use anyhow::{Result, bail};
use clap::Subcommand;

use crate::admin;
use crate::config::Config;
use crate::storage::Db;

#[derive(Subcommand)]
pub enum UserCommand {
    /// Cria uma conta e solicita a senha sem exibi-la.
    Add { username: String },
    /// Lista username, estado e ID; nunca mostra hashes.
    List,
    /// Redefine a senha de uma conta.
    Passwd { username: String },
    /// Impede novas autenticacoes da conta.
    Disable { username: String },
    /// Reativa uma conta desativada.
    Enable { username: String },
}

pub async fn run(config: &Config, command: UserCommand) -> Result<()> {
    let db = Db::open(&config.storage.database).await?;

    match command {
        UserCommand::Add { username } => {
            let name = admin::add_user(&db, &username, &prompt_new_password()?).await?;
            println!("conta \"{name}\" criada");
        }
        UserCommand::List => {
            let accounts = admin::list_users(&db).await?;
            if accounts.is_empty() {
                println!("nenhuma conta criada");
            }
            for account in accounts {
                let estado = if account.disabled_at.is_some() {
                    "desativada"
                } else {
                    "ativa"
                };
                println!("{}\t{}\t{}", account.username, estado, account.id);
            }
        }
        UserCommand::Passwd { username } => {
            let name = admin::change_password(&db, &username, &prompt_new_password()?).await?;
            println!("senha de \"{name}\" atualizada");
        }
        UserCommand::Disable { username } => {
            let name = admin::set_user_disabled(&db, &username, true).await?;
            println!("conta \"{name}\" desativada — sessoes atuais permanecem ate desconectar");
        }
        UserCommand::Enable { username } => {
            let name = admin::set_user_disabled(&db, &username, false).await?;
            println!("conta \"{name}\" reativada");
        }
    }

    Ok(())
}

fn prompt_new_password() -> Result<String> {
    let password = rpassword::prompt_password("senha: ")?;
    let confirmation = rpassword::prompt_password("repita a senha: ")?;
    if password != confirmation {
        bail!("as senhas nao conferem");
    }
    Ok(password)
}
