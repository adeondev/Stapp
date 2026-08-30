//! Integracao estreita com o LiveKit. Segredos entram somente pelas variaveis
//! nomeadas no TOML e nunca sao anexados ao estado, serializados ou logados.

use std::time::Duration;

use anyhow::{Context, Result, bail};
use livekit_api::access_token::{AccessToken, VideoGrants};
use livekit_api::services::room::RoomClient;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::config::VoiceSettings;
use crate::protocol::{PeerId, SecretString, now_ms};
use crate::session::AppState;

pub(super) const GRANT_TTL: Duration = Duration::from_secs(60);
pub(super) const RESERVATION_TTL: Duration = Duration::from_secs(15);

pub(super) struct Grant {
    pub url: String,
    pub token: SecretString,
    pub expires_at: i64,
}

struct Credentials {
    key: String,
    secret: String,
}

pub fn validate_backend(config: &VoiceSettings) -> Result<()> {
    if config.backend != "livekit" {
        return Ok(());
    }
    let _ = credentials(config)?;
    Ok(())
}

pub(super) fn room_name(server_id: &str, channel: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"stapp-livekit-room-v1\0");
    digest.update(server_id.as_bytes());
    digest.update([0]);
    digest.update(channel.as_bytes());
    let hash = digest.finalize();
    let mut result = String::with_capacity(35);
    result.push_str("st_");
    for byte in &hash[..16] {
        use std::fmt::Write;
        write!(&mut result, "{byte:02x}").expect("escrever em String nao falha");
    }
    result
}

pub(super) async fn issue_grant(
    state: &AppState,
    peer_id: &PeerId,
    channel: &str,
) -> Result<Grant> {
    let config = &state.config.voice;
    let creds = credentials(config)?;
    let public_url = config
        .public_url
        .clone()
        .context("voice.public_url ausente")?;
    let server_id = state.db.server_id().context("server_id indisponivel")?;
    let room = room_name(&server_id, channel);
    let identity = state
        .identity_of(peer_id)
        .await
        .context("sessao nao encontrada")?;

    // Lista explicita: nada de dados, administracao, gravacao, ingress/egress
    // ou publicacao de fontes que o Stapp nao conhece.
    let grants = VideoGrants {
        room_join: true,
        room,
        can_publish: true,
        can_subscribe: true,
        can_publish_data: false,
        can_publish_sources: vec![
            "microphone".into(),
            "camera".into(),
            "screen_share".into(),
            "screen_share_audio".into(),
        ],
        ..Default::default()
    };
    let jwt = AccessToken::with_api_key(&creds.key, &creds.secret)
        .with_identity(peer_id)
        .with_name(&identity.username)
        .with_attributes([("stapp.grant", Uuid::new_v4().to_string())])
        .with_ttl(GRANT_TTL)
        .with_grants(grants)
        .to_jwt()
        .context("nao foi possivel assinar grant de midia")?;

    Ok(Grant {
        url: public_url,
        token: SecretString::new(jwt),
        expires_at: now_ms() + GRANT_TTL.as_millis() as i64,
    })
}

pub(super) async fn remove_participant(
    state: &AppState,
    peer_id: &PeerId,
    channel: &str,
) -> Result<()> {
    let config = &state.config.voice;
    if config.backend != "livekit" {
        return Ok(());
    }
    let creds = credentials(config)?;
    let api_url = config.api_url.as_deref().context("voice.api_url ausente")?;
    let server_id = state.db.server_id().context("server_id indisponivel")?;
    let room = room_name(&server_id, channel);
    RoomClient::with_api_key(api_url, &creds.key, &creds.secret)
        .with_failover(false)
        .with_request_timeout(Duration::from_secs(3))
        .remove_participant(&room, peer_id)
        .await
        .context("LiveKit recusou a remocao do participante")
}

/// Nao confiamos apenas no `voice.connected` do cliente: antes de publicar a
/// presenca, o Stapp pergunta ao SFU se aquela identidade realmente entrou na
/// sala opaca esperada.
pub(super) async fn participant_connected(
    state: &AppState,
    peer_id: &PeerId,
    channel: &str,
) -> Result<bool> {
    let config = &state.config.voice;
    let creds = credentials(config)?;
    let api_url = config.api_url.as_deref().context("voice.api_url ausente")?;
    let server_id = state.db.server_id().context("server_id indisponivel")?;
    let room = room_name(&server_id, channel);
    let result = RoomClient::with_api_key(api_url, &creds.key, &creds.secret)
        .with_failover(false)
        .with_request_timeout(Duration::from_secs(3))
        .get_participant(&room, peer_id)
        .await;
    match result {
        Ok(participant) => Ok(participant.identity == *peer_id),
        Err(livekit_api::services::ServiceError::Twirp(
            livekit_api::services::ServerError::Twirp(code),
        )) if code.code == livekit_api::services::ServerErrorCode::NOT_FOUND => Ok(false),
        Err(error) => Err(error).context("nao foi possivel confirmar o participante no LiveKit"),
    }
}

fn credentials(config: &VoiceSettings) -> Result<Credentials> {
    let key = std::env::var(&config.api_key_env)
        .with_context(|| format!("variavel {} nao definida", config.api_key_env))?;
    let secret = std::env::var(&config.api_secret_env)
        .with_context(|| format!("variavel {} nao definida", config.api_secret_env))?;
    if key.trim().is_empty() || secret.trim().is_empty() {
        bail!("credenciais LiveKit vazias");
    }
    Ok(Credentials { key, secret })
}

#[cfg(test)]
mod tests;
