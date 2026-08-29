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

use crate::config::ChannelKind;
use crate::protocol::{PeerId, ServerMsg, VoiceConfig, VoicePeer};
use crate::state::{AppState, Target, VoiceMembership};

/// O que vai no `welcome`. E daqui que o cliente descobre qual transporte usar.
pub fn client_config(state: &AppState) -> VoiceConfig {
    VoiceConfig::Mesh {
        ice_servers: state.config.voice.ice_servers.clone(),
        max_peers: state.config.voice.max_peers,
    }
}

/// Todo mundo que esta em alguma call, de qualquer canal.
pub async fn all_peers(state: &AppState) -> Vec<VoicePeer> {
    let users = state.users.read().await;
    users
        .iter()
        .filter_map(|(id, u)| {
            let v = u.voice.as_ref()?;
            Some(VoicePeer {
                id: id.clone(),
                nick: u.nick.clone(),
                channel: v.channel.clone(),
                muted: v.muted,
                deafened: v.deafened,
            })
        })
        .collect()
}

pub async fn join(state: &Arc<AppState>, peer_id: &PeerId, channel: &str) {
    match state.config.channel(channel) {
        Some(ch) if ch.kind == ChannelKind::Voice => {}
        Some(_) => return error(state, peer_id, "esse canal nao e de voz"),
        None => return error(state, peer_id, "canal nao existe"),
    }

    // Sai da call anterior antes de entrar em outra — ninguem fica em duas.
    leave(state, peer_id).await;

    let (roster, me) = {
        let mut users = state.users.write().await;

        let occupied = users
            .values()
            .filter(|u| u.voice.as_ref().is_some_and(|v| v.channel == channel))
            .count();
        if occupied >= state.config.voice.max_peers {
            drop(users);
            return error(
                state,
                peer_id,
                &format!("a call ja esta com {} pessoas", state.config.voice.max_peers),
            );
        }

        // Montado antes de entrar, entao nunca inclui quem esta chegando.
        let roster: Vec<VoicePeer> = users
            .iter()
            .filter_map(|(id, u)| {
                let v = u.voice.as_ref().filter(|v| v.channel == channel)?;
                Some(VoicePeer {
                    id: id.clone(),
                    nick: u.nick.clone(),
                    channel: v.channel.clone(),
                    muted: v.muted,
                    deafened: v.deafened,
                })
            })
            .collect();

        let Some(entry) = users.get_mut(peer_id) else { return };
        entry.voice = Some(VoiceMembership {
            channel: channel.to_string(),
            muted: false,
            deafened: false,
        });

        let me = VoicePeer {
            id: peer_id.clone(),
            nick: entry.nick.clone(),
            channel: channel.to_string(),
            muted: false,
            deafened: false,
        };
        (roster, me)
    };

    // Quem chega recebe a lista e e quem cria as offers; quem ja estava so
    // responde. E isso que evita glare — nao mexa na ordem.
    state.send_to(peer_id, ServerMsg::VoiceRoster { channel: channel.to_string(), peers: roster });
    state.publish(Target::Except(peer_id.clone()), ServerMsg::VoiceJoined { peer: me });
}

pub async fn leave(state: &Arc<AppState>, peer_id: &PeerId) {
    let was_in_call = {
        let mut users = state.users.write().await;
        match users.get_mut(peer_id) {
            Some(entry) => entry.voice.take().is_some(),
            None => false,
        }
    };

    if was_in_call {
        state.broadcast(ServerMsg::VoiceLeft { peer_id: peer_id.clone() });
    }
}

pub async fn set_state(state: &Arc<AppState>, peer_id: &PeerId, muted: bool, deafened: bool) {
    let changed = {
        let mut users = state.users.write().await;
        match users.get_mut(peer_id).and_then(|u| u.voice.as_mut()) {
            Some(v) => {
                v.muted = muted;
                v.deafened = deafened;
                true
            }
            None => false,
        }
    };

    if changed {
        state.broadcast(ServerMsg::VoiceStateChanged {
            peer_id: peer_id.clone(),
            muted,
            deafened,
        });
    }
}

/// Repassa offer/answer/ICE. O servidor nao le o `payload`.
pub async fn relay(
    state: &Arc<AppState>,
    from: &PeerId,
    to: &PeerId,
    payload: serde_json::Value,
) {
    // So entrega entre duas pessoas na mesma call — sem isso um cliente podia
    // disparar sinalizacao para qualquer um conectado.
    let same_call = {
        let users = state.users.read().await;
        match (users.get(from), users.get(to)) {
            (Some(a), Some(b)) => match (&a.voice, &b.voice) {
                (Some(va), Some(vb)) => va.channel == vb.channel,
                _ => false,
            },
            _ => false,
        }
    };

    if same_call {
        state.send_to(to, ServerMsg::RtcSignal { from: from.clone(), payload });
    }
}

fn error(state: &AppState, peer_id: &PeerId, message: &str) {
    state.send_to(peer_id, ServerMsg::Error { message: message.to_string() });
}
