//! Interface de linha de comando.
//!
//! O `main.rs` nao decide nada: ele inicializa o log e entrega o controle para
//! [`Cli::run`]. Cada subcomando mora no proprio modulo, entao adicionar um
//! `stapp-server channel ...` amanha e criar `cli/channel.rs` e uma linha em
//! [`Command`] — nada aqui cresce por causa disso.

use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};

use crate::app;
use crate::config::Config;

mod user;

#[derive(Parser)]
#[command(name = "stapp-server", version, about)]
pub struct Cli {
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
        command: user::UserCommand,
    },
}

impl Cli {
    pub async fn run(self) -> Result<()> {
        let path = self.legacy_config.as_deref().unwrap_or(&self.config);
        let config = Config::load(path)?;

        match self.command {
            None | Some(Command::Serve) => app::serve(config).await,
            Some(Command::User { command }) => user::run(&config, command),
        }
    }
}

#[cfg(test)]
mod tests;
