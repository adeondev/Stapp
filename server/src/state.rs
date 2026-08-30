use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use tokio::sync::{RwLock, broadcast};

use crate::auth::AuthService;
use crate::config::Config;
use crate::db::{Account, Db};
use crate::protocol::{OnlineUser, PeerId, ServerMsg, UserId, VoicePeer};

#[derive(Debug, Clone)]
pub enum Target {
    All,
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
struct SessionEntry {
    user_id: UserId,
    username: String,
    voice: Option<VoiceMembership>,
}

pub struct SessionRegistration {
    pub first_session: bool,
    pub user: OnlineUser,
}

pub struct SessionRemoval {
    pub user_id: UserId,
    pub last_session: bool,
}

#[derive(Debug)]
pub enum SessionError {
    ServerFull,
    TooManySessions,
}

pub struct VoiceJoin {
    pub roster: Vec<VoicePeer>,
    pub peer: VoicePeer,
}

#[derive(Debug)]
pub enum VoiceJoinError {
    PeerNotFound,
    Full,
    AccountAlreadyInVoice,
}

pub struct AppState {
    pub config: Config,
    pub db: Db,
    pub auth: AuthService,
    sessions: RwLock<HashMap<PeerId, SessionEntry>>,
    tx: broadcast::Sender<Envelope>,
}

impl AppState {
    pub fn new(config: Config, db: Db) -> anyhow::Result<Arc<Self>> {
        let (tx, _) = broadcast::channel(512);
        Ok(Arc::new(Self {
            config,
            db,
            auth: AuthService::new()?,
            sessions: RwLock::new(HashMap::new()),
            tx,
        }))
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Envelope> {
        self.tx.subscribe()
    }

    pub fn publish(&self, target: Target, msg: ServerMsg) {
        let _ = self.tx.send(Envelope { target, msg });
    }

    pub fn send_to(&self, peer: &str, msg: ServerMsg) {
        self.publish(Target::Peer(peer.to_string()), msg);
    }

    pub fn broadcast(&self, msg: ServerMsg) {
        self.publish(Target::All, msg);
    }

    pub async fn register_session(
        &self,
        peer_id: &str,
        account: &Account,
    ) -> Result<SessionRegistration, SessionError> {
        let mut sessions = self.sessions.write().await;
        let session_count = sessions
            .values()
            .filter(|entry| entry.user_id == account.id)
            .count();
        if session_count >= self.config.auth.max_sessions_per_user {
            return Err(SessionError::TooManySessions);
        }

        let first_session = session_count == 0;
        if first_session {
            let online_accounts: HashSet<&str> = sessions
                .values()
                .map(|entry| entry.user_id.as_str())
                .collect();
            if online_accounts.len() >= self.config.server.max_users {
                return Err(SessionError::ServerFull);
            }
        }

        let user = OnlineUser {
            user_id: account.id.clone(),
            username: account.username.clone(),
        };
        sessions.insert(
            peer_id.to_string(),
            SessionEntry {
                user_id: account.id.clone(),
                username: account.username.clone(),
                voice: None,
            },
        );
        Ok(SessionRegistration {
            first_session,
            user,
        })
    }

    pub async fn remove_session(&self, peer_id: &str) -> Option<SessionRemoval> {
        let mut sessions = self.sessions.write().await;
        let removed = sessions.remove(peer_id)?;
        let last_session = !sessions
            .values()
            .any(|entry| entry.user_id == removed.user_id);
        Some(SessionRemoval {
            user_id: removed.user_id,
            last_session,
        })
    }

    pub async fn snapshot(&self) -> Vec<OnlineUser> {
        let sessions = self.sessions.read().await;
        // PROTOTYPE: presenca e agregada por conta mesmo com varias conexoes. A voz ja
        // conserva peer_id separado para permitir expor sessoes individuais no futuro.
        let mut by_user = HashMap::<&str, &str>::new();
        for entry in sessions.values() {
            by_user.entry(&entry.user_id).or_insert(&entry.username);
        }
        let mut list: Vec<_> = by_user
            .into_iter()
            .map(|(user_id, username)| OnlineUser {
                user_id: user_id.to_string(),
                username: username.to_string(),
            })
            .collect();
        list.sort_by_key(|user| user.username.to_ascii_lowercase());
        list
    }

    pub async fn identity_of(&self, peer_id: &str) -> Option<OnlineUser> {
        self.sessions
            .read()
            .await
            .get(peer_id)
            .map(|entry| OnlineUser {
                user_id: entry.user_id.clone(),
                username: entry.username.clone(),
            })
    }

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
        // esta guarda para permitir peers visiveis por sessao; o protocolo ja leva os dois IDs.
        if sessions
            .iter()
            .any(|(id, entry)| id != peer_id && entry.user_id == user_id && entry.voice.is_some())
        {
            return Err(VoiceJoinError::AccountAlreadyInVoice);
        }

        let occupied = sessions
            .values()
            .filter(|entry| {
                entry
                    .voice
                    .as_ref()
                    .is_some_and(|voice| voice.channel == channel)
            })
            .count();
        if occupied >= self.config.voice.max_peers {
            return Err(VoiceJoinError::Full);
        }

        let roster = sessions
            .iter()
            .filter_map(|(id, entry)| {
                entry
                    .voice
                    .as_ref()
                    .filter(|voice| voice.channel == channel)?;
                voice_peer(id, entry)
            })
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestServer;

    #[tokio::test]
    async fn aggregates_presence_and_enforces_limits() {
        let server = TestServer::new(1, 4);
        let first = server.account("Daniel");
        let second = server.account("Alice");
        assert!(
            server
                .state
                .register_session("one", &first)
                .await
                .unwrap()
                .first_session
        );
        assert!(
            !server
                .state
                .register_session("two", &first)
                .await
                .unwrap()
                .first_session
        );
        assert_eq!(server.state.snapshot().await.len(), 1);
        assert!(matches!(
            server.state.register_session("other", &second).await,
            Err(SessionError::ServerFull)
        ));
    }

    #[tokio::test]
    async fn limits_sessions_per_account() {
        let mut server = TestServer::new(10, 4);
        Arc::get_mut(&mut server.state)
            .unwrap()
            .config
            .auth
            .max_sessions_per_user = 2;
        let account = server.account("Daniel");
        server
            .state
            .register_session("one", &account)
            .await
            .unwrap();
        server
            .state
            .register_session("two", &account)
            .await
            .unwrap();
        assert!(matches!(
            server.state.register_session("three", &account).await,
            Err(SessionError::TooManySessions)
        ));
    }

    #[tokio::test]
    async fn keeps_one_voice_session_per_account() {
        let server = TestServer::new(10, 2);
        let account = server.account("Daniel");
        server
            .state
            .register_session("one", &account)
            .await
            .unwrap();
        server
            .state
            .register_session("two", &account)
            .await
            .unwrap();
        server
            .state
            .join_voice(&"one".into(), "voz-a")
            .await
            .unwrap();
        assert!(matches!(
            server.state.join_voice(&"two".into(), "voz-a").await,
            Err(VoiceJoinError::AccountAlreadyInVoice)
        ));
    }

    #[tokio::test]
    async fn removes_presence_only_with_the_last_session() {
        let server = TestServer::new(10, 2);
        let account = server.account("Daniel");
        server
            .state
            .register_session("one", &account)
            .await
            .unwrap();
        server
            .state
            .register_session("two", &account)
            .await
            .unwrap();
        assert!(
            !server
                .state
                .remove_session("one")
                .await
                .unwrap()
                .last_session
        );
        assert!(
            server
                .state
                .remove_session("two")
                .await
                .unwrap()
                .last_session
        );
    }
}
