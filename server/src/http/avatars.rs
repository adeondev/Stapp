//! Upload e entrega da imagem de perfil.
//!
//! O upload vai por HTTP, e nao pelo WebSocket, porque o socket carrega eventos
//! pequenos em tempo real — mandar centenas de KB por ele atrasaria a conversa
//! de todo mundo naquela conexao.
//!
//! O corpo do POST sao os bytes crus da imagem, sem multipart: o formato e
//! descoberto decodificando, entao o nome do arquivo e o campo do formulario
//! nao serviriam para nada.

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

/// Acima disto nem chega a ser decodificado. Um avatar de 256px cabe folgado.
const LIMITE: usize = 2 * 1024 * 1024;

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
    let Some(conta) = autenticar(&state, &headers) else {
        return responder(StatusCode::UNAUTHORIZED, "sessao invalida", &contexto);
    };
    if bytes.is_empty() {
        return responder(StatusCode::BAD_REQUEST, "arquivo vazio", &contexto);
    }

    match profile::set_avatar(&state, &conta.id, &bytes) {
        Ok(tamanho) => {
            tracing::info!(user_id = %conta.id, bytes = tamanho, "avatar atualizado");
            responder(StatusCode::NO_CONTENT, "", &contexto)
        }
        // Nao e imagem, ou nao deu para gravar: os dois sao culpa do que veio.
        Err(motivo) => responder(StatusCode::BAD_REQUEST, &motivo, &contexto),
    }
}

async fn remove(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(contexto) = origin_context(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(conta) = autenticar(&state, &headers) else {
        return responder(StatusCode::UNAUTHORIZED, "sessao invalida", &contexto);
    };
    profile::clear_avatar(&state, &conta.id);
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

/// PROTOTYPE: entrega sem autenticacao. A URL leva o user_id, que e um UUID —
/// dificil de adivinhar, mas nao e segredo. Serve porque `<img src>` nao manda
/// cabecalho; se o servidor virar publico, isto vira uma rota assinada.
async fn serve(State(state): State<Arc<AppState>>, Path(user_id): Path<UserId>) -> Response {
    match profile::read_avatar(&state, &user_id) {
        Some(bytes) => {
            let mut resposta = (
                [
                    (header::CONTENT_TYPE, "image/webp"),
                    // A URL carrega ?v=<updated_at>, entao trocar a foto ja muda
                    // o endereco e o cache longo nao segura a imagem velha.
                    (header::CACHE_CONTROL, "public, max-age=604800, immutable"),
                ],
                bytes,
            )
                .into_response();
            // O padrao do servidor e `same-origin`, que bloquearia a imagem
            // embutida a partir do app rodando noutra porta. Avatar e feito
            // para ser embutido; o middleware respeita esta escolha.
            resposta.headers_mut().insert(
                HeaderName::from_static("cross-origin-resource-policy"),
                HeaderValue::from_static("cross-origin"),
            );
            resposta
        }
        // Quem pergunta e o cliente; um 404 aqui so faz ele cair no avatar gerado.
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

fn autenticar(state: &AppState, headers: &HeaderMap) -> Option<Account> {
    let bruto = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let token = bruto.strip_prefix("Bearer ")?;
    state.auth.tokens.verify_access(&state.db, token)
}
