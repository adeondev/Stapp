use std::path::PathBuf;

use anyhow::Result;
use stapp_server::{Config, serve};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "stapp_server=info,tower_http=warn".into()),
        )
        .compact()
        .init();

    // Primeiro argumento = caminho do stapp.toml, para rodar varios servidores
    // com configs diferentes na mesma maquina.
    let config_path: PathBuf = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "stapp.toml".into())
        .into();
    let config = Config::load(&config_path)?;

    serve(config).await
}
