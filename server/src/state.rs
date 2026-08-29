use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{RwLock, broadcast};

use crate::config::Config;
use crate::db::Db;
use crate::protocol::{PeerId, ServerMsg, User, VoicePeer};

/// Para quem vai a mensagem. Todo mundo recebe o envelope pelo broadcast e
/// descarta o que nao e seu — com um grupo de amigos isso sai de graca e evita
/// um canal por conexao.
#[derive(Debug, Clone)]
pub enum Target {
    All,
    /// Todo mundo menos este.
    Except(PeerId),
    Peer(PeerId),
}

#[derive(Debug, Clone)]
pub struct Envelope {
    pub target: Target,
    pub msg: ServerMsg,
}

impl Envelope {
    pub fn is_for(&self, me: &str) -> bool {
        match &self.target {
            Target::All => true,
            Target::Except(id) => id != me,
            Target::Peer(id) => id == me,
        }
    }
}

#[derive(Debug, Clone)]
struct VoiceMembership {
    channel: String,
    muted: bool,
    deafened: bool,
}

#[derive(Debug, Clone)]
struct UserEntry {
    nick: String,
    /// `None` = conectado mas fora de call.
    voice: Option<VoiceMembership>,
}

pub struct VoiceJoin {
    pub roster: Vec<VoicePeer>,
    pub peer: VoicePeer,
}

#[derive(Debug)]
pub enum VoiceJoinError {
    PeerNotFound,
    Full,
}

pub struct AppState {
    pub config: Config,
    pub db: Db,
    users: RwLock<HashMap<PeerId, UserEntry>>,
    tx: broadcast::Sender<Envelope>,
}

impl AppState {
    pub fn new(config: Config, db: Db) -> Arc<Self> {
        let (tx, _) = broadcast::channel(512);
        Arc::new(Self { config, db, users: RwLock::new(HashMap::new()), tx })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Envelope> {
        self.tx.subscribe()
    }

    /// Erro aqui so acontece quando nao ha nenhum ouvinte — nada a fazer.
    pub fn publish(&self, target: Target, msg: ServerMsg) {
        let _ = self.tx.send(Envelope { target, msg });
    }

    pub fn send_to(&self, peer: &str, msg: ServerMsg) {
        self.publish(Target::Peer(peer.to_string()), msg);
    }

    pub fn broadcast(&self, msg: ServerMsg) {
        self.publish(Target::All, msg);
    }

    pub async fn register(&self, id: &str, nick: String) -> Result<(), String> {
        let mut users = self.users.write().await;
        if users.len() >= self.config.server.max_users {
            return Err(format!("servidor cheio ({} pessoas)", self.config.server.max_users));
        }
        users.insert(id.to_string(), UserEntry { nick, voice: None });
        Ok(())
    }

    pub async fn remove(&self, id: &str) -> bool {
        self.users.write().await.remove(id).is_some()
    }

    pub async fn snapshot(&self) -> Vec<User> {
        let users = self.users.read().await;
        let mut list: Vec<User> =
            users.iter().map(|(id, u)| User { id: id.clone(), nick: u.nick.clone() }).collect();
        list.sort_by_key(|user| user.nick.to_lowercase());
        list
    }

    pub async fn nick_of(&self, id: &str) -> Option<String> {
        self.users.read().await.get(id).map(|u| u.nick.clone())
    }

    pub async fn voice_peers(&self) -> Vec<VoicePeer> {
        let users = self.users.read().await;
        users
            .iter()
            .filter_map(|(id, u)| voice_peer(id, u))
            .collect()
    }

    pub async fn join_voice(
        &self,
        peer_id: &PeerId,
        channel: &str,
    ) -> Result<VoiceJoin, VoiceJoinError> {
        let mut users = self.users.write().await;

        let occupied = users
            .values()
            .filter(|u| u.voice.as_ref().is_some_and(|v| v.channel == channel))
            .count();
        if occupied >= self.config.voice.max_peers {
            return Err(VoiceJoinError::Full);
        }

        // Montado antes de entrar, entao nunca inclui quem esta chegando.
        let roster = users
            .iter()
            .filter_map(|(id, u)| {
                u.voice.as_ref().filter(|v| v.channel == channel)?;
                voice_peer(id, u)
            })
            .collect();

        let entry = users.get_mut(peer_id).ok_or(VoiceJoinError::PeerNotFound)?;
        entry.voice = Some(VoiceMembership {
            channel: channel.to_string(),
            muted: false,
            deafened: false,
        });

        let peer = VoicePeer {
            id: peer_id.clone(),
            nick: entry.nick.clone(),
            channel: channel.to_string(),
            muted: false,
            deafened: false,
        };

        Ok(VoiceJoin { roster, peer })
    }

    pub async fn leave_voice(&self, peer_id: &PeerId) -> bool {
        let mut users = self.users.write().await;
        match users.get_mut(peer_id) {
            Some(entry) => entry.voice.take().is_some(),
            None => false,
        }
    }

    pub async fn update_voice_state(
        &self,
        peer_id: &PeerId,
        muted: bool,
        deafened: bool,
    ) -> bool {
        let mut users = self.users.write().await;
        match users.get_mut(peer_id).and_then(|u| u.voice.as_mut()) {
            Some(voice) => {
                voice.muted = muted;
                voice.deafened = deafened;
                true
            }
            None => false,
        }
    }

    pub async fn shares_voice_channel(&self, first: &PeerId, second: &PeerId) -> bool {
        let users = self.users.read().await;
        match (users.get(first), users.get(second)) {
            (Some(a), Some(b)) => match (&a.voice, &b.voice) {
                (Some(a), Some(b)) => a.channel == b.channel,
                _ => false,
            },
            _ => false,
        }
    }
}

fn voice_peer(id: &PeerId, user: &UserEntry) -> Option<VoicePeer> {
    let voice = user.voice.as_ref()?;
    Some(VoicePeer {
        id: id.clone(),
        nick: user.nick.clone(),
        channel: voice.channel.clone(),
        muted: voice.muted,
        deafened: voice.deafened,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestServer;

    #[tokio::test]
    async fn enforces_the_user_limit() {
        let server = TestServer::new(1, 4);
        assert!(server.state.register("one", "One".into()).await.is_ok());

        let error = server.state.register("two", "Two".into()).await.unwrap_err();
        assert!(error.contains("servidor cheio"));
        assert_eq!(server.state.snapshot().await.len(), 1);
    }

    #[tokio::test]
    async fn keeps_one_voice_membership_per_user() {
        let server = TestServer::new(10, 2);
        server.state.register("one", "One".into()).await.unwrap();
        server.state.register("two", "Two".into()).await.unwrap();

        let first = server.state.join_voice(&"one".into(), "voz-a").await.unwrap();
        assert!(first.roster.is_empty());

        let second = server.state.join_voice(&"two".into(), "voz-a").await.unwrap();
        assert_eq!(second.roster.len(), 1);
        assert!(server.state.shares_voice_channel(&"one".into(), &"two".into()).await);

        server.state.join_voice(&"two".into(), "voz-b").await.unwrap();
        assert!(!server.state.shares_voice_channel(&"one".into(), &"two".into()).await);

        let memberships: Vec<_> = server
            .state
            .voice_peers()
            .await
            .into_iter()
            .filter(|peer| peer.id == "two")
            .collect();
        assert_eq!(memberships.len(), 1);
        assert_eq!(memberships[0].channel, "voz-b");
    }

    #[tokio::test]
    async fn enforces_voice_limit_and_updates_voice_state() {
        let server = TestServer::new(10, 1);
        server.state.register("one", "One".into()).await.unwrap();
        server.state.register("two", "Two".into()).await.unwrap();

        server.state.join_voice(&"one".into(), "voz-a").await.unwrap();
        let full = server.state.join_voice(&"two".into(), "voz-a").await;
        assert!(matches!(full, Err(VoiceJoinError::Full)));

        assert!(server.state.update_voice_state(&"one".into(), true, false).await);
        let peer = server
            .state
            .voice_peers()
            .await
            .into_iter()
            .find(|peer| peer.id == "one")
            .unwrap();
        assert!(peer.muted);
        assert!(!peer.deafened);

        assert!(server.state.leave_voice(&"one".into()).await);
        assert!(!server.state.leave_voice(&"one".into()).await);
    }
}
