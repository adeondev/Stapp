use std::path::PathBuf;

use anyhow::{Result, bail};
use clap::{Parser, Subcommand};
use stapp_server::{Config, admin, open_database, serve};

#[derive(Parser)]
#[command(name = "stapp-server", version, about)]
struct Cli {
    /// Caminho do stapp.toml.
    #[arg(long, global = true, default_value = "stapp.toml")]
    config: PathBuf,

    #[command(subcommand)]
    command: Option<Command>,

    /// Compatibilidade temporaria com `stapp-server caminho/stapp.toml`.
    #[arg(value_name = "CONFIG", hide = true)]
    legacy_config: Option<PathBuf>,
}

#[derive(Subcommand)]
enum Command {
    /// Inicia o servidor (comando padrao).
    Serve,
    /// Administra as contas locais deste servidor.
    User {
        #[command(subcommand)]
        command: UserCommand,
    },
}

#[derive(Subcommand)]
enum UserCommand {
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

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "stapp_server=info,tower_http=warn".into()),
        )
        .compact()
        .init();

    let cli = Cli::parse();
    let config_path = cli.legacy_config.as_ref().unwrap_or(&cli.config);
    let config = Config::load(config_path)?;

    match cli.command {
        None | Some(Command::Serve) => serve(config).await,
        Some(Command::User { command }) => {
            let db = open_database(&config)?;
            match command {
                UserCommand::Add { username } => {
                    let password = prompt_new_password()?;
                    admin::add_user(&db, &username, &password)
                }
                UserCommand::List => admin::list_users(&db),
                UserCommand::Passwd { username } => {
                    let password = prompt_new_password()?;
                    admin::change_password(&db, &username, &password)
                }
                UserCommand::Disable { username } => admin::set_user_disabled(&db, &username, true),
                UserCommand::Enable { username } => admin::set_user_disabled(&db, &username, false),
            }
        }
    }
}

fn prompt_new_password() -> Result<String> {
    let password = rpassword::prompt_password("senha: ")?;
    let confirmation = rpassword::prompt_password("repita a senha: ")?;
    if password != confirmation {
        bail!("as senhas nao conferem");
    }
    Ok(password)
}
