use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result};
use axum::Router;
use axum::extract::Request;
use axum::http::{HeaderName, HeaderValue};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::get;
use std::net::SocketAddr;
use tower_http::services::{ServeDir, ServeFile};

use crate::config::ChannelKind;
use crate::config::Config;
use crate::http;
use crate::session::AppState;
use crate::storage::Db;
use crate::ws;

/// Monta a aplicacao sem abrir uma porta, para permitir testes do Router em memoria.
pub fn build(config: Config) -> Result<Router> {
    let static_dir = config.server.static_dir.clone();
    let db = Db::open(&config.storage.database)?;
    let state = AppState::new(config, db)?;

    let mut app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(ws::handler))
        .nest("/auth", http::auth::routes());

    if let Some(dir) = static_dir.as_deref() {
        app = with_static_client(app, dir);
    }

    Ok(app
        .layer(middleware::from_fn(security_headers))
        .with_state(state))
}

async fn security_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static(
            "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' http: https: ws: wss:",
        ),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("microphone=(self), camera=(), geolocation=()"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("cross-origin-opener-policy"),
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        HeaderName::from_static("cross-origin-resource-policy"),
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
    response
}

/// Monta a aplicacao e a serve ate o processo receber Ctrl+C.
pub async fn serve(config: Config) -> Result<()> {
    let addr = config.addr();
    let name = config.server.name.clone();
    let database = config.storage.database.clone();
    let channels = config.channels.clone();
    let max_peers = config.voice.max_peers;
    let app = build(config)?;

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

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown())
    .await
    .context("servidor caiu")?;

    tracing::info!("ate mais");
    Ok(())
}

fn with_static_client(app: Router<Arc<AppState>>, dir: &Path) -> Router<Arc<AppState>> {
    if dir.is_dir() {
        // SPA: qualquer rota desconhecida cai no index.html.
        let index = dir.join("index.html");
        tracing::info!(dir = %dir.display(), "servindo o cliente");
        app.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)))
    } else {
        tracing::warn!(dir = %dir.display(), "static_dir nao existe, ignorando");
        app
    }
}

async fn shutdown() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("desligando...");
}
