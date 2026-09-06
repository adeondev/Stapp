//! Autoridade de chamadas do Stapp.
//!
//! O LiveKit SFU e o backend padrao e definitivo para chamadas de voz, video e
//! streaming. `voice.join` reserva a vaga e entrega um grant efemero; a presenca
//! so e publicada depois de `voice.connected`, quando o cliente confirma que
//! chegou ao SFU. O relay manual de sinalizacao WebRTC foi aposentado.

mod livekit;

use std::sync::Arc;
use std::time::Duration;

use crate::config::ChannelKind;
use crate::protocol::{PeerId, ServerMsg, UserId, VoiceConfig, VoiceDeniedCode, VoicePeer};
use crate::session::{AppState, Target, VoiceJoin, VoiceJoinError};
use crate::storage::conversation_id;

const DIRECT_MAX_PEERS: usize = 2;
const DIRECT_PREFIX: &str = "dm:";

pub use livekit::is_configured;
pub use livekit::validate_backend;

pub fn is_enabled(config: &crate::config::VoiceSettings) -> bool {
    match config.backend.as_str() {
        "disabled" | "none" => false,
        "livekit" => is_configured(config),
        "mesh" => true,
        _ => false,
    }
}

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
    if state.config.voice.backend == "disabled" || state.config.voice.backend == "none" {
        denied(
            state,
            peer_id,
            channel,
            VoiceDeniedCode::Unavailable,
            "Modulo de voz desativado neste servidor",
        );
        return;
    }

    let Some(max_peers) = authorize_channel(state, peer_id, channel).await else {
        return;
    };

    leave(state, peer_id).await;

    if state.config.voice.backend == "livekit" {
        return join_livekit(state, peer_id, channel, max_peers).await;
    }

    match state.join_voice(peer_id, channel, max_peers).await {
        Ok((joined, takeovers)) => {
            for takeover in &takeovers {
                handle_takeover(state, takeover).await;
            }
            publish_join(state, peer_id, channel, joined).await;
        }
        Err(error) => deny_join_error(state, peer_id, channel, max_peers, error),
    }
}

async fn handle_takeover(state: &AppState, takeover: &crate::session::VoiceTakeover) {
    tracing::info!(
        old_peer = %takeover.old_peer_id,
        channel = %takeover.channel,
        published = takeover.published,
        "executando takeover de sessao de voz antiga da mesma conta"
    );
    if state.config.voice.backend == "livekit" {
        if let Err(err) = livekit::remove_participant(state, &takeover.old_peer_id, &takeover.channel).await {
            tracing::warn!(old_peer = %takeover.old_peer_id, %err, "falha removendo participante antigo do LiveKit no takeover");
        }
    }
    if takeover.published {
        anunciar(
            state,
            &takeover.channel,
            None,
            ServerMsg::VoiceLeft {
                peer_id: takeover.old_peer_id.clone(),
            },
        )
        .await;
        broadcast_roster(state, &takeover.channel).await;
    }
    state.send_to(
        &takeover.old_peer_id,
        ServerMsg::VoiceLeft {
            peer_id: takeover.old_peer_id.clone(),
        },
    );
    // O takeover devolve a vaga de audio, nao a conexao: `reserve_voice`/`join_voice`
    // ja fizeram `entry.voice.take()` na sessao antiga. Derrubar a sessao inteira aqui
    // deixaria o cliente anterior com o socket aberto e sem identidade — uma sessao
    // zumbi que continua lendo o chat e tem tudo que envia descartado em silencio.
    // Quem encerra sessao e `handle_connection_drop`, que sabe anunciar `user.offline`.
}

pub async fn handle_connection_drop(state: Arc<AppState>, peer_id: PeerId) {
    if state.config.voice.backend != "livekit" || !state.is_in_voice(&peer_id).await {
        leave(&state, &peer_id).await;
        if let Some(removal) = state.remove_session(&peer_id).await {
            if removal.last_session {
                crate::services::call::drop_for(&state, &removal.user_id).await;
                state.broadcast(ServerMsg::UserOffline {
                    user_id: removal.user_id,
                });
            }
        }
        return;
    }

    state.mark_session_disconnected(&peer_id).await;

    tokio::spawn(async move {
        tracing::info!(peer = %peer_id, "grace period de 20s para voz iniciado apos queda de conexao");
        tokio::time::sleep(Duration::from_secs(20)).await;

        if state.is_in_voice(&peer_id).await {
            tracing::info!(peer = %peer_id, "grace period expirado sem reconexao; encerrando participacao de voz");
            leave(&state, &peer_id).await;
        }
        if let Some(removal) = state.remove_session(&peer_id).await {
            if removal.last_session {
                crate::services::call::drop_for(&state, &removal.user_id).await;
                state.broadcast(ServerMsg::UserOffline {
                    user_id: removal.user_id,
                });
            }
        }
    });
}

async fn join_livekit(state: &AppState, peer_id: &PeerId, channel: &str, max_peers: usize) {
    if !livekit::is_configured(&state.config.voice) {
        denied(
            state,
            peer_id,
            channel,
            VoiceDeniedCode::Unavailable,
            "Servico de voz nao configurado neste servidor",
        );
        return;
    }

    let takeovers = match state
        .reserve_voice(peer_id, channel, max_peers, livekit::RESERVATION_TTL)
        .await
    {
        Ok(t) => t,
        Err(error) => return deny_join_error(state, peer_id, channel, max_peers, error),
    };

    for takeover in &takeovers {
        handle_takeover(state, takeover).await;
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
        broadcast_roster(state, &channel).await;
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
    broadcast_roster(state, channel).await;
    anunciar(
        state,
        channel,
        Some(peer_id),
        ServerMsg::VoiceJoined { peer: joined.peer },
    )
    .await;
}

async fn broadcast_roster(state: &AppState, channel: &str) {
    let peers: Vec<VoicePeer> = state
        .voice_peers()
        .await
        .into_iter()
        .filter(|p| p.channel == channel)
        .collect();

    let msg = ServerMsg::VoiceRoster {
        channel: channel.to_string(),
        peers: peers.clone(),
    };

    for peer in &peers {
        state.send_to(&peer.peer_id, msg.clone());
    }
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
