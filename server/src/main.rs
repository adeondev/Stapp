mod channel;
mod config;
mod db;
mod protocol;
mod state;
mod voice;
mod ws;

use std::path::PathBuf;

use anyhow::{Context, Result};
use axum::Router;
use axum::routing::get;
use tower_http::services::{ServeDir, ServeFile};

use crate::channel::ChannelKind;
use crate::config::Config;
use crate::db::Db;
use crate::state::AppState;

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
    let config_path: PathBuf =
        std::env::args().nth(1).unwrap_or_else(|| "stapp.toml".into()).into();
    let config = Config::load(&config_path)?;
    let db = Db::open(&config.storage.database)?;

    let addr = config.addr();
    let name = config.server.name.clone();
    let database = config.storage.database.clone();
    let static_dir = config.server.static_dir.clone();
    let channels = config.channels.clone();
    let max_peers = config.voice.max_peers;

    let state = AppState::new(config, db);

    let mut app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(ws::handler));

    if let Some(dir) = &static_dir {
        if dir.is_dir() {
            // SPA: qualquer rota desconhecida cai no index.html.
            let index = dir.join("index.html");
            app = app.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)));
            tracing::info!(dir = %dir.display(), "servindo o cliente");
        } else {
            tracing::warn!(dir = %dir.display(), "static_dir nao existe, ignorando");
        }
    }

    let app = app.with_state(state);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("nao consegui escutar em {addr}"))?;

    tracing::info!("\"{name}\" no ar em http://{addr}");
    tracing::info!("banco: {}", database.display());
    for ch in &channels {
        match ch.kind {
            ChannelKind::Text => tracing::info!("  # {}", ch.name),
            ChannelKind::Voice => tracing::info!("  ) {} (ate {max_peers} na call)", ch.name),
        }
    }

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await
        .context("servidor caiu")?;

    tracing::info!("ate mais");
    Ok(())
}

async fn shutdown() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("desligando...");
}
