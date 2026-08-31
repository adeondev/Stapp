use std::sync::Arc;
use axum::extract::{Json, Path, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};

use super::auth::{OriginContext, attach_common_headers, origin_context};
use crate::protocol::now_ms;
use crate::session::AppState;
use crate::storage::Account;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/presign", post(presign).options(preflight))
        .route("/confirm", post(confirm).options(preflight))
        .route("/files/{*key}", get(serve_file))
}

#[derive(Deserialize)]
pub struct PresignRequest {
    pub filename: String,
    pub content_type: String,
    pub size_bytes: usize,
}

#[derive(Serialize)]
pub struct PresignResponse {
    pub attachment_id: String,
    pub upload_url: String,
    pub download_url: String,
    pub s3_key: String,
}

#[derive(Deserialize)]
pub struct ConfirmRequest {
    pub attachment_id: String,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: usize,
    pub s3_key: String,
}

async fn presign(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<PresignRequest>,
) -> Response {
    let Some(contexto) = origin_context(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(conta) = autenticar(&state, &headers) else {
        return responder(StatusCode::UNAUTHORIZED, "sessao invalida", &contexto);
    };

    let Some(media) = &state.media else {
        return responder(StatusCode::SERVICE_UNAVAILABLE, "armazenamento S3 nao configurado", &contexto);
    };

    // Limite de 50MB por anexo
    if payload.size_bytes > 50 * 1024 * 1024 {
        return responder(StatusCode::BAD_REQUEST, "arquivo excede o limite de 50MB", &contexto);
    }

    match media
        .generate_presigned_upload(&conta.id, &payload.filename, &payload.content_type)
        .await
    {
        Ok(presigned) => {
            let resp = PresignResponse {
                attachment_id: presigned.attachment_id,
                upload_url: presigned.upload_url,
                download_url: presigned.download_url,
                s3_key: presigned.s3_key,
            };
            let mut res = (StatusCode::OK, Json(resp)).into_response();
            attach_common_headers(&mut res, &contexto);
            res
        }
        Err(err) => {
            tracing::error!(%err, "falha gerando presigned url");
            responder(StatusCode::INTERNAL_SERVER_ERROR, "falha gerando presigned url", &contexto)
        }
    }
}

async fn confirm(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<ConfirmRequest>,
) -> Response {
    let Some(contexto) = origin_context(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(conta) = autenticar(&state, &headers) else {
        return responder(StatusCode::UNAUTHORIZED, "sessao invalida", &contexto);
    };

    if let Err(err) = state.db.insert_attachment(
        &payload.attachment_id,
        &conta.id,
        &payload.filename,
        &payload.content_type,
        payload.size_bytes,
        &payload.s3_key,
        now_ms(),
    ) {
        tracing::error!(%err, "falha registrando anexo no banco");
        return responder(StatusCode::INTERNAL_SERVER_ERROR, "erro ao registrar anexo", &contexto);
    }

    responder(StatusCode::NO_CONTENT, "", &contexto)
}

async fn serve_file(
    State(state): State<Arc<AppState>>,
    Path(key): Path<String>,
) -> Response {
    let Some(media) = &state.media else {
        return StatusCode::NOT_FOUND.into_response();
    };

    match media.get_object_bytes(&key).await {
        Ok((content_type, bytes)) => {
            let mut res = (
                [
                    (header::CONTENT_TYPE, content_type),
                    (header::CACHE_CONTROL, "public, max-age=31536000, immutable".to_string()),
                ],
                bytes,
            )
                .into_response();

            res.headers_mut().insert(
                HeaderName::from_static("cross-origin-resource-policy"),
                HeaderValue::from_static("cross-origin"),
            );
            res
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn preflight(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(contexto) = origin_context(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let mut resposta = StatusCode::NO_CONTENT.into_response();
    attach_common_headers(&mut resposta, &contexto);
    resposta.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("POST, OPTIONS"),
    );
    resposta.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("authorization, content-type"),
    );
    resposta
}

fn responder(status: StatusCode, corpo: &str, contexto: &OriginContext) -> Response {
    let mut resposta = if corpo.is_empty() {
        status.into_response()
    } else {
        (status, corpo.to_string()).into_response()
    };
    attach_common_headers(&mut resposta, contexto);
    resposta
}

fn autenticar(state: &AppState, headers: &HeaderMap) -> Option<Account> {
    let bruto = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let token = bruto.strip_prefix("Bearer ")?;
    state.auth.tokens.verify_access(&state.db, token)
}