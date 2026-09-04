use axum::body::Body;
use axum::extract::Request;
use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;

/// Assets estaticos do frontend web embutidos diretamente no binario.
#[derive(RustEmbed)]
#[folder = "../web/dist"]
pub struct EmbeddedAssets;

/// Handler HTTP que serve os assets embutidos com suporte a SPA fallback e controle de cache.
pub async fn static_handler(req: Request) -> Response {
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return (StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed").into_response();
    }

    let raw_path = req.uri().path().trim_start_matches('/');
    let path = if raw_path.is_empty() {
        "index.html"
    } else {
        raw_path
    };

    if let Some(file) = EmbeddedAssets::get(path) {
        return serve_embedded_file(path, file, &req);
    }

    // Se o caminho tem extensao de arquivo ou comeca com assets/, e um arquivo estatico que nao existe
    if path.starts_with("assets/") || path.contains('.') {
        return (StatusCode::NOT_FOUND, "File not found").into_response();
    }

    // Caso contrario, e uma rota de navegacao da SPA: serve o index.html como fallback
    if let Some(index_file) = EmbeddedAssets::get("index.html") {
        serve_embedded_file("index.html", index_file, &req)
    } else {
        (
            StatusCode::NOT_FOUND,
            "Client frontend not available (index.html missing)",
        )
            .into_response()
    }
}

fn serve_embedded_file(path: &str, file: rust_embed::EmbeddedFile, req: &Request) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let content_type = if path.ends_with(".html") {
        "text/html; charset=utf-8".to_string()
    } else if path.ends_with(".js") || path.ends_with(".mjs") {
        "text/javascript; charset=utf-8".to_string()
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8".to_string()
    } else {
        mime.as_ref().to_string()
    };

    // Cache-Control:
    // Bundles com hash na pasta assets/ sao imutaveis (1 ano de cache).
    // index.html nunca deve ficar em cache longo para permitir atualizacoes transparentes.
    let cache_control = if path.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else if path == "index.html" {
        "no-cache, no-store, must-revalidate"
    } else {
        "public, max-age=3600"
    };

    let etag = format!("\"{}\"", hex::encode(file.metadata.sha256_hash()));

    if let Some(if_none_match) = req
        .headers()
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
    {
        if if_none_match.trim() == etag {
            return Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .header(header::ETAG, etag)
                .header(header::CACHE_CONTROL, cache_control)
                .body(Body::empty())
                .unwrap();
        }
    }

    let body = if req.method() == Method::HEAD {
        Body::empty()
    } else {
        Body::from(file.data)
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, cache_control)
        .header(header::ETAG, etag)
        .body(body)
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::http::Request;

    #[tokio::test]
    async fn serve_index_html_na_raiz() {
        let req = Request::builder().uri("/").body(Body::empty()).unwrap();
        let res = static_handler(req).await;

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            res.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/html; charset=utf-8"
        );
        assert_eq!(
            res.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-cache, no-store, must-revalidate"
        );
        assert!(res.headers().contains_key(header::ETAG));

        let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body_str = String::from_utf8_lossy(&bytes);
        assert!(body_str.contains("<html") || body_str.contains("<!DOCTYPE html"));
    }

    #[tokio::test]
    async fn fallback_spa_para_rotas_sem_extensao() {
        let req = Request::builder()
            .uri("/canal/geral?param=1")
            .body(Body::empty())
            .unwrap();
        let res = static_handler(req).await;

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            res.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/html; charset=utf-8"
        );
        let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body_str = String::from_utf8_lossy(&bytes);
        assert!(body_str.contains("<html") || body_str.contains("<!DOCTYPE html"));
    }

    #[tokio::test]
    async fn asset_inexistente_com_extensao_retorna_404() {
        let req = Request::builder()
            .uri("/assets/arquivo_inexistente.js")
            .body(Body::empty())
            .unwrap();
        let res = static_handler(req).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND);

        let req = Request::builder()
            .uri("/imagem_nao_encontrada.png")
            .body(Body::empty())
            .unwrap();
        let res = static_handler(req).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn cache_imutavel_para_assets_compilados() {
        if let Some(asset_path) = EmbeddedAssets::iter().find(|p| p.starts_with("assets/")) {
            let req = Request::builder()
                .uri(format!("/{}", asset_path))
                .body(Body::empty())
                .unwrap();
            let res = static_handler(req).await;

            assert_eq!(res.status(), StatusCode::OK);
            assert_eq!(
                res.headers().get(header::CACHE_CONTROL).unwrap(),
                "public, max-age=31536000, immutable"
            );
            assert!(res.headers().contains_key(header::CONTENT_TYPE));
        }
    }

    #[tokio::test]
    async fn etag_com_304_not_modified() {
        let req1 = Request::builder().uri("/").body(Body::empty()).unwrap();
        let res1 = static_handler(req1).await;
        let etag = res1.headers().get(header::ETAG).unwrap().to_str().unwrap().to_string();

        let req2 = Request::builder()
            .uri("/")
            .header(header::IF_NONE_MATCH, etag)
            .body(Body::empty())
            .unwrap();
        let res2 = static_handler(req2).await;

        assert_eq!(res2.status(), StatusCode::NOT_MODIFIED);
        let bytes = to_bytes(res2.into_body(), usize::MAX).await.unwrap();
        assert!(bytes.is_empty());
    }

    #[tokio::test]
    async fn head_request_retorna_headers_sem_corpo() {
        let req = Request::builder()
            .method(Method::HEAD)
            .uri("/")
            .body(Body::empty())
            .unwrap();
        let res = static_handler(req).await;

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            res.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/html; charset=utf-8"
        );
        let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        assert!(bytes.is_empty());
    }

    #[tokio::test]
    async fn post_retorna_metodo_nao_permitido() {
        let req = Request::builder()
            .method(Method::POST)
            .uri("/")
            .body(Body::empty())
            .unwrap();
        let res = static_handler(req).await;
        assert_eq!(res.status(), StatusCode::METHOD_NOT_ALLOWED);
    }
}
