//! Autenticacao de uma conexao anonima.
//!
//! O fluxo e sempre o mesmo: conferir o transporte, cobrar as credenciais,
//! abrir a sessao. O que muda entre entrar e criar conta e so o servico
//! chamado — por isso os dois caminhos se juntam logo na primeira linha.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use super::Phase;
use crate::auth::{LoginError, RegisterError};
use crate::services::chat;
use crate::protocol::{AuthErrorCode, ClientMsg, PeerId, ServerMsg};
use crate::session::{AppState, SessionError, Target};
use crate::storage::Account;
use crate::services::voice;

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

    fn rate_limited(wait: Duration) -> Self {
        Self {
            code: AuthErrorCode::RateLimited,
            message: "muitas tentativas; aguarde um pouco",
            retry_after_ms: Some(wait.as_millis().min(u64::MAX as u128) as u64),
        }
    }
}

pub(super) async fn handle(
    state: &Arc<AppState>,
    peer_id: &PeerId,
    origin: SocketAddr,
    msg: ClientMsg,
) -> Phase {
    let (registering, username, password) = match msg {
        ClientMsg::AuthLogin { username, password } => (false, username, password),
        ClientMsg::AuthRegister { username, password } => (true, username, password),
        _ => {
            return refuse(
                state,
                peer_id,
                Failure::new(AuthErrorCode::InvalidCredentials, "autentique-se primeiro"),
            );
        }
    };

    // A senha viaja em texto claro dentro do WebSocket. Passa o loopback (em
    // producao quem termina o TLS e um proxy no mesmo host) e o que o servidor
    // declarar como rede confiavel em `auth.trusted_networks`.
    if !state.config.auth.allows_plaintext_from(origin.ip()) {
        return refuse(
            state,
            peer_id,
            Failure::new(
                AuthErrorCode::SecureTransportRequired,
                "use WSS para autenticar de fora das redes confiaveis deste servidor",
            ),
        );
    }

    let account = if registering {
        if !state.config.auth.allow_registration {
            return refuse(
                state,
                peer_id,
                Failure::new(
                    AuthErrorCode::RegistrationDisabled,
                    "este servidor nao permite criar contas pelo aplicativo",
                ),
            );
        }
        state
            .auth
            .register(&state.db, origin.ip(), &username, password)
            .await
            .map_err(register_failure)
    } else {
        state
            .auth
            .login(&state.db, &username, password)
            .await
            .map_err(login_failure)
    };

    match account {
        Ok(account) => open_session(state, peer_id, account).await,
        Err(failure) => refuse(state, peer_id, failure),
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
            voice: voice::client_config(state),
            voice_peers: voice::all_peers(state).await,
        },
    );
    chat::send_history(state, peer_id);

    if registration.first_session {
        state.publish(
            Target::Except(peer_id.clone()),
            ServerMsg::UserOnline {
                user: registration.user,
            },
        );
    }

    tracing::info!(
        peer = %peer_id,
        user_id = %account.id,
        username = %account.username,
        "entrou"
    );
    Phase::Authenticated
}

fn login_failure(error: LoginError) -> Failure {
    match error {
        LoginError::InvalidCredentials => Failure::new(
            AuthErrorCode::InvalidCredentials,
            "username ou senha incorretos",
        ),
        LoginError::RateLimited(wait) => Failure::rate_limited(wait),
        LoginError::Internal(error) => {
            tracing::error!(%error, "falha autenticando conta");
            Failure::new(
                AuthErrorCode::InvalidCredentials,
                "nao foi possivel autenticar",
            )
        }
    }
}

fn register_failure(error: RegisterError) -> Failure {
    match error {
        RegisterError::InvalidUsername => Failure::new(
            AuthErrorCode::InvalidUsername,
            "use de 3 a 24 letras, numeros, ponto, hifen ou sublinhado",
        ),
        RegisterError::InvalidPassword => Failure::new(
            AuthErrorCode::InvalidPassword,
            "a senha precisa ter entre 12 e 128 caracteres",
        ),
        RegisterError::UsernameUnavailable => Failure::new(
            AuthErrorCode::UsernameUnavailable,
            "esse username ja esta em uso",
        ),
        RegisterError::RateLimited(wait) => Failure::rate_limited(wait),
        RegisterError::Internal(error) => {
            tracing::error!(%error, "falha registrando conta");
            Failure::new(
                AuthErrorCode::InvalidCredentials,
                "nao foi possivel criar a conta",
            )
        }
    }
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
