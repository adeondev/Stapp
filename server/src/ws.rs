use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::response::Response;
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

use crate::auth::{LoginError, RegisterError};
use crate::chat;
use crate::db::Account;
use crate::protocol::{AuthErrorCode, ClientMsg, ServerMsg};
use crate::state::{AppState, SessionError, Target};
use crate::voice;

pub async fn handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    ConnectInfo(origin): ConnectInfo<SocketAddr>,
) -> Response {
    ws.on_upgrade(move |socket| connection(socket, state, origin))
}

async fn connection(mut socket: WebSocket, state: Arc<AppState>, origin: SocketAddr) {
    let peer_id = Uuid::new_v4().to_string();
    let mut rx = state.subscribe();
    let mut registered = false;

    tracing::debug!(peer = %peer_id, %origin, "conexao aberta");
    if send_direct(
        &mut socket,
        &ServerMsg::AuthRequired {
            server_name: state.config.server.name.clone(),
            registration_enabled: state.config.auth.allow_registration,
        },
    )
    .await
    .is_err()
    {
        return;
    }

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                let Some(Ok(frame)) = incoming else { break };
                match frame {
                    WsMessage::Text(text) => match serde_json::from_str::<ClientMsg>(&text) {
                        Ok(msg) => handle(&state, &peer_id, origin, &mut registered, msg).await,
                        Err(err) => {
                            tracing::debug!(peer = %peer_id, %err, "mensagem invalida");
                            if registered {
                                state.send_to(&peer_id, ServerMsg::Error { message: "mensagem invalida".into() });
                            } else {
                                auth_error(&state, &peer_id, AuthErrorCode::InvalidCredentials, "autenticacao invalida", None);
                            }
                        }
                    },
                    WsMessage::Close(_) => break,
                    _ => {}
                }
            }

            envelope = rx.recv() => {
                match envelope {
                    Ok(env) => {
                        if !env.is_for(&peer_id) { continue }
                        if !registered && !matches!(env.msg, ServerMsg::AuthError { .. }) {
                            continue;
                        }
                        if send_direct(&mut socket, &env.msg).await.is_err() { break }
                    }
                    Err(RecvError::Lagged(n)) => {
                        tracing::warn!(peer = %peer_id, perdidas = n, "conexao atrasada, derrubando");
                        break;
                    }
                    Err(RecvError::Closed) => break,
                }
            }
        }
    }

    voice::leave(&state, &peer_id).await;
    if let Some(removal) = state.remove_session(&peer_id).await {
        if removal.last_session {
            state.broadcast(ServerMsg::UserOffline {
                user_id: removal.user_id,
            });
        }
    }
    tracing::debug!(peer = %peer_id, "conexao fechada");
}

async fn handle(
    state: &Arc<AppState>,
    peer_id: &str,
    origin: SocketAddr,
    registered: &mut bool,
    msg: ClientMsg,
) {
    if !*registered {
        match msg {
            ClientMsg::AuthLogin { username, password } => {
                if !origin.ip().is_loopback() {
                    return auth_error(
                        state,
                        peer_id,
                        AuthErrorCode::SecureTransportRequired,
                        "use WSS para autenticar fora desta maquina",
                        None,
                    );
                }
                match state.auth.login(&state.db, &username, password).await {
                    Ok(account) => finish_auth(state, peer_id, registered, account).await,
                    Err(LoginError::InvalidCredentials) => auth_error(
                        state,
                        peer_id,
                        AuthErrorCode::InvalidCredentials,
                        "username ou senha incorretos",
                        None,
                    ),
                    Err(LoginError::RateLimited(wait)) => rate_limited(state, peer_id, wait),
                    Err(LoginError::Internal(error)) => {
                        tracing::error!(%error, "falha autenticando conta");
                        auth_error(
                            state,
                            peer_id,
                            AuthErrorCode::InvalidCredentials,
                            "nao foi possivel autenticar",
                            None,
                        );
                    }
                }
            }
            ClientMsg::AuthRegister { username, password } => {
                if !origin.ip().is_loopback() {
                    return auth_error(
                        state,
                        peer_id,
                        AuthErrorCode::SecureTransportRequired,
                        "use WSS para registrar fora desta maquina",
                        None,
                    );
                }
                if !state.config.auth.allow_registration {
                    return auth_error(
                        state,
                        peer_id,
                        AuthErrorCode::RegistrationDisabled,
                        "este servidor nao permite criar contas pelo aplicativo",
                        None,
                    );
                }
                match state
                    .auth
                    .register(&state.db, origin.ip(), &username, password)
                    .await
                {
                    Ok(account) => finish_auth(state, peer_id, registered, account).await,
                    Err(RegisterError::InvalidUsername) => auth_error(
                        state,
                        peer_id,
                        AuthErrorCode::InvalidUsername,
                        "use de 3 a 24 letras, numeros, ponto, hifen ou sublinhado",
                        None,
                    ),
                    Err(RegisterError::InvalidPassword) => auth_error(
                        state,
                        peer_id,
                        AuthErrorCode::InvalidPassword,
                        "a senha precisa ter entre 12 e 128 caracteres",
                        None,
                    ),
                    Err(RegisterError::UsernameUnavailable) => auth_error(
                        state,
                        peer_id,
                        AuthErrorCode::UsernameUnavailable,
                        "esse username ja esta em uso",
                        None,
                    ),
                    Err(RegisterError::RateLimited(wait)) => rate_limited(state, peer_id, wait),
                    Err(RegisterError::Internal(error)) => {
                        tracing::error!(%error, "falha registrando conta");
                        auth_error(
                            state,
                            peer_id,
                            AuthErrorCode::InvalidCredentials,
                            "nao foi possivel criar a conta",
                            None,
                        );
                    }
                }
            }
            _ => auth_error(
                state,
                peer_id,
                AuthErrorCode::InvalidCredentials,
                "autentique-se primeiro",
                None,
            ),
        }
        return;
    }

    match msg {
        ClientMsg::AuthLogin { .. } | ClientMsg::AuthRegister { .. } => {}
        ClientMsg::ChatSend { channel, text } => chat::send(state, peer_id, channel, &text).await,
        ClientMsg::VoiceJoin { channel } => {
            voice::join(state, &peer_id.to_string(), &channel).await
        }
        ClientMsg::VoiceLeave => voice::leave(state, &peer_id.to_string()).await,
        ClientMsg::VoiceState { muted, deafened } => {
            voice::set_state(state, &peer_id.to_string(), muted, deafened).await
        }
        ClientMsg::RtcSignal { to, payload } => {
            voice::relay(state, &peer_id.to_string(), &to, payload).await
        }
    }
}

async fn finish_auth(
    state: &Arc<AppState>,
    peer_id: &str,
    registered: &mut bool,
    account: Account,
) {
    let registration = match state.register_session(peer_id, &account).await {
        Ok(registration) => registration,
        Err(SessionError::ServerFull) => {
            return auth_error(
                state,
                peer_id,
                AuthErrorCode::ServerFull,
                "o servidor esta cheio",
                None,
            );
        }
        Err(SessionError::TooManySessions) => {
            return auth_error(
                state,
                peer_id,
                AuthErrorCode::TooManySessions,
                "sua conta atingiu o limite de sessoes abertas",
                None,
            );
        }
    };
    *registered = true;

    state.send_to(
        peer_id,
        ServerMsg::Welcome {
            self_peer_id: peer_id.to_string(),
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
            Target::Except(peer_id.to_string()),
            ServerMsg::UserOnline {
                user: registration.user,
            },
        );
    }
    tracing::info!(peer = %peer_id, user_id = %account.id, username = %account.username, "entrou");
}

fn rate_limited(state: &AppState, peer_id: &str, wait: Duration) {
    let retry_after_ms = wait.as_millis().min(u64::MAX as u128) as u64;
    auth_error(
        state,
        peer_id,
        AuthErrorCode::RateLimited,
        "muitas tentativas; aguarde um pouco",
        Some(retry_after_ms),
    );
}

fn auth_error(
    state: &AppState,
    peer_id: &str,
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

async fn send_direct(socket: &mut WebSocket, msg: &ServerMsg) -> Result<(), ()> {
    let json = serde_json::to_string(msg).map_err(|_| ())?;
    socket
        .send(WsMessage::Text(json.into()))
        .await
        .map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Target;
    use crate::test_support::TestServer;

    #[test]
    fn auth_error_codes_use_snake_case() {
        let json = serde_json::to_string(&ServerMsg::AuthError {
            code: AuthErrorCode::TooManySessions,
            message: "limite".into(),
            retry_after_ms: None,
        })
        .unwrap();
        assert!(json.contains("\"too_many_sessions\""));
        assert!(!json.contains("retry_after_ms"));
    }

    #[tokio::test]
    async fn registration_is_configurable_and_enters_immediately() {
        let mut server = TestServer::new(10, 4);
        Arc::get_mut(&mut server.state)
            .unwrap()
            .config
            .auth
            .allow_registration = true;
        let mut events = server.state.subscribe();
        let mut registered = false;
        handle(
            &server.state,
            "peer",
            "127.0.0.1:1234".parse().unwrap(),
            &mut registered,
            ClientMsg::AuthRegister {
                username: "Daniel".into(),
                password: "uma senha realmente segura".into(),
            },
        )
        .await;

        assert!(registered);
        let event = events.try_recv().unwrap();
        assert!(matches!(event.target, Target::Peer(ref id) if id == "peer"));
        assert!(
            matches!(event.msg, ServerMsg::Welcome { ref self_user_id, .. } if !self_user_id.is_empty())
        );
    }

    #[tokio::test]
    async fn rejects_registration_when_closed_and_remote_plaintext_auth() {
        let server = TestServer::new(10, 4);
        let mut events = server.state.subscribe();
        let mut registered = false;
        handle(
            &server.state,
            "peer",
            "127.0.0.1:1234".parse().unwrap(),
            &mut registered,
            ClientMsg::AuthRegister {
                username: "Daniel".into(),
                password: "uma senha realmente segura".into(),
            },
        )
        .await;
        assert!(matches!(
            events.try_recv().unwrap().msg,
            ServerMsg::AuthError {
                code: AuthErrorCode::RegistrationDisabled,
                ..
            }
        ));

        handle(
            &server.state,
            "peer",
            "192.168.0.2:1234".parse().unwrap(),
            &mut registered,
            ClientMsg::AuthLogin {
                username: "Daniel".into(),
                password: "uma senha realmente segura".into(),
            },
        )
        .await;
        assert!(matches!(
            events.try_recv().unwrap().msg,
            ServerMsg::AuthError {
                code: AuthErrorCode::SecureTransportRequired,
                ..
            }
        ));
    }
}
