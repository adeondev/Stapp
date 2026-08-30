//! Autenticacao de uma conexao anonima.
//!
//! Login e registro ja aconteceram por HTTP. Aqui o WebSocket recebe somente
//! o access token curto em memoria e, se ele for valido, abre a sessao.

use super::Phase;
use crate::protocol::{AuthErrorCode, ClientMsg, PeerId, ServerMsg};
use crate::services::chat;
use crate::services::direct;
use crate::services::profile;
use crate::services::social;
use crate::services::voice;
use crate::session::{AppState, SessionError, Target};
use crate::storage::Account;
use std::net::SocketAddr;
use std::sync::Arc;

/// Traducao de uma falha para o que o cliente ve. Sem isto cada `match` de erro
/// repetia cinco linhas de `ServerMsg::AuthError`.
struct Failure {
    code: AuthErrorCode,
    message: &'static str,
    retry_after_ms: Option<u64>,
}

impl Failure {
    fn new(code: AuthErrorCode, message: &'static str) -> Self {
        Self {
            code,
            message,
            retry_after_ms: None,
        }
    }
}

pub(super) async fn handle(
    state: &Arc<AppState>,
    peer_id: &PeerId,
    origin: SocketAddr,
    msg: ClientMsg,
) -> Phase {
    let access_token = match msg {
        ClientMsg::AuthAccess { access_token } => access_token,
        _ => {
            return refuse(
                state,
                peer_id,
                Failure::new(AuthErrorCode::InvalidCredentials, "autentique-se primeiro"),
            );
        }
    };

    let _ = origin;
    match state.auth.tokens.verify_access(&state.db, &access_token) {
        Some(account) => open_session(state, peer_id, account).await,
        None => refuse(
            state,
            peer_id,
            Failure::new(
                AuthErrorCode::InvalidCredentials,
                "sessao invalida ou expirada",
            ),
        ),
    }
}

/// Registra a sessao e entrega o estado inicial. So aqui a conexao vira
/// [`Phase::Authenticated`].
async fn open_session(state: &Arc<AppState>, peer_id: &PeerId, account: Account) -> Phase {
    let registration = match state.register_session(peer_id, &account).await {
        Ok(registration) => registration,
        Err(SessionError::ServerFull) => {
            return refuse(
                state,
                peer_id,
                Failure::new(AuthErrorCode::ServerFull, "o servidor esta cheio"),
            );
        }
        Err(SessionError::TooManySessions) => {
            return refuse(
                state,
                peer_id,
                Failure::new(
                    AuthErrorCode::TooManySessions,
                    "sua conta atingiu o limite de sessoes abertas",
                ),
            );
        }
    };

    state.send_to(
        peer_id,
        ServerMsg::Welcome {
            self_peer_id: peer_id.clone(),
            self_user_id: account.id.clone(),
            server_name: state.config.server.name.clone(),
            channels: state.config.channels.clone(),
            users: state.snapshot().await,
            directory: direct::directory(state, &account.id),
            profiles: profile::all(state),
            voice: voice::client_config(state),
            voice_peers: voice::all_peers(state).await,
        },
    );
    chat::send_history(state, peer_id);
    direct::send_list(state, peer_id).await;
    social::send_snapshot(state, &account.id).await;

    if registration.first_session {
        state.publish(
            Target::Except(peer_id.clone()),
            ServerMsg::UserOnline {
                user: registration.user,
            },
        );
        social::refresh_all_online(state).await;
    }

    tracing::info!(
        peer = %peer_id,
        user_id = %account.id,
        username = %account.username,
        "entrou"
    );
    Phase::Authenticated
}

fn refuse(state: &AppState, peer_id: &PeerId, failure: Failure) -> Phase {
    fail(
        state,
        peer_id,
        failure.code,
        failure.message,
        failure.retry_after_ms,
    );
    Phase::Anonymous
}

pub(super) fn fail(
    state: &AppState,
    peer_id: &PeerId,
    code: AuthErrorCode,
    message: &str,
    retry_after_ms: Option<u64>,
) {
    state.send_to(
        peer_id,
        ServerMsg::AuthError {
            code,
            message: message.to_string(),
            retry_after_ms,
        },
    );
}
