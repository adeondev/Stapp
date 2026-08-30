//! Backend de voz. **Este e o ponto de troca para o SFU.**
//!
//! Hoje o backend e `mesh`: o servidor nao ve um byte de audio, so mantem o
//! roster de quem esta em cada call e repassa `rtc.signal` entre os pares.
//!
//! Quando virar SFU (LiveKit), o que muda e aqui dentro — `join` passa a emitir
//! um token JWT e devolve `VoiceConfig::Livekit` em vez de um roster, e o relay
//! de sinalizacao simplesmente deixa de existir. `ws.rs` continua so delegando,
//! e a UI escolhe o transporte lendo `VoiceConfig.backend`.
//!
//! ## Dois tipos de canal
//!
//! - **sala**: declarada no stapp.toml, aberta a todo mundo do servidor;
//! - **conversa direta**: `dm:<a>:<b>`, so os dois donos entram.
//!
//! A diferenca nao e so quem entra: e **quem fica sabendo**. Numa sala, entrar e
//! sair sao eventos publicos. Numa direta, contar para o servidor inteiro
//! revelaria quem esta falando com quem — entao os avisos vao so para os dois.

use crate::config::ChannelKind;
use crate::protocol::{PeerId, ServerMsg, UserId, VoiceConfig, VoicePeer};
use crate::session::{AppState, Target, VoiceJoinError};
use crate::storage::conversation_id;

/// Numa conversa direta a call e sempre entre duas pessoas.
const DIRECT_MAX_PEERS: usize = 2;
const DIRECT_PREFIX: &str = "dm:";

/// O canal de voz de uma conversa direta. O mesmo par sempre gera o mesmo nome,
/// dos dois lados, sem ninguem combinar nada.
pub fn direct_channel(a: &UserId, b: &UserId) -> String {
    format!("{DIRECT_PREFIX}{}", conversation_id(a, b))
}

/// Remove as duas pontas de uma voz direta quando uma delas bloqueia a outra.
/// Salas publicas nao sao afetadas.
pub async fn disconnect_direct(state: &AppState, first: &UserId, second: &UserId) {
    let channel = direct_channel(first, second);
    let peers: Vec<_> = state
        .voice_peers()
        .await
        .into_iter()
        .filter(|peer| peer.channel == channel)
        .map(|peer| peer.peer_id)
        .collect();
    for peer in peers {
        leave(state, &peer).await;
    }
}

/// As duas contas donas de um canal `dm:<a>:<b>`, se for um.
pub fn direct_participants(channel: &str) -> Option<(UserId, UserId)> {
    let (a, b) = channel.strip_prefix(DIRECT_PREFIX)?.split_once(':')?;
    if a.is_empty() || b.is_empty() || b.contains(':') {
        return None;
    }
    Some((a.to_string(), b.to_string()))
}

/// O que vai no `welcome`. E daqui que o cliente descobre qual transporte usar.
pub fn client_config(state: &AppState) -> VoiceConfig {
    VoiceConfig::Mesh {
        ice_servers: state.config.voice.ice_servers.clone(),
        max_peers: state.config.voice.max_peers,
    }
}

/// Todo mundo que esta em alguma call, de qualquer canal.
///
/// PROTOTYPE: o welcome so leva as salas. Uma call direta em andamento nao
/// aparece para terceiros — e nem deveria.
pub async fn all_peers(state: &AppState) -> Vec<VoicePeer> {
    state
        .voice_peers()
        .await
        .into_iter()
        .filter(|peer| direct_participants(&peer.channel).is_none())
        .collect()
}

pub async fn join(state: &AppState, peer_id: &PeerId, channel: &str) {
    let max_peers = match direct_participants(channel) {
        Some((a, b)) => {
            let Some(me) = state.identity_of(peer_id).await else {
                return;
            };
            // Sem esta guarda qualquer um poderia entrar na conversa dos outros
            // so adivinhando o nome do canal.
            if me.user_id != a && me.user_id != b {
                return error(state, peer_id, "essa conversa nao e sua");
            }
            DIRECT_MAX_PEERS
        }
        None => match state.config.channel(channel) {
            Some(ch) if ch.kind == ChannelKind::Voice => state.config.voice.max_peers,
            Some(_) => return error(state, peer_id, "esse canal nao e de voz"),
            None => return error(state, peer_id, "canal nao existe"),
        },
    };

    // Sai da call anterior antes de entrar em outra — ninguem fica em duas.
    leave(state, peer_id).await;

    let joined = match state.join_voice(peer_id, channel, max_peers).await {
        Ok(joined) => joined,
        Err(VoiceJoinError::Full) => {
            return error(
                state,
                peer_id,
                &format!("a call ja esta com {max_peers} pessoas"),
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
    anunciar(
        state,
        channel,
        Some(peer_id),
        ServerMsg::VoiceJoined { peer: joined.peer },
    )
    .await;
}

pub async fn leave(state: &AppState, peer_id: &PeerId) {
    let Some(channel) = state.leave_voice(peer_id).await else {
        return;
    };
    anunciar(
        state,
        &channel,
        None,
        ServerMsg::VoiceLeft {
            peer_id: peer_id.clone(),
        },
    )
    .await;
}

pub async fn set_state(state: &AppState, peer_id: &PeerId, muted: bool, deafened: bool) {
    let Some(channel) = state.update_voice_state(peer_id, muted, deafened).await else {
        return;
    };
    anunciar(
        state,
        &channel,
        None,
        ServerMsg::VoiceStateChanged {
            peer_id: peer_id.clone(),
            muted,
            deafened,
        },
    )
    .await;
}

/// Repassa offer/answer/ICE. O servidor nao le o `payload`.
pub async fn relay(state: &AppState, from: &PeerId, to: &PeerId, payload: serde_json::Value) {
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

/// Conta o evento a quem tem direito de saber: o servidor todo, se for sala;
/// so os dois donos, se for conversa direta.
async fn anunciar(state: &AppState, channel: &str, exceto: Option<&PeerId>, msg: ServerMsg) {
    match direct_participants(channel) {
        None => match exceto {
            Some(peer_id) => state.publish(Target::Except(peer_id.clone()), msg),
            None => state.broadcast(msg),
        },
        Some((a, b)) => {
            let mut destinos = state.sessions_of(&a).await;
            destinos.extend(state.sessions_of(&b).await);
            for destino in destinos {
                if Some(&destino) == exceto {
                    continue;
                }
                state.send_to(&destino, msg.clone());
            }
        }
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
mod tests;
