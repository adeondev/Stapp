//! Entrega de eventos.
//!
//! Existe um unico canal de broadcast; cada conexao recebe todo envelope e
//! descarta o que nao e seu. Com um grupo de amigos isso sai de graca e evita
//! manter um canal por conexao.

use tokio::sync::broadcast;

use super::AppState;
use crate::protocol::{PeerId, ServerMsg};

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

impl AppState {
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
}
