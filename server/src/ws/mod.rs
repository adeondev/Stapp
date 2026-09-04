//! Transporte WebSocket.
//!
//! Este arquivo cuida **so do cano**: aceitar o upgrade, ler frames, escrever o
//! que o broadcast mandar e limpar a sessao no fim. Ele nao sabe o que e login
//! nem o que e entrar numa call.
//!
//! Quem decide o que fazer com cada mensagem e a [`Phase`] da conexao:
//!
//! - [`Phase::Anonymous`] -> [`auth_flow`], que so aceita autenticacao;
//! - [`Phase::Authenticated`] -> [`dispatch`], que roteia o resto do protocolo.
//!
//! E por isso que uma funcionalidade nova nao engorda este arquivo: ela entra
//! em `dispatch.rs` (ou no servico correspondente), e o cano continua igual.

mod auth_flow;
mod dispatch;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::mpsc;
use uuid::Uuid;

const WS_OUTGOING_CAPACITY: usize = 128;

use crate::protocol::{AuthErrorCode, ClientMsg, PROTOCOL_VERSION, PeerId, ServerMsg};
use crate::services::{call, voice};
use crate::session::AppState;

/// Em que ponto do protocolo esta esta conexao.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Phase {
    /// Ainda nao provou quem e: so `auth.access` com token curto passa.
    Anonymous,
    /// Ja provou: o resto do protocolo esta liberado.
    Authenticated,
}

pub async fn handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    ConnectInfo(origin): ConnectInfo<SocketAddr>,
) -> Response {
    ws.on_upgrade(move |socket| connection(socket, state, origin))
}

async fn connection(socket: WebSocket, state: Arc<AppState>, origin: SocketAddr) {
    let peer_id: PeerId = Uuid::new_v4().to_string();
    // Assinado antes de qualquer coisa ser publicada, senao a propria conexao
    // perde o welcome que ela mesma dispara.
    let mut rx = state.subscribe();
    let mut phase = Phase::Anonymous;

    tracing::debug!(peer = %peer_id, %origin, "conexao aberta");

    let (mut ws_sink, mut ws_stream) = socket.split();
    let (tx, mut rx_out) = mpsc::channel::<WsMessage>(WS_OUTGOING_CAPACITY);

    let writer_peer = peer_id.clone();
    let mut writer = tokio::spawn(async move {
        while let Some(frame) = rx_out.recv().await {
            if ws_sink.send(frame).await.is_err() {
                tracing::debug!(peer = %writer_peer, "erro ao enviar frame websocket; encerrando writer");
                break;
            }
        }
    });

    let hello = ServerMsg::AuthRequired {
        server_id: state.db.server_id().unwrap_or_else(|_| "unknown".into()),
        protocol_version: PROTOCOL_VERSION,
        server_name: state.config.server.name.clone(),
        registration_enabled: state.config.auth.allow_registration,
        plaintext_auth_allowed: state.config.auth.allows_plaintext_from(origin.ip()),
        min_client_version: state.config.server.min_client_version.clone(),
        voice_enabled: crate::services::voice::is_enabled(&state.config.voice),
    };
    if let Ok(json) = serde_json::to_string(&hello) {
        if tx.send(WsMessage::Text(json.into())).await.is_err() {
            writer.abort();
            return;
        }
    } else {
        writer.abort();
        return;
    }

    loop {
        tokio::select! {
            writer_res = &mut writer => {
                tracing::debug!(peer = %peer_id, ?writer_res, "writer websocket finalizado");
                break;
            }

            incoming = ws_stream.next() => {
                let t1 = crate::protocol::now_micros();
                let Some(Ok(frame)) = incoming else { break };
                match frame {
                    WsMessage::Text(text) => match serde_json::from_str::<ClientMsg>(&text) {
                        Ok(ClientMsg::TelemetryPing { nonce, t0 }) => {
                            let t2 = crate::protocol::now_micros();
                            tracing::info!(
                                peer = %peer_id,
                                %nonce,
                                t0_us = t0,
                                t1_us = t1,
                                t2_us = t2,
                                uplink_us = t1.saturating_sub(t0),
                                server_us = t2.saturating_sub(t1),
                                "telemetria_rtt_processada"
                            );
                            let pong = ServerMsg::TelemetryPong { nonce, t0, t1, t2 };
                            if let Ok(json) = serde_json::to_string(&pong) {
                                if tx.try_send(WsMessage::Text(json.into())).is_err() {
                                    break;
                                }
                            }
                        }
                        Ok(msg) => {
                            phase = route(&state, &peer_id, origin, phase, msg).await;
                        }
                        Err(err) => {
                            tracing::debug!(peer = %peer_id, %err, "mensagem invalida");
                            reject_malformed(&state, &peer_id, phase);
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
                        // Conexao anonima so enxerga o proprio erro de autenticacao.
                        if phase == Phase::Anonymous
                            && !matches!(env.msg, ServerMsg::AuthError { .. })
                        {
                            continue;
                        }
                        if let Ok(json) = serde_json::to_string(&env.msg) {
                            match tx.try_send(WsMessage::Text(json.into())) {
                                Ok(_) => {}
                                Err(mpsc::error::TrySendError::Full(_)) => {
                                    tracing::warn!(peer = %peer_id, "fila de saida websocket cheia (128), derrubando conexao lenta");
                                    break;
                                }
                                Err(mpsc::error::TrySendError::Closed(_)) => break,
                            }
                        }
                    }
                    // Perder eventos e pior que derrubar: o cliente reconecta e
                    // recebe o estado inteiro de novo.
                    Err(RecvError::Lagged(n)) => {
                        tracing::warn!(peer = %peer_id, perdidas = n, "conexao atrasada, derrubando");
                        break;
                    }
                    Err(RecvError::Closed) => break,
                }
            }
        }
    }

    writer.abort();

    // Sair da call primeiro: enquanto a sessao existe, o `voice.left` sai limpo.
    voice::leave(&state, &peer_id).await;
    if let Some(removal) = state.remove_session(&peer_id).await {
        if removal.last_session {
            // Ultima conexao da conta: nao da para deixar chamada tocando.
            call::drop_for(&state, &removal.user_id).await;
            state.broadcast(ServerMsg::UserOffline {
                user_id: removal.user_id,
            });
        }
    }
    tracing::debug!(peer = %peer_id, "conexao fechada");
}

async fn route(
    state: &Arc<AppState>,
    peer_id: &PeerId,
    origin: SocketAddr,
    phase: Phase,
    msg: ClientMsg,
) -> Phase {
    match phase {
        Phase::Anonymous => auth_flow::handle(state, peer_id, origin, msg).await,
        Phase::Authenticated => {
            dispatch::handle(state, peer_id, msg).await;
            Phase::Authenticated
        }
    }
}

fn reject_malformed(state: &AppState, peer_id: &PeerId, phase: Phase) {
    match phase {
        Phase::Authenticated => state.send_to(
            peer_id,
            ServerMsg::Error {
                message: "mensagem invalida".into(),
            },
        ),
        Phase::Anonymous => auth_flow::fail(
            state,
            peer_id,
            AuthErrorCode::InvalidCredentials,
            "autenticacao invalida",
            None,
        ),
    }
}

#[cfg(test)]
mod tests;
