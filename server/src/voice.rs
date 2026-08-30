//! Backend de voz. **Este e o ponto de troca para o SFU.**
//!
//! Hoje o backend e `mesh`: o servidor nao ve um byte de audio, so mantem o
//! roster de quem esta em cada call e repassa `rtc.signal` entre os pares.
//!
//! Quando virar SFU (LiveKit), o que muda e aqui dentro — `join` passa a emitir
//! um token JWT e devolve `VoiceConfig::Livekit` em vez de um roster, e o relay
//! de sinalizacao simplesmente deixa de existir. `ws.rs` continua so delegando,
//! e a UI escolhe o transporte lendo `VoiceConfig.backend`.

use std::sync::Arc;

use crate::channel::ChannelKind;
use crate::protocol::{PeerId, ServerMsg, VoiceConfig, VoicePeer};
use crate::state::{AppState, Target, VoiceJoinError};

/// O que vai no `welcome`. E daqui que o cliente descobre qual transporte usar.
pub fn client_config(state: &AppState) -> VoiceConfig {
    VoiceConfig::Mesh {
        ice_servers: state.config.voice.ice_servers.clone(),
        max_peers: state.config.voice.max_peers,
    }
}

/// Todo mundo que esta em alguma call, de qualquer canal.
pub async fn all_peers(state: &AppState) -> Vec<VoicePeer> {
    state.voice_peers().await
}

pub async fn join(state: &Arc<AppState>, peer_id: &PeerId, channel: &str) {
    match state.config.channel(channel) {
        Some(ch) if ch.kind == ChannelKind::Voice => {}
        Some(_) => return error(state, peer_id, "esse canal nao e de voz"),
        None => return error(state, peer_id, "canal nao existe"),
    }

    // Sai da call anterior antes de entrar em outra — ninguem fica em duas.
    leave(state, peer_id).await;

    let joined = match state.join_voice(peer_id, channel).await {
        Ok(joined) => joined,
        Err(VoiceJoinError::Full) => {
            return error(
                state,
                peer_id,
                &format!(
                    "a call ja esta com {} pessoas",
                    state.config.voice.max_peers
                ),
            );
        }
        Err(VoiceJoinError::PeerNotFound) => return,
        Err(VoiceJoinError::AccountAlreadyInVoice) => {
            return error(
                state,
                peer_id,
                "sua conta ja esta em uma call em outra sessao",
            );
        }
    };

    // Quem chega recebe a lista e e quem cria as offers; quem ja estava so
    // responde. E isso que evita glare — nao mexa na ordem.
    state.send_to(
        peer_id,
        ServerMsg::VoiceRoster {
            channel: channel.to_string(),
            peers: joined.roster,
        },
    );
    state.publish(
        Target::Except(peer_id.clone()),
        ServerMsg::VoiceJoined { peer: joined.peer },
    );
}

pub async fn leave(state: &Arc<AppState>, peer_id: &PeerId) {
    if state.leave_voice(peer_id).await {
        state.broadcast(ServerMsg::VoiceLeft {
            peer_id: peer_id.clone(),
        });
    }
}

pub async fn set_state(state: &Arc<AppState>, peer_id: &PeerId, muted: bool, deafened: bool) {
    if state.update_voice_state(peer_id, muted, deafened).await {
        state.broadcast(ServerMsg::VoiceStateChanged {
            peer_id: peer_id.clone(),
            muted,
            deafened,
        });
    }
}

/// Repassa offer/answer/ICE. O servidor nao le o `payload`.
pub async fn relay(state: &Arc<AppState>, from: &PeerId, to: &PeerId, payload: serde_json::Value) {
    // So entrega entre duas pessoas na mesma call — sem isso um cliente podia
    // disparar sinalizacao para qualquer um conectado.
    if state.shares_voice_channel(from, to).await {
        state.send_to(
            to,
            ServerMsg::RtcSignal {
                from: from.clone(),
                payload,
            },
        );
    }
}

fn error(state: &AppState, peer_id: &PeerId, message: &str) {
    state.send_to(
        peer_id,
        ServerMsg::Error {
            message: message.to_string(),
        },
    );
}

#[cfg(test)]
mod tests {
    use tokio::sync::broadcast::error::TryRecvError;

    use super::*;
    use crate::state::Target;
    use crate::test_support::TestServer;

    #[tokio::test]
    async fn sends_roster_before_announcing_a_voice_join() {
        let server = TestServer::new(10, 4);
        let first = "first".to_string();
        let second = "second".to_string();
        let first_account = server.account("First");
        let second_account = server.account("Second");
        server
            .state
            .register_session(&first, &first_account)
            .await
            .unwrap();
        server
            .state
            .register_session(&second, &second_account)
            .await
            .unwrap();
        let mut events = server.state.subscribe();

        join(&server.state, &first, "voz-a").await;
        let first_roster = events.try_recv().unwrap();
        let first_joined = events.try_recv().unwrap();
        assert!(matches!(first_roster.target, Target::Peer(ref id) if id == &first));
        assert!(matches!(
            first_roster.msg,
            ServerMsg::VoiceRoster { ref peers, .. } if peers.is_empty()
        ));
        assert!(matches!(first_joined.target, Target::Except(ref id) if id == &first));
        assert!(matches!(
            first_joined.msg,
            ServerMsg::VoiceJoined { ref peer } if peer.peer_id == first
        ));

        join(&server.state, &second, "voz-a").await;
        let second_roster = events.try_recv().unwrap();
        let second_joined = events.try_recv().unwrap();
        assert!(matches!(
            second_roster.msg,
            ServerMsg::VoiceRoster { ref peers, .. }
                if peers.len() == 1 && peers[0].peer_id == first
        ));
        assert!(matches!(second_joined.target, Target::Except(ref id) if id == &second));
        assert!(matches!(
            second_joined.msg,
            ServerMsg::VoiceJoined { ref peer } if peer.peer_id == second
        ));
    }

    #[tokio::test]
    async fn relays_signaling_only_inside_the_same_voice_channel() {
        let server = TestServer::new(10, 4);
        let first = "first".to_string();
        let second = "second".to_string();
        let first_account = server.account("First");
        let second_account = server.account("Second");
        server
            .state
            .register_session(&first, &first_account)
            .await
            .unwrap();
        server
            .state
            .register_session(&second, &second_account)
            .await
            .unwrap();
        server.state.join_voice(&first, "voz-a").await.unwrap();
        server.state.join_voice(&second, "voz-b").await.unwrap();
        let mut events = server.state.subscribe();

        relay(
            &server.state,
            &first,
            &second,
            serde_json::json!({ "kind": "blocked" }),
        )
        .await;
        assert!(matches!(events.try_recv(), Err(TryRecvError::Empty)));

        server.state.join_voice(&second, "voz-a").await.unwrap();
        relay(
            &server.state,
            &first,
            &second,
            serde_json::json!({ "kind": "allowed" }),
        )
        .await;

        let event = events.try_recv().unwrap();
        assert!(matches!(event.target, Target::Peer(ref id) if id == &second));
        assert!(matches!(
            event.msg,
            ServerMsg::RtcSignal { ref from, ref payload }
                if from == &first && payload["kind"] == "allowed"
        ));
    }
}
