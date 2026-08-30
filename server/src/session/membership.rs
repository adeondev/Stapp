//! Quem esta em qual call.
//!
//! So o estado — quem avisa os outros e o servico de voz.

use super::{AppState, SessionEntry};
use crate::protocol::{PeerId, VoicePeer};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub(super) struct VoiceMembership {
    pub channel: String,
    pub muted: bool,
    pub deafened: bool,
    pub camera_enabled: bool,
    pub screen_sharing: bool,
}

#[derive(Debug, Clone)]
pub(super) struct VoiceReservation {
    pub channel: String,
    pub expires_at: Instant,
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
    NoReservation,
    GrantExpired,
}

pub struct VoiceDeparture {
    pub channel: String,
    pub published: bool,
}

impl AppState {
    pub async fn voice_peers(&self) -> Vec<VoicePeer> {
        let sessions = self.sessions.read().await;
        sessions
            .iter()
            .filter_map(|(id, entry)| voice_peer(id, entry))
            .collect()
    }

    /// Inclui reservas ainda nao publicadas. E usado para revogar grants de
    /// uma chamada direta imediatamente quando amizade/bloqueio muda.
    pub async fn voice_sessions_including_reservations(&self, channel: &str) -> Vec<PeerId> {
        self.sessions
            .read()
            .await
            .iter()
            .filter(|(_, entry)| {
                entry.is_in(channel)
                    || entry
                        .pending_voice
                        .as_ref()
                        .is_some_and(|pending| pending.channel == channel)
            })
            .map(|(peer_id, _)| peer_id.clone())
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
            camera_enabled: false,
            screen_sharing: false,
        });
        let peer = voice_peer(peer_id, entry).expect("membership acabou de ser criada");

        Ok(VoiceJoin { roster, peer })
    }

    /// Reserva uma vaga enquanto o cliente abre a conexao com o SFU. A pessoa
    /// so aparece para os demais depois de [`confirm_voice`] — um picker
    /// cancelado ou um SFU fora do ar nao cria um participante fantasma.
    pub async fn reserve_voice(
        &self,
        peer_id: &PeerId,
        channel: &str,
        max_peers: usize,
        ttl: Duration,
    ) -> Result<(), VoiceJoinError> {
        let mut sessions = self.sessions.write().await;
        let now = Instant::now();
        for entry in sessions.values_mut() {
            if entry
                .pending_voice
                .as_ref()
                .is_some_and(|pending| pending.expires_at <= now)
            {
                entry.pending_voice = None;
            }
        }

        let user_id = sessions
            .get(peer_id)
            .map(|entry| entry.user_id.clone())
            .ok_or(VoiceJoinError::PeerNotFound)?;
        if sessions.iter().any(|(id, entry)| {
            id != peer_id
                && entry.user_id == user_id
                && (entry.voice.is_some() || entry.pending_voice.is_some())
        }) {
            return Err(VoiceJoinError::AccountAlreadyInVoice);
        }

        let occupied = sessions
            .values()
            .filter(|entry| {
                entry.is_in(channel)
                    || entry
                        .pending_voice
                        .as_ref()
                        .is_some_and(|pending| pending.channel == channel)
            })
            .count();
        if occupied >= max_peers {
            return Err(VoiceJoinError::Full);
        }

        let entry = sessions
            .get_mut(peer_id)
            .ok_or(VoiceJoinError::PeerNotFound)?;
        entry.pending_voice = Some(VoiceReservation {
            channel: channel.to_string(),
            expires_at: now + ttl,
        });
        Ok(())
    }

    pub async fn confirm_voice(
        &self,
        peer_id: &PeerId,
        channel: &str,
    ) -> Result<VoiceJoin, VoiceJoinError> {
        let mut sessions = self.sessions.write().await;
        let reservation = sessions
            .get_mut(peer_id)
            .ok_or(VoiceJoinError::PeerNotFound)?
            .pending_voice
            .take()
            .ok_or(VoiceJoinError::NoReservation)?;
        if reservation.channel != channel || reservation.expires_at <= Instant::now() {
            return Err(VoiceJoinError::GrantExpired);
        }

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
            camera_enabled: false,
            screen_sharing: false,
        });
        let peer = voice_peer(peer_id, entry).expect("membership acabou de ser confirmada");
        Ok(VoiceJoin { roster, peer })
    }

    pub async fn cancel_voice_reservation(&self, peer_id: &PeerId) {
        if let Some(entry) = self.sessions.write().await.get_mut(peer_id) {
            entry.pending_voice = None;
        }
    }

    /// Devolve o canal de onde a pessoa saiu — quem avisa precisa saber para
    /// escolher a quem contar.
    pub async fn leave_voice(&self, peer_id: &PeerId) -> Option<VoiceDeparture> {
        let mut sessions = self.sessions.write().await;
        let entry = sessions.get_mut(peer_id)?;
        let active = entry.voice.take();
        let pending = entry.pending_voice.take();
        active
            .map(|voice| VoiceDeparture {
                channel: voice.channel,
                published: true,
            })
            .or_else(|| {
                pending.map(|reservation| VoiceDeparture {
                    channel: reservation.channel,
                    published: false,
                })
            })
    }

    /// Devolve o canal onde o estado mudou, pelo mesmo motivo.
    pub async fn update_voice_state(
        &self,
        peer_id: &PeerId,
        muted: bool,
        deafened: bool,
        camera_enabled: bool,
        screen_sharing: bool,
    ) -> Option<String> {
        let mut sessions = self.sessions.write().await;
        let voice = sessions.get_mut(peer_id)?.voice.as_mut()?;
        voice.muted = muted;
        voice.deafened = deafened;
        voice.camera_enabled = camera_enabled;
        voice.screen_sharing = screen_sharing;
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
        camera_enabled: voice.camera_enabled,
        screen_sharing: voice.screen_sharing,
    })
}
