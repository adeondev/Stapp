//! Abrir e fechar sessoes, e a presenca que sai disso.

use std::collections::{HashMap, HashSet};

use super::{AppState, SessionEntry};
use crate::protocol::{OnlineUser, UserId};
use crate::storage::Account;

pub struct SessionRegistration {
    /// Primeira conexao desta conta: e a que anuncia "fulano ficou online".
    pub first_session: bool,
    pub user: OnlineUser,
}

pub struct SessionRemoval {
    pub user_id: UserId,
    /// Ultima conexao desta conta: e a que anuncia "fulano saiu".
    pub last_session: bool,
}

#[derive(Debug)]
pub enum SessionError {
    ServerFull,
    TooManySessions,
}

impl AppState {
    pub async fn register_session(
        &self,
        peer_id: &str,
        account: &Account,
    ) -> Result<SessionRegistration, SessionError> {
        let mut sessions = self.sessions.write().await;

        let session_count = sessions
            .values()
            .filter(|entry| entry.user_id == account.id && !entry.disconnected)
            .count();
        if session_count >= self.config.auth.max_sessions_per_user {
            return Err(SessionError::TooManySessions);
        }

        // O limite do servidor conta contas, nao conexoes: abrir o app no celular
        // e no PC nao ocupa duas vagas.
        let first_session = sessions
            .values()
            .filter(|entry| entry.user_id == account.id)
            .count() == 0;

        // Flapping de rede (Wi-Fi -> 4G -> VPN) deixa para tras sessoes zumbis da
        // mesma conta: o socket ja morreu e elas so esperam o timer de queda expirar.
        // A que ja perdeu a vaga de audio (takeover) nao guarda mais nada util, entao
        // a reconexao a desaloja aqui em vez de conviver com ela ate o grace period.
        // A que ainda segura voz fica: quem a desaloja e o takeover em `reserve_voice`,
        // que sabe anunciar o `voice.left` para os outros participantes.
        let stale: Vec<String> = sessions
            .iter()
            .filter(|(_, entry)| {
                entry.user_id == account.id
                    && entry.disconnected
                    && entry.voice.is_none()
                    && entry.pending_voice.is_none()
            })
            .map(|(id, _)| id.clone())
            .collect();
        for peer in stale {
            tracing::info!(
                peer = %peer,
                user = %account.id,
                "desalojando sessao zumbi da mesma conta na reconexao"
            );
            sessions.remove(&peer);
        }
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
                pending_voice: None,
                disconnected: false,
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

    /// PROTOTYPE: presenca e agregada por conta mesmo com varias conexoes. A voz
    /// ja conserva peer_id separado para permitir expor sessoes individuais depois.
    pub async fn snapshot(&self) -> Vec<OnlineUser> {
        let sessions = self.sessions.read().await;
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

    /// Todas as conexoes abertas desta conta. Uma pessoa pode estar no PC e no
    /// celular; a mensagem direta tem que chegar nas duas.
    pub async fn sessions_of(&self, user_id: &UserId) -> Vec<String> {
        self.sessions
            .read()
            .await
            .iter()
            .filter(|(_, entry)| &entry.user_id == user_id)
            .map(|(peer_id, _)| peer_id.clone())
            .collect()
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

    pub async fn mark_session_disconnected(&self, peer_id: &str) {
        let mut sessions = self.sessions.write().await;
        if let Some(entry) = sessions.get_mut(peer_id) {
            entry.disconnected = true;
        }
    }

    pub async fn is_session_disconnected(&self, peer_id: &str) -> bool {
        let sessions = self.sessions.read().await;
        sessions
            .get(peer_id)
            .map(|entry| entry.disconnected)
            .unwrap_or(false)
    }
}
