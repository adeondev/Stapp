//! Upload e entrega do banner do perfil.
//!
//! Espelha `avatars.rs` de proposito: mesmo transporte (bytes crus no corpo, sem
//! multipart, porque o formato e descoberto decodificando), mesmo processo de
//! imagem e mesmo modelo de cache. Muda so a forma do corte — 8:3 em vez de
//! quadrado — e o limite, porque um banner tem mais pixel que um avatar.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};

use super::auth::{OriginContext, attach_common_headers, origin_context};

use crate::protocol::UserId;
use crate::services::profile;
use crate::session::AppState;
use crate::storage::Account;

/// Acima disto nem chega a ser decodificado. Um banner de 960x360 cabe folgado.
const LIMITE: usize = 4 * 1024 * 1024;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", post(upload).delete(remove).options(preflight))
        .route("/{user_id}", get(serve))
        .layer(DefaultBodyLimit::max(LIMITE))
}

async fn upload(State(state): State<Arc<AppState>>, headers: HeaderMap, bytes: Bytes) -> Response {
    let Some(contexto) = origin_context(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(conta) = autenticar(&state, &headers).await else {
        return responder(StatusCode::UNAUTHORIZED, "sessao invalida", &contexto);
    };
    if bytes.is_empty() {
        return responder(StatusCode::BAD_REQUEST, "arquivo vazio", &contexto);
    }

    match profile::set_banner(&state, &conta.id, &bytes).await {
        Ok(tamanho) => {
            tracing::info!(user_id = %conta.id, bytes = tamanho, "banner atualizado");
            responder(StatusCode::NO_CONTENT, "", &contexto)
        }
        Err(motivo) => responder(StatusCode::BAD_REQUEST, &motivo, &contexto),
    }
}

async fn remove(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(contexto) = origin_context(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(conta) = autenticar(&state, &headers).await else {
        return responder(StatusCode::UNAUTHORIZED, "sessao invalida", &contexto);
    };
    profile::clear_banner(&state, &conta.id).await;
    responder(StatusCode::NO_CONTENT, "", &contexto)
}

/// O navegador manda um OPTIONS antes do POST porque a requisicao leva
/// `Authorization`. Sem responder isto, o upload nem sai da pagina.
async fn preflight(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(contexto) = origin_context(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let mut resposta = StatusCode::NO_CONTENT.into_response();
    attach_common_headers(&mut resposta, &contexto);
    resposta.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("POST, DELETE, OPTIONS"),
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

/// PROTOTYPE: entrega sem autenticacao, igual ao avatar. A URL leva o user_id,
/// que e um UUID — dificil de adivinhar, mas nao e segredo. Serve porque
/// `<img src>` nao manda cabecalho; se o servidor virar publico, isto vira uma
/// rota assinada, junto com a do avatar.
async fn serve(State(state): State<Arc<AppState>>, Path(user_id): Path<UserId>) -> Response {
    match profile::read_banner(&state, &user_id).await {
        Some(bytes) => {
            let mut resposta = (
                [
                    (header::CONTENT_TYPE, "image/webp"),
                    // A URL carrega ?v=<updated_at>, entao trocar a imagem ja
                    // muda o endereco e o cache longo nao segura a antiga.
                    (header::CACHE_CONTROL, "public, max-age=604800, immutable"),
                ],
                bytes,
            )
                .into_response();
            // ARMADILHA, a mesma do avatar: o middleware de seguranca poe
            // `cross-origin-resource-policy: same-origin` em tudo, e isso
            // BLOQUEIA a imagem no `<img>` quando o app roda noutra porta (dev:
            // web em :5173, servidor em :8787). O sintoma engana, porque o GET
            // responde 200 e so o navegador recusa. Aqui a rota sobrescreve de
            // proposito, e o middleware respeita quem ja definiu o cabecalho.
            resposta.headers_mut().insert(
                HeaderName::from_static("cross-origin-resource-policy"),
                HeaderValue::from_static("cross-origin"),
            );
            resposta
        }
        // Um 404 aqui so faz o cliente cair na faixa da cor de destaque.
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn autenticar(state: &AppState, headers: &HeaderMap) -> Option<Account> {
    let bruto = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let token = bruto.strip_prefix("Bearer ")?;
    state.auth.tokens.verify_access(&state.db, token).await
}
