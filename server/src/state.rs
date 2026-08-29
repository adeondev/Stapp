use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{RwLock, broadcast};

use crate::config::Config;
use crate::db::Db;
use crate::protocol::{PeerId, ServerMsg, User};

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
pub struct VoiceMembership {
    pub channel: String,
    pub muted: bool,
    pub deafened: bool,
}

#[derive(Debug, Clone)]
pub struct UserEntry {
    pub nick: String,
    /// `None` = conectado mas fora de call.
    pub voice: Option<VoiceMembership>,
}

pub struct AppState {
    pub config: Config,
    pub db: Db,
    pub users: RwLock<HashMap<PeerId, UserEntry>>,
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

    pub async fn remove(&self, id: &str) -> Option<UserEntry> {
        self.users.write().await.remove(id)
    }

    pub async fn snapshot(&self) -> Vec<User> {
        let users = self.users.read().await;
        let mut list: Vec<User> =
            users.iter().map(|(id, u)| User { id: id.clone(), nick: u.nick.clone() }).collect();
        list.sort_by(|a, b| a.nick.to_lowercase().cmp(&b.nick.to_lowercase()));
        list
    }

    pub async fn nick_of(&self, id: &str) -> Option<String> {
        self.users.read().await.get(id).map(|u| u.nick.clone())
    }
}
