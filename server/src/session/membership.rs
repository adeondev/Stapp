//! Quem esta em qual call.
//!
//! So o estado — quem avisa os outros e o servico de voz.

use super::{AppState, SessionEntry};
use crate::protocol::{PeerId, VoicePeer};

#[derive(Debug, Clone)]
pub(super) struct VoiceMembership {
    pub channel: String,
    pub muted: bool,
    pub deafened: bool,
}

pub struct VoiceJoin {
    /// Quem ja estava na call, sem incluir quem acabou de entrar.
    pub roster: Vec<VoicePeer>,
    pub peer: VoicePeer,
}

#[derive(Debug)]
pub enum VoiceJoinError {
    PeerNotFound,
    Full,
    AccountAlreadyInVoice,
}

impl AppState {
    pub async fn voice_peers(&self) -> Vec<VoicePeer> {
        let sessions = self.sessions.read().await;
        sessions
            .iter()
            .filter_map(|(id, entry)| voice_peer(id, entry))
            .collect()
    }

    /// `max_peers` vem de fora porque o limite depende do canal: uma sala usa o
    /// do stapp.toml, uma conversa direta e sempre 2.
    pub async fn join_voice(
        &self,
        peer_id: &PeerId,
        channel: &str,
        max_peers: usize,
    ) -> Result<VoiceJoin, VoiceJoinError> {
        let mut sessions = self.sessions.write().await;

        let user_id = sessions
            .get(peer_id)
            .map(|entry| entry.user_id.clone())
            .ok_or(VoiceJoinError::PeerNotFound)?;

        // PROTOTYPE: so uma sessao da conta participa de voz. FUTURE: remova apenas
        // esta guarda para permitir peers por sessao; o protocolo ja leva os dois IDs.
        if sessions
            .iter()
            .any(|(id, entry)| id != peer_id && entry.user_id == user_id && entry.voice.is_some())
        {
            return Err(VoiceJoinError::AccountAlreadyInVoice);
        }

        let occupied = sessions
            .values()
            .filter(|entry| entry.is_in(channel))
            .count();
        if occupied >= max_peers {
            return Err(VoiceJoinError::Full);
        }

        // Montado antes de entrar, entao nunca inclui quem esta chegando.
        let roster = sessions
            .iter()
            .filter(|(_, entry)| entry.is_in(channel))
            .filter_map(|(id, entry)| voice_peer(id, entry))
            .collect();

        let entry = sessions
            .get_mut(peer_id)
            .ok_or(VoiceJoinError::PeerNotFound)?;
        entry.voice = Some(VoiceMembership {
            channel: channel.to_string(),
            muted: false,
            deafened: false,
        });
        let peer = voice_peer(peer_id, entry).expect("membership acabou de ser criada");

        Ok(VoiceJoin { roster, peer })
    }

    /// Devolve o canal de onde a pessoa saiu — quem avisa precisa saber para
    /// escolher a quem contar.
    pub async fn leave_voice(&self, peer_id: &PeerId) -> Option<String> {
        let mut sessions = self.sessions.write().await;
        sessions
            .get_mut(peer_id)?
            .voice
            .take()
            .map(|voice| voice.channel)
    }

    /// Devolve o canal onde o estado mudou, pelo mesmo motivo.
    pub async fn update_voice_state(
        &self,
        peer_id: &PeerId,
        muted: bool,
        deafened: bool,
    ) -> Option<String> {
        let mut sessions = self.sessions.write().await;
        let voice = sessions.get_mut(peer_id)?.voice.as_mut()?;
        voice.muted = muted;
        voice.deafened = deafened;
        Some(voice.channel.clone())
    }

    /// Todas as conexoes que estao neste canal de voz agora.
    /// Existe para os testes conferirem o roster sem depender de eventos.
    #[cfg(test)]
    pub async fn peers_in_voice(&self, channel: &str) -> Vec<PeerId> {
        self.sessions
            .read()
            .await
            .iter()
            .filter(|(_, entry)| entry.is_in(channel))
            .map(|(peer_id, _)| peer_id.clone())
            .collect()
    }

    pub async fn shares_voice_channel(&self, first: &PeerId, second: &PeerId) -> bool {
        let sessions = self.sessions.read().await;
        match (sessions.get(first), sessions.get(second)) {
            (Some(first), Some(second)) => match (&first.voice, &second.voice) {
                (Some(first), Some(second)) => first.channel == second.channel,
                _ => false,
            },
            _ => false,
        }
    }
}

impl SessionEntry {
    fn is_in(&self, channel: &str) -> bool {
        self.voice
            .as_ref()
            .is_some_and(|voice| voice.channel == channel)
    }
}

fn voice_peer(peer_id: &PeerId, session: &SessionEntry) -> Option<VoicePeer> {
    let voice = session.voice.as_ref()?;
    Some(VoicePeer {
        peer_id: peer_id.clone(),
        user_id: session.user_id.clone(),
        username: session.username.clone(),
        channel: voice.channel.clone(),
        muted: voice.muted,
        deafened: voice.deafened,
    })
}
