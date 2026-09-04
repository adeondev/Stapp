//! Autoridade de chamadas do Stapp.
//!
//! O LiveKit SFU e o backend padrao e definitivo para chamadas de voz, video e
//! streaming. `voice.join` reserva a vaga e entrega um grant efemero; a presenca
//! so e publicada depois de `voice.connected`, quando o cliente confirma que
//! chegou ao SFU. O relay manual de sinalizacao WebRTC foi aposentado.

mod livekit;

use crate::config::ChannelKind;
use crate::protocol::{PeerId, ServerMsg, UserId, VoiceConfig, VoiceDeniedCode, VoicePeer};
use crate::session::{AppState, Target, VoiceJoin, VoiceJoinError};
use crate::storage::conversation_id;

const DIRECT_MAX_PEERS: usize = 2;
const DIRECT_PREFIX: &str = "dm:";

pub use livekit::validate_backend;

pub fn direct_channel(a: &UserId, b: &UserId) -> String {
    format!("{DIRECT_PREFIX}{}", conversation_id(a, b))
}

pub async fn disconnect_direct(state: &AppState, first: &UserId, second: &UserId) {
    state.close_direct_call(first, second).await;
    let channel = direct_channel(first, second);
    let peers = state.voice_sessions_including_reservations(&channel).await;
    for peer in peers {
        leave(state, &peer).await;
    }
}

pub fn direct_participants(channel: &str) -> Option<(UserId, UserId)> {
    let (a, b) = channel.strip_prefix(DIRECT_PREFIX)?.split_once(':')?;
    if a.is_empty() || b.is_empty() || b.contains(':') {
        return None;
    }
    Some((a.to_string(), b.to_string()))
}

pub fn client_config(state: &AppState) -> VoiceConfig {
    match state.config.voice.backend.as_str() {
        "livekit" => VoiceConfig::Livekit {
            max_peers: state.config.voice.max_peers,
            camera: true,
            screen_share: true,
            screen_audio: true,
        },
        _ => VoiceConfig::Mesh {
            ice_servers: state.config.voice.ice_servers.clone(),
            max_peers: state.config.voice.max_peers,
        },
    }
}

pub async fn all_peers(state: &AppState) -> Vec<VoicePeer> {
    state
        .voice_peers()
        .await
        .into_iter()
        .filter(|peer| direct_participants(&peer.channel).is_none())
        .collect()
}

pub async fn join(state: &AppState, peer_id: &PeerId, channel: &str) {
    let Some(max_peers) = authorize_channel(state, peer_id, channel).await else {
        return;
    };

    leave(state, peer_id).await;

    if state.config.voice.backend == "livekit" {
        return join_livekit(state, peer_id, channel, max_peers).await;
    }

    match state.join_voice(peer_id, channel, max_peers).await {
        Ok(joined) => publish_join(state, peer_id, channel, joined).await,
        Err(error) => deny_join_error(state, peer_id, channel, max_peers, error),
    }
}

async fn join_livekit(state: &AppState, peer_id: &PeerId, channel: &str, max_peers: usize) {
    if let Err(error) = state
        .reserve_voice(peer_id, channel, max_peers, livekit::RESERVATION_TTL)
        .await
    {
        return deny_join_error(state, peer_id, channel, max_peers, error);
    }

    match livekit::issue_grant(state, peer_id, channel).await {
        Ok(grant) => state.send_to(
            peer_id,
            ServerMsg::VoiceGrant {
                channel: channel.to_string(),
                url: grant.url,
                token: grant.token,
                expires_at: grant.expires_at,
            },
        ),
        Err(err) => {
            state.cancel_voice_reservation(peer_id).await;
            tracing::warn!(peer = %peer_id, %err, "midia LiveKit indisponivel");
            denied(
                state,
                peer_id,
                channel,
                VoiceDeniedCode::Unavailable,
                "Midia temporariamente indisponivel",
            );
        }
    }
}

pub async fn connected(state: &AppState, peer_id: &PeerId, channel: &str) {
    if state.config.voice.backend != "livekit" {
        return;
    }
    if authorize_channel(state, peer_id, channel).await.is_none() {
        state.cancel_voice_reservation(peer_id).await;
        if let Err(err) = livekit::remove_participant(state, peer_id, channel).await {
            tracing::warn!(peer = %peer_id, %err, "nao foi possivel revogar grant sem autorizacao");
        }
        return;
    }
    match livekit::participant_connected(state, peer_id, channel).await {
        Ok(true) => {}
        Ok(false) => {
            state.cancel_voice_reservation(peer_id).await;
            denied(
                state,
                peer_id,
                channel,
                VoiceDeniedCode::MediaFailure,
                "Nao foi possivel confirmar a conexao de midia",
            );
            return;
        }
        Err(err) => {
            state.cancel_voice_reservation(peer_id).await;
            tracing::warn!(peer = %peer_id, %err, "falha ao confirmar participante no LiveKit");
            denied(
                state,
                peer_id,
                channel,
                VoiceDeniedCode::Unavailable,
                "Midia temporariamente indisponivel",
            );
            return;
        }
    }
    match state.confirm_voice(peer_id, channel).await {
        Ok(joined) => publish_join(state, peer_id, channel, joined).await,
        Err(VoiceJoinError::GrantExpired | VoiceJoinError::NoReservation) => denied(
            state,
            peer_id,
            channel,
            VoiceDeniedCode::GrantExpired,
            "A autorizacao de midia expirou; tente entrar novamente",
        ),
        Err(error) => deny_join_error(state, peer_id, channel, state.config.voice.max_peers, error),
    }
}

pub async fn leave(state: &AppState, peer_id: &PeerId) {
    let Some(departure) = state.leave_voice(peer_id).await else {
        state.cancel_voice_reservation(peer_id).await;
        return;
    };
    let channel = departure.channel;

    if state.config.voice.backend == "livekit"
        && let Err(err) = livekit::remove_participant(state, peer_id, &channel).await
    {
        tracing::warn!(peer = %peer_id, %err, "nao foi possivel remover participante do LiveKit");
    }

    if departure.published {
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

    if let Some((first, second)) = direct_participants(&channel) {
        let still_active = state
            .voice_peers()
            .await
            .iter()
            .any(|peer| peer.channel == channel);
        if !still_active {
            state.close_direct_call(&first, &second).await;
        }
    }
}

pub async fn set_state(
    state: &AppState,
    peer_id: &PeerId,
    muted: bool,
    deafened: bool,
    camera_enabled: bool,
    screen_sharing: bool,
) {
    let Some(channel) = state
        .update_voice_state(peer_id, muted, deafened, camera_enabled, screen_sharing)
        .await
    else {
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
            camera_enabled,
            screen_sharing,
        },
    )
    .await;
}

pub async fn relay(_state: &AppState, from: &PeerId, to: &PeerId, _payload: serde_json::Value) {
    // Relay de sinalizacao WebRTC mesh aposentado: LiveKit SFU gerencia toda sinalizacao de midia diretamente.
    tracing::debug!(
        from = %from,
        to = %to,
        "rtc signaling relay e no-op: LiveKit SFU gerencia a midia diretamente"
    );
}

async fn authorize_channel(state: &AppState, peer_id: &PeerId, channel: &str) -> Option<usize> {
    match direct_participants(channel) {
        Some((first, second)) => {
            let Some(me) = state.identity_of(peer_id).await else {
                return None;
            };
            let owns_channel = me.user_id == first || me.user_id == second;
            let accepted = state.is_direct_call_authorized(&first, &second).await;
            if !owns_channel || !accepted {
                denied(
                    state,
                    peer_id,
                    channel,
                    VoiceDeniedCode::Forbidden,
                    "Nao foi possivel entrar nesta chamada",
                );
                return None;
            }
            Some(DIRECT_MAX_PEERS)
        }
        None => match state.config.channel(channel) {
            Some(ch) if ch.kind == ChannelKind::Voice => Some(state.config.voice.max_peers),
            _ => {
                denied(
                    state,
                    peer_id,
                    channel,
                    VoiceDeniedCode::Forbidden,
                    "Canal de voz indisponivel",
                );
                None
            }
        },
    }
}

async fn publish_join(state: &AppState, peer_id: &PeerId, channel: &str, joined: VoiceJoin) {
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

fn deny_join_error(
    state: &AppState,
    peer_id: &PeerId,
    channel: &str,
    max_peers: usize,
    error: VoiceJoinError,
) {
    let (code, message) = match error {
        VoiceJoinError::Full => (
            VoiceDeniedCode::Full,
            format!("A chamada ja esta com {max_peers} pessoas"),
        ),
        VoiceJoinError::AccountAlreadyInVoice => (
            VoiceDeniedCode::AlreadyConnected,
            "Sua conta ja esta em uma chamada em outra sessao".into(),
        ),
        VoiceJoinError::GrantExpired | VoiceJoinError::NoReservation => (
            VoiceDeniedCode::GrantExpired,
            "A autorizacao de midia expirou; tente novamente".into(),
        ),
        VoiceJoinError::PeerNotFound => return,
    };
    denied(state, peer_id, channel, code, &message);
}

fn denied(state: &AppState, peer_id: &PeerId, channel: &str, code: VoiceDeniedCode, message: &str) {
    state.send_to(
        peer_id,
        ServerMsg::VoiceDenied {
            channel: channel.to_string(),
            code,
            message: message.to_string(),
        },
    );
}

async fn anunciar(state: &AppState, channel: &str, exceto: Option<&PeerId>, msg: ServerMsg) {
    match direct_participants(channel) {
        None => match exceto {
            Some(peer_id) => state.publish(Target::Except(peer_id.clone()), msg),
            None => state.broadcast(msg),
        },
        Some((first, second)) => {
            let mut targets = state.sessions_of(&first).await;
            targets.extend(state.sessions_of(&second).await);
            for target in targets {
                if Some(&target) != exceto {
                    state.send_to(&target, msg.clone());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
