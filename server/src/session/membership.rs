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

    pub async fn join_voice(
        &self,
        peer_id: &PeerId,
        channel: &str,
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
        if occupied >= self.config.voice.max_peers {
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

    pub async fn leave_voice(&self, peer_id: &PeerId) -> bool {
        let mut sessions = self.sessions.write().await;
        sessions
            .get_mut(peer_id)
            .is_some_and(|entry| entry.voice.take().is_some())
    }

    pub async fn update_voice_state(&self, peer_id: &PeerId, muted: bool, deafened: bool) -> bool {
        let mut sessions = self.sessions.write().await;
        match sessions
            .get_mut(peer_id)
            .and_then(|entry| entry.voice.as_mut())
        {
            Some(voice) => {
                voice.muted = muted;
                voice.deafened = deafened;
                true
            }
            None => false,
        }
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
