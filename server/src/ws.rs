use std::sync::Arc;

use axum::extract::State;
use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

use crate::chat;
use crate::protocol::{ClientMsg, ServerMsg, User};
use crate::state::{AppState, Target};
use crate::voice;

pub async fn handler(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> Response {
    ws.on_upgrade(move |socket| connection(socket, state))
}

async fn connection(mut socket: WebSocket, state: Arc<AppState>) {
    let peer_id = Uuid::new_v4().to_string();
    // Assinado antes de qualquer coisa ser publicada, senao a propria conexao
    // perde o welcome que ela mesma dispara.
    let mut rx = state.subscribe();
    let mut registered = false;

    tracing::debug!(peer = %peer_id, "conexao aberta");

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                let Some(Ok(frame)) = incoming else { break };
                match frame {
                    WsMessage::Text(text) => {
                        match serde_json::from_str::<ClientMsg>(&text) {
                            Ok(msg) => handle(&state, &peer_id, &mut registered, msg).await,
                            Err(err) => {
                                tracing::debug!(peer = %peer_id, %err, "mensagem invalida");
                                state.send_to(&peer_id, ServerMsg::Error {
                                    message: "mensagem invalida".into(),
                                });
                            }
                        }
                    }
                    WsMessage::Close(_) => break,
                    _ => {}
                }
            }

            envelope = rx.recv() => {
                match envelope {
                    Ok(env) => {
                        // Enquanto nao disse quem e, a conexao nao ve trafego de ninguem.
                        if !registered || !env.is_for(&peer_id) { continue }
                        let Ok(json) = serde_json::to_string(&env.msg) else { continue };
                        if socket.send(WsMessage::Text(json.into())).await.is_err() { break }
                    }
                    // A conexao ficou para tras no buffer. Perder eventos e pior
                    // que derrubar: o cliente reconecta e recebe o estado inteiro.
                    Err(RecvError::Lagged(n)) => {
                        tracing::warn!(peer = %peer_id, perdidas = n, "conexao atrasada, derrubando");
                        break
                    }
                    Err(RecvError::Closed) => break,
                }
            }
        }
    }

    // Sair da call primeiro: enquanto o usuario existe, o `voice.left` sai limpo.
    voice::leave(&state, &peer_id).await;
    state.remove(&peer_id).await;
    if registered {
        state.broadcast(ServerMsg::UserLeft { user_id: peer_id.clone() });
    }
    tracing::debug!(peer = %peer_id, "conexao fechada");
}

async fn handle(state: &Arc<AppState>, peer_id: &str, registered: &mut bool, msg: ClientMsg) {
    // Nada acontece antes do hello.
    if !*registered && !matches!(msg, ClientMsg::Hello { .. }) {
        state.send_to(peer_id, ServerMsg::Error { message: "identifique-se primeiro".into() });
        return;
    }

    match msg {
        ClientMsg::Hello { nick } => {
            if *registered {
                return;
            }
            let Some(nick) = clean_nick(&nick) else {
                state.send_to(peer_id, ServerMsg::Error { message: "apelido invalido".into() });
                return;
            };

            if let Err(reason) = state.register(peer_id, nick.clone()).await {
                state.send_to(peer_id, ServerMsg::Error { message: reason });
                return;
            }
            *registered = true;

            state.send_to(
                peer_id,
                ServerMsg::Welcome {
                    self_id: peer_id.to_string(),
                    server_name: state.config.server.name.clone(),
                    channels: state.config.channels.clone(),
                    users: state.snapshot().await,
                    voice: voice::client_config(state),
                    voice_peers: voice::all_peers(state).await,
                },
            );

            chat::send_history(state, peer_id);

            state.publish(
                Target::Except(peer_id.to_string()),
                ServerMsg::UserJoined {
                    user: User { id: peer_id.to_string(), nick: nick.clone() },
                },
            );
            tracing::info!(peer = %peer_id, %nick, "entrou");
        }

        ClientMsg::ChatSend { channel, text } => chat::send(state, peer_id, channel, &text).await,

        ClientMsg::VoiceJoin { channel } => voice::join(state, &peer_id.to_string(), &channel).await,
        ClientMsg::VoiceLeave => voice::leave(state, &peer_id.to_string()).await,
        ClientMsg::VoiceState { muted, deafened } => {
            voice::set_state(state, &peer_id.to_string(), muted, deafened).await
        }
        ClientMsg::RtcSignal { to, payload } => {
            voice::relay(state, &peer_id.to_string(), &to, payload).await
        }
    }
}

fn clean_nick(raw: &str) -> Option<String> {
    let nick: String = raw.trim().chars().filter(|c| !c.is_control()).take(24).collect();
    let nick = nick.trim().to_string();
    (!nick.is_empty()).then_some(nick)
}

#[cfg(test)]
mod tests {
    use super::clean_nick;

    #[test]
    fn sanitizes_and_limits_nicknames() {
        assert_eq!(clean_nick("  Da\0niel  "), Some("Daniel".into()));
        assert_eq!(clean_nick(" \n\t\0 "), None);
        assert_eq!(clean_nick(&"a".repeat(30)).unwrap().len(), 24);
    }
}
