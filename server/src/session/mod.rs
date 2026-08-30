//! Estado vivo do servidor: quem esta conectado agora.
//!
//! Nada aqui vai para o disco — isso e do [`crate::storage`]. `mod.rs` guarda
//! so o [`AppState`] e o registro de sessoes; o resto se divide por assunto:
//!
//! - [`bus`] — como um evento chega ate as conexoes;
//! - [`registry`] — abrir/fechar sessao e presenca por conta;
//! - [`membership`] — quem esta em qual call.

mod bus;
mod calls;
mod membership;
mod registry;

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{RwLock, broadcast};

use crate::auth::AuthService;
use crate::config::Config;
use crate::protocol::{PeerId, UserId};
use crate::storage::Db;

pub use bus::{Envelope, Target};
pub use calls::{CallStartError, PendingCall};
pub use membership::{VoiceJoin, VoiceJoinError};
pub use registry::SessionError;

/// Uma conexao autenticada. Uma conta pode ter varias.
#[derive(Debug, Clone)]
struct SessionEntry {
    user_id: UserId,
    username: String,
    voice: Option<membership::VoiceMembership>,
    pending_voice: Option<membership::VoiceReservation>,
}

pub struct AppState {
    pub config: Config,
    pub db: Db,
    pub auth: AuthService,
    sessions: RwLock<HashMap<PeerId, SessionEntry>>,
    calls: RwLock<calls::Calls>,
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
            calls: RwLock::new(calls::Calls::default()),
            tx,
        }))
    }
}

#[cfg(test)]
mod tests;
