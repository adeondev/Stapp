use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result};
use axum::Router;
use axum::extract::Request;
use axum::http::{HeaderName, HeaderValue, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::get;
use std::net::SocketAddr;
use rustls_acme::caches::DirCache;
use rustls_acme::AcmeConfig;
use tokio_stream::StreamExt;
use tower_http::services::{ServeDir, ServeFile};

use crate::config::ChannelKind;
use crate::config::Config;
use crate::http;
use crate::services::voice;
use crate::session::AppState;
use crate::storage::Db;
use crate::ws;

/// Monta a aplicacao e o estado compartilhado sem abrir porta de rede.
pub async fn build_app(config: Config) -> Result<(Router, Arc<AppState>)> {
    voice::validate_backend(&config.voice)?;
    let static_dir = config.server.static_dir.clone();
    let db = Db::open(&config.storage.database).await?;
    let state = AppState::new(config, db)?;

    let mut app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(ws::handler))
        .nest("/auth", http::auth::routes())
        .nest("/avatars", http::avatars::routes())
        .nest("/attachments", http::attachments::routes());

    if let Some(dir) = static_dir.as_deref() {
        app = with_static_client(app, dir);
    }

    let router = app
        .layer(middleware::from_fn(security_headers))
        .with_state(state.clone());

    Ok((router, state))
}

/// Monta a aplicacao sem abrir uma porta, para permitir testes do Router em memoria.
pub async fn build(config: Config) -> Result<Router> {
    let (router, _) = build_app(config).await?;
    Ok(router)
}

async fn security_headers(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let is_media_path = path.starts_with("/attachments") || path.starts_with("/avatars");
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static(
            "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; font-src 'self' data:; media-src 'self' blob: http: https:; connect-src 'self' http: https: ws: wss:",
        ),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static(
            "microphone=(self), camera=(self), display-capture=(self), geolocation=()",
        ),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("cross-origin-opener-policy"),
        HeaderValue::from_static("same-origin"),
    );
    // Padrao restrito, mas rotas de midia (anexos e avatares) devem ter cross-origin
    // mesmo em respostas de erro (ex: 404) para evitar que o navegador bloqueie
    // com net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin quando o app roda em outra porta.
    let corp = HeaderName::from_static("cross-origin-resource-policy");
    if !headers.contains_key(&corp) {
        if is_media_path {
            headers.insert(corp, HeaderValue::from_static("cross-origin"));
        } else {
            headers.insert(corp, HeaderValue::from_static("same-origin"));
        }
    }
    if is_media_path && !headers.contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN) {
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static("*"),
        );
    }
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
    let tls_addr = config.tls_addr();
    let redirect_addr = config.http_redirect_addr();
    let is_tls = config.tls.enabled;
    let tls_port = config.tls.port;
    let tls_config = config.tls.clone();
    let name = config.server.name.clone();
    let database = config.storage.database.clone();
    let channels = config.channels.clone();
    let max_peers = config.voice.max_peers;
    let (app, state) = build_app(config).await?;

    if is_tls {
        tracing::info!("\"{name}\" no ar com TLS em https://{tls_addr}");
        if let Some(raddr) = redirect_addr {
            tracing::info!("redirecionamento HTTP -> HTTPS no ar em http://{raddr}");
        }
    } else {
        tracing::info!("\"{name}\" no ar em http://{addr}");
    }

    tracing::info!("banco: {}", database.display());
    for ch in &channels {
        match ch.kind {
            ChannelKind::Text => tracing::info!("  # {}", ch.name),
            ChannelKind::Voice => tracing::info!("  ) {} (ate {max_peers} na call)", ch.name),
        }
    }

    let handle = axum_server::Handle::new();
    let redirect_handle = if is_tls && redirect_addr.is_some() {
        Some(axum_server::Handle::new())
    } else {
        None
    };

    let shutdown_handle = handle.clone();
    let shutdown_redirect_handle = redirect_handle.clone();
    tokio::spawn(async move {
        shutdown().await;
        shutdown_handle.graceful_shutdown(Some(std::time::Duration::from_secs(5)));
        if let Some(rh) = shutdown_redirect_handle {
            rh.graceful_shutdown(Some(std::time::Duration::from_secs(5)));
        }
    });

    let make_service = app.into_make_service_with_connect_info::<SocketAddr>();

    let server_fut = async {
        if !is_tls {
            axum_server::bind(addr)
                .handle(handle)
                .serve(make_service.clone())
                .await
                .context("servidor HTTP caiu")
        } else if let (Some(cert), Some(key)) = (&tls_config.cert_file, &tls_config.key_file) {
            tracing::info!(
                cert = %cert.display(),
                key = %key.display(),
                "carregando certificados TLS manuais"
            );
            let rustls_config = axum_server::tls_rustls::RustlsConfig::from_pem_file(cert, key)
                .await
                .with_context(|| {
                    format!(
                        "falha ao carregar certificados TLS de {} e {}",
                        cert.display(),
                        key.display()
                    )
                })?;
            axum_server::bind_rustls(tls_addr, rustls_config)
                .handle(handle)
                .serve(make_service.clone())
                .await
                .context("servidor HTTPS (manual) caiu")
        } else {
            tracing::info!(
                domains = ?tls_config.domains,
                production = tls_config.production,
                cache_dir = %tls_config.cache_dir.display(),
                "configurando TLS automatico via ACME (Let's Encrypt)"
            );
            let mut acme = AcmeConfig::new(tls_config.domains.clone());
            if !tls_config.email.trim().is_empty() {
                acme = acme.contact([format!("mailto:{}", tls_config.email.trim())]);
            }
            let mut acme_state = acme
                .cache_option(Some(DirCache::new(tls_config.cache_dir.clone())))
                .directory_lets_encrypt(tls_config.production)
                .state();

            let acceptor = acme_state.axum_acceptor(acme_state.default_rustls_config());

            tokio::spawn(async move {
                loop {
                    match acme_state.next().await {
                        Some(Ok(event)) => tracing::info!(?event, "evento ACME Let's Encrypt"),
                        Some(Err(err)) => tracing::warn!(%err, "aviso/erro ACME Let's Encrypt"),
                        None => break,
                    }
                }
            });

            axum_server::bind(tls_addr)
                .handle(handle)
                .acceptor(acceptor)
                .serve(make_service)
                .await
                .context("servidor HTTPS (ACME) caiu")
        }
    };

    if let (Some(raddr), Some(rhandle)) = (redirect_addr, redirect_handle) {
        let redirect_app = redirect_to_https_app(tls_port);
        let redirect_fut = axum_server::bind(raddr)
            .handle(rhandle)
            .serve(redirect_app.into_make_service_with_connect_info::<SocketAddr>());

        tokio::try_join!(
            server_fut,
            async {
                redirect_fut
                    .await
                    .context("servidor de redirecionamento HTTP caiu")
            }
        )?;
    } else {
        server_fut.await?;
    }

    tracing::info!("desligando servicos em background...");
    state.shutdown().await;

    tracing::info!("ate mais");
    Ok(())
}

/// Monta o roteador de redirecionamento que encaminha todo trafego HTTP para HTTPS.
pub fn redirect_to_https_app(tls_port: u16) -> Router {
    Router::new().fallback(move |req: Request| async move {
        let uri = req.uri();
        let host = req
            .headers()
            .get(header::HOST)
            .and_then(|h| h.to_str().ok())
            .map(extract_host_without_port)
            .unwrap_or("localhost");

        let path_and_query = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");

        let target = if tls_port == 443 {
            format!("https://{}{}", host, path_and_query)
        } else {
            format!("https://{}:{}{}", host, tls_port, path_and_query)
        };

        (
            axum::http::StatusCode::MOVED_PERMANENTLY,
            [
                (header::LOCATION, target),
                (header::CONNECTION, "close".to_string()),
                (header::CONTENT_LENGTH, "0".to_string()),
            ],
        )
    })
}

fn extract_host_without_port(host_hdr: &str) -> &str {
    if let Some(closing_bracket) = host_hdr.find(']') {
        &host_hdr[..=closing_bracket]
    } else {
        host_hdr.split(':').next().unwrap_or(host_hdr)
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::util::ServiceExt;

    #[test]
    fn testa_extracao_de_host_sem_porta() {
        assert_eq!(extract_host_without_port("exemplo.com"), "exemplo.com");
        assert_eq!(extract_host_without_port("exemplo.com:80"), "exemplo.com");
        assert_eq!(extract_host_without_port("127.0.0.1:8080"), "127.0.0.1");
        assert_eq!(extract_host_without_port("[::1]:80"), "[::1]");
        assert_eq!(extract_host_without_port("[2001:db8::1]"), "[2001:db8::1]");
    }

    #[tokio::test]
    async fn redireciona_http_para_https_porta_padrao() {
        let app = redirect_to_https_app(443);
        let req = Request::builder()
            .uri("/mensagens/geral?limite=10")
            .header("host", "chat.stapp.com:80")
            .body(Body::empty())
            .unwrap();

        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::MOVED_PERMANENTLY);
        assert_eq!(
            res.headers().get(header::LOCATION).unwrap(),
            "https://chat.stapp.com/mensagens/geral?limite=10"
        );
    }

    #[tokio::test]
    async fn redireciona_http_para_https_porta_customizada() {
        let app = redirect_to_https_app(8443);
        let req = Request::builder()
            .uri("/health")
            .header("host", "127.0.0.1:8080")
            .body(Body::empty())
            .unwrap();

        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::MOVED_PERMANENTLY);
        assert_eq!(
            res.headers().get(header::LOCATION).unwrap(),
            "https://127.0.0.1:8443/health"
        );
    }

    #[tokio::test]
    async fn redireciona_ipv6_corretamente() {
        let app = redirect_to_https_app(443);
        let req = Request::builder()
            .uri("/login")
            .header("host", "[::1]:80")
            .body(Body::empty())
            .unwrap();

        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::MOVED_PERMANENTLY);
        assert_eq!(
            res.headers().get(header::LOCATION).unwrap(),
            "https://[::1]/login"
        );
    }
}
