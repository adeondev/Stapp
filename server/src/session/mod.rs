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
    pub media: crate::services::media::MediaStorageService,
    pub crawler: Arc<crate::services::preview::LinkPreviewCrawler>,
    sessions: RwLock<HashMap<PeerId, SessionEntry>>,
    calls: RwLock<calls::Calls>,
    tx: broadcast::Sender<Envelope>,
}

impl AppState {
    pub fn new(config: Config, db: Db) -> anyhow::Result<Arc<Self>> {
        let (tx, _) = broadcast::channel(512);
        let crawler = crate::services::preview::LinkPreviewCrawler::start(
            crate::services::preview::crawler::DEFAULT_QUEUE_CAPACITY,
            crate::services::preview::crawler::DEFAULT_MAX_CONCURRENCY,
        );

        #[cfg(feature = "s3")]
        let media = if let Some(s3) = config.storage.s3.as_ref() {
            crate::services::media::MediaStorageService::s3(
                s3,
                config.storage.attachments_dir.join(".uploading"),
            )?
        } else {
            crate::services::media::MediaStorageService::local(
                config.storage.attachments_dir.clone(),
            )?
        };

        #[cfg(not(feature = "s3"))]
        let media = {
            if config.storage.s3.is_some() {
                tracing::warn!("[storage.s3] ignorado: compile com --features s3 para ativa-lo");
            }
            crate::services::media::MediaStorageService::local(
                config.storage.attachments_dir.clone(),
            )?
        };

        let state = Arc::new(Self {
            config,
            db,
            auth: AuthService::new()?,
            media,
            crawler: crawler.clone(),
            sessions: RwLock::new(HashMap::new()),
            calls: RwLock::new(calls::Calls::default()),
            tx,
        });

        crawler.bind_state(Arc::downgrade(&state));

        Ok(state)
    }

    /// Enfileira uma requisicao de scraping de link em background de forma nao-bloqueante.
    pub fn enqueue_preview(
        &self,
        message_id: String,
        url: String,
        target: crate::services::preview::CrawlTarget,
    ) -> bool {
        self.crawler.enqueue(crate::services::preview::CrawlJob {
            message_id,
            url,
            target,
        })
    }

    /// Despacha o preview obtido para os devidos destinatarios (canal ou DM).
    pub async fn dispatch_link_preview(
        &self,
        message_id: String,
        preview: crate::protocol::UrlPreview,
        target: &crate::services::preview::CrawlTarget,
    ) {
        let msg = crate::protocol::ServerMsg::LinkPreviewEnriched {
            message_id,
            preview,
        };
        match target {
            crate::services::preview::CrawlTarget::Channel => {
                self.broadcast(msg);
            }
            crate::services::preview::CrawlTarget::Direct {
                author_id,
                other_id,
            } => {
                for peer in self.sessions_of(author_id).await {
                    self.send_to(&peer, msg.clone());
                }
                for peer in self.sessions_of(other_id).await {
                    self.send_to(&peer, msg.clone());
                }
            }
        }
    }

    /// Desliga os servicos em background (como o crawler de previews) de forma coordenada.
    pub async fn shutdown(&self) {
        self.crawler.shutdown().await;
    }
}

#[cfg(test)]
mod tests;
